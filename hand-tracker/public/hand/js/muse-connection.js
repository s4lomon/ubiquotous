// ============================================
// MUSE CONNECTION
// ============================================

/**
 * Connect to Muse headband via Bluetooth
 */
async function connectMuse() {
    if (window.fakeMode) {
        updateStatus('Stop demo mode first');
        return;
    }
    
    try {
        updateStatus('Searching for Muse...');
        window.device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [MUSE_SERVICE] }],
            optionalServices: [MUSE_SERVICE]
        });

        window.device.addEventListener('gattserverdisconnected', onDisconnected);
        window.server = await window.device.gatt.connect();
        const service = await window.server.getPrimaryService(MUSE_SERVICE);

        // Initialize control
        try {
            const control = await service.getCharacteristic(CONTROL_CHAR);
            await control.writeValue(new Uint8Array([0x02, 0x64, 0x0a]));
            await new Promise(r => setTimeout(r, 100));
            await control.writeValue(new Uint8Array([0x02, 0x73, 0x0a]));
        } catch (e) {
            console.warn('Control characteristic error:', e);
        }

        // Subscribe to EEG channels
        for (const [name, uuid] of Object.entries(EEG_CHARS)) {
            try {
                const char = await service.getCharacteristic(uuid);
                await char.startNotifications();
                char.addEventListener('characteristicvaluechanged', (e) => handleEEG(e, name));
            } catch (e) {
                console.warn(`Error with channel ${name}:`, e);
            }
        }

        window.museConnected = true;
        updateStatus('✅ Muse connected!');
        document.getElementById('museIndicator').className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
        document.getElementById('connectBtn').disabled = true;
        
    } catch (error) {
        updateStatus('Connection failed: ' + error.message);
    }
}

/**
 * Handle EEG data from Muse
 */
function handleEEG(event, channel) {
    const value = event.target.value;
    window.sensorLastUpdate[channel] = Date.now();
    
    // Update LED indicator
    document.getElementById(`${channel.toLowerCase()}-led`).className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';
    document.getElementById(`${channel.toLowerCase()}-status`).className = 'w-2 h-2 rounded-full bg-green-500 animate-pulse';

    // Parse samples
    const samples = [];
    for (let i = 0; i < value.byteLength - 1; i += 3) {
        if (i + 2 < value.byteLength) {
            const s1 = (value.getUint8(i) << 4) | (value.getUint8(i + 1) >> 4);
            const s2 = ((value.getUint8(i + 1) & 0x0F) << 8) | value.getUint8(i + 2);
            samples.push(s1, s2);
        }
    }

    // Process samples
    samples.forEach(sample => {
        const voltage = (sample - 2048) * 0.48828125;
        window.rawBuffers[channel].push(voltage);
        if (window.rawBuffers[channel].length > 100) window.rawBuffers[channel].shift();
        window.eegBuffers[channel].push(voltage);
        
        // Add to channel stream buffer for visualization
        window.channelStreamBuffers[channel].push(voltage);
        if (window.channelStreamBuffers[channel].length > window.streamBufferSize) {
            window.channelStreamBuffers[channel].shift();
        }
        
        // Add to blink signal buffer for AF7/AF8
        if (channel === 'AF7' || channel === 'AF8') {
            window.blinkSignalBuffer[channel].push(voltage);
            if (window.blinkSignalBuffer[channel].length > BLINK_BUFFER_SIZE) {
                window.blinkSignalBuffer[channel].shift();
            }
        }
    });

    // Trim EEG buffers
    if (window.eegBuffers[channel].length > FFT_SIZE * 2) {
        window.eegBuffers[channel] = window.eegBuffers[channel].slice(-FFT_SIZE);
    }
    
    // Calculate noise level
    if (window.rawBuffers[channel].length > 50) {
        window.channelNoise[channel] = calculateNoiseLevel(window.rawBuffers[channel].slice(-50));
        document.getElementById(`${channel.toLowerCase()}-noise`).textContent = 
            window.channelNoise[channel].toFixed(1) + 'µV';
    }
    
    // Update signal quality
    window.signalQuality = calculateSignalQuality();
    document.getElementById('qualityBar').style.width = (window.signalQuality * 100) + '%';
    document.getElementById('signalText').textContent = (window.signalQuality * 100).toFixed(0) + '%';
    
    // Update signal quality indicator
    if (window.signalQuality > 0.8) {
        document.getElementById('signalQuality').className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
    } else if (window.signalQuality > 0.5) {
        document.getElementById('signalQuality').className = 'w-3 h-3 rounded-full bg-yellow-500';
    } else {
        document.getElementById('signalQuality').className = 'w-3 h-3 rounded-full bg-red-500';
    }

    // Detect blinks
    if ((channel === 'AF7' || channel === 'AF8') && 
        window.eegBuffers.AF7.length > 100 && 
        window.eegBuffers.AF8.length > 100) {
        detectBlink(window.eegBuffers.AF7, window.eegBuffers.AF8);
    }

    // Process brainwaves
    if (channel === 'AF7' && window.eegBuffers[channel].length >= FFT_SIZE) {
        processBrainwaves();
    }
}

/**
 * Process brainwave frequencies
 */
function processBrainwaves() {
    const channels = Object.values(window.eegBuffers).filter(b => b.length >= FFT_SIZE);
    if (channels.length === 0) return;

    // Average all channels
    const avgBuffer = new Array(FFT_SIZE).fill(0);
    channels.forEach(buffer => {
        for (let i = 0; i < FFT_SIZE; i++) {
            avgBuffer[i] += buffer[buffer.length - FFT_SIZE + i];
        }
    });
    avgBuffer.forEach((val, i) => avgBuffer[i] /= channels.length);

    // Perform FFT
    const fft = performFFT(avgBuffer);
    
    // Calculate band powers
    const delta = getBandPower(fft, 0.5, 4);
    const theta = getBandPower(fft, 4, 8);
    const alpha = getBandPower(fft, 8, 13);
    const beta = getBandPower(fft, 13, 30);
    const gamma = getBandPower(fft, 30, 100);

    const total = delta + theta + alpha + beta + gamma;
    if (total > 0) {
        window.brainwaves = {
            delta: delta / total,
            theta: theta / total,
            alpha: alpha / total,
            beta: beta / total,
            gamma: gamma / total
        };
    }

    updateBrainwaveDisplay();
}

/**
 * Update brainwave display
 */
function updateBrainwaveDisplay() {
    if (!window.wavesVisible) return;
    ['alpha', 'beta', 'theta', 'delta'].forEach(band => {
        const percent = (window.brainwaves[band] * 100);
        document.getElementById(`${band}Bar`).style.width = percent + '%';
        document.getElementById(`${band}Value`).textContent = percent.toFixed(0) + '%';
    });
}

/**
 * Handle disconnection
 */
function onDisconnected() {
    window.museConnected = false;
    updateStatus('Disconnected');
    document.getElementById('museIndicator').className = 'w-3 h-3 rounded-full bg-red-500';
    document.getElementById('connectBtn').disabled = false;
}