/**
 * ByteBangers WAV Export Module
 * Renders sequencer patterns (single or multi-zone) to 16-bit PCM WAV
 * using OfflineAudioContext, then triggers a browser download.
 * @module export
 */

import { SynthVoice, InstrumentPresets } from './audio-engine.js';

// ---------------------------------------------------------------------------
// Note name → MIDI number mapping
// ---------------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert a note string like "C4" or "F#3" to a MIDI note number.
 * @param {string} noteStr
 * @returns {number} MIDI note (0-127). Returns 60 (middle C) on parse failure.
 */
function noteToMidi(noteStr) {
  if (!noteStr || typeof noteStr !== 'string') return 60;
  const match = noteStr.match(/^([A-Ga-g])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return 60;
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = parseInt(match[3], 10);
  const baseMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semitone = baseMap[letter] ?? 0;
  if (accidental.startsWith('#')) semitone += accidental.length;
  else if (accidental.startsWith('b')) semitone -= accidental.length;
  const midi = (octave + 1) * 12 + semitone;
  return Math.max(0, Math.min(127, midi));
}

// ---------------------------------------------------------------------------
// Preset resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a sequencer instrument name to an AudioEngine preset object.
 * @param {string} name - Preset key (e.g. 'lead', 'bass', 'drums-kick').
 * @returns {object}
 */
function resolvePreset(name) {
  return InstrumentPresets[name] || InstrumentPresets.lead;
}

// ---------------------------------------------------------------------------
// WAV encoding
// ---------------------------------------------------------------------------

/**
 * Encode float samples (-1..1) into a 16-bit PCM WAV ArrayBuffer.
 * @param {Float32Array} samples
 * @param {number} [sampleRate=44100]
 * @param {number} [bitDepth=16]
 * @returns {ArrayBuffer}
 */
export function encodeWAV(samples, sampleRate = 44100, bitDepth = 16) {
  const numChannels = 1;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    const val = s < 0 ? s * 0x8000 : s * 0x7FFF;
    view.setInt16(offset, val, true);
    offset += 2;
  }

  return buffer;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

/**
 * Trigger a browser file download for a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
export function downloadWAV(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------------------------------------------------------------------------
// Internal: schedule a single note event at a precise offline time
// ---------------------------------------------------------------------------

/**
 * Schedule oscillator/noise source + envelope for one note at an exact time.
 * Creates raw nodes scheduled at the specified offline time.
 * @private
 */
function _scheduleNoteEvent(ctx, voiceParams, midiNote, velocity, time, pan, noiseBuffer, destination) {
  const p = voiceParams;
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);

  const adsr = p.adsr ?? {};
  const attack = adsr.attack ?? 0.01;
  const decay = adsr.decay ?? 0.1;
  const sustainLevel = (adsr.sustain ?? 0.6) * velocity;
  const release = adsr.release ?? 0.2;
  const noteDuration = attack + decay + 0.05;

  let source;
  if (p.useNoise) {
    source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
  } else {
    source = ctx.createOscillator();
    source.type = p.waveform ?? 'square';
    source.frequency.setValueAtTime(freq, time);
    source.detune.value = p.detune ?? 0;

    if (p.pitchEnvelope) {
      const pe = p.pitchEnvelope;
      source.frequency.setValueAtTime(pe.startFreq ?? freq, time);
      source.frequency.exponentialRampToValueAtTime(
        Math.max(pe.endFreq ?? freq, 0.01),
        time + (pe.time ?? 0.1)
      );
    }
  }

  const filter = ctx.createBiquadFilter();
  filter.type = p.filter?.type ?? 'lowpass';
  filter.frequency.value = p.filter?.cutoff ?? 4000;
  filter.Q.value = p.filter?.resonance ?? 1;

  const envGain = ctx.createGain();
  envGain.gain.setValueAtTime(0, time);
  envGain.gain.linearRampToValueAtTime(velocity, time + attack);
  envGain.gain.linearRampToValueAtTime(sustainLevel, time + attack + decay);
  envGain.gain.linearRampToValueAtTime(0, time + noteDuration + release);

  const volGain = ctx.createGain();
  volGain.gain.value = p.volume ?? 0.7;

  source.connect(filter);
  filter.connect(envGain);
  envGain.connect(volGain);
  volGain.connect(destination);

  source.start(time);
  source.stop(time + noteDuration + release + 0.01);
}

// ---------------------------------------------------------------------------
// Offline render — supports single pattern or multi-zone song
// ---------------------------------------------------------------------------

/**
 * Render sequencer pattern(s) to a WAV Blob using OfflineAudioContext.
 * Supports multi-zone songs: pass `options.zones` as an array of pattern
 * snapshots (same format as Sequencer.getPattern()). Each zone is rendered
 * sequentially. If no zones are provided, renders the current sequencer state.
 *
 * @param {import('./audio-engine.js').AudioEngine} _audioEngine
 * @param {import('./sequencer.js').Sequencer} sequencer
 * @param {object} [options]
 * @param {number} [options.sampleRate=44100]
 * @param {number} [options.bitDepth=16]
 * @param {boolean} [options.normalize=true]
 * @param {number} [options.loopCount=1]
 * @param {number} [options.bpm=120]
 * @param {Array<object>} [options.zones] - Array of pattern snapshots for multi-zone export.
 * @param {function(number):void} [options.onProgress] - Called with 0-1 fraction.
 * @returns {Promise<Blob>} WAV audio blob.
 */
export async function exportWAV(_audioEngine, sequencer, options = {}) {
  const sampleRate = options.sampleRate ?? 44100;
  const bitDepth = options.bitDepth ?? 16;
  const normalize = options.normalize ?? true;
  const loopCount = Math.max(1, options.loopCount ?? 1);
  const bpm = options.bpm ?? 120;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  // Determine zone data: use provided zones array, or wrap current sequencer as single zone
  const zones = Array.isArray(options.zones) && options.zones.length > 0
    ? options.zones
    : [sequencer.getPattern()];

  const stepsPerBeat = 4;
  const secondsPerStep = 60 / bpm / stepsPerBeat;
  const stepsPerZone = sequencer.steps;
  const totalSteps = zones.length * stepsPerZone * loopCount;
  const duration = totalSteps * secondsPerStep + 1.5; // tail for releases

  if (onProgress) onProgress(0);

  // Create offline context
  const offCtx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);

  // Master chain: compressor → limiter → destination
  const compressor = offCtx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 6;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.15;

  const limiter = offCtx.createDynamicsCompressor();
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.01;

  compressor.connect(limiter);
  limiter.connect(offCtx.destination);

  // Shared noise buffer for drum voices
  const noiseLength = sampleRate * 2;
  const noiseBuffer = offCtx.createBuffer(1, noiseLength, sampleRate);
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseLength; i++) {
    noiseData[i] = Math.random() * 2 - 1;
  }

  // Schedule all note events across all zones and loops
  let scheduledNotes = 0;
  for (let loop = 0; loop < loopCount; loop++) {
    for (let z = 0; z < zones.length; z++) {
      const zoneData = zones[z];
      const zoneGrid = zoneData.grid || [];
      const zoneTracks = zoneData.tracks || [];
      const anySolo = zoneTracks.some((t) => t.soloed);

      for (let s = 0; s < stepsPerZone; s++) {
        const absStep = (loop * zones.length + z) * stepsPerZone + s;
        const time = absStep * secondsPerStep;

        for (let t = 0; t < zoneTracks.length; t++) {
          const track = zoneTracks[t];
          if (track.muted || (anySolo && !track.soloed)) continue;

          const row = zoneGrid[t];
          if (!row || !row[s] || !row[s].active) continue;

          const cell = row[s];
          const preset = resolvePreset(track.instrument);
          const midiNote = noteToMidi(cell.note);
          const velocity = (cell.velocity ?? 0.8) * (track.volume ?? 0.8);

          _scheduleNoteEvent(offCtx, preset, midiNote, velocity, time, track.pan ?? 0, noiseBuffer, compressor);
          scheduledNotes++;
        }
      }
    }
  }

  if (onProgress) onProgress(0.3);

  // Render
  const renderedBuffer = await offCtx.startRendering();

  if (onProgress) onProgress(0.85);

  // Extract mono channel data
  let channelData = renderedBuffer.getChannelData(0);

  // Normalize
  if (normalize) {
    let peak = 0;
    for (let i = 0; i < channelData.length; i++) {
      const abs = Math.abs(channelData[i]);
      if (abs > peak) peak = abs;
    }
    if (peak > 0) {
      const gain = 0.95 / peak;
      for (let i = 0; i < channelData.length; i++) {
        channelData[i] *= gain;
      }
    }
  }

  // Trim trailing silence
  let endSample = channelData.length;
  const minTail = Math.floor(sampleRate * 0.1);
  for (let i = channelData.length - 1; i >= minTail; i--) {
    if (Math.abs(channelData[i]) > 0.0001) {
      endSample = Math.min(channelData.length, i + minTail);
      break;
    }
  }
  const trimmed = channelData.subarray(0, endSample);

  const wavBuffer = encodeWAV(trimmed, sampleRate, bitDepth);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });

  if (onProgress) onProgress(1);

  return blob;
}