/*
 * activethree_reader.cpp
 * ----------------------
 * Reads the raw binary stream from activethree_stream and prints
 * real-time human-readable values to terminal.
 *
 * Usage:
 *   ./activethree_stream | ./activethree_reader
 *
 * Or from a captured file:
 *   ./activethree_reader < capture.bin
 */

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <csignal>
#include <string>

static constexpr int    N_CH     = 144;
static constexpr double LSB_UV   = 31.25e-3;   // µV per LSB count (31.25 nV → µV)
static constexpr double LSB_MV   = 31.25e-6;   // mV per LSB count

// Print every Nth frame to keep terminal readable (1 = every sample, 256 = ~64 Hz display)
static constexpr int PRINT_EVERY = 512;        // ~32 Hz display rate

static volatile bool g_run = true;
static void on_sigint(int) { g_run = false; }

int main() {
    std::signal(SIGINT, on_sigint);
    std::setvbuf(stdin, nullptr, _IOFBF, N_CH * sizeof(int32_t) * 256);

    int32_t frame[N_CH];
    uint64_t sample = 0;

    // Header
    std::printf("\033[2J\033[H");  // clear screen
    std::printf("BioSemi ActiveThree — Live Stream Reader\n");
    std::printf("========================================\n");
    std::printf("Decoding: 144 ch × int32 (24-bit left-justified), LSB=31.25nV\n");
    std::printf("Press Ctrl+C to stop.\n\n");

    std::printf("%-10s %-8s %-10s %-10s %-10s %-10s %-12s %-10s %-10s %-8s\n",
                "Sample", "Time(s)",
                "Fp1(µV)", "Oz(µV)", "Cz(µV)",
                "ECG(mV)", "EOG-H(µV)",
                "RESP(V)", "GSR(V)", "STATUS");
    std::printf("%s\n", std::string(102, '-').c_str());

    while (g_run) {
        size_t n = std::fread(frame, sizeof(int32_t), N_CH, stdin);
        if (n != N_CH) break;

        if (sample % PRINT_EVERY == 0) {
            double t = sample / 16384.0;

            // Decode: raw int32 is 24-bit left-justified → shift right 8 to get ADC count
            auto adc = [&](int idx) -> int32_t { return frame[idx] >> 8; };

            double fp1   = adc(1)   * LSB_UV;   // EEG ch 1
            double oz    = adc(25)  * LSB_UV;   // EEG ch 25 (occipital-ish)
            double cz    = adc(47)  * LSB_UV;   // EEG ch 47 (central-ish)
            double ecg   = adc(129) * LSB_MV;   // EXG ch 1 (ECG-L)
            double eog_h = adc(133) * LSB_UV;   // EXG ch 5 (EOG-H)
            double resp  = adc(137) * 31.25e-9; // sensor RESP (in volts)
            double gsr   = adc(138) * 31.25e-9; // sensor GSR  (in volts)
            uint32_t status = static_cast<uint32_t>(frame[0]);
            bool cms_ok = (status >> 16) & 1;

            std::printf("%-10llu %-8.3f %-10.2f %-10.2f %-10.2f %-10.4f %-12.2f %-10.4f %-10.4f %-8s\n",
                        (unsigned long long)sample, t,
                        fp1, oz, cz, ecg, eog_h,
                        resp, gsr,
                        cms_ok ? "CMS_OK" : "CMS_ERR");
            std::fflush(stdout);
        }

        ++sample;
    }

    std::printf("\n--- Stream ended. Total samples received: %llu ---\n",
                (unsigned long long)sample);
    return 0;
}
