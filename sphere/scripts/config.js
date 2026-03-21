const ELECTRODE_POSITIONS = { /* ... your full object, unchanged ... */ };

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
};

const LINE_FREQUENCY = 60; // Change to 50 if needed