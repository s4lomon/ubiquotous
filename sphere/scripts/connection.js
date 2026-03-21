let device = null, server = null, connected = false;
let activeChannels = {}, channelData = {}, totalPackets = 0, startTime = null;

// connectDevice(), handleEEGData(), disconnectDevice() — move your existing functions here unchanged