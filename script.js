const canvas = document.getElementById('tetris-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');

const ROWS = 20;
const COLS = 10;
const BLOCK_SIZE = 30;

let grid = createGrid();
let currentPiece = null;
let nextPiece = null;
let score = 0;
let highScore = localStorage.getItem('tetrisHighScore') || 0;
let level = 1;
let lines = 0;
let gameRunning = false;
let isPaused = false;
let requestId = null;

let lastTime = 0;
let dropCounter = 0;
let dropInterval = 1000;

// --- SISTEMA DE "JUICE" Y COMBOS ---
let particles = [];
let floatingTexts = []; // Para los mensajes de COMBO
let comboCount = 0;
let shakeTime = 0;
let clearingLines = [];

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10;
        this.life = 1.0; this.gravity = 0.2;
    }
    update() {
        this.vx *= 0.95; this.vy += this.gravity;
        this.x += this.vx; this.y += this.vy;
        this.life -= 0.02;
    }
    draw(context) {
        context.fillStyle = this.color; context.globalAlpha = this.life;
        context.fillRect(this.x, this.y, 6, 6); context.globalAlpha = 1.0;
    }
}

class FloatingText {
    constructor(text, x, y, color) {
        this.text = text; this.x = x; this.y = y;
        this.color = color; this.life = 1.0; this.vy = -1.5;
    }
    update() { this.y += this.vy; this.life -= 0.015; }
    draw(context) {
        context.fillStyle = this.color;
        context.globalAlpha = this.life;
        context.font = "12px 'Press Start 2P'";
        context.fillText(this.text, this.x, this.y);
        context.globalAlpha = 1.0;
    }
}

// --- SISTEMA DE AUDIO ---
let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let globalVolume = 0.5; 
let musicStep = 0;
let menuMusicTimeout = null;
let gameMusicTimeout = null;

const colors = [
    ['#00f0f0', '#00a0a0'], ['#f0f000', '#a0a000'], ['#a000f0', '#7000a0'],
    ['#00f000', '#00a0a0'], ['#f00000', '#a00000'], ['#0000f0', '#0000a0'], ['#f0a000', '#a07000']
];

const pieces = [
    [[[1,1,1,1]], [[1],[1],[1],[1]]], 
    [[[1,1],[1,1]]], 
    [[[0,1,0],[1,1,1]], [[1,0],[1,1],[1,0]], [[1,1,1],[0,1,0]], [[0,1],[1,1],[0,1]]], 
    [[[0,1,1],[1,1,0]], [[1,0],[1,1],[0,1]]], 
    [[[1,1,0],[0,1,1]], [[0,1],[1,1],[1,0]]], 
    [[[1,0,0],[1,1,1]], [[1,1],[1,0],[1,0]], [[1,1,1],[0,0,1]], [[0,1],[0,1],[1,1]]], 
    [[[0,0,1],[1,1,1]], [[1,0],[1,0],[1,1]], [[1,1,1],[1,0,0]], [[1,1],[0,1],[0,1]]]
];

document.getElementById('high-score').innerText = `Record: ${highScore}`;

function createSynthNote(freq, vol, duration, type) {
    try {
        if (audioContext.state === 'suspended') audioContext.resume();
        const osc = audioContext.createOscillator();
        const g = audioContext.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioContext.currentTime);
        g.gain.setValueAtTime(vol * globalVolume, audioContext.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
        osc.connect(g); g.connect(audioContext.destination);
        osc.start(); osc.stop(audioContext.currentTime + duration);
    } catch(e) {}
}

function drawBlock(x, y, colorIndex, context, size, isGhost = false, isWhite = false) {
    const pad = 2; const drawSize = size - pad * 2;
    if (isGhost) {
        context.strokeStyle = colors[colorIndex][0]; context.lineWidth = 2; context.globalAlpha = 0.3; 
        context.strokeRect(x * size + pad + 2, y * size + pad + 2, drawSize - 4, drawSize - 4);
        context.globalAlpha = 1.0;
    } else {
        context.fillStyle = isWhite ? '#FFF' : colors[colorIndex][1];
        context.beginPath(); context.roundRect(x * size + pad, y * size + pad, drawSize, drawSize, 4); context.fill();
        if (!isWhite) {
            context.fillStyle = colors[colorIndex][0];
            context.fillRect(x * size + pad + 2, y * size + pad + 2, drawSize - 4, drawSize / 3);
        }
    }
}

function getGhostPosition() {
    if (!currentPiece) return 0;
    let ghostY = currentPiece.y;
    while (isValidMove(currentPiece, 0, ghostY - currentPiece.y + 1)) { ghostY++; }
    return ghostY;
}

