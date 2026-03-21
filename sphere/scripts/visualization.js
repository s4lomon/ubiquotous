function initializeElectrodes() { /* ... unchanged from your code ... */ }

function updateElectrodeStatus(channelName, status) { /* ... unchanged ... */ }

function updateStatistics() { /* ... unchanged ... */ }

function updateChannelStream(channelName) {
    // ... container creation code unchanged ...

    const rawData = channelData[channelName];
    if (rawData.length < 2) return;

    let processed = [...rawData];

    if (!noiseFilterStates[channelName]) noiseFilterStates[channelName] = {};

    ['highpass', 'notch', 'lowpass'].forEach(type => {
        if (noiseFilters[type]) {
            if (!noiseFilterStates[channelName][type]) noiseFilterStates[channelName][type] = {z1:0, z2:0};
            const {filtered, state} = biquadFilter(processed, NOISE_FILTER_COEFFS[type].b, NOISE_FILTER_COEFFS[type].a, noiseFilterStates[channelName][type]);
            processed = filtered;
            noiseFilterStates[channelName][type] = state;
        }
    });

    const displayData = processed.map(s => amplifierEnabled ? s * currentGain : s * currentGain); // gain always applied

    // ... rest of drawing code (clear, grid, waveform) unchanged, just use displayData ...
}