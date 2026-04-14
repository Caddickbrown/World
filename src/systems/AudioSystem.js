/**
 * AudioSystem — Web Audio API wrapper for in-game sound events.
 * CAD-113: No audio files needed; all sounds are generated via oscillators.
 */
export class AudioSystem {
  constructor() {
    this._ctx = null;
    this._enabled = true;
  }

  /** Lazily create/resume AudioContext on first use. */
  _getCtx() {
    if (!this._ctx) {
      try {
        this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        console.warn('[AudioSystem] Web Audio not available', e);
        this._enabled = false;
        return null;
      }
    }
    if (this._ctx.state === 'suspended') {
      this._ctx.resume().catch(() => {});
    }
    return this._ctx;
  }

  /**
   * Play a simple oscillator tone.
   * @param {number} frequency  — Hz
   * @param {number} duration   — seconds
   * @param {string} [type]     — oscillator type: 'sine'|'square'|'sawtooth'|'triangle'
   * @param {number} [gain]     — volume 0–1 (default 0.15)
   * @param {number} [startTime] — audio context time offset (default: now)
   */
  playTone(frequency, duration, type = 'sine', gain = 0.15, startTime = null) {
    if (!this._enabled) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const t = startTime ?? ctx.currentTime;
    try {
      const osc  = ctx.createOscillator();
      const env  = ctx.createGain();
      osc.type      = type;
      osc.frequency.setValueAtTime(frequency, t);
      env.gain.setValueAtTime(gain, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(env);
      env.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch (e) {
      console.warn('[AudioSystem] playTone error', e);
    }
  }

  /**
   * Play a named game event sound.
   * @param {string} name — event name
   */
  playEvent(name) {
    if (!this._enabled) return;
    const ctx = this._getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;

    switch (name) {
      case 'discovery':
        // Ascending arpeggio: 3 notes, 200ms each
        this.playTone(523, 0.18, 'sine', 0.15, now);          // C5
        this.playTone(659, 0.18, 'sine', 0.15, now + 0.20);   // E5
        this.playTone(784, 0.28, 'sine', 0.15, now + 0.40);   // G5
        break;

      case 'birth':
        // Soft chord (C + E + G simultaneously, short)
        this.playTone(523, 0.4, 'sine', 0.10, now);
        this.playTone(659, 0.4, 'sine', 0.08, now);
        this.playTone(784, 0.4, 'sine', 0.06, now);
        break;

      case 'death':
        // Descending tone: slide from 440 down to 220
        try {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(440, now);
          osc.frequency.exponentialRampToValueAtTime(180, now + 0.5);
          env.gain.setValueAtTime(0.15, now);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
          osc.connect(env);
          env.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.55);
        } catch (e) {}
        break;

      case 'weather_change':
        // Swoosh: frequency sweep from low to high
        try {
          const osc = ctx.createOscillator();
          const env = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(80, now);
          osc.frequency.exponentialRampToValueAtTime(1200, now + 0.35);
          env.gain.setValueAtTime(0.0001, now);
          env.gain.linearRampToValueAtTime(0.12, now + 0.15);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
          osc.connect(env);
          env.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.4);
        } catch (e) {}
        break;

      case 'fire':
        // Crackling noise burst: white noise through bandpass filter
        try {
          const bufSize = ctx.sampleRate * 0.3;
          const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
          const src    = ctx.createBufferSource();
          const filter = ctx.createBiquadFilter();
          const env    = ctx.createGain();
          src.buffer = buf;
          filter.type = 'bandpass';
          filter.frequency.value = 800;
          filter.Q.value = 0.5;
          env.gain.setValueAtTime(0.25, now);
          env.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
          src.connect(filter);
          filter.connect(env);
          env.connect(ctx.destination);
          src.start(now);
        } catch (e) {}
        break;

      default:
        break;
    }
  }
}

export const audio = new AudioSystem();
