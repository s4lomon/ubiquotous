// ============================================
// EEG VISUALIZATION WITH CLEAN FLAT SIGNALS
// ============================================

// ============================================
// BLINK DETECTION CONFIGURATION
// ============================================

const BLINK_CONFIG = {
    // Amplitude thresholds (in µV)
    THRESHOLD_MIN: 30,           // Lower threshold for cleaner signals
    THRESHOLD_MAX: 200,          // Maximum to avoid artifacts
    THRESHOLD_OPTIMAL: 50,       // Optimal detection threshold
    
    // Temporal characteristics
    MIN_DURATION_MS: 50,         // Minimum blink duration
    MAX_DURATION_MS: 500,        // Maximum blink duration
    REFRACTORY_PERIOD_MS: 150,   // Minimum time between blinks
    
    // Signal characteristics
    MIN_SLOPE: 40,               // Minimum rate of change (µV/sample) for blink onset
    BOTH_CHANNELS_REQUIRED: false, // Allow single channel detection for better sensitivity
    BASELINE_WINDOW: 100,        // Samples to use for baseline calculation
};

// Blink detection state
const blinkState = {
    lastBlinkTime: 0,
    currentBlinkStart: null,
    blinkInProgress: false,
    peakAmplitude: 0,
    af7Triggered: false,
    af8Triggered: false,
    blinkCount: 0,
    recentBlinks: []  // Store last 10 blinks with timestamps and amplitudes
};

// ============================================
// SIGNAL PROCESSING - MAKE IT FLAT!
// ============================================

/**
 * Advanced baseline removal - removes DC offset and slow drifts
 */
function removeBaseline(data, windowSize = 50) {
    if (data.length < windowSize) return data;
    
    const result = [];
    
    for (let i = 0; i < data.length; i++) {
        // Calculate moving average baseline
        const start = Math.max(0, i - windowSize);
        const end = Math.min(data.length, i + windowSize);
        const window = data.slice(start, end);
        
        const baseline = window.reduce((sum, val) => sum + val, 0) / window.length;
        
        // Subtract baseline from current value
        result.push(data[i] - baseline);
    }
    
    return result;
}

/**
 * High-pass filter to remove slow drifts (< 0.5 Hz)
 */
function highPassFilter(data, cutoffFreq = 0.5, sampleRate = 256) {
    if (data.length < 10) return data;
    
    // Simple high-pass filter using differentiation
    const result = [data[0]];
    const alpha = 1 / (2 * Math.PI * cutoffFreq * (1 / sampleRate) + 1);
    
    for (let i = 1; i < data.length; i++) {
        const filtered = alpha * (result[i - 1] + data[i] - data[i - 1]);
        result.push(filtered);
    }
    
    return result;
}

/**
 * Notch filter to remove 50/60 Hz powerline noise
 */
function notchFilter(data, notchFreq = 60, sampleRate = 256, bandwidth = 2) {
    if (data.length < 10) return data;
    
    // Simple notch using moving average at specific frequency
    const windowSize = Math.round(sampleRate / notchFreq);
    const result = [];
    
    for (let i = 0; i < data.length; i++) {
        if (i < windowSize) {
            result.push(data[i]);
            continue;
        }
        
        // Calculate average of one cycle back
        const cycleValue = data[i - windowSize];
        result.push(data[i] - 0.3 * cycleValue); // Attenuate the specific frequency
    }
    
    return result;
}

/**
 * Smoothing filter for clean visualization
 */
function smoothingFilter(data, windowSize = 3) {
    if (data.length < windowSize) return data;
    
    const result = [];
    const halfWindow = Math.floor(windowSize / 2);
    
    for (let i = 0; i < data.length; i++) {
        const start = Math.max(0, i - halfWindow);
        const end = Math.min(data.length, i + halfWindow + 1);
        const window = data.slice(start, end);
        
        const avg = window.reduce((sum, val) => sum + val, 0) / window.length;
        result.push(avg);
    }
    
    return result;
}

