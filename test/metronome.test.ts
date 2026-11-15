import { describe, expect, it } from 'vitest';
import { scheduleWindow, TapTempo } from '../src/metronome';

describe('metronome scheduling', () => {
  it('spaces clicks by 60/BPM and accents beat one', () => {
    const { ticks } = scheduleWindow({ nextTime: 0, beat: 0 }, 2, 120, 4);
    expect(ticks.map((t) => t.time)).toEqual([0, 0.5, 1, 1.5]);
    expect(ticks.map((t) => t.accent)).toEqual([true, false, false, false]);
  });

  it('applies a tempo change from the next beat without restarting the bar', () => {
    const a = scheduleWindow({ nextTime: 0, beat: 0 }, 1.1, 120, 4); // clicks at 0, 0.5, 1.0
    const b = scheduleWindow(a.state, 3.1, 60, 4); // next gap 1 s
    expect(a.ticks.map((t) => t.time)).toEqual([0, 0.5, 1]);
    expect(b.ticks.map((t) => t.time)).toEqual([1.5, 2.5]);
    expect(b.ticks.map((t) => t.beat)).toEqual([3, 0]);
    expect(b.ticks[1].accent).toBe(true);
  });

  it('never accents with one beat per bar', () => {
    const { ticks } = scheduleWindow({ nextTime: 0, beat: 0 }, 2, 60, 1);
    expect(ticks.every((t) => !t.accent)).toBe(true);
  });

  it('wraps the beat when beats per bar shrinks mid-bar', () => {
    const { ticks } = scheduleWindow({ nextTime: 0, beat: 5 }, 0.1, 60, 3);
    expect(ticks[0].beat).toBe(2);
  });
});

describe('tap tempo', () => {
  it('needs three taps, then averages the gaps', () => {
    const tap = new TapTempo();
    expect(tap.tap(0)).toBeNull();
    expect(tap.tap(500)).toBeNull();
    expect(tap.tap(1000)).toBe(120);
    expect(tap.tap(1700)).toBe(106); // gaps 500, 500, 700
  });

  it('starts over after a long pause', () => {
    const tap = new TapTempo();
    tap.tap(0);
    tap.tap(500);
    expect(tap.tap(5000)).toBeNull();
  });
});
