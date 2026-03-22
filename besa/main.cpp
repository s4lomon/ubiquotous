/*
 * BESA → LSL → WebSocket Bridge
 * 
 * Fluxo:
 *   BESA Simulator (LSL outlet, 75ch) 
 *     → este programa filtra TP9, AF7, AF8, TP10
 *       → WebSocket ws://localhost:8765
 *         → seu HTML
 *
 * Dependências:
 *   - liblsl  (https://github.com/sccn/liblsl)
 *   - Boost (Beast + Asio)
 *
 * Build:
 *   mkdir build && cd build
 *   cmake .. && make
 */

#include <iostream>
#include <string>
#include <vector>
#include <set>
#include <mutex>
#include <thread>
#include <atomic>
#include <sstream>
#include <chrono>
#include <algorithm>

// liblsl
#include <lsl_cpp.h>

// Boost Beast WebSocket
#include <boost/beast/core.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/asio/ip/tcp.hpp>

namespace beast     = boost::beast;
namespace websocket = beast::websocket;
namespace net       = boost::asio;
using tcp           = net::ip::tcp;

// ─────────────────────────────────────────────────────────────
// Configuração — canais do Muse que queremos extrair do BESA
// ─────────────────────────────────────────────────────────────
const std::vector<std::string> MUSE_CHANNELS = {"TP9", "AF7", "AF8", "TP10"};

// ─────────────────────────────────────────────────────────────
// Estado compartilhado entre thread LSL e thread WebSocket
// ─────────────────────────────────────────────────────────────
struct SharedState {
    std::mutex mtx;
    std::string latest_json;   // último sample como JSON
    bool has_new_data = false;
};

SharedState g_state;
std::atomic<bool> g_running{true};

// ─────────────────────────────────────────────────────────────
// Descobre quais índices no stream do BESA correspondem
// aos canais do Muse
// ─────────────────────────────────────────────────────────────
std::vector<int> find_channel_indices(const lsl::stream_info& info) {
    std::vector<int> indices;
    auto channels = info.desc().child("channels").child("channel");

    int idx = 0;
    while (!channels.empty()) {
        std::string label = channels.child_value("label");
        // Remove espaços
        label.erase(std::remove(label.begin(), label.end(), ' '), label.end());

        for (auto& target : MUSE_CHANNELS) {
            if (label == target) {
                indices.push_back(idx);
                std::cout << "[LSL] Canal " << target << " encontrado no índice " << idx << "\n";
            }
        }
        channels = channels.next_sibling("channel");
        idx++;
    }

    // Se o BESA não tiver metadados de canal, usa os índices do .elp que já vimos:
    // TP9=72 (índice 0-based), AF7=2, AF8=6, TP10=73
    if (indices.size() != MUSE_CHANNELS.size()) {
        std::cerr << "[AVISO] Metadados de canal não encontrados. Usando índices fixos do arquivo .elp.\n";
        indices = {2, 6, 72, 73}; // AF7, AF8, TP9, TP10 (0-based do output.elp)
    }

    return indices;
}

