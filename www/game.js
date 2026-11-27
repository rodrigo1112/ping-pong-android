'use strict';

/**
 * NEON PONG — versión móvil Android (Capacitor) optimizada para GPU y batería.
 * - Modo Torneo principal (4 rondas: Cuartos, Semifinal, Final y Gran Campeón)
 *   con escalado de IA, canchas alternadas, skins desbloqueables y guardado local.
 * - Modos secundarios: Partida Rápida (Fácil/Normal/Difícil), 2 Jugadores
 *   local con multitáctil y Supervivencia / Récord (IA acelera cada 5 golpes).
 * - 4 estilos visuales 100% originales sin marcas registradas:
 *   Neón Clásico, Retro Portátil 89, Fuego vs. Hielo y Cyberpunk 2099.
 * - Música procedural distinta por cancha (Web Audio API) con desconexión
 *   limpia de nodos y controles independientes de Música y SFX.
 * - Protección térmica: fondos y sprites pre-renderizados en offscreen canvas,
 *   cero shadowBlur en runtime, tope estricto a 60 FPS y DPR <= 1.5.
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
  const QUICK_WIN_SCORE = 7;
  const TOURNAMENT_WIN_SCORE = 5;
  const BALL_START_SPEED = 430;
  const BALL_MAX_SPEED = 1150;
  const BALL_SPEEDUP = 1.06;
  const MAX_BOUNCE_ANGLE = Math.PI * 0.3;
  const PLAYER_SPEED = 640;
  const PLAYER_POINTER_SPEED = 2400;
  const COUNTDOWN_TIME = 3;
  const SURVIVAL_RESERVE_COUNTDOWN = 2;

  // Remate (Smash), Barra de Poder y Súper Golpe (Pelota Furiosa)
  const MAX_LUNGE_X = 24;
  const SMASH_FORWARD_SPEED = 230;
  const SMASH_FORWARD_DISP = 16;
  const SMASH_FORWARD_WINDOW = 0.18;
  const SMASH_SWIPE_SPEED = 740;
  const SMASH_SWIPE_DIST = 26;
  const SMASH_SWIPE_WINDOW = 0.14;
  const SMASH_PADDLE_VY = 360;
  const SMASH_EDGE_REL = 0.68;
  const SMASH_SPEED_MULT = 1.26;
  const SMASH_MIN_SPEED = 720;
  const SMASH_MAX_SPEED = 1320;
  const SMASH_CURVE_BASE = 265;
  const SMASH_CURVE_COMBO = 325;
  const SMASH_EMBER_INTERVAL = 0.032;

  const POWER_PER_SMASH = 34; // 3 Smash -> 100%
  const FURIOUS_SPEED_MULT = 1.72;
  const FURIOUS_MIN_SPEED = 1380;
  const FURIOUS_MAX_SPEED = 1660;
  const FURIOUS_CURVE_ACCEL = 165;
  const FURIOUS_EMBER_INTERVAL = 0.016;
  const SERVE_MAX_ANGLE = 0.30; // asegura >= 95% velocidad horizontal en saques

  // Modo Supervivencia
  const SURVIVAL_HITS_PER_LEVEL = 5;

  // Persistencia localStorage
  const STORAGE_KEYS = {
    legacyMuted: 'neonpong-muted',
    sfxMuted: 'neonpong-sfx-muted',
    musicMuted: 'neonpong-music-muted',
    difficulty: 'neonpong-difficulty',
    survivalBest: 'neonpong-survival-best',
    tournament: 'neonpong-tournament',
    unlockedSkins: 'neonpong-unlocked-skins',
    equippedSkin: 'neonpong-equipped-skin',
    tournamentUseSkin: 'neonpong-tournament-use-skin',
    records: 'neonpong-records',
    trophies: 'neonpong-trophies',
  };

  // Trofeos desbloqueables
  const TROPHIES = [
    { id: 'first_champion', name: 'Primer Campeón', desc: 'Ganá 1 torneo completo', icon: '★', metric: 'tournamentsWon', target: 1 },
    { id: 'clean_sheet', name: 'Valla Invicta', desc: 'Ganá un partido sin recibir ningún punto', icon: '◆', metric: 'cleanSheet', target: 1 },
    { id: 'unstoppable', name: 'Imparable', desc: 'Conseguí una racha de 5 victorias seguidas', icon: '⚡', metric: 'bestWinStreak', target: 5 },
    { id: 'total_fury', name: 'Furia Total', desc: 'Conectá 10 Súper Golpes acumulados', icon: '▲', metric: 'totalSuperShots', target: 10 },
    { id: 'ping_pong_legend', name: 'Leyenda del Ping Pong', desc: 'Ganá 3 torneos completos', icon: '♛', metric: 'tournamentsWon', target: 3 },
  ];

  const MODES = {
    TOURNAMENT: 'tournament',
    VS_AI: 'vs-ai',
    TWO_P: '2p',
    SURVIVAL: 'survival',
  };

  // Límites térmicos, de rendimiento y memoria
  const MAX_FPS = 60;
  const FRAME_INTERVAL = 1000 / MAX_FPS;
  const FRAME_TOLERANCE = 1.0;
  const MAX_DPR = 1.5;
  const SPRITE_SCALE = 1.5;
  const MAX_PARTICLES = 64;
  const TRAIL_LENGTH = 12;
  const MAX_CALLOUTS = 3;

  const COLOR_IDX_PLAYER = 0;
  const COLOR_IDX_AI = 1;
  const COLOR_IDX_ACCENT = 2;
  const COLOR_IDX_SMASH_ORANGE = 3;
  const COLOR_IDX_SMASH_RED = 4;

  // ==========================================================
  //  Definición de 4 Skins / Canchas (100% libres de copyright)
  // ==========================================================
  const SKIN_ORDER = ['neon', 'retro89', 'fireice', 'cyber2099'];

  const SKINS = {
    neon: {
      id: 'neon',
      name: 'Neón Clásico',
      arenaTitle: 'Arena Neón',
      themeColor: '#0b0f19',
      unlockHint: 'Desbloqueada desde el inicio',
      styleDesc: 'Fondo nocturno con líneas cian y magenta',
      pixelated: false,
      previewBg: 'linear-gradient(90deg, #0b0f19 0%, #11192e 50%, #0b0f19 100%)',
      playerColor: '#22d3ee',
      aiColor: '#f472b6',
      ballColor: '#f8fafc',
      ballGlowInner: '#e0f2fe',
      ballGlowMid: 'rgba(165, 243, 252, 0.58)',
      ballGlowOuter: 'rgba(34, 211, 238, 0.18)',
      ballGlowFade: 'rgba(34, 211, 238, 0)',
      trailInner: 'rgba(165, 243, 252, 0.95)',
      trailMid: 'rgba(34, 211, 238, 0.45)',
      trailFade: 'rgba(34, 211, 238, 0)',
      digitFill: '#a78bfa',
      digitStrokeOuter: 'rgba(167, 139, 250, 0.16)',
      digitStrokeMid: 'rgba(167, 139, 250, 0.34)',
      digitStrokeInner: 'rgba(237, 233, 254, 0.75)',
      serveText: 'rgba(226, 232, 240, 0.7)',
      calloutStroke: 'rgba(11, 15, 25, 0.88)',
      particles: ['#22d3ee', '#f472b6', '#a78bfa', '#fb923c', '#ef4444'],
    },
    retro89: {
      id: 'retro89',
      name: 'Retro Portátil 89',
      arenaTitle: 'Retro Portátil 89',
      themeColor: '#8bac0f',
      unlockHint: 'Ganá la Ronda 2 (Semifinal) del Torneo',
      styleDesc: 'Paleta verde oliva monocromática estilo portátil de 8 bits',
      pixelated: true,
      previewBg: 'linear-gradient(90deg, #9bbc0f 0%, #8bac0f 50%, #9bbc0f 100%)',
      playerColor: '#0f380f',
      aiColor: '#306230',
      ballColor: '#0f380f',
      ballGlowInner: '#306230',
      ballGlowMid: 'rgba(48, 98, 48, 0.45)',
      ballGlowOuter: 'rgba(15, 56, 15, 0.15)',
      ballGlowFade: 'rgba(15, 56, 15, 0)',
      trailInner: 'rgba(48, 98, 48, 0.85)',
      trailMid: 'rgba(48, 98, 48, 0.4)',
      trailFade: 'rgba(139, 172, 15, 0)',
      digitFill: '#0f380f',
      digitStrokeOuter: 'rgba(139, 172, 15, 0.5)',
      digitStrokeMid: 'rgba(48, 98, 48, 0.45)',
      digitStrokeInner: '#9bbc0f',
      serveText: '#0f380f',
      calloutStroke: 'rgba(155, 188, 15, 0.92)',
      particles: ['#0f380f', '#306230', '#306230', '#ea580c', '#dc2626'],
    },
    fireice: {
      id: 'fireice',
      name: 'Fuego vs. Hielo',
      arenaTitle: 'Fuego vs. Hielo',
      themeColor: '#13090c',
      unlockHint: 'Ganá la Ronda 3 (Final) del Torneo',
      styleDesc: 'Mitad izquierda volcánica y mitad derecha glacial',
      pixelated: false,
      previewBg: 'linear-gradient(90deg, #431407 0%, #7c2d12 47%, #0c4a6e 53%, #082f49 100%)',
      playerColor: '#f97316',
      aiColor: '#38bdf8',
      ballColor: '#fffbeb',
      ballGlowInner: '#fef3c7',
      ballGlowMid: 'rgba(251, 146, 60, 0.52)',
      ballGlowOuter: 'rgba(56, 189, 248, 0.24)',
      ballGlowFade: 'rgba(56, 189, 248, 0)',
      trailInner: 'rgba(254, 215, 170, 0.95)',
      trailMid: 'rgba(56, 189, 248, 0.45)',
      trailFade: 'rgba(56, 189, 248, 0)',
      digitFill: '#fdba74',
      digitStrokeOuter: 'rgba(249, 115, 22, 0.2)',
      digitStrokeMid: 'rgba(56, 189, 248, 0.35)',
      digitStrokeInner: 'rgba(255, 251, 235, 0.82)',
      serveText: 'rgba(241, 245, 249, 0.8)',
      calloutStroke: 'rgba(15, 7, 10, 0.9)',
      particles: ['#fb923c', '#38bdf8', '#fde047', '#fb923c', '#ef4444'],
    },
    cyber2099: {
      id: 'cyber2099',
      name: 'Cyberpunk 2099',
      arenaTitle: 'Cyberpunk 2099',
      themeColor: '#100720',
      unlockHint: 'Ganá el Torneo completo (Ronda 4)',
      styleDesc: 'Violeta nocturno, amarillo eléctrico, cian y grilla geométrica',
      pixelated: false,
      previewBg: 'linear-gradient(90deg, #1b0b38 0%, #2e1065 50%, #0f172a 100%)',
      playerColor: '#facc15',
      aiColor: '#06b6d4',
      ballColor: '#fef9c3',
      ballGlowInner: '#fef08a',
      ballGlowMid: 'rgba(250, 204, 21, 0.56)',
      ballGlowOuter: 'rgba(6, 182, 212, 0.25)',
      ballGlowFade: 'rgba(6, 182, 212, 0)',
      trailInner: 'rgba(254, 240, 138, 0.96)',
      trailMid: 'rgba(6, 182, 212, 0.48)',
      trailFade: 'rgba(232, 121, 249, 0)',
      digitFill: '#facc15',
      digitStrokeOuter: 'rgba(232, 121, 249, 0.22)',
      digitStrokeMid: 'rgba(6, 182, 212, 0.38)',
      digitStrokeInner: 'rgba(254, 249, 195, 0.85)',
      serveText: 'rgba(254, 240, 138, 0.82)',
      calloutStroke: 'rgba(16, 7, 32, 0.92)',
      particles: ['#facc15', '#06b6d4', '#e879f9', '#fb923c', '#ef4444'],
    },
  };

  // ==========================================================
  //  Torneo de 4 Rondas con escalado lógico de IA
  // ==========================================================
  const TOURNAMENT_ROUNDS = [
    {
      index: 0,
      stageName: 'CUARTOS DE FINAL',
      shortName: 'Cuartos',
      skin: 'neon',
      rivalName: 'Centinela Neón',
      aiStyle: 'IA Inicial · Velocidad moderada y margen amplio',
      unlockSkin: null,
      ai: { maxSpeed: 310, accel: 1900, reaction: 0.32, error: 74, edgeAim: 0.0, wallAnticipation: 0.25, mistakeChance: 0.11 },
    },
    {
      index: 1,
      stageName: 'SEMIFINAL',
      shortName: 'Semifinal',
      skin: 'retro89',
      rivalName: 'Táctico 89',
      aiStyle: 'IA Táctica · Más veloz y busca ángulos con los bordes',
      unlockSkin: 'retro89',
      ai: { maxSpeed: 425, accel: 2900, reaction: 0.20, error: 42, edgeAim: 0.55, wallAnticipation: 0.55, mistakeChance: 0.08 },
    },
    {
      index: 2,
      stageName: 'FINAL',
      shortName: 'Final',
      skin: 'fireice',
      rivalName: 'Titán Térmico',
      aiStyle: 'IA Agresiva · Reacción rápida y anticipa rebotes en pared',
      unlockSkin: 'fireice',
      ai: { maxSpeed: 530, accel: 4000, reaction: 0.12, error: 24, edgeAim: 0.72, wallAnticipation: 0.92, mistakeChance: 0.06 },
    },
    {
      index: 3,
      stageName: 'GRAN CAMPEÓN',
      shortName: 'Campeón',
      skin: 'cyber2099',
      rivalName: 'Maestro 2099',
      aiStyle: 'IA Maestra · Reflejos altos y lectura fina con margen humano',
      unlockSkin: 'cyber2099',
      ai: { maxSpeed: 620, accel: 4800, reaction: 0.08, error: 18, edgeAim: 0.85, wallAnticipation: 1.0, mistakeChance: 0.07 },
    },
  ];

  const DIFFICULTY = {
    easy:   { label: 'FÁCIL',   maxSpeed: 300, accel: 1800, reaction: 0.34, error: 80, edgeAim: 0.0, wallAnticipation: 0.3, mistakeChance: 0.10 },
    normal: { label: 'NORMAL',  maxSpeed: 430, accel: 2800, reaction: 0.20, error: 46, edgeAim: 0.35, wallAnticipation: 0.75, mistakeChance: 0.08 },
    hard:   { label: 'DIFÍCIL', maxSpeed: 570, accel: 4200, reaction: 0.10, error: 24, edgeAim: 0.70, wallAnticipation: 1.0, mistakeChance: 0.05 },
  };

  // ==========================================================
  //  Utilidades
  // ==========================================================
  const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
  const rand = (min, max) => min + Math.random() * (max - min);
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

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
  //  Sprites pre-renderizados por Skin (cero shadowBlur en runtime)
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

  function buildBackgroundSprite(skinId) {
    const { canvas: c, ctx: g } = createOffscreen(W + BG_PAD * 2, H + BG_PAD * 2);
    g.translate(BG_PAD, BG_PAD);

    if (skinId === 'retro89') {
      // Fondo monocromo LCD verde oliva con matriz de píxeles
      g.fillStyle = '#9bbc0f';
      g.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);

      // Rejilla LCD sutil estilo pantalla portátil clásica
      g.strokeStyle = 'rgba(139, 172, 15, 0.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x += 20) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
      for (let y = 0; y <= H; y += 20) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
      g.stroke();

      // Marco interior pixelado
      g.fillStyle = '#8bac0f';
      g.fillRect(0, 0, W, 10);
      g.fillRect(0, H - 10, W, 10);
      g.fillStyle = '#306230';
      g.fillRect(0, 0, W, 4);
      g.fillRect(0, H - 4, W, 4);

      // Emblema cuadrado pixelado en el centro
      g.strokeStyle = '#8bac0f';
      g.lineWidth = 6;
      g.strokeRect(W / 2 - 64, H / 2 - 64, 128, 128);
      g.strokeStyle = '#306230';
      g.lineWidth = 3;
      g.strokeRect(W / 2 - 52, H / 2 - 52, 104, 104);

      // Línea central de bloques pixelados
      g.fillStyle = '#306230';
      for (let y = 14; y < H - 14; y += 28) {
        g.fillRect(W / 2 - 4, y, 8, 16);
      }

      // Puntos decorativos en las esquinas
      g.fillStyle = '#0f380f';
      const corners = [[12, 12], [W - 20, 12], [12, H - 20], [W - 20, H - 20]];
      for (let i = 0; i < corners.length; i++) {
        g.fillRect(corners[i][0], corners[i][1], 8, 8);
      }
      return c;
    }

    if (skinId === 'fireice') {
      // Mitad izquierda volcánica (fuego)
      const fireGrad = g.createLinearGradient(0, 0, W / 2, H);
      fireGrad.addColorStop(0, '#230906');
      fireGrad.addColorStop(0.55, '#190809');
      fireGrad.addColorStop(1, '#14080e');
      g.fillStyle = fireGrad;
      g.fillRect(-BG_PAD, -BG_PAD, W / 2 + BG_PAD, H + BG_PAD * 2);

      // Mitad derecha glacial (hielo)
      const iceGrad = g.createLinearGradient(W / 2, 0, W, H);
      iceGrad.addColorStop(0, '#0b1424');
      iceGrad.addColorStop(0.55, '#071c30');
      iceGrad.addColorStop(1, '#062238');
      g.fillStyle = iceGrad;
      g.fillRect(W / 2, -BG_PAD, W / 2 + BG_PAD, H + BG_PAD * 2);

      // Resplandor ambiental en bordes laterales
      const leftGlow = g.createRadialGradient(0, H / 2, 20, 0, H / 2, 340);
      leftGlow.addColorStop(0, 'rgba(249, 115, 22, 0.16)');
      leftGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
      g.fillStyle = leftGlow;
      g.fillRect(0, 0, W / 2, H);

      const rightGlow = g.createRadialGradient(W, H / 2, 20, W, H / 2, 340);
      rightGlow.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      rightGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      g.fillStyle = rightGlow;
      g.fillRect(W / 2, 0, W / 2, H);

      // Trama volcánica izquierda (diagonales cálidas)
      g.strokeStyle = 'rgba(251, 146, 60, 0.065)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = -H; i < W / 2; i += 44) {
        g.moveTo(Math.max(0, i), Math.max(0, -i));
        const endX = Math.min(W / 2, i + H);
        const endY = endX - i;
        g.lineTo(endX, endY);
      }
      g.stroke();

      // Trama cristalina derecha (diagonales glaciales opuestas)
      g.strokeStyle = 'rgba(56, 189, 248, 0.07)';
      g.beginPath();
      for (let i = W / 2; i < W + H; i += 44) {
        const startX = Math.min(W, i);
        const startY = Math.max(0, i - W);
        const endX = Math.max(W / 2, i - H);
        const endY = startY + (startX - endX);
        g.moveTo(startX, startY);
        g.lineTo(endX, endY);
      }
      g.stroke();

      // Semicírculos enfrentados en el centro
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(249, 115, 22, 0.42)';
      g.beginPath();
      g.arc(W / 2, H / 2, 72, Math.PI * 0.5, Math.PI * 1.5);
      g.stroke();

      g.strokeStyle = 'rgba(56, 189, 248, 0.42)';
      g.beginPath();
      g.arc(W / 2, H / 2, 72, -Math.PI * 0.5, Math.PI * 0.5);
      g.stroke();

      // Grieta central Fuego/Hielo
      for (let y = 8; y < H; y += 34) {
        g.fillStyle = 'rgba(249, 115, 22, 0.42)';
        g.fillRect(W / 2 - 3, y, 3, 18);
        g.fillStyle = 'rgba(56, 189, 248, 0.42)';
        g.fillRect(W / 2, y, 3, 18);
      }

      // Bordes superior e inferior divididos
      g.fillStyle = 'rgba(249, 115, 22, 0.45)';
      g.fillRect(0, 0, W / 2, 3);
      g.fillRect(0, H - 3, W / 2, 3);
      g.fillStyle = 'rgba(56, 189, 248, 0.45)';
      g.fillRect(W / 2, 0, W / 2, 3);
      g.fillRect(W / 2, H - 3, W / 2, 3);
      return c;
    }

    if (skinId === 'cyber2099') {
      // Violeta nocturno profundo
      const bgGrad = g.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#14082a');
      bgGrad.addColorStop(0.5, '#0e061d');
      bgGrad.addColorStop(1, '#170a2e');
      g.fillStyle = bgGrad;
      g.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);

      // Grilla geométrica ortogonal + rombos sutiles
      g.strokeStyle = 'rgba(6, 182, 212, 0.065)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 0; x <= W; x += 48) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
      for (let y = 0; y <= H; y += 48) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
      g.stroke();

      g.strokeStyle = 'rgba(250, 204, 21, 0.04)';
      g.beginPath();
      for (let x = 48; x < W; x += 96) {
        for (let y = 48; y < H; y += 96) {
          g.moveTo(x, y - 16);
          g.lineTo(x + 16, y);
          g.lineTo(x, y + 16);
          g.lineTo(x - 16, y);
          g.closePath();
        }
      }
      g.stroke();

      // Emblema central romboidal cyberpunk
      g.strokeStyle = 'rgba(250, 204, 21, 0.24)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(W / 2, H / 2 - 78);
      g.lineTo(W / 2 + 78, H / 2);
      g.lineTo(W / 2, H / 2 + 78);
      g.lineTo(W / 2 - 78, H / 2);
      g.closePath();
      g.stroke();

      g.strokeStyle = 'rgba(6, 182, 212, 0.28)';
      g.beginPath();
      g.moveTo(W / 2, H / 2 - 52);
      g.lineTo(W / 2 + 52, H / 2);
      g.lineTo(W / 2, H / 2 + 52);
      g.lineTo(W / 2 - 52, H / 2);
      g.closePath();
      g.stroke();

      // Línea central segmentada eléctrico-cian
      g.save();
      g.strokeStyle = 'rgba(250, 204, 21, 0.34)';
      g.lineWidth = 3;
      g.setLineDash([16, 14]);
      g.beginPath();
      g.moveTo(W / 2, 0);
      g.lineTo(W / 2, H);
      g.stroke();
      g.restore();

      // Escuadras HUD geométricas en las 4 esquinas
      g.strokeStyle = 'rgba(250, 204, 21, 0.42)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(14, 42); g.lineTo(14, 14); g.lineTo(42, 14);
      g.moveTo(14, H - 42); g.lineTo(14, H - 14); g.lineTo(42, H - 14);
      g.stroke();

      g.strokeStyle = 'rgba(6, 182, 212, 0.42)';
      g.beginPath();
      g.moveTo(W - 42, 14); g.lineTo(W - 14, 14); g.lineTo(W - 14, 42);
      g.moveTo(W - 42, H - 14); g.lineTo(W - 14, H - 14); g.lineTo(W - 14, H - 42);
      g.stroke();

      // Bordes superior amarillo eléctrico e inferior cian neón
      g.fillStyle = 'rgba(250, 204, 21, 0.45)';
      g.fillRect(0, 0, W, 3);
      g.fillStyle = 'rgba(6, 182, 212, 0.45)';
      g.fillRect(0, H - 3, W, 3);
      return c;
    }

    // Por defecto: Neón Clásico
    g.fillStyle = '#0b0f19';
    g.fillRect(-BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);

    g.strokeStyle = 'rgba(34, 211, 238, 0.04)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 40) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
    for (let y = 0; y <= H; y += 40) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
    g.stroke();

    g.save();
    g.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    g.lineWidth = 4;
    g.setLineDash([18, 16]);
    g.lineDashOffset = -6;
    g.beginPath();
    g.moveTo(W / 2, 0);
    g.lineTo(W / 2, H);
    g.stroke();
    g.restore();

    g.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, H / 2, 70, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = 'rgba(34, 211, 238, 0.16)';
    g.fillRect(0, 0, W, 2);
    g.fillStyle = 'rgba(244, 114, 182, 0.16)';
    g.fillRect(0, H - 2, W, 2);

    return c;
  }

  function buildPaddleSprite(color, isFlash, coreColor, pixelated, isRightRetro) {
    const { canvas: c, ctx: g } = createOffscreen(PADDLE_SPRITE_W, PADDLE_SPRITE_H);
    const x = PADDLE_PAD;
    const y = PADDLE_PAD;

    if (pixelated) {
      if (!isFlash) {
        // Sombra pixelada dura (estilo portátil 8-bit)
        g.fillStyle = '#8bac0f';
        g.fillRect(x + 3, y + 3, PADDLE_W, PADDLE_H);
        g.fillStyle = '#0f380f';
        g.fillRect(x, y, PADDLE_W, PADDLE_H);
        g.fillStyle = color;
        g.fillRect(x + 2, y + 2, PADDLE_W - 4, PADDLE_H - 4);
        if (isRightRetro) {
          g.fillStyle = '#8bac0f';
          for (let py = y + 8; py < y + PADDLE_H - 8; py += 12) {
            g.fillRect(x + 4, py, PADDLE_W - 8, 4);
          }
        } else {
          g.fillStyle = '#306230';
          g.fillRect(x + 4, y + 6, PADDLE_W - 8, PADDLE_H - 12);
        }
      } else {
        g.fillStyle = coreColor || '#9bbc0f';
        g.globalAlpha = 0.85;
        g.fillRect(x - 2, y - 2, PADDLE_W + 4, PADDLE_H + 4);
      }
      g.globalAlpha = 1;
      return c;
    }

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

      g.fillStyle = 'rgba(255, 255, 255, 0.36)';
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

  function buildBallSprite(skin) {
    const { canvas: c, ctx: g } = createOffscreen(BALL_SPRITE_SIZE, BALL_SPRITE_SIZE);
    const cx = BALL_SPRITE_HALF;
    const cy = BALL_SPRITE_HALF;

    if (skin.pixelated) {
      g.fillStyle = '#306230';
      g.fillRect(cx - BALL_R - 2, cy - BALL_R - 2, (BALL_R + 2) * 2, (BALL_R + 2) * 2);
      g.fillStyle = '#0f380f';
      g.fillRect(cx - BALL_R, cy - BALL_R, BALL_R * 2, BALL_R * 2);
      g.fillStyle = '#8bac0f';
      g.fillRect(cx - BALL_R + 3, cy - BALL_R + 3, 4, 4);
      return c;
    }

    const grad = g.createRadialGradient(cx, cy, 2, cx, cy, BALL_SPRITE_HALF - 2);
    grad.addColorStop(0.0, '#ffffff');
    grad.addColorStop(0.28, skin.ballGlowInner);
    grad.addColorStop(0.45, skin.ballGlowMid);
    grad.addColorStop(0.72, skin.ballGlowOuter);
    grad.addColorStop(1.0, skin.ballGlowFade);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, BALL_SPRITE_HALF - 2, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = skin.ballColor;
    g.beginPath();
    g.arc(cx, cy, BALL_R, 0, Math.PI * 2);
    g.fill();

    return c;
  }

  function buildSmashBallSprite(pixelated) {
    const { canvas: c, ctx: g } = createOffscreen(BALL_SMASH_SPRITE_SIZE, BALL_SMASH_SPRITE_SIZE);
    const cx = BALL_SMASH_SPRITE_HALF;
    const cy = BALL_SMASH_SPRITE_HALF;

    if (pixelated) {
      g.fillStyle = 'rgba(239, 68, 68, 0.35)';
      g.fillRect(cx - 15, cy - 15, 30, 30);
      g.fillStyle = '#0f380f';
      g.fillRect(cx - 11, cy - 11, 22, 22);
      g.fillStyle = '#ef4444';
      g.fillRect(cx - 9, cy - 9, 18, 18);
      g.fillStyle = '#fb923c';
      g.fillRect(cx - 6, cy - 6, 12, 12);
      g.fillStyle = '#fef08a';
      g.fillRect(cx - 3, cy - 3, 6, 6);
      return c;
    }

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

  function buildTrailDotSprite(skin, isSmash) {
    const size = isSmash ? 24 : 20;
    const half = size / 2;
    const { canvas: c, ctx: g } = createOffscreen(size, size);

    if (skin.pixelated) {
      g.fillStyle = isSmash ? '#ef4444' : '#306230';
      const box = isSmash ? 14 : 11;
      g.fillRect(half - box / 2, half - box / 2, box, box);
      return c;
    }

    const grad = g.createRadialGradient(half, half, 1, half, half, half);
    if (isSmash) {
      grad.addColorStop(0.0, 'rgba(253, 186, 116, 0.96)');
      grad.addColorStop(0.45, 'rgba(249, 115, 22, 0.65)');
      grad.addColorStop(0.75, 'rgba(239, 68, 68, 0.35)');
      grad.addColorStop(1.0, 'rgba(239, 68, 68, 0)');
    } else {
      grad.addColorStop(0.0, skin.trailInner);
      grad.addColorStop(0.55, skin.trailMid);
      grad.addColorStop(1.0, skin.trailFade);
    }
    g.fillStyle = grad;
    g.beginPath();
    g.arc(half, half, half, 0, Math.PI * 2);
    g.fill();
    return c;
  }

  function buildCountdownDigitSprite(digit, skin) {
    const { canvas: c, ctx: g } = createOffscreen(COUNTDOWN_SPRITE_SIZE, COUNTDOWN_SPRITE_SIZE);
    const cx = COUNTDOWN_SPRITE_HALF;
    const cy = COUNTDOWN_SPRITE_HALF;
    g.font = skin.pixelated
      ? '900 132px "Courier New", ui-monospace, monospace'
      : '900 132px "Segoe UI", system-ui, Roboto, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';

    g.strokeStyle = skin.digitStrokeOuter;
    g.lineWidth = 20;
    g.strokeText(digit, cx, cy);

    g.strokeStyle = skin.digitStrokeMid;
    g.lineWidth = 9;
    g.strokeText(digit, cx, cy);

    g.fillStyle = skin.digitFill;
    g.fillText(digit, cx, cy);

    g.strokeStyle = skin.digitStrokeInner;
    g.lineWidth = 2;
    g.strokeText(digit, cx, cy);

    return c;
  }

  const skinSpriteCache = {};

  function getSkinSprites(skinId) {
    const id = SKINS[skinId] ? skinId : 'neon';
    if (skinSpriteCache[id]) return skinSpriteCache[id];

    const skin = SKINS[id];
    const bundle = {
      bg: buildBackgroundSprite(id),
      player: buildPaddleSprite(skin.playerColor, false, null, skin.pixelated, false),
      playerFlash: buildPaddleSprite(skin.playerColor, true, skin.pixelated ? '#9bbc0f' : '#ffffff', skin.pixelated, false),
      ai: buildPaddleSprite(skin.aiColor, false, null, skin.pixelated, true),
      aiFlash: buildPaddleSprite(skin.aiColor, true, skin.pixelated ? '#9bbc0f' : '#ffffff', skin.pixelated, true),
      paddleSmash: buildPaddleSprite('#ef4444', true, '#fed7aa', skin.pixelated, false),
      ball: buildBallSprite(skin),
      ballSmash: buildSmashBallSprite(skin.pixelated),
      trailDot: buildTrailDotSprite(skin, false),
      trailDotSmash: buildTrailDotSprite(skin, true),
      digits: {
        1: buildCountdownDigitSprite('1', skin),
        2: buildCountdownDigitSprite('2', skin),
        3: buildCountdownDigitSprite('3', skin),
      },
    };
    skinSpriteCache[id] = bundle;
    return bundle;
  }

  let activeSkinId = 'neon';
  let activeSkin = SKINS.neon;
  let activeSprites = getSkinSprites('neon');

  // Tablas pre-calculadas para la estela
  const TRAIL_ALPHAS = new Float32Array(TRAIL_LENGTH);
  const TRAIL_SIZES = new Float32Array(TRAIL_LENGTH);
  const TRAIL_SMASH_SIZES = new Float32Array(TRAIL_LENGTH);
  const TRAIL_FURIOUS_SIZES = new Float32Array(TRAIL_LENGTH);
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const k = (i + 1) / TRAIL_LENGTH;
    TRAIL_ALPHAS[i] = k * 0.45;
    TRAIL_SIZES[i] = BALL_R * 2 * (0.45 + k * 0.75);
    TRAIL_SMASH_SIZES[i] = BALL_R * 2 * (0.6 + k * 1.05);
    TRAIL_FURIOUS_SIZES[i] = BALL_R * 2 * (0.85 + k * 1.45);
  }

  // ==========================================================
  //  Audio procedural: SFX + Música por Cancha (Web Audio API)
  //  - Buses independientes para SFX y Música
  //  - Desconexión automática al finalizar cada nota (cero fugas)
  // ==========================================================
  const MUSIC_TRACKS = {
    // Arpegio synthwave melódico de tempo medio (Am -> F -> C -> G)
    neon: {
      bpm: 116,
      leadType: 'sawtooth',
      bassType: 'triangle',
      leadFilterHz: 2100,
      bassFilterHz: 460,
      leadVol: 0.11,
      bassVol: 0.22,
      leadGate: 0.72,
      bassGate: 0.78,
      lead: [
        69, 72, 76, 79, 76, 72, 76, 72,
        65, 69, 72, 77, 72, 69, 72, 69,
        67, 72, 76, 79, 76, 72, 76, 72,
        67, 71, 74, 79, 74, 71, 74, 76,
      ],
      bass: [
        45, 0, 45, 0, 45, 0, 45, 48,
        41, 0, 41, 0, 41, 0, 41, 45,
        48, 0, 48, 0, 48, 0, 48, 43,
        43, 0, 43, 0, 43, 0, 47, 43,
      ],
    },
    // Chiptune clásico de consola portátil 8-bits (cuadrada + triangular)
    retro89: {
      bpm: 134,
      leadType: 'square',
      bassType: 'triangle',
      leadFilterHz: 3400,
      bassFilterHz: 900,
      leadVol: 0.095,
      bassVol: 0.24,
      leadGate: 0.56,
      bassGate: 0.68,
      lead: [
        72, 0, 76, 79, 0, 76, 72, 74,
        76, 0, 79, 84, 0, 79, 76, 0,
        77, 0, 81, 79, 0, 76, 72, 74,
        76, 74, 72, 0, 74, 0, 79, 0,
      ],
      bass: [
        48, 0, 55, 0, 48, 0, 55, 0,
        45, 0, 52, 0, 45, 0, 52, 0,
        41, 0, 48, 0, 43, 0, 50, 0,
        48, 0, 43, 0, 48, 43, 48, 0,
      ],
    },
    // Ritmo tenso y enérgico con pulsos graves marcados (Dm -> Bb -> C -> A)
    fireice: {
      bpm: 128,
      leadType: 'square',
      bassType: 'sawtooth',
      leadFilterHz: 1850,
      bassFilterHz: 340,
      leadVol: 0.09,
      bassVol: 0.25,
      leadGate: 0.52,
      bassGate: 0.62,
      lead: [
        62, 0, 69, 0, 70, 69, 65, 0,
        62, 0, 74, 0, 72, 0, 69, 0,
        70, 0, 69, 65, 67, 0, 72, 0,
        69, 67, 65, 64, 69, 0, 73, 0,
      ],
      bass: [
        38, 38, 0, 38, 0, 38, 50, 0,
        38, 38, 0, 38, 0, 41, 45, 0,
        46, 46, 0, 46, 48, 48, 0, 48,
        45, 45, 0, 45, 45, 0, 45, 0,
      ],
    },
    // Darksynth electrónico rápido y oscuro (Mi Frigio / Em)
    cyber2099: {
      bpm: 142,
      leadType: 'sawtooth',
      bassType: 'sawtooth',
      leadFilterHz: 2450,
      bassFilterHz: 390,
      leadVol: 0.10,
      bassVol: 0.24,
      leadGate: 0.58,
      bassGate: 0.66,
      lead: [
        64, 67, 71, 64, 72, 71, 67, 65,
        64, 67, 76, 75, 71, 67, 65, 64,
        60, 64, 67, 72, 71, 67, 64, 60,
        62, 65, 69, 71, 74, 71, 69, 65,
      ],
      bass: [
        40, 40, 52, 40, 40, 40, 52, 41,
        40, 40, 52, 40, 43, 40, 41, 40,
        36, 36, 48, 36, 36, 36, 48, 36,
        38, 38, 50, 38, 43, 41, 40, 39,
      ],
    },
  };

  function readInitialSfxMuted() {
    const saved = localStorage.getItem(STORAGE_KEYS.sfxMuted);
    if (saved !== null) return saved === '1';
    return localStorage.getItem(STORAGE_KEYS.legacyMuted) === '1';
  }

  function readInitialMusicMuted() {
    const saved = localStorage.getItem(STORAGE_KEYS.musicMuted);
    if (saved !== null) return saved === '1';
    return false;
  }

  const AudioBus = {
    ctx: null,
    sfxMaster: null,
    musicMaster: null,
    leadFilter: null,
    bassFilter: null,
    sfxVolume: 0.5,
    musicVolume: 0.34,

    init() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();

        this.sfxMaster = this.ctx.createGain();
        this.sfxMaster.gain.value = Sound.muted ? 0 : this.sfxVolume;
        this.sfxMaster.connect(this.ctx.destination);

        this.musicMaster = this.ctx.createGain();
        this.musicMaster.gain.value = Music.muted ? 0 : this.musicVolume;
        this.musicMaster.connect(this.ctx.destination);

        // Filtros compartidos para música (cero creación de filtros por nota)
        this.leadFilter = this.ctx.createBiquadFilter();
        this.leadFilter.type = 'lowpass';
        this.leadFilter.frequency.value = 2100;
        this.leadFilter.connect(this.musicMaster);

        this.bassFilter = this.ctx.createBiquadFilter();
        this.bassFilter.type = 'lowpass';
        this.bassFilter.frequency.value = 460;
        this.bassFilter.connect(this.musicMaster);
      }
      this.resume();
      return true;
    },

    resume() {
      const c = this.ctx;
      if (c && c.state === 'suspended') {
        c.resume().catch(() => {});
      }
    },

    suspend() {
      const c = this.ctx;
      if (c && c.state === 'running') {
        c.suspend().catch(() => {});
      }
    },
  };

  const Sound = {
    muted: readInitialSfxMuted(),

    setMuted(muted) {
      this.muted = !!muted;
      localStorage.setItem(STORAGE_KEYS.sfxMuted, this.muted ? '1' : '0');
      if (AudioBus.sfxMaster && AudioBus.ctx) {
        AudioBus.sfxMaster.gain.setTargetAtTime(
          this.muted ? 0 : AudioBus.sfxVolume,
          AudioBus.ctx.currentTime,
          0.015
        );
      }
    },

    tone({ freq, to = null, dur = 0.1, type = 'square', vol = 0.25, delay = 0 }) {
      if (!AudioBus.ctx || !AudioBus.sfxMaster || this.muted || document.hidden) return;
      if (AudioBus.ctx.state === 'suspended') {
        AudioBus.ctx.resume().catch(() => {});
      }
      const t = AudioBus.ctx.currentTime + delay;
      const osc = AudioBus.ctx.createOscillator();
      const gain = AudioBus.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(AudioBus.sfxMaster);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + dur + 0.025);
    },

    paddle(speedRatio) {
      const f = 360 + speedRatio * 320;
      this.tone({ freq: f, to: f * 1.6, dur: 0.09, type: 'square', vol: 0.18 });
      this.tone({ freq: f / 2, dur: 0.06, type: 'sine', vol: 0.25 });
    },

    smash() {
      this.tone({ freq: 880, to: 1580, dur: 0.13, type: 'square', vol: 0.18 });
      this.tone({ freq: 520, to: 1080, dur: 0.11, type: 'sawtooth', vol: 0.14 });
      this.tone({ freq: 240, to: 110, dur: 0.09, type: 'triangle', vol: 0.28 });
    },

    powerReady() {
      this.tone({ freq: 784, dur: 0.09, type: 'triangle', vol: 0.22 });
      this.tone({ freq: 1175, dur: 0.16, type: 'sine', vol: 0.22, delay: 0.07 });
    },

    superShot() {
      this.tone({ freq: 145, to: 44, dur: 0.24, type: 'triangle', vol: 0.48 });
      this.tone({ freq: 620, to: 1760, dur: 0.22, type: 'sawtooth', vol: 0.20 });
      this.tone({ freq: 1320, to: 880, dur: 0.18, type: 'square', vol: 0.14, delay: 0.04 });
    },

    levelUp() {
      const notes = [587, 740, 988];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.13, type: 'triangle', vol: 0.24, delay: i * 0.07 });
      }
    },

    unlock() {
      const notes = [523, 659, 784, 1047, 1319];
      for (let i = 0; i < notes.length; i++) {
        this.tone({ freq: notes[i], dur: 0.18, type: 'triangle', vol: 0.22, delay: i * 0.08 });
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

  const Music = {
    muted: readInitialMusicMuted(),
    trackId: 'neon',
    running: false,
    timerId: 0,
    step: 0,
    nextNoteTime: 0,
    lookaheadMs: 75,
    scheduleAheadSec: 0.16,

    setMuted(muted) {
      this.muted = !!muted;
      localStorage.setItem(STORAGE_KEYS.musicMuted, this.muted ? '1' : '0');
      if (AudioBus.musicMaster && AudioBus.ctx) {
        AudioBus.musicMaster.gain.setTargetAtTime(
          this.muted ? 0 : AudioBus.musicVolume,
          AudioBus.ctx.currentTime,
          0.02
        );
      }
      if (this.muted) {
        this.stop();
      } else {
        this.syncPlayback();
      }
    },

    setTrack(skinId) {
      const nextId = MUSIC_TRACKS[skinId] ? skinId : 'neon';
      if (this.trackId === nextId) return;
      this.trackId = nextId;
      this.step = 0;
      this.applyTrackFilters();
    },

    applyTrackFilters() {
      if (!AudioBus.ctx || !AudioBus.leadFilter || !AudioBus.bassFilter) return;
      const track = MUSIC_TRACKS[this.trackId] || MUSIC_TRACKS.neon;
      const now = AudioBus.ctx.currentTime;
      AudioBus.leadFilter.frequency.setTargetAtTime(track.leadFilterHz, now, 0.04);
      AudioBus.bassFilter.frequency.setTargetAtTime(track.bassFilterHz, now, 0.04);
    },

    scheduleVoice(midi, time, dur, type, vol, dest) {
      if (!midi || !AudioBus.ctx) return;
      const osc = AudioBus.ctx.createOscillator();
      const gain = AudioBus.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(midiToFreq(midi), time);

      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(vol, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      osc.connect(gain);
      gain.connect(dest);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(time);
      osc.stop(time + dur + 0.02);
    },

    tick() {
      if (!this.running || this.muted || document.hidden || !AudioBus.ctx) return;
      if (AudioBus.ctx.state === 'suspended') return;

      const track = MUSIC_TRACKS[this.trackId] || MUSIC_TRACKS.neon;
      const stepSec = 60 / track.bpm / 4; // semicorchea
      const horizon = AudioBus.ctx.currentTime + this.scheduleAheadSec;

      if (this.nextNoteTime < AudioBus.ctx.currentTime - 0.15) {
        this.nextNoteTime = AudioBus.ctx.currentTime + 0.02;
      }

      let guard = 0;
      while (this.nextNoteTime < horizon && guard < 8) {
        const idx = this.step % track.lead.length;
        const leadNote = track.lead[idx];
        const bassNote = track.bass[idx];

        if (leadNote) {
          this.scheduleVoice(
            leadNote,
            this.nextNoteTime,
            stepSec * track.leadGate,
            track.leadType,
            track.leadVol,
            AudioBus.leadFilter
          );
        }
        if (bassNote) {
          this.scheduleVoice(
            bassNote,
            this.nextNoteTime,
            stepSec * track.bassGate,
            track.bassType,
            track.bassVol,
            AudioBus.bassFilter
          );
        }

        this.nextNoteTime += stepSec;
        this.step = (this.step + 1) % track.lead.length;
        guard++;
      }
    },

    start() {
      if (this.running || this.muted || document.hidden) return;
      if (!AudioBus.init()) return;
      this.applyTrackFilters();
      if (AudioBus.musicMaster && AudioBus.ctx) {
        AudioBus.musicMaster.gain.setTargetAtTime(AudioBus.musicVolume, AudioBus.ctx.currentTime, 0.03);
      }
      this.running = true;
      this.nextNoteTime = AudioBus.ctx.currentTime + 0.03;
      this.tick();
      this.timerId = setInterval(() => this.tick(), this.lookaheadMs);
    },

    stop() {
      this.running = false;
      if (this.timerId) {
        clearInterval(this.timerId);
        this.timerId = 0;
      }
      if (AudioBus.musicMaster && AudioBus.ctx) {
        AudioBus.musicMaster.gain.setTargetAtTime(0, AudioBus.ctx.currentTime, 0.02);
      }
    },

    syncPlayback() {
      const shouldPlay =
        !document.hidden &&
        !this.muted &&
        (game.state === 'playing' || game.state === 'countdown');
      if (shouldPlay) this.start();
      else this.stop();
    },
  };

  function unlockAudio() {
    AudioBus.init();
    Music.syncPlayback();
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
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');

  const el = {
    menu: document.getElementById('menu'),
    quickplay: document.getElementById('quickplay'),
    skins: document.getElementById('skins'),
    trophies: document.getElementById('trophies'),
    tournamentScreen: document.getElementById('tournament-screen'),
    pause: document.getElementById('pause'),
    gameover: document.getElementById('gameover'),

    labelLeft: document.getElementById('label-left'),
    labelRight: document.getElementById('label-right'),
    scorePlayer: document.getElementById('score-player'),
    scoreAi: document.getElementById('score-ai'),
    powerP1Wrap: document.getElementById('power-p1-wrap'),
    powerP1Fill: document.getElementById('power-p1-fill'),
    powerP1Text: document.getElementById('power-p1-text'),
    powerP2Wrap: document.getElementById('power-p2-wrap'),
    powerP2Fill: document.getElementById('power-p2-fill'),
    powerP2Text: document.getElementById('power-p2-text'),
    diffLabel: document.getElementById('diff-label'),
    targetLabel: document.getElementById('target-label'),
    footerHint: document.getElementById('footer-hint'),

    trophyToast: document.getElementById('trophy-toast'),
    trophyToastTitle: document.getElementById('trophy-toast-title'),
    trophiesCountBadge: document.getElementById('trophies-count-badge'),
    trophiesGrid: document.getElementById('trophies-grid'),
    recTournaments: document.getElementById('rec-tournaments'),
    recStreak: document.getElementById('rec-streak'),
    recRally: document.getElementById('rec-rally'),
    recSupers: document.getElementById('rec-supers'),

    tournamentCtaSub: document.getElementById('tournament-cta-sub'),
    menuStatus: document.getElementById('menu-status'),
    quickplaySubtitle: document.getElementById('quickplay-subtitle'),
    skinsGrid: document.getElementById('skins-grid'),
    tournamentSkinToggle: document.getElementById('tournament-skin-toggle'),

    tournamentStepper: document.getElementById('tournament-stepper'),
    tournamentHeading: document.getElementById('tournament-heading'),
    tournamentUnlockBanner: document.getElementById('tournament-unlock-banner'),
    tournamentStageBadge: document.getElementById('tournament-stage-badge'),
    tournamentArenaName: document.getElementById('tournament-arena-name'),
    tournamentRivalDesc: document.getElementById('tournament-rival-desc'),
    tournamentPlayBtn: document.getElementById('tournament-play-btn'),
    tournamentResetBtn: document.getElementById('tournament-reset-btn'),

    pauseSubtitle: document.getElementById('pause-subtitle'),

    resultTitle: document.getElementById('result-title'),
    resultScore: document.getElementById('result-score'),
    resultUnlockBanner: document.getElementById('result-unlock-banner'),
    resultDetail: document.getElementById('result-detail'),
    restartBtn: document.getElementById('restart-btn'),
    gameoverExtraBtn: document.getElementById('gameover-extra-btn'),

    musicBtn: document.getElementById('music-btn'),
    sfxBtn: document.getElementById('sfx-btn'),
    pauseBtn: document.getElementById('pause-btn'),
    diffBtns: document.querySelectorAll('.diff-btn'),
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
  //  Persistencia de Torneo y Skins
  // ==========================================================
  function loadUnlockedSkins() {
    const set = new Set(['neon']);
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.unlockedSkins) || '[]');
      if (Array.isArray(parsed)) {
        for (let i = 0; i < parsed.length; i++) {
          if (SKINS[parsed[i]]) set.add(parsed[i]);
        }
      }
    } catch (_) { /* ignorar storage corrupto */ }
    return set;
  }

  function saveUnlockedSkins(set) {
    localStorage.setItem(STORAGE_KEYS.unlockedSkins, JSON.stringify(Array.from(set)));
  }

  function loadTournamentProgress() {
    const fallback = { currentRound: 0, completedRounds: [false, false, false, false], tournamentsWon: 0 };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.tournament) || 'null');
      if (!parsed || typeof parsed !== 'object') return fallback;
      const currentRound = clamp(parseInt(parsed.currentRound, 10) || 0, 0, TOURNAMENT_ROUNDS.length - 1);
      const completedRounds = Array.isArray(parsed.completedRounds) && parsed.completedRounds.length === 4
        ? parsed.completedRounds.map(Boolean)
        : [false, false, false, false];
      const tournamentsWon = Math.max(0, parseInt(parsed.tournamentsWon, 10) || 0);
      return { currentRound, completedRounds, tournamentsWon };
    } catch (_) {
      return fallback;
    }
  }

  function saveTournamentProgress() {
    localStorage.setItem(STORAGE_KEYS.tournament, JSON.stringify({
      currentRound: tournament.currentRound,
      completedRounds: tournament.completedRounds,
      tournamentsWon: tournament.tournamentsWon,
    }));
  }

  function readSavedSurvivalBest() {
    const raw = parseInt(localStorage.getItem(STORAGE_KEYS.survivalBest) || '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function loadRecords(savedTournamentsWon) {
    const base = {
      tournamentsWon: Math.max(0, savedTournamentsWon || 0),
      currentWinStreak: 0,
      bestWinStreak: 0,
      maxRally: 0,
      totalSuperShots: 0,
    };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.records) || 'null');
      if (!parsed || typeof parsed !== 'object') return base;
      return {
        tournamentsWon: Math.max(base.tournamentsWon, parseInt(parsed.tournamentsWon, 10) || 0),
        currentWinStreak: Math.max(0, parseInt(parsed.currentWinStreak, 10) || 0),
        bestWinStreak: Math.max(0, parseInt(parsed.bestWinStreak, 10) || 0),
        maxRally: Math.max(0, parseInt(parsed.maxRally, 10) || 0),
        totalSuperShots: Math.max(0, parseInt(parsed.totalSuperShots, 10) || 0),
      };
    } catch (_) {
      return base;
    }
  }

  function saveRecords() {
    localStorage.setItem(STORAGE_KEYS.records, JSON.stringify(records));
  }

  function loadUnlockedTrophies() {
    const set = new Set();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.trophies) || '[]');
      if (Array.isArray(parsed)) {
        for (let i = 0; i < parsed.length; i++) {
          if (TROPHIES.some((t) => t.id === parsed[i])) set.add(parsed[i]);
        }
      }
    } catch (_) { /* ignorar storage corrupto */ }
    return set;
  }

  function saveUnlockedTrophies() {
    localStorage.setItem(STORAGE_KEYS.trophies, JSON.stringify(Array.from(unlockedTrophies)));
  }

  const unlockedSkins = loadUnlockedSkins();
  const tournament = loadTournamentProgress();
  const records = loadRecords(tournament.tournamentsWon);
  const unlockedTrophies = loadUnlockedTrophies();

  const trophyToastQueue = [];
  let trophyToastTimer = 0;

  function showNextTrophyToast() {
    if (trophyToastTimer || !trophyToastQueue.length || !el.trophyToast) return;
    const trophy = trophyToastQueue.shift();
    if (el.trophyToastTitle) el.trophyToastTitle.textContent = trophy.name;
    el.trophyToast.classList.add('visible');
    trophyToastTimer = setTimeout(() => {
      el.trophyToast.classList.remove('visible');
      trophyToastTimer = setTimeout(() => {
        trophyToastTimer = 0;
        showNextTrophyToast();
      }, 280);
    }, 2900);
  }

  function unlockTrophy(trophyId, notify) {
    if (unlockedTrophies.has(trophyId)) return false;
    const trophy = TROPHIES.find((t) => t.id === trophyId);
    if (!trophy) return false;
    unlockedTrophies.add(trophyId);
    saveUnlockedTrophies();
    if (notify) {
      trophyToastQueue.push(trophy);
      showNextTrophyToast();
      Sound.unlock();
    }
    return true;
  }

  function checkTrophies(notify, matchInfo) {
    let anyNew = false;
    if (records.tournamentsWon >= 1 && unlockTrophy('first_champion', notify)) anyNew = true;
    if (matchInfo && matchInfo.cleanSheet && unlockTrophy('clean_sheet', notify)) anyNew = true;
    if (records.bestWinStreak >= 5 && unlockTrophy('unstoppable', notify)) anyNew = true;
    if (records.totalSuperShots >= 10 && unlockTrophy('total_fury', notify)) anyNew = true;
    if (records.tournamentsWon >= 3 && unlockTrophy('ping_pong_legend', notify)) anyNew = true;
    return anyNew;
  }

  function recordOnePlayerMatchOutcome(playerWon, opponentScore) {
    if (playerWon) {
      records.currentWinStreak += 1;
      if (records.currentWinStreak > records.bestWinStreak) {
        records.bestWinStreak = records.currentWinStreak;
      }
      saveRecords();
      checkTrophies(true, { cleanSheet: opponentScore === 0 });
    } else {
      records.currentWinStreak = 0;
      saveRecords();
    }
  }

  const savedEquipped = localStorage.getItem(STORAGE_KEYS.equippedSkin);
  let equippedSkin = (savedEquipped && unlockedSkins.has(savedEquipped)) ? savedEquipped : 'neon';
  let tournamentUseEquippedSkin = localStorage.getItem(STORAGE_KEYS.tournamentUseSkin) === '1';

  function unlockSkin(skinId) {
    if (!skinId || !SKINS[skinId] || unlockedSkins.has(skinId)) return false;
    unlockedSkins.add(skinId);
    saveUnlockedSkins(unlockedSkins);
    return true;
  }

  function equipSkin(skinId) {
    if (!SKINS[skinId] || !unlockedSkins.has(skinId)) return false;
    equippedSkin = skinId;
    localStorage.setItem(STORAGE_KEYS.equippedSkin, skinId);
    applySkin(skinId);
    renderSkinsGrid();
    updateMenuUI();
    return true;
  }

  function applySkin(skinId) {
    const id = SKINS[skinId] ? skinId : 'neon';
    activeSkinId = id;
    activeSkin = SKINS[id];
    activeSprites = getSkinSprites(id);
    if (document.body) document.body.dataset.theme = id;
    if (themeColorMeta) themeColorMeta.setAttribute('content', activeSkin.themeColor);
    Music.setTrack(id);
    if (!loopActive) render();
  }

  function getTournamentRoundSkin(roundIdx) {
    if (tournamentUseEquippedSkin && unlockedSkins.has(equippedSkin)) {
      return equippedSkin;
    }
    const round = TOURNAMENT_ROUNDS[clamp(roundIdx, 0, TOURNAMENT_ROUNDS.length - 1)];
    return round.skin;
  }

  // ==========================================================
  //  Estado del juego y pools pre-asignados (cero GC en juego)
  // ==========================================================
  const player = {
    baseX: PADDLE_MARGIN,
    prevX: PADDLE_MARGIN,
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
    power: 0,
  };

  const ai = {
    baseX: W - PADDLE_MARGIN - PADDLE_W,
    prevX: W - PADDLE_MARGIN - PADDLE_W,
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
    power: 0,
    target: H / 2,
    reactTimer: 0,
    thinkTimer: 0,
    errorOffset: 0,
    lastDir: 0,
    aimDir: 1,
  };

  const ball = {
    x: W / 2,
    y: H / 2,
    vx: 0,
    vy: 0,
    speed: BALL_START_SPEED,
    baseSpeed: BALL_START_SPEED,
    isSmash: false,
    isFurious: false,
    curve: 0,
    emberTimer: 0,
  };

  // Ring buffer de estela sin asignaciones por frame (0: normal, 1: smash, 2: furiosa)
  const trailX = new Float32Array(TRAIL_LENGTH);
  const trailY = new Float32Array(TRAIL_LENGTH);
  const trailSmash = new Uint8Array(TRAIL_LENGTH);
  let trailHead = 0;
  let trailCount = 0;

  function clearTrail() {
    trailHead = 0;
    trailCount = 0;
  }

  function pushTrail(x, y, stateCode) {
    trailX[trailHead] = x;
    trailY[trailHead] = y;
    trailSmash[trailHead] = stateCode;
    trailHead = (trailHead + 1) % TRAIL_LENGTH;
    if (trailCount < TRAIL_LENGTH) trailCount++;
  }

  // Pool fijo de partículas (SoA en TypedArrays)
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

  // Pool fijo de avisos flotantes en canvas
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

  // Configuración reutilizable de IA en Supervivencia (cero GC)
  const survivalAICfg = {
    maxSpeed: 340,
    accel: 2200,
    reaction: 0.22,
    error: 32,
    edgeAim: 0.25,
    wallAnticipation: 0.85,
    mistakeChance: 0.03,
  };

  function getSurvivalAIConfig(level) {
    const lvl = Math.max(0, level - 1);
    survivalAICfg.maxSpeed = Math.min(960, 340 + lvl * 55);
    survivalAICfg.accel = Math.min(6800, 2200 + lvl * 380);
    survivalAICfg.reaction = Math.max(0.03, 0.22 - lvl * 0.022);
    survivalAICfg.error = Math.max(4, 32 - lvl * 3);
    survivalAICfg.edgeAim = Math.min(0.85, 0.2 + lvl * 0.08);
    survivalAICfg.wallAnticipation = Math.min(1.0, 0.7 + lvl * 0.06);
    return survivalAICfg;
  }

  const game = {
    state: 'menu', // menu | quickplay | skins | intermission | countdown | playing | paused | gameover
    pausedFrom: null,
    mode: MODES.TOURNAMENT,
    difficulty: 'normal',
    scores: { player: 0, ai: 0 },
    winScore: TOURNAMENT_WIN_SCORE,
    survivalHits: 0,
    survivalLevel: 1,
    survivalBest: readSavedSurvivalBest(),
    survivalNewRecord: false,
    countdown: 0,
    lastCountShown: 0,
    serveDir: 1,
    rally: 0,
    shake: 0,
    lastUnlockedSkin: null,
    tournamentChampionRun: false,
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
    Music.syncPlayback();
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
    Music.syncPlayback();
  }

  function renderStatic() {
    stopLoop();
    render();
  }

  // ==========================================================
  //  UI de Overlays, Menú, Torneo y Selector de Skins
  // ==========================================================
  function updatePauseBtn() {
    const show = game.state === 'playing' || game.state === 'countdown' || game.state === 'paused';
    el.pauseBtn.classList.toggle('hidden', !show);
  }

  function updatePowerBars() {
    const activeMatch = game.state === 'playing' || game.state === 'countdown' || game.state === 'paused';
    const showP1 = activeMatch;
    const showP2 = activeMatch && game.mode === MODES.TWO_P;

    if (el.powerP1Wrap) {
      el.powerP1Wrap.classList.toggle('hidden', !showP1);
      const p1Pct = clamp(Math.round(player.power), 0, 100);
      el.powerP1Fill.style.width = `${p1Pct}%`;
      el.powerP1Text.textContent = p1Pct >= 100 ? 'MAX' : `${p1Pct}%`;
      el.powerP1Wrap.classList.toggle('ready', p1Pct >= 100);
    }

    if (el.powerP2Wrap) {
      el.powerP2Wrap.classList.toggle('hidden', !showP2);
      const p2Pct = clamp(Math.round(ai.power), 0, 100);
      el.powerP2Fill.style.width = `${p2Pct}%`;
      el.powerP2Text.textContent = p2Pct >= 100 ? 'MAX' : `${p2Pct}%`;
      el.powerP2Wrap.classList.toggle('ready', p2Pct >= 100);
    }
  }

  function setOverlay(name) {
    el.menu.classList.toggle('visible', name === 'menu');
    el.quickplay.classList.toggle('visible', name === 'quickplay');
    el.skins.classList.toggle('visible', name === 'skins');
    if (el.trophies) el.trophies.classList.toggle('visible', name === 'trophies');
    el.tournamentScreen.classList.toggle('visible', name === 'intermission');
    el.pause.classList.toggle('visible', name === 'pause');
    el.gameover.classList.toggle('visible', name === 'gameover');
    updatePauseBtn();
    updatePowerBars();
  }

  function bumpElement(node) {
    node.classList.remove('bump');
    void node.offsetWidth;
    node.classList.add('bump');
  }

  function updateHudLabels() {
    el.targetLabel.classList.remove('level-up');
    el.scoreAi.classList.remove('record-live');

    if (game.mode === MODES.TOURNAMENT) {
      const round = TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0];
      el.labelLeft.textContent = 'TÚ';
      el.labelRight.textContent = 'IA';
      el.diffLabel.textContent = `R${round.index + 1}/4 · ${round.shortName.toUpperCase()}`;
      el.targetLabel.textContent = `${activeSkin.arenaTitle.toUpperCase()} · A ${TOURNAMENT_WIN_SCORE}`;
      el.footerHint.textContent = `Torneo R${round.index + 1}: ${round.rivalName} · Empujá adelante o deslizá rápido para REMATE`;
    } else if (game.mode === MODES.TWO_P) {
      el.labelLeft.textContent = 'J1';
      el.labelRight.textContent = 'J2';
      el.diffLabel.textContent = '2 JUGADORES';
      el.targetLabel.textContent = `PRIMERO A ${QUICK_WIN_SCORE}`;
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
      el.targetLabel.textContent = `PRIMERO A ${QUICK_WIN_SCORE}`;
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
    const round = TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0];
    const hasProgress = tournament.currentRound > 0;
    if (hasProgress) {
      el.tournamentCtaSub.textContent = `Continuar · Ronda ${round.index + 1}/4 (${round.shortName})`;
    } else if (tournament.tournamentsWon > 0) {
      const titles = tournament.tournamentsWon === 1 ? '1 título' : `${tournament.tournamentsWon} títulos`;
      el.tournamentCtaSub.textContent = `4 Rondas · ${titles} · Desbloqueá Canchas`;
    } else {
      el.tournamentCtaSub.textContent = '4 Rondas · Desbloqueá Canchas';
    }

    const skinObj = SKINS[equippedSkin] || SKINS.neon;
    const recordText = game.survivalBest > 0 ? ` · Récord Sup.: ${game.survivalBest}` : '';
    el.menuStatus.textContent =
      `Arena: ${skinObj.name} · Skins: ${unlockedSkins.size}/${SKIN_ORDER.length} · Trofeos: ${unlockedTrophies.size}/${TROPHIES.length}${recordText}`;
    el.quickplaySubtitle.textContent =
      `Primero a ${QUICK_WIN_SCORE} puntos · Arena: ${skinObj.name}`;

    updateHudLabels();
    updateScoreboard();
  }

  function renderSkinsGrid() {
    if (!el.skinsGrid) return;
    el.skinsGrid.innerHTML = '';

    el.tournamentSkinToggle.setAttribute('aria-pressed', String(tournamentUseEquippedSkin));
    el.tournamentSkinToggle.textContent = tournamentUseEquippedSkin
      ? 'Torneo: Equipada'
      : 'Torneo: Alternadas';

    for (let i = 0; i < SKIN_ORDER.length; i++) {
      const id = SKIN_ORDER[i];
      const skin = SKINS[id];
      const isUnlocked = unlockedSkins.has(id);
      const isEquipped = equippedSkin === id;

      const card = document.createElement('button');
      card.type = 'button';
      card.dataset.skin = id;
      card.className = 'skin-card' + (isEquipped ? ' equipped' : '') + (isUnlocked ? '' : ' locked');
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-disabled', String(!isUnlocked));

      const preview = document.createElement('div');
      preview.className = 'skin-preview';
      preview.style.background = skin.previewBg;

      const leftBar = document.createElement('span');
      leftBar.className = 'mini-paddle';
      leftBar.style.background = skin.playerColor;

      const miniBall = document.createElement('span');
      miniBall.className = 'mini-ball';
      miniBall.style.background = skin.ballColor;
      if (skin.pixelated) miniBall.style.borderRadius = '0';

      const rightBar = document.createElement('span');
      rightBar.className = 'mini-paddle';
      rightBar.style.background = skin.aiColor;

      preview.appendChild(leftBar);
      preview.appendChild(miniBall);
      preview.appendChild(rightBar);

      const head = document.createElement('div');
      head.className = 'skin-card-head';

      const nameEl = document.createElement('span');
      nameEl.className = 'skin-name';
      nameEl.textContent = skin.name;

      const tagEl = document.createElement('span');
      tagEl.className = 'skin-tag ' + (isEquipped ? 'equipped' : isUnlocked ? 'unlocked' : 'locked');
      tagEl.textContent = isEquipped ? 'EQUIPADA' : isUnlocked ? 'EQUIPAR' : 'BLOQUEADA';

      head.appendChild(nameEl);
      head.appendChild(tagEl);

      const desc = document.createElement('p');
      desc.className = 'skin-desc';
      desc.textContent = isUnlocked ? skin.styleDesc : skin.unlockHint;

      card.appendChild(preview);
      card.appendChild(head);
      card.appendChild(desc);

      card.addEventListener('click', () => {
        unlockAudio();
        if (unlockedSkins.has(id)) {
          equipSkin(id);
          Sound.click();
        } else {
          Sound.wall();
        }
      });

      el.skinsGrid.appendChild(card);
    }
  }

  function renderTournamentStepper() {
    if (!el.tournamentStepper) return;
    el.tournamentStepper.innerHTML = '';
    for (let i = 0; i < TOURNAMENT_ROUNDS.length; i++) {
      const r = TOURNAMENT_ROUNDS[i];
      const node = document.createElement('span');
      let cls = 'step-node';
      let prefix = `${i + 1}.`;
      if (tournament.completedRounds[i]) {
        cls += ' done';
        prefix = '✓';
      } else if (i === tournament.currentRound) {
        cls += ' current';
      }
      node.className = cls;
      node.textContent = `${prefix} ${r.shortName}`;
      el.tournamentStepper.appendChild(node);
    }
  }

  function openTournamentIntermission(fromVictory, newlyUnlockedSkinId) {
    game.mode = MODES.TOURNAMENT;
    game.state = 'intermission';
    clearActiveTouches();
    clearCallouts();
    clearParticles();
    resetPaddles();
    resetBall(false);

    const round = TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0];
    const arenaSkinId = getTournamentRoundSkin(tournament.currentRound);
    applySkin(arenaSkinId);
    updateHudLabels();
    updateScoreboard();
    renderTournamentStepper();

    if (fromVictory) {
      el.tournamentHeading.textContent = `¡RONDA ${round.index} SUPERADA!`;
      el.tournamentHeading.className = 'overlay-title compact-title win';
      el.tournamentPlayBtn.textContent = 'SIGUIENTE RONDA';
    } else {
      el.tournamentHeading.textContent = round.stageName;
      el.tournamentHeading.className = 'overlay-title compact-title';
      el.tournamentPlayBtn.textContent = round.index > 0 ? 'CONTINUAR RONDA' : 'COMENZAR TORNEO';
    }

    if (newlyUnlockedSkinId && SKINS[newlyUnlockedSkinId]) {
      el.tournamentUnlockBanner.textContent = `★ SKIN DESBLOQUEADA: ${SKINS[newlyUnlockedSkinId].name.toUpperCase()}`;
      el.tournamentUnlockBanner.classList.remove('hidden');
    } else {
      el.tournamentUnlockBanner.classList.add('hidden');
    }

    el.tournamentStageBadge.textContent = `RONDA ${round.index + 1} / ${TOURNAMENT_ROUNDS.length} · ${round.stageName}`;
    el.tournamentArenaName.textContent = SKINS[arenaSkinId].arenaTitle;
    el.tournamentRivalDesc.textContent =
      `Rival: ${round.rivalName} · ${round.aiStyle} · Primero a ${TOURNAMENT_WIN_SCORE}`;

    el.tournamentResetBtn.classList.toggle('hidden', tournament.currentRound === 0);

    setOverlay('intermission');
    renderStatic();
  }

  function openQuickPlayMenu() {
    game.mode = MODES.VS_AI;
    game.state = 'quickplay';
    applySkin(equippedSkin);
    updateMenuUI();
    setOverlay('quickplay');
    renderStatic();
  }

  function openSkinsMenu() {
    game.state = 'skins';
    applySkin(equippedSkin);
    renderSkinsGrid();
    setOverlay('skins');
    renderStatic();
  }

  function renderTrophiesPanel() {
    if (el.recTournaments) el.recTournaments.textContent = records.tournamentsWon;
    if (el.recStreak) el.recStreak.textContent = records.bestWinStreak;
    if (el.recRally) el.recRally.textContent = records.maxRally;
    if (el.recSupers) el.recSupers.textContent = records.totalSuperShots;
    if (el.trophiesCountBadge) {
      el.trophiesCountBadge.textContent = `${unlockedTrophies.size} / ${TROPHIES.length}`;
    }
    if (!el.trophiesGrid) return;
    el.trophiesGrid.innerHTML = '';

    for (let i = 0; i < TROPHIES.length; i++) {
      const t = TROPHIES[i];
      const unlocked = unlockedTrophies.has(t.id);

      const card = document.createElement('div');
      card.className = 'trophy-card ' + (unlocked ? 'unlocked' : 'locked');
      card.dataset.trophy = t.id;
      card.setAttribute('role', 'listitem');

      const medal = document.createElement('div');
      medal.className = 'trophy-medal';
      medal.textContent = unlocked ? t.icon : '?';

      const info = document.createElement('div');
      info.className = 'trophy-info';

      const top = document.createElement('div');
      top.className = 'trophy-top';

      const nameEl = document.createElement('span');
      nameEl.className = 'trophy-name';
      nameEl.textContent = t.name;

      const tagEl = document.createElement('span');
      tagEl.className = 'skin-tag ' + (unlocked ? 'equipped' : 'locked');
      if (unlocked) {
        tagEl.textContent = 'DESBLOQUEADO';
      } else if (t.metric !== 'cleanSheet') {
        const cur = Math.min(records[t.metric] || 0, t.target);
        tagEl.textContent = `${cur}/${t.target}`;
      } else {
        tagEl.textContent = 'BLOQUEADO';
      }

      top.appendChild(nameEl);
      top.appendChild(tagEl);

      const desc = document.createElement('p');
      desc.className = 'trophy-desc';
      desc.textContent = t.desc;

      info.appendChild(top);
      info.appendChild(desc);
      card.appendChild(medal);
      card.appendChild(info);
      el.trophiesGrid.appendChild(card);
    }
  }

  function openTrophiesMenu() {
    game.state = 'trophies';
    applySkin(equippedSkin);
    renderTrophiesPanel();
    setOverlay('trophies');
    renderStatic();
  }

  function setDifficulty(diff) {
    game.difficulty = DIFFICULTY[diff] ? diff : 'normal';
    el.diffBtns.forEach((b) => {
      const sel = b.dataset.diff === game.difficulty;
      b.classList.toggle('selected', sel);
      b.setAttribute('aria-checked', String(sel));
    });
    localStorage.setItem(STORAGE_KEYS.difficulty, game.difficulty);
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
    p.prevX = p.baseX;
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

  function resetAIForServe(servingTowardAI) {
    ai.reactTimer = 0;
    ai.thinkTimer = 0;
    ai.errorOffset = 0;
    ai.lastDir = 0;
    ai.aimDir = Math.random() < 0.5 ? -1 : 1;

    if (servingTowardAI && ball.vx > 0 && game.mode !== MODES.TWO_P) {
      const cfg = getActiveAIConfig();
      ai.lastDir = 1;
      ai.reactTimer = 0;
      ai.thinkTimer = 0.07;
      ai.errorOffset = rand(-1, 1) * Math.min(cfg.error * 0.25, 14);
      const predicted = predictBallY(ai.x - BALL_R);
      ai.target = clamp(predicted + ai.errorOffset, ai.h * 0.5, H - ai.h * 0.5);
    } else {
      ai.target = H / 2;
    }
  }

  function resetPaddles() {
    resetPaddle(player);
    resetPaddle(ai);
    player.power = 0;
    ai.power = 0;
    resetAIForServe(false);
    resetControlState(controls[0]);
    resetControlState(controls[1]);
    updatePowerBars();
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
    ball.isFurious = false;
    ball.curve = 0;
    ball.emberTimer = 0;
    clearTrail();
    game.rally = 0;
    game.shake = 0;
    resetAIForServe(false);
  }

  function startMatch(modeOverride) {
    unlockAudio();
    if (gameoverSoundTimer) {
      clearTimeout(gameoverSoundTimer);
      gameoverSoundTimer = 0;
    }
    if (modeOverride) {
      game.mode = modeOverride;
    }

    game.scores.player = 0;
    game.scores.ai = 0;
    game.survivalHits = 0;
    game.survivalLevel = 1;
    game.survivalNewRecord = false;
    game.lastUnlockedSkin = null;
    game.tournamentChampionRun = false;

    if (game.mode === MODES.TOURNAMENT) {
      game.winScore = TOURNAMENT_WIN_SCORE;
      applySkin(getTournamentRoundSkin(tournament.currentRound));
    } else {
      game.winScore = QUICK_WIN_SCORE;
      applySkin(equippedSkin);
    }

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

  function startNewTournament() {
    tournament.currentRound = 0;
    tournament.completedRounds = [false, false, false, false];
    saveTournamentProgress();
    openTournamentIntermission(false, null);
  }

  function startCountdown(duration = COUNTDOWN_TIME, preserveSurvivalSpeed = false) {
    resetBall(preserveSurvivalSpeed);
    game.state = 'countdown';
    game.countdown = duration;
    game.lastCountShown = 0;
    updatePauseBtn();
  }

  function serve() {
    const angle = rand(-SERVE_MAX_ANGLE, SERVE_MAX_ANGLE);
    ball.speed = ball.baseSpeed;
    ball.isSmash = false;
    ball.isFurious = false;
    ball.curve = 0;
    ball.vx = game.serveDir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    game.state = 'playing';
    resetAIForServe(ball.vx > 0);
    updatePauseBtn();
    updatePowerBars();
  }

  function togglePause() {
    if (game.state === 'playing' || game.state === 'countdown') {
      game.pausedFrom = game.state;
      game.state = 'paused';
      clearActiveTouches();
      if (game.mode === MODES.TOURNAMENT) {
        const r = TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0];
        el.pauseSubtitle.textContent = `Torneo · Ronda ${r.index + 1}/4 (${r.stageName}) · ${activeSkin.arenaTitle}`;
      } else {
        el.pauseSubtitle.textContent = 'Tocá CONTINUAR para volver a la partida';
      }
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
    game.mode = MODES.TOURNAMENT;
    game.scores.player = game.scores.ai = 0;
    game.survivalHits = 0;
    game.survivalLevel = 1;
    game.survivalNewRecord = false;
    clearParticles();
    clearCallouts();
    resetPaddles();
    resetBall(false);
    applySkin(equippedSkin);
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
        registerSurvivalHit(true);
        Sound.score(true);
        game.shake = 8;
        spawnSparks(W, ball.y, -1, 18, COLOR_IDX_PLAYER, 1.4);
        spawnCallout('¡IA SUPERADA! +1', W / 2, H / 2 - 48, activeSkin.playerColor, 0.95);
        game.serveDir = -1;
        startCountdown(SURVIVAL_RESERVE_COUNTDOWN, true);
      } else {
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

    if (game.scores[who] >= game.winScore) {
      if (game.mode === MODES.TOURNAMENT) {
        handleTournamentMatchEnd(who === 'player');
      } else {
        endMatch(who === 'player');
      }
      return;
    }
    game.serveDir = who === 'player' ? 1 : -1;
    startCountdown(COUNTDOWN_TIME, false);
  }

  function handleTournamentMatchEnd(playerWon) {
    const round = TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0];

    if (playerWon) {
      tournament.completedRounds[round.index] = true;
      const unlockedNow = round.unlockSkin && unlockSkin(round.unlockSkin) ? round.unlockSkin : null;
      game.lastUnlockedSkin = unlockedNow;

      if (round.index < TOURNAMENT_ROUNDS.length - 1) {
        // Avanza a la siguiente ronda y muestra pantalla intermedia
        tournament.currentRound = round.index + 1;
        saveTournamentProgress();
        recordOnePlayerMatchOutcome(true, game.scores.ai);
        gameoverSoundTimer = setTimeout(() => {
          gameoverSoundTimer = 0;
          if (unlockedNow) Sound.unlock();
          else Sound.win();
        }, 280);
        openTournamentIntermission(true, unlockedNow);
        return;
      }

      // ¡Ganó la Ronda 4: Gran Campeón!
      tournament.tournamentsWon += 1;
      tournament.currentRound = 0;
      tournament.completedRounds = [false, false, false, false];
      saveTournamentProgress();
      records.tournamentsWon = Math.max(records.tournamentsWon + 1, tournament.tournamentsWon);
      recordOnePlayerMatchOutcome(true, game.scores.ai);
      game.tournamentChampionRun = true;

      game.state = 'gameover';
      clearActiveTouches();
      clearCallouts();
      resetBall(false);
      clearParticles();

      el.resultTitle.textContent = '¡GRAN CAMPEÓN!';
      el.resultTitle.className = 'overlay-title record';
      el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;

      if (unlockedNow && SKINS[unlockedNow]) {
        el.resultUnlockBanner.textContent = `★ SKIN DESBLOQUEADA: ${SKINS[unlockedNow].name.toUpperCase()}`;
        el.resultUnlockBanner.classList.remove('hidden');
      } else {
        el.resultUnlockBanner.classList.add('hidden');
      }

      el.resultDetail.textContent =
        `Conquistaste las 4 arenas · Títulos ganados: ${tournament.tournamentsWon}`;
      el.resultDetail.classList.remove('hidden');

      el.restartBtn.textContent = 'NUEVO TORNEO';
      el.gameoverExtraBtn.textContent = 'CANCHAS / SKINS';
      el.gameoverExtraBtn.classList.remove('hidden');

      gameoverSoundTimer = setTimeout(() => {
        gameoverSoundTimer = 0;
        if (unlockedNow) Sound.unlock();
        else Sound.win();
      }, 300);

      setOverlay('gameover');
      renderStatic();
      return;
    }

    // Derrota en una ronda del Torneo: permite reintentar esa misma ronda o empezar de cero
    recordOnePlayerMatchOutcome(false, game.scores.ai);
    game.state = 'gameover';
    clearActiveTouches();
    clearCallouts();
    resetBall(false);
    clearParticles();

    el.resultTitle.textContent = 'ELIMINADO';
    el.resultTitle.className = 'overlay-title lose';
    el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
    el.resultUnlockBanner.classList.add('hidden');
    el.resultDetail.textContent =
      `Caíste en ${round.stageName} (Ronda ${round.index + 1}/4) ante ${round.rivalName}`;
    el.resultDetail.classList.remove('hidden');

    el.restartBtn.textContent = 'REINTENTAR RONDA';
    el.gameoverExtraBtn.textContent = 'NUEVO TORNEO';
    el.gameoverExtraBtn.classList.toggle('hidden', tournament.currentRound === 0);

    gameoverSoundTimer = setTimeout(() => {
      gameoverSoundTimer = 0;
      Sound.lose();
    }, 300);

    setOverlay('gameover');
    renderStatic();
  }

  function endMatch(playerWon) {
    game.state = 'gameover';
    clearActiveTouches();
    clearCallouts();
    resetBall(false);
    clearParticles();

    el.resultUnlockBanner.classList.add('hidden');
    el.resultDetail.classList.add('hidden');
    el.restartBtn.textContent = 'REINICIAR';
    el.gameoverExtraBtn.classList.add('hidden');

    if (game.mode === MODES.TWO_P) {
      el.resultTitle.textContent = playerWon ? '¡GANA J1!' : '¡GANA J2!';
      el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
      el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
      gameoverSoundTimer = setTimeout(() => { gameoverSoundTimer = 0; Sound.win(); }, 320);
    } else {
      recordOnePlayerMatchOutcome(playerWon, game.scores.ai);
      el.resultTitle.textContent = playerWon ? '¡VICTORIA!' : 'DERROTA';
      el.resultTitle.className = 'overlay-title ' + (playerWon ? 'win' : 'lose');
      el.resultScore.textContent = `${game.scores.player} — ${game.scores.ai}`;
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
    el.resultUnlockBanner.classList.add('hidden');
    el.resultDetail.textContent = `IA Nivel ${game.survivalLevel} · Récord: ${game.survivalBest}`;
    el.resultDetail.classList.remove('hidden');
    el.restartBtn.textContent = 'REINICIAR';
    el.gameoverExtraBtn.classList.add('hidden');

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
    const minX = p.prevX < p.x ? p.prevX : p.x;
    const maxX = (p.prevX > p.x ? p.prevX : p.x) + p.w;
    const cx = clamp(ball.x, minX, maxX);
    const cy = clamp(ball.y, p.y, p.y + p.h);
    const dx = ball.x - cx;
    const dy = ball.y - cy;
    return dx * dx + dy * dy <= BALL_R * BALL_R;
  }

  function hitPaddle(p, dir) {
    const rel = clamp((ball.y - (p.y + p.h / 2)) / (p.h / 2 + BALL_R), -1, 1);
    const isHuman = (p === player) || (game.mode === MODES.TWO_P);
    const isFuriousTrigger = isHuman && p.power >= 100;
    const isForwardSmash = isHuman && p.smashForwardTimer > 0;
    const isSwipeSmash = isHuman && p.smashSwipeTimer > 0;
    const isVelocitySmash = isHuman && Math.abs(p.vy) >= SMASH_PADDLE_VY;
    const isEdgeSmash = isHuman && Math.abs(rel) >= SMASH_EDGE_REL;
    const isSmash = !isFuriousTrigger && (isForwardSmash || isSwipeSmash || isVelocitySmash || isEdgeSmash);

    ball.baseSpeed = Math.min(ball.baseSpeed * BALL_SPEEDUP, BALL_MAX_SPEED);

    const maxAngle = isFuriousTrigger
      ? MAX_BOUNCE_ANGLE * 0.72
      : isSmash
        ? MAX_BOUNCE_ANGLE * 0.85
        : MAX_BOUNCE_ANGLE;
    const angle = rel * maxAngle;

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

    if (isFuriousTrigger) {
      // Súper Golpe: Pelota Furiosa (consumo total de la barra al 0%)
      p.power = 0;
      updatePowerBars();

      ball.speed = clamp(ball.baseSpeed * FURIOUS_SPEED_MULT, FURIOUS_MIN_SPEED, FURIOUS_MAX_SPEED);
      ball.isFurious = true;
      ball.isSmash = true;
      ball.emberTimer = 0;
      ball.curve = curveDir * FURIOUS_CURVE_ACCEL;

      p.smashForwardTimer = 0;
      p.smashSwipeTimer = 0;
      p.smashFlash = 1;

      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(40); } catch (_) { /* ignorar si no soportado */ }
      }
      records.totalSuperShots += 1;
      saveRecords();
      checkTrophies(true);
    } else if (isSmash) {
      ball.speed = Math.min(Math.max(ball.baseSpeed * SMASH_SPEED_MULT, SMASH_MIN_SPEED), SMASH_MAX_SPEED);
      ball.isFurious = false;
      ball.isSmash = true;
      ball.emberTimer = 0;

      const curveMag = (isForwardSmash && isSwipeSmash) ? SMASH_CURVE_COMBO : SMASH_CURVE_BASE;
      ball.curve = curveDir * curveMag;

      p.smashForwardTimer = 0;
      p.smashSwipeTimer = 0;
      p.smashFlash = 1;

      // Cargar Barra de Poder (+34% por Smash -> 3 golpes = 100%)
      const prevPower = p.power;
      p.power = Math.min(100, p.power + POWER_PER_SMASH);
      updatePowerBars();
      if (prevPower < 100 && p.power >= 100) {
        Sound.powerReady();
        spawnCallout(
          '¡PODER 100%!',
          clamp(p.x + dir * 64, 90, W - 90),
          clamp(ball.y + 28, 44, H - 30),
          '#fde047',
          0.85
        );
      }
    } else {
      // Golpe normal o devolución del rival: restaura velocidad normal
      ball.speed = ball.baseSpeed;
      ball.isFurious = false;
      ball.isSmash = false;
      ball.curve = 0;
    }

    ball.vx = dir * Math.cos(angle) * ball.speed;
    ball.vy = Math.sin(angle) * ball.speed;
    ball.x = dir > 0 ? p.x + p.w + BALL_R : p.x - BALL_R;

    game.rally++;
    if (game.rally > records.maxRally) {
      records.maxRally = game.rally;
      saveRecords();
    }
    p.flash = 1;

    if (isFuriousTrigger) {
      Sound.superShot();
      spawnSparks(ball.x, ball.y, dir, 18, COLOR_IDX_SMASH_ORANGE, 1.7);
      spawnSparks(ball.x, ball.y, dir, 14, COLOR_IDX_SMASH_RED, 1.4);
      game.shake = Math.max(game.shake, 11.5);
      spawnCallout(
        '¡PELOTA FURIOSA!',
        clamp(ball.x + dir * 82, 110, W - 110),
        clamp(ball.y - 30, 44, H - 30),
        '#fef08a',
        0.85
      );
    } else if (isSmash) {
      Sound.smash();
      spawnSparks(ball.x, ball.y, dir, 14, COLOR_IDX_SMASH_ORANGE, 1.45);
      spawnSparks(ball.x, ball.y, dir, 8, COLOR_IDX_SMASH_RED, 1.15);
      game.shake = Math.max(game.shake, 7.5);
      spawnCallout(
        '¡SMASH!',
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
        spawnSparks(ball.x, 0, 1, 4, ball.isSmash ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_ACCENT, 0.55);
      } else if (ball.y + BALL_R > H) {
        ball.y = H - BALL_R - (ball.y + BALL_R - H);
        ball.vy = -Math.abs(ball.vy);
        if (ball.isSmash) {
          ball.curve = ball.curve > 0 ? -ball.curve * 0.4 : ball.curve * 0.65;
        }
        Sound.wall();
        spawnSparks(ball.x, H, 1, 4, ball.isSmash ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_ACCENT, 0.55);
      }

      const pMinX = player.prevX < player.x ? player.prevX : player.x;
      const aMaxX = (ai.prevX > ai.x ? ai.prevX : ai.x) + ai.w;
      if (ball.vx < 0 && ball.x >= pMinX && circleRectHit(player)) {
        hitPaddle(player, 1);
      } else if (ball.vx > 0 && ball.x <= aMaxX && circleRectHit(ai)) {
        hitPaddle(ai, -1);
      }

      if (ball.x + BALL_R < 0 || ball.x - BALL_R > W) {
        pointScored(ball.x < 0 ? 'ai' : 'player');
        return;
      }
    }

    if (ball.isFurious || ball.isSmash) {
      ball.emberTimer -= dt;
      if (ball.emberTimer <= 0) {
        ball.emberTimer = ball.isFurious ? FURIOUS_EMBER_INTERVAL : SMASH_EMBER_INTERVAL;
        spawnSparks(
          ball.x,
          ball.y,
          ball.vx >= 0 ? -1 : 1,
          ball.isFurious ? 2 : 1,
          Math.random() < 0.55 ? COLOR_IDX_SMASH_ORANGE : COLOR_IDX_SMASH_RED,
          ball.isFurious ? 0.65 : 0.35
        );
      }
    }
  }

  // ==========================================================
  //  Jugadores e IA (con ángulos tácticos y lectura de rebotes)
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

    if (ctrl.lastTime && now - ctrl.lastTime > 45) {
      const decay = Math.pow(0.002, dt);
      ctrl.smoothVy *= decay;
      ctrl.smoothVxForward *= decay;
      ctrl.swipeDistY *= decay;
    }
    if (ctrl.touchId !== null || ctrl.pointerActive) {
      ctrl.anchorX += (ctrl.lastX - ctrl.anchorX) * Math.min(1, dt * 6.5);
    }

    if (paddle.smashForwardTimer > 0) {
      paddle.smashForwardTimer = Math.max(0, paddle.smashForwardTimer - dt);
    } else {
      paddle.lungeTarget = Math.max(0, paddle.lungeTarget - dt * 130);
    }
    if (paddle.smashSwipeTimer > 0) {
      paddle.smashSwipeTimer = Math.max(0, paddle.smashSwipeTimer - dt);
    }

    paddle.prevX = paddle.x;
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

  function getActiveAIConfig() {
    if (game.mode === MODES.TOURNAMENT) {
      return (TOURNAMENT_ROUNDS[tournament.currentRound] || TOURNAMENT_ROUNDS[0]).ai;
    }
    if (game.mode === MODES.SURVIVAL) {
      return getSurvivalAIConfig(game.survivalLevel);
    }
    return DIFFICULTY[game.difficulty];
  }

  function updateAI(dt) {
    const cfg = getActiveAIConfig();
    const center = ai.y + ai.h / 2;

    if (game.state === 'playing') {
      const dir = Math.sign(ball.vx);
      const isServeBall = game.rally === 0;

      if (dir !== ai.lastDir) {
        ai.lastDir = dir;
        ai.thinkTimer = 0;
        // Elección táctica independiente (desvinculada del movimiento/toque del jugador humano)
        ai.aimDir = Math.random() < 0.5 ? -1 : 1;

        if (isServeBall && dir > 0) {
          // En el saque hacia la IA reacciona de inmediato con margen seguro para no hacerse auto-punto
          ai.reactTimer = 0;
          ai.errorOffset = rand(-1, 1) * Math.min(cfg.error * 0.25, 14);
        } else {
          ai.reactTimer = cfg.reaction * rand(0.7, 1.35);
          const speedFactor = 1 + ((ball.speed - BALL_START_SPEED) / BALL_START_SPEED) * 0.9;
          ai.errorOffset = rand(-1, 1) * cfg.error * speedFactor;
          const mistakeChance = cfg.mistakeChance !== undefined ? cfg.mistakeChance : 0.08;
          if (Math.random() < mistakeChance) ai.errorOffset *= 1.75;
        }
      }

      if (ai.reactTimer > 0) {
        ai.reactTimer -= dt;
      } else {
        ai.thinkTimer -= dt;
        if (ai.thinkTimer <= 0) {
          ai.thinkTimer = isServeBall ? 0.06 : cfg.reaction * 0.6;
          if (dir > 0) {
            const targetX = ai.x - BALL_R;
            const exactY = predictBallY(targetX);
            if (isServeBall) {
              ai.target = clamp(exactY + ai.errorOffset, ai.h * 0.5, H - ai.h * 0.5);
            } else {
              const distFrac = clamp((ai.x - ball.x) / W, 0, 1);
              const err = ai.errorOffset * (0.55 + 0.45 * distFrac);
              const wallAnt = cfg.wallAnticipation !== undefined ? cfg.wallAnticipation : 1;

              let predictedY = exactY;
              if (wallAnt < 1 && ball.vx > 0) {
                const t = Math.max(0, (targetX - ball.x) / ball.vx);
                const naiveY = clamp(ball.y + ball.vy * t, BALL_R, H - BALL_R);
                predictedY = naiveY + (exactY - naiveY) * wallAnt;
              }

              // En rondas tácticas/avanzadas busca golpear con el borde para abrir ángulos
              const edgeOffset = cfg.edgeAim > 0 ? -ai.aimDir * (ai.h * 0.34) * cfg.edgeAim : 0;
              ai.target = clamp(predictedY + edgeOffset + err, ai.h * 0.5, H - ai.h * 0.5);
            }
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
    ai.prevX = ai.baseX;
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
        pushTrail(ball.x, ball.y, ball.isFurious ? 2 : ball.isSmash ? 1 : 0);
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

    const chargeAlpha = Math.max(p.smashFlash, (p.lunge / MAX_LUNGE_X) * 0.55);
    if (chargeAlpha > 0.04) {
      ctx.globalAlpha = clamp(chargeAlpha, 0, 0.9);
      ctx.drawImage(activeSprites.paddleSmash, dx, dy, PADDLE_SPRITE_W, PADDLE_SPRITE_H);
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
        const stateCode = trailSmash[idx];
        const size = stateCode === 2
          ? TRAIL_FURIOUS_SIZES[slot]
          : stateCode === 1
            ? TRAIL_SMASH_SIZES[slot]
            : TRAIL_SIZES[slot];
        ctx.globalAlpha = stateCode === 2
          ? Math.min(0.92, TRAIL_ALPHAS[slot] * 1.85)
          : stateCode === 1
            ? TRAIL_ALPHAS[slot] * 1.35
            : TRAIL_ALPHAS[slot];
        ctx.drawImage(
          stateCode > 0 ? activeSprites.trailDotSmash : activeSprites.trailDot,
          trailX[idx] - size * 0.5,
          trailY[idx] - size * 0.5,
          size,
          size
        );
      }
      ctx.globalAlpha = 1;
    }

    if (ball.isFurious) {
      // Resplandor rojo/naranja con círculos concéntricos semitransparentes (cero shadowBlur)
      const bx = ball.x;
      const by = ball.y;
      ctx.fillStyle = '#ef4444';
      ctx.globalAlpha = 0.16;
      ctx.beginPath(); ctx.arc(bx, by, 34, 0, Math.PI * 2); ctx.fill();

      ctx.globalAlpha = 0.30;
      ctx.beginPath(); ctx.arc(bx, by, 24, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#f97316';
      ctx.globalAlpha = 0.58;
      ctx.beginPath(); ctx.arc(bx, by, 16.5, 0, Math.PI * 2); ctx.fill();

      ctx.fillStyle = '#fdba74';
      ctx.globalAlpha = 0.88;
      ctx.beginPath(); ctx.arc(bx, by, 11.5, 0, Math.PI * 2); ctx.fill();

      // Núcleo blanco incandescente
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(bx, by, BALL_R + 1.5, 0, Math.PI * 2); ctx.fill();
    } else if (ball.isSmash) {
      ctx.drawImage(
        activeSprites.ballSmash,
        ball.x - BALL_SMASH_SPRITE_HALF,
        ball.y - BALL_SMASH_SPRITE_HALF,
        BALL_SMASH_SPRITE_SIZE,
        BALL_SMASH_SPRITE_SIZE
      );
    } else {
      ctx.drawImage(
        activeSprites.ball,
        ball.x - BALL_SPRITE_HALF,
        ball.y - BALL_SPRITE_HALF,
        BALL_SPRITE_SIZE,
        BALL_SPRITE_SIZE
      );
    }
  }

  function drawParticles() {
    if (particleCount === 0) return;
    const palette = activeSkin.particles;
    let lastColor = -1;
    for (let i = 0; i < particleCount; i++) {
      const cIdx = pColor[i];
      if (cIdx !== lastColor) {
        ctx.fillStyle = palette[cIdx] || palette[0];
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

    ctx.font = activeSkin.pixelated
      ? '800 18px "Courier New", ui-monospace, monospace'
      : '800 18px "Segoe UI", system-ui, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;

    for (let i = 0; i < MAX_CALLOUTS; i++) {
      const c = callouts[i];
      if (!c.active) continue;
      const alpha = clamp((c.life / c.maxLife) * 1.4, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = activeSkin.calloutStroke;
      ctx.strokeText(c.text, c.x, c.y);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawCountdown() {
    const n = Math.ceil(game.countdown);
    if (n <= 0 || n > 3) return;
    const digitSprite = activeSprites.digits[n];
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

    ctx.font = activeSkin.pixelated
      ? '700 16px "Courier New", ui-monospace, monospace'
      : '600 16px "Segoe UI", system-ui, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = activeSkin.serveText;
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

    ctx.drawImage(activeSprites.bg, -BG_PAD, -BG_PAD, W + BG_PAD * 2, H + BG_PAD * 2);
    drawPaddle(player, activeSprites.player, activeSprites.playerFlash);
    drawPaddle(ai, activeSprites.ai, activeSprites.aiFlash);
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
      if (!e.repeat) {
        if (game.state === 'quickplay' || game.state === 'skins' || game.state === 'trophies' || game.state === 'intermission') {
          goToMenu();
        } else {
          togglePause();
        }
      }
    } else if (e.code === 'KeyR' && !e.repeat) {
      if (game.state === 'paused' || game.state === 'gameover') {
        e.preventDefault();
        Sound.click();
        startMatch();
      }
    } else if (e.code === 'KeyM' && !e.repeat) {
      toggleSfxMute();
    } else if (e.code === 'KeyN' && !e.repeat) {
      toggleMusicMute();
    } else if (e.code === 'Enter' && !e.repeat) {
      if (game.state === 'menu') { e.preventDefault(); openTournamentIntermission(false, null); }
      else if (game.state === 'intermission') { e.preventDefault(); startMatch(MODES.TOURNAMENT); }
      else if (game.state === 'quickplay') { e.preventDefault(); startMatch(MODES.VS_AI); }
      else if (game.state === 'gameover') {
        e.preventDefault();
        if (game.mode === MODES.TOURNAMENT && game.tournamentChampionRun) startNewTournament();
        else startMatch();
      }
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

    const dxForward = dx * dir;
    const vxForward = dxForward / dtSec;
    ctrl.smoothVxForward = ctrl.smoothVxForward * 0.42 + vxForward * 0.58;

    if ((pt.x - ctrl.anchorX) * dir < 0) {
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

  // Ahorro de energía y pausa limpia de música al pasar a segundo plano
  function handleAppSuspend() {
    controls[0].up = controls[0].down = false;
    controls[1].up = controls[1].down = false;
    clearActiveTouches();
    Music.stop();
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
      AudioBus.suspend();
    } else {
      refreshCanvasRect();
      AudioBus.resume();
      if (shouldRunLoop()) {
        startLoop();
      } else {
        Music.syncPlayback();
        render();
      }
    }
  });

  // ==========================================================
  //  Eventos de botones (Menú, Torneo, Skins, Audio, Pausa)
  // ==========================================================
  document.getElementById('tournament-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    openTournamentIntermission(false, null);
  });

  document.getElementById('quickplay-open-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    openQuickPlayMenu();
  });

  document.getElementById('two-player-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch(MODES.TWO_P);
  });

  document.getElementById('survival-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch(MODES.SURVIVAL);
  });

  document.getElementById('skins-open-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    openSkinsMenu();
  });

  document.getElementById('trophies-open-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    openTrophiesMenu();
  });

  document.getElementById('trophies-back-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    goToMenu();
  });

  el.diffBtns.forEach((b) => b.addEventListener('click', () => {
    unlockAudio();
    setDifficulty(b.dataset.diff);
    Sound.click();
  }));

  document.getElementById('quickplay-start-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch(MODES.VS_AI);
  });

  document.getElementById('quickplay-back-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    goToMenu();
  });

  document.getElementById('skins-back-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    goToMenu();
  });

  el.tournamentSkinToggle.addEventListener('click', () => {
    unlockAudio();
    tournamentUseEquippedSkin = !tournamentUseEquippedSkin;
    localStorage.setItem(STORAGE_KEYS.tournamentUseSkin, tournamentUseEquippedSkin ? '1' : '0');
    renderSkinsGrid();
    Sound.click();
  });

  el.tournamentPlayBtn.addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch(MODES.TOURNAMENT);
  });

  el.tournamentResetBtn.addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startNewTournament();
  });

  document.getElementById('tournament-menu-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    goToMenu();
  });

  document.getElementById('pause-restart-btn').addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    startMatch();
  });

  document.getElementById('resume-btn').addEventListener('click', togglePause);
  document.getElementById('quit-btn').addEventListener('click', goToMenu);
  document.getElementById('menu-btn').addEventListener('click', goToMenu);

  el.restartBtn.addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    if (game.mode === MODES.TOURNAMENT && game.tournamentChampionRun) {
      startNewTournament();
    } else {
      startMatch();
    }
  });

  el.gameoverExtraBtn.addEventListener('click', () => {
    unlockAudio();
    Sound.click();
    if (game.mode === MODES.TOURNAMENT && game.tournamentChampionRun) {
      openSkinsMenu();
    } else if (game.mode === MODES.TOURNAMENT) {
      startNewTournament();
    }
  });

  el.pauseBtn.addEventListener('click', (e) => {
    unlockAudio();
    togglePause();
    e.currentTarget.blur();
  });

  function renderAudioButtons() {
    el.musicBtn.classList.toggle('muted', Music.muted);
    el.musicBtn.setAttribute('aria-label', Music.muted ? 'Activar música' : 'Silenciar música');
    el.musicBtn.title = Music.muted ? 'Activar música' : 'Silenciar música';

    el.sfxBtn.classList.toggle('muted', Sound.muted);
    el.sfxBtn.setAttribute('aria-label', Sound.muted ? 'Activar efectos de sonido' : 'Silenciar efectos de sonido');
    el.sfxBtn.title = Sound.muted ? 'Activar efectos (SFX)' : 'Silenciar efectos (SFX)';
  }

  function toggleMusicMute() {
    AudioBus.init();
    Music.setMuted(!Music.muted);
    renderAudioButtons();
    if (!Sound.muted) Sound.click();
  }

  function toggleSfxMute() {
    AudioBus.init();
    Sound.setMuted(!Sound.muted);
    renderAudioButtons();
    if (!Sound.muted) Sound.click();
  }

  el.musicBtn.addEventListener('click', (e) => {
    toggleMusicMute();
    e.currentTarget.blur();
  });

  el.sfxBtn.addEventListener('click', (e) => {
    toggleSfxMute();
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
  //  Inicio (estático en menú hasta pulsar un modo)
  // ==========================================================
  const savedDiff = localStorage.getItem(STORAGE_KEYS.difficulty);
  setDifficulty(DIFFICULTY[savedDiff] ? savedDiff : 'normal');
  checkTrophies(false);
  applySkin(equippedSkin);
  renderAudioButtons();
  updatePauseBtn();
  updateMenuUI();
  resetPaddles();
  resetBall(false);
  resizeCanvas();
  renderStatic();

  window.__pong = {
    game,
    tournament,
    records,
    ball,
    player,
    ai,
    controls,
    DIFFICULTY,
    MODES,
    SKINS,
    TOURNAMENT_ROUNDS,
    TROPHIES,
    MUSIC_TRACKS,
    Music,
    Sound,
    AudioBus,
    getActiveSkin: () => activeSkinId,
    getUnlockedSkins: () => Array.from(unlockedSkins),
    getEquippedSkin: () => equippedSkin,
    getUnlockedTrophies: () => Array.from(unlockedTrophies),
  };
})();
