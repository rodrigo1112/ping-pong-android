'use strict';

/**
 * NEON PONG — versión móvil Android (Capacitor).
 * HTML5 Canvas + Web Audio API, controles táctiles y pantalla adaptable.
 */
(() => {
  // ==========================================================
  //  Constantes
  // ==========================================================
  const W = 960;              // Ancho lógico del campo
  const H = 600;              // Alto lógico del campo
  const PADDLE_W = 14;
  const PADDLE_H = 100;
  const PADDLE_MARGIN = 28;
  const BALL_R = 8;
  const WIN_SCORE = 7;
  const BALL_START_SPEED = 430;   // px/s
  const BALL_MAX_SPEED = 1150;    // px/s
  const BALL_SPEEDUP = 1.06;      // +6% por golpe
  const MAX_BOUNCE_ANGLE = Math.PI * 0.3; // 54°
  const PLAYER_SPEED = 640;       // px/s con teclado
  const PLAYER_POINTER_SPEED = 2400; // px/s con tacto / ratón
  const COUNTDOWN_TIME = 3;
  const TRAIL_LENGTH = 16;

  const COLORS = {
    bg: '#0b0f19',
    player: '#22d3ee',
    ai: '#f472b6',
    ball: '#f8fafc',
    ballGlow: '#a5f3fc',
    line: 'rgba(148, 163, 184, 0.22)',
    violet: '#a78bfa',
  };

  /**
   * Parámetros de la IA por dificultad.
   */
  const DIFFICULTY = {
    easy:   { label: 'FÁCIL',   maxSpeed: 300, accel: 1800, reaction: 0.34, error: 80 },
    normal: { label: 'NORMAL',  maxSpeed: 430, accel: 2800, reaction: 0.20, error: 46 },
    hard:   { label: 'DIFÍCIL', maxSpeed: 570, accel: 4200, reaction: 0.10, error: 24 },
  };

  // ==========================================================
  //  Utilidades
  // ==========================================================
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (min, max) => min + Math.random() * (max - min);

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

    setMuted(muted) {
      this.muted = muted;
      localStorage.setItem('neonpong-muted', muted ? '1' : '0');
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
      }
    },

    tone({ freq, to = null, dur = 0.1, type = 'square', vol = 0.25, delay = 0 }) {
      if (!this.ctx || this.muted) return;
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
      notes.forEach((f, i) =>
        this.tone({ freq: f, dur: 0.16, type: 'sawtooth', vol: 0.12, delay: i * 0.1 }));
    },

    countdown(final) {
      this.tone({ freq: final ? 880 : 440, dur: final ? 0.28 : 0.12, type: 'sine', vol: 0.28 });
    },

    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.22, type: 'square', vol: 0.12, delay: i * 0.12 }));
    },

    lose() {
      [392, 349, 311, 262].forEach((f, i) =>
        this.tone({ freq: f, to: f * 0.97, dur: 0.28, type: 'triangle', vol: 0.22, delay: i * 0.16 }));
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

  // Desbloquea Web Audio API en el primer evento táctil del WebView de Android
  window.addEventListener('touchstart', unlockAudio, { passive: true, capture: true });
  window.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });

  // ==========================================================
  //  DOM
  // ==========================================================
  const appEl = document.getElementById('app');
  const stageEl = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
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

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const scale = Math.max(1, (rect.width / W) * dpr);
    const nextW = Math.round(W * scale);
    const nextH = Math.round(H * scale);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  // ==========================================================
  //  Estado del juego
  // ==========================================================
  const player = { x: PADDLE_MARGIN, y: H / 2 - PADDLE_H / 2, w: PADDLE_W, h: PADDLE_H, vy: 0, flash: 0 };
  const ai = {
    x: W - PADDLE_MARGIN - PADDLE_W, y: H / 2 - PADDLE_H / 2, w: PADDLE_W, h: PADDLE_H, vy: 0, flash: 0,
    target: H / 2, reactTimer: 0, thinkTimer: 0, errorOffset: 0, lastDir: 0,
  };
  const ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, speed: BALL_START_SPEED, trail: [] };

  const game = {
    state: 'menu',          // menu | countdown | playing | paused | gameover
    pausedFrom: null,
    difficulty: 'normal',
    scores: { player: 0, ai: 0 },
    countdown: 0,
    lastCountShown: 0,
    serveDir: 1,
    rally: 0,
    shake: 0,
  };

  let particles = [];
  let activeTouchId = null;

  const input = {
    up: false,
    down: false,
    mouseY: H / 2,
    mouseActive: false,
  };

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
      void node.offsetWidth; // reinicia la animación
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
    ball.trail.length = 0;
    game.rally = 0;
  }

  function startMatch() {
    unlockAudio();
    game.scores.player = 0;
    game.scores.ai = 0;
    updateScoreboard();
    particles = [];
    resetPaddles();
    game.serveDir = Math.random() < 0.5 ? -1 : 1;
    startCountdown();
    setOverlay(null);
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
    } else if (game.state === 'paused') {
      unlockAudio();
      game.state = game.pausedFrom || 'playing';
      setOverlay(null);
      Sound.click();
    }
  }

  function goToMenu() {
    game.state = 'menu';
    game.scores.player = game.scores.ai = 0;
    updateScoreboard();
    resetPaddles();
    startDemoBall();
    setOverlay('menu');
  }

  function pointScored(who) {
    game.scores[who] += 1;
    updateScoreboard(who);
    Sound.score(who === 'player');
    game.shake = 10;

    // Explosión de partículas en el borde donde salió la pelota
    const x = who === 'player' ? W : 0;
    spawnSparks(x, ball.y, who === 'player' ? -1 : 1, 40, who === 'player' ? COLORS.player : COLORS.ai, 1.6);

    if (game.scores[who] >= WIN_SCORE) {
      endMatch(who === 'player');
      return;
    }
    // Saca hacia quien perdió el punto
    game.serveDir = who === 'player' ? 1 : -1;
    startCountdown();
  }

  function endMatch(playerWon) {
    game.state = 'gameover';
    activeTouchId = null;
    resetBall();
    el.resultTitle.textContent = playerWon ? '¡VICTORIA!' : 'DERROTA';
    el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
    el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
    setTimeout(() => (playerWon ? Sound.win() : Sound.lose()), 350);
    setOverlay('gameover');
  }

  // Modo demostración en el menú
  function startDemoBall() {
    resetBall();
    const angle = rand(-0.5, 0.5);
    const dir = Math.random() < 0.5 ? -1 : 1;
    ball.vx = dir * Math.cos(angle) * BALL_START_SPEED;
    ball.vy = Math.sin(angle) * BALL_START_SPEED;
  }

  // ==========================================================
  //  Efectos
  // ==========================================================
  function spawnSparks(x, y, dir, count, color, power = 1) {
    for (let i = 0; i < count; i++) {
      const a = rand(-Math.PI / 2.6, Math.PI / 2.6);
      const s = rand(120, 420) * power;
      particles.push({
        x, y,
        vx: Math.cos(a) * s * dir,
        vy: Math.sin(a) * s,
        life: rand(0.25, 0.6),
        max: 0.6,
        size: rand(1.2, 3),
        color,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      const drag = Math.pow(0.04, dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
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

  function hitPaddle(p, dir, silent) {
    // Distancia normalizada al centro: -1 (borde superior) .. 1 (borde inferior)
    const rel = clamp((ball.y - (p.y + p.h / 2)) / (p.h / 2 + BALL_R), -1, 1);
    const angle = rel * MAX_BOUNCE_ANGLE;

    ball.speed = Math.min(ball.speed * BALL_SPEEDUP, BALL_MAX_SPEED);
    ball.vx = dir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.x = dir > 0 ? p.x + p.w + BALL_R : p.x - BALL_R;

    game.rally++;
    p.flash = 1;
    if (!silent) {
      const ratio = (ball.speed - BALL_START_SPEED) / (BALL_MAX_SPEED - BALL_START_SPEED);
      Sound.paddle(ratio);
      spawnSparks(ball.x, ball.y, dir, 14 + Math.round(ratio * 12), p === player ? COLORS.player : COLORS.ai);
      game.shake = Math.max(game.shake, 2 + ratio * 4);
    }
  }

  function updateBall(dt, demo = false) {
    // Sub-pasos para evitar que la pelota atraviese las paletas a alta velocidad
    const steps = Math.max(1, Math.ceil((ball.speed * dt) / (BALL_R * 0.5)));
    const sdt = dt / steps;

    for (let i = 0; i < steps; i++) {
      ball.x += ball.vx * sdt;
      ball.y += ball.vy * sdt;

      // Bordes superior e inferior (reflexión exacta)
      if (ball.y - BALL_R < 0) {
        ball.y = BALL_R + (BALL_R - ball.y);
        ball.vy = Math.abs(ball.vy);
        if (!demo) { Sound.wall(); spawnSparks(ball.x, 0, 1, 5, COLORS.violet, 0.5); }
      } else if (ball.y + BALL_R > H) {
        ball.y = H - BALL_R - (ball.y + BALL_R - H);
        ball.vy = -Math.abs(ball.vy);
        if (!demo) { Sound.wall(); spawnSparks(ball.x, H, 1, 5, COLORS.violet, 0.5); }
      }

      // Paletas (solo si la pelota se acerca y no ha pasado el centro de la paleta)
      if (ball.vx < 0 && ball.x >= player.x + player.w / 2 && circleRectHit(player)) {
        hitPaddle(player, 1, demo);
      } else if (ball.vx > 0 && ball.x <= ai.x + ai.w / 2 && circleRectHit(ai)) {
        hitPaddle(ai, -1, demo);
      }

      // Punto
      if (ball.x + BALL_R < 0 || ball.x - BALL_R > W) {
        if (demo) startDemoBall();
        else pointScored(ball.x < 0 ? 'ai' : 'player');
        return;
      }
    }
  }

  // ==========================================================
  //  Jugador
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

    // Suavizado de la velocidad
    const smoothing = input.mouseActive ? 1 : 1 - Math.pow(0.0001, dt);
    player.vy += (targetVy - player.vy) * smoothing;
    player.y = clamp(player.y + player.vy * dt, 0, H - player.h);
    if (player.y === 0 || player.y === H - player.h) {
      if ((player.y === 0 && player.vy < 0) || (player.y > 0 && player.vy > 0)) player.vy = 0;
    }
  }

  // ==========================================================
  //  Inteligencia artificial
  // ==========================================================

  /** Predice la Y de la pelota cuando alcance targetX, considerando rebotes en las paredes. */
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
    } else if (game.state === 'countdown') {
      ai.target = H / 2;
    } else if (game.state === 'menu') {
      ai.target = ball.vx > 0 ? predictBallY(ai.x - BALL_R) : H / 2;
    }

    const diff = ai.target - center;
    const deadzone = 5;
    const desired = Math.abs(diff) < deadzone ? 0 : clamp(diff * 7, -cfg.maxSpeed, cfg.maxSpeed);
    const maxDv = cfg.accel * dt;
    ai.vy += clamp(desired - ai.vy, -maxDv, maxDv);
    ai.y += ai.vy * dt;
    if (ai.y < 0) { ai.y = 0; ai.vy = 0; }
    if (ai.y > H - ai.h) { ai.y = H - ai.h; ai.vy = 0; }
  }

  // Paleta del jugador en el menú (demo)
  function updateDemoPlayer(dt) {
    const target = ball.vx < 0 ? predictBallY(player.x + player.w + BALL_R) : H / 2;
    const diff = target - (player.y + player.h / 2);
    player.vy = clamp(diff * 7, -420, 420);
    player.y = clamp(player.y + player.vy * dt, 0, H - player.h);
  }

  // ==========================================================
  //  Actualización
  // ==========================================================
  function update(dt) {
    switch (game.state) {
      case 'menu':
        updateDemoPlayer(dt);
        updateAI(dt);
        updateBall(dt, true);
        break;

      case 'countdown': {
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
        break;
      }

      case 'playing':
        updatePlayer(dt);
        updateAI(dt);
        updateBall(dt);
        break;

      default:
        break;
    }

    if (game.state !== 'paused') {
      updateParticles(dt);
      game.shake = Math.max(0, game.shake - dt * 40);
      player.flash = Math.max(0, player.flash - dt * 4);
      ai.flash = Math.max(0, ai.flash - dt * 4);

      if (game.state === 'playing' || game.state === 'menu') {
        ball.trail.push({ x: ball.x, y: ball.y });
        if (ball.trail.length > TRAIL_LENGTH) ball.trail.shift();
      }
    }
  }

  // ==========================================================
  //  Renderizado
  // ==========================================================
  function drawBackground() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    // Rejilla sutil
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 40) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); }
    ctx.stroke();

    // Línea central discontinua
    ctx.save();
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 16]);
    ctx.lineDashOffset = -6;
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.restore();

    // Círculo central
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
    ctx.stroke();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawPaddle(p, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 + p.flash * 22;
    ctx.fillStyle = color;
    roundRect(p.x, p.y, p.w, p.h, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + p.flash * 0.6})`;
    roundRect(p.x + 4, p.y + 6, p.w - 8, p.h - 12, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawBall() {
    const n = ball.trail.length;
    for (let i = 0; i < n; i++) {
      const t = ball.trail[i];
      const k = (i + 1) / n;
      ctx.fillStyle = `rgba(165, 243, 252, ${k * 0.35})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, BALL_R * (0.35 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.shadowColor = COLORS.ballGlow;
    ctx.shadowBlur = 24;
    ctx.fillStyle = COLORS.ball;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCountdown() {
    const n = Math.ceil(game.countdown);
    if (n <= 0) return;
    const frac = game.countdown - Math.floor(game.countdown);
    const scale = 0.8 + frac * 0.6;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);
    ctx.globalAlpha = clamp(frac * 1.4, 0, 1);
    ctx.font = '900 140px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = COLORS.violet;
    ctx.shadowBlur = 40;
    ctx.fillStyle = COLORS.violet;
    ctx.fillText(String(n), 0, 0);
    ctx.restore();

    ctx.save();
    ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.55)';
    ctx.fillText(game.serveDir < 0 ? 'SAQUE HACIA TI' : 'SAQUE HACIA LA IA', W / 2, H / 2 + 110);
    ctx.restore();
  }

  function render() {
    ctx.save();
    if (game.shake > 0) {
      ctx.translate(rand(-game.shake, game.shake) * 0.5, rand(-game.shake, game.shake) * 0.5);
    }
    drawBackground();
    drawPaddle(player, COLORS.player);
    drawPaddle(ai, COLORS.ai);
    drawParticles();
    if (game.state !== 'gameover') drawBall();
    if (game.state === 'countdown' || (game.state === 'paused' && game.pausedFrom === 'countdown')) {
      drawCountdown();
    }
    ctx.restore();
  }

  // ==========================================================
  //  Bucle principal (requestAnimationFrame + deltaTime)
  // ==========================================================
  let lastTime = performance.now();
  function frame(now) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 20);
    lastTime = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
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
    const rect = canvas.getBoundingClientRect();
    if (!rect.height) return H / 2;
    return clamp(((clientY - rect.top) / rect.height) * H, 0, H);
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

  // Controles táctiles principales en el canvas
  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  // Permite deslizar el dedo también en los márgenes laterales en pantallas anchas
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

  // Pausa automática al perder el foco o minimizar la app
  window.addEventListener('blur', () => {
    input.up = input.down = false;
    activeTouchId = null;
    if (game.state === 'playing' || game.state === 'countdown') togglePause();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (game.state === 'playing' || game.state === 'countdown')) {
      activeTouchId = null;
      togglePause();
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
  //  Inicio
  // ==========================================================
  const savedDiff = localStorage.getItem('neonpong-difficulty');
  setDifficulty(DIFFICULTY[savedDiff] ? savedDiff : 'normal');
  renderMuteBtn();
  updatePauseBtn();
  resizeCanvas();
  startDemoBall();
  requestAnimationFrame(frame);

  window.__pong = { game, ball, player, ai, DIFFICULTY };
})();
