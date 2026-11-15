import { describe, expect, it } from 'vitest';
import { bpmForSpeed, bpmRange, clampBpm, speedForBpm } from '../src/tempo';

describe('tempo', () => {
  it('uses the file tempo when no target is set', () => {
    expect(speedForBpm(95, null)).toBe(1);
  });
  it('converts a target BPM into a speed multiplier', () => {
    expect(speedForBpm(120, 60)).toBe(0.5);
    expect(speedForBpm(100, 150)).toBe(1.5);
  });
  it('clamps extreme targets', () => {
    expect(speedForBpm(120, 1)).toBe(0.1);
    expect(speedForBpm(100, 10_000)).toBe(3);
  });
  it('round-trips through bpmForSpeed', () => {
    expect(bpmForSpeed(95, speedForBpm(95, 70))).toBe(70);
  });
  it('keeps the slider range sensible', () => {
    expect(bpmRange(120)).toEqual({ min: 20, max: 360 });
    expect(clampBpm(120, 5)).toBe(20);
    expect(clampBpm(120, 999)).toBe(360);
  });
});
