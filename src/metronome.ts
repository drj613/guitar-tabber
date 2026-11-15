// A Web Audio metronome. Clicks are scheduled against the audio clock a
// little ahead of time, so timer jitter on the main thread does not make the
// beat drift. A tempo change applies from the next beat onward.

export interface Tick {
  /** Audio-clock time in seconds. */
  time: number;
  /** Position in the bar, 0-based. */
  beat: number;
  accent: boolean;
}

export interface ClockState {
  nextTime: number;
  beat: number;
}

/**
 * Returns every tick due before `until`, plus the state for the next call.
 * The gap after each tick uses the BPM in effect when it is scheduled.
 */
export function scheduleWindow(
  state: ClockState,
  until: number,
  bpm: number,
  beatsPerBar: number,
): { ticks: Tick[]; state: ClockState } {
  const ticks: Tick[] = [];
  let { nextTime, beat } = state;
  const gap = 60 / Math.max(1, bpm);
  const perBar = Math.max(1, Math.floor(beatsPerBar));
  beat %= perBar;
  while (nextTime < until) {
    ticks.push({ time: nextTime, beat, accent: perBar > 1 && beat === 0 });
    nextTime += gap;
    beat = (beat + 1) % perBar;
  }
  return { ticks, state: { nextTime, beat } };
}

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Lets Web Audio play with the iPad's silent switch on (Safari 17+). */
export function preferPlaybackAudioSession(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      /* not supported */
    }
  }
}

export class Metronome {
  bpm: number;
  beatsPerBar: number;
  /** Called on the main thread close to when each click sounds. */
  onTick: ((tick: Tick) => void) | null = null;
  /** Called when the metronome starts or stops, including when the system stops the audio. */
  onRunningChange: ((running: boolean) => void) | null = null;

  private ctx: AudioContext | null = null;
  private timer: number | undefined;
  private state: ClockState = { nextTime: 0, beat: 0 };
  private pending: number[] = [];
  private voices: OscillatorNode[] = [];

  constructor(bpm = 100, beatsPerBar = 4) {
    this.bpm = bpm;
    this.beatsPerBar = beatsPerBar;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Call from a tap handler so iOS lets the audio start. */
  start(): void {
    if (this.running) return;
    preferPlaybackAudioSession();
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      this.ctx = new Ctor!();
      // A phone call, Siri or leaving the app suspends ("interrupted" on iOS) the context.
      // Stop rather than keep showing a running metronome that makes no sound.
      this.ctx.onstatechange = () => {
        if (this.running && this.ctx && this.ctx.state !== 'running') this.stop();
      };
    }
    void this.ctx.resume();
    this.state = { nextTime: this.ctx.currentTime + 0.06, beat: 0 };
    this.timer = window.setInterval(() => this.pump(), LOOKAHEAD_MS);
    this.pump();
    this.onRunningChange?.(true);
  }

  stop(): void {
    const was = this.running;
    clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.pending) clearTimeout(t);
    this.pending = [];
    // Silence clicks already queued in the lookahead window.
    for (const v of this.voices) {
      try {
        v.stop();
      } catch {
        /* already finished */
      }
    }
    this.voices = [];
    if (was) this.onRunningChange?.(false);
  }

  toggle(): void {
    if (this.running) this.stop();
    else this.start();
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }

  private pump(): void {
    const ctx = this.ctx;
    // Right after start() the context may still be resuming; wait for it.
    if (!ctx || ctx.state !== 'running') return;
    // After the tab was suspended, skip ahead instead of firing a burst of clicks.
    if (this.state.nextTime < ctx.currentTime - 0.2) this.state.nextTime = ctx.currentTime + 0.05;
    const { ticks, state } = scheduleWindow(this.state, ctx.currentTime + SCHEDULE_AHEAD_S, this.bpm, this.beatsPerBar);
    this.state = state;
    for (const tick of ticks) {
      this.click(ctx, tick);
      const delay = Math.max(0, (tick.time - ctx.currentTime) * 1000);
      const id = window.setTimeout(() => {
        this.pending = this.pending.filter((p) => p !== id);
        this.onTick?.(tick);
      }, delay);
      this.pending.push(id);
    }
  }

  private click(ctx: AudioContext, tick: Tick): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = tick.accent ? 1760 : 1175;
    const peak = tick.accent ? 0.5 : 0.32;
    gain.gain.setValueAtTime(0.0001, tick.time);
    gain.gain.exponentialRampToValueAtTime(peak, tick.time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, tick.time + 0.045);
    osc.connect(gain).connect(ctx.destination);
    osc.start(tick.time);
    osc.stop(tick.time + 0.05);
    this.voices.push(osc);
    osc.onended = () => {
      this.voices = this.voices.filter((v) => v !== osc);
    };
  }
}

/** Turns a series of taps into a BPM, or null until there are enough taps. */
export class TapTempo {
  private taps: number[] = [];

  tap(now = performance.now()): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 6) this.taps.shift();
    if (this.taps.length < 3) return null;
    const gaps = this.taps.slice(1).map((t, i) => t - this.taps[i]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return Math.round(60000 / avg);
  }
}
