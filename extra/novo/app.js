// Muse Trader - Main Application
// Version 12 - Valence-Arousal Emotion Model

// State
let museDevice = null;
let eegChannels = {};
let rawEEG = { TP9: [], AF7: [], AF8: [], TP10: [] };
let brainwaves = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
let totalVoltage = 0;
let isConnected = false;

// Muse Bluetooth UUIDs
const MUSE_SERVICE = 'fe89';  // Shortened UUID
const EEG_CHARACTERISTICS = {
    TP9: '273e0003-4c4d-454d-96be-f03bac821358',
    AF7: '273e0004-4c4d-454d-96be-f03bac821358',
    AF8: '273e0005-4c4d-454d-96be-f03bac821358',
    TP10: '273e0006-4c4d-454d-96be-f03bac821358',
    AUX: '273e0007-4c4d-454d-96be-f03bac821358'
};

// Alternative UUIDs for older Muse models
const MUSE_SERVICE_ALT = '0000fe89-0000-1000-8000-00805f9b34fb';
const EEG_CHARACTERISTICS_ALT = {
    TP9: '00000001-0000-1000-8000-00805f9b34fb',
    AF7: '00000002-0000-1000-8000-00805f9b34fb',
    AF8: '00000003-0000-1000-8000-00805f9b34fb',
    TP10: '00000004-0000-1000-8000-00805f9b34fb'
};

// Wave colors
const waveColors = {
    delta: { r: 107, g: 44, b: 145 },
    theta: { r: 46, g: 92, b: 184 },
    alpha: { r: 45, g: 155, b: 78 },
    beta: { r: 230, g: 126, b: 34 },
    gamma: { r: 192, g: 57, b: 43 }
};

