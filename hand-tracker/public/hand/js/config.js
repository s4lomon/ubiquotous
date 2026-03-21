// ============================================
// CONFIGURATION CONSTANTS
// ============================================

// Muse Bluetooth Configuration
const MUSE_SERVICE = '0000fe8d-0000-1000-8000-00805f9b34fb';
const CONTROL_CHAR = '273e0001-4c4d-454d-96be-f03bac821358';
const EEG_CHARS = {
    TP9: '273e0003-4c4d-454d-96be-f03bac821358',
    AF7: '273e0004-4c4d-454d-96be-f03bac821358',
    AF8: '273e0005-4c4d-454d-96be-f03bac821358',
    TP10: '273e0006-4c4d-454d-96be-f03bac821358'
};

// Blink Detection Thresholds
const BLINK_THRESHOLD = 200; // Significant change threshold (µV)
const BLINK_MIN_DERIVATIVE = 50; // Rate of change
const BLINK_REFRACTORY = 600; // ms between blinks
const SIGNAL_QUALITY_THRESHOLD = 0.6; // Minimum signal quality
const EYE_DOMINANCE_RATIO = 2.0; // Dominant channel must be 2x stronger

// Signal Processing
const FFT_SIZE = 256;
const SAMPLE_RATE = 256;
const BLINK_BUFFER_SIZE = 200;

// Hand Tracking Thresholds
const SELECTION_DWELL_TIME = 500; // 0.5 seconds to select
const DESELECTION_SPEED_THRESHOLD = 300; // pixels per second
const SPEED_SMOOTHING = 10; // frames for speed averaging

// Game Configuration
const DICE_SIZE = 100;

// Channel Colors for Visualization
const CHANNEL_COLORS = {
    TP9: { r: 147, g: 51, b: 234 },   // Purple
    AF7: { r: 34, g: 197, b: 94 },     // Green
    AF8: { r: 59, g: 130, b: 246 },    // Blue
    TP10: { r: 249, g: 115, b: 22 }    // Orange
};