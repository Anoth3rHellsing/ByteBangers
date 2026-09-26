/**
 * ByteBangers Main Application Controller
 * Wires AudioEngine, Sequencer, and UI together.
 * Supports multi-zone song arrangement (up to 99 zones).
 */

import { AudioEngine } from './audio-engine.js';
import { Sequencer } from './sequencer.js';
import { exportWAV, downloadWAV } from './export.js';

const STORAGE_KEY = 'bytebangers-song';
const MIN_BPM = 60;
const MAX_BPM = 200;
const DEFAULT_BPM = 120;
const MAX_ZONES = 99;

const INSTRUMENTS = [
  'lead', 'bass', 'pad', 'arp',
  'drums-kick', 'drums-snare', 'drums-hihat', 'fx'
];

class ByteBangersApp {
  constructor() {
    this.audio = new AudioEngine();
    this.sequencer = new Sequencer(16, 8);
    this.bpm = DEFAULT_BPM;
    this.isPlaying = false;
    this.currentStep = 0;
    this.timerID = null;
    this.songName = 'Untitled';
    this._lastPlayedZone = -1; // Zone currently sounding during playback (-1 = none)

    // Zone system: array of pattern snapshots, one per zone
    this.zones = [this.sequencer.getPattern()]; // Zone 1 starts with default
    this.activeZone = 0; // 0-indexed (display as 1-indexed)

    // DOM references
    this.gridEl = null;
    this.playheadEls = [];
    this.stepCells = [];
    this.trackControls = [];
    this.statusBar = null;
    this.bpmInput = null;
    this.bpmSlider = null;
    this.playBtn = null;
    this.stopBtn = null;
    this.clearBtn = null;
    this.exportBtn = null;
    this.progressBar = null;
    this.zoneBarEl = null;

    this._boundKeyDown = this._onKeyDown.bind(this);
  }