/**
 * MASTER FILTER - Makes signal super clean and flat
 */
function makeSignalFlat(data) {
    if (!data || data.length < 20) return data;
    
    // Step 1: Remove DC offset and slow drifts
    let clean = removeBaseline(data, 50);
    
    // Step 2: High-pass filter (removes slow components < 0.5 Hz)
    clean = highPassFilter(clean, 0.5, 256);
    
    // Step 3: Notch filter (removes 60 Hz powerline noise)
    clean = notchFilter(clean, 60, 256);
    
    // Step 4: Light smoothing for clean visualization
    clean = smoothingFilter(clean, 3);
    
    // Step 5: Remove any remaining DC offset
    const mean = clean.reduce((sum, val) => sum + val, 0) / clean.length;
    clean = clean.map(val => val - mean);
    
    return clean;
}

// ============================================
// BLINK DETECTION FUNCTIONS
// ============================================

/**
 * Calculate baseline (average of recent signal)
 */
function calculateBaseline(data, numSamples = BLINK_CONFIG.BASELINE_WINDOW) {
    if (data.length < numSamples) return 0;
    
    const recentData = data.slice(-numSamples);
    const sum = recentData.reduce((acc, val) => acc + Math.abs(val), 0);
    return sum / recentData.length;
}

/**
 * Calculate rate of change (slope)
 */
function calculateSlope(data, windowSize = 5) {
    if (data.length < windowSize + 1) return 0;
    
    const recent = data.slice(-windowSize - 1);
    const diffs = [];
    
    for (let i = 1; i < recent.length; i++) {
        diffs.push(Math.abs(recent[i] - recent[i - 1]));
    }
    
    return diffs.reduce((acc, val) => acc + val, 0) / diffs.length;
}

/**
 * Check if a channel shows blink characteristics
 */
function checkChannelForBlink(channel) {
    const data = window.channelStreamBuffers[channel];
    if (!data || data.length < 100) return false;
    
    const currentValue = Math.abs(data[data.length - 1]);
    const baseline = calculateBaseline(data);
    const slope = calculateSlope(data);
    
    // Check amplitude threshold (lowered for cleaner signals)
    const amplitudeExceeded = currentValue > BLINK_CONFIG.THRESHOLD_OPTIMAL;
    
    // Check if it's above baseline significantly
    const significantChange = currentValue > (baseline + BLINK_CONFIG.THRESHOLD_MIN);
    
    // Check rate of change
    const rapidChange = slope > BLINK_CONFIG.MIN_SLOPE;
    
    return amplitudeExceeded && significantChange && rapidChange;
}

/**
 * Main blink detection logic
 */
