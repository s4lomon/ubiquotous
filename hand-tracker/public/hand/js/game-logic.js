// ============================================
// GAME LOGIC
// ============================================

/**
 * Spin a dice
 */
function spinDice(die) {
    if (die.spinning) return;
    die.spinning = true;
    die.spinSpeed = 0.3;
    die.value = Math.floor(Math.random() * 6) + 1;
}

/**
 * Update game state
 */
function updateGame() {
    window.dice.forEach((die, idx) => {
        // Update spinning animation
        if (die.spinning) {
            die.rotation += die.spinSpeed;
            die.spinSpeed *= 0.95;
            if (die.spinSpeed < 0.01) {
                die.spinning = false;
                die.spinSpeed = 0;
                die.rotation = 0;
            }
        }
        
        // Check if pointing at dice (using mirrored X)
        const canvas = document.getElementById('gameCanvas');
        const mirroredX = canvas.width - window.controlX;
        const dist = Math.sqrt(
            Math.pow(mirroredX - die.x, 2) + 
            Math.pow(window.controlY - die.y, 2)
        );
        const isPointing = dist < DICE_SIZE;
        
        // Check speed threshold for deselection
        const movingTooFast = window.handSpeed > DESELECTION_SPEED_THRESHOLD;
        
        // Handle selection logic
        if (isPointing && !die.selected && !movingTooFast) {
            die.dwellTime += 16; // ~60fps
            if (die.dwellTime >= SELECTION_DWELL_TIME) {
                window.dice.forEach(d => { d.selected = false; d.dwellTime = 0; });
                die.selected = true;
                updateStatus(`✅ Dice ${idx + 1} selected! Blink to spin.`);
            }
        } else if (movingTooFast && die.selected) {
            // Deselect if moving too fast
            die.selected = false;
            die.dwellTime = 0;
            updateStatus('⚡ Moved too fast - dice deselected');
        } else if (!isPointing && die.selected) {
            die.selected = false;
            die.dwellTime = 0;
        } else if (!isPointing) {
            die.dwellTime = Math.max(0, die.dwellTime - 32);
        }
        
        // Follow cursor when selected (using mirrored X)
        if (die.selected && !die.spinning) {
            const canvas = document.getElementById('gameCanvas');
            const mirroredX = canvas.width - window.controlX;
            const smoothing = 0.1;
            die.x += (mirroredX - die.x) * smoothing;
            die.y += (window.controlY - die.y) * smoothing;
        }
    });
}

/**
 * Draw the game
 */
function drawGame() {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    
    // Clear canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    
    // Draw cursor (mirrored X for natural control)
    const mirroredX = w - window.controlX;
    ctx.strokeStyle = window.handSpeed > DESELECTION_SPEED_THRESHOLD ? '#ef4444' : '#10b981';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(mirroredX, window.controlY, 15, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(mirroredX - 20, window.controlY);
    ctx.lineTo(mirroredX + 20, window.controlY);
    ctx.moveTo(mirroredX, window.controlY - 20);
    ctx.lineTo(mirroredX, window.controlY + 20);
    ctx.stroke();
    
    // Draw dice
    window.dice.forEach((die, idx) => {
        ctx.save();
        ctx.translate(die.x, die.y);
        
        if (die.spinning) ctx.rotate(die.rotation);
        
        // Check if this dice should flash red
        const isFlashing = die.selected && Date.now() < window.diceFlashUntil;
        
        if (die.selected && !isFlashing) {
            ctx.shadowColor = '#fbbf24';
            ctx.shadowBlur = 40;
        }
        
        if (isFlashing) {
            ctx.shadowColor = '#dc2626';
            ctx.shadowBlur = 50;
        }
        
        // Dice color
        ctx.fillStyle = isFlashing ? '#dc2626' : (die.selected ? '#fbbf24' : '#1f2937');
        ctx.fillRect(-DICE_SIZE/2, -DICE_SIZE/2, DICE_SIZE, DICE_SIZE);
        
        ctx.strokeStyle = isFlashing ? '#991b1b' : (die.selected ? '#f59e0b' : '#4b5563');
        ctx.lineWidth = 3;
        ctx.strokeRect(-DICE_SIZE/2, -DICE_SIZE/2, DICE_SIZE, DICE_SIZE);
        
        ctx.shadowBlur = 0;
        
        // Draw dots
        if (!die.spinning) {
            ctx.fillStyle = isFlashing ? '#ffffff' : (die.selected ? '#000000' : '#9ca3af');
            drawDiceDots(ctx, die.value, DICE_SIZE);
        }
        
        // Progress circle for selection
        if (die.dwellTime > 0 && !die.selected) {
            const progress = die.dwellTime / SELECTION_DWELL_TIME;
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.arc(0, 0, DICE_SIZE/2 + 20, -Math.PI/2, -Math.PI/2 + (progress * Math.PI * 2));
            ctx.stroke();
            
            // Show timer
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${((SELECTION_DWELL_TIME - die.dwellTime) / 1000).toFixed(1)}s`, 0, -DICE_SIZE/2 - 35);
        }
        
        ctx.restore();
    });
    
    updateGame();
    requestAnimationFrame(drawGame);
}

/**
 * Draw dots on a dice face
 */
function drawDiceDots(ctx, value, size) {
    const dotSize = size * 0.14;
    const offset = size * 0.28;
    
    const positions = {
        1: [[0, 0]],
        2: [[-offset, -offset], [offset, offset]],
        3: [[-offset, -offset], [0, 0], [offset, offset]],
        4: [[-offset, -offset], [offset, -offset], [-offset, offset], [offset, offset]],
        5: [[-offset, -offset], [offset, -offset], [0, 0], [-offset, offset], [offset, offset]],
        6: [[-offset, -offset], [offset, -offset], [-offset, 0], [offset, 0], [-offset, offset], [offset, offset]]
    };
    
    const dots = positions[value] || positions[1];
    dots.forEach(([x, y]) => {
        ctx.beginPath();
        ctx.arc(x, y, dotSize, 0, Math.PI * 2);
        ctx.fill();
    });
}

/**
 * Setup mouse control fallback
 */
function setupMouseControl() {
    const canvas = document.getElementById('gameCanvas');
    canvas.addEventListener('mousemove', (e) => {
        if (window.fakeMode || window.usingHand) return;
        const rect = canvas.getBoundingClientRect();
        window.controlX = ((e.clientX - rect.left) / rect.width) * canvas.width;
        window.controlY = ((e.clientY - rect.top) / rect.height) * canvas.height;
    });
}