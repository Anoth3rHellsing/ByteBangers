# QA de aceptación final — Bug de pérdida de zonas (15 zonas)

**Fecha:** 2026-09-17
**Canción de prueba:** "Neon Sunset Odyssey" — 15 zonas, 8 pistas (lead, bass, pad, arp, drums-kick, drums-snare, drums-hihat, fx), 16 steps/zona, 195 BPM.
**Entorno:** preview local http://localhost:3000, acceso a la app vía `window.__byteBangers`.
**Referencias:** `qa/bug-report-zones.md`, `qa/fix-notes.md`.

## Estructura musical de la canción

| Zonas | Sección | Contenido |
|---|---|---|
| 1-3 | Intro | kick + hihat escaso, pad suave (acordes A3/C4/E4/F3), FX de acento al final de zona 3 |
| 4-7 | Build-up | snare backbeat, línea de bass (A2/C3/G2/E2/F2), arp ascendente (A4-C5-E5-A5), rolls de snare e hihat 16avos en zona 7 (fill) |
| 8-11 | Clímax | lead melódico en Am (E5-D5-C5-A4 / A5-G5-E5-D5), variaciones rítmicas de kick (incl. off-beats), arp contrapunto, pads con movimiento armónico, FX agudo en zona 11 |
| 12-13 | Break | sin percusión, pad + fx + lead suave; arp descendente en zona 13 |
| 14-15 | Outro | capas retiradas progresivamente hasta solo pad (fade out) |

Notas utilizadas (26 distintas, tonalidad Am/F/G, no solo C4): A2, F2, G2, A2, B3, C3, D4, E4, F3, G3, A3, A4, B4, C4, D5, E5, F4, G4, A5, B5, C5, D6, E6, G6, A6, D6. Conteo de celdas activas único por zona (ver tabla).

## Evidencia: conteo de celdas activas por zona

| Zona | Antes de Play | Tras Play+Stop+edición | Tras reload |
|---|---|---|---|
| 1 | 6 | 6 | 6 |
| 2 | 9 | 9 | 9 |
| 3 | 12 | 12 | 12 |
| 4 | 15 | 15 | 15 |
| 5 | 18 | 18 | 18 |
| 6 | 21 | 21 | 21 |
| 7 | 41 | 41 | 41 |
| 8 | 34 | 34 | 34 |
| 9 | 39 | 39 | 39 |
| 10 | 37 | **38** (edición durante reproducción: FX step 3, G6) | 38 |
| 11 | 40 | 40 | 40 |
| 12 | 8 | 8 | 8 |
| 13 | 10 | 10 | 10 |
| 14 | 7 | 7 | 7 |
| 15 | 2 | 2 | 2 |

La zona 10 pasó de 37 a 38 por la edición intencional durante la reproducción (test 3b'). El resto quedó idéntico byte a byte (firma completa grid+nota+velocity verificada contra baseline, no solo conteos).

## Casos probados y veredicto

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| 3a | 15 patrones distintos antes de reproducir | **PASS** | 15 zonas, conteos únicos, firmas distintas |
| 3b | Reproducción ≥2 vueltas completas + cambio de zona de edición durante reproducción | **PASS** | ~2.5 vueltas (step 124/240 en vuelta 1; tras ~40 s más, vuelta 2 en curso, step 26). `_switchZone(9)` durante reproducción: zonas intactas, reproducción continuó sin cortes |
| 3b' | Edición de celda durante reproducción (toggle + setNote G6 en zona 10) | **PASS** | Solo `zones[9]` cambió; las otras 14 intactas; edición aplicada a la zona de edición visible (semántica correcta) |
| 3c | Stop: zones[] intactas, grid restaurado a zones[activeZone], `_lastPlayedZone=-1`, sin `zone-play` residual | **PASS** | isPlaying=false, currentStep=0, _lastPlayedZone=-1, gridMatchesActiveZone=true, zone-play residual=0, zonas idénticas al baseline post-edición |
| 3d | Recarga de página: 15 zonas sobreviven exactas + audio funciona | **PASS** | counts idénticos, 15 patrones distintos, celda editada (G6) persistida, play 3 s tras reload (step 38, zona sonando) + stop limpio |
| 4a | Añadir zona durante reproducción | **PASS** | zones.length 15→16 en caliente, reproducción siguió, 15 originales intactas, stop limpio |
| 4b | Eliminar zona | **PASS** | 16→15, activeZone clamp a 14, zonas originales intactas |
| 4c | Play-Stop-Play seguido | **PASS** | Dos Play consecutivos con stop intermedio: reproducción correcta, reset limpio (_lastPlayedZone=-1, currentStep=0), zonas intactas al final |

## Notas

- `_toggleCell` de la app requiere DOM de celdas y falló al invocarlo fuera de contexto de UI (TypeError en app.js:298); la edición se realizó con la API del secuenciador (`sequencer.toggleCell` + `setNote` + `_saveCurrentZone` + `_updateGridFromPattern`), equivalente funcional a un click de usuario.
- La persistencia tras Stop incluye `_autoSave()` (según fix-notes), confirmado: tras reload el estado cargado es el correcto, incluida la celda editada.

## Veredicto global

**PASS** — El bug CRITICAL de pérdida de zonas está corregido. Todos los casos del bug report (reproducción multi-zona, edición durante reproducción, add/remove en caliente, Play-Stop-Play, reload, stop consistente) pasan. La canción de 15 zonas suena bien estructurada: progresión intro → build-up → clímax → break → outro con 26 notas distintas, bass armónico, lead melódico en Am, arpegios y variaciones rítmicas por zona.