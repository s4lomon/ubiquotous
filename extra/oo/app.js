// Muse-js lightweight implementation
class MuseClient {
    constructor() {
        this.device = null;
        this.gatt = null;
        this.characteristics = {};
        this.isStreaming = false;
        this.callbacks = {
            eeg: [],
            status: []
        };
    }

    async connect() {
        try {
            // Request Bluetooth device
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: 'Muse' }],
                optionalServices: [
                    '0000fe89-0000-1000-8000-00805f9b34fb' // Muse service UUID
                ]
            });

            this.updateStatus('Connecting...');
            
            // Connect to GATT server
            this.gatt = await this.device.gatt.connect();
            
            this.updateStatus('Getting services...');
            
            // Get Muse service
            const service = await this.gatt.getPrimaryService('0000fe89-0000-1000-8000-00805f9b34fb');
            
            // Get EEG characteristics (TP9, AF7, AF8, TP10)
            const eegUUIDs = [
                '00000001-0000-1000-8000-00805f9b34fb', // TP9
                '00000002-0000-1000-8000-00805f9b34fb', // AF7
                '00000003-0000-1000-8000-00805f9b34fb', // AF8
                '00000004-0000-1000-8000-00805f9b34fb'  // TP10
            ];

            for (let i = 0; i < eegUUIDs.length; i++) {
                this.characteristics[i] = await service.getCharacteristic(eegUUIDs[i]);
            }

            this.updateStatus('Connected!');
            return true;
        } catch (error) {
            this.updateStatus('Connection failed: ' + error.message, 'error');
            throw error;
        }
    }

    async start() {
        if (!this.gatt || !this.gatt.connected) {
            throw new Error('Not connected');
        }

        this.isStreaming = true;
        this.updateStatus('Streaming data...', 'connected');

        // Start notifications for each channel
        for (let channel = 0; channel < 4; channel++) {
            const characteristic = this.characteristics[channel];
            
            await characteristic.startNotifications();
            
            characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const data = this.parseEEGData(event.target.value);
                this.notifyEEG(channel, data);
            });
        }
    }

    parseEEGData(dataView) {
        // Muse sends 12 samples per notification (each sample is 2 bytes)
        const samples = [];
        for (let i = 0; i < 12; i++) {
            // Read 16-bit signed integer
            const value = dataView.getInt16(i * 2, false); // big-endian
            // Convert to microvolts (Muse uses 0.48828125 µV per bit)
            samples.push(value * 0.48828125);
        }
        return samples;
    }

    onEEG(callback) {
        this.callbacks.eeg.push(callback);
    }

    notifyEEG(channel, samples) {
        this.callbacks.eeg.forEach(cb => cb(channel, samples));
    }

    onStatus(callback) {
        this.callbacks.status.push(callback);
    }

    updateStatus(message, type = 'info') {
        this.callbacks.status.forEach(cb => cb(message, type));
    }

    async disconnect() {
        if (this.gatt) {
            this.gatt.disconnect();
        }
        this.isStreaming = false;
        this.updateStatus('Disconnected');
    }
}

// Application
const muse = new MuseClient();
const canvases = [
    document.getElementById('graph0'),
    document.getElementById('graph1'),
    document.getElementById('graph2'),
    document.getElementById('graph3')
];
const contexts = canvases.map(c => c.getContext('2d'));
const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f7b731'];

// Data buffers for each channel (keep last 500 samples)
const dataBuffers = [[], [], [], []];
const maxBufferSize = 500;

// Connect button
document.getElementById('connectBtn').addEventListener('click', async () => {
    const btn = document.getElementById('connectBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
        await muse.connect();
        await muse.start();
        
        // Show data panel
        document.getElementById('dataPanel').style.display = 'block';
        btn.textContent = 'Connected';
        
    } catch (error) {
        console.error('Connection error:', error);
        btn.disabled = false;
        btn.textContent = 'Connect Muse Device';
    }
});

// Status updates
muse.onStatus((message, type) => {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
});

// EEG data handler
muse.onEEG((channel, samples) => {
    // Add samples to buffer
    dataBuffers[channel].push(...samples);
    
    // Keep buffer size manageable
    if (dataBuffers[channel].length > maxBufferSize) {
        dataBuffers[channel] = dataBuffers[channel].slice(-maxBufferSize);
    }
    
    // Draw graph
    drawGraph(channel);
    
    // Update total voltage
    updateTotalVoltage();
});

// Draw graph for a channel
function drawGraph(channel) {
    const canvas = canvases[channel];
    const ctx = contexts[channel];
    const data = dataBuffers[channel];
    
    if (data.length < 2) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
        const y = (i / 4) * canvas.height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
    
    // Draw signal
    ctx.strokeStyle = colors[channel];
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    const step = canvas.width / data.length;
    const scale = canvas.height / 400; // Scale to fit typical EEG range (-200 to 200 µV)
    
    for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const y = canvas.height / 2 - (data[i] * scale);
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    
    ctx.stroke();
}

// Update total voltage display
function updateTotalVoltage() {
    // Calculate average absolute voltage across all channels
    let totalSamples = 0;
    let sumAbsVoltage = 0;
    
    dataBuffers.forEach(buffer => {
        if (buffer.length > 0) {
            // Get last 10 samples
            const recent = buffer.slice(-10);
            recent.forEach(v => {
                sumAbsVoltage += Math.abs(v);
                totalSamples++;
            });
        }
    });
    
    const avgVoltage = totalSamples > 0 ? sumAbsVoltage / totalSamples : 0;
    document.getElementById('voltageValue').textContent = avgVoltage.toFixed(1);
}

// Check Web Bluetooth support
if (!navigator.bluetooth) {
    document.getElementById('status').textContent = 'Web Bluetooth not supported in this browser';
    document.getElementById('status').className = 'status error';
    document.getElementById('connectBtn').disabled = true;
}