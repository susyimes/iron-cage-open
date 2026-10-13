import { RUN } from "./game/config.ts";

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private charge: GainNode | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeNoise: AudioBufferSourceNode | null = null;
  private chargeFilter: BiquadFilterNode | null = null;
  private chargeNoiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private started = false;
  onChange: ((muted: boolean) => void) | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(RUN.muteKey) === "1";
    } catch {
      this.muted = false;
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(next: boolean): void {
    this.muted = next;
    try {
      localStorage.setItem(RUN.muteKey, next ? "1" : "0");
    } catch {
      /* quota */
    }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(next ? 0 : 1, this.ctx.currentTime, 0.04);
    }
    this.onChange?.(next);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  async unlock(): Promise<void> {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.music = ctx.createGain();
      this.sfx = ctx.createGain();
      this.music.gain.value = 0.22;
      this.sfx.gain.value = 0.55;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(ctx.destination);
      this.master.gain.value = this.muted ? 0 : 1;
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (!this.started) {
      this.started = true;
      void this.startBed();
    }
  }

  click(): void {
    this.blip(880, 0.04, 0.08, "square");
  }

  shoot(power: number): void {
    this.noiseBurst(0.09, 0.12 + power * 0.12, 900);
    this.blip(140 + power * 80, 0.12, 0.16, "sawtooth");
  }

  impact(kind: "ball" | "cushion" | "cage" | "felt", speed: number): void {
    const s = Math.min(1, speed / 8);
    if (kind === "cage") this.blip(620 + s * 900, 0.05 + s * 0.05, 0.1 + s * 0.1, "square");
    else if (kind === "cushion") this.blip(180 + s * 90, 0.06, 0.12, "triangle");
    else if (kind === "felt") this.noiseBurst(0.04, 0.04 * s, 400);
    else this.blip(220 + s * 200, 0.04, 0.09, "sine");
  }

  pocket(): void {
    this.blip(220, 0.18, 0.14, "sine");
    this.blip(110, 0.22, 0.1, "sine");
  }

  shatter(): void {
    this.noiseBurst(0.2, 0.22, 1800);
    this.blip(90, 0.16, 0.18, "sawtooth");
  }

  uiOk(): void {
    this.blip(520, 0.08, 0.09, "square");
    this.blip(780, 0.1, 0.07, "square");
  }

  scratch(): void {
    this.blip(90, 0.2, 0.14, "sawtooth");
  }

  startCharge(): void {
    if (!this.ctx || !this.sfx || this.chargeOsc) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    // A warm rising tone with a soft cue-pull texture, without the old buzzy harmonics.
    osc.type = "sine";
    osc.frequency.value = 110;
    g.gain.value = 0;
    osc.connect(g);
    if (!this.chargeNoiseBuffer) {
      this.chargeNoiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.chargeNoiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.18;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = this.chargeNoiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.5;
    noise.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    osc.start();
    noise.start();
    this.chargeOsc = osc;
    this.chargeNoise = noise;
    this.chargeFilter = filter;
    this.charge = g;
  }

  setCharge(t: number): void {
    if (!this.ctx || !this.charge || !this.chargeOsc) return;
    const now = this.ctx.currentTime;
    const power = Math.max(0, Math.min(1, t));
    this.chargeOsc.frequency.setTargetAtTime(110 + power * 95, now, 0.08);
    this.chargeFilter?.frequency.setTargetAtTime(380 + power * 320, now, 0.08);
    this.charge.gain.setTargetAtTime(0.012 + power * 0.028, now, 0.06);
  }

  stopCharge(): void {
    if (!this.ctx || !this.chargeOsc || !this.charge) return;
    const osc = this.chargeOsc;
    const g = this.charge;
    const noise = this.chargeNoise;
    const filter = this.chargeFilter;
    const now = this.ctx.currentTime;
    if (typeof g.gain.cancelAndHoldAtTime === "function") {
      g.gain.cancelAndHoldAtTime(now);
    } else {
      // WeChat's Web Audio subset may only provide cancelScheduledValues.
      const gain = g.gain.value;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(gain, now);
    }
    g.gain.linearRampToValueAtTime(0, now + 0.06);
    osc.onended = () => {
      osc.disconnect();
      noise?.disconnect();
      filter?.disconnect();
      g.disconnect();
    };
    osc.stop(now + 0.07);
    noise?.stop(now + 0.07);
    this.chargeOsc = null;
    this.chargeNoise = null;
    this.chargeFilter = null;
    this.charge = null;
  }

  private startBed(): void {
    // The public distribution uses synthesized ambience; no unlicensed recording is loaded.
    this.startHum();
  }

  private startHum(): void {
    if (!this.ctx || !this.music) return;
    const osc = this.ctx.createOscillator();
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 52;
    f.type = "lowpass";
    f.frequency.value = 180;
    g.gain.value = 0.12;
    osc.connect(f);
    f.connect(g);
    g.connect(this.music);
    osc.start();
    const n = this.noiseBurstNode(0.04, 0.0001);
    if (n) n.connect(this.music);
  }

  private blip(freq: number, dur: number, gain: number, type: OscillatorType): void {
    if (!this.ctx || !this.sfx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start();
    osc.stop(this.ctx.currentTime + dur + 0.02);
  }

  private noiseBurst(dur: number, gain: number, cutoff: number): void {
    if (!this.ctx || !this.sfx) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfx);
    src.start();
  }

  private noiseBurstNode(gain: number, _dur: number): GainNode | null {
    if (!this.ctx) return null;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * 0.4;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    src.start();
    return g;
  }
}
