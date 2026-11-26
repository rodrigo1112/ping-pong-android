# Ping Pong (Android)

Versión móvil para Android de **Neon Pong**, empaquetada con **Capacitor** sobre HTML5 Canvas y Web Audio API.

## Características
- **Modos de juego:**
  - **1J vs IA:** partidas a 7 puntos con tres niveles de dificultad (Fácil, Normal y Difícil).
  - **2 Jugadores (mismo teléfono):** modo local a 7 puntos con **multitáctil** independiente (mitad izquierda J1, mitad derecha J2).
  - **Supervivencia / Récord (1 Jugador):** jugás sin límite de puntos contra una IA que acelera cada 5 golpes para superar tu racha máxima guardada.
- **Remate y efecto (Smash):** empujá la paleta hacia adelante o deslizala rápido justo al impactar la pelota para lanzar un tiro cargado (rojo/naranja) con mayor velocidad y leve curva.
- **Menú pausa completo:** incluye botones para continuar, reiniciar la partida al instante o volver al menú.
- **Controles táctiles fluidos:** `touchstart` / `touchmove` con `touch-action: none` y soporte multitáctil en modo 2 jugadores.
- **Pantalla completa horizontal (`landscape`):** orientada al formato 16:10 de la cancha, ocultando la barra de estado y navegación.
- **Audio procedural (Web Audio API):** desbloqueado automáticamente en el primer toque para funcionar sin restricciones en Android WebView.

## Descargar APK
Puedes descargar el último archivo `app-debug.apk` listo para instalar desde la sección **Releases** de este repositorio.

## Compilación local
Requisitos: Node.js, JDK 21 y Android SDK (API 36).

```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
```

El APK generado quedará en `android/app/build/outputs/apk/debug/app-debug.apk`.
