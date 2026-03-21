// filters.js - Fixed and integrated with your existing code

// These must match your main script's variables
let filterHighPass = false;
let filterNotch = true;     // default ON
let filterLowPass = false;
let amplificationGain = 5.0;

const SAMPLE_RATE = 256; // Muse sample rate

// Toggle function - called from HTML buttons
function toggleNoiseFilter(type) {
    switch(type) {
        case 'highpass':
            filterHighPass = !filterHighPass;
            document.getElementById('hpStatus').textContent = filterHighPass ? 'ON' : 'OFF';
            document.getElementById('hpBtn').classList.toggle('animate-pulse', filterHighPass);
            break;
        case 'notch':
            filterNotch = !filterNotch;
            document.getElementById('notchStatus').textContent = filterNotch ? 'ON' : 'OFF';
            document.getElementById('notchBtn').classList.toggle('animate-pulse', filterNotch);
            break;
        case 'lowpass':
            filterLowPass = !filterLowPass;
            document.getElementById('lpStatus').textContent = filterLowPass ? 'ON' : 'OFF';
            document.getElementById('lpBtn').classList.toggle('animate-pulse', filterLowPass);
            break;
    }

    // Force redraw of all streams with new filter settings
    document.getElementById('channelStreams').innerHTML = '';
    Object.keys(channelData).forEach(channel => updateChannelStream(channel));
}

// Simple 1st-order high-pass (removes baseline drift)
function applyHighPass(data) {
    if (data.length < 2) return data;
    const alpha = 0.99; // closer to 1 = stronger high-pass
    const filtered = new Array(data.length);
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
        filtered[i] = alpha * (filtered[i-1] + data[i] - data[i-1]);
    }
    return filtered;
}

// Simple notch filter for 60 Hz (or change to 50)
function applyNotch(data, freq = 60) {
    if (data.length < 3) return data;
    const theta = 2 * Math.PI * freq / SAMPLE_RATE;
    const Q = 35;
    const alpha = Math.sin(theta) / (2 * Q);
    const b0 = 1 + alpha;
    const b1 = -2 * Math.cos(theta);
    const b2 = 1 - alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(theta);
    const a2 = 1 - alpha;

    const filtered = new Array(data.length);
    let y1 = 0, y2 = 0, x1 = 0, x2 = 0;

    for (let i = 0; i < data.length; i++) {
        const y = (b0/a0)*data[i] + (b1/a0)*x1 + (b2/a0)*x2 - (a1/a0)*y1 - (a2/a0)*y2;
        filtered[i] = y;
        x2 = x1; x1 = data[i];
        y2 = y1; y1 = y;
    }
    return filtered;
}

// Simple 1st-order low-pass (smooths high-freq noise)
function applyLowPass(data) {
    if (data.length < 2) return data;
    const alpha = 0.1; // smaller = stronger smoothing
    const filtered = new Array(data.length);
    filtered[0] = data[0];
    for (let i = 1; i < data.length; i++) {
        filtered[i] = filtered[i-1] + alpha * (data[i] - filtered[i-1]);
    }
    return filtered;
}

// Connect gain slider
document.getElementById('gainSlider').addEventListener('input', function(e) {
    amplificationGain = parseFloat(e.target.value);
    document.getElementById('gainValue').textContent = amplificationGain.toFixed(1) + 'x';
    // Redraw all
    document.getElementById('channelStreams').innerHTML = '';
    Object.keys(channelData).forEach(channel => updateChannelStream(channel));
});