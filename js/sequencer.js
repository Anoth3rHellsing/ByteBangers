/**
 * ByteBangers Step Sequencer Module
 * Manages the step grid, track configuration, and pattern serialization.
 */

const DEFAULT_STEPS = 16;
const DEFAULT_TRACKS = 8;

const DEFAULT_TRACK_CONFIGS = [
  { name: 'Lead', instrument: 'lead', volume: 0.8, pan: 0, muted: false, soloed: false },
  { name: 'Bass', instrument: 'bass', volume: 0.9, pan: 0, muted: false, soloed: false },
  { name: 'Pad', instrument: 'pad', volume: 0.6, pan: -0.3, muted: false, soloed: false },
  { name: 'Arp', instrument: 'arp', volume: 0.7, pan: 0.3, muted: false, soloed: false },
  { name: 'Kick', instrument: 'drums-kick', volume: 1.0, pan: 0, muted: false, soloed: false },
  { name: 'Snare', instrument: 'drums-snare', volume: 0.9, pan: 0, muted: false, soloed: false },
  { name: 'HiHat', instrument: 'drums-hihat', volume: 0.7, pan: 0.2, muted: false, soloed: false },
  { name: 'FX', instrument: 'fx', volume: 0.5, pan: 0, muted: false, soloed: false },
];

export class TrackConfig {
  constructor(data = {}) {
    this.name = data.name || 'Track';
    this.instrument = data.instrument || 'sine';
    this.volume = typeof data.volume === 'number' ? data.volume : 0.8;
    this.pan = typeof data.pan === 'number' ? data.pan : 0;
    this.muted = !!data.muted;
    this.soloed = !!data.soloed;
  }

  clone() {
    return new TrackConfig({ ...this });
  }
}

export class Sequencer {
  constructor(steps = DEFAULT_STEPS, tracks = DEFAULT_TRACKS) {
    this.steps = steps;
    this.trackCount = tracks;
    this.grid = [];
    this.tracks = [];

    this._initDefaults();
  }

  _createCell() {
    return { active: false, note: 'C4', velocity: 0.8 };
  }

  _initDefaults() {
    // Initialize tracks
    for (let t = 0; t < this.trackCount; t++) {
      const cfg = DEFAULT_TRACK_CONFIGS[t] || { name: `Track ${t + 1}` };
      this.tracks.push(new TrackConfig(cfg));
    }

    // Initialize grid
    for (let t = 0; t < this.trackCount; t++) {
      const row = [];
      for (let s = 0; s < this.steps; s++) {
        row.push(this._createCell());
      }
      this.grid.push(row);
    }
  }

  /**
   * Toggle a cell's active state.
   * @returns {boolean} The new active state.
   */
  toggleCell(track, step) {
    if (!this._inBounds(track, step)) return false;
    this.grid[track][step].active = !this.grid[track][step].active;
    return this.grid[track][step].active;
  }

  /**
   * Set explicit cell data.
   */
  setCell(track, step, data) {
    if (!this._inBounds(track, step)) return;
    if (!data || typeof data !== 'object') return;
    const cell = this.grid[track][step];
    if (data.active !== undefined) cell.active = !!data.active;
    if (data.note !== undefined) cell.note = String(data.note);
    if (data.velocity !== undefined) {
      const v = Number(data.velocity);
      cell.velocity = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : cell.velocity;
    }
  }

  /**
   * Set note value for a cell.
   */
  setNote(track, step, note) {
    if (!this._inBounds(track, step)) return;
    this.grid[track][step].note = String(note);
  }

  /**
   * Set velocity for a cell.
   */
  setVelocity(track, step, velocity) {
    if (!this._inBounds(track, step)) return;
    this.grid[track][step].velocity = Math.max(0, Math.min(1, Number(velocity)));
  }

  /**
   * Get a specific cell.
   */
  getCell(track, step) {
    if (!this._inBounds(track, step)) return null;
    return this.grid[track][step];
  }

  /**
   * Clear all steps in a single track.
   */
  clearTrack(track) {
    if (track < 0 || track >= this.trackCount) return;
    for (let s = 0; s < this.steps; s++) {
      this.grid[track][s] = this._createCell();
    }
  }

  /**
   * Clear entire grid.
   */
  clearAll() {
    for (let t = 0; t < this.trackCount; t++) {
      this.clearTrack(t);
    }
  }

  /**
   * Update track configuration.
   */
  updateTrack(track, props) {
    if (track < 0 || track >= this.trackCount) return;
    Object.assign(this.tracks[track], props);
  }

  /**
   * Get serializable pattern data.
   */
  getPattern() {
    return {
      steps: this.steps,
      trackCount: this.trackCount,
      tracks: this.tracks.map((t) => ({
        name: t.name,
        instrument: t.instrument,
        volume: t.volume,
        pan: t.pan,
        muted: t.muted,
        soloed: t.soloed,
      })),
      grid: this.grid.map((row) =>
        row.map((cell) => ({
          active: cell.active,
          note: cell.note,
          velocity: cell.velocity,
        }))
      ),
    };
  }

  /**
   * Load pattern from serialized data.
   */
  loadPattern(data) {
    if (!data || !Array.isArray(data.grid)) return false;

    // Resize if needed
    if (data.steps && data.steps !== this.steps) {
      this.steps = data.steps;
    }
    if (data.trackCount && data.trackCount !== this.trackCount) {
      this.trackCount = data.trackCount;
    }

    // Rebuild tracks
    this.tracks = [];
    for (let t = 0; t < this.trackCount; t++) {
      const src = data.tracks && data.tracks[t];
      this.tracks.push(new TrackConfig(src || {}));
    }

    // Rebuild grid
    this.grid = [];
    for (let t = 0; t < this.trackCount; t++) {
      const row = [];
      for (let s = 0; s < this.steps; s++) {
        const src = data.grid[t] && data.grid[t][s];
        row.push(src ? { ...src } : this._createCell());
      }
      this.grid.push(row);
    }

    return true;
  }

  _inBounds(track, step) {
    return track >= 0 && track < this.trackCount && step >= 0 && step < this.steps;
  }
}