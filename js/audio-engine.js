/**
 * 16-Bit Audio Engine
 * Web Audio API module for authentic SNES/Genesis-era chiptune synthesis.
 * All sound generation uses native Web Audio nodes — no external samples.
 * @module audio-engine
 */

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Convert a MIDI note number to frequency in Hz.
 * @param {number} midi - MIDI note (0-127).
 * @returns {number} Frequency in Hz.
 */
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert a note name (e.g. 'C4', 'F#3', 'Bb5') to a MIDI note number.
 * @param {string} name - Note name in scientific pitch notation.
 * @returns {number} MIDI note number (0-127). Returns 60 (middle C) on parse failure.
 */
function noteToMidi(name) {
  if (typeof name !== 'string') return 60;
  const match = name.trim().match(/^([A-Ga-g])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return 60;

  const noteMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let semitone = noteMap[match[1].toUpperCase()];
  const accidental = match[2];
  if (accidental.startsWith('#')) semitone += accidental.length;
  else if (accidental.startsWith('b')) semitone -= accidental.length;

  const octave = parseInt(match[3], 10);
  const midi = (octave + 1) * 12 + semitone;
  return Math.max(0, Math.min(127, midi));
}

/**
 * Create a white noise AudioBuffer suitable for drum/percussion synthesis.
 * @param {AudioContext} ctx
 * @param {number} duration - Buffer length in seconds.
 * @returns {AudioBuffer}
 */
function createNoiseBuffer(ctx, duration = 2) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// BitcrusherNode — reduces bit depth to emulate low-resolution DACs
// ---------------------------------------------------------------------------

/**
 * A bit-crusher effect built with a ScriptProcessorNode (fallback) or
 * AudioWorklet when available. Reduces bit depth and optionally down-samples
 * to produce the characteristic gritty 8/16-bit console timbre.
 */
class BitcrusherNode {
  /**
   * @param {AudioContext} ctx
   * @param {object} [opts]
   * @param {number} [opts.bits=16] - Target bit depth (1-16).
   * @param {number} [opts.rateDivisor=1] - Sample-rate division factor (1 = none).
   */
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.bits = opts.bits ?? 16;
    this.rateDivisor = opts.rateDivisor ?? 1;

    // Use ScriptProcessor as broad-compat fallback (deprecated but universal).
    this._node = ctx.createScriptProcessor(256, 1, 1);
    this._node.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      const output = e.outputBuffer.getChannelData(0);
      const step = Math.pow(0.5, this.bits);
      let lastSample = 0;
      for (let i = 0; i < input.length; i++) {
        if (this.rateDivisor > 1 && i % this.rateDivisor !== 0) {
          output[i] = lastSample;
        } else {
          lastSample = step * Math.floor(input[i] / step + 0.5);
          output[i] = lastSample;
        }
      }
    };

    /** @type {AudioNode} Input connection point. */
    this.input = this._node;
    /** @type {AudioNode} Output connection point. */
    this.output = this._node;
  }

  /** Connect the bitcrusher output to a destination node. */
  connect(dest) {
    this.output.connect(dest);
  }

  disconnect() {
    this._node.disconnect();
  }

  /**
   * Update bit depth at runtime.
   * @param {number} bits
   */
  setBits(bits) {
    this.bits = Math.max(1, Math.min(16, bits));
  }
}

// ---------------------------------------------------------------------------
// SynthVoice
// ---------------------------------------------------------------------------

/**
 * A single synthesizer voice producing 16-bit-style tones.
 * Supports square, sawtooth, triangle, sine, and noise waveforms,
 * an ADSR amplitude envelope, a resonant low-pass filter, and an
 * inline bitcrusher for DAC emulation.
 */
