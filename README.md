# Ping Pong (Android)

Versión móvil para Android de **Neon Pong**, empaquetada con **Capacitor** sobre HTML5 Canvas y Web Audio API.

## Características
- **Modo Torneo (Experiencia principal - 1 Jugador):**
  - 4 rondas consecutivas (*Cuartos de Final*, *Semifinal*, *Final* y *Gran Campeón*) a 5 puntos con escalado lógico de la IA (Inicial, Táctica con ángulos de borde, Agresiva con lectura de rebotes y Maestra con margen humano justo).
  - Canchas alternadas automáticamente en cada ronda, pantalla intermedia de avance y guardado de progreso y skins desbloqueadas en `localStorage`.
- **4 Canchas / Skins 100% originales y desbloqueables:**
  - **Neón Clásico** *(desbloqueada por defecto — Ronda 1)*: fondo `#0b0f19` con líneas cian y magenta.
  - **Retro Portátil 89** *(Ronda 2)*: paleta monocromática verde oliva (`#9bbc0f`, `#8bac0f`, `#306230`, `#0f380f`) con estética pixelada.
  - **Fuego vs. Hielo** *(Ronda 3)*: cancha dividida con mitad volcánica naranja/roja y mitad glacial azul/celeste.
  - **Cyberpunk 2099** *(Ronda 4)*: fondo violeta nocturno con amarillo eléctrico, cian neón y grilla geométrica.
  - Selector **Canchas / Skins** en el menú principal para equipar cualquier arena desbloqueada en Partida Rápida, 2 Jugadores, Supervivencia o Torneo.
- **Modos adicionales:**
  - **Partida Rápida:** partidos a 7 puntos contra la IA (Fácil, Normal y Difícil).
  - **2 Jugadores (mismo teléfono):** modo local a 7 puntos con **multitáctil** independiente (mitad izquierda J1, mitad derecha J2).
  - **Supervivencia / Récord (1 Jugador):** racha sin límite contra una IA que acelera cada 5 golpes con récord persistente.
- **Remate (Smash), Barra de Poder y Súper Golpe ("Pelota Furiosa"):** empujar adelante, deslizar rápido o golpear con los bordes dispara un Smash con chispas extra y sonido agudo que carga un **34%** de la Barra de Poder (para J1 y J2 en 2 Jugadores). Al llegar al **100%** (3 Smash), el siguiente impacto desata la **Pelota Furiosa** (núcleo blanco con resplandor rojo/naranja concéntrico sin `shadowBlur`, estela de fuego, vibración de cámara y vibración háptica).
- **Sistema de Trofeos y Récords (`localStorage`):** panel temático desde el menú principal con récords (torneos ganados, mejor racha de victorias, máximo peloteo y total de Súper Golpes) y 5 trofeos desbloqueables (*Primer Campeón*, *Valla Invicta*, *Imparable*, *Furia Total* y *Leyenda del Ping Pong*) con notificación flotante en pantalla.
- **Música procedural por cancha (Web Audio API):** 4 bucles musicales originales (synthwave, chiptune 8-bits, pulso tenso y darksynth) sin archivos externos, desconexión limpia de osciladores, pausa automática en pausa/segundo plano y controles independientes de **Música** y **SFX**.
- **Optimización térmica y de batería:** fondos y sprites pre-renderizados en offscreen canvas, cero `shadowBlur` en runtime, tope estricto a **60 FPS**, `devicePixelRatio` limitado a `1.5` y pausa del bucle en reposo.

## Descargar APK
Podés descargar el último archivo APK listo para instalar desde la sección **Releases** de este repositorio.

## Compilación local
Requisitos: Node.js, JDK 21 y Android SDK (API 36).

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

El APK generado quedará en `android/app/build/outputs/apk/debug/ping-pong-v1.5.0-debug.apk`.
