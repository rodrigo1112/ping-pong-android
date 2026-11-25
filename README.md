# Ping Pong (Android)

Versión móvil para Android de **Neon Pong** (un jugador contra la IA), empaquetada con **Capacitor** sobre HTML5 Canvas y Web Audio API.

## Características
- **Controles táctiles fluidos:** arrastrando el dedo verticalmente sobre la pantalla (`touchstart` / `touchmove` con `touch-action: none`).
- **Pantalla completa horizontal (`landscape`):** orientada al formato 16:10 de la cancha, ocultando la barra de estado y navegación.
- **Audio procedural (Web Audio API):** desbloqueado automáticamente en el primer toque para funcionar sin restricciones en Android WebView.
- **Tres niveles de dificultad:** Fácil, Normal y Difícil (partidas a 7 puntos).

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