export class SynthVoice {
  /**
   * @param {AudioContext} ctx
   * @param {object} [params] - Voice configuration.
   * @param {string} [params.waveform='square'] - Oscillator type.
   * @param {number} [params.detune=0] - Detune in cents.
   * @param {object} [params.adsr] - Envelope times in seconds.
   * @param {number} [params.adsr.attack=0.01]
   * @param {number} [params.adsr.decay=0.1]
   * @param {number} [params.adsr.sustain=0.6]
   * @param {number} [params.adsr.release=0.2]
   * @param {object} [params.filter] - Low-pass filter settings.
   * @param {number} [params.filter.cutoff=4000]
   * @param {number} [params.filter.resonance=1]
   * @param {string} [params.filter.type='lowpass']
   * @param {object} [params.bitcrusher] - Bitcrusher options.
   * @param {number} [params.bitcrusher.bits=16]
   * @param {number} [params.bitcrusher.rateDivisor=1]
   * @param {number} [params.volume=0.7]
   * @param {boolean} [params.useNoise=false] - Use noise buffer instead of oscillator.
   * @param {object} [params.pitchEnvelope] - Pitch sweep for kick drums etc.
   * @param {number} [params.pitchEnvelope.startFreq]
   * @param {number} [params.pitchEnvelope.endFreq]
   * @param {number} [params.pitchEnvelope.time]
   */
  constructor(ctx, params = {}) {
    /** @type {AudioContext} */
    this.ctx = ctx;
    this.params = params;

    // Amplitude envelope gain
    this.envGain = ctx.createGain();
    this.envGain.gain.value = 0;

    // Master volume for this voice
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = params.volume ?? 0.7;

    // Filter
    this.filter = ctx.createBiquadFilter();
    this.filter.type = params.filter?.type ?? 'lowpass';
    this.filter.frequency.value = params.filter?.cutoff ?? 4000;
    this.filter.Q.value = params.filter?.resonance ?? 1;

    // Bitcrusher
    this.crusher = new BitcrusherNode(ctx, {
      bits: params.bitcrusher?.bits ?? 16,
      rateDivisor: params.bitcrusher?.rateDivisor ?? 1,
    });

    // Noise buffer (shared across voices via static cache)
    if (!SynthVoice._noiseBuffer) {
      SynthVoice._noiseBuffer = createNoiseBuffer(ctx);
    }

    // Internal state
    /** @type {OscillatorNode|AudioBufferSourceNode|null} */
    this._source = null;
    this._active = false;

    // Signal chain: source -> filter -> envGain -> crusher -> voiceGain
    this.filter.connect(this.envGain);
    this.envGain.connect(this.crusher.input);
    this.crusher.connect(this.voiceGain);

    /** @type {AudioNode} Public output for routing into mixer channels. */
    this.output = this.voiceGain;
  }

  /**
   * Trigger the voice at a given note and velocity.
   * @param {number} note - MIDI note number.
   * @param {number} [velocity=1] - 0-1 velocity.
   * @param {number} [duration] - If provided, auto-release after this many seconds.
   *   When omitted the note sustains until release() is called explicitly.
   */
  trigger(note, velocity = 1, duration) {
    const now = this.ctx.currentTime;
    const p = this.params;

    // Stop any previous source
    this._stopSource(now);

    const freq = midiToFreq(note);

    if (p.useNoise) {
      const src = this.ctx.createBufferSource();
      src.buffer = SynthVoice._noiseBuffer;
      src.loop = true;
      src.connect(this.filter);
      src.start(now);
      this._source = src;
    } else {
      const osc = this.ctx.createOscillator();
      osc.type = p.waveform ?? 'square';
      osc.frequency.value = freq;
      osc.detune.value = p.detune ?? 0;

      // Pitch envelope (kick drum drop, FX sweeps)
      if (p.pitchEnvelope) {
        const pe = p.pitchEnvelope;
        osc.frequency.setValueAtTime(pe.startFreq ?? freq, now);
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(pe.endFreq ?? freq, 0.01),
          now + (pe.time ?? 0.1)
        );
      }

      osc.connect(this.filter);
      osc.start(now);
      this._source = osc;
    }

    // ADSR envelope
    const adsr = p.adsr ?? {};
    const attack = adsr.attack ?? 0.01;
    const decay = adsr.decay ?? 0.1;
    const sustainLevel = (adsr.sustain ?? 0.6) * velocity;
    const releaseTime = adsr.release ?? 0.2;

