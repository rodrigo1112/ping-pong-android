'use strict';

/**
 * NEON PONG — versión móvil Android (Capacitor) optimizada para GPU y batería.
 * - Tope estricto a 60 FPS (evita trabajo extra en pantallas 90/120 Hz).
 * - Sprites neón pre-renderizados en offscreen canvas (cero ctx.shadowBlur en runtime).
 * - Resolución adaptativa limitada a DPR <= 1.5.
 * - Pool de partículas y ring buffer de estela sin asignaciones por frame.
 * - Pausa total del bucle de renderizado en reposo (menú, pausa, fin y segundo plano).
 */
(() => {
  // ==========================================================
  //  Constantes
  // ==========================================================
  const W = 960;
  const H = 600;
  const PADDLE_W = 14;
  const PADDLE_H = 100;
  const PADDLE_MARGIN = 28;
  const BALL_R = 8;
  const WIN_SCORE = 7;
  const BALL_START_SPEED = 430;
  const BALL_MAX_SPEED = 1150;
  const BALL_SPEEDUP = 1.06;
  const MAX_BOUNCE_ANGLE = Math.PI * 0.3;
  const PLAYER_SPEED = 640;
  const PLAYER_POINTER_SPEED = 2400;
  const COUNTDOWN_TIME = 3;

  // Límites de rendimiento y memoria
  const MAX_FPS = 60;
  const FRAME_INTERVAL = 1000 / MAX_FPS; // ~16.67 ms
  const FRAME_TOLERANCE = 1.0;           // evita caídas por jitter en paneles de 60 Hz
  const MAX_DPR = 1.5;
  const SPRITE_SCALE = 1.5;
  const MAX_PARTICLES = 48;
  const TRAIL_LENGTH = 12;

  const COLORS = {
    bg: '#0b0f19',
    player: '#22d3ee',
    ai: '#f472b6',
    ball: '#f8fafc',
    ballGlow: '#a5f3fc',
    line: 'rgba(148, 163, 184, 0.22)',
    violet: '#a78bfa',
  };

  const PARTICLE_COLORS = [COLORS.player, COLORS.ai, COLORS.violet];
  const COLOR_IDX_PLAYER = 0;
  const COLOR_IDX_AI = 1;
  const COLOR_IDX_VIOLET = 2;

  const DIFFICULTY = {
    easy:   { label: 'FÁCIL',   maxSpeed: 300, accel: 1800, reaction: 0.34, error: 80 },
    normal: { label: 'NORMAL',  maxSpeed: 430, accel: 2800, reaction: 0.20, error: 46 },
    hard:   { label: 'DIFÍCIL', maxSpeed: 570, accel: 4200, reaction: 0.10, error: 24 },
  };

  // ==========================================================
  //  Utilidades
  // ==========================================================
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const rand = (min, max) => min + Math.random() * (max - min);

  function drawRoundedRectPath(targetCtx, x, y, w, h, r) {
    targetCtx.beginPath();
    targetCtx.moveTo(x + r, y);
    targetCtx.arcTo(x + w, y, x + w, y + h, r);
    targetCtx.arcTo(x + w, y + h, x, y + h, r);
    targetCtx.arcTo(x, y + h, x, y, r);
    targetCtx.arcTo(x, y, x + w, y, r);
    targetCtx.closePath();
  }

  function createOffscreen(logicalW, logicalH) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(logicalW * SPRITE_SCALE);
    c.height = Math.ceil(logicalH * SPRITE_SCALE);
    const cctx = c.getContext('2d');
    cctx.setTransform(SPRITE_SCALE, 0, 0, SPRITE_SCALE, 0, 0);
    return { canvas: c, ctx: cctx };
  }

  // ==========================================================
  //  Sprites neón pre-renderizados (cero shadowBlur en runtime)
  // ==========================================================
  const BG_PAD = 16;
  const PADDLE_PAD = 18;
  const PADDLE_SPRITE_W = PADDLE_W + PADDLE_PAD * 2;
  const PADDLE_SPRITE_H = PADDLE_H + PADDLE_PAD * 2;
  const BALL_SPRITE_SIZE = 52;
  const BALL_SPRITE_HALF = BALL_SPRITE_SIZE / 2;
  const COUNTDOWN_SPRITE_SIZE = 200;
  const COUNTDOWN_SPRITE_HALF = COUNTDOWN_SPRITE_SIZE / 2;

  function buildBackgroundSprite() {
    const { canvas: c, ctx: g } = createOffscreen(W + BG_PAD * 2, H + BG_PAD * 2);
    g.translate(BG_PAD, BG_PAD);

    g.fillStyle = COLORS.bg;
    g.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);

    // Rejilla sutil pre-calculada una sola vez
    g.strokeStyle = 'rgba(34, 211, 238, 0.04)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 40) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();

    // Línea central discontinua
    g.save();
    g.strokeStyle = COLORS.line;
    g.lineWidth = 4;
    g.setLineDash([18, 16]);
    g.lineDashOffset = -6;
    g.beginPath();
    g.moveTo(W / 2, 0);
    g.lineTo(W / 2, H);
    g.stroke();
    g.restore();

    // Círculo central concéntrico
    g.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
    g.stroke();

    // Borde sutil superior e inferior
    g.fillStyle = 'rgba(34, 211, 238, 0.16)';
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(244, 114, 182, 0.16)';
    g.fillRect(0, H - 2, W, 2);

    return c;
  }

  function buildPaddleSprite(color, isFlash) {
    const { canvas: c, ctx: g } = createOffscreen(PADDLE_SPRITE_W, PADDLE_SPRITE_H);
    const x = PADDLE_PAD;
    const y = PADDLE_PAD;

    // Halo neón con trazos/capas concéntricas semitransparentes (sin shadowBlur)
    const layers = isFlash
      ? [
          { pad: 15, alpha: 0.09, r: 16 },
          { pad: 10, alpha: 0.18, r: 13 },
          { pad: 5,  alpha: 0.32, r: 9 },
        ]
      : [
          { pad: 11, alpha: 0.06, r: 14 },
          { pad: 7,  alpha: 0.13, r: 11 },
          { pad: 3.5, alpha: 0.28, r: 8 },
        ];

    g.fillStyle = color;
    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      g.globalAlpha = l.alpha;
      drawRoundedRectPath(g, x - l.pad, y - l.pad, PADDLE_W + l.pad * 2, PADDLE_H + l.pad * 2, l.r);
      g.fill();
    }

    if (!isFlash) {
      // Cuerpo sólido de alto contraste
      g.globalAlpha = 1;
      g.fillStyle = color;
      drawRoundedRectPath(g, x, y, PADDLE_W, PADDLE_H, 6);
      g.fill();

      // Núcleo interno brillante
      g.fillStyle = 'rgba(255, 255, 255, 0.34)';
      drawRoundedRectPath(g, x + 3.5, y + 6, PADDLE_W - 7, PADDLE_H - 12, 3);
      g.fill();
    } else {
      // Destello blanco al golpear la pelota
      g.globalAlpha = 0.72;
      g.fillStyle = '#ffffff';
      drawRoundedRectPath(g, x + 2, y + 3, PADDLE_W - 4, PADDLE_H - 6, 4);
      g.fill();
    }

    g.globalAlpha = 1;
    return c;
  }

  function buildBallSprite() {
    const { canvas: c, ctx: g } = createOffscreen(BALL_SPRITE_SIZE, BALL_SPRITE_SIZE);
    const cx = BALL_SPRITE_HALF;
    const cy = BALL_SPRITE_HALF;

    // Halo radial pre-calculado una sola vez
    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, BALL_SPRITE_HALF - 2);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.28, '#e0f2fe');
    grad.addColorStop(0.45, 'rgba(165, 243, 252, 0.58)');
    grad.addColorStop(0.72, 'rgba(34, 211, 238, 0.18)');
    grad.addColorStop(1.0, 'rgba(34, 211, 238, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, BALL_SPRITE_HALF - 2, 0, Math.PI * 2);
    g.fill();

    // Núcleo nítido
    g.fillStyle = COLORS.ball;
    g.beginPath();
    g.arc(cx, cy, BALL_R, 0, Math.PI * 2);
    g.fill();

    return c;
  }

  function buildTrailDotSprite() {
    const size = 20;
    const half = size / 2;
    const { canvas: c, ctx: g } = createOffscreen(size, size);
    const grad = g.createRadialGradient(half, half, 1, half, half, half);
    grad.addColorStop(0.0, 'rgba(165, 243, 252, 0.95)');
    grad.addColorStop(0.55, 'rgba(34, 211, 238, 0.45)');
    grad.addColorStop(1.0, 'rgba(34, 211, 238, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(half, half, half, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function buildCountdownDigitSprite(digit) {
    const { canvas: c, ctx: g } = createOffscreen(COUNTDOWN_SPRITE_SIZE, COUNTDOWN_SPRITE_SIZE);
    const cx = COUNTDOWN_SPRITE_HALF;
    const cy = COUNTDOWN_SPRITE_HALF;
    g.font = '900 132px "Segoe UI", system-ui, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';

    // Capas concéntricas simulando brillo neón sin shadowBlur
    g.strokeStyle = 'rgba(167, 139, 250, 0.16)';
    g.lineWidth = 20;
    g.strokeText(digit, cx, cy);

    g.strokeStyle = 'rgba(167, 139, 250, 0.34)';
    g.lineWidth = 9;
    g.strokeText(digit, cx, cy);

    g.fillStyle = COLORS.violet;
    g.fillText(digit, cx, cy);

    g.strokeStyle = 'rgba(237, 233, 254, 0.75)';
    g.lineWidth = 2;
    g.strokeText(digit, cx, cy);

    return c;
  }

  const Sprites = {
    bg: buildBackgroundSprite(),
    player: buildPaddleSprite(COLORS.player, false),
    playerFlash: buildPaddleSprite(COLORS.player, true),
    ai: buildPaddleSprite(COLORS.ai, false),
    aiFlash: buildPaddleSprite(COLORS.ai, true),
    ball: buildBallSprite(),
    trailDot: buildTrailDotSprite(),
    digits: {
      1: buildCountdownDigitSprite('1'),
      2: buildCountdownDigitSprite('2'),
      3: buildCountdownDigitSprite('3'),
    },
  };

  // Tablas pre-calculadas para la estela (cero cálculos/strings por frame)
  const TRAIL_ALPHAS = new Float32Array(TRAIL_LENGTH);
  const TRAIL_SIZES = new Float32Array(TRAIL_LENGTH);
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const k = (i + 1) / TRAIL_LENGTH;
    TRAIL_ALPHAS[i] = k * 0.42;
    TRAIL_SIZES[i] = BALL_R * 2 * (0.45 + k * 0.75);
  }

  // ==========================================================
  //  Audio procedural (Web Audio API compatible con WebView Android)
  // ==========================================================
  const Sound = {
    ctx: null,
    master: null,
    muted: localStorage.getItem('neonpong-muted') === '1',
    volume: 0.5,

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
      }
      this.resume();
    },

    resume() {
      const audioCtx = this.ctx;
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }
    },

    suspend() {
      const audioCtx = this.ctx;
      if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend().catch(() => {});
      }
    },

    setMuted(muted) {
      this.muted = muted;
      localStorage.setItem('neonpong-muted', muted ? '1' : '0');
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
      }
    },

    tone({ freq, to = null, dur = 0.1, type = 'square', vol = 0.25, delay = 0 }) {
      if (!this.ctx || this.muted || document.hidden) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.03);
    },

    paddle(speedRatio) {
      const f = 360 + speedRatio * 320;
      this.tone({ freq: f, to: f * 1.6, dur: 0.09, type: 'square', vol: 0.18 });
      this.tone({ freq: f / 2, dur: 0.06, type: 'sine', vol: 0.25 });
    },

    wall() {
      this.tone({ freq: 260, to: 170, dur: 0.07, type: 'triangle', vol: 0.32 });
    },

    score(playerScored) {
      const notes = playerScored ? [523, 659, 784] : [392, 311, 233];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.16, type: 'sawtooth', vol: 0.12, delay: i * 0.1 });
      }
    },

    countdown(final) {
      this.tone({ freq: final ? 880 : 440, dur: final ? 0.28 : 0.12, type: 'sine', vol: 0.28 });
    },

    win() {
      const notes = [523, 659, 784, 1047];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.22, type: 'square', vol: 0.12, delay: i * 0.12 });
      }
    },

    lose() {
      const notes = [392, 349, 311, 262];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], to: notes[i] * 0.97, dur: 0.28, type: 'triangle', vol: 0.22, delay: i * 0.16 });
      }
    },

    click() {
      this.tone({ freq: 660, dur: 0.05, type: 'sine', vol: 0.15 });
    },
  };

  function unlockAudio() {
    Sound.init();
    const audioCtx = Sound.ctx;
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  window.addEventListener('touchstart', unlockAudio, { passive: true, capture: true });
  window.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });

  // ==========================================================
  //  DOM y resolución adaptativa
  // ==========================================================
  const appEl = document.getElementById('app');
  const stageEl = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const el = {
    menu: document.getElementById('menu'),
    pause: document.getElementById('pause'),
    gameover: document.getElementById('gameover'),
    scorePlayer: document.getElementById('score-player'),
    scoreAi: document.getElementById('score-ai'),
    diffLabel: document.getElementById('diff-label'),
    resultTitle: document.getElementById('result-title'),
    resultScore: document.getElementById('result-score'),
    muteBtn: document.getElementById('mute-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    diffBtns: document.querySelectorAll('.diff-btn'),
  };

  let canvasRect = { top: 0, height: H };

  function refreshCanvasRect() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width && rect.height) {
      canvasRect = rect;
    }
    return rect;
  }

  function resizeCanvas() {
    const rect = refreshCanvasRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const nextW = Math.max(1, Math.min(Math.round(rect.width * dpr), Math.round(W * dpr)));
    const nextH = Math.max(1, Math.min(Math.round(rect.height * dpr), Math.round(H * dpr)));
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    if (!loopActive) render();
  }

  // ==========================================================
  //  Estado del juego y pools pre-asignados (cero GC en juego)
  // ==========================================================
  const player = { x: PADDLE_MARGIN, y: H / 2 - PADDLE_H / 2, w: PADDLE_W, h: PADDLE_H, vy: 0, flash: 0 };
  const ai = {
    x: W - PADDLE_MARGIN - PADDLE_W, y: H / 2 - PADDLE_H / 2, w: PADDLE_W, h: PADDLE_H, vy: 0, flash: 0,
    target: H / 2, reactTimer: 0, thinkTimer: 0, errorOffset: 0, lastDir: 0,
  };
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BALL_START_SPEED };

  // Ring buffer de estela sin asignaciones por frame
  const trailX = new Float32Array(TRAIL_LENGTH);
  const trailY = new Float32Array(TRAIL_LENGTH);
  let trailHead = 0;
  let trailCount = 0;

  function clearTrail() {
    trailHead = 0;
    trailCount = 0;
  }

  function pushTrail(x, y) {
    trailX[trailHead] = x;
    trailY[trailHead] = y;
    trailHead = (trailHead + 1) % TRAIL_LENGTH;
    if (trailCount < TRAIL_LENGTH) trailCount++;
  }

  // Pool fijo de partículas (SoA en TypedArrays: cero objetos nuevos, cero splice)
  const pX = new Float32Array(MAX_PARTICLES);
  const pY = new Float32Array(MAX_PARTICLES);
  const pVx = new Float32Array(MAX_PARTICLES);
  const pVy = new Float32Array(MAX_PARTICLES);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pInvMax = new Float32Array(MAX_PARTICLES);
  const pSize = new Float32Array(MAX_PARTICLES);
  const pColor = new Uint8Array(MAX_PARTICLES);
  let particleCount = 0;

  function clearParticles() {
    particleCount = 0;
  }

  const game = {
    state: 'menu', // menu | countdown | playing | paused | gameover
    pausedFrom: null,
    difficulty: 'normal',
    scores: { player: 0, ai: 0 },
    countdown: 0,
    lastCountShown: 0,
    serveDir: 1,
    rally: 0,
    shake: 0,
  };

  let activeTouchId = null;
  let rafId = 0;
  let loopActive = false;
  let lastRenderTime = 0;
  let lastUpdateTime = 0;

  const input = {
    up: false,
    down: false,
    mouseY: H / 2,
    mouseActive: false,
  };

  // ==========================================================
  //  Control del bucle (60 FPS + ahorro total en reposo)
  // ==========================================================
  function shouldRunLoop() {
    return !document.hidden && (game.state === 'playing' || game.state === 'countdown');
  }

  function startLoop() {
    if (loopActive || !shouldRunLoop()) return;
    loopActive = true;
    const now = performance.now();
    lastRenderTime = now - FRAME_INTERVAL;
    lastUpdateTime = now;
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    loopActive = false;
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function renderStatic() {
    stopLoop();
    render();
  }

  // ==========================================================
  //  Flujo de partida
  // ==========================================================
  function updatePauseBtn() {
    const show = game.state === 'playing' || game.state === 'countdown' || game.state === 'paused';
    el.pauseBtn.classList.toggle('hidden', !show);
  }

  function setOverlay(name) {
    el.menu.classList.toggle('visible', name === 'menu');
    el.pause.classList.toggle('visible', name === 'pause');
    el.gameover.classList.toggle('visible', name === 'gameover');
    updatePauseBtn();
  }

  function updateScoreboard(bumpWho) {
    el.scorePlayer.textContent = game.scores.player;
    el.scoreAi.textContent = game.scores.ai;
    if (bumpWho) {
      const node = bumpWho === 'player' ? el.scorePlayer : el.scoreAi;
      node.classList.remove('bump');
      void node.offsetWidth;
      node.classList.add('bump');
    }
  }

  function setDifficulty(diff) {
    game.difficulty = diff;
    el.diffLabel.textContent = DIFFICULTY[diff].label;
    el.diffBtns.forEach((b) => {
      const sel = b.dataset.diff === diff;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', String(sel));
    });
    localStorage.setItem('neonpong-difficulty', diff);
  }

  function resetPaddles() {
    player.y = H / 2 - PADDLE_H / 2;
    ai.y = H / 2 - PADDLE_H / 2;
    player.vy = ai.vy = 0;
    player.flash = ai.flash = 0;
    ai.target = H / 2;
    ai.lastDir = 0;
    input.mouseY = H / 2;
    input.mouseActive = false;
    activeTouchId = null;
  }

  function resetBall() {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = ball.vy = 0;
    ball.speed = BALL_START_SPEED;
    clearTrail();
    game.rally = 0;
    game.shake = 0;
  }

  function startMatch() {
    unlockAudio();
    game.scores.player = 0;
    game.scores.ai = 0;
    updateScoreboard();
    clearParticles();
    resetPaddles();
    game.serveDir = Math.random() < 0.5 ? -1 : 1;
    startCountdown();
    setOverlay(null);
    startLoop();
  }

  function startCountdown() {
    resetBall();
    game.state = 'countdown';
    game.countdown = COUNTDOWN_TIME;
    game.lastCountShown = 0;
    updatePauseBtn();
  }

  function serve() {
    const angle = rand(-0.35, 0.35);
    ball.speed = BALL_START_SPEED;
    ball.vx = game.serveDir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    game.state = 'playing';
    updatePauseBtn();
  }

  function togglePause() {
    if (game.state === 'playing' || game.state === 'countdown') {
      game.pausedFrom = game.state;
      game.state = 'paused';
      activeTouchId = null;
      setOverlay('pause');
      Sound.click();
      renderStatic();
    } else if (game.state === 'paused') {
      unlockAudio();
      game.state = game.pausedFrom || 'playing';
      setOverlay(null);
      Sound.click();
      startLoop();
    }
  }

  function goToMenu() {
    game.state = 'menu';
    game.scores.player = game.scores.ai = 0;
    updateScoreboard();
    clearParticles();
    resetPaddles();
    resetBall();
    setOverlay('menu');
    renderStatic();
  }

  function pointScored(who) {
    game.scores[who] += 1;
    updateScoreboard(who);
    Sound.score(who === 'player');
    game.shake = 9;

    const x = who === 'player' ? W : 0;
    spawnSparks(
      x,
      ball.y,
      who === 'player' ? -1 : 1,
      20,
      who === 'player' ? COLOR_IDX_PLAYER : COLOR_IDX_AI,
      1.5
    );

    if (game.scores[who] >= WIN_SCORE) {
      endMatch(who === 'player');
      return;
    }
    game.serveDir = who === 'player' ? 1 : -1;
    startCountdown();
  }

  function endMatch(playerWon) {
    game.state = 'gameover';
    activeTouchId = null;
    resetBall();
    clearParticles();
    el.resultTitle.textContent = playerWon ? '¡VICTORIA!' : 'DERROTA';
    el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
    el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
    setTimeout(() => (playerWon ? Sound.win() : Sound.lose()), 350);
    setOverlay('gameover');
    renderStatic();
  }

  // ==========================================================
  //  Partículas (pool fijo sin Garbage Collection)
  // ==========================================================
  function spawnSparks(x, y, dir, count, colorIdx, power = 1) {
    const budget = Math.min(count, MAX_PARTICLES - particleCount);
    for (let i = 0; i < budget; i++) {
      const idx = particleCount++;
      const a = rand(-Math.PI / 2.6, Math.PI / 2.6);
      const s = rand(120, 400) * power;
      const life = rand(0.22, 0.52);
      pX[idx] = x;
      pY[idx] = y;
      pVx[idx] = Math.cos(a) * s * dir;
      pVy[idx] = Math.sin(a) * s;
      pLife[idx] = life;
      pInvMax[idx] = 1 / life;
      pSize[idx] = rand(2.2, 4.6);
      pColor[idx] = colorIdx;
    }
  }

  function updateParticles(dt) {
    if (particleCount === 0) return;
    const drag = Math.pow(0.04, dt);
    let i = particleCount - 1;
    while (i >= 0) {
      const life = pLife[i] - dt;
      if (life <= 0) {
        const last = --particleCount;
        if (i !== last) {
          pX[i] = pX[last];
          pY[i] = pY[last];
          pVx[i] = pVx[last];
          pVy[i] = pVy[last];
          pLife[i] = pLife[last];
          pInvMax[i] = pInvMax[last];
          pSize[i] = pSize[last];
          pColor[i] = pColor[last];
        }
      } else {
        pLife[i] = life;
        pVx[i] *= drag;
        pVy[i] *= drag;
        pX[i] += pVx[i] * dt;
        pY[i] += pVy[i] * dt;
      }
      i--;
    }
  }

  // ==========================================================
  //  Física
  // ==========================================================
  function circleRectHit(p) {
    const cx = clamp(ball.x, p.x, p.x + p.w);
    const cy = clamp(ball.y, p.y, p.y + p.h);
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    return dx * dx + dy * dy <= BALL_R * BALL_R;
  }

  function hitPaddle(p, dir) {
    const rel = clamp((ball.y - (p.y + p.h / 2)) / (p.h / 2 + BALL_R), -1, 1);
    const angle = rel * MAX_BOUNCE_ANGLE;

    ball.speed = Math.min(ball.speed * BALL_SPEEDUP, BALL_MAX_SPEED);
    ball.vx = dir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.x = dir > 0 ? p.x + p.w + BALL_R : p.x - BALL_R;

    game.rally++;
    p.flash = 1;
    const ratio = (ball.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED);
    Sound.paddle(ratio);
    spawnSparks(
      ball.x,
      ball.y,
      dir,
      8 + Math.round(ratio * 6),
      p === player ? COLOR_IDX_PLAYER : COLOR_IDX_AI
    );
    game.shake = Math.max(game.shake, 2 + ratio * 3.5);
  }

  function updateBall(dt) {
    const steps = Math.max(1, Math.ceil((ball.speed * dt) / (BALL_R * 0.5)));
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R + (BALL_R - ball.y);
        ball.vy = Math.abs(ball.vy);
        Sound.wall();
        spawnSparks(ball.x, 0, 1, 4, COLOR_IDX_VIOLET, 0.5);
      } else if (ball.y + BALL_R > H) {
        ball.y = H - BALL_R - (ball.y + BALL_R - H);
        ball.vy = -Math.abs(ball.vy);
        Sound.wall();
        spawnSparks(ball.x, H, 1, 4, COLOR_IDX_VIOLET, 0.5);
      }

      if (ball.vx < 0 && ball.x >= player.x + player.w / 2 && circleRectHit(player)) {
        hitPaddle(player, 1);
      } else if (ball.vx > 0 && ball.x <= ai.x + ai.w / 2 && circleRectHit(ai)) {
        hitPaddle(ai, -1);
      }

      if (ball.x + BALL_R < 0 || ball.x - BALL_R > W) {
        pointScored(ball.x < 0 ? 'ai' : 'player');
        return;
      }
    }
  }

  // ==========================================================
  //  Jugador e IA
  // ==========================================================
  function updatePlayer(dt) {
    const dir = (input.down ? 1 : 0) - (input.up ? 1 : 0);
    let targetVy;

    if (dir !== 0) {
      input.mouseActive = false;
      targetVy = dir * PLAYER_SPEED;
    } else if (input.mouseActive) {
      const diff = input.mouseY - (player.y + player.h / 2);
      targetVy = clamp(diff * 22, -PLAYER_POINTER_SPEED, PLAYER_POINTER_SPEED);
    } else {
      targetVy = 0;
    }

    const smoothing = input.mouseActive ? 1 : 1 - Math.pow(0.0001, dt);
    player.vy += (targetVy - player.vy) * smoothing;
    player.y = clamp(player.y + player.vy * dt, 0, H - player.h);
    if (player.y === 0 || player.y === H - player.h) {
      if ((player.y === 0 && player.vy < 0) || (player.y > 0 && player.vy > 0)) player.vy = 0;
    }
  }

  function predictBallY(targetX) {
    if (ball.vx === 0) return ball.y;
    const t = (targetX - ball.x) / ball.vx;
    if (t < 0) return ball.y;
    const minY = BALL_R;
    const span = H - 2 * BALL_R;
    let rel = (ball.y + ball.vy * t - minY) % (2 * span);
    if (rel < 0) rel += 2 * span;
    return minY + (rel > span ? 2 * span - rel : rel);
  }

  function updateAI(dt) {
    const cfg = DIFFICULTY[game.difficulty];
    const center = ai.y + ai.h / 2;

    if (game.state === 'playing') {
      const dir = Math.sign(ball.vx);

      if (dir !== ai.lastDir) {
        ai.lastDir = dir;
        ai.reactTimer = cfg.reaction * rand(0.7, 1.4);
        ai.thinkTimer = 0;
        const speedFactor = 1 + ((ball.speed - BALL_START_SPEED) / BALL_START_SPEED) * 0.9;
        ai.errorOffset = rand(-1, 1) * cfg.error * speedFactor;
        if (Math.random() < 0.08) ai.errorOffset *= 1.8;
      }

      if (ai.reactTimer > 0) {
        ai.reactTimer -= dt;
      } else {
        ai.thinkTimer -= dt;
        if (ai.thinkTimer <= 0) {
          ai.thinkTimer = cfg.reaction * 0.6;
          if (dir > 0) {
            const distFrac = clamp((ai.x - ball.x) / W, 0, 1);
            const err = ai.errorOffset * (0.55 + 0.45 * distFrac);
            ai.target = predictBallY(ai.x - BALL_R) + err;
          } else {
            ai.target = H / 2 + (ball.y - H / 2) * 0.3;
          }
        }
      }
    } else {
      ai.target = H / 2;
    }

    const diff = ai.target - center;
    const desired = Math.abs(diff) < 5 ? 0 : clamp(diff * 7, -cfg.maxSpeed, cfg.maxSpeed);
    const maxDv = cfg.accel * dt;
    ai.vy += clamp(desired - ai.vy, -maxDv, maxDv);
    ai.y += ai.vy * dt;
    if (ai.y < 0) { ai.y = 0; ai.vy = 0; }
    if (ai.y > H - ai.h) { ai.y = H - ai.h; ai.vy = 0; }
  }

  // ==========================================================
  //  Actualización
  // ==========================================================
  function update(dt) {
    if (game.state === 'countdown') {
      updatePlayer(dt);
      updateAI(dt);
      game.countdown -= dt;
      const shown = Math.ceil(game.countdown);
      if (shown !== game.lastCountShown && shown > 0) {
        game.lastCountShown = shown;
        Sound.countdown(false);
      }
      if (game.countdown <= 0) {
        Sound.countdown(true);
        serve();
      }
    } else if (game.state === 'playing') {
      updatePlayer(dt);
      updateAI(dt);
      updateBall(dt);
      if (game.state === 'playing') {
        pushTrail(ball.x, ball.y);
      }
    }

    updateParticles(dt);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
    if (player.flash > 0) player.flash = Math.max(0, player.flash - dt * 4.5);
    if (ai.flash > 0) ai.flash = Math.max(0, ai.flash - dt * 4.5);
  }

  // ==========================================================
  //  Renderizado ligero (solo drawImage y fillRect, cero shadowBlur)
  // ==========================================================
  function drawPaddle(p, baseSprite, flashSprite) {
    const dx = p.x - PADDLE_PAD;
    const dy = p.y - PADDLE_PAD;
    ctx.drawImage(baseSprite, dx, dy, PADDLE_SPRITE_W, PADDLE_SPRITE_H);
    if (p.flash > 0.01) {
      ctx.globalAlpha = p.flash;
      ctx.drawImage(flashSprite, dx, dy, PADDLE_SPRITE_W, PADDLE_SPRITE_H);
      ctx.globalAlpha = 1;
    }
  }

  function drawBall() {
    if (trailCount > 0) {
      const startSlot = TRAIL_LENGTH - trailCount;
      for (let i = 0; i < trailCount; i++) {
        const idx = (trailHead - trailCount + i + TRAIL_LENGTH) % TRAIL_LENGTH;
        const slot = startSlot + i;
        const size = TRAIL_SIZES[slot];
        ctx.globalAlpha = TRAIL_ALPHAS[slot];
        ctx.drawImage(Sprites.trailDot, trailX[idx] - size * 0.5, trailY[idx] - size * 0.5, size, size);
      }
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(
      Sprites.ball,
      ball.x - BALL_SPRITE_HALF,
      ball.y - BALL_SPRITE_HALF,
      BALL_SPRITE_SIZE,
      BALL_SPRITE_SIZE
    );
  }

  function drawParticles() {
    if (particleCount === 0) return;
    let lastColor = -1;
    for (let i = 0; i < particleCount; i++) {
      const cIdx = pColor[i];
      if (cIdx !== lastColor) {
        ctx.fillStyle = PARTICLE_COLORS[cIdx];
        lastColor = cIdx;
      }
      const alpha = pLife[i] * pInvMax[i];
      ctx.globalAlpha = alpha > 1 ? 1 : alpha < 0 ? 0 : alpha;
      const s = pSize[i];
      ctx.fillRect(pX[i] - s * 0.5, pY[i] - s * 0.5, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function drawCountdown() {
    const n = Math.ceil(game.countdown);
    if (n <= 0 || n > 3) return;
    const digitSprite = Sprites.digits[n];
    if (!digitSprite) return;

    const frac = game.countdown - Math.floor(game.countdown);
    const scale = 0.8 + frac * 0.55;
    const drawSize = COUNTDOWN_SPRITE_SIZE * scale;

    ctx.globalAlpha = clamp(frac * 1.4, 0, 1);
    ctx.drawImage(
      digitSprite,
      W / 2 - drawSize * 0.5,
      H / 2 - drawSize * 0.5,
      drawSize,
      drawSize
    );
    ctx.globalAlpha = 1;

    ctx.font = '600 16px "Segoe UI", system-ui, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
    ctx.fillText(game.serveDir < 0 ? 'SAQUE HACIA TI' : 'SAQUE HACIA LA IA', W / 2, H / 2 + 110);
  }

  function render() {
    const hasShake = game.shake > 0.1;
    if (hasShake) {
      ctx.save();
      ctx.translate(rand(-game.shake, game.shake) * 0.5, rand(-game.shake, game.shake) * 0.5);
    }

    ctx.drawImage(Sprites.bg, -BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);
    drawPaddle(player, Sprites.player, Sprites.playerFlash);
    drawPaddle(ai, Sprites.ai, Sprites.aiFlash);
    drawParticles();
    if (game.state !== 'gameover') drawBall();
    if (game.state === 'countdown' || (game.state === 'paused' && game.pausedFrom === 'countdown')) {
      drawCountdown();
    }

    if (hasShake) ctx.restore();
  }

  // ==========================================================
  //  Bucle principal con límite estricto a 60 FPS
  // ==========================================================
  function frame(now) {
    rafId = 0;
    if (!loopActive) return;

    const elapsed = now - lastRenderTime;
    if (elapsed < FRAME_INTERVAL - FRAME_TOLERANCE) {
      rafId = requestAnimationFrame(frame);
      return;
    }

    const dt = Math.min(Math.max((now - lastUpdateTime) / 1000, 0), 1 / 20);
    lastUpdateTime = now;
    lastRenderTime = elapsed > FRAME_INTERVAL * 2
      ? now
      : now - Math.max(0, elapsed - FRAME_INTERVAL);

    update(dt);
    if (loopActive) {
      render();
      rafId = requestAnimationFrame(frame);
    }
  }

  // ==========================================================
  //  Entrada táctil, ratón y teclado
  // ==========================================================
  const UP_KEYS = new Set(['KeyW', 'ArrowUp']);
  const DOWN_KEYS = new Set(['KeyS', 'ArrowDown']);

  window.addEventListener('keydown', (e) => {
    if (UP_KEYS.has(e.code)) { input.up = true; e.preventDefault(); }
    else if (DOWN_KEYS.has(e.code)) { input.down = true; e.preventDefault(); }
    else if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (e.code === 'KeyM' && !e.repeat) {
      toggleMute();
    } else if (e.code === 'Enter' && !e.repeat) {
      if (game.state === 'menu' || game.state === 'gameover') { e.preventDefault(); startMatch(); }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (UP_KEYS.has(e.code)) input.up = false;
    else if (DOWN_KEYS.has(e.code)) input.down = false;
  });

  function pointerToField(clientY) {
    if (!canvasRect.height) refreshCanvasRect();
    if (!canvasRect.height) return H / 2;
    return clamp(((clientY - canvasRect.top) / canvasRect.height) * H, 0, H);
  }

  function getTrackedTouch(touchList) {
    if (activeTouchId !== null) {
      for (let i = 0; i < touchList.length; i++) {
        if (touchList[i].identifier === activeTouchId) return touchList[i];
      }
    }
    return touchList[0] || null;
  }

  function handleTouchStart(e) {
    unlockAudio();
    if (!e.changedTouches.length) return;
    const touch = activeTouchId === null ? e.changedTouches[0] : getTrackedTouch(e.touches);
    if (!touch) return;
    activeTouchId = touch.identifier;
    input.mouseY = pointerToField(touch.clientY);
    input.mouseActive = true;
    e.preventDefault();
  }

  function handleTouchMove(e) {
    const touch = getTrackedTouch(e.touches);
    if (!touch) return;
    activeTouchId = touch.identifier;
    input.mouseY = pointerToField(touch.clientY);
    input.mouseActive = true;
    e.preventDefault();
  }

  function handleTouchEnd(e) {
    if (activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) {
        activeTouchId = e.touches.length ? e.touches[0].identifier : null;
        break;
      }
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    input.mouseY = pointerToField(e.clientY);
    input.mouseActive = true;
  });

  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  appEl.addEventListener('touchstart', (e) => {
    if (canvas.contains(e.target) || e.target.closest('button, .overlay.visible')) return;
    handleTouchStart(e);
  }, { passive: false });

  appEl.addEventListener('touchmove', (e) => {
    if (canvas.contains(e.target) || e.target.closest('button, .overlay.visible')) return;
    handleTouchMove(e);
  }, { passive: false });

  appEl.addEventListener('touchend', handleTouchEnd, { passive: true });
  appEl.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  // Ahorro de energía al perder el foco o pasar a segundo plano
  window.addEventListener('blur', () => {
    input.up = input.down = false;
    activeTouchId = null;
    if (game.state === 'playing' || game.state === 'countdown') {
      togglePause();
    } else {
      stopLoop();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.up = input.down = false;
      activeTouchId = null;
      if (game.state === 'playing' || game.state === 'countdown') {
        togglePause();
      } else {
        stopLoop();
      }
      Sound.suspend();
    } else {
      refreshCanvasRect();
      if (shouldRunLoop()) {
        startLoop();
      } else {
        render();
      }
    }
  });

  // Botones
  el.diffBtns.forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    setDifficulty(b.dataset.diff);
    Sound.click();
  }));
  document.getElementById('start-btn').addEventListener('click', startMatch);
  document.getElementById('restart-btn').addEventListener('click', startMatch);
  document.getElementById('resume-btn').addEventListener('click', togglePause);
  document.getElementById('quit-btn').addEventListener('click', goToMenu);
  document.getElementById('menu-btn').addEventListener('click', goToMenu);
  el.pauseBtn.addEventListener('click', (e) => {
    unlockAudio();
    togglePause();
    e.currentTarget.blur();
  });

  function toggleMute() {
    unlockAudio();
    Sound.setMuted(!Sound.muted);
    renderMuteBtn();
  }

  function renderMuteBtn() {
    el.muteBtn.classList.toggle('muted', Sound.muted);
    el.muteBtn.setAttribute('aria-label', Sound.muted ? 'Activar audio' : 'Silenciar audio');
    el.muteBtn.title = Sound.muted ? 'Activar audio' : 'Silenciar';
  }

  el.muteBtn.addEventListener('click', (e) => {
    toggleMute();
    e.currentTarget.blur();
  });

  document.querySelectorAll('button').forEach((b) =>
    b.addEventListener('mouseup', () => b.blur()));

  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', () => {
    resizeCanvas();
    setTimeout(resizeCanvas, 150);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resizeCanvas);
  }
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeCanvas).observe(stageEl);
  }

  // ==========================================================
  //  Inicio (estático en menú hasta pulsar JUGAR)
  // ==========================================================
  const savedDiff = localStorage.getItem('neonpong-difficulty');
  setDifficulty(DIFFICULTY[savedDiff] ? savedDiff : 'normal');
  renderMuteBtn();
  updatePauseBtn();
  resetPaddles();
  resetBall();
  resizeCanvas();
  renderStatic();

  window.__pong = { game, ball, player, ai, DIFFICULTY };
})();
