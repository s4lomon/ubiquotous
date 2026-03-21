// ============================================
// HAND TRACKING
// ============================================

/**
 * Start MediaPipe hand tracking
 */
async function startHandTracking() {
    try {
        updateStatus('Starting hand tracking...');
        
        // Initialize MediaPipe Hands
        window.hands = new Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });
        
        window.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7
        });
        
        window.hands.onResults(onHandResults);
        
        // Setup camera
        const videoElement = document.getElementById('webcam');
        window.camera = new Camera(videoElement, {
            onFrame: async () => {
                await window.hands.send({ image: videoElement });
            },
            width: 640,
            height: 480
        });
        
        await window.camera.start();
        
        window.handTrackingActive = true;
        window.usingHand = true;
        document.getElementById('handContainer').classList.remove('hidden');
        document.getElementById('handIndicator').className = 'w-3 h-3 rounded-full bg-green-500 animate-pulse';
        document.getElementById('trackingMode').textContent = 'Hand Tracking';
        document.getElementById('startHand').disabled = true;
        updateStatus('✅ Hand tracking active! Point with your index finger');
        
    } catch (error) {
        updateStatus('❌ Hand tracking failed: ' + error.message);
        console.error(error);
    }
}

/**
 * Process hand tracking results
 */
function onHandResults(results) {
    const canvas = document.getElementById('handCanvas');
    const ctx = canvas.getContext('2d');
    const video = document.getElementById('webcam');
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Mirror the canvas to match the video display
    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);
    
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        window.handDetected = true;
        document.getElementById('handStatus').textContent = 'Hand detected ✓';
        document.getElementById('handStatus').className = 'text-green-400';
        
        const landmarks = results.multiHandLandmarks[0];
        
        // Draw hand landmarks
        drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
        drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });
        
        // Use INDEX_FINGER_TIP (landmark 8) for control
        const indexTip = landmarks[8];
        
        // Highlight index finger tip (now drawing on mirrored canvas)
        ctx.fillStyle = '#00FFFF';
        ctx.beginPath();
        ctx.arc(indexTip.x * canvas.width, indexTip.y * canvas.height, 10, 0, Math.PI * 2);
        ctx.fill();
        
        // Map to game canvas (direct mapping - video is already mirrored in CSS)
        const gameCanvas = document.getElementById('gameCanvas');
        const newX = indexTip.x * gameCanvas.width;
        const newY = indexTip.y * gameCanvas.height;
        
        // Calculate speed
        if (window.lastHandPosition.x !== 0) {
            const dx = newX - window.lastHandPosition.x;
            const dy = newY - window.lastHandPosition.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const instantSpeed = distance * 30; // Convert to pixels per second (assuming 30fps)
            
            // Add to history for smoothing
            window.handPositionHistory.push(instantSpeed);
            if (window.handPositionHistory.length > SPEED_SMOOTHING) {
                window.handPositionHistory.shift();
            }
            
            // Calculate average speed
            window.handSpeed = window.handPositionHistory.reduce((a, b) => a + b, 0) / window.handPositionHistory.length;
            document.getElementById('handSpeed').textContent = Math.round(window.handSpeed);
        }
        
        // Calculate hand rotation (wrist angle) for Italian gesture 🤌
        const wrist = landmarks[0];
        const middleFinger = landmarks[9];
        const handAngle = Math.atan2(middleFinger.y - wrist.y, middleFinger.x - wrist.x);
        const handRotationDeg = handAngle * (180 / Math.PI);
        
        // Track rotation changes
        if (window.lastHandRotation !== 0) {
            let rotationDelta = handRotationDeg - window.lastHandRotation;
            
            // Handle wrap-around at 180/-180 degrees
            if (rotationDelta > 180) rotationDelta -= 360;
            if (rotationDelta < -180) rotationDelta += 360;
            
            window.handRotationHistory.push(rotationDelta);
            if (window.handRotationHistory.length > 30) {
                window.handRotationHistory.shift();
            }
            
            // Detect significant rotation gesture (Italian hand flip)
            const totalRotation = window.handRotationHistory.reduce((a, b) => a + b, 0);
            const rotationSpeed = Math.abs(totalRotation);
            
            // If hand rotated more than 90 degrees quickly (the Italian gesture!)
            const now = Date.now();
            if (rotationSpeed > 90 && 
                !window.rotationGestureDetected && 
                now - window.lastRotationGestureTime > 1000) {
                
                window.rotationGestureDetected = true;
                window.lastRotationGestureTime = now;
                
                // Trigger dice spin!
                const selectedDice = window.dice.find(d => d.selected);
                if (selectedDice && !selectedDice.spinning) {
                    spinDice(selectedDice);
                    window.totalSpins++;
                    document.getElementById('totalSpins').textContent = window.totalSpins;
                    updateStatus(`🤌 Italian gesture detected! Spinning dice!`);
                } else if (!selectedDice) {
                    updateStatus('🤌 Italian gesture - but no dice selected!');
                }
                
                // Reset rotation history
                window.handRotationHistory = [];
                
                // Reset flag after a moment
                setTimeout(() => {
                    window.rotationGestureDetected = false;
                }, 500);
            }
        }
        
        window.lastHandRotation = handRotationDeg;
        
        window.lastHandPosition = { x: newX, y: newY };
        window.controlX = newX;
        window.controlY = newY;
        
    } else {
        window.handDetected = false;
        document.getElementById('handStatus').textContent = 'No hand detected';
        document.getElementById('handStatus').className = 'text-red-400';
        window.handSpeed = 0;
    }
    
    // Restore canvas transform
    ctx.restore();
}