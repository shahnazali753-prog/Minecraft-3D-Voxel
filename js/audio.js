// Tiny synthesized sound effects (no audio files). iOS needs unlock() on a user gesture.
export class Sfx {
  constructor() { this.ctx = null; this.enabled = true; this.noise = null; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const len = this.ctx.sampleRate * 0.3;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // play a silent buffer to fully unlock on iOS
    const src = this.ctx.createBufferSource();
    src.buffer = this.ctx.createBuffer(1, 1, 22050);
    src.connect(this.ctx.destination);
    src.start(0);
  }

  _burst(freq, dur, gain, type = 'lowpass') {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.ctx.destination);
    src.start(t, Math.random() * 0.1, dur + 0.02);
  }

  break(material) {
    const f = { stone: 1400, wood: 700, soft: 500, glass: 3200, plant: 2500 }[material] || 900;
    this._burst(f, 0.16, 0.5);
    if (material === 'glass') this._burst(5000, 0.25, 0.25, 'highpass');
  }
  place(material) {
    const f = { stone: 1100, wood: 600, soft: 400, glass: 2200, plant: 2000 }[material] || 800;
    this._burst(f, 0.09, 0.45);
  }
  step() { this._burst(350, 0.05, 0.12); }
  splash() { this._burst(1200, 0.35, 0.3, 'bandpass'); }
}

export function materialOf(id) {
  if ([3, 9, 11, 13, 14, 16].includes(id)) return 'stone';
  if ([5, 8].includes(id)) return 'wood';
  if (id === 10) return 'glass';
  if ([6, 24, 25, 26].includes(id)) return 'plant';
  return 'soft';
}
