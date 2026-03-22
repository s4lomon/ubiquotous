/*
 * activethree_reader.cpp — v2
 * ---------------------------
 * Reads the binary stream and prints real-time values.
 * Detects event markers in STATUS word and prints labeled events.
 *
 * Usage:  ./activethree_stream | ./activethree_reader
 */

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <csignal>

static constexpr int    N_CH       = 144;
static constexpr double LSB_UV     = 31.25e-3;
static constexpr double LSB_MV     = 31.25e-6;
static constexpr int    PRINT_EVERY = 512;  // ~32 Hz display

static volatile bool g_run = true;
static void on_sig(int) { g_run = false; }

// ANSI colors
#define RESET  "\033[0m"
#define BOLD   "\033[1m"
#define RED    "\033[31m"
#define GREEN  "\033[32m"
#define YELLOW "\033[33m"
#define CYAN   "\033[36m"
#define MAG    "\033[35m"

static const char* evt_label(uint8_t code) {
    switch(code) {
        case 1: return BOLD GREEN  "▶ EVENT: BRAÇO DIREITO  (ERD hemisf. esq + EMG)" RESET;
        case 2: return BOLD GREEN  "◀ EVENT: BRAÇO ESQUERDO (ERD hemisf. dir + EMG)" RESET;
        case 3: return BOLD CYAN   "👁 EVENT: PISCADA DIREITA (EOG corneoretinal)"    RESET;
        case 4: return BOLD CYAN   "👁 EVENT: PISCADA ESQUERDA (EOG corneoretinal)"   RESET;
        case 5: return BOLD RED    "⚡ EVENT: ALERTA/SUSTO  (N100 + P300 + burst)"    RESET;
        default: return nullptr;
    }
}

static const char* evt_short(uint8_t code) {
    switch(code) {
        case 1: return YELLOW "[ARM_R]"  RESET;
        case 2: return YELLOW "[ARM_L]"  RESET;
        case 3: return CYAN   "[BLINK_R]" RESET;
        case 4: return CYAN   "[BLINK_L]" RESET;
        case 5: return RED    "[STARTLE]" RESET;
        default: return "       ";
    }
}

int main() {
    signal(SIGINT, on_sig);
    setvbuf(stdin, nullptr, _IOFBF, N_CH * sizeof(int32_t) * 256);

    printf("\033[2J\033[H");
    printf(BOLD "BioSemi ActiveThree — Live Stream + Event Monitor\n" RESET);
    printf("==================================================\n");
    printf("144 ch | 24-bit SAR | 16384 Hz | LSB=31.25nV\n");
    printf("Ctrl+C to stop.\n\n");
    printf("%-10s %-8s %-10s %-10s %-10s %-10s %-10s %-10s %s\n",
           "Sample","Time(s)","Fp1(µV)","Oz(µV)","Cz(µV)","ECG(mV)","EOG-H(µV)","GSR(V)","Event");
    printf("%s\n", std::string(100, '-').c_str());

    int32_t frame[N_CH];
    uint64_t sample = 0;
    uint8_t last_code = 0;

    while (g_run) {
        if (fread(frame, sizeof(int32_t), N_CH, stdin) != (size_t)N_CH) break;

        uint32_t status   = (uint32_t)frame[0];
        uint8_t  evt_code = (uint8_t)(status & 0xFF);

        // Print event banner on rising edge
        if (evt_code != 0 && evt_code != last_code) {
            const char* lbl = evt_label(evt_code);
            if (lbl) printf("\n  %s\n\n", lbl);
        }
        last_code = evt_code;

        if (sample % PRINT_EVERY == 0) {
            double t      = sample / 16384.0;
            auto adc      = [&](int i) -> int32_t { return frame[i] >> 8; };

            printf("%-10llu %-8.3f %-10.2f %-10.2f %-10.2f %-10.4f %-10.2f %-10.4f %s\n",
                   (unsigned long long)sample, t,
                   adc(1)   * LSB_UV,   // Fp1
                   adc(25)  * LSB_UV,   // ~Oz
                   adc(47)  * LSB_UV,   // ~Cz
                   adc(129) * LSB_MV,   // ECG-L
                   adc(133) * LSB_UV,   // EOG-H
                   adc(138) * 31.25e-9, // GSR
                   evt_short(evt_code));
            fflush(stdout);
        }
        ++sample;
    }

    printf("\n--- Stopped. Total samples: %llu ---\n", (unsigned long long)sample);
    return 0;
}