function draw() {
    ctx.save();
    if (shakeTime > 0) { ctx.translate((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7); shakeTime--; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Grilla
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*BLOCK_SIZE,0); ctx.lineTo(x*BLOCK_SIZE,ROWS*BLOCK_SIZE); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*BLOCK_SIZE); ctx.lineTo(COLS*BLOCK_SIZE,y*BLOCK_SIZE); ctx.stroke(); }
    
    grid.forEach((row, r) => row.forEach((cell, c) => {
        if (cell) drawBlock(c, r, cell - 1, ctx, BLOCK_SIZE, false, clearingLines.includes(r));
    }));

    if (currentPiece && clearingLines.length === 0) {
        const ghostY = getGhostPosition();
        currentPiece.shape.forEach((row, r) => row.forEach((cell, c) => {
            if (cell) {
                drawBlock(currentPiece.x+c, ghostY+r, currentPiece.color, ctx, BLOCK_SIZE, true);
                drawBlock(currentPiece.x+c, currentPiece.y+r, currentPiece.color, ctx, BLOCK_SIZE);
            }
        }));
    }

    // Efectos
    particles = particles.filter(p => p.life > 0);
    particles.forEach(p => { p.update(); p.draw(ctx); });
    
    floatingTexts = floatingTexts.filter(t => t.life > 0);
    floatingTexts.forEach(t => { t.update(); t.draw(ctx); });

    ctx.restore();
    drawNextPiece();
}

function hardDrop() {
    if (!currentPiece || !gameRunning || isPaused || clearingLines.length > 0) return;
    const ghostY = getGhostPosition();
    const dist = ghostY - currentPiece.y;
    currentPiece.y = ghostY; score += dist * 2;
    createSynthNote(150, 0.1, 0.1, 'sawtooth');
    lockPiece();
}

function lockPiece() {
    currentPiece.shape.forEach((row, r) => row.forEach((cell, c) => {
        if (cell && currentPiece.y + r >= 0) grid[currentPiece.y + r][currentPiece.x + c] = currentPiece.color + 1;
    }));
    
    const linesToClear = [];
    for (let r = ROWS - 1; r >= 0; r--) { if (grid[r].every(cell => cell !== 0)) linesToClear.push(r); }

    if (linesToClear.length > 0) {
        comboCount++;
        triggerLineClear(linesToClear);
    } else {
        comboCount = 0; // Se rompe el combo si no limpias líneas
        nextTurn();
    }
}

function triggerLineClear(linesToClear) {
    clearingLines = linesToClear;
    if (linesToClear.length >= 4) { shakeTime = 20; createSynthNote(100, 0.2, 0.4, 'sawtooth'); }
    
    // Si hay combo, mostrar texto flotante
    if (comboCount > 1) {
        floatingTexts.push(new FloatingText(`COMBO x${comboCount}`, 50, 200, "#feca57"));
        createSynthNote(440 + (comboCount * 50), 0.1, 0.2, 'sine');
    }

    linesToClear.forEach(r => {
        for (let c = 0; c < COLS; c++) {
            const col = colors[grid[r][c]-1][0];
            for (let i=0; i<4; i++) particles.push(new Particle(c*BLOCK_SIZE+15, r*BLOCK_SIZE+15, col));
        }
    });

    setTimeout(() => {
        linesToClear.forEach(r => { grid.splice(r,1); grid.unshift(Array(COLS).fill(0)); });
        updateScore(linesToClear.length);
        clearingLines = [];
        nextTurn();
    }, 150);
}

function nextTurn() {
    currentPiece = nextPiece; nextPiece = createPiece();
    if (!isValidMove(currentPiece)) gameOver();
}

function updateScore(n) {
    lines += n;
    // Puntos base + Bonus Tetris + Multiplicador de Combo
    let basePoints = n * 100 * level;
    if (n === 4) basePoints += 400; 
    score += basePoints * (comboCount > 0 ? comboCount : 1);

    let newLevel = Math.floor(lines / 10) + 1;
    if (newLevel > level) {
        level = newLevel; dropInterval = Math.max(50, 1000 * Math.pow(0.85, level - 1));
    }
    document.getElementById('score').innerText = `Puntuación: ${score}`;
    document.getElementById('level').innerText = `Nivel: ${level}`;
    document.getElementById('lines').innerText = `Líneas: ${lines}`;
    if (score > highScore) { highScore = score; localStorage.setItem('tetrisHighScore', highScore); }
    document.getElementById('high-score').innerText = `Record: ${highScore}`;
}

function update(time = 0) {
    if (!gameRunning || isPaused) return;
    const deltaTime = time - lastTime; lastTime = time;
    if (clearingLines.length === 0) {
        dropCounter += deltaTime;
        if (dropCounter > dropInterval) {
            if (isValidMove(currentPiece, 0, 1)) { currentPiece.y++; } else { lockPiece(); }
            dropCounter = 0;
        }
    }
    draw(); requestId = requestAnimationFrame(update);
}

// Funciones Auxiliares
function createGrid() { return Array.from({length: ROWS}, () => Array(COLS).fill(0)); }
function createPiece() {
    const type = Math.floor(Math.random() * pieces.length);
    return { shape: pieces[type][0], color: type, x: 3, y: 0, rotation: 0, type: type };
}
function isValidMove(p, dx=0, dy=0, shp=p.shape) {
    return shp.every((row, r) => row.every((cell, c) => {
        if (!cell) return true;
        let x = p.x + c + dx, y = p.y + r + dy;
        return x >= 0 && x < COLS && y < ROWS && (y < 0 || !grid[y][x]);
    }));
}