function detectBlink() {
    const now = Date.now();
    
    // Check refractory period
    if (now - blinkState.lastBlinkTime < BLINK_CONFIG.REFRACTORY_PERIOD_MS) {
        return;
    }
    
    // Check both channels
    const af7Blink = checkChannelForBlink('AF7');
    const af8Blink = checkChannelForBlink('AF8');
    
    // Update trigger states
    if (af7Blink) blinkState.af7Triggered = true;
    if (af8Blink) blinkState.af8Triggered = true;
    
    // Determine if blink detected based on configuration
    let blinkDetected = false;
    if (BLINK_CONFIG.BOTH_CHANNELS_REQUIRED) {
        blinkDetected = blinkState.af7Triggered && blinkState.af8Triggered;
    } else {
        blinkDetected = af7Blink || af8Blink;
    }
    
    // Handle blink state machine
    if (blinkDetected && !blinkState.blinkInProgress) {
        // Blink onset detected
        blinkState.blinkInProgress = true;
        blinkState.currentBlinkStart = now;
        blinkState.peakAmplitude = 0;
        
        console.log('🔵 Blink onset detected');
        triggerBlinkEvent('onset');
        
    } else if (blinkState.blinkInProgress) {
        const blinkDuration = now - blinkState.currentBlinkStart;
        
        // Track peak amplitude
        const af7Data = window.channelStreamBuffers['AF7'];
        const af8Data = window.channelStreamBuffers['AF8'];
        if (af7Data && af8Data) {
            const currentPeak = Math.max(
                Math.abs(af7Data[af7Data.length - 1]),
                Math.abs(af8Data[af8Data.length - 1])
            );
            blinkState.peakAmplitude = Math.max(blinkState.peakAmplitude, currentPeak);
        }
        
        // Check if blink has ended
        const bothChannelsLow = !af7Blink && !af8Blink;
        const validDuration = blinkDuration >= BLINK_CONFIG.MIN_DURATION_MS;
        
        if (bothChannelsLow && validDuration) {
            // Valid blink completed
            if (blinkDuration <= BLINK_CONFIG.MAX_DURATION_MS) {
                blinkState.blinkCount++;
                blinkState.lastBlinkTime = now;
                
                // Store blink info
                const blinkInfo = {
                    timestamp: now,
                    duration: blinkDuration,
                    peakAmplitude: blinkState.peakAmplitude
                };
                
                blinkState.recentBlinks.push(blinkInfo);
                if (blinkState.recentBlinks.length > 10) {
                    blinkState.recentBlinks.shift();
                }
                
                console.log(`✅ Blink #${blinkState.blinkCount} detected! Duration: ${blinkDuration}ms, Peak: ${blinkState.peakAmplitude.toFixed(1)}µV`);
                triggerBlinkEvent('complete', blinkInfo);
            } else {
                console.log('⚠️ Blink too long, likely artifact');
            }
            
            // Reset state
            blinkState.blinkInProgress = false;
            blinkState.af7Triggered = false;
            blinkState.af8Triggered = false;
            blinkState.peakAmplitude = 0;
        }
    }
}

/**
 * Trigger custom blink event for application to handle
 */
function triggerBlinkEvent(type, data = null) {
    const event = new CustomEvent('eegBlink', {
        detail: {
            type: type,  // 'onset' or 'complete'
            data: data,
            blinkCount: blinkState.blinkCount,
            timestamp: Date.now()
        }
    });
    
    window.dispatchEvent(event);
    
    // Update UI
    updateBlinkUI(type, data);
}

/**
 * Update blink detection UI elements
 */
function updateBlinkUI(type, data) {
    // Update blink counter
    const counterElement = document.getElementById('blinkCounter');
    if (counterElement) {
        counterElement.textContent = blinkState.blinkCount;
    }
    
    // Flash indicator
    const indicatorElement = document.getElementById('blinkIndicator');
    if (indicatorElement && type === 'complete') {
        indicatorElement.classList.add('blink-flash');
        setTimeout(() => {
            indicatorElement.classList.remove('blink-flash');
        }, 300);
    }
    
    // Update last blink info
    const lastBlinkElement = document.getElementById('lastBlinkInfo');
    if (lastBlinkElement && data) {
        lastBlinkElement.innerHTML = `
            Duration: ${data.duration}ms<br>
            Peak: ${data.peakAmplitude.toFixed(1)}µV
        `;
    }
}

// ============================================
// VISUALIZATION FUNCTIONS
// ============================================

/**
 * Update time scale setting
 */
function updateTimeScale() {
    window.timeScale = parseInt(document.getElementById('timeScaleSelect').value);
    window.streamBufferSize = window.timeScale * SAMPLE_RATE;
    console.log(`Time scale updated to ${window.timeScale} seconds`);
}

/**
 * Update amplitude scale setting
 */
function updateAmplitudeScale() {
    window.amplitudeScale = parseInt(document.getElementById('amplitudeSlider').value);
    document.getElementById('amplitudeValue').textContent = window.amplitudeScale + 'µV';
    console.log(`Amplitude scale: ${window.amplitudeScale}µV`);
}

/**
 * Update filter strength setting
 */
