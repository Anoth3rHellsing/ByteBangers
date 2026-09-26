# ByteBangers — 16-Bit Retro Wave Music Studio

A browser-based chiptune and 16-bit music creation tool inspired by the SNES and Genesis era. Compose, sequence, and export authentic retro-wave tracks entirely in the browser with zero dependencies.

## Features

- **8-track step sequencer** with per-track instrument, volume, pan, mute, and solo controls
- **Built-in synth engine** using the Web Audio API — square, sawtooth, triangle, sine, and noise waveforms with ADSR envelopes, resonant filters, and bit-crushing for genuine 16-bit timbre
- **WAV export** — offline-render the current pattern to a normalized 16-bit / 44.1 kHz PCM WAV file and download it directly from the browser
- **Retro Wave UI** — neon-on-dark aesthetic built with the Retro Wave UI Kit

## How to Run

Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari). No build step or server is required.

For local development with hot reload, serve the project root with any static file server:

```powershell
npx serve .
```

## Tech Stack

- Vanilla JavaScript (ES modules)
- Web Audio API (AudioContext, OfflineAudioContext)
- HTML5 + CSS3
- No external dependencies or frameworks

## Project Structure

```
ByteBangers/
├── index.html          # Main application shell
├── css/                # Retro Wave UI styles
├── js/
│   ├── app.js          # Application controller and UI bindings
│   ├── audio-engine.js # Synth voices, mixer channels, master chain
│   ├── sequencer.js    # Step grid, track config, pattern serialization
│   └── export.js       # WAV encoding and offline rendering
└── README.md
```

## License & Credits

**ByteBangers — Created by nicol & Claude (Anthropic)**

This project is free to use, modify, and distribute for any purpose — just give us credit. See the full terms in [LICENSE](LICENSE).

- **nicol** — Project creator, design, and development
- **Claude (Anthropic)** — AI-assisted development and code generation
- **Google Fonts** — Monoton, Orbitron, Rajdhani, VT323 (SIL Open Font License)