function drawNextPiece() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    if (!nextPiece) return;
    const bSize = 22; const shape = nextPiece.shape;
    const offsetX = (nextCanvas.width - (shape[0].length * bSize)) / 2;
    const offsetY = (nextCanvas.height - (shape.length * bSize)) / 2;
    shape.forEach((row, r) => row.forEach((cell, c) => {
        if (cell) drawBlock((offsetX/bSize)+c, (offsetY/bSize)+r, nextPiece.color, nextCtx, bSize);
    }));
}

// Navegación
function startGame() {
    stopAllMusic(); cancelAnimationFrame(requestId);
    gameRunning = true; isPaused = false; grid = createGrid();
    currentPiece = createPiece(); nextPiece = createPiece();
    score = 0; level = 1; lines = 0; dropInterval = 1000; comboCount = 0;
    lastTime = performance.now(); updateScore(0);
    musicStep = 0; playOriginalMusic(); update();
    document.getElementById('start-menu').classList.add('hidden');
    document.getElementById('game-over').classList.add('hidden');
    document.getElementById('config-panel').classList.add('hidden');
}

function togglePause() {
    if (!gameRunning) return;
    isPaused = !isPaused; stopAllMusic();
    if (isPaused) { cancelAnimationFrame(requestId); document.getElementById('pause-btn').innerText = 'Continuar'; }
    else { document.getElementById('pause-btn').innerText = 'Pausa'; lastTime = performance.now(); playOriginalMusic(); update(); }
}

function gameOver() { gameRunning = false; stopAllMusic(); document.getElementById('game-over').classList.remove('hidden'); musicStep = 0; playMenuMusic(); }
function backToMenu() { 
    gameRunning = false; isPaused = false; cancelAnimationFrame(requestId); stopAllMusic();
    document.getElementById('start-menu').classList.remove('hidden');
    document.getElementById('game-over').classList.add('hidden');
    ctx.clearRect(0, 0, canvas.width, canvas.height); musicStep = 0; playMenuMusic();
}

function stopAllMusic() { clearTimeout(menuMusicTimeout); clearTimeout(gameMusicTimeout); }
function playMenuMusic() {
    if (gameRunning) return; stopAllMusic();
    const menuS = [261.63, 329.63, 392.00, 523.25, 659.25];
    createSynthNote(menuS[musicStep % menuS.length], 0.015, 1.5, 'sine');
    musicStep++; menuMusicTimeout = setTimeout(playMenuMusic, 600);
}
function playOriginalMusic() {
    if (!gameRunning || isPaused) return;
    const gameS = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00];
    if (musicStep % 4 === 0) createSynthNote(220 / 2, 0.04, 0.4, 'triangle');
    createSynthNote(gameS[Math.floor(Math.random() * gameS.length)], 0.02, 0.6, 'sine');
    musicStep++; gameMusicTimeout = setTimeout(playOriginalMusic, Math.max(110, 220 - (level * 10)));
}

// Configuración y Eventos
const volumeSlider = document.getElementById('volume-slider');
document.getElementById('config-btn').onclick = () => { document.getElementById('start-menu').classList.add('hidden'); document.getElementById('config-panel').classList.remove('hidden'); };
document.getElementById('close-config-btn').onclick = () => { document.getElementById('config-panel').classList.add('hidden'); document.getElementById('start-menu').classList.remove('hidden'); };
volumeSlider.oninput = (e) => { globalVolume = e.target.value / 100; document.getElementById('volume-value').innerText = `${e.target.value}%`; };

document.getElementById('main-start-btn').onclick = startGame;
document.getElementById('reset-btn').onclick = startGame;
document.getElementById('restart-btn').onclick = startGame;
document.getElementById('pause-btn').onclick = togglePause;
document.getElementById('menu-btn').onclick = backToMenu;
document.getElementById('exit-to-menu-btn').onclick = backToMenu;

document.addEventListener('keydown', e => {
    if (!gameRunning || isPaused || !currentPiece || clearingLines.length > 0) return;
    if (e.key === 'ArrowLeft' && isValidMove(currentPiece, -1, 0)) currentPiece.x--;
    if (e.key === 'ArrowRight' && isValidMove(currentPiece, 1, 0)) currentPiece.x++;
    if (e.key === 'ArrowDown') { if (isValidMove(currentPiece, 0, 1)) currentPiece.y++; score += 1; updateScore(0); }
    if (e.key === ' ') { hardDrop(); }
    if (e.key === 'ArrowUp') {
        const nRot = (currentPiece.rotation + 1) % pieces[currentPiece.type].length;
        const nShp = pieces[currentPiece.type][nRot];
        if (isValidMove(currentPiece, 0, 0, nShp)) {
            currentPiece.rotation = nRot; currentPiece.shape = nShp;
            createSynthNote(600, 0.03, 0.05, 'sine');
        }
    }
});

window.onload = () => playMenuMusic();