// DOM Elements
const connectBtn = document.getElementById('connectBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const sphereCanvas = document.getElementById('sphereCanvas');
const emotionMap = document.getElementById('emotionMap');

// Connect to Muse
connectBtn.addEventListener('click', async () => {
    if (isConnected) {
        disconnectMuse();
    } else {
        await connectMuse();
    }
});

async function connectMuse() {
    try {
        updateStatus('Searching for Muse headband...', false);
        
        // Request Bluetooth device - allow both Muse S and Muse 2
        const device = await navigator.bluetooth.requestDevice({
            filters: [
                { namePrefix: 'Muse' }
            ],
            optionalServices: [
                MUSE_SERVICE,
                MUSE_SERVICE_ALT,
                '273e0000-4c4d-454d-96be-f03bac821358',  // Control service
                '273e0001-4c4d-454d-96be-f03bac821358'   // Device info
            ]
        });

        updateStatus('Connecting to ' + device.name + '...', false);
        const server = await device.gatt.connect();
        
        updateStatus('Discovering services...', false);
        
        // Try to get services and log what we find
        const services = await server.getPrimaryServices();
        console.log('Available services:', services.map(s => s.uuid));
        
        // Try new Muse S/2 UUIDs first
        let service;
        let characteristics = EEG_CHARACTERISTICS;
        
        try {
            service = await server.getPrimaryService(MUSE_SERVICE);
            console.log('Using Muse 2/S service');
        } catch (e) {
            console.log('Trying alternative service UUID...');
            try {
                service = await server.getPrimaryService(MUSE_SERVICE_ALT);
                characteristics = EEG_CHARACTERISTICS_ALT;
                console.log('Using Muse 2016 service');
            } catch (e2) {
                // Try to find any service with EEG characteristics
                console.log('Trying to find EEG service manually...');
                for (const srv of services) {
                    try {
                        const chars = await srv.getCharacteristics();
                        console.log(`Service ${srv.uuid} has ${chars.length} characteristics`);
                        if (chars.length >= 4) {
                            service = srv;
                            // Use the service we found
                            console.log('Found service with multiple characteristics:', srv.uuid);
                            break;
                        }
                    } catch (err) {
                        console.log('Could not read service:', srv.uuid);
                    }
                }
                
                if (!service) {
                    throw new Error('Could not find Muse EEG service. Available services: ' + 
                                  services.map(s => s.uuid).join(', '));
                }
            }
        }
        
        updateStatus('Starting EEG stream...', false);
        
        // Get all characteristics
        const allChars = await service.getCharacteristics();
        console.log('Available characteristics:', allChars.map(c => c.uuid));
        
        // Subscribe to EEG channels
        let subscribedCount = 0;
        for (const [name, uuid] of Object.entries(characteristics)) {
            try {
                const characteristic = await service.getCharacteristic(uuid);
                await characteristic.startNotifications();
                
                characteristic.addEventListener('characteristicvaluechanged', (event) => {
                    handleEEGData(name, event.target.value);
                });
                
                eegChannels[name] = characteristic;
                subscribedCount++;
                console.log(`Subscribed to ${name} (${uuid})`);
            } catch (e) {
                console.log(`Could not subscribe to ${name}: ${e.message}`);
            }
        }
        
        if (subscribedCount === 0) {
            throw new Error('Could not subscribe to any EEG channels');
        }
        
        museDevice = device;
        isConnected = true;
        updateStatus(`Connected! Streaming ${subscribedCount} EEG channels...`, true);
        connectBtn.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            Disconnect
        `;
        connectBtn.classList.remove('btn-primary');
        connectBtn.classList.add('btn-danger');
        
        // Start processing loop
        startProcessing();
        
    } catch (error) {
        updateStatus('Connection failed: ' + error.message, false);
        console.error('Muse connection error:', error);
        console.error('Error stack:', error.stack);
    }
}

function disconnectMuse() {
    if (museDevice?.gatt?.connected) {
        museDevice.gatt.disconnect();
    }
    isConnected = false;
    museDevice = null;
    eegChannels = {};
    rawEEG = { TP9: [], AF7: [], AF8: [], TP10: [] };
    
    updateStatus('Disconnected', false);
    connectBtn.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
        Connect Muse
    `;
    connectBtn.classList.remove('btn-danger');
    connectBtn.classList.add('btn-primary');
}

function updateStatus(message, connected) {
    statusText.textContent = message;
    statusDot.className = connected ? 'status-dot online' : 'status-dot offline';
}

// Handle incoming EEG data
function handleEEGData(channel, dataView) {
    const samples = [];
    
    // Parse 12 samples per packet
    for (let i = 0; i < 12; i++) {
        const sample = dataView.getInt16(i * 2, true) * 0.48828125; // Convert to µV
        samples.push(sample);
    }
    
    // Update buffer (keep last 512 samples = 2 seconds at 256Hz)
    rawEEG[channel] = [...rawEEG[channel], ...samples].slice(-512);
}

// Process EEG data
function startProcessing() {
    setInterval(() => {
        if (!isConnected) return;
        
        // Calculate band powers
        const validChannels = Object.values(rawEEG).filter(ch => ch.length >= 256);
        if (validChannels.length === 0) return;
        
        const channelBands = validChannels.map(samples => calculateBandPowers(samples));
        const validBands = channelBands.filter(b => b !== null);
        
        if (validBands.length === 0) return;
        
        // Average across channels
        const avgBands = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
        validBands.forEach(bands => {
            Object.keys(avgBands).forEach(key => {
                avgBands[key] += bands[key];
            });
        });
        
        Object.keys(avgBands).forEach(key => {
            avgBands[key] /= validBands.length;
        });
        
        brainwaves = avgBands;
        
        // Calculate total voltage
        const allSamples = validChannels.flat();
        const rms = Math.sqrt(
            allSamples.reduce((sum, val) => sum + val * val, 0) / allSamples.length
        );
        totalVoltage = Math.min(5, rms / 100);
        
        // Update UI
        updateUI();
        
    }, 500); // Update every 500ms
}

// Simplified band power calculation
function calculateBandPowers(samples) {
    if (samples.length < 256) return null;
    
    const data = samples.slice(-256);
    const N = data.length;
    
    const bands = { delta: 0, theta: 0, alpha: 0, beta: 0, gamma: 0 };
    
    // Simple spectral analysis
    for (let freq = 0.5; freq < 50; freq += 0.5) {
        let power = 0;
        for (let i = 0; i < N; i++) {
            const angle = 2 * Math.PI * freq * i / 256;
            power += data[i] * Math.cos(angle);
        }
        power = (power * power) / N;
        
        if (freq < 4) bands.delta += power;
        else if (freq < 8) bands.theta += power;
        else if (freq < 13) bands.alpha += power;
        else if (freq < 30) bands.beta += power;
        else bands.gamma += power;
    }
    
    // Normalize
    const total = Object.values(bands).reduce((a, b) => a + b, 0);
    if (total > 0) {
        Object.keys(bands).forEach(key => {
            bands[key] = bands[key] / total;
        });
    }
    
    return bands;
}

// Calculate emotional state
function calculateEmotionalState(waves) {
    const valence = (waves.alpha - waves.beta) / (waves.alpha + waves.beta + 0.001);
    const arousal = (waves.beta + waves.gamma * 1.5) / (waves.beta + waves.gamma + 0.001);
    
    const normalizedValence = Math.max(-1, Math.min(1, valence));
    const normalizedArousal = (arousal - 0.5) * 2;
    
    let emotion = '', description = '', tradeAdvice = '';
    
    if (normalizedValence > 0 && normalizedArousal > 0) {
        if (normalizedArousal > 0.5) {
            emotion = 'Excitement';
            description = 'High energy, positive mood';
            tradeAdvice = '⚠️ May lead to overconfidence - be cautious';
        } else {
            emotion = 'Alert Interest';
            description = 'Engaged and positive';
            tradeAdvice = '✅ Good state for active trading';
        }
    } else if (normalizedValence > 0 && normalizedArousal <= 0) {
        if (Math.abs(normalizedArousal) > 0.5) {
            emotion = 'Relaxation';
            description = 'Calm and content';
            tradeAdvice = '✅ Ideal for patient, strategic decisions';
        } else {
            emotion = 'Contentment';
            description = 'Peaceful awareness';
            tradeAdvice = '✅ Good for reviewing and planning';
        }
    } else if (normalizedValence <= 0 && normalizedArousal > 0) {
        if (normalizedArousal > 0.5) {
            emotion = 'Anxiety/Panic';
            description = 'Stressed and agitated';
            tradeAdvice = '❌ Avoid trading - high risk of mistakes';
        } else {
            emotion = 'Tension';
            description = 'Worried or concerned';
            tradeAdvice = '⚠️ Proceed with caution';
        }
    } else {
        if (Math.abs(normalizedArousal) > 0.5) {
            emotion = 'Sadness/Fatigue';
            description = 'Low energy, negative mood';
            tradeAdvice = '❌ Not recommended for trading';
        } else {
            emotion = 'Boredom';
            description = 'Disengaged, low motivation';
            tradeAdvice = '⚠️ Lack of focus - take a break';
        }
    }
    
    return {
        valence: normalizedValence,
        arousal: normalizedArousal,
        emotion,
        description,
        tradeAdvice
    };
}

// Calculate color from brainwave state
function calculateColorFromMap(waves, voltage) {
    const waveNames = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
    const powers = waveNames.map(w => waves[w]);
    const totalPower = powers.reduce((a, b) => a + b, 0);
    
    let xPosition = 0;
    if (totalPower > 0) {
        powers.forEach((power, idx) => {
            xPosition += (idx / (waveNames.length - 1)) * (power / totalPower);
        });
    }
    
    const yPosition = Math.min(1, voltage / 5);
    
    let baseR = 0, baseG = 0, baseB = 0;
    powers.forEach((power, idx) => {
        const wave = waveNames[idx];
        const color = waveColors[wave];
        const weight = totalPower > 0 ? power / totalPower : 0;
        baseR += color.r * weight;
        baseG += color.g * weight;
        baseB += color.b * weight;
    });
    
    let finalR, finalG, finalB;
    if (yPosition < 0.5) {
        const brightness = yPosition * 2;
        finalR = baseR * brightness;
        finalG = baseG * brightness;
        finalB = baseB * brightness;
    } else {
        const whiteness = (yPosition - 0.5) * 2;
        finalR = baseR + (255 - baseR) * whiteness;
        finalG = baseG + (255 - baseG) * whiteness;
        finalB = baseB + (255 - baseB) * whiteness;
    }
    
    return {
        position: { x: xPosition, y: yPosition },
        color: {
            r: Math.round(finalR),
            g: Math.round(finalG),
            b: Math.round(finalB)
        }
    };
}

// Update UI
function updateUI() {
    const colorResult = calculateColorFromMap(brainwaves, totalVoltage);
    const emotionState = calculateEmotionalState(brainwaves);
    
    // Update color display
    document.getElementById('colorBox').style.backgroundColor = 
        `rgb(${colorResult.color.r}, ${colorResult.color.g}, ${colorResult.color.b})`;
    document.getElementById('colorR').textContent = colorResult.color.r;
    document.getElementById('colorG').textContent = colorResult.color.g;
    document.getElementById('colorB').textContent = colorResult.color.b;
    document.getElementById('freqPos').textContent = (colorResult.position.x * 100).toFixed(1);
    document.getElementById('voltPos').textContent = (colorResult.position.y * 100).toFixed(1);
    
    // Update emotion display
    document.getElementById('emotionName').textContent = emotionState.emotion;
    document.getElementById('emotionDesc').textContent = emotionState.description;
    document.getElementById('tradeAdvice').textContent = emotionState.tradeAdvice;
    document.getElementById('valenceValue').textContent = emotionState.valence.toFixed(2);
    document.getElementById('arousalValue').textContent = emotionState.arousal.toFixed(2);
    
    // Update sliders
    document.getElementById('valenceMarker').style.left = 
        `${(emotionState.valence + 1) * 50}%`;
    document.getElementById('arousalMarker').style.left = 
        `${(emotionState.arousal + 1) * 50}%`;
    
    // Update voltage
    const voltageIntensity = Math.round((totalVoltage / 5) * 255);
    const voltageBox = document.getElementById('voltageBox');
    voltageBox.style.backgroundColor = `rgb(${voltageIntensity}, ${voltageIntensity}, ${voltageIntensity})`;
    voltageBox.style.color = voltageIntensity > 128 ? '#000000' : '#ffffff';
    document.getElementById('voltageValue').textContent = totalVoltage.toFixed(2);
    document.getElementById('voltageProgress').style.width = `${(totalVoltage / 5) * 100}%`;
    
    // Update wave bands
    updateWaveBands();
    
    // Draw canvases
    drawSphere(colorResult.color);
    drawEmotionMap(emotionState);
}

// Update wave bands display
function updateWaveBands() {
    const container = document.getElementById('waveBands');
    container.innerHTML = '';
    
    Object.entries(brainwaves).forEach(([wave, power]) => {
        const color = waveColors[wave];
        const frequency = wave === 'delta' ? '0.5-4 Hz' :
                         wave === 'theta' ? '4-8 Hz' :
                         wave === 'alpha' ? '8-13 Hz' :
                         wave === 'beta' ? '13-30 Hz' : '30-50 Hz';
        
        const div = document.createElement('div');
        div.className = 'wave-band';
        div.innerHTML = `
            <div class="wave-header">
                <div class="wave-name">
                    <div class="wave-color" style="background: rgb(${color.r}, ${color.g}, ${color.b})"></div>
                    <span class="wave-label">${wave}</span>
                    <span class="wave-freq">${frequency}</span>
                </div>
                <span class="wave-value">${power.toFixed(3)}</span>
            </div>
            <div class="wave-bar">
                <div class="wave-progress" style="width: ${power * 100}%; background: rgb(${color.r}, ${color.g}, ${color.b})"></div>
            </div>
        `;
        container.appendChild(div);
    });
}

// Draw 3D sphere
let rotation = 0;
function drawSphere(color) {
    const ctx = sphereCanvas.getContext('2d');
    const width = sphereCanvas.width;
    const height = sphereCanvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = 120;
    
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, width, height);
    
    // Create gradient
    const gradient = ctx.createRadialGradient(
        centerX - radius * 0.3, centerY - radius * 0.3, radius * 0.1,
        centerX, centerY, radius
    );
    
    gradient.addColorStop(0, `rgb(${Math.min(255, color.r + 50)}, ${Math.min(255, color.g + 50)}, ${Math.min(255, color.b + 50)})`);
    gradient.addColorStop(0.7, `rgb(${color.r}, ${color.g}, ${color.b})`);
    gradient.addColorStop(1, `rgb(${Math.max(0, color.r - 50)}, ${Math.max(0, color.g - 50)}, ${Math.max(0, color.b - 50)})`);
    
    // Draw sphere
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // Draw wireframe
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    
    for (let i = -2; i <= 2; i++) {
        const y = centerY + (i * radius / 3);
        const r = Math.sqrt(radius * radius - (i * radius / 3) * (i * radius / 3));
        ctx.beginPath();
        ctx.ellipse(centerX, y, r, r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI + rotation;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radius * Math.abs(Math.cos(angle)), radius, Math.PI / 2, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    rotation += 0.01;
}

// Draw emotion map
function drawEmotionMap(emotionState) {
    const ctx = emotionMap.getContext('2d');
    const width = emotionMap.width;
    const height = emotionMap.height;
    
    // Draw gradient based on valence-arousal space
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const valence = (x / width) * 2 - 1;
            const arousal = ((height - y) / height) * 2 - 1;
            
            let r, g, b;
            
            if (valence > 0 && arousal > 0) {
                // Excitement - Orange/Yellow
                const intensity = Math.sqrt(valence * valence + arousal * arousal) / Math.sqrt(2);
                r = 255;
                g = 180 + intensity * 75;
                b = 0;
            } else if (valence > 0 && arousal <= 0) {
                // Relaxation - Green
                const intensity = Math.sqrt(valence * valence + arousal * arousal) / Math.sqrt(2);
                r = 50;
                g = 150 + intensity * 105;
                b = 50;
            } else if (valence <= 0 && arousal > 0) {
                // Anxiety - Red
                const intensity = Math.sqrt(valence * valence + arousal * arousal) / Math.sqrt(2);
                r = 200 + intensity * 55;
                g = 50;
                b = 50;
            } else {
                // Sadness - Blue
                const intensity = Math.sqrt(valence * valence + arousal * arousal) / Math.sqrt(2);
                r = 80;
                g = 50;
                b = 150 + intensity * 105;
            }
            
            const distanceFromCenter = Math.sqrt(valence * valence + arousal * arousal);
            const brightness = 0.4 + distanceFromCenter * 0.6;
            
            ctx.fillStyle = `rgb(${r * brightness}, ${g * brightness}, ${b * brightness})`;
            ctx.fillRect(x, y, 1, 1);
        }
    }
    
    // Draw crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    
    // Draw cursor
    const cursorX = ((emotionState.valence + 1) / 2) * width;
    const cursorY = ((1 - emotionState.arousal) / 2) * height;
    
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 10, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 3, 0, Math.PI * 2);
    ctx.fill();
}

// Start animation loop
function animate() {
    if (isConnected) {
        updateUI();
    }
    requestAnimationFrame(animate);
}

animate();