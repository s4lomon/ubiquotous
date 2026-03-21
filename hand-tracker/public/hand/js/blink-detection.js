// ============================================
// BLINK DETECTION
// ============================================

/**
 * Calculate maximum derivative (rate of change)
 */
function calculateMaxDerivative(data) {
    if (data.length < 2) return 0;
    let maxDeriv = 0;
    for (let i = 1; i < data.length; i++) {
        const deriv = Math.abs(data[i] - data[i - 1]);
        if (deriv > maxDeriv) maxDeriv = deriv;
    }
    return maxDeriv;
}

/**
 * Detect eye blinks from AF7 and AF8 channels
 * Returns true if blink detected
 */
function detectBlink(af7Data, af8Data) {
    const now = Date.now();
    
    // Check refractory period and data length
    if (now - window.lastBlinkTime < BLINK_REFRACTORY || 
        af7Data.length < 100 || af8Data.length < 100) {
        return false;
    }
    
    // Check signal quality
    if (window.signalQuality < SIGNAL_QUALITY_THRESHOLD) {
        return false;
    }
    
    // Apply moderate filtering
    const af7Filtered = applyModerateFiltering(af7Data.slice(-100));
    const af8Filtered = applyModerateFiltering(af8Data.slice(-100));
    
    const windowSize = 60; // ~250ms at 256Hz
    const af7Recent = af7Filtered.slice(-windowSize);
    const af8Recent = af8Filtered.slice(-windowSize);
    
    // Calculate baseline from first third of window
    const baselineSize = Math.floor(windowSize / 3);
    const af7Baseline = af7Recent.slice(0, baselineSize).reduce((a, b) => a + b, 0) / baselineSize;
    const af8Baseline = af8Recent.slice(0, baselineSize).reduce((a, b) => a + b, 0) / baselineSize;
    
    // Find peak deviation from baseline in detection window (last 2/3)
    const af7Deviations = af7Recent.slice(baselineSize).map(v => Math.abs(v - af7Baseline));
    const af8Deviations = af8Recent.slice(baselineSize).map(v => Math.abs(v - af8Baseline));
    
    const af7Peak = Math.max(...af7Deviations);
    const af8Peak = Math.max(...af8Deviations);
    
    // Calculate derivative (rate of change)
    const af7Derivative = calculateMaxDerivative(af7Recent.slice(-30));
    const af8Derivative = calculateMaxDerivative(af8Recent.slice(-30));
    
    // Determine which eye blinked
    let eyeBlinked = null;
    let blinkDetected = false;
    
    // RIGHT EYE BLINK: AF8 shows significant change and is dominant
    if (af8Peak > BLINK_THRESHOLD && 
        af8Peak > (af7Peak * EYE_DOMINANCE_RATIO) && 
        af8Derivative > BLINK_MIN_DERIVATIVE) {
        eyeBlinked = 'RIGHT';
        blinkDetected = true;
    }
    // LEFT EYE BLINK: AF7 shows significant change and is dominant
    else if (af7Peak > BLINK_THRESHOLD && 
             af7Peak > (af8Peak * EYE_DOMINANCE_RATIO) && 
             af7Derivative > BLINK_MIN_DERIVATIVE) {
        eyeBlinked = 'LEFT';
        blinkDetected = true;
    }
    // BOTH EYES: Both channels show similar large changes
    else if (af7Peak > BLINK_THRESHOLD && 
             af8Peak > BLINK_THRESHOLD &&
             Math.abs(af7Peak - af8Peak) < BLINK_THRESHOLD * 0.5) {
        eyeBlinked = 'BOTH';
        blinkDetected = true;
    }
    
    if (blinkDetected) {
        window.lastBlinkTime = now;
        window.totalBlinks++;
        document.getElementById('totalBlinks').textContent = window.totalBlinks;
        
        console.log(`${eyeBlinked} EYE BLINK: AF7=${af7Peak.toFixed(1)}µV, AF8=${af8Peak.toFixed(1)}µV, Ratio=${(Math.max(af7Peak, af8Peak) / Math.min(af7Peak, af8Peak)).toFixed(2)}`);
        
        // LEFT eye blinks → SPIN DICE
        if (eyeBlinked === 'LEFT') {
            onBlinkDetected();
            updateStatus(`✨ LEFT eye blink - SPINNING DICE!`);
        }
        // RIGHT eye blinks → FLASH DICE RED
        else if (eyeBlinked === 'RIGHT') {
            flashDiceRed();
            updateStatus(`🔴 RIGHT eye blink - DICE FLASH RED!`);
        } 
        // BOTH eyes
        else {
            updateStatus(`👁️ BOTH eyes blink detected`);
        }
        
        return true;
    }
    
    return false;
}

/**
 * Handle blink detection - spin selected dice
 */
function onBlinkDetected() {
    const selectedDice = window.dice.find(d => d.selected);
    
    if (selectedDice && !selectedDice.spinning) {
        spinDice(selectedDice);
        window.totalSpins++;
        document.getElementById('totalSpins').textContent = window.totalSpins;
        updateStatus(`✨ LEFT eye blink! Spinning dice ${window.dice.indexOf(selectedDice) + 1}`);
    } else if (!selectedDice) {
        updateStatus('👁️ Blink detected - point at a dice for 0.5s to select');
    }
}

/**
 * Flash selected dice red
 */
function flashDiceRed() {
    const selectedDice = window.dice.find(d => d.selected);
    
    if (selectedDice) {
        // Set flash timer for 1 second
        window.diceFlashUntil = Date.now() + 1000;
        updateStatus(`🔴 RIGHT eye blink! Dice ${window.dice.indexOf(selectedDice) + 1} flashing red`);
    } else {
        updateStatus('👁️ RIGHT eye blink - but no dice selected');
    }
}