function updateFilterStrength() {
    window.filterStrength = parseInt(document.getElementById('filterSlider').value);
    document.getElementById('filterValue').textContent = window.filterStrength;
    console.log(`Filter strength: ${window.filterStrength}/10`);
}

/**
 * Draw a single channel stream with FLAT baseline
 */
function drawChannelStream(channel, color) {
    const canvas = document.getElementById(`${channel.toLowerCase()}Canvas`);
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    const data = window.channelStreamBuffers[channel];
    if (data.length < 2) return;
    
    // Clear with dark background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    
    // Apply MASTER FILTER to make signal super flat and clean
    const filtered = makeSignalFlat(data);
    
    const SCALE = window.amplitudeScale;
    
    // Draw subtle grid lines
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    let gridIntervals = [];
    if (SCALE >= 2500) {
        gridIntervals = [SCALE * 0.25, SCALE * 0.5, SCALE * 0.75];
    } else if (SCALE >= 2000) {
        gridIntervals = [SCALE * 0.33, SCALE * 0.66];
    } else if (SCALE >= 1000) {
        gridIntervals = [SCALE * 0.33, SCALE * 0.66];
    } else if (SCALE >= 500) {
        gridIntervals = [SCALE * 0.5];
    } else if (SCALE >= 200) {
        gridIntervals = [SCALE * 0.5];
    } else {
        gridIntervals = [SCALE * 0.5];
    }
    
    gridIntervals.forEach(val => {
        const y1 = h / 2 - (val / SCALE) * (h / 2);
        const y2 = h / 2 + (val / SCALE) * (h / 2);
        ctx.beginPath();
        ctx.moveTo(0, y1);
        ctx.lineTo(w, y1);
        ctx.moveTo(0, y2);
        ctx.lineTo(w, y2);
        ctx.stroke();
    });
    
    // Center line (0µV) - make it more visible
    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    
    // Draw threshold lines for AF7 and AF8
    if (channel === 'AF7' || channel === 'AF8') {
        const thresholdY = h / 2 - (BLINK_CONFIG.THRESHOLD_OPTIMAL / SCALE) * (h / 2);
        const thresholdYNeg = h / 2 + (BLINK_CONFIG.THRESHOLD_OPTIMAL / SCALE) * (h / 2);
        
        // Only draw if threshold is visible
        if (Math.abs(thresholdY - h/2) > 5) {
            // Draw threshold zone (min to max)
            const minY = h / 2 - (BLINK_CONFIG.THRESHOLD_MIN / SCALE) * (h / 2);
            const maxY = h / 2 - (BLINK_CONFIG.THRESHOLD_MAX / SCALE) * (h / 2);
            const minYNeg = h / 2 + (BLINK_CONFIG.THRESHOLD_MIN / SCALE) * (h / 2);
            const maxYNeg = h / 2 + (BLINK_CONFIG.THRESHOLD_MAX / SCALE) * (h / 2);
            
            // Shade detection zone
            ctx.fillStyle = 'rgba(220, 38, 38, 0.05)';
            ctx.fillRect(0, maxY, w, minY - maxY);
            ctx.fillRect(0, minYNeg, w, maxYNeg - minYNeg);
            
            // Draw optimal threshold line
            ctx.strokeStyle = blinkState.blinkInProgress ? '#ef4444' : '#dc2626';
            ctx.lineWidth = blinkState.blinkInProgress ? 2 : 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(0, thresholdY);
            ctx.lineTo(w, thresholdY);
            ctx.moveTo(0, thresholdYNeg);
            ctx.lineTo(w, thresholdYNeg);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Add threshold labels
            ctx.fillStyle = blinkState.blinkInProgress ? '#ef4444' : '#dc2626';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`+${BLINK_CONFIG.THRESHOLD_OPTIMAL}µV`, 5, thresholdY - 3);
            ctx.fillText(`-${BLINK_CONFIG.THRESHOLD_OPTIMAL}µV`, 5, thresholdYNeg + 12);
            
            // Show if channel is triggered
            if ((channel === 'AF7' && blinkState.af7Triggered) || 
                (channel === 'AF8' && blinkState.af8Triggered)) {
                ctx.fillStyle = '#ef4444';
                ctx.font = 'bold 11px monospace';
                ctx.fillText('🔴 BLINK', w - 70, 15);
            }
        }
    }
    
    // Draw clean, flat signal
    const isBlinkChannel = (channel === 'AF7' || channel === 'AF8');
    const highlightBlink = isBlinkChannel && blinkState.blinkInProgress;
    
    if (highlightBlink) {
        ctx.strokeStyle = '#ef4444'; // Bright red during blink
        ctx.lineWidth = 2.5;
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 5;
    } else {
        ctx.strokeStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
        ctx.lineWidth = 1.5;
        ctx.shadowBlur = 0;
    }
    
    ctx.beginPath();
    
    const samplesPerPixel = filtered.length / w;
    for (let x = 0; x < w; x++) {
        const sampleIdx = Math.floor(x * samplesPerPixel);
        if (sampleIdx >= filtered.length) break;
        
        const val = filtered[sampleIdx];
        
        // Clamp to scale to prevent artifacts
        const clampedVal = Math.max(-SCALE, Math.min(SCALE, val));
        const y = h / 2 - (clampedVal / SCALE) * (h / 2);
        
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    
    // Reset shadow
    ctx.shadowBlur = 0;
    
    // Draw scale labels
    ctx.fillStyle = '#4b5563';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`+${SCALE}`, w - 3, 10);
    ctx.fillText('0', w - 3, h / 2 + 3);
    ctx.fillText(`-${SCALE}`, w - 3, h - 3);
    
    // Update current value display
    if (filtered.length > 0) {
        const current = filtered[filtered.length - 1];
        const currentEl = document.getElementById(`${channel.toLowerCase()}-current`);
        if (currentEl) {
            currentEl.textContent = current.toFixed(1) + 'µV';
            
            // Highlight if above threshold
            if (isBlinkChannel && Math.abs(current) > BLINK_CONFIG.THRESHOLD_OPTIMAL) {
                currentEl.style.color = '#ef4444';
                currentEl.style.fontWeight = 'bold';
            } else {
                currentEl.style.color = '';
                currentEl.style.fontWeight = '';
            }
        }
    }
}

