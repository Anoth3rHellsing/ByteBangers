# Fix: corrupcion de zonas durante reproduccion (bug-report-zones)

**Fecha:** 2026-09-17
**Archivos:** `js/app.js`, `css/app.css`

## Causa raiz (confirmada por QA)

1. `_tick()` llamaba a `_saveCurrentZone()` + `_loadZone(zoneIndex)` al cambiar de zona en reproduccion. Eso escribia el patron de la zona que suena sobre `this.zones[this.activeZone]` (la zona de EDICION), corrompiendo los datos.
2. `stop()` no restauraba `zones[activeZone]` en el secuenciador, no reseteaba `_lastPlayedZone` ni `currentStep`, y no hacia `_autoSave()`, asi que la corrupcion se persistia en el primer autosave posterior y se perdia tras reload.

## Cambios

### js/app.js

- **Constructor:** inicializa `this._lastPlayedZone = -1`.
- **`_tick()` (antes lineas ~512-516):** elimina `_saveCurrentZone()`/`_loadZone()` durante reproduccion. Ahora lee el snapshot de la zona que suena directamente desde `this.zones[zoneIndex]` (`.grid`, `.tracks`) sin mutar `this.sequencer` ni escribir en `this.zones`. Solo actualiza el resaltado visual via `_updatePlaybackZoneHighlight()`.
- **Nuevo helper `_updatePlaybackZoneHighlight(zoneIndex)`:** resalta la zona en reproduccion con la clase `zone-play` (distinta de `rw-active` que marca la zona de edicion).
- **`play()`:** resetea `currentStep = 0` y `_lastPlayedZone = -1`.
- **`stop()`:** resetea `currentStep = 0` y `_lastPlayedZone = -1`; recarga la zona de edicion en el secuenciador y la UI con `_loadZone(this.activeZone)` (que internamente llama `_updateGridFromPattern()` y `_syncMixerUI()`); re-renderiza los botones de zona (quita `zone-play`); y llama `_autoSave()` al final.
- **`_autoSave()`:** sin cambios — hace snapshot del secuencer sobre `zones[activeZone]`, que ahora es seguro porque la reproduccion nunca muta el secuenciador.

### css/app.css

- Nuevo estilo `.zone-btn.zone-play` (resaltado cian) para distinguir visualmente "zona sonando" (cian) de "zona en edicion" (rosa, `rw-active`).

## Regresiones cubiertas por diseno

- Add/remove/cambio de zona durante reproduccion: la reproduccion ya no carga patrones en el secuenciador; `_tick` recalcula `zoneIndex` desde `this.zones.length` en cada tick, y el loop total se autorresetia cuando `currentStep >= totalSteps`.
- Recarga de pagina: la corrupcion ya no ocurre y `stop()` persiste estado consistente.
- Export WAV multi-zona: sigue llamando `_saveCurrentZone()` antes de exportar; los snapshots en `this.zones` siguen intactos.
- Edicion durante reproduccion: las ediciones tocan `this.sequencer`/`zones[activeZone]`, sin afectar la lectura de snapshots en `_tick`.
- Play-Stop-Play: `stop()` restaura secuenciador y resetea contadores; `play()` arranca limpio.
- Flechas izq/der durante reproduccion: `_switchZone` muta solo la zona de edicion; sin colision con la reproduccion.