    this.envGain.gain.cancelScheduledValues(now);
    this.envGain.gain.setValueAtTime(0, now);
    this.envGain.gain.linearRampToValueAtTime(velocity, now + attack);
    this.envGain.gain.linearRampToValueAtTime(sustainLevel, now + attack + decay);

    // Auto-release: schedule the release phase after `duration` seconds so
    // the note doesn't sustain forever when used in a step sequencer.
    if (typeof duration === 'number' && duration > 0) {
      const releaseStart = now + duration;
      this.envGain.gain.setValueAtTime(sustainLevel, releaseStart);
      this.envGain.gain.linearRampToValueAtTime(0, releaseStart + releaseTime);
      this._stopSource(releaseStart + releaseTime + 0.01);
    }

    this._active = true;
  }

  /**
   * Release the voice (enter release phase of ADSR).
   */
  release() {
    if (!this._active) return;
    const now = this.ctx.currentTime;
    const release = this.params.adsr?.release ?? 0.2;

    this.envGain.gain.cancelScheduledValues(now);
    this.envGain.gain.setValueAtTime(this.envGain.gain.value, now);
    this.envGain.gain.linearRampToValueAtTime(0, now + release);

    // Schedule source stop after release completes
    this._stopSource(now + release + 0.01);
    this._active = false;
  }

  /**
   * Immediately silence and disconnect the voice.
   */
  kill() {
    const now = this.ctx.currentTime;
    this.envGain.gain.cancelScheduledValues(now);
    this.envGain.gain.setValueAtTime(0, now);
    this._stopSource(now);
    this._active = false;
  }

  /**
   * Set master volume for this voice.
   * @param {number} vol - 0-1.
   */
  setVolume(vol) {
    this.voiceGain.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.01);
  }

  /**
   * Update filter cutoff in real time.
   * @param {number} freq - Cutoff in Hz.
   */
  setCutoff(freq) {
    this.filter.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.01);
  }

  /** @private */
  _stopSource(time) {
    try {
      this._source?.stop(time);
    } catch (_) {
      // Already stopped or not started
    }
  }
}

/** @private Shared noise buffer across all SynthVoice instances. */
SynthVoice._noiseBuffer = null;

// ---------------------------------------------------------------------------
// MixerChannel
// ---------------------------------------------------------------------------

/**
 * A mixer channel strip providing volume, pan, mute, and solo controls.
 * Routes between an instrument voice and the master bus.
 */
export class MixerChannel {
  /**
   * @param {AudioContext} ctx
   * @param {string} [name=''] - Channel label.
   */
  constructor(ctx, name = '') {
    /** @type {AudioContext} */
    this.ctx = ctx;
    /** @type {string} */
    this.name = name;

    this.inputGain = ctx.createGain();
    this.panNode = ctx.createStereoPanner();
    this.outputGain = ctx.createGain();

    // Signal chain: input -> pan -> output
    this.inputGain.connect(this.panNode);
    this.panNode.connect(this.outputGain);

    /** @type {AudioNode} Connect instrument voices here. */
    this.input = this.inputGain;
    /** @type {AudioNode} Connect to master or another bus. */
    this.output = this.outputGain;

    /** @type {boolean} */
    this.muted = false;
    /** @type {boolean} */
    this.soloed = false;

    this._volume = 1;
    this._pan = 0;
  }

  /**
   * Set channel volume.
   * @param {number} vol - 0-1.
   */
  set volume(vol) {
    this._volume = Math.max(0, Math.min(1, vol));
    this._updateOutput();
  }

  /** @returns {number} Current volume (0-1). */
  get volume() {
    return this._volume;
  }

  /**
   * Set stereo pan position.
   * @param {number} val - -1 (left) to 1 (right).
   */
  set pan(val) {
    this._pan = Math.max(-1, Math.min(1, val));
    this.panNode.pan.setTargetAtTime(this._pan, this.ctx.currentTime, 0.01);
  }

  /** @returns {number} Current pan (-1 to 1). */
  get pan() {
    return this._pan;
  }

