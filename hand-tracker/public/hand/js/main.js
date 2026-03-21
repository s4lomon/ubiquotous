// ============================================
// MAIN APPLICATION
// ============================================

// Global State
window.device = null;
window.server = null;
window.museConnected = false;
window.fakeMode = false;
window.fakeInterval = null;
window.wavesVisible = true;

// Hand tracking state
window.handTrackingActive = false;
window.hands = null;
window.camera = null;
window.usingHand = false;
window.handDetected = false;
window.lastHandPosition = { x: 0, y: 0 };
window.handPositionHistory = [];
window.handSpeed = 0;
window.lastHandRotation = 0;
window.handRotationHistory = [];
window.rotationGestureDetected = false;
window.lastRotationGestureTime = 0;

// EEG buffers
window.eegBuffers = { TP9: [], AF7: [], AF8: [], TP10: [] };
window.rawBuffers = { TP9: [], AF7: [], AF8: [], TP10: [] };
window.sensorLastUpdate = { TP9: 0, AF7: 0, AF8: 0, TP10: 0 };

// Brainwaves
window.brainwaves = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
window.totalBlinks = 0;
window.lastBlinkTime = 0;

// Blink signal buffers
window.blinkSignalBuffer = { AF7: [], AF8: [] };

// Channel streaming buffers (for visualization)
window.timeScale = 8; // seconds
window.streamBufferSize = window.timeScale * SAMPLE_RATE; // samples
window.amplitudeScale = 1500; // µV - adjustable
window.filterStrength = 5; // 0-10, higher = more filtering
window.channelStreamBuffers = {
    TP9: [],
    AF7: [],
    AF8: [],
    TP10: []
};

// Dice flash state
window.diceFlashUntil = 0;

// Signal quality
window.signalQuality = 0;
window.channelNoise = { TP9: 0, AF7: 0, AF8: 0, TP10: 0 };

// Control position
window.controlX = 0;
window.controlY = 0;

// Game State - dice positions
window.dice = [
    { x: 300, y: 350, value: 1, spinning: false, selected: false, spinSpeed: 0, rotation: 0, dwellTime: 0 },
    { x: 600, y: 350, value: 1, spinning: false, selected: false, spinSpeed: 0, rotation: 0, dwellTime: 0 },
    { x: 900, y: 350, value: 1, spinning: false, selected: false, spinSpeed: 0, rotation: 0, dwellTime: 0 }
];
window.totalSpins = 0;

/**
 * Initialize the application
 */
function initializeApp() {
    // Setup event listeners for buttons
    document.getElementById('startHand').addEventListener('click', startHandTracking);
    document.getElementById('connectBtn').addEventListener('click', connectMuse);
    document.getElementById('toggleWaves').addEventListener('click', toggleWaveVisibility);
    document.getElementById('fakeDataBtn').addEventListener('click', toggleFakeData);
    
    // Setup slider event listeners
    document.getElementById('amplitudeSlider').addEventListener('input', updateAmplitudeScale);
    document.getElementById('filterSlider').addEventListener('input', updateFilterStrength);
    document.getElementById('timeScaleSelect').addEventListener('change', updateTimeScale);
    
    // Setup mouse control
    setupMouseControl();
    
    // Start game loop
    drawGame();
    
    // Start EEG visualization loop
    drawAllChannels();
    
    // Initial status
    updateStatus('Use mouse or click "Start Hand Tracking"');
    
    console.log('🎮 Hand-Controlled Mind Dice initialized');
    console.log('👋 Click "Start Hand Tracking" to use hand control');
    console.log('🧠 Click "Connect Muse" to connect EEG headband');
    console.log('🎭 Click "Demo Mode" to see fake data');
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}