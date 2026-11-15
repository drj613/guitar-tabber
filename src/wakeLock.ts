type Sentinel = { release(): Promise<void> };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

/** Keeps the screen on while `set(true)`; re-acquires after the app returns to the foreground. */
export function createWakeLock(): { set(on: boolean): void; dispose(): void } {
  let wanted = false;
  let sentinel: Sentinel | null = null;
  const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;

  async function sync(): Promise<void> {
    try {
      if (wanted && api && !sentinel && document.visibilityState === 'visible') {
        sentinel = await api.request('screen');
        (sentinel as unknown as EventTarget).addEventListener?.('release', () => (sentinel = null));
      } else if (!wanted && sentinel) {
        const s = sentinel;
        sentinel = null;
        await s.release();
      }
    } catch {
      /* refused; not fatal */
    }
  }
  const onVisible = () => void sync();
  document.addEventListener('visibilitychange', onVisible);

  return {
    set(on) {
      wanted = on;
      void sync();
    },
    dispose() {
      wanted = false;
      void sync();
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
