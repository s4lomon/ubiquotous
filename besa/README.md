# BESA Bridge — Setup no Mac

## 1. Instala dependências

```bash
# Homebrew (se não tiver)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Boost
brew install boost

# liblsl
brew tap labstreaminglayer/tap
brew install lsl

# CMake
brew install cmake
```

---

## 2. Configura o BESA Simulator

Dentro do BESA Simulator:
1. **File → New Simulation** (ou abre uma existente)
2. Vai em **Output → LSL Streaming** → habilita
3. Confirma que está emitindo tipo `EEG` com os 75 canais
4. Clica em **Start Simulation**

O stream LSL vai aparecer em `type=EEG`.

---

## 3. Compila o bridge

```bash
cd besa_bridge
mkdir build && cd build
cmake ..
make -j4
```

---

## 4. Roda

Primeira janela de terminal — bridge C++:
```bash
./besa_bridge
```

Você vai ver:
```
╔══════════════════════════════════════╗
║   BESA → Muse Bridge (C++)          ║
║   Canais: TP9 AF7 AF8 TP10          ║
╚══════════════════════════════════════╝

[INIT] Buscando stream BESA para mapear canais...
[LSL] Canal AF7 encontrado no índice 2
[LSL] Canal AF8 encontrado no índice 6
[LSL] Canal TP9 encontrado no índice 72
[LSL] Canal TP10 encontrado no índice 73
[WS] Servidor rodando em ws://localhost:8765
[WS] Aguardando conexão do HTML...
```

---

## 5. Conecta o HTML

No seu HTML, conecta assim:

```javascript
const ws = new WebSocket('ws://localhost:8765');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    // data.TP9, data.AF7, data.AF8, data.TP10
    // data.ts  (timestamp LSL)
    console.log(data);
};
```

Formato do JSON que chega:
```json
{"TP9": 12.34, "AF7": -5.10, "AF8": 8.72, "TP10": 3.21, "ts": 1234567890.123}
```

---

## Troubleshooting

**"BESA não encontrado via LSL"**
→ Verifica se o BESA está rodando e com LSL Streaming habilitado
→ Testa com: `python3 -c "import pylsl; print(pylsl.resolve_streams())"`

**"liblsl não encontrada"**
→ Roda `brew install lsl` e tenta compilar de novo

**HTML não conecta**
→ Abre o HTML via `http://localhost` (não via `file://`)
→ `python3 -m http.server 3000` na pasta do HTML
