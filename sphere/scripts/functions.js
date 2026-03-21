
  
        // Complete 10-20 System electrode positions (x, y coordinates for 600x600 canvas)
        const ELECTRODE_POSITIONS = {
            // Frontal Polar
            'Fp1': { x: 220, y: 100, region: 'Frontal' },
            'Fp2': { x: 380, y: 100, region: 'Frontal' },
            'Fpz': { x: 300, y: 85, region: 'Frontal' },
            
            // Frontal
            'F7': { x: 120, y: 150, region: 'Frontal' },
            'F3': { x: 220, y: 170, region: 'Frontal' },
            'Fz': { x: 300, y: 160, region: 'Frontal' },
            'F4': { x: 380, y: 170, region: 'Frontal' },
            'F8': { x: 480, y: 150, region: 'Frontal' },
            
            // Fronto-Temporal
            'FT7': { x: 90, y: 220, region: 'Temporal' },
            'FC3': { x: 200, y: 240, region: 'Central' },
            'FCz': { x: 300, y: 230, region: 'Central' },
            'FC4': { x: 400, y: 240, region: 'Central' },
            'FT8': { x: 510, y: 220, region: 'Temporal' },
            
            // Temporal
            'T7': { x: 70, y: 300, region: 'Temporal' },
            'T3': { x: 80, y: 300, region: 'Temporal' }, // Alternative name
            'T8': { x: 530, y: 300, region: 'Temporal' },
            'T4': { x: 520, y: 300, region: 'Temporal' }, // Alternative name
            
            // Central
            'C3': { x: 200, y: 300, region: 'Central' },
            'Cz': { x: 300, y: 300, region: 'Central' },
            'C4': { x: 400, y: 300, region: 'Central' },
            
            // Centro-Parietal
            'CP3': { x: 200, y: 360, region: 'Parietal' },
            'CPz': { x: 300, y: 370, region: 'Parietal' },
            'CP4': { x: 400, y: 360, region: 'Parietal' },
            
            // Parietal
            'P7': { x: 120, y: 450, region: 'Parietal' },
            'P3': { x: 220, y: 430, region: 'Parietal' },
            'Pz': { x: 300, y: 440, region: 'Parietal' },
            'P4': { x: 380, y: 430, region: 'Parietal' },
            'P8': { x: 480, y: 450, region: 'Parietal' },
            
            // Occipital
            'O1': { x: 220, y: 500, region: 'Occipital' },
            'Oz': { x: 300, y: 515, region: 'Occipital' },
            'O2': { x: 380, y: 500, region: 'Occipital' },
            
            // Auricular (Ears)
            'A1': { x: 50, y: 300, region: 'Reference' },
            'A2': { x: 550, y: 300, region: 'Reference' },
            
            // Muse-specific (mapped to 10-20)
            'TP9': { x: 90, y: 360, region: 'Temporal' },
            'AF7': { x: 160, y: 130, region: 'Frontal' },
            'AF8': { x: 440, y: 130, region: 'Frontal' },
            'TP10': { x: 510, y: 360, region: 'Temporal' }
        };

        // Device state
        let device = null;
        let server = null;
        let connected = false;
        let activeChannels = {};
        let channelData = {};
        let totalPackets = 0;
        let startTime = null;
        let currentView = 'map'; // 'map' or 'streams'

        // Known device configurations
        const DEVICE_CONFIGS = {
            'Muse': {
                service: '0000fe8d-0000-1000-8000-00805f9b34fb',
                control: '273e0001-4c4d-454d-96be-f03bac821358',
                channels: {
                    'TP9': '273e0003-4c4d-454d-96be-f03bac821358',
                    'AF7': '273e0004-4c4d-454d-96be-f03bac821358',
                    'AF8': '273e0005-4c4d-454d-96be-f03bac821358',
                    'TP10': '273e0006-4c4d-454d-96be-f03bac821358'
                },
                sampleRate: 256
            }
            // Add more device configs here as needed
        };

        // Initialize electrode display
        function initializeElectrodes() {
            const container = document.getElementById('electrodeContainer');
            container.innerHTML = '';

            Object.entries(ELECTRODE_POSITIONS).forEach(([name, pos]) => {
                const electrode = document.createElement('div');
                electrode.id = `electrode-${name}`;
                electrode.className = 'absolute flex flex-col items-center cursor-pointer transition-all hover:scale-110';
                electrode.style.left = `${pos.x}px`;
                electrode.style.top = `${pos.y}px`;
                electrode.style.transform = 'translate(-50%, -50%)';
                
                electrode.innerHTML = `
                    <div class="w-8 h-8 rounded-full bg-gray-600 border-2 border-gray-400 flex items-center justify-center shadow-lg">
                        <div class="w-2 h-2 rounded-full bg-gray-800"></div>
                    </div>
                    <div class="text-xs font-bold text-white mt-1 bg-black/50 px-2 py-0.5 rounded">${name}</div>
                    <div class="text-xs text-gray-400 hidden" id="region-${name}">${pos.region}</div>
                `;
                
                electrode.addEventListener('mouseenter', () => {
                    document.getElementById(`region-${name}`).classList.remove('hidden');
                });
                electrode.addEventListener('mouseleave', () => {
                    document.getElementById(`region-${name}`).classList.add('hidden');
                });
                
                container.appendChild(electrode);
            });
        }

        // Update electrode status
        function updateElectrodeStatus(channelName, status) {
            const electrode = document.getElementById(`electrode-${channelName}`);
            if (!electrode) return;

            const dot = electrode.querySelector('.w-8');
            dot.classList.remove('bg-gray-600', 'bg-green-500', 'bg-yellow-500', 'bg-red-500');
            dot.classList.remove('animate-pulse');

            switch(status) {
                case 'active':
                    dot.classList.add('bg-green-500', 'animate-pulse');
                    break;
                case 'connected':
                    dot.classList.add('bg-yellow-500');
                    break;
                case 'error':
                    dot.classList.add('bg-red-500');
                    break;
                default:
                    dot.classList.add('bg-gray-600');
            }
        }

        // Connect to device
        async function connectDevice() {
            try {
                updateConnectionStatus('Searching for devices...', 'yellow');

                // Request Bluetooth device
                device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [DEVICE_CONFIGS.Muse.service] }],
                    optionalServices: [DEVICE_CONFIGS.Muse.service]
                });

                updateConnectionStatus('Connecting...', 'yellow');
                server = await device.gatt.connect();

                const service = await server.getPrimaryService(DEVICE_CONFIGS.Muse.service);

                // Start streaming (Muse-specific)
                try {
                    const control = await service.getCharacteristic(DEVICE_CONFIGS.Muse.control);
                    await control.writeValue(new Uint8Array([0x02, 0x64, 0x0a]));
                    await new Promise(r => setTimeout(r, 100));
                    await control.writeValue(new Uint8Array([0x02, 0x73, 0x0a]));
                } catch (e) {
                    console.log('Control setup:', e);
                }

                // Detect and connect to available channels
                const config = DEVICE_CONFIGS.Muse;
                let detectedCount = 0;

                for (const [channelName, uuid] of Object.entries(config.channels)) {
                    try {
                        const char = await service.getCharacteristic(uuid);
                        await char.startNotifications();
                        char.addEventListener('characteristicvaluechanged', (e) => handleEEGData(e, channelName));
                        
                        activeChannels[channelName] = {
                            characteristic: char,
                            packets: 0,
                            lastUpdate: Date.now()
                        };
                        channelData[channelName] = [];
                        
                        updateElectrodeStatus(channelName, 'connected');
                        detectedCount++;
                    } catch (e) {
                        console.log(`${channelName} not available:`, e);
                    }
                }

                if (detectedCount > 0) {
                    connected = true;
                    startTime = Date.now();
                    updateConnectionStatus(`Connected - ${detectedCount} channels detected`, 'green');
                    document.getElementById('deviceInfo').textContent = `${device.name} (${detectedCount} channels)`;
                    document.getElementById('activeChannels').textContent = detectedCount;
                    document.getElementById('sampleRate').textContent = `${config.sampleRate} Hz`;
                    document.getElementById('connectBtn').disabled = true;
                    document.getElementById('disconnectBtn').disabled = false;

                    // Auto-switch to streams view after 2 seconds
                    setTimeout(() => {
                        if (currentView === 'map') toggleView();
                    }, 2000);
                } else {
                    throw new Error('No channels detected');
                }

            } catch (error) {
                updateConnectionStatus('Connection failed: ' + error.message, 'red');
                console.error(error);
            }
        }

        // Handle incoming EEG data
        function handleEEGData(event, channelName) {
            const value = event.target.value;
            totalPackets++;
            activeChannels[channelName].packets++;
            activeChannels[channelName].lastUpdate = Date.now();
            
            updateElectrodeStatus(channelName, 'active');

            // Parse samples (Muse format: 12-bit samples)
            const samples = [];
            for (let i = 0; i < value.byteLength - 1; i += 3) {
                if (i + 2 < value.byteLength) {
                    const s1 = (value.getUint8(i) << 4) | (value.getUint8(i + 1) >> 4);
                    const s2 = ((value.getUint8(i + 1) & 0x0F) << 8) | value.getUint8(i + 2);
                    
                    // Convert to microvolts
                    const voltage1 = (s1 - 2048) * 0.48828125;
                    const voltage2 = (s2 - 2048) * 0.48828125;
                    
                    samples.push(voltage1, voltage2);
                }
            }

            // Store data
            channelData[channelName].push(...samples);
            
            // Keep buffer manageable (last 1000 samples)
            if (channelData[channelName].length > 1000) {
                channelData[channelName] = channelData[channelName].slice(-1000);
            }

            updateStatistics();
            if (currentView === 'streams') {
                updateChannelStream(channelName);
            }
        }

        // Update statistics
        function updateStatistics() {
            document.getElementById('totalPackets').textContent = totalPackets;
            
            if (startTime) {
                const duration = Math.floor((Date.now() - startTime) / 1000);
                document.getElementById('duration').textContent = `${duration}s`;
            }
        }

        // Update channel stream visualization
        function updateChannelStream(channelName) {
    let streamContainer = document.getElementById(`stream-${channelName}`);
    
    if (!streamContainer) {
        const container = document.getElementById('channelStreams');
        const div = document.createElement('div');
        div.className = 'bg-black/30 rounded-lg p-4';
        div.innerHTML = `
            <div class="flex justify-between items-center mb-2">
                <h4 class="text-white font-semibold">${channelName}</h4>
                <span class="text-sm text-gray-400">Packets: <span id="count-${channelName}">0</span></span>
            </div>
            <canvas id="stream-${channelName}" width="800" height="100" class="w-full rounded bg-black/50"></canvas>
        `;
        container.appendChild(div);
        streamContainer = document.getElementById(`stream-${channelName}`);
    }

    document.getElementById(`count-${channelName}`).textContent = activeChannels[channelName].packets;

    const canvas = streamContainer;
    const ctx = canvas.getContext('2d');
    let data = [...channelData[channelName]]; // copy raw

    if (data.length < 2) return;

    // Apply filters in order
    if (filterHighPass) data = applyHighPass(data);
    if (filterNotch) data = applyNotch(data, 60); // change to 50 if needed
    if (filterLowPass) data = applyLowPass(data);

    // Apply gain
    data = data.map(sample => sample * amplificationGain);

    // Clear and draw grid
    ctx.fillStyle = 'rgba(0,0,0,0.9)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    for (let i = 1; i < 5; i++) {
        const y = i * canvas.height / 5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Draw waveform
    ctx.strokeStyle = '#00ff88';
    ctx.lineWidth = 2.5;
    ctx.beginPath();

    const points = Math.min(data.length, 600);
    const start = data.length - points;

    for (let i = 0; i < points; i++) {
        const x = (i / points) * canvas.width;
        const y = canvas.height / 2 - (data[start + i] / 100) * (canvas.height / 3);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
}

            // Update packet count
            document.getElementById(`count-${channelName}`).textContent = activeChannels[channelName].packets;

            // Draw waveform
            const canvas = streamContainer;
            const ctx = canvas.getContext('2d');
            const data = channelData[channelName];
            
            if (data.length < 2) return;

            // Clear
            ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw grid
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const y = (i / 4) * canvas.height;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }

            // Draw waveform
            const displaySamples = Math.min(data.length, 500);
            const startIdx = Math.max(0, data.length - displaySamples);
            
            ctx.strokeStyle = '#00ff88';
            ctx.lineWidth = 2;
            ctx.beginPath();

            for (let i = 0; i < displaySamples; i++) {
                const x = (i / displaySamples) * canvas.width;
                const sample = data[startIdx + i];
                const y = canvas.height / 2 - (sample / 200) * canvas.height / 2; // Scale
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.stroke();
        

        // Toggle between map and streams view
        function toggleView() {
            const map = document.getElementById('systemMap');
            const streams = document.getElementById('dataStreams');
            
            if (currentView === 'map') {
                map.classList.add('hidden');
                streams.classList.remove('hidden');
                currentView = 'streams';
            } else {
                map.classList.remove('hidden');
                streams.classList.add('hidden');
                currentView = 'map';
            }
        }

        // Disconnect device
        async function disconnectDevice() {
            if (device && device.gatt.connected) {
                await device.gatt.disconnect();
            }
            
            connected = false;
            activeChannels = {};
            channelData = {};
            totalPackets = 0;
            startTime = null;
            
            // Reset all electrodes
            Object.keys(ELECTRODE_POSITIONS).forEach(name => {
                updateElectrodeStatus(name, 'inactive');
            });
            
            updateConnectionStatus('Not Connected', 'gray');
            document.getElementById('deviceInfo').textContent = 'No device';
            document.getElementById('activeChannels').textContent = '0';
            document.getElementById('connectBtn').disabled = false;
            document.getElementById('disconnectBtn').disabled = true;
            document.getElementById('channelStreams').innerHTML = '';
        }

        // Update connection status indicator
        function updateConnectionStatus(message, color) {
            const statusDiv = document.getElementById('connectionStatus');
            const dot = statusDiv.querySelector('div');
            const text = statusDiv.querySelector('span');
            
            dot.className = `w-3 h-3 rounded-full bg-${color}-500`;
            if (color === 'green' || color === 'yellow') {
                dot.classList.add('animate-pulse');
            }
            text.textContent = message;
        }

        // Monitor channel health
        setInterval(() => {
            if (!connected) return;
            
            Object.entries(activeChannels).forEach(([name, info]) => {
                const timeSince = Date.now() - info.lastUpdate;
                if (timeSince > 2000) {
                    updateElectrodeStatus(name, 'error');
                } else if (timeSince > 500) {
                    updateElectrodeStatus(name, 'connected');
                } else {
                    updateElectrodeStatus(name, 'active');
                }
            });
        }, 500);

        // Check Bluetooth support
        if (!navigator.bluetooth) {
            updateConnectionStatus('Web Bluetooth not supported', 'red');
            document.getElementById('connectBtn').disabled = true;
        }

        // Initialize
        initializeElectrodes();


    