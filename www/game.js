'use strict';

/**
 * NEON PONG — versión móvil Android (Capacitor) optimizada para GPU y batería.
 * - Modos: 1J vs IA (a 7 pts), 2 Jugadores local con multitáctil (a 7 pts),
 *   y Supervivencia / Récord (IA más rápida cada 5 golpes).
 * - Remate y efecto (Smash): empujar la paleta adelante o deslizar rápido al
 *   impactar dispara un tiro rojo/naranja más veloz y con leve curva.
 * - Tope estricto a 60 FPS, sprites neón pre-renderizados (cero shadowBlur),
 *   pools fijos sin GC y pausa total del bucle en reposo.
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
  const SURVIVAL_RESERVE_COUNTDOWN = 2;

  // Remate y efecto (Smash)
  const MAX_LUNGE_X = 24;
  const SMASH_FORWARD_SPEED = 230;   // px lógicos/s hacia adelante
  const SMASH_FORWARD_DISP = 16;     // desplazamiento relativo hacia adelante
  const SMASH_FORWARD_WINDOW = 0.18; // ventana de tiempo (s) para remate frontal
  const SMASH_SWIPE_SPEED = 740;     // px lógicos/s en deslizamiento vertical rápido
  const SMASH_SWIPE_DIST = 26;       // recorrido vertical mínimo para evitar falsos positivos
  const SMASH_SWIPE_WINDOW = 0.14;   // ventana de tiempo (s) para remate por deslizamiento
  const SMASH_SPEED_MULT = 1.28;
  const SMASH_MIN_SPEED = 740;
  const SMASH_MAX_SPEED = 1340;
  const SMASH_CURVE_BASE = 285;      // aceleración lateral (px/s²) de la curva
  const SMASH_CURVE_COMBO = 345;     // curva levemente mayor al combinar empuje + deslizamiento
  const SMASH_EMBER_INTERVAL = 0.032;

  // Modo Supervivencia
  const SURVIVAL_HITS_PER_LEVEL = 5;
  const STORAGE_KEYS = {
    muted: 'neonpong-muted',
    difficulty: 'neonpong-difficulty',
    mode: 'neonpong-mode',
    survivalBest: 'neonpong-survival-best',
  };

  const MODES = {
    VS_AI: 'vs-ai',
    TWO_P: '2p',
    SURVIVAL: 'survival',
  };

  // Límites de rendimiento y memoria
  const MAX_FPS = 60;
  const FRAME_INTERVAL = 1000 / MAX_FPS; // ~16.67 ms
  const FRAME_TOLERANCE = 1.0;           // evita caídas por jitter en paneles de 60 Hz
  const MAX_DPR = 1.5;
  const SPRITE_SCALE = 1.5;
  const MAX_PARTICLES = 64;
  const TRAIL_LENGTH = 12;
  const MAX_CALLOUTS = 3;

  const COLORS = {
    bg: '#0b0f19',
    player: '#22d3ee',
    ai: '#f472b6',
    ball: '#f8fafc',
    ballGlow: '#a5f3fc',
    line: 'rgba(148, 163, 184, 0.22)',
    violet: '#a78bfa',
    smashOrange: '#fb923c',
    smashRed: '#ef4444',
  };

  const PARTICLE_COLORS = [
    COLORS.player,
    COLORS.ai,
    COLORS.violet,
    COLORS.smashOrange,
    COLORS.smashRed,
  ];
  const COLOR_IDX_PLAYER = 0;
  const COLOR_IDX_AI = 1;
  const COLOR_IDX_VIOLET = 2;
  const COLOR_IDX_SMASH_ORANGE = 3;
  const COLOR_IDX_SMASH_RED = 4;

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
  const BALL_SMASH_SPRITE_SIZE = 62;
  const BALL_SMASH_SPRITE_HALF = BALL_SMASH_SPRITE_SIZE / 2;
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

  function buildPaddleSprite(color, isFlash, coreColor) {
    const { canvas: c, ctx: g } = createOffscreen(PADDLE_SPRITE_W, PADDLE_SPRITE_H);
    const x = PADDLE_PAD;
    const y = PADDLE_PAD;

    const layers = isFlash
      ? [
          { pad: 15, alpha: 0.11, r: 16 },
          { pad: 10, alpha: 0.20, r: 13 },
          { pad: 5,  alpha: 0.35, r: 9 },
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
      g.globalAlpha = 1;
      g.fillStyle = color;
      drawRoundedRectPath(g, x, y, PADDLE_W, PADDLE_H, 6);
      g.fill();

      g.fillStyle = 'rgba(255, 255, 255, 0.34)';
      drawRoundedRectPath(g, x + 3.5, y + 6, PADDLE_W - 7, PADDLE_H - 12, 3);
      g.fill();
    } else {
      g.globalAlpha = 0.72;
      g.fillStyle = coreColor || '#ffffff';
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

    g.fillStyle = COLORS.ball;
    g.beginPath();
    g.arc(cx, cy, BALL_R, 0, Math.PI * 2);
    g.fill();

    return c;
  }

  function buildSmashBallSprite() {
    const { canvas: c, ctx: g } = createOffscreen(BALL_SMASH_SPRITE_SIZE, BALL_SMASH_SPRITE_SIZE);
    const cx = BALL_SMASH_SPRITE_HALF;
    const cy = BALL_SMASH_SPRITE_HALF;

    // Halo rojo/naranja intenso para tiro cargado (Smash)
    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, BALL_SMASH_SPRITE_HALF - 2);
    grad.addColorStop(0.0, '#fff7ed');
    grad.addColorStop(0.24, '#fb923c');
    grad.addColorStop(0.46, 'rgba(239, 68, 68, 0.72)');
    grad.addColorStop(0.74, 'rgba(239, 68, 68, 0.24)');
    grad.addColorStop(1.0, 'rgba(239, 68, 68, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, BALL_SMASH_SPRITE_HALF - 2, 0, Math.PI * 2);
    g.fill();

    // Núcleo rojo/naranja incandescente
    const coreGrad = g.createRadialGradient(cx, cy, 1, cx, cy, BALL_R + 1.5);
    coreGrad.addColorStop(0.0, '#fef08a');
    coreGrad.addColorStop(0.55, '#fb923c');
    coreGrad.addColorStop(1.0, '#ef4444');
    g.fillStyle = coreGrad;
    g.beginPath();
    g.arc(cx, cy, BALL_R + 1, 0, Math.PI * 2);
    g.fill();

    return c;
  }

  function buildTrailDotSprite(isSmash) {
    const size = isSmash ? 24 : 20;
    const half = size / 2;
    const { canvas: c, ctx: g } = createOffscreen(size, size);
    const grad = g.createRadialGradient(half, half, 1, half, half, half);
    if (isSmash) {
      grad.addColorStop(0.0, 'rgba(253, 186, 116, 0.96)');
      grad.addColorStop(0.45, 'rgba(249, 115, 22, 0.65)');
      grad.addColorStop(0.75, 'rgba(239, 68, 68, 0.35)');
      grad.addColorStop(1.0, 'rgba(239, 68, 68, 0)');
    } else {
      grad.addColorStop(0.0, 'rgba(165, 243, 252, 0.95)');
      grad.addColorStop(0.55, 'rgba(34, 211, 238, 0.45)');
      grad.addColorStop(1.0, 'rgba(34, 211, 238, 0)');
    }
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
    paddleSmash: buildPaddleSprite(COLORS.smashRed, true, '#fed7aa'),
    ball: buildBallSprite(),
    ballSmash: buildSmashBallSprite(),
    trailDot: buildTrailDotSprite(false),
    trailDotSmash: buildTrailDotSprite(true),
    digits: {
      1: buildCountdownDigitSprite('1'),
      2: buildCountdownDigitSprite('2'),
      3: buildCountdownDigitSprite('3'),
    },
  };

  // Tablas pre-calculadas para la estela (cero cálculos/strings por frame)
  const TRAIL_ALPHAS = new Float32Array(TRAIL_LENGTH);
  const TRAIL_SIZES = new Float32Array(TRAIL_LENGTH);
  const TRAIL_SMASH_SIZES = new Float32Array(TRAIL_LENGTH);
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const k = (i + 1) / TRAIL_LENGTH;
    TRAIL_ALPHAS[i] = k * 0.45;
    TRAIL_SIZES[i] = BALL_R * 2 * (0.45 + k * 0.75);
    TRAIL_SMASH_SIZES[i] = BALL_R * 2 * (0.6 + k * 1.05);
  }

  // ==========================================================
  //  Audio procedural (Web Audio API compatible con WebView Android)
  // ==========================================================
  const Sound = {
    ctx: null,
    master: null,
    muted: localStorage.getItem(STORAGE_KEYS.muted) === '1',
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
      localStorage.setItem(STORAGE_KEYS.muted, muted ? '1' : '0');
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

    smash() {
      this.tone({ freq: 155, to: 52, dur: 0.17, type: 'triangle', vol: 0.42 });
      this.tone({ freq: 440, to: 1080, dur: 0.15, type: 'sawtooth', vol: 0.18 });
      this.tone({ freq: 880, to: 620, dur: 0.11, type: 'square', vol: 0.12, delay: 0.03 });
    },

    levelUp() {
      const notes = [587, 740, 988];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.13, type: 'triangle', vol: 0.24, delay: i * 0.07 });
      }
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
    labelLeft: document.getElementById('label-left'),
    labelRight: document.getElementById('label-right'),
    scorePlayer: document.getElementById('score-player'),
    scoreAi: document.getElementById('score-ai'),
    diffLabel: document.getElementById('diff-label'),
    targetLabel: document.getElementById('target-label'),
    menuSubtitle: document.getElementById('menu-subtitle'),
    diffGroup: document.getElementById('difficulty-group'),
    modeBadge: document.getElementById('mode-badge'),
    controlsHelp: document.getElementById('controls-help'),
    footerHint: document.getElementById('footer-hint'),
    resultTitle: document.getElementById('result-title'),
    resultScore: document.getElementById('result-score'),
    resultDetail: document.getElementById('result-detail'),
    muteBtn: document.getElementById('mute-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    diffBtns: document.querySelectorAll('.diff-btn'),
    modeBtns: document.querySelectorAll('.mode-btn'),
  };

  let canvasRect = { left: 0, top: 0, width: W, height: H };

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
  const player = {
    baseX: PADDLE_MARGIN,
    x: PADDLE_MARGIN,
    y: H / 2 - PADDLE_H / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    vy: 0,
    flash: 0,
    lunge: 0,
    lungeTarget: 0,
    smashForwardTimer: 0,
    smashSwipeTimer: 0,
    smashSwipeDir: 0,
    smashFlash: 0,
  };

  const ai = {
    baseX: W - PADDLE_MARGIN - PADDLE_W,
    x: W - PADDLE_MARGIN - PADDLE_W,
    y: H / 2 - PADDLE_H / 2,
    w: PADDLE_W,
    h: PADDLE_H,
    vy: 0,
    flash: 0,
    lunge: 0,
    lungeTarget: 0,
    smashForwardTimer: 0,
    smashSwipeTimer: 0,
    smashSwipeDir: 0,
    smashFlash: 0,
    target: H / 2,
    reactTimer: 0,
    thinkTimer: 0,
    errorOffset: 0,
    lastDir: 0,
  };

  const ball = {
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    speed: BALL_START_SPEED,
    baseSpeed: BALL_START_SPEED,
    isSmash: false,
    curve: 0,
    emberTimer: 0,
  };

  // Ring buffer de estela sin asignaciones por frame
  const trailX = new Float32Array(TRAIL_LENGTH);
  const trailY = new Float32Array(TRAIL_LENGTH);
  const trailSmash = new Uint8Array(TRAIL_LENGTH);
  let trailHead = 0;
  let trailCount = 0;

  function clearTrail() {
    trailHead = 0;
    trailCount = 0;
  }

  function pushTrail(x, y, isSmash) {
    trailX[trailHead] = x;
    trailY[trailHead] = y;
    trailSmash[trailHead] = isSmash ? 1 : 0;
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

  // Pool fijo de avisos flotantes en canvas (¡REMATE!, IA NV. 2, etc.)
  const callouts = [];
  for (let i = 0; i < MAX_CALLOUTS; i++) {
    callouts.push({ active: false, text: '', x: 0, y: 0, color: '#fb923c', life: 0, maxLife: 0.75 });
  }
  let nextCalloutSlot = 0;

  function clearCallouts() {
    for (let i = 0; i < MAX_CALLOUTS; i++) callouts[i].active = false;
  }

  function spawnCallout(text, x, y, color, duration = 0.75) {
    let slot = null;
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      if (!callouts[i].active) { slot = callouts[i]; break; }
    }
    if (!slot) {
      slot = callouts[nextCalloutSlot];
      nextCalloutSlot = (nextCalloutSlot + 1) % MAX_CALLOUTS;
    }
    slot.active = true;
    slot.text = text;
    slot.x = x;
    slot.y = y;
    slot.color = color;
    slot.life = duration;
    slot.maxLife = duration;
  }

  function updateCallouts(dt) {
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      const c = callouts[i];
      if (!c.active) continue;
      c.life -= dt;
      c.y -= dt * 24;
      if (c.life <= 0) c.active = false;
    }
  }

  // Configuración reutilizable de IA en modo Supervivencia (cero GC)
  const survivalAICfg = { maxSpeed: 340, accel: 2200, reaction: 0.22, error: 32 };
  function getSurvivalAIConfig(level) {
    const lvl = Math.max(0, level - 1);
    survivalAICfg.maxSpeed = Math.min(960, 340 + lvl * 55);
    survivalAICfg.accel = Math.min(6800, 2200 + lvl * 380);
    survivalAICfg.reaction = Math.max(0.03, 0.22 - lvl * 0.022);
    survivalAICfg.error = Math.max(4, 32 - lvl * 3);
    return survivalAICfg;
  }

  function readSavedSurvivalBest() {
    const raw = parseInt(localStorage.getItem(STORAGE_KEYS.survivalBest) || '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  const game = {
    state: 'menu', // menu | countdown | playing | paused | gameover
    pausedFrom: null,
    mode: MODES.VS_AI,
    difficulty: 'normal',
    scores: { player: 0, ai: 0 },
    survivalHits: 0,
    survivalLevel: 1,
    survivalBest: readSavedSurvivalBest(),
    survivalNewRecord: false,
    countdown: 0,
    lastCountShown: 0,
    serveDir: 1,
    rally: 0,
    shake: 0,
  };

  let rafId = 0;
  let loopActive = false;
  let lastRenderTime = 0;
  let lastUpdateTime = 0;
  let gameoverSoundTimer = 0;
  let lastTouchTimestamp = 0;

  function createControlState() {
    return {
      up: false,
      down: false,
      pointerActive: false,
      pointerY: H / 2,
      touchId: null,
      lastX: 0,
      lastY: 0,
      lastTime: 0,
      anchorX: 0,
      swipeDistY: 0,
      swipeSignY: 0,
      smoothVy: 0,
      smoothVxForward: 0,
    };
  }

  const controls = [createControlState(), createControlState()];
  const fieldPoint = { x: 0, y: H / 2 };

  function resetControlState(ctrl) {
    ctrl.up = false;
    ctrl.down = false;
    ctrl.pointerActive = false;
    ctrl.pointerY = H / 2;
    ctrl.touchId = null;
    ctrl.lastX = 0;
    ctrl.lastY = 0;
    ctrl.lastTime = 0;
    ctrl.anchorX = 0;
    ctrl.swipeDistY = 0;
    ctrl.swipeSignY = 0;
    ctrl.smoothVy = 0;
    ctrl.smoothVxForward = 0;
  }

  function clearActiveTouches() {
    for (let s = 0; s < 2; s++) {
      controls[s].touchId = null;
      controls[s].smoothVy = 0;
      controls[s].smoothVxForward = 0;
      controls[s].swipeDistY = 0;
      controls[s].swipeSignY = 0;
    }
  }

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
  //  Flujo de partida y HUD
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

  function bumpElement(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  function updateHudLabels() {
    el.targetLabel.classList.remove('level-up');
    el.scoreAi.classList.remove('record-live');

    if (game.mode === MODES.TWO_P) {
      el.labelLeft.textContent = 'J1';
      el.labelRight.textContent = 'J2';
      el.diffLabel.textContent = '2 JUGADORES';
      el.targetLabel.textContent = `PRIMERO A ${WIN_SCORE}`;
      el.footerHint.textContent = 'Mitad izq: J1 · Mitad der: J2 (multitáctil) · Empujá adelante o deslizá rápido para REMATE';
    } else if (game.mode === MODES.SURVIVAL) {
      el.labelLeft.textContent = 'RACHA';
      el.labelRight.textContent = 'RÉCORD';
      el.diffLabel.textContent = 'SUPERVIVENCIA';
      el.targetLabel.textContent = `IA NV. ${game.survivalLevel}`;
      if (game.survivalLevel > 1) el.targetLabel.classList.add('level-up');
      if (game.survivalNewRecord) el.scoreAi.classList.add('record-live');
      el.footerHint.textContent = 'Cada 5 golpes la IA acelera · Empujá adelante o deslizá rápido para REMATE';
    } else {
      el.labelLeft.textContent = 'TÚ';
      el.labelRight.textContent = 'IA';
      el.diffLabel.textContent = DIFFICULTY[game.difficulty].label;
      el.targetLabel.textContent = `PRIMERO A ${WIN_SCORE}`;
      el.footerHint.textContent = 'Arrastrá para mover · Empujá adelante o deslizá rápido para REMATE';
    }
  }

  function updateScoreboard(bumpWho) {
    if (game.mode === MODES.SURVIVAL) {
      el.scorePlayer.textContent = game.survivalHits;
      el.scoreAi.textContent = game.survivalBest;
      el.scoreAi.classList.toggle('record-live', game.survivalNewRecord);
      if (bumpWho === 'player' || bumpWho === 'both') bumpElement(el.scorePlayer);
      if (bumpWho === 'ai' || bumpWho === 'both') bumpElement(el.scoreAi);
    } else {
      el.scorePlayer.textContent = game.scores.player;
      el.scoreAi.textContent = game.scores.ai;
      if (bumpWho) {
        bumpElement(bumpWho === 'player' ? el.scorePlayer : el.scoreAi);
      }
    }
  }

  function updateMenuUI() {
    el.modeBtns.forEach((b) => {
      const sel = b.dataset.mode === game.mode;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', String(sel));
    });

    if (game.mode === MODES.VS_AI) {
      el.menuSubtitle.textContent = `Primero en llegar a ${WIN_SCORE} puntos gana`;
      el.diffGroup.classList.remove('hidden');
      el.modeBadge.classList.add('hidden');
      el.controlsHelp.firstElementChild.textContent =
        'Arrastrá para mover · Empujá adelante o deslizá rápido al golpear para REMATE';
    } else if (game.mode === MODES.TWO_P) {
      el.menuSubtitle.textContent = `Dos jugadores en la misma pantalla · Primero a ${WIN_SCORE}`;
      el.diffGroup.classList.add('hidden');
      el.modeBadge.textContent = 'MULTITÁCTIL ACTIVADO · IZQ: J1 / DER: J2';
      el.modeBadge.className = 'mode-badge two-player';
      el.controlsHelp.firstElementChild.textContent =
        'Cada jugador controla su mitad · Empujá adelante o deslizá rápido para REMATE';
    } else {
      el.menuSubtitle.textContent = `La IA acelera cada ${SURVIVAL_HITS_PER_LEVEL} golpes · Aguantá sin perder`;
      el.diffGroup.classList.add('hidden');
      const unit = game.survivalBest === 1 ? 'golpe' : 'golpes';
      el.modeBadge.textContent = `RÉCORD ACTUAL: ${game.survivalBest} ${unit}`;
      el.modeBadge.className = 'mode-badge';
      el.controlsHelp.firstElementChild.textContent =
        'Empujá adelante o deslizá rápido al impactar para lanzar un REMATE con curva';
    }

    updateHudLabels();
    updateScoreboard();
  }

  function setMode(mode) {
    if (mode !== MODES.VS_AI && mode !== MODES.TWO_P && mode !== MODES.SURVIVAL) {
      mode = MODES.VS_AI;
    }
    game.mode = mode;
    localStorage.setItem(STORAGE_KEYS.mode, mode);
    updateMenuUI();
  }

  function setDifficulty(diff) {
    game.difficulty = diff;
    el.diffBtns.forEach((b) => {
      const sel = b.dataset.diff === diff;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', String(sel));
    });
    localStorage.setItem(STORAGE_KEYS.difficulty, diff);
    updateHudLabels();
  }

  function commitSurvivalRecord() {
    if (game.survivalHits > game.survivalBest) {
      game.survivalBest = game.survivalHits;
      game.survivalNewRecord = true;
      localStorage.setItem(STORAGE_KEYS.survivalBest, String(game.survivalBest));
      return true;
    }
    return false;
  }

  function resetPaddle(p) {
    p.x = p.baseX;
    p.y = H / 2 - PADDLE_H / 2;
    p.vy = 0;
    p.flash = 0;
    p.lunge = 0;
    p.lungeTarget = 0;
    p.smashForwardTimer = 0;
    p.smashSwipeTimer = 0;
    p.smashSwipeDir = 0;
    p.smashFlash = 0;
  }

  function resetPaddles() {
    resetPaddle(player);
    resetPaddle(ai);
    ai.target = H / 2;
    ai.reactTimer = 0;
    ai.thinkTimer = 0;
    ai.errorOffset = 0;
    ai.lastDir = 0;
    resetControlState(controls[0]);
    resetControlState(controls[1]);
  }

  function resetBall(preserveSurvivalSpeed) {
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = ball.vy = 0;
    const startSpeed = preserveSurvivalSpeed && game.mode === MODES.SURVIVAL
      ? Math.min(BALL_START_SPEED + (game.survivalLevel - 1) * 26, 700)
      : BALL_START_SPEED;
    ball.baseSpeed = startSpeed;
    ball.speed = startSpeed;
    ball.isSmash = false;
    ball.curve = 0;
    ball.emberTimer = 0;
    clearTrail();
    game.rally = 0;
    game.shake = 0;
  }

  function startMatch() {
    unlockAudio();
    if (gameoverSoundTimer) {
      clearTimeout(gameoverSoundTimer);
      gameoverSoundTimer = 0;
    }
    game.scores.player = 0;
    game.scores.ai = 0;
    game.survivalHits = 0;
    game.survivalLevel = 1;
    game.survivalNewRecord = false;
    clearParticles();
    clearCallouts();
    resetPaddles();
    updateHudLabels();
    updateScoreboard();
    game.serveDir = game.mode === MODES.SURVIVAL ? -1 : (Math.random() < 0.5 ? -1 : 1);
    startCountdown(COUNTDOWN_TIME, false);
    setOverlay(null);
    startLoop();
  }

  function startCountdown(duration = COUNTDOWN_TIME, preserveSurvivalSpeed = false) {
    resetBall(preserveSurvivalSpeed);
    game.state = 'countdown';
    game.countdown = duration;
    game.lastCountShown = 0;
    updatePauseBtn();
  }

  function serve() {
    const angle = rand(-0.35, 0.35);
    ball.speed = ball.baseSpeed;
    ball.isSmash = false;
    ball.curve = 0;
    ball.vx = game.serveDir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    game.state = 'playing';
    updatePauseBtn();
  }

  function togglePause() {
    if (game.state === 'playing' || game.state === 'countdown') {
      game.pausedFrom = game.state;
      game.state = 'paused';
      clearActiveTouches();
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
    if (gameoverSoundTimer) {
      clearTimeout(gameoverSoundTimer);
      gameoverSoundTimer = 0;
    }
    if (game.mode === MODES.SURVIVAL) {
      commitSurvivalRecord();
    }
    game.state = 'menu';
    game.scores.player = game.scores.ai = 0;
    game.survivalHits = 0;
    game.survivalLevel = 1;
    game.survivalNewRecord = false;
    clearParticles();
    clearCallouts();
    resetPaddles();
    resetBall(false);
    updateMenuUI();
    setOverlay('menu');
    renderStatic();
  }

  function registerSurvivalHit(isBonus) {
    game.survivalHits += 1;
    const brokeRecord = commitSurvivalRecord();
    const nextLevel = Math.floor(game.survivalHits / SURVIVAL_HITS_PER_LEVEL) + 1;
    const leveledUp = nextLevel > game.survivalLevel;

    if (leveledUp) {
      game.survivalLevel = nextLevel;
      el.targetLabel.textContent = `IA NV. ${game.survivalLevel}`;
      el.targetLabel.classList.add('level-up');
      Sound.levelUp();
      spawnCallout(`IA NIVEL ${game.survivalLevel} · ¡MÁS RÁPIDA!`, W / 2, 76, '#fb923c', 1.15);
      spawnSparks(ai.x, ai.y + ai.h / 2, -1, 14, COLOR_IDX_SMASH_ORANGE, 1.2);
    }

    if (brokeRecord) {
      updateScoreboard('both');
    } else if (leveledUp || isBonus) {
      updateScoreboard('player');
    } else {
      el.scorePlayer.textContent = game.survivalHits;
    }
  }

  function pointScored(who) {
    if (game.mode === MODES.SURVIVAL) {
      if (who === 'player') {
        // El jugador superó a la IA: ¡no pierde la racha!
        registerSurvivalHit(true);
        Sound.score(true);
        game.shake = 8;
        spawnSparks(W, ball.y, -1, 18, COLOR_IDX_PLAYER, 1.4);
        spawnCallout('¡IA SUPERADA! +1', W / 2, H / 2 - 48, '#22d3ee', 0.95);
        game.serveDir = -1;
        startCountdown(SURVIVAL_RESERVE_COUNTDOWN, true);
      } else {
        // El jugador perdió la pelota: fin de la racha
        Sound.score(false);
        game.shake = 10;
        spawnSparks(0, ball.y, 1, 20, COLOR_IDX_AI, 1.5);
        endSurvivalMatch();
      }
      return;
    }

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
    startCountdown(COUNTDOWN_TIME, false);
  }

  function endMatch(playerWon) {
    game.state = 'gameover';
    clearActiveTouches();
    clearCallouts();
    resetBall(false);
    clearParticles();

    if (game.mode === MODES.TWO_P) {
      el.resultTitle.textContent = playerWon ? '¡GANA J1!' : '¡GANA J2!';
      el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
      el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
      el.resultDetail.classList.add('hidden');
      gameoverSoundTimer = setTimeout(() => { gameoverSoundTimer = 0; Sound.win(); }, 320);
    } else {
      el.resultTitle.textContent = playerWon ? '¡VICTORIA!' : 'DERROTA';
      el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
      el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
      el.resultDetail.classList.add('hidden');
      gameoverSoundTimer = setTimeout(() => {
        gameoverSoundTimer = 0;
        if (playerWon) Sound.win();
        else Sound.lose();
      }, 320);
    }

    setOverlay('gameover');
    renderStatic();
  }

  function endSurvivalMatch() {
    const isNewRecord = game.survivalNewRecord && game.survivalHits > 0;
    commitSurvivalRecord();

    game.state = 'gameover';
    clearActiveTouches();
    clearCallouts();
    resetBall(false);
    clearParticles();

    const hitsWord = game.survivalHits === 1 ? 'GOLPE' : 'GOLPES';
    if (isNewRecord) {
      el.resultTitle.textContent = '¡NUEVO RÉCORD!';
      el.resultTitle.className = 'overlay-title record';
    } else {
      el.resultTitle.textContent = 'FIN DE RACHA';
      el.resultTitle.className = 'overlay-title lose';
    }
    el.resultScore.textContent = `${game.survivalHits} ${hitsWord}`;
    el.resultDetail.textContent = `IA Nivel ${game.survivalLevel} · Récord: ${game.survivalBest}`;
    el.resultDetail.classList.remove('hidden');

    gameoverSoundTimer = setTimeout(() => {
      gameoverSoundTimer = 0;
      if (isNewRecord) Sound.win();
      else Sound.lose();
    }, 320);

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
  //  Física (incluye Remate y efecto / Smash)
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
    const isHuman = (p === player) || (game.mode === MODES.TWO_P);
    const isForwardSmash = isHuman && p.smashForwardTimer > 0;
    const isSwipeSmash = isHuman && p.smashSwipeTimer > 0;
    const isSmash = isForwardSmash || isSwipeSmash;

    ball.baseSpeed = Math.min(ball.baseSpeed * BALL_SPEEDUP, BALL_MAX_SPEED);

    const maxAngle = isSmash ? MAX_BOUNCE_ANGLE * 0.85 : MAX_BOUNCE_ANGLE;
    const angle = rel * maxAngle;

    if (isSmash) {
      ball.speed = Math.min(Math.max(ball.baseSpeed * SMASH_SPEED_MULT, SMASH_MIN_SPEED), SMASH_MAX_SPEED);
      ball.isSmash = true;
      ball.emberTimer = 0;

      // Dirección de la leve curva: prioridad al deslizamiento rápido, luego velocidad/ángulo
      let curveDir = 0;
      if (isSwipeSmash && p.smashSwipeDir !== 0) {
        curveDir = p.smashSwipeDir;
      } else if (Math.abs(p.vy) > 90) {
        curveDir = Math.sign(p.vy);
      } else if (Math.abs(rel) > 0.12) {
        curveDir = Math.sign(rel);
      } else {
        curveDir = ball.y > H / 2 ? -1 : 1;
      }
      const curveMag = (isForwardSmash && isSwipeSmash) ? SMASH_CURVE_COMBO : SMASH_CURVE_BASE;
      ball.curve = curveDir * curveMag;

      p.smashForwardTimer = 0;
      p.smashSwipeTimer = 0;
      p.smashFlash = 1;
    } else {
      ball.speed = ball.baseSpeed;
      ball.isSmash = false;
      ball.curve = 0;
    }

    ball.vx = dir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.x = dir > 0 ? p.x + p.w + BALL_R : p.x - BALL_R;

    game.rally++;
    p.flash = 1;

    if (isSmash) {
      Sound.smash();
      spawnSparks(ball.x, ball.y, dir, 14, COLOR_IDX_SMASH_ORANGE, 1.45);
      spawnSparks(ball.x, ball.y, dir, 8, COLOR_IDX_SMASH_RED, 1.15);
      game.shake = Math.max(game.shake, 7.5);
      spawnCallout(
        '¡REMATE!',
        clamp(ball.x + dir * 56, 84, W - 84),
        clamp(ball.y - 28, 44, H - 30),
        '#fb923c',
        0.65
      );
    } else {
      const ratio = clamp((ball.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED), 0, 1);
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

    if (game.mode === MODES.SURVIVAL) {
      registerSurvivalHit(false);
    }
  }

  function updateBall(dt) {
    const steps = Math.max(1, Math.ceil((ball.speed * dt) / (BALL_R * 0.5)));
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      // Aplicar curva sutil durante un Remate (Smash)
      if (ball.isSmash && ball.curve !== 0) {
        ball.vy += ball.curve * sdt;
        const maxVy = ball.speed * 0.78;
        ball.vy = clamp(ball.vy, -maxVy, maxVy);
        const vxMag = Math.sqrt(Math.max(1, ball.speed * ball.speed - ball.vy * ball.vy));
        ball.vx = (ball.vx >= 0 ? 1 : -1) * vxMag;
      }

      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R + (BALL_R - ball.y);
        ball.vy = Math.abs(ball.vy);
        if (ball.isSmash) {
          ball.curve = ball.curve < 0 ? -ball.curve * 0.4 : ball.curve * 0.65;
        }
        Sound.wall();
        spawnSparks(ball.x, 0, 1, 4, ball.isSmash ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_VIOLET, 0.55);
      } else if (ball.y + BALL_R > H) {
        ball.y = H - BALL_R - (ball.y + BALL_R - H);
        ball.vy = -Math.abs(ball.vy);
        if (ball.isSmash) {
          ball.curve = ball.curve > 0 ? -ball.curve * 0.4 : ball.curve * 0.65;
        }
        Sound.wall();
        spawnSparks(ball.x, H, 1, 4, ball.isSmash ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_VIOLET, 0.55);
      }

      if (ball.vx < 0 && ball.x >= player.x && circleRectHit(player)) {
        hitPaddle(player, 1);
      } else if (ball.vx > 0 && ball.x <= ai.x + ai.w && circleRectHit(ai)) {
        hitPaddle(ai, -1);
      }

      if (ball.x + BALL_R < 0 || ball.x - BALL_R > W) {
        pointScored(ball.x < 0 ? 'ai' : 'player');
        return;
      }
    }

    // Chispas de fuego detrás de la pelota durante un Remate
    if (ball.isSmash) {
      ball.emberTimer -= dt;
      if (ball.emberTimer <= 0) {
        ball.emberTimer = SMASH_EMBER_INTERVAL;
        spawnSparks(
          ball.x,
          ball.y,
          ball.vx >= 0 ? -1 : 1,
          1,
          Math.random() < 0.6 ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_SMASH_RED,
          0.35
        );
      }
    }
  }

  // ==========================================================
  //  Jugadores e IA
  // ==========================================================
  function triggerForwardLunge(paddle) {
    paddle.smashForwardTimer = SMASH_FORWARD_WINDOW;
    paddle.lungeTarget = MAX_LUNGE_X;
  }

  function updateHumanPaddle(paddle, ctrl, dir, dt, now) {
    const keyDir = (ctrl.down ? 1 : 0) - (ctrl.up ? 1 : 0);
    let targetVy;

    if (keyDir !== 0) {
      ctrl.pointerActive = false;
      targetVy = keyDir * PLAYER_SPEED;
    } else if (ctrl.pointerActive) {
      const diff = ctrl.pointerY - (paddle.y + paddle.h / 2);
      targetVy = clamp(diff * 22, -PLAYER_POINTER_SPEED, PLAYER_POINTER_SPEED);
    } else {
      targetVy = 0;
    }

    const smoothing = ctrl.pointerActive ? 1 : 1 - Math.pow(0.0001, dt);
    paddle.vy += (targetVy - paddle.vy) * smoothing;
    paddle.y = clamp(paddle.y + paddle.vy * dt, 0, H - paddle.h);
    if (paddle.y === 0 || paddle.y === H - paddle.h) {
      if ((paddle.y === 0 && paddle.vy < 0) || (paddle.y > 0 && paddle.vy > 0)) paddle.vy = 0;
    }

    // Decaimiento suave de velocidades de gesto si el dedo se detuvo
    if (ctrl.lastTime && now - ctrl.lastTime > 45) {
      const decay = Math.pow(0.002, dt);
      ctrl.smoothVy *= decay;
      ctrl.smoothVxForward *= decay;
      ctrl.swipeDistY *= decay;
    }
    if (ctrl.touchId !== null || ctrl.pointerActive) {
      ctrl.anchorX += (ctrl.lastX - ctrl.anchorX) * Math.min(1, dt * 6.5);
    }

    // Movimiento hacia adelante (empuje de remate) con retorno elástico
    if (paddle.smashForwardTimer > 0) {
      paddle.smashForwardTimer = Math.max(0, paddle.smashForwardTimer - dt);
    } else {
      paddle.lungeTarget = Math.max(0, paddle.lungeTarget - dt * 130);
    }
    if (paddle.smashSwipeTimer > 0) {
      paddle.smashSwipeTimer = Math.max(0, paddle.smashSwipeTimer - dt);
    }

    paddle.lunge += (paddle.lungeTarget - paddle.lunge) * Math.min(1, dt * 26);
    if (paddle.lunge < 0.15 && paddle.lungeTarget === 0) paddle.lunge = 0;
    paddle.x = paddle.baseX + paddle.lunge * dir;
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
    const cfg = game.mode === MODES.SURVIVAL
      ? getSurvivalAIConfig(game.survivalLevel)
      : DIFFICULTY[game.difficulty];
    const center = ai.y + ai.h / 2;

    if (game.state === 'playing') {
      const dir = Math.sign(ball.vx);

      if (dir !== ai.lastDir) {
        ai.lastDir = dir;
        ai.reactTimer = cfg.reaction * rand(0.7, 1.4);
        ai.thinkTimer = 0;
        const speedFactor = 1 + ((ball.speed - BALL_START_SPEED) / BALL_START_SPEED) * 0.9;
        ai.errorOffset = rand(-1, 1) * cfg.error * speedFactor;
        const mistakeChance = game.mode === MODES.SURVIVAL ? 0.03 : 0.08;
        if (Math.random() < mistakeChance) ai.errorOffset *= 1.7;
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
    ai.x = ai.baseX;
    if (ai.y < 0) { ai.y = 0; ai.vy = 0; }
    if (ai.y > H - ai.h) { ai.y = H - ai.h; ai.vy = 0; }
  }

  // ==========================================================
  //  Actualización
  // ==========================================================
  function update(dt, now) {
    if (game.state === 'countdown') {
      updateHumanPaddle(player, controls[0], 1, dt, now);
      if (game.mode === MODES.TWO_P) {
        updateHumanPaddle(ai, controls[1], -1, dt, now);
      } else {
        updateAI(dt);
      }
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
      updateHumanPaddle(player, controls[0], 1, dt, now);
      if (game.mode === MODES.TWO_P) {
        updateHumanPaddle(ai, controls[1], -1, dt, now);
      } else {
        updateAI(dt);
      }
      updateBall(dt);
      if (game.state === 'playing') {
        pushTrail(ball.x, ball.y, ball.isSmash);
      }
    }

    updateParticles(dt);
    updateCallouts(dt);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 40);
    if (player.flash > 0) player.flash = Math.max(0, player.flash - dt * 4.5);
    if (ai.flash > 0) ai.flash = Math.max(0, ai.flash - dt * 4.5);
    if (player.smashFlash > 0) player.smashFlash = Math.max(0, player.smashFlash - dt * 3.2);
    if (ai.smashFlash > 0) ai.smashFlash = Math.max(0, ai.smashFlash - dt * 3.2);
  }

  // ==========================================================
  //  Renderizado ligero (solo drawImage y fillRect, cero shadowBlur)
  // ==========================================================
  function drawPaddle(p, baseSprite, flashSprite) {
    const dx = p.x - PADDLE_PAD;
    const dy = p.y - PADDLE_PAD;
    ctx.drawImage(baseSprite, dx, dy, PADDLE_SPRITE_W, PADDLE_SPRITE_H);

    // Aura cálida al empujar hacia adelante o rematar
    const chargeAlpha = Math.max(p.smashFlash, (p.lunge / MAX_LUNGE_X) * 0.55);
    if (chargeAlpha > 0.04) {
      ctx.globalAlpha = clamp(chargeAlpha, 0, 0.9);
      ctx.drawImage(Sprites.paddleSmash, dx, dy, PADDLE_SPRITE_W, PADDLE_SPRITE_H);
      ctx.globalAlpha = 1;
    }

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
        const isSmashPoint = trailSmash[idx] === 1;
        const size = isSmashPoint ? TRAIL_SMASH_SIZES[slot] : TRAIL_SIZES[slot];
        ctx.globalAlpha = isSmashPoint ? TRAIL_ALPHAS[slot] * 1.35 : TRAIL_ALPHAS[slot];
        ctx.drawImage(
          isSmashPoint ? Sprites.trailDotSmash : Sprites.trailDot,
          trailX[idx] - size * 0.5,
          trailY[idx] - size * 0.5,
          size,
          size
        );
      }
      ctx.globalAlpha = 1;
    }

    if (ball.isSmash) {
      ctx.drawImage(
        Sprites.ballSmash,
        ball.x - BALL_SMASH_SPRITE_HALF,
        ball.y - BALL_SMASH_SPRITE_HALF,
        BALL_SMASH_SPRITE_SIZE,
        BALL_SMASH_SPRITE_SIZE
      );
    } else {
      ctx.drawImage(
        Sprites.ball,
        ball.x - BALL_SPRITE_HALF,
        ball.y - BALL_SPRITE_HALF,
        BALL_SPRITE_SIZE,
        BALL_SPRITE_SIZE
      );
    }
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

  function drawCallouts() {
    let anyActive = false;
    for (let i = 0; i < MAX_CALLOUTS; i++) {
      if (callouts[i].active) { anyActive = true; break; }
    }
    if (!anyActive) return;

    ctx.font = '800 18px "Segoe UI", system-ui, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;

    for (let i = 0; i < MAX_CALLOUTS; i++) {
      const c = callouts[i];
      if (!c.active) continue;
      const alpha = clamp((c.life / c.maxLife) * 1.4, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = 'rgba(11, 15, 25, 0.85)';
      ctx.strokeText(c.text, c.x, c.y);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
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
    let serveMsg;
    if (game.mode === MODES.TWO_P) {
      serveMsg = game.serveDir < 0 ? 'SAQUE HACIA J1' : 'SAQUE HACIA J2';
    } else {
      serveMsg = game.serveDir < 0 ? 'SAQUE HACIA TI' : 'SAQUE HACIA LA IA';
    }
    ctx.fillText(serveMsg, W / 2, H / 2 + 110);
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
    drawCallouts();
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

    update(dt, now);
    if (loopActive) {
      render();
      rafId = requestAnimationFrame(frame);
    }
  }

  // ==========================================================
  //  Entrada multitáctil (2J), táctil (1J), ratón y teclado
  // ==========================================================
  window.addEventListener('keydown', (e) => {
    const isTwoP = game.mode === MODES.TWO_P;

    if (e.code === 'KeyW') { controls[0].up = true; e.preventDefault(); }
    else if (e.code === 'KeyS') { controls[0].down = true; e.preventDefault(); }
    else if (e.code === 'KeyD') {
      e.preventDefault();
      if (!e.repeat) triggerForwardLunge(player);
    } else if (e.code === 'ArrowUp') {
      (isTwoP ? controls[1] : controls[0]).up = true;
      e.preventDefault();
    } else if (e.code === 'ArrowDown') {
      (isTwoP ? controls[1] : controls[0]).down = true;
      e.preventDefault();
    } else if (e.code === 'ArrowRight' && !isTwoP) {
      e.preventDefault();
      if (!e.repeat) triggerForwardLunge(player);
    } else if (e.code === 'ArrowLeft' && isTwoP) {
      e.preventDefault();
      if (!e.repeat) triggerForwardLunge(ai);
    } else if (e.code === 'Space' || e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) togglePause();
    } else if (e.code === 'KeyR' && !e.repeat) {
      if (game.state === 'paused' || game.state === 'gameover') {
        e.preventDefault();
        Sound.click();
        startMatch();
      }
    } else if (e.code === 'KeyM' && !e.repeat) {
      toggleMute();
    } else if (e.code === 'Enter' && !e.repeat) {
      if (game.state === 'menu' || game.state === 'gameover') { e.preventDefault(); startMatch(); }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') controls[0].up = false;
    else if (e.code === 'KeyS') controls[0].down = false;
    else if (e.code === 'ArrowUp') { controls[0].up = false; controls[1].up = false; }
    else if (e.code === 'ArrowDown') { controls[0].down = false; controls[1].down = false; }
  });

  function clientToField(clientX, clientY) {
    if (!canvasRect.height || !canvasRect.width) refreshCanvasRect();
    const w = canvasRect.width || W;
    const h = canvasRect.height || H;
    fieldPoint.x = clamp(((clientX - canvasRect.left) / w) * W, 0, W);
    fieldPoint.y = clamp(((clientY - canvasRect.top) / h) * H, 0, H);
    return fieldPoint;
  }

  function getSplitClientX() {
    if (!canvasRect.width) refreshCanvasRect();
    return canvasRect.width ? (canvasRect.left + canvasRect.width * 0.5) : (window.innerWidth * 0.5);
  }

  function hasTouchInList(touchList, touchId) {
    if (touchId === null) return false;
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === touchId) return true;
    }
    return false;
  }

  function beginPointerGesture(side, clientX, clientY, touchId) {
    const ctrl = controls[side];
    const pt = clientToField(clientX, clientY);
    ctrl.touchId = touchId;
    ctrl.pointerY = pt.y;
    ctrl.pointerActive = true;
    ctrl.lastX = pt.x;
    ctrl.lastY = pt.y;
    ctrl.anchorX = pt.x;
    ctrl.lastTime = performance.now();
    ctrl.swipeDistY = 0;
    ctrl.swipeSignY = 0;
    ctrl.smoothVy = 0;
    ctrl.smoothVxForward = 0;
  }

  function updatePointerGesture(side, clientX, clientY) {
    const ctrl = controls[side];
    const paddle = side === 0 ? player : ai;
    const dir = side === 0 ? 1 : -1;
    const now = performance.now();
    const pt = clientToField(clientX, clientY);

    if (!ctrl.lastTime) {
      beginPointerGesture(side, clientX, clientY, ctrl.touchId);
      return;
    }

    const dtSec = clamp((now - ctrl.lastTime) / 1000, 0.004, 0.1);
    const dx = pt.x - ctrl.lastX;
    const dy = pt.y - ctrl.lastY;

    ctrl.pointerY = pt.y;
    ctrl.pointerActive = true;

    // 1) Empuje hacia adelante (Remate frontal)
    const dxForward = dx * dir;
    const vxForward = dxForward / dtSec;
    ctrl.smoothVxForward = ctrl.smoothVxForward * 0.42 + vxForward * 0.58;

    if ((pt.x - ctrl.anchorX) * dir < 0) {
      // Si retrocede, re-ancla para que el siguiente empuje hacia adelante responda al instante
      ctrl.anchorX = pt.x;
    }
    const forwardDisp = (pt.x - ctrl.anchorX) * dir;

    if (forwardDisp > 4) {
      paddle.lungeTarget = Math.max(paddle.lungeTarget, clamp(forwardDisp * 0.55, 0, MAX_LUNGE_X));
    }

    if (
      ctrl.smoothVxForward >= SMASH_FORWARD_SPEED ||
      (forwardDisp >= SMASH_FORWARD_DISP && dxForward > 0.5)
    ) {
      paddle.smashForwardTimer = SMASH_FORWARD_WINDOW;
      paddle.lungeTarget = Math.max(paddle.lungeTarget, MAX_LUNGE_X * 0.88);
    }

    // 2) Deslizamiento vertical rápido (Remate con efecto)
    const vyInst = dy / dtSec;
    ctrl.smoothVy = ctrl.smoothVy * 0.4 + vyInst * 0.6;
    const signY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    if (signY !== 0) {
      if (signY === ctrl.swipeSignY) {
        ctrl.swipeDistY += Math.abs(dy);
      } else if (Math.abs(dy) > 2) {
        ctrl.swipeSignY = signY;
        ctrl.swipeDistY = Math.abs(dy);
      }
    }

    if (Math.abs(ctrl.smoothVy) >= SMASH_SWIPE_SPEED && ctrl.swipeDistY >= SMASH_SWIPE_DIST) {
      paddle.smashSwipeTimer = SMASH_SWIPE_WINDOW;
      paddle.smashSwipeDir = ctrl.smoothVy > 0 ? 1 : -1;
    }

    ctrl.lastX = pt.x;
    ctrl.lastY = pt.y;
    ctrl.lastTime = now;
  }

  function handleTouchStart(e) {
    lastTouchTimestamp = performance.now();
    unlockAudio();
    if (!e.changedTouches.length) return;
    if (game.state !== 'playing' && game.state !== 'countdown') return;
    if (e.target.closest('button, .overlay.visible')) return;

    let handled = false;
    if (game.mode === MODES.TWO_P) {
      // Modo 2 Jugadores: multitáctil independiente por mitad de pantalla
      const splitX = getSplitClientX();
      for (let s = 0; s < 2; s++) {
        if (controls[s].touchId !== null && !hasTouchInList(e.touches, controls[s].touchId)) {
          controls[s].touchId = null;
        }
      }
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const side = touch.clientX < splitX ? 0 : 1;
        if (controls[side].touchId === null) {
          beginPointerGesture(side, touch.clientX, touch.clientY, touch.identifier);
          handled = true;
        }
      }
    } else {
      // Modo 1 Jugador: un único toque controla la paleta izquierda en toda la pantalla
      if (controls[0].touchId !== null && !hasTouchInList(e.touches, controls[0].touchId)) {
        controls[0].touchId = null;
      }
      if (controls[0].touchId === null) {
        const touch = e.changedTouches[0];
        beginPointerGesture(0, touch.clientX, touch.clientY, touch.identifier);
        handled = true;
      }
    }

    if (handled || controls[0].touchId !== null || controls[1].touchId !== null) {
      e.preventDefault();
    }
  }

  function handleTouchMove(e) {
    lastTouchTimestamp = performance.now();
    if (!e.changedTouches.length) return;
    if (game.state !== 'playing' && game.state !== 'countdown') return;

    let handled = false;
    if (game.mode === MODES.TWO_P) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === controls[0].touchId) {
          updatePointerGesture(0, touch.clientX, touch.clientY);
          handled = true;
        } else if (touch.identifier === controls[1].touchId) {
          updatePointerGesture(1, touch.clientX, touch.clientY);
          handled = true;
        }
      }
    } else if (controls[0].touchId !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === controls[0].touchId) {
          updatePointerGesture(0, touch.clientX, touch.clientY);
          handled = true;
          break;
        }
      }
    }

    if (handled || controls[0].touchId !== null || controls[1].touchId !== null) {
      e.preventDefault();
    }
  }

  function handleTouchEnd(e) {
    lastTouchTimestamp = performance.now();
    if (!e.changedTouches.length) return;

    const splitX = game.mode === MODES.TWO_P ? getSplitClientX() : 0;

    for (let i = 0; i < e.changedTouches.length; i++) {
      const endedId = e.changedTouches[i].identifier;

      for (let side = 0; side < (game.mode === MODES.TWO_P ? 2 : 1); side++) {
        if (controls[side].touchId !== endedId) continue;

        controls[side].touchId = null;
        controls[side].smoothVy = 0;
        controls[side].smoothVxForward = 0;
        controls[side].swipeDistY = 0;
        controls[side].swipeSignY = 0;

        // Si queda otro dedo sin asignar en el mismo lado, tomarlo suavemente
        const otherTouchId = controls[1 - side].touchId;
        for (let j = 0; j < e.touches.length; j++) {
          const candidate = e.touches[j];
          if (candidate.identifier === otherTouchId) continue;
          if (game.mode === MODES.TWO_P) {
            const candidateSide = candidate.clientX < splitX ? 0 : 1;
            if (candidateSide !== side) continue;
          }
          beginPointerGesture(side, candidate.clientX, candidate.clientY, candidate.identifier);
          break;
        }
      }
    }
  }

  canvas.addEventListener('mousemove', (e) => {
    if (performance.now() - lastTouchTimestamp < 600) return;
    if (game.state !== 'playing' && game.state !== 'countdown') return;
    if (game.mode === MODES.TWO_P) {
      const side = e.clientX < getSplitClientX() ? 0 : 1;
      updatePointerGesture(side, e.clientX, e.clientY);
    } else {
      updatePointerGesture(0, e.clientX, e.clientY);
    }
  });

  appEl.addEventListener('touchstart', handleTouchStart, { passive: false });
  appEl.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  // Ahorro de energía al perder el foco o pasar a segundo plano
  function handleAppSuspend() {
    controls[0].up = controls[0].down = false;
    controls[1].up = controls[1].down = false;
    clearActiveTouches();
    if (game.state === 'playing' || game.state === 'countdown') {
      togglePause();
    } else {
      stopLoop();
    }
  }

  window.addEventListener('blur', handleAppSuspend);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      handleAppSuspend();
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
  el.modeBtns.forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    setMode(b.dataset.mode);
    Sound.click();
  }));

  el.diffBtns.forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    setDifficulty(b.dataset.diff);
    Sound.click();
  }));

  document.getElementById('start-btn').addEventListener('click', startMatch);
  document.getElementById('restart-btn').addEventListener('click', startMatch);
  document.getElementById('pause-restart-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch();
  });
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
  const savedDiff = localStorage.getItem(STORAGE_KEYS.difficulty);
  setDifficulty(DIFFICULTY[savedDiff] ? savedDiff : 'normal');
  const savedMode = localStorage.getItem(STORAGE_KEYS.mode);
  setMode(savedMode || MODES.VS_AI);
  renderMuteBtn();
  updatePauseBtn();
  resetPaddles();
  resetBall(false);
  resizeCanvas();
  renderStatic();

  window.__pong = { game, ball, player, ai, controls, DIFFICULTY, MODES };
})();
