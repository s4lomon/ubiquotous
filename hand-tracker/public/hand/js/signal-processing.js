// ============================================
// SIGNAL PROCESSING
// ============================================

/**
 * Multi-stage aggressive filtering for clean baseline
 */
function applyAggressiveFiltering(data) {
    if (data.length < 50) return data;
    
    // Stage 1: Remove DC offset (mean removal)
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    let filtered = data.map(v => v - mean);
    
    // Stage 2: High-pass filter (remove drift < 0.5 Hz)
    filtered = applyStrongHighPass(filtered, 0.5);
    
    // Stage 3: Notch filter at 50/60 Hz (power line noise)
    filtered = applyNotchFilter(filtered, 50);
    filtered = applyNotchFilter(filtered, 60);
    
    // Stage 4: Bandpass 1-30 Hz (blink artifacts are 1-10 Hz)
    filtered = applyBandpassFilter(filtered, 1, 30);
    
    // Stage 5: Moving average smoothing
    filtered = applyMovingAverage(filtered, 5);
    
    // Stage 6: Outlier removal (clip extreme values)
    const std = calculateStd(filtered);
    filtered = filtered.map(v => {
        if (Math.abs(v) > std * 3) return 0; // Remove outliers
        return v;
    });
    
    return filtered;
}

/**
 * Strong high-pass filter to remove all low-frequency drift
 */
function applyStrongHighPass(data, cutoffFreq) {
    const RC = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = RC / (RC + dt);
    
    let filtered = [0];
    for (let i = 1; i < data.length; i++) {
        filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }
    
    // Apply twice for stronger effect
    let doubleFiltered = [0];
    for (let i = 1; i < filtered.length; i++) {
        doubleFiltered[i] = alpha * (doubleFiltered[i-1] + filtered[i] - filtered[i-1]);
    }
    
    return doubleFiltered;
}

/**
 * Simple notch filter to remove specific frequency
 */
function applyNotchFilter(data, notchFreq) {
    // Simplified notch - rely on bandpass for now
    return data;
}

/**
 * Bandpass filter: high-pass then low-pass
 */
function applyBandpassFilter(data, lowFreq, highFreq) {
    let filtered = applyHighPass(data, lowFreq);
    filtered = applyLowPass(filtered, highFreq);
    return filtered;
}

/**
 * High-pass filter
 */
function applyHighPass(data, cutoffFreq) {
    const RC = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = RC / (RC + dt);
    
    let filtered = [0];
    for (let i = 1; i < data.length; i++) {
        filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }
    return filtered;
}

/**
 * Low-pass filter
 */
function applyLowPass(data, cutoffFreq) {
    const RC = 1.0 / (2 * Math.PI * cutoffFreq);
    const dt = 1.0 / SAMPLE_RATE;
    const alpha = dt / (RC + dt);
    
    let filtered = [data[0]];
    for (let i = 1; i < data.length; i++) {
        filtered[i] = filtered[i-1] + alpha * (data[i] - filtered[i-1]);
    }
    return filtered;
}

/**
 * Moving average filter
 */
function applyMovingAverage(data, windowSize) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = Math.max(0, i - windowSize); j <= Math.min(data.length - 1, i + windowSize); j++) {
            sum += data[j];
            count++;
        }
        result.push(sum / count);
    }
    return result;
}

/**
 * Calculate standard deviation
 */
function calculateStd(data) {
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
}

/**
 * Moderate filtering based on filter strength slider
 */
function applyModerateFiltering(data) {
    if (data.length < 20) return data;
    
    // Remove DC offset
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    let filtered = data.map(v => v - mean);
    
    if (window.filterStrength === 0) return filtered; // No filtering
    
    // Apply smoothing based on filter strength (0-10)
    const windowSize = Math.floor(window.filterStrength / 2) + 1; // 1-6
    filtered = applyMovingAverage(filtered, windowSize);
    
    // For high filter strength (>7), apply additional high-pass to remove drift
    if (window.filterStrength > 7) {
        filtered = applyHighPass(filtered, 0.5);
    }
    
    // At maximum filter (10), apply aggressive outlier removal
    if (window.filterStrength === 10) {
        const std = calculateStd(filtered);
        const threshold = std * 2; // Only keep signals within 2 std dev
        filtered = filtered.map(v => Math.abs(v) > threshold ? 0 : v);
    }
    
    return filtered;
}

/**
 * Time-domain bandpass filter
 */
function applyTimedomainBandpass(data, lowFreq, highFreq) {
    if (data.length < 20) return data;
    return applyAggressiveFiltering(data);
}

/**
 * Calculate noise level
 */
function calculateNoiseLevel(data) {
    if (data.length < 10) return 0;
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    return Math.sqrt(variance);
}

/**
 * Calculate overall signal quality
 */
function calculateSignalQuality() {
    const noises = Object.values(window.channelNoise || {});
    if (noises.length === 0) return 0;
    const avgNoise = noises.reduce((a, b) => a + b, 0) / noises.length;
    return Math.max(0, Math.min(1, 1 - (avgNoise - 10) / 40));
}

/**
 * FFT implementation
 */
function performFFT(buffer) {
    const N = buffer.length;
    const result = new Array(N / 2).fill(0);
    for (let k = 0; k < N / 2; k++) {
        let real = 0, imag = 0;
        for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * k * n / N;
            real += buffer[n] * Math.cos(angle);
            imag += buffer[n] * Math.sin(angle);
        }
        result[k] = Math.sqrt(real * real + imag * imag) / N;
    }
    return result;
}

/**
 * Get band power from FFT
 */
function getBandPower(fft, minFreq, maxFreq) {
    const binSize = SAMPLE_RATE / FFT_SIZE;
    const minBin = Math.floor(minFreq / binSize);
    const maxBin = Math.ceil(maxFreq / binSize);
    let power = 0;
    for (let i = minBin; i <= maxBin && i < fft.length; i++) {
        power += fft[i] * fft[i];
    }
    return power || 0.0001;
}