/**
 * Draw all channel streams and run blink detection
 */
function drawAllChannels() {
    Object.keys(window.channelStreamBuffers).forEach(channel => {
        drawChannelStream(channel, CHANNEL_COLORS[channel]);
    });
    
    // Run blink detection
    detectBlink();
    
    requestAnimationFrame(drawAllChannels);
}

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize blink detection system
 */
function initBlinkDetection() {
    console.log('🎯 Blink detection initialized with FLAT signal processing');
    console.log(`   Threshold: ${BLINK_CONFIG.THRESHOLD_OPTIMAL}µV`);
    console.log(`   Duration: ${BLINK_CONFIG.MIN_DURATION_MS}-${BLINK_CONFIG.MAX_DURATION_MS}ms`);
    console.log(`   Both channels required: ${BLINK_CONFIG.BOTH_CHANNELS_REQUIRED}`);
    console.log(`   🔧 Advanced filtering: Baseline removal + High-pass + Notch + Smoothing`);
    
    // Add event listener for blink events
    window.addEventListener('eegBlink', (event) => {
        if (event.detail.type === 'complete') {
            console.log('✨ Blink detected on clean signal:', event.detail);
        }
    });
}

// Call this when your application starts
if (typeof window !== 'undefined') {
    window.initBlinkDetection = initBlinkDetection;
    window.BLINK_CONFIG = BLINK_CONFIG;
    window.blinkState = blinkState;
    window.makeSignalFlat = makeSignalFlat; // Export for manual use
}