/*
 * BioSemi ActiveThree Simulator
 * ==============================
 * Simulates the output of a BioSemi ActiveThree 128-channel EEG/EXG system:
 *   - 128 EEG + 8 EXG + 6 sensor channels (142 total)
 *   - 24-bit SAR ADC per channel
 *   - LSB resolution: 31.25 nV
 *   - Full range: ±200 mV (400 mVpp)
 *   - Sample rate: 16,384 Hz (2^14, BioSemi standard)
 *   - DC-coupled, full DC operation
 *   - Auxiliary sensors: respiration, GSR/EDA, response switches
 *   - CMS/DRL channels included
 *
 * Output format mirrors BioSemi's 32-bit signed integer per channel per sample
 * (24-bit ADC value stored in upper 24 bits of a 32-bit int, as per BioSemi protocol).
 *
 * Simulated signals:
 *   - Alpha rhythm (8–12 Hz) dominant on occipital channels (O1, Oz, O2)
 *   - Beta rhythm (13–30 Hz) on frontal channels
 *   - Theta (4–8 Hz) on central channels
 *   - 1/f noise (pink noise approximation) as background
 *   - EOG artifact on channels Fp1, Fp2 (slow eye blinks ~0.2 Hz)
 *   - ECG artifact bleed-through (60 bpm)
 *   - 50 Hz power line noise (very low amplitude, as SAR ADC suppresses well)
 *   - Respiration belt: sinusoidal ~0.25 Hz
 *   - GSR/EDA: slow drift with phasic component
 *   - CMS/DRL: near-zero (common mode / driven right leg)
 */

#include <iostream>
#include <fstream>
#include <vector>
#include <string>
#include <cmath>
#include <random>
#include <iomanip>
#include <chrono>
#include <array>

// ─── Device Constants ────────────────────────────────────────────────────────

static constexpr int    NUM_EEG_CHANNELS   = 128;
static constexpr int    NUM_EXG_CHANNELS   = 8;
static constexpr int    NUM_SENSOR_CHANNELS = 6;   // resp, GSR, 4x response switch
static constexpr int    NUM_CHANNELS_TOTAL  = NUM_EEG_CHANNELS + NUM_EXG_CHANNELS + NUM_SENSOR_CHANNELS + 2; // +CMS +DRL
static constexpr int    ADC_BITS           = 24;
static constexpr double LSB_VOLTS          = 31.25e-9;          // 31.25 nV per LSB
static constexpr double FULL_RANGE_V       = 0.400;             // 400 mVpp → ±200 mV
static constexpr double SAMPLE_RATE_HZ     = 16384.0;           // 2^14 Hz
static constexpr int    ADC_MAX            = (1 << (ADC_BITS - 1)) - 1;  // 8,388,607
static constexpr int    ADC_MIN            = -(1 << (ADC_BITS - 1));      // -8,388,608

// ─── Channel Labels (10-20 + extended) ───────────────────────────────────────

const std::array<std::string, 128> EEG_LABELS = {{
    "Fp1","AF7","AF3","F1","F3","F5","F7","FT7",
    "FC5","FC3","FC1","C1","C3","C5","T7","TP7",
    "CP5","CP3","CP1","P1","P3","P5","P7","P9",
    "PO7","PO3","O1","Iz","Oz","POz","Pz","CPz",
    "Fpz","Fp2","AF8","AF4","AFz","Fz","F2","F4",
    "F6","F8","FT8","FC6","FC4","FC2","FCz","Cz",
    "C2","C4","C6","T8","TP8","CP6","CP4","CP2",
    "P2","P4","P6","P8","P10","PO8","PO4","O2",
    "EEG065","EEG066","EEG067","EEG068","EEG069","EEG070","EEG071","EEG072",
    "EEG073","EEG074","EEG075","EEG076","EEG077","EEG078","EEG079","EEG080",
    "EEG081","EEG082","EEG083","EEG084","EEG085","EEG086","EEG087","EEG088",
    "EEG089","EEG090","EEG091","EEG092","EEG093","EEG094","EEG095","EEG096",
    "EEG097","EEG098","EEG099","EEG100","EEG101","EEG102","EEG103","EEG104",
    "EEG105","EEG106","EEG107","EEG108","EEG109","EEG110","EEG111","EEG112",
    "EEG113","EEG114","EEG115","EEG116","EEG117","EEG118","EEG119","EEG120",
    "EEG121","EEG122","EEG123","EEG124","EEG125","EEG126","EEG127","EEG128"
}};

const std::array<std::string, 8> EXG_LABELS = {{
    "EXG1(ECG-L)","EXG2(ECG-R)","EXG3(EMG-L)","EXG4(EMG-R)",
    "EXG5(EOG-H)","EXG6(EOG-V)","EXG7(AUX1)","EXG8(AUX2)"
}};

const std::array<std::string, 6> SENSOR_LABELS = {{
    "RESP","GSR","SWITCH1","SWITCH2","SWITCH3","SWITCH4"
}};

// ─── Utility: clamp to 24-bit signed range ───────────────────────────────────

inline int32_t clamp24(double volts) {
    double lsb_count = volts / LSB_VOLTS;
    if (lsb_count > ADC_MAX) return ADC_MAX;
    if (lsb_count < ADC_MIN) return ADC_MIN;
    return static_cast<int32_t>(lsb_count);
}

// ─── Pink noise generator (Voss–McCartney algorithm, 5-row) ──────────────────

class PinkNoise {
    std::mt19937_64 rng_;
    std::normal_distribution<double> dist_{0.0, 1.0};
    double rows_[5]{};
    double running_sum_{0.0};
    int    counter_{0};
public:
    explicit PinkNoise(uint64_t seed = 42) : rng_(seed) {}
    double next(double amplitude_v = 5e-6) {
        int last_bit = counter_ & -counter_;
        counter_++;
        for (int i = 0; i < 5; ++i) {
            if (last_bit & (1 << i)) {
                running_sum_ -= rows_[i];
                rows_[i] = dist_(rng_);
                running_sum_ += rows_[i];
            }
        }
        return (running_sum_ / 5.0) * amplitude_v;
    }
};

// ─── Per-channel signal model ─────────────────────────────────────────────────

enum class Region { OCCIPITAL, FRONTAL, CENTRAL, TEMPORAL, PARIETAL, OTHER };

Region channel_region(const std::string& label) {
    if (label.find('O') != std::string::npos) return Region::OCCIPITAL;
    if (label[0] == 'F' && label[1] != 'C' && label[1] != 'T') return Region::FRONTAL;
    if (label[0] == 'C' || label.find("FC") != std::string::npos) return Region::CENTRAL;
    if (label[0] == 'T' || label.find("TP") != std::string::npos) return Region::TEMPORAL;
    if (label[0] == 'P') return Region::PARIETAL;
    return Region::OTHER;
}

double eeg_signal(const std::string& label, double t, PinkNoise& noise, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0.0, 1.0);
    Region reg = channel_region(label);

    double sig = noise.next(4e-6);  // pink noise baseline ~4 µV rms

    // White noise floor (instrument noise ~ few nV rms, elevated here for realism)
    sig += wn(rng) * 200e-9;

    switch (reg) {
        case Region::OCCIPITAL:
            // Alpha 10 Hz dominant, ~20–50 µV amplitude
            sig += 30e-6 * std::sin(2 * M_PI * 10.0 * t + 0.3);
            sig += 10e-6 * std::sin(2 * M_PI * 9.5  * t + 1.1);
            sig +=  5e-6 * std::sin(2 * M_PI * 11.0 * t + 0.7);
            break;
        case Region::FRONTAL:
            // Beta 18–25 Hz, lower amplitude ~10–20 µV
            sig += 12e-6 * std::sin(2 * M_PI * 20.0 * t + 0.5);
            sig +=  8e-6 * std::sin(2 * M_PI * 18.0 * t + 1.3);
            // EOG blink artifact on Fp1/Fp2 (~0.2 Hz, large amplitude)
            if (label == "Fp1" || label == "Fp2" || label == "Fpz") {
                double blink_phase = std::fmod(t * 0.2, 1.0);
                if (blink_phase < 0.1)
                    sig += 150e-6 * std::sin(M_PI * blink_phase / 0.1);
            }
            break;
        case Region::CENTRAL:
            // Theta 5–7 Hz + mu rhythm ~10–12 Hz
            sig += 15e-6 * std::sin(2 * M_PI * 6.0  * t + 0.9);
            sig += 10e-6 * std::sin(2 * M_PI * 11.0 * t + 2.0);
            break;
        case Region::TEMPORAL:
            sig += 10e-6 * std::sin(2 * M_PI * 7.0  * t + 1.5);
            break;
        case Region::PARIETAL:
            sig +=  8e-6 * std::sin(2 * M_PI * 10.0 * t + 0.2);
            break;
        default:
            break;
    }

    // Residual 50 Hz power line (very small — SAR ADC suppresses well)
    sig += 50e-9 * std::sin(2 * M_PI * 50.0 * t);

    // ECG bleed-through from body ~60 bpm = 1 Hz, sharp QRS spike
    double ecg_phase = std::fmod(t, 1.0 / 1.0);  // 1 beat/s
    if (ecg_phase < 0.01)
        sig += 2e-6 * std::exp(-ecg_phase / 0.003);

    return sig;
}

// ─── EXG channel signals ──────────────────────────────────────────────────────

double exg_signal(int ch_idx, double t, std::mt19937_64& rng) {
    std::normal_distribution<double> wn(0.0, 1.0);
    double sig = wn(rng) * 300e-9;

    switch (ch_idx) {
        case 0: case 1: {  // ECG lead I / II
            double beat_phase = std::fmod(t, 1.0);
            double qrs = 0.0;
            if (beat_phase < 0.005)       qrs =  0.5e-3;  // P wave
            else if (beat_phase < 0.025)  qrs =  1.5e-3;  // QRS complex
            else if (beat_phase < 0.030)  qrs = -0.8e-3;
            else if (beat_phase < 0.035)  qrs =  1.8e-3;
            else if (beat_phase < 0.200)  qrs =  0.3e-3;  // T wave
            sig += qrs;
            break;
        }
        case 2: case 3: {  // EMG left/right forearm
            // Broadband muscle noise 20–500 Hz
            sig += wn(rng) * 15e-6;
            sig += 10e-6 * std::sin(2 * M_PI * 50.0 * t);
            break;
        }
        case 4: {  // EOG horizontal
            double saccade = std::sin(2 * M_PI * 0.5 * t) * 80e-6;
            sig += saccade;
            break;
        }
        case 5: {  // EOG vertical
            sig += 50e-6 * std::sin(2 * M_PI * 0.2 * t);
            break;
        }
        default:
            sig += wn(rng) * 1e-6;
            break;
    }
    return sig;
}

// ─── Sensor channel signals ───────────────────────────────────────────────────

double sensor_signal(int ch_idx, double t) {
    switch (ch_idx) {
        case 0:  // Respiration: ~0.25 Hz sinusoid, ±1 V range (belt sensor)
            return 0.8 * std::sin(2 * M_PI * 0.25 * t);
        case 1:  // GSR/EDA: slow tonic drift + phasic response
            return 0.2 + 0.05 * std::sin(2 * M_PI * 0.05 * t)
                       + 0.02 * std::exp(-std::fmod(t, 10.0) / 1.5);
        case 2: case 3: case 4: case 5:  // Response switches: digital 0/1
            return (std::fmod(t, 5.0) < 0.05) ? 1.0 : 0.0;
        default:
            return 0.0;
    }
}

// ─── Print header ─────────────────────────────────────────────────────────────

void print_device_info() {
    std::cout << "╔══════════════════════════════════════════════════════════════╗\n";
    std::cout << "║       BioSemi ActiveThree — Simulated Output Stream          ║\n";
    std::cout << "╠══════════════════════════════════════════════════════════════╣\n";
    std::cout << "║  Channels   : " << std::setw(3) << NUM_CHANNELS_TOTAL << " total"
              << "  (128 EEG + 8 EXG + 6 sensor + CMS/DRL)  ║\n";
    std::cout << "║  ADC        : 24-bit SAR per channel                         ║\n";
    std::cout << "║  LSB        : 31.25 nV                                       ║\n";
    std::cout << "║  Range      : ±200 mV (400 mVpp, DC-coupled)                 ║\n";
    std::cout << "║  Sample rate: 16,384 Hz                                      ║\n";
    std::cout << "║  Output     : 32-bit signed integer (ADC counts) per channel  ║\n";
    std::cout << "╚══════════════════════════════════════════════════════════════╝\n\n";
}

// ─── CSV writer ───────────────────────────────────────────────────────────────

void write_csv_header(std::ofstream& f) {
    f << "Sample,Time_s";
    for (auto& l : EEG_LABELS)    f << "," << l;
    for (auto& l : EXG_LABELS)    f << "," << l;
    for (auto& l : SENSOR_LABELS) f << "," << l;
    f << ",CMS,DRL\n";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {

    print_device_info();

    // Simulation parameters
    const double duration_s   = (argc > 1) ? std::stod(argv[1]) : 5.0;
    const int    total_samples = static_cast<int>(duration_s * SAMPLE_RATE_HZ);
    const double dt            = 1.0 / SAMPLE_RATE_HZ;

    std::cout << "Simulating " << duration_s << " seconds → "
              << total_samples << " samples @ " << SAMPLE_RATE_HZ << " Hz\n\n";

    // RNG
    std::mt19937_64 rng(std::chrono::steady_clock::now().time_since_epoch().count());

    // One pink noise generator per EEG channel
    std::vector<PinkNoise> pink_gens;
    pink_gens.reserve(NUM_EEG_CHANNELS);
    for (int i = 0; i < NUM_EEG_CHANNELS; ++i)
        pink_gens.emplace_back(static_cast<uint64_t>(i) * 1234567ULL + 42ULL);

    // Output CSV
    const std::string csv_path = "activethree_output.csv";
    std::ofstream csv(csv_path);
    write_csv_header(csv);

    // Console: print first 5 samples as a preview table
    const int PREVIEW_SAMPLES = 5;
    std::cout << "=== First " << PREVIEW_SAMPLES << " samples (ADC counts) — console preview ===\n";
    std::cout << std::left << std::setw(8) << "Sample"
              << std::setw(10) << "Time(s)"
              << std::setw(12) << "Fp1"
              << std::setw(12) << "Oz"
              << std::setw(12) << "Cz"
              << std::setw(14) << "ECG-L(EXG1)"
              << std::setw(12) << "RESP"
              << std::setw(10) << "GSR"
              << std::setw(8) << "CMS"
              << "DRL\n";
    std::cout << std::string(98, '-') << "\n";

    // Main simulation loop
    for (int s = 0; s < total_samples; ++s) {
        const double t = s * dt;

        csv << s << "," << std::fixed << std::setprecision(6) << t;

        std::vector<int32_t> sample_vals;
        sample_vals.reserve(NUM_CHANNELS_TOTAL);

        // EEG channels
        for (int ch = 0; ch < NUM_EEG_CHANNELS; ++ch) {
            double v = eeg_signal(EEG_LABELS[ch], t, pink_gens[ch], rng);
            int32_t adc = clamp24(v);
            sample_vals.push_back(adc);
            csv << "," << adc;
        }

        // EXG channels
        for (int ch = 0; ch < NUM_EXG_CHANNELS; ++ch) {
            double v = exg_signal(ch, t, rng);
            int32_t adc = clamp24(v);
            sample_vals.push_back(adc);
            csv << "," << adc;
        }

        // Sensor channels (non-EEG scale: stored in raw sensor units × LSB approximation)
        for (int ch = 0; ch < NUM_SENSOR_CHANNELS; ++ch) {
            double v = sensor_signal(ch, t);
            int32_t adc = clamp24(v);
            sample_vals.push_back(adc);
            csv << "," << adc;
        }

        // CMS (common mode sense) — should be ~0 in ideal case
        int32_t cms = clamp24(0.0);
        // DRL (driven right leg) — ~0 V, slight noise
        std::normal_distribution<double> cms_noise(0.0, 50e-9);
        int32_t drl = clamp24(cms_noise(rng));
        csv << "," << cms << "," << drl << "\n";

        // Console preview
        if (s < PREVIEW_SAMPLES) {
            int fp1_idx = 0;   // Fp1
            int oz_idx  = 26;  // O1 ~Oz
            int cz_idx  = 47;  // Cz
            int ecg_idx = NUM_EEG_CHANNELS + 0;
            int resp_idx = NUM_EEG_CHANNELS + NUM_EXG_CHANNELS + 0;
            int gsr_idx  = NUM_EEG_CHANNELS + NUM_EXG_CHANNELS + 1;

            std::cout << std::left
                      << std::setw(8)  << s
                      << std::setw(10) << std::fixed << std::setprecision(6) << t
                      << std::setw(12) << sample_vals[fp1_idx]
                      << std::setw(12) << sample_vals[oz_idx]
                      << std::setw(12) << sample_vals[cz_idx]
                      << std::setw(14) << sample_vals[ecg_idx]
                      << std::setw(12) << sample_vals[resp_idx]
                      << std::setw(10) << sample_vals[gsr_idx]
                      << std::setw(8)  << cms
                      << drl << "\n";
        }
    }

    csv.close();

    std::cout << "\n" << std::string(98, '=') << "\n";
    std::cout << "Simulation complete.\n";
    std::cout << "  Total samples : " << total_samples << "\n";
    std::cout << "  Channels      : " << NUM_CHANNELS_TOTAL << "\n";
    std::cout << "  ADC range     : [" << ADC_MIN << ", " << ADC_MAX << "]\n";
    std::cout << "  LSB           : " << LSB_VOLTS * 1e9 << " nV\n";
    std::cout << "  Output CSV    : " << csv_path << "\n";
    std::cout << "\nTo convert ADC counts → microvolts:  µV = ADC_count × 31.25 × 1e-3\n";
    std::cout << "To convert ADC counts → millivolts:  mV = ADC_count × 31.25 × 1e-6\n";

    return 0;
}