  async init() {
    this._cacheDOM();
    this._renderGrid();
    this._renderMixer();
    this._renderZoneBar();
    this._bindTransport();
    this._bindKeyboard();
    this._loadFromStorage();
    this._updateStatus();

    // CRITICAL FIX: AudioContext must be created AND resumed inside a user gesture.
    const initAudio = async () => {
      if (!this.audio.ctx) {
        await this.audio.init();
      }
      if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
        await this.audio.ctx.resume();
      }
    };
    document.addEventListener('pointerdown', initAudio);
    document.addEventListener('keydown', initAudio);
  }

  /* ------------------------------------------------------------------ */
  /*  DOM CACHING                                                        */
  /* ------------------------------------------------------------------ */

  _cacheDOM() {
    this.gridEl = document.getElementById('rw-sequencer-grid');
    this.statusBar = document.getElementById('rw-status-bar');
    this.bpmInput = document.getElementById('rw-bpm-input');
    this.bpmSlider = document.getElementById('rw-bpm-slider');
    this.playBtn = document.getElementById('rw-play-btn');
    this.stopBtn = document.getElementById('rw-stop-btn');
    this.clearBtn = document.getElementById('rw-clear-btn');
    this.exportBtn = document.getElementById('rw-export-btn');
    this.progressBar = document.getElementById('rw-export-progress');
    this.zoneBarEl = document.getElementById('rw-zone-bar');
  }

  /* ------------------------------------------------------------------ */
  /*  ZONE BAR                                                           */
  /* ------------------------------------------------------------------ */

  _renderZoneBar() {
    if (!this.zoneBarEl) return;
    this.zoneBarEl.innerHTML = '';

    // Zone label
    const label = document.createElement('span');
    label.className = 'zone-label rw-label';
    label.textContent = 'ZONES';
    this.zoneBarEl.appendChild(label);

    // Zone buttons container
    const btnContainer = document.createElement('div');
    btnContainer.className = 'zone-buttons';
    btnContainer.id = 'rw-zone-buttons';
    this.zoneBarEl.appendChild(btnContainer);

    // Add zone button
    const addBtn = document.createElement('button');
    addBtn.className = 'rw-btn rw-btn-outline zone-add-btn';
    addBtn.type = 'button';
    addBtn.textContent = '+ Zone';
    addBtn.setAttribute('aria-label', 'Add new zone');
    addBtn.addEventListener('click', () => this._addZone());
    this.zoneBarEl.appendChild(addBtn);

    // Remove zone button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'rw-btn rw-btn-ghost zone-remove-btn';
    removeBtn.type = 'button';
    removeBtn.textContent = '−';
    removeBtn.setAttribute('aria-label', 'Remove current zone');
    removeBtn.addEventListener('click', () => this._removeZone());
    this.zoneBarEl.appendChild(removeBtn);

    this._renderZoneButtons();
  }

  _renderZoneButtons() {
    const container = document.getElementById('rw-zone-buttons');
    if (!container) return;
    container.innerHTML = '';

    for (let i = 0; i < this.zones.length; i++) {
      const btn = document.createElement('button');
      btn.className = 'zone-btn';
      btn.type = 'button';
      btn.textContent = String(i + 1);
      btn.dataset.zone = i;
      btn.setAttribute('aria-label', `Zone ${i + 1}`);
      if (i === this.activeZone) {
        btn.classList.add('rw-active');
      }
      btn.addEventListener('click', () => this._switchZone(i));
      container.appendChild(btn);
    }
  }

  /**
   * Highlight the zone that is currently SOUNDING during playback.
   * Uses a dedicated `zone-play` class so it never collides with the
   * `rw-active` class that marks the zone being EDITED.
   */
  _updatePlaybackZoneHighlight(zoneIndex) {
    const btns = document.querySelectorAll('.zone-btn');
    btns.forEach((b, i) => b.classList.toggle('zone-play', this.isPlaying && i === zoneIndex));
  }

  _saveCurrentZone() {
    this.zones[this.activeZone] = this.sequencer.getPattern();
  }

  _loadZone(index) {
    const data = this.zones[index];
    if (data) {
      this.sequencer.loadPattern(data);
      this._updateGridFromPattern();
      this._syncMixerUI();
    }
  }

  _switchZone(index) {
    if (index < 0 || index >= this.zones.length || index === this.activeZone) return;
    // Save current zone before switching
    this._saveCurrentZone();
    this.activeZone = index;
    this._loadZone(index);
    this._renderZoneButtons();
    this._updateStatus();
    this._autoSave();
  }

  _addZone() {
    if (this.zones.length >= MAX_ZONES) {
      this._flashStatus(`Max ${MAX_ZONES} zones reached`);
      return;
    }
    // Save current zone first
    this._saveCurrentZone();
    // Create a new empty zone with same track config
    const newSequencer = new Sequencer(16, 8);
    // Copy track configs from current
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const src = this.sequencer.tracks[t];
      newSequencer.updateTrack(t, {
        name: src.name,
        instrument: src.instrument,
        volume: src.volume,
        pan: src.pan,
      });
    }
    this.zones.push(newSequencer.getPattern());
    this.activeZone = this.zones.length - 1;
    this._loadZone(this.activeZone);
    this._renderZoneButtons();
    this._updateStatus();
    this._autoSave();
  }

  _removeZone() {
    if (this.zones.length <= 1) {
      this._flashStatus('Need at least 1 zone');
      return;
    }
    this.zones.splice(this.activeZone, 1);
    this.activeZone = Math.min(this.activeZone, this.zones.length - 1);
    this._loadZone(this.activeZone);
    this._renderZoneButtons();
    this._updateStatus();
    this._autoSave();
  }

  /* ------------------------------------------------------------------ */
  /*  GRID RENDERING                                                     */
  /* ------------------------------------------------------------------ */

  _renderGrid() {
    if (!this.gridEl) return;
    this.gridEl.innerHTML = '';
    this.stepCells = [];
    this.playheadEls = [];

    const headerRow = document.createElement('div');
    headerRow.className = 'rw-grid-header';
    const cornerLabel = document.createElement('div');
    cornerLabel.className = 'rw-grid-corner';
    headerRow.appendChild(cornerLabel);

    for (let s = 0; s < this.sequencer.steps; s++) {
      const colHeader = document.createElement('div');
      colHeader.className = 'rw-step-indicator';
      colHeader.dataset.step = s;
      colHeader.textContent = s + 1;
      headerRow.appendChild(colHeader);
      this.playheadEls.push(colHeader);
    }
    this.gridEl.appendChild(headerRow);

    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const row = [];
      const trackRow = document.createElement('div');
      trackRow.className = 'rw-grid-row';
      trackRow.dataset.track = t;

      const label = document.createElement('div');
      label.className = 'rw-track-label';
      label.textContent = this.sequencer.tracks[t].name;
      trackRow.appendChild(label);

      for (let s = 0; s < this.sequencer.steps; s++) {
        const cell = document.createElement('button');
        cell.className = 'rw-grid-cell';
        cell.dataset.track = t;
        cell.dataset.step = s;
        cell.setAttribute('aria-label', `${this.sequencer.tracks[t].name} step ${s + 1}`);
        cell.type = 'button';

        if (this.sequencer.grid[t][s].active) {
          cell.classList.add('rw-active');
        }
        if (s % 4 === 0) {
          cell.classList.add('rw-beat-start');
        }

        cell.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this._toggleCell(t, s, cell);
        });

        trackRow.appendChild(cell);
        row.push(cell);
      }

      this.gridEl.appendChild(trackRow);
      this.stepCells.push(row);
    }
  }

  _toggleCell(track, step, cellEl) {
    const isActive = this.sequencer.toggleCell(track, step);
    cellEl.classList.toggle('rw-active', isActive);
    this._autoSave();
  }

  _updateGridFromPattern() {
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      for (let s = 0; s < this.sequencer.steps; s++) {
        const cell = this.stepCells[t] && this.stepCells[t][s];
        if (cell) {
          cell.classList.toggle('rw-active', this.sequencer.grid[t][s].active);
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  MIXER / TRACK CONTROLS                                             */
  /* ------------------------------------------------------------------ */

  _renderMixer() {
    const mixerEl = document.getElementById('rw-mixer');
    if (!mixerEl) return;
    mixerEl.innerHTML = '';
    this.trackControls = [];

    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const track = this.sequencer.tracks[t];
      const strip = document.createElement('div');
      strip.className = 'rw-mixer-strip';
      strip.dataset.track = t;

      const instSelect = document.createElement('select');
      instSelect.className = 'rw-inst-select';
      instSelect.setAttribute('aria-label', `${track.name} instrument`);
      for (const inst of INSTRUMENTS) {
        const opt = document.createElement('option');
        opt.value = inst;
        opt.textContent = inst.charAt(0).toUpperCase() + inst.slice(1);
        if (inst === track.instrument) opt.selected = true;
        instSelect.appendChild(opt);
      }
      instSelect.addEventListener('change', () => {
        this.sequencer.updateTrack(t, { instrument: instSelect.value });
        this._autoSave();
      });

      const volLabel = document.createElement('label');
      volLabel.className = 'rw-mixer-label';
      volLabel.textContent = 'Vol';
      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.className = 'rw-vol-slider';
      volSlider.min = '0';
      volSlider.max = '1';
      volSlider.step = '0.01';
      volSlider.value = String(track.volume);
      volSlider.setAttribute('aria-label', `${track.name} volume`);
      volSlider.addEventListener('input', () => {
        this.sequencer.updateTrack(t, { volume: parseFloat(volSlider.value) });
        this._autoSave();
      });

      const panLabel = document.createElement('label');
      panLabel.className = 'rw-mixer-label';
      panLabel.textContent = 'Pan';
      const panSlider = document.createElement('input');
      panSlider.type = 'range';
      panSlider.className = 'rw-pan-slider';
      panSlider.min = '-1';
      panSlider.max = '1';
      panSlider.step = '0.01';
      panSlider.value = String(track.pan);
      panSlider.setAttribute('aria-label', `${track.name} pan`);
      panSlider.addEventListener('input', () => {
        this.sequencer.updateTrack(t, { pan: parseFloat(panSlider.value) });
        this._autoSave();
      });

      const muteBtn = document.createElement('button');
      muteBtn.className = 'rw-mute-btn';
      muteBtn.type = 'button';
      muteBtn.textContent = 'M';
      muteBtn.setAttribute('aria-label', `${track.name} mute`);
      muteBtn.classList.toggle('rw-active', track.muted);
      muteBtn.addEventListener('click', () => {
        const muted = !this.sequencer.tracks[t].muted;
        this.sequencer.updateTrack(t, { muted });
        muteBtn.classList.toggle('rw-active', muted);
        this._autoSave();
      });

      const soloBtn = document.createElement('button');
      soloBtn.className = 'rw-solo-btn';
      soloBtn.type = 'button';
      soloBtn.textContent = 'S';
      soloBtn.setAttribute('aria-label', `${track.name} solo`);
      soloBtn.classList.toggle('rw-active', track.soloed);
      soloBtn.addEventListener('click', () => {
        const soloed = !this.sequencer.tracks[t].soloed;
        this.sequencer.updateTrack(t, { soloed });
        soloBtn.classList.toggle('rw-active', soloed);
        this._autoSave();
      });

      const nameEl = document.createElement('div');
      nameEl.className = 'rw-mixer-name';
      nameEl.textContent = track.name;

      strip.appendChild(nameEl);
      strip.appendChild(instSelect);
      strip.appendChild(volLabel);
      strip.appendChild(volSlider);
      strip.appendChild(panLabel);
      strip.appendChild(panSlider);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'rw-mixer-buttons';
      btnGroup.appendChild(muteBtn);
      btnGroup.appendChild(soloBtn);
      strip.appendChild(btnGroup);

      mixerEl.appendChild(strip);
      this.trackControls.push({ instSelect, volSlider, panSlider, muteBtn, soloBtn });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  TRANSPORT                                                          */
  /* ------------------------------------------------------------------ */

  _bindTransport() {
    if (this.playBtn) {
      this.playBtn.addEventListener('click', () => this.togglePlay());
    }
    if (this.stopBtn) {
      this.stopBtn.addEventListener('click', () => this.stop());
    }
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.clearPattern());
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this._exportWAV());
    }

    if (this.bpmInput) {
      this.bpmInput.value = String(this.bpm);
      this.bpmInput.addEventListener('change', () => {
        this.setBPM(parseInt(this.bpmInput.value, 10));
      });
    }
    if (this.bpmSlider) {
      this.bpmSlider.min = String(MIN_BPM);
      this.bpmSlider.max = String(MAX_BPM);
      this.bpmSlider.value = String(this.bpm);
      this.bpmSlider.addEventListener('input', () => {
        this.setBPM(parseInt(this.bpmSlider.value, 10));
      });
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.play();
    }
  }

  play() {
    if (this.isPlaying) return;
    // Ensure audio context is ready
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
      this.audio.ctx.resume();
    }
    this.isPlaying = true;
    this.currentStep = 0;
    this._lastPlayedZone = -1;
    this._scheduleNext();
    this._updatePlayhead();
    this._updateStatus();
    if (this.playBtn) this.playBtn.classList.add('rw-active');
  }

  stop() {
    this.isPlaying = false;
    if (this.timerID !== null) {
      clearTimeout(this.timerID);
      this.timerID = null;
    }
    this.currentStep = 0;
    this._lastPlayedZone = -1;
    // Restore the sequencer + grid UI to the zone being EDITED
    this._loadZone(this.activeZone);
    this._renderZoneButtons();
    this._clearPlayhead();
    this._updateStatus();
    if (this.playBtn) this.playBtn.classList.remove('rw-active');
    this._autoSave();
  }

  clearPattern() {
    this.sequencer.clearAll();
    this._updateGridFromPattern();
    this._autoSave();
    this._updateStatus();
  }

  setBPM(value) {
    this.bpm = Math.max(MIN_BPM, Math.min(MAX_BPM, value || DEFAULT_BPM));
    if (this.bpmInput) this.bpmInput.value = String(this.bpm);
    if (this.bpmSlider) this.bpmSlider.value = String(this.bpm);
    this._updateStatus();
  }

  /* ------------------------------------------------------------------ */
  /*  SEQUENCER TICK — plays through all zones sequentially             */
  /* ------------------------------------------------------------------ */

  _scheduleNext() {
    if (!this.isPlaying) return;
    const msPerStep = (60000 / this.bpm) / 4;
    this.timerID = setTimeout(() => this._tick(), msPerStep);
  }

  _tick() {
    if (!this.isPlaying) return;

    // Determine which zone and local step we're on
    const zoneIndex = Math.floor(this.currentStep / this.sequencer.steps) % this.zones.length;
    const localStep = this.currentStep % this.sequencer.steps;

    // If we've moved to a different zone, update the playback highlight only.
    // NOTE: playback NEVER mutates this.sequencer nor writes to this.zones —
    // the sounding zone's pattern is read directly from its snapshot below.
    if (zoneIndex !== this._lastPlayedZone) {
      this._lastPlayedZone = zoneIndex;
      this._updatePlaybackZoneHighlight(zoneIndex);
    }

    // Read the sounding zone's pattern from its snapshot (read-only)
    const zone = this.zones[zoneIndex];
    const zoneTracks = (zone && zone.tracks) || [];
    const zoneGrid = (zone && zone.grid) || [];

    // Trigger notes for current local step
    const stepDuration = (60 / this.bpm) / 4;
    const anySolo = zoneTracks.some((tr) => tr.soloed);
    for (let t = 0; t < zoneTracks.length; t++) {
      const track = zoneTracks[t];
      const cell = zoneGrid[t] && zoneGrid[t][localStep];
      if (!cell) continue;

      if (track.muted || (anySolo && !track.soloed)) continue;

      if (cell.active) {
        this.audio.triggerNote({
          instrument: track.instrument,
          note: cell.note,
          velocity: cell.velocity * track.volume,
          pan: track.pan,
          duration: stepDuration * 0.9
        });
      }
    }

    this._updatePlayheadLocal(localStep);
    this.currentStep++;

    // Total steps across all zones
    const totalSteps = this.zones.length * this.sequencer.steps;
    if (this.currentStep >= totalSteps) {
      this.currentStep = 0;
      this._lastPlayedZone = -1;
    }

    this._updateStatus();
    this._scheduleNext();
  }

  /* ------------------------------------------------------------------ */
  /*  PLAYHEAD VISUAL                                                    */
  /* ------------------------------------------------------------------ */

  _updatePlayheadLocal(localStep) {
    this._clearPlayhead();
    const prevStep = (localStep - 1 + this.sequencer.steps) % this.sequencer.steps;
    if (this.playheadEls[prevStep]) {
      this.playheadEls[prevStep].classList.remove('rw-playhead');
    }
    if (this.playheadEls[localStep]) {
      this.playheadEls[localStep].classList.add('rw-playhead');
    }
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const cell = this.stepCells[t] && this.stepCells[t][localStep];
      if (cell) cell.classList.add('rw-playhead-cell');
      const prevCell = this.stepCells[t] && this.stepCells[t][prevStep];
      if (prevCell) prevCell.classList.remove('rw-playhead-cell');
    }
  }

  _updatePlayhead() {
    this._clearPlayhead();
    if (this.playheadEls[0]) {
      this.playheadEls[0].classList.add('rw-playhead');
    }
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const cell = this.stepCells[t] && this.stepCells[t][0];
      if (cell) cell.classList.add('rw-playhead-cell');
    }
  }

  _clearPlayhead() {
    for (let s = 0; s < this.sequencer.steps; s++) {
      if (this.playheadEls[s]) this.playheadEls[s].classList.remove('rw-playhead');
    }
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      for (let s = 0; s < this.sequencer.steps; s++) {
        const cell = this.stepCells[t] && this.stepCells[t][s];
        if (cell) cell.classList.remove('rw-playhead-cell');
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  KEYBOARD SHORTCUTS                                                 */
  /* ------------------------------------------------------------------ */

  _bindKeyboard() {
    document.addEventListener('keydown', this._boundKeyDown);
  }

  _onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        this.togglePlay();
        break;
      case 'KeyZ':
        this._liveInput('C4');
        break;
      case 'KeyX':
        this._liveInput('D4');
        break;
      case 'KeyC':
        this._liveInput('E4');
        break;
      case 'KeyV':
        this._liveInput('F4');
        break;
      case 'ArrowRight':
        e.preventDefault();
        this._switchZone(Math.min(this.activeZone + 1, this.zones.length - 1));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this._switchZone(Math.max(this.activeZone - 1, 0));
        break;
    }
  }

  _liveInput(note) {
    if (this.audio.ctx && this.audio.ctx.state === 'suspended') {
      this.audio.ctx.resume();
    }
    const anySolo = this.sequencer.tracks.some((t) => t.soloed);
    const track = this.sequencer.tracks.find(
      (t) => !t.muted && (!anySolo || t.soloed)
    );
    if (track) {
      this.audio.triggerNote({
        instrument: track.instrument,
        note,
        velocity: 0.8 * track.volume,
        pan: track.pan
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  STATUS BAR                                                         */
  /* ------------------------------------------------------------------ */

  _updateStatus() {
    if (!this.statusBar) return;
    const totalSteps = this.zones.length * this.sequencer.steps;
    const state = this.isPlaying ? 'Playing' : 'Stopped';
    const zoneDisplay = `${this.activeZone + 1}/${this.zones.length}`;
    this.statusBar.textContent = `${state} | Zone: ${zoneDisplay} | Step: ${this.currentStep + 1}/${totalSteps} | BPM: ${this.bpm} | ${this.songName}`;
  }

  _flashStatus(msg) {
    if (!this.statusBar) return;
    const prev = this.statusBar.textContent;
    this.statusBar.textContent = msg;
    setTimeout(() => {
      if (this.statusBar) this._updateStatus();
    }, 2000);
  }

  /* ------------------------------------------------------------------ */
  /*  PERSISTENCE — saves all zones                                     */
  /* ------------------------------------------------------------------ */

  _autoSave() {
    try {
      this._saveCurrentZone();
      const data = {
        zones: this.zones,
        activeZone: this.activeZone,
        bpm: this.bpm,
        songName: this.songName,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }
  }

  _loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.zones) && data.zones.length > 0) {
        this.zones = data.zones;
        this.activeZone = Math.min(data.activeZone || 0, this.zones.length - 1);
        this.bpm = data.bpm || DEFAULT_BPM;
        this.songName = data.songName || 'Untitled';
        this._loadZone(this.activeZone);
        this._renderZoneButtons();
        if (this.bpmInput) this.bpmInput.value = String(this.bpm);
        if (this.bpmSlider) this.bpmSlider.value = String(this.bpm);
        this._updateStatus();
      } else if (data && Array.isArray(data.grid)) {
        // Legacy single-pattern format migration
        this.zones = [data];
        this.activeZone = 0;
        this.bpm = data.bpm || DEFAULT_BPM;
        this.songName = data.patternName || 'Untitled';
        this._loadZone(0);
        this._renderZoneButtons();
        if (this.bpmInput) this.bpmInput.value = String(this.bpm);
        if (this.bpmSlider) this.bpmSlider.value = String(this.bpm);
        this._updateStatus();
      }
    } catch {
      // Corrupted data — start fresh
    }
  }

  _syncMixerUI() {
    for (let t = 0; t < this.sequencer.trackCount; t++) {
      const ctrl = this.trackControls[t];
      const track = this.sequencer.tracks[t];
      if (!ctrl) continue;
      ctrl.instSelect.value = track.instrument;
      ctrl.volSlider.value = String(track.volume);
      ctrl.panSlider.value = String(track.pan);
      ctrl.muteBtn.classList.toggle('rw-active', track.muted);
      ctrl.soloBtn.classList.toggle('rw-active', track.soloed);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  WAV EXPORT — renders all zones sequentially                       */
  /* ------------------------------------------------------------------ */

  async _exportWAV() {
    if (!this.exportBtn) return;

    this.exportBtn.disabled = true;
    this.exportBtn.textContent = 'Rendering...';

    if (this.progressBar) {
      this.progressBar.style.display = 'block';
      this.progressBar.value = 0;
      this.progressBar.max = 100;
    }

    try {
      // Save current zone before export
      this._saveCurrentZone();

      const blob = await exportWAV(this.audio, this.sequencer, {
        sampleRate: 44100,
        bitDepth: 16,
        normalize: true,
        loopCount: 1,
        bpm: this.bpm,
        zones: this.zones,
        onProgress: (fraction) => {
          if (this.progressBar) {
            this.progressBar.value = Math.round(fraction * 100);
          }
        },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `bytebangers-${this.songName.replace(/\s+/g, '-')}-${timestamp}.wav`;
      downloadWAV(blob, filename);

      this._flashStatus(`Exported: ${filename}`);
    } catch (err) {
      console.error('[ByteBangers] Export failed:', err);
      this._flashStatus('Export failed — see console');
    } finally {
      this.exportBtn.disabled = false;
      this.exportBtn.textContent = 'Export WAV';
      if (this.progressBar) {
        this.progressBar.value = 100;
        setTimeout(() => {
          if (this.progressBar) this.progressBar.style.display = 'none';
        }, 1500);
      }
    }
  }
}

/* ==================================================================== */
/*  BOOTSTRAP                                                            */
/* ==================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const app = new ByteBangersApp();
  app._lastPlayedZone = -1;
  app.init();
  window.__byteBangers = app;
});