// ─────────────────────────────────────────────────────────────
// Thread LSL: lê BESA, extrai 4 canais, escreve JSON
// ─────────────────────────────────────────────────────────────
void lsl_thread(std::vector<int> ch_indices, int total_channels) {
    // Reconecta ao BESA via LSL
    std::cout << "[LSL] Procurando stream do BESA...\n";
    std::vector<lsl::stream_info> streams = lsl::resolve_stream("type", "EEG", 1, 10.0);

    if (streams.empty()) {
        std::cerr << "[ERRO] Nenhum stream EEG LSL encontrado. O BESA está rodando?\n";
        g_running = false;
        return;
    }

    lsl::stream_inlet inlet(streams[0]);
    std::cout << "[LSL] Conectado: " << streams[0].name()
              << " | " << streams[0].channel_count() << " canais"
              << " | " << streams[0].nominal_srate() << " Hz\n";

    std::vector<float> sample(total_channels);

    while (g_running) {
        double ts = inlet.pull_sample(sample, 0.1);
        if (ts == 0.0) continue; // timeout, tenta de novo

        // Monta JSON com só os 4 canais
        // Formato: {"TP9":12.3,"AF7":-5.1,"AF8":8.7,"TP10":3.2,"ts":1234567890.123}
        std::ostringstream json;
        json << std::fixed;
        json.precision(4);
        json << "{";
        for (size_t i = 0; i < MUSE_CHANNELS.size(); i++) {
            json << "\"" << MUSE_CHANNELS[i] << "\":"
                 << sample[ch_indices[i]];
            if (i < MUSE_CHANNELS.size() - 1) json << ",";
        }
        json << ",\"ts\":" << ts << "}";

        {
            std::lock_guard<std::mutex> lock(g_state.mtx);
            g_state.latest_json = json.str();
            g_state.has_new_data = true;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Sessão WebSocket por cliente
// ─────────────────────────────────────────────────────────────
void handle_client(tcp::socket socket) {
    try {
        websocket::stream<tcp::socket> ws{std::move(socket)};
        ws.accept();

        // Desativa timeout de handshake para streaming contínuo
        ws.set_option(websocket::stream_base::timeout::suggested(beast::role_type::server));

        std::cout << "[WS] Cliente conectado\n";

        std::string last_sent;

        while (g_running) {
            std::string msg;
            bool got_data = false;

            {
                std::lock_guard<std::mutex> lock(g_state.mtx);
                if (g_state.has_new_data && g_state.latest_json != last_sent) {
                    msg = g_state.latest_json;
                    g_state.has_new_data = false;
                    got_data = true;
                }
            }

            if (got_data) {
                beast::error_code ec;
                ws.write(net::buffer(msg), ec);
                if (ec) {
                    std::cout << "[WS] Cliente desconectado: " << ec.message() << "\n";
                    break;
                }
                last_sent = msg;
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
        }
    } catch (const std::exception& e) {
        std::cerr << "[WS] Erro na sessão: " << e.what() << "\n";
    }
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
int main() {
    std::cout << "╔══════════════════════════════════════╗\n";
    std::cout << "║   BESA → Muse Bridge (C++)           ║\n";
    std::cout << "║   Canais: TP9 AF7 AF8 TP10           ║\n";
    std::cout << "╚══════════════════════════════════════╝\n\n";

    // 1. Descobre stream do BESA para pegar metadados de canal
    std::cout << "[INIT] Buscando stream BESA para mapear canais...\n";
    auto streams = lsl::resolve_stream("type", "EEG", 1, 10.0);
    if (streams.empty()) {
        std::cerr << "[ERRO] BESA não encontrado via LSL. Inicia o BESA Simulator primeiro.\n";
        return 1;
    }

    int total_channels = streams[0].channel_count();
    std::vector<int> ch_indices = find_channel_indices(streams[0]);

    std::cout << "[INIT] Mapeamento:\n";
    for (size_t i = 0; i < MUSE_CHANNELS.size(); i++) {
        std::cout << "  " << MUSE_CHANNELS[i] << " → índice [" << ch_indices[i] << "]\n";
    }

    // 2. Inicia thread LSL
    std::thread lsl_t(lsl_thread, ch_indices, total_channels);

    // 3. Inicia servidor WebSocket
    net::io_context ioc;
    tcp::acceptor acceptor(ioc, tcp::endpoint(tcp::v4(), 8765));
    std::cout << "\n[WS] Servidor rodando em ws://localhost:8765\n";
    std::cout << "[WS] Aguardando conexão do HTML...\n\n";

    while (g_running) {
        tcp::socket socket(ioc);
        acceptor.accept(socket);
        std::thread(handle_client, std::move(socket)).detach();
    }

    lsl_t.join();
    return 0;
}
