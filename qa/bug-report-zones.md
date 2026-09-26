# Bug Report: Pérdida de datos de zonas tras reproducción

**Proyecto:** ByteBangers (DAW chiptune 16-bit)
**Fecha:** 2026-09-17
**Severidad:** CRITICAL — pérdida de datos del usuario (patrones de zonas sobrescritos y persistidos en localStorage)
**Archivo afectado:** `js/app.js`

## Descripción

Las zonas adicionales (2, 3, ...) pierden su patrón tras una reproducción: al reproducir, `_tick()` carga cada zona en el secuenciador para sonarla, pero `_saveCurrentZone()` escribe el patrón cargado en `zones[activeZone]` — un índice distinto al que se está reproduciendo. Resultado: `zones[activeZone]` queda sobrescrito con el contenido de otra zona. Además, `stop()` no restaura la zona activa (ni su grid ni `_lastPlayedZone`), y el estado corrupto se persiste en localStorage en el próximo `_autoSave()`, haciendo la pérdida permanente tras recargar.

## Pasos de reproducción exactos

1. Cargar la app (localStorage limpio).
2. En zona 1, activar celdas: track 0 step 0 (C4) y track 1 step 2 (E4).
3. Click en "+ Zone" (zona 2), activar track 4 step 0.
4. Click en "+ Zone" (zona 3), activar track 6 step 5.
5. Verificar `window.__byteBangers.zones` — tres snapshots distintos (ver evidencia).
6. Pulsar Play y dejar que recorra al menos 2 zonas completas (aquí: 3 zonas, ~3 s a 400 BPM).
7. Pulsar Stop.
8. Inspeccionar `window.__byteBangers.zones` de nuevo.

## Resultado esperado vs obtenido

**Esperado:** `zones[]` conserva los tres patrones originales tras Stop; el grid mostrado corresponde a `zones[activeZone]`; tras recargar, todo persiste.

**Obtenido:** `zones[2]` (zona 3) queda sobrescrito con el patrón de la zona 2. Tras cualquier `_autoSave()` posterior (cambiar/añadir/eliminar zona, editar celda con autosave) y recargar la página, la pérdida es permanente.

## Evidencia (snapshots de `grid`, formato `track:bits16`)

Antes de reproducir (`activeZone=2`):
```
zones[0]: ["0:1000000000000000","1:0010000000000000"]
zones[1]: ["4:1000000000000000"]
zones[2]: ["6:0000010000000000"]
```

Tras Play (3 zonas) + Stop:
```
zones[0]: ["0:1000000000000000","1:0010000000000000"]   (intacto)
zones[1]: ["4:1000000000000000"]                          (intacto)
zones[2]: ["4:1000000000000000"]   <- CORRUPTO: es el patrón de la zona 2
```
`activeZone` seguía siendo 2, pero el secuenciador mostraba el patrón de la zona 2 (por `_loadZone(1)` durante `_tick`): grid mostrado ≠ `zones[activeZone]`.

localStorage inmediatamente tras Stop seguía intacto (`_autoSave` no corre en reproducción ni Stop), pero tras el siguiente `_autoSave()` y `location.reload()`, la zona 3 se carga ya con los datos corruptos de la zona 2 — pérdida permanente confirmada.

## Hipótesis de causa raíz (confirmada por código y reproducción)

En `js/app.js`, `_tick()` (líneas 504-558):

```js
const zoneIndex = Math.floor(this.currentStep / this.sequencer.steps) % this.zones.length;
...
if (zoneIndex !== this._lastPlayedZone) {
  this._saveCurrentZone();            // línea 513 — ¡BUG!
  this._loadZone(zoneIndex);          // línea 514
  this._lastPlayedZone = zoneIndex;   // línea 515
}
```

1. **`_saveCurrentZone()` (líneas 155-157)** hace `this.zones[this.activeZone] = this.sequencer.getPattern()`. Durante la reproducción `activeZone` NO se actualiza (sigue apuntando a la zona donde estaba el usuario, p. ej. 2), mientras el secuenciador contiene el patrón de la zona que se está a punto de descargar/sonar. Al cruzar de zona, el patrón de la zona que acaba de sonar se escribe en `zones[activeZone]` — sobrescribiendo el patrón del usuario de esa zona con datos ajenos. En la reproducción de prueba: al pasar de zona 2 → zona 3, `_saveCurrentZone()` escribió el patrón de la zona 2 en `zones[2]`.
2. **`stop()` (líneas ~468-478)** no restaura nada: ni `this._loadZone(this.activeZone)` para devolver el grid del usuario, ni `_lastPlayedZone = -1`, ni `_autoSave()` — así el secuenciador queda mostrando la última zona reproducida mientras `activeZone` apunta a otra (inconsistencia visible).
3. **Persistencia diferida del daño:** `_autoSave()` (líneas 686-698) es el único punto de escritura a localStorage (clave `bytebangers-song`) y se llama solo en interacciones (switch/add/remove zona, edición, etc.), nunca en `stop()`. Por eso la pérdida aparece "tras reproducir una vez y recargar": la corrupción en memoria se persiste en el primer autosave posterior a la reproducción.

En resumen: la zona activa del usuario (`activeZone`, zona de edición) y la zona de reproducción (`zoneIndex` en `_tick`) son conceptos distintos que el código mezcla al reutilizar `_saveCurrentZone()`/`_loadZone()` conmutando solo el secuenciador, no `activeZone`.

## Casos de regresión que un fix debe cubrir

- Reproducir ≥2 zonas y Stop: `zones[]` idéntico a antes de Play (verificar snapshot completo, no solo celdas activas: notas, velocity).
- Cambiar de zona manualmente DURANTE la reproducción (interacción de `_switchZone` con `_tick` en curso): sin corrupción, sin estado de UI inconsistente al parar.
- Añadir zona durante reproducción (cambia `zones.length` a mitad de `_tick`, recalcula `totalSteps` y wrap-around).
- Eliminar zona durante reproducción (`zoneIndex` puede quedar fuera de rango; `activeZone` clamp).
- Stop → el grid mostrado debe volver a `zones[activeZone]` y el highlight de la zone bar debe reflejar `activeZone`, no la última zona reproducida.
- Recargar página tras reproducción sin ninguna interacción intermedia: localStorage debe seguir conteniendo el estado pre-reproducción (no debe haber autosave con datos corruptos).
- Export WAV multi-zona (js/export.js usa `zones[]`): exportar tras reproducir debe producir las zonas originales, no las sobrescritas.
- Edición de celdas durante reproducción (el usuario edita la zona que suena): decidir y respetar semántica — si el fix hace que la edición durante reproducción aplique a la zona visible/activa, guardar correctamente.
- Play → Stop → Play inmediato: `_lastPlayedZone` correctamente reseteado; reproducción desde step 0 con `zones[]` intacto.

## Notas de entorno

- Reproducido en preview local (http://localhost:3000), app web vanilla, Chrome.
- Video del usuario disponible en `C:\Users\nicol\AppData\Local\Packages\Microsoft.ScreenSketch_8wekyb3d8bbwe\TempState\Recordings\20260917-0447-03.8361771.mp4` (no fue necesario extraer frames; el bug se reprodujo end-to-end y coincide con la descripción del usuario).