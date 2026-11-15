// alphaTab exposes playback speed as a multiplier of the song's own tempo.
// The UI talks in BPM, so these convert between the two.

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 3;

export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
}

/** Speed multiplier needed to play a song written at `baseBpm` at `targetBpm`. */
export function speedForBpm(baseBpm: number, targetBpm: number | null): number {
  if (!targetBpm || !baseBpm || baseBpm <= 0) return 1;
  return clampSpeed(targetBpm / baseBpm);
}

export function bpmForSpeed(baseBpm: number, speed: number): number {
  return Math.round(baseBpm * speed);
}

/** Range of BPM values the slider allows for a song. */
export function bpmRange(baseBpm: number): { min: number; max: number } {
  const base = baseBpm > 0 ? baseBpm : 120;
  return {
    min: Math.max(20, Math.ceil(base * MIN_SPEED)),
    max: Math.min(400, Math.floor(base * MAX_SPEED)),
  };
}

export function clampBpm(baseBpm: number, bpm: number): number {
  const { min, max } = bpmRange(baseBpm);
  return Math.min(max, Math.max(min, Math.round(bpm)));
}
