// ============================================
// UI CONTROLS
// ============================================

/**
 * Toggle wave visibility
 */
function toggleWaveVisibility() {
    window.wavesVisible = !window.wavesVisible;
    const panel = document.getElementById('wavesPanel');
    const btn = document.getElementById('toggleWaves');
    
    if (window.wavesVisible) {
        panel.style.display = 'block';
        btn.textContent = '👁️ Hide Waves';
    } else {
        panel.style.display = 'none';
        btn.textContent = '👁️ Show Waves';
    }
}

/**
 * Toggle fake data mode
 */
function toggleFakeData() {
    window.fakeMode = !window.fakeMode;
    const btn = document.getElementById('fakeDataBtn');
    
    if (window.fakeMode) {
        btn.textContent = '⏹️ Stop Demo';
        document.getElementById('museIndicator').className = 'w-3 h-3 rounded-full bg-yellow-500 animate-pulse';
        updateStatus('Demo mode');
        startFakeData();
    } else {
        btn.textContent = '🎭 Demo Mode';
        document.getElementById('museIndicator').className = 'w-3 h-3 rounded-full bg-red-500';
        updateStatus('Ready');
        stopFakeData();
    }
}

/**
 * Start generating fake data for demo
 */
function startFakeData() {
    let blinkTimer = 0;
    let angle = 0;
    
    window.fakeInterval = setInterval(() => {
        const time = Date.now() / 1000;
        
        // Set fake signal quality
        window.signalQuality = 0.9;
        window.channelNoise = { TP9: 8, AF7: 7, AF8: 8, TP10: 9 };
        
        // Update channel status indicators
        ['TP9', 'AF7', 'AF8', 'TP10'].forEach(ch => {
            document.getElementById(`${ch.toLowerCase()}-status`).className = 'w-2 h-2 rounded-full bg-green-500';
            document.getElementById(`${ch.toLowerCase()}-noise`).textContent = window.channelNoise[ch].toFixed(1) + 'µV';
        });
        
        // Update quality display
        document.getElementById('qualityBar').style.width = '90%';
        document.getElementById('signalText').textContent = '90%';
        document.getElementById('signalQuality').className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
        
        // Generate fake brainwaves
        window.brainwaves = {
            delta: Math.max(0, Math.min(1, 0.25 + Math.sin(time * 0.5) * 0.15)),
            theta: Math.max(0, Math.min(1, 0.30 + Math.sin(time * 0.8) * 0.2)),
            alpha: Math.max(0, Math.min(1, 0.25 + Math.sin(time * 1.2) * 0.2)),
            beta: Math.max(0, Math.min(1, 0.20 + Math.sin(time * 1.8) * 0.15))
        };
        updateBrainwaveDisplay();
        
        // Simulate circular motion
        angle += 0.012;
        const canvas = document.getElementById('gameCanvas');
        window.controlX = canvas.width/2 + Math.cos(angle) * 250;
        window.controlY = canvas.height/2 + Math.sin(angle) * 150;
        window.handSpeed = Math.abs(Math.sin(angle * 5)) * 200;
        document.getElementById('handSpeed').textContent = Math.round(window.handSpeed);
        
        // Generate fake blink signals
        blinkTimer++;
        let af7Val, af8Val;
        if (blinkTimer > 150 && blinkTimer < 165) {
            // Simulate a blink
            af7Val = 350 + Math.random() * 50;
            af8Val = 340 + Math.random() * 50;
        } else if (blinkTimer > 250) {
            blinkTimer = 0;
            af7Val = Math.random() * 10 - 5;
            af8Val = Math.random() * 10 - 5;
        } else {
            af7Val = Math.random() * 10 - 5;
            af8Val = Math.random() * 10 - 5;
        }
        
        // Update blink buffers
        window.blinkSignalBuffer.AF7.push(af7Val);
        window.blinkSignalBuffer.AF8.push(af8Val);
        if (window.blinkSignalBuffer.AF7.length > BLINK_BUFFER_SIZE) {
            window.blinkSignalBuffer.AF7.shift();
            window.blinkSignalBuffer.AF8.shift();
        }
        
        // Update EEG buffers
        window.eegBuffers.AF7.push(af7Val);
        window.eegBuffers.AF8.push(af8Val);
        detectBlink(window.eegBuffers.AF7, window.eegBuffers.AF8);
        
        // Update stream buffers for all channels
        ['TP9', 'AF7', 'AF8', 'TP10'].forEach(ch => {
            const val = (ch === 'AF7' ? af7Val : ch === 'AF8' ? af8Val : Math.random() * 10 - 5);
            window.channelStreamBuffers[ch].push(val);
            if (window.channelStreamBuffers[ch].length > window.streamBufferSize) {
                window.channelStreamBuffers[ch].shift();
            }
        });
        
    }, 50);
}

/**
 * Stop generating fake data
 */
function stopFakeData() {
    if (window.fakeInterval) {
        clearInterval(window.fakeInterval);
        window.fakeInterval = null;
    }
    window.signalQuality = 0;
    window.channelNoise = { TP9: 0, AF7: 0, AF8: 0, TP10: 0 };
}

/**
 * Update status message
 */
function updateStatus(msg) {
    document.getElementById('statusText').textContent = msg;
}