  /**
   * Mute or unmute the channel.
   * @param {boolean} state
   */
  set mute(state) {
    this.muted = !!state;
    this._updateOutput();
  }

  /** @returns {boolean} */
  get mute() {
    return this.muted;
  }

  /**
   * Solo or unsolo the channel.
   * @param {boolean} state
   */
  set solo(state) {
    this.soloed = !!state;
    this._updateOutput();
  }

  /** @returns {boolean} */
  get solo() {
    return this.soloed;
  }

  /**
   * Connect this channel's output to a destination node.
   * @param {AudioNode} destination
   */
  connect(destination) {
    this.output.connect(destination);
  }

  /**
   * Disconnect this channel's output.
   */
  disconnect() {
    this.output.disconnect();
  }

  /** @private Apply mute/solo state to the output gain. */
  _updateOutput() {
    const target = this.muted ? 0 : this._volume;
    this.outputGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
  }
}

// ---------------------------------------------------------------------------
// InstrumentPresets
// ---------------------------------------------------------------------------

/**
 * Built-in 16-bit instrument preset configurations.
 * Each key maps to a parameter object accepted by {@link SynthVoice}.
 * @type {Record<string, object>}
 */
export const InstrumentPresets = {
  /** Square-wave lead with slight detune for chorus thickness. */
  lead: {
    waveform: 'square',
    detune: 8,
    adsr: { attack: 0.01, decay: 0.15, sustain: 0.5, release: 0.2 },
    filter: { cutoff: 6000, resonance: 2, type: 'lowpass' },
    bitcrusher: { bits: 12, rateDivisor: 1 },
    volume: 0.6,
  },

  /** Sawtooth bass with warm low-pass filtering. */
  bass: {
    waveform: 'sawtooth',
    detune: 0,
    adsr: { attack: 0.005, decay: 0.2, sustain: 0.7, release: 0.15 },
    filter: { cutoff: 1200, resonance: 3, type: 'lowpass' },
    bitcrusher: { bits: 14, rateDivisor: 1 },
    volume: 0.75,
  },

  /** Triangle-wave pad with slow attack for lush chords. */
  pad: {
    waveform: 'triangle',
    detune: 12,
    adsr: { attack: 0.4, decay: 0.3, sustain: 0.8, release: 0.6 },
    filter: { cutoff: 3500, resonance: 1, type: 'lowpass' },
    bitcrusher: { bits: 14, rateDivisor: 1 },
    volume: 0.5,
  },

  /** Sine-wave kick drum with pitch-envelope drop. */
  'drums-kick': {
    waveform: 'sine',
    adsr: { attack: 0.001, decay: 0.25, sustain: 0, release: 0.1 },
    filter: { cutoff: 8000, resonance: 0, type: 'lowpass' },
    bitcrusher: { bits: 12, rateDivisor: 2 },
    pitchEnvelope: { startFreq: 800, endFreq: 40, time: 0.12 },
    volume: 0.9,
  },

  /** Noise-burst snare with bandpass character. */
  'drums-snare': {
    useNoise: true,
    adsr: { attack: 0.001, decay: 0.12, sustain: 0, release: 0.05 },
    filter: { cutoff: 3000, resonance: 4, type: 'bandpass' },
    bitcrusher: { bits: 10, rateDivisor: 2 },
    volume: 0.7,
  },

  /** Short high-frequency noise burst for closed hi-hat. */
  'drums-hihat': {
    useNoise: true,
    adsr: { attack: 0.001, decay: 0.04, sustain: 0, release: 0.02 },
    filter: { cutoff: 9000, resonance: 1, type: 'highpass' },
    bitcrusher: { bits: 8, rateDivisor: 3 },
    volume: 0.45,
  },

  /** Square-wave arpeggio voice with fast decay. */
  arp: {
    waveform: 'square',
    detune: 0,
    adsr: { attack: 0.005, decay: 0.08, sustain: 0.1, release: 0.05 },
    filter: { cutoff: 5000, resonance: 2, type: 'lowpass' },
    bitcrusher: { bits: 12, rateDivisor: 1 },
    volume: 0.5,
  },

  /** Sawtooth FX voice with high-resonance filter sweep. */
  fx: {
    waveform: 'sawtooth',
    detune: 0,
    adsr: { attack: 0.05, decay: 0.4, sustain: 0.3, release: 0.5 },
    filter: { cutoff: 800, resonance: 15, type: 'lowpass' },
    bitcrusher: { bits: 10, rateDivisor: 1 },
    volume: 0.55,
  },
};

// ---------------------------------------------------------------------------
// AudioEngine
// ---------------------------------------------------------------------------

/**
 * Main audio engine managing transport, scheduling, and voice allocation
 * for a 16-bit style music sequencer.
 */
export class AudioEngine {
  constructor() {
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.masterGain = null;
    /** @type {DynamicsCompressorNode|null} */
    this.compressor = null;
    /** @type {AnalyserNode|null} */
    this.analyser = null;

    /** @type {number} Beats per minute. */
    this.bpm = 120;
    /** @type {number} Steps per beat (16th notes). */
    this.stepsPerBeat = 4;
    /** @type {number} Total steps in the current pattern. */
    this.totalSteps = 64;

    /** @type {boolean} */
    this.playing = false;
    /** @type {number} Current step index. */
    this._currentStep = 0;
    /** @type {number|null} Scheduler timer ID. */
    this._timerID = null;

    /**
     * Scheduled note events keyed by step.
     * @type {Map<number, Array<{instrument: string, note: number, velocity: number}>>}
     */
    this._schedule = new Map();

    /**
     * Active voice pool keyed by instrument name.
     * @type {Map<string, SynthVoice>}
     */
    this._voices = new Map();

    /**
     * Mixer channels keyed by instrument name.
     * @type {Map<string, MixerChannel>}
     */
    this._channels = new Map();

    /** Lookahead window for scheduler (seconds). */
    this._lookahead = 0.1;
    /** Scheduler tick interval (ms). */
    this._tickInterval = 25;
    /** Next note time in AudioContext seconds. */
    this._nextNoteTime = 0;
  }

  /**
   * Initialise the Web Audio graph. Must be called from a user gesture.
   * Creates AudioContext, master gain, compressor, and analyser.
   * @returns {Promise<void>}
   */
  async init() {
    if (this.ctx) return;

    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master gain
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.8;

    // Compressor to tame peaks from layered chiptune voices
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -12;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.15;

    // Analyser for visualisation hooks
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;

    // Chain: masterGain -> compressor -> analyser -> destination
    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Pre-create mixer channels for every built-in preset
    for (const name of Object.keys(InstrumentPresets)) {
      this._ensureChannel(name);
    }
  }

  /**
   * Update the playback tempo.
   * @param {number} bpm - New BPM value.
   */
  setBPM(bpm) {
    this.bpm = Math.max(20, Math.min(300, bpm));
  }

  /**
   * Start transport playback.
   */
  play() {
    if (!this.ctx || this.playing) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    this.playing = true;
    this._nextNoteTime = this.ctx.currentTime + 0.05;
    this._schedulerTick();
  }

  /**
   * Pause transport (keeps current step position).
   */
  pause() {
    this.playing = false;
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
  }

  /**
   * Stop transport and reset step counter to zero.
   */
  stop() {
    this.pause();
    this._currentStep = 0;
    // Release all active voices
    for (const voice of this._voices.values()) {
      voice.kill();
    }
  }

  /**
   * Get the current playback step.
   * @returns {number} Zero-based step index.
   */
  getCurrentStep() {
    return this._currentStep;
  }

  /**
   * Schedule a note event at a specific step.
   * @param {number} step - Step index (0-based).
   * @param {string} instrument - Preset name from {@link InstrumentPresets}.
   * @param {number} note - MIDI note number.
   * @param {number} [velocity=1] - Note velocity (0-1).
   */
  scheduleNote(step, instrument, note, velocity = 1) {
    if (!this._schedule.has(step)) {
      this._schedule.set(step, []);
    }
    this._schedule.get(step).push({ instrument, note, velocity });
  }

  /**
   * Clear all scheduled notes.
   */
  clearSchedule() {
    this._schedule.clear();
  }

  /**
   * Immediately trigger a note (for live input and sequencer playback).
   * Bypasses the internal scheduler and fires the voice directly.
   * @param {object} params
   * @param {string} params.instrument - Preset name from {@link InstrumentPresets}.
   * @param {string|number} params.note - Note name ('C4') or MIDI number.
   * @param {number} [params.velocity=0.8] - Note velocity (0-1).
   * @param {number} [params.pan=0] - Stereo pan (-1 to 1).
   * @param {number} [params.duration] - Auto-release after this many seconds.
   *   When provided the note envelope ramps to zero and the source stops
   *   automatically — essential for step-sequencer playback so notes don't
   *   sustain forever. Omit for live/held input.
   */
  triggerNote({ instrument, note, velocity = 0.8, pan = 0, duration }) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();

    // Resolve note name to MIDI number
    const midi = typeof note === 'string' ? noteToMidi(note) : note;

    const voice = this._getOrCreateVoice(instrument);
    if (!voice) return;

    // Apply pan via the mixer channel
    const channel = this._channels.get(instrument);
    if (channel) {
      channel.pan = pan;
    }

    voice.release();
    voice.trigger(midi, velocity, duration);
  }

  /**
   * Resume the AudioContext if suspended (call on user gesture).
   */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Retrieve the mixer channel for a given instrument.
   * @param {string} instrument - Preset name.
   * @returns {MixerChannel|undefined}
   */
  getChannel(instrument) {
    return this._channels.get(instrument);
  }

  /**
   * Get the analyser node for external visualisation.
   * @returns {AnalyserNode|null}
   */
  getAnalyser() {
    return this.analyser;
  }

  // -------------------------------------------------------------------------
  // Internal scheduler
  // -------------------------------------------------------------------------

  /** @private Advance the scheduler by one tick. */
  _schedulerTick() {
    if (!this.playing) return;

    while (this._nextNoteTime < this.ctx.currentTime + this._lookahead) {
      this._playStep(this._currentStep, this._nextNoteTime);
      this._advanceStep();
    }

    this._timerID = setTimeout(() => this._schedulerTick(), this._tickInterval);
  }

  /** @private Move to the next step and wrap around. */
  _advanceStep() {
    const secondsPerStep = 60 / this.bpm / this.stepsPerBeat;
    this._nextNoteTime += secondsPerStep;
    this._currentStep = (this._currentStep + 1) % this.totalSteps;
  }

  /**
   * Fire all note events scheduled for a given step.
   * @param {number} step
   * @param {number} time - AudioContext time to trigger at.
   * @private
   */
  _playStep(step, time) {
    const events = this._schedule.get(step);
    if (!events) return;

    for (const evt of events) {
      const voice = this._getOrCreateVoice(evt.instrument);
      if (!voice) continue;

      // Release any currently sounding note on this voice, then trigger
      voice.release();
      // Small offset so release and trigger don't collide at identical sample
      voice.trigger(evt.note, evt.velocity);
    }
  }

  /**
   * Lazily allocate a SynthVoice for an instrument preset.
   * @param {string} name - Preset key.
   * @returns {SynthVoice|null}
   * @private
   */
  _getOrCreateVoice(name) {
    if (this._voices.has(name)) return this._voices.get(name);

    const preset = InstrumentPresets[name];
    if (!preset) {
      console.warn(`[AudioEngine] Unknown instrument preset: "${name}"`);
      return null;
    }

    const voice = new SynthVoice(this.ctx, preset);
    const channel = this._ensureChannel(name);
    voice.output.connect(channel.input);

    this._voices.set(name, voice);
    return voice;
  }

  /**
   * Ensure a MixerChannel exists for the named instrument and is routed
   * to the master bus.
   * @param {string} name
   * @returns {MixerChannel}
   * @private
   */
  _ensureChannel(name) {
    if (this._channels.has(name)) return this._channels.get(name);

    const ch = new MixerChannel(this.ctx, name);
    ch.connect(this.masterGain);
    this._channels.set(name, ch);
    return ch;
  }
}