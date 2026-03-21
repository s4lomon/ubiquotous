let currentView = 'map';

function toggleView() { /* ... unchanged ... */ }

function updateConnectionStatus(message, color) { /* ... unchanged ... */ }

// Health monitor interval
setInterval(() => { /* ... unchanged ... */ }, 500);

if (!navigator.bluetooth) { /* ... */ }

initializeElectrodes();
document.getElementById('toggleViewBtn').onclick = toggleView;
document.getElementById('ampBtn').onclick = toggleAmplifier;
document.getElementById('hpBtn').onclick = () => toggleNoiseFilter('highpass');
document.getElementById('notchBtn').onclick = () => toggleNoiseFilter('notch');
document.getElementById('lpBtn').onclick = () => toggleNoiseFilter('lowpass');
document.getElementById('connectBtn').onclick = connectDevice;
document.getElementById('disconnectBtn').onclick = disconnectDevice;