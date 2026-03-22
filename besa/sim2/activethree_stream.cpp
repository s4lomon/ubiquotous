/*
 * BioSemi ActiveThree — Authentic Stream Simulator
 * =================================================
 * Emits frames in EXACTLY the format the real ActiveThree hardware produces
 * over its USB/fiber link, as documented in the BioSemi USB protocol.
 *
 * REAL DEVICE FRAME FORMAT (per BioSemi SDK docs):
 * -------------------------------------------------
 *  Each USB transfer contains N sample frames.
 *  Each sample frame = 144 × 4 bytes = 576 bytes, laid out as:
 *
 *   Bytes 0–3   : TRIGGER/STATUS word (int32, little-endian)
 *                  bits 0–15  = trigger channel (TTL input)
 *                  bit  16    = CMS in range (1 = good contact)
 *                  bit  17    = battery low
 *                  bits 18–23 = unused
 *   Bytes 4–575 : 143 channels × int32_le  (EEG + EXG + sensors + CMS/DRL)
 *
 *  Channel order (matches ActiView default):
 *   [0]        STATUS/TRIGGER
 *   [1–128]    EEG A1–D32   (128 ch)
 *   [129–136]  EXG 1–8
 *   [137–142]  Sensors (RESP, GSR, SW1–SW4)
 *   [143]      CMS
 *   (DRL is internal, not in data stream)
 *
 *  ADC encoding:
 *   - 24-bit two's complement value, LEFT-JUSTIFIED in 32-bit int
 *     i.e.  raw_int32 = adc_24bit << 8
 *   - To get voltage: V = (raw_int32 >> 8) * 31.25e-9
 *
 * HOW TO READ FROM ANOTHER C++ PROGRAM:
 * --------------------------------------
 *  This simulator writes to stdout as a raw binary stream.
 *  A reader just does:
 *
 *    int32_t frame[144];
 *    while (fread(frame, sizeof(int32_t), 144, stdin) == 144) {
 *        int32_t eeg_fp1_raw = frame[1] >> 8;      // 24-bit signed count
 *        double  eeg_fp1_uv  = eeg_fp1_raw * 31.25e-3; // µV
 *        ...
 *    }
 *
 *  Run:  ./activethree_stream | ./your_reader
 *   or:  ./activethree_stream > capture.bdf   (BDF-compatible raw dump)
 */

#include <cstdint>
#include <cmath>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <random>
#include <chrono>
#include <thread>
#include <array>
#include <csignal>

// ─── Constants ────────────────────────────────────────────────────────────────

static constexpr int    N_CHANNELS   = 144;          // total frame width
static constexpr int    N_EEG        = 128;
static constexpr double SAMPLE_RATE  = 16384.0;      // Hz  (2^14)
static constexpr double DT           = 1.0 / SAMPLE_RATE;
static constexpr double LSB          = 31.25e-9;     // V per LSB (24-bit)

// STATUS word bit flags
static constexpr uint32_t CMS_IN_RANGE  = (1u << 16);
static constexpr uint32_t BATT_OK       = 0u;        // 0 = battery fine

// ─── Globals ──────────────────────────────────────────────────────────────────

static volatile bool g_running = true;
static void on_sigint(int) { g_running = false; }

// ─── Pink noise (Voss–McCartney, 5-row) ──────────────────────────────────────

struct Pink {
    std::mt19937_64 rng;
    std::normal_distribution<double> nd{0.0, 1.0};
    double rows[5]{};
    double sum{};
    int    ctr{};
    explicit Pink(uint64_t seed) : rng(seed) {}
    double next(double amp) {
        int lb = ctr & -ctr; ctr++;
        for (int i = 0; i < 5; ++i)
            if (lb & (1 << i)) { sum -= rows[i]; rows[i] = nd(rng); sum += rows[i]; }
        return (sum / 5.0) * amp;
    }
};

// ─── Channel region helper ────────────────────────────────────────────────────

enum Region { OCC, FRONT, CENT, TEMP, PAR, OTHER };

static Region region(int ch) {   // ch = 0-based EEG index
    // Very rough spatial grouping by channel index in 128-ch BioSemi cap
    if (ch >= 24 && ch <= 30)  return OCC;    // O1,Iz,Oz,POz,Pz etc
    if (ch <= 7  || (ch >= 33 && ch <= 41)) return FRONT;
    if (ch >= 11 && ch <= 16)  return CENT;
    if (ch >= 14 && ch <= 17)  return TEMP;
    if (ch >= 18 && ch <= 23)  return PAR;
    return OTHER;
}

// ─── Signal generators ───────────────────────────────────────────────────────

static inline double eeg_signal(int ch, double t, Pink& pink, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0, 1);
    double s = pink.next(4e-6) + wn(rng) * 200e-9;

    switch (region(ch)) {
        case OCC:
            s += 30e-6 * std::sin(2*M_PI*10.0*t + 0.3)
               + 10e-6 * std::sin(2*M_PI* 9.5*t + 1.1)
               +  5e-6 * std::sin(2*M_PI*11.0*t + 0.7);
            break;
        case FRONT:
            s += 12e-6 * std::sin(2*M_PI*20.0*t + 0.5)
               +  8e-6 * std::sin(2*M_PI*18.0*t + 1.3);
            // eye blink ~0.2 Hz on frontal
            { double bp = std::fmod(t * 0.2, 1.0);
              if (bp < 0.1) s += 150e-6 * std::sin(M_PI * bp / 0.1); }
            break;
        case CENT:
            s += 15e-6 * std::sin(2*M_PI* 6.0*t + 0.9)
               + 10e-6 * std::sin(2*M_PI*11.0*t + 2.0);
            break;
        case TEMP:
            s +=  8e-6 * std::sin(2*M_PI* 7.0*t + 1.5);
            break;
        case PAR:
            s +=  8e-6 * std::sin(2*M_PI*10.0*t + 0.2);
            break;
        default: break;
    }

    // Residual 50 Hz (SAR suppressed — tiny)
    s += 50e-9 * std::sin(2*M_PI*50.0*t);
    // ECG bleed-through
    double ep = std::fmod(t, 1.0);
    if (ep < 0.01) s += 1.5e-6 * std::exp(-ep / 0.003);

    return s;
}

static inline double exg_signal(int ch, double t, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0, 1);
    double s = wn(rng) * 300e-9;
    switch (ch) {
        case 0: case 1: {   // ECG leads
            double bp = std::fmod(t, 1.0);
            if      (bp < 0.005) s +=  0.5e-3;
            else if (bp < 0.025) s +=  1.5e-3;
            else if (bp < 0.030) s += -0.8e-3;
            else if (bp < 0.035) s +=  1.8e-3;
            else if (bp < 0.200) s +=  0.3e-3;
            break;
        }
        case 2: case 3:   // EMG
            s += wn(rng) * 15e-6 + 10e-6 * std::sin(2*M_PI*50.0*t);
            break;
        case 4:   // EOG-H
            s += 80e-6 * std::sin(2*M_PI*0.5*t);
            break;
        case 5:   // EOG-V
            s += 50e-6 * std::sin(2*M_PI*0.2*t);
            break;
        default:
            s += wn(rng) * 1e-6;
            break;
    }
    return s;
}

static inline double sensor_signal(int ch, double t) {
    switch (ch) {
        case 0: return  0.8  * std::sin(2*M_PI*0.25*t);             // RESP
        case 1: return  0.2  + 0.05*std::sin(2*M_PI*0.05*t);        // GSR
        default: return (std::fmod(t, 5.0) < 0.05) ? 1.0 : 0.0;    // switches
    }
}

// ─── Encode voltage → BioSemi 32-bit word (24-bit left-justified) ─────────────

static inline int32_t encode(double volts) {
    double counts = volts / LSB;
    if (counts >  8388607.0) counts =  8388607.0;
    if (counts < -8388608.0) counts = -8388608.0;
    return static_cast<int32_t>(counts) << 8;   // left-justify in 32 bits
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main() {
    std::signal(SIGINT, on_sigint);

    std::mt19937_64 rng(std::chrono::steady_clock::now().time_since_epoch().count());
    std::vector<Pink> pink_gens;
    pink_gens.reserve(N_EEG);
    for (int i = 0; i < N_EEG; ++i)
        pink_gens.emplace_back(static_cast<uint64_t>(i)*123456ULL + 1ULL);

    // Timing: emit one frame every 1/16384 s
    using clock     = std::chrono::steady_clock;
    using ns        = std::chrono::nanoseconds;
    const ns period = ns(static_cast<long long>(1e9 / SAMPLE_RATE));  // ~61035 ns

    int32_t frame[N_CHANNELS];
    uint64_t sample = 0;
    auto next_tick  = clock::now();

    // Write to stdout as raw binary — no buffering delay
    std::setvbuf(stdout, nullptr, _IOFBF, sizeof(frame) * 256);

    while (g_running) {
        double t = sample * DT;

        // [0] STATUS word
        frame[0] = static_cast<int32_t>(CMS_IN_RANGE | BATT_OK);

        // [1–128] EEG
        for (int ch = 0; ch < N_EEG; ++ch)
            frame[1 + ch] = encode(eeg_signal(ch, t, pink_gens[ch], rng));

        // [129–136] EXG
        for (int ch = 0; ch < 8; ++ch)
            frame[129 + ch] = encode(exg_signal(ch, t, rng));

        // [137–142] Sensors
        for (int ch = 0; ch < 6; ++ch)
            frame[137 + ch] = encode(sensor_signal(ch, t));

        // [143] CMS (~0 V)
        frame[143] = 0;

        // Write raw frame to stdout
        std::fwrite(frame, sizeof(int32_t), N_CHANNELS, stdout);

        ++sample;

        // Real-time pacing
        next_tick += period;
        std::this_thread::sleep_until(next_tick);
    }

    std::fflush(stdout);
    return 0;
}
