import * as alphaTab from '@coderline/alphatab';
import { getSong, getSongBytes, updateSong, type SongMeta } from './db';
import { formatTime, h, toast } from './dom';
import { mixFor, normalizeSettings, type SongSettings, type StaveMode } from './songSettings';
import { bpmRange, clampBpm, speedForBpm } from './tempo';

const BASE = import.meta.env.BASE_URL;

const STAVE: Record<StaveMode, alphaTab.StaveProfile> = {
  tab: alphaTab.StaveProfile.Tab,
  scoretab: alphaTab.StaveProfile.ScoreTab,
  score: alphaTab.StaveProfile.Score,
};

type Track = alphaTab.model.Track;
type Beat = alphaTab.model.Beat;

/** Lets Web Audio play with the iPad's silent switch on (Safari 17+). */
function preferPlaybackAudioSession(): void {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = 'playback';
    } catch {
      /* not supported */
    }
  }
}

export async function renderPlayer(root: HTMLElement, songId: string, back: () => void): Promise<() => void> {
  const song = await getSong(songId);
  const bytes = await getSongBytes(songId);
  if (!song || !bytes) {
    toast('That tab is no longer on this device');
    back();
    return () => {};
  }
  void updateSong(songId, { lastOpenedAt: Date.now() });
  return new PlayerView(root, song, new Uint8Array(bytes), back).dispose;
}

class PlayerView {
  private s: SongSettings;
  private api!: alphaTab.AlphaTabApi;
  private score: alphaTab.model.Score | null = null;
  private baseBpm = 120;
  private currentBar = 0;
  private settingRange = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private saveTimer: number | undefined;

  // elements
  private el = {
    surface: h('div', { class: 'score-surface' }),
    scroller: h('div', { class: 'score-scroll' }),
    overlay: h('div', { class: 'score-overlay' }, 'Loading…'),
    play: h('button', { class: 'btn transport play', 'aria-label': 'Play' }, '▶'),
    stop: h('button', { class: 'btn transport', 'aria-label': 'Stop' }, '■'),
    time: h('span', { class: 'time' }, '0:00 / 0:00'),
    bar: h('span', { class: 'bar-pos' }, 'Bar 1'),
    bpmSlider: h('input', { type: 'range', class: 'bpm-slider', 'aria-label': 'Tempo' }),
    bpmValue: h('button', { class: 'bpm-value', title: 'Reset to the file tempo' }, '120'),
    bpmDown: h('button', { class: 'btn small', 'aria-label': 'Slower' }, '−'),
    bpmUp: h('button', { class: 'btn small', 'aria-label': 'Faster' }, '+'),
    click: h('button', { class: 'btn toggle' }, 'Click'),
    countIn: h('button', { class: 'btn toggle' }, 'Count-in'),
    loop: h('button', { class: 'btn toggle' }, 'Loop'),
    loopFrom: h('button', { class: 'btn small', title: 'Start the loop at the current bar' }, 'From'),
    loopTo: h('button', { class: 'btn small', title: 'End the loop at the current bar' }, 'To'),
    loopLabel: h('span', { class: 'loop-label muted' }, 'Whole song'),
    loopClear: h('button', { class: 'btn small', 'aria-label': 'Clear loop range' }, '×'),
    tracksBtn: h('button', { class: 'btn' }, 'Tracks'),
    viewBtn: h('button', { class: 'btn' }, 'View'),
    drawer: h('aside', { class: 'drawer', hidden: true }),
    viewMenu: h('div', { class: 'popover', hidden: true }),
  };

  constructor(
    private root: HTMLElement,
    private song: SongMeta,
    private bytes: Uint8Array,
    private back: () => void,
  ) {
    this.s = normalizeSettings(song.settings);
    this.dispose = this.dispose.bind(this);
    this.build();
    this.createApi();
  }

  // ---------- layout ----------

  private build(): void {
    const e = this.el;
    e.scroller.append(e.surface);
    const header = h(
      'header',
      { class: 'bar' },
      h('button', { class: 'btn', onclick: () => this.back() }, '‹ Library'),
      h(
        'div',
        { class: 'titles' },
        h('div', { class: 'title' }, this.song.title),
        this.song.artist ? h('div', { class: 'subtitle' }, this.song.artist) : null,
      ),
      h('div', { class: 'spacer' }),
      e.tracksBtn,
      e.viewBtn,
    );

    const transport = h(
      'footer',
      { class: 'transport-bar' },
      h('div', { class: 'group' }, e.stop, e.play, h('div', { class: 'pos' }, e.time, e.bar)),
      h('div', { class: 'group tempo' }, e.bpmDown, e.bpmSlider, e.bpmUp, e.bpmValue, h('span', { class: 'muted unit' }, 'BPM')),
      h('div', { class: 'group' }, e.click, e.countIn),
      h('div', { class: 'group' }, e.loop, e.loopFrom, e.loopTo, e.loopLabel, e.loopClear),
    );

    this.root.replaceChildren(
      h(
        'div',
        { class: 'player' },
        header,
        h('div', { class: 'score-wrap' }, e.scroller, e.overlay, e.drawer, e.viewMenu),
        transport,
      ),
    );

    e.play.addEventListener('click', () => this.togglePlay());
    e.stop.addEventListener('click', () => this.api?.stop());
    e.bpmSlider.addEventListener('input', () => this.setBpm(Number(e.bpmSlider.value)));
    e.bpmDown.addEventListener('click', () => this.nudgeBpm(-1));
    e.bpmUp.addEventListener('click', () => this.nudgeBpm(1));
    holdToRepeat(e.bpmDown, () => this.nudgeBpm(-1));
    holdToRepeat(e.bpmUp, () => this.nudgeBpm(1));
    e.bpmValue.addEventListener('click', () => this.setBpm(null));
    e.click.addEventListener('click', () => {
      this.s.click = !this.s.click;
      this.applyClick();
      this.save();
    });
    e.countIn.addEventListener('click', () => {
      this.s.countIn = !this.s.countIn;
      this.applyClick();
      this.save();
    });
    e.loop.addEventListener('click', () => {
      this.s.loop = !this.s.loop;
      this.applyLoop();
      this.save();
    });
    e.loopFrom.addEventListener('click', () => this.setLoopEdge('start'));
    e.loopTo.addEventListener('click', () => this.setLoopEdge('end'));
    e.loopClear.addEventListener('click', () => {
      this.s.loopBars = null;
      this.applyLoop();
      this.save();
    });
    e.tracksBtn.addEventListener('click', () => this.toggleDrawer());
    e.viewBtn.addEventListener('click', () => this.toggleViewMenu());
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ---------- alphaTab ----------

  private createApi(): void {
    preferPlaybackAudioSession();
    const api = new alphaTab.AlphaTabApi(this.el.surface, {
      core: { fontDirectory: `${BASE}font/` },
      display: {
        staveProfile: STAVE[this.s.stave],
        layoutMode: this.s.layout === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page,
        scale: this.s.zoom,
      },
      player: {
        playerMode: alphaTab.PlayerMode.EnabledSynthesizer,
        soundFont: `${BASE}soundfont/sonivox.sf2`,
        scrollElement: this.el.scroller,
        enablePlaybackRangeSelection: true,
      },
    });
    this.api = api;

    api.scoreLoaded.on((score) => {
      this.score = score;
      this.baseBpm = score.tempo || 120;
      if (!this.s.shownTracks.length || this.s.shownTracks.some((i) => i >= score.tracks.length)) {
        this.s.shownTracks = [defaultTrack(score)];
      }
      this.setupBpmSlider();
      this.renderDrawer();
    });
    api.renderStarted.on(() => {
      this.el.overlay.hidden = false;
      this.el.overlay.textContent = 'Drawing…';
    });
    api.renderFinished.on(() => {
      this.el.overlay.hidden = true;
    });
    api.soundFontLoad.on((e) => {
      if (e.total) this.el.play.title = `Loading sounds ${Math.round((e.loaded / e.total) * 100)}%`;
    });
    api.playerReady.on(() => {
      this.el.play.title = '';
      this.applyMix();
      this.applyClick();
      this.applySpeed();
    });
    api.midiLoaded.on(() => this.applyLoop());
    api.playerStateChanged.on((e) => {
      const playing = e.state === alphaTab.synth.PlayerState.Playing;
      this.el.play.textContent = playing ? '❚❚' : '▶';
      this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      void this.setWakeLock(playing);
    });
    api.playerPositionChanged.on((e) => {
      this.el.time.textContent = `${formatTime(e.currentTime)} / ${formatTime(e.endTime)}`;
    });
    api.playedBeatChanged.on((beat) => this.setCurrentBar(beat));
    api.beatMouseDown.on((beat) => this.setCurrentBar(beat));
    api.playbackRangeChanged.on((e) => {
      if (this.settingRange) return;
      const range = e.playbackRange;
      if (!range) {
        this.s.loopBars = null;
      } else {
        const start = this.barAtTick(range.startTick);
        const end = this.barAtTick(Math.max(range.startTick, range.endTick - 1));
        if (start !== null && end !== null) this.s.loopBars = { start, end };
      }
      this.updateLoopUi();
      this.save();
    });
    api.error.on((err) => {
      console.error(err);
      this.el.overlay.hidden = false;
      this.el.overlay.textContent = `Couldn't open this file: ${err.message}`;
    });

    this.applyTogglesUi();
    api.load(this.bytes, this.s.shownTracks.length ? this.s.shownTracks : undefined);
  }

  private togglePlay(): void {
    preferPlaybackAudioSession();
    if (!this.api.isReadyForPlayback) {
      toast('Still loading sounds…');
      return;
    }
    this.api.playPause();
  }

  // ---------- tempo ----------

  private setupBpmSlider(): void {
    const { min, max } = bpmRange(this.baseBpm);
    this.el.bpmSlider.min = String(min);
    this.el.bpmSlider.max = String(max);
    this.el.bpmSlider.step = '1';
    if (this.s.bpm !== null) this.s.bpm = clampBpm(this.baseBpm, this.s.bpm);
    this.updateBpmUi();
  }

  private nudgeBpm(delta: number): void {
    this.setBpm((this.s.bpm ?? this.baseBpm) + delta);
  }

  private setBpm(bpm: number | null): void {
    this.s.bpm = bpm === null ? null : clampBpm(this.baseBpm, bpm);
    if (this.s.bpm === this.baseBpm) this.s.bpm = null;
    this.applySpeed();
    this.updateBpmUi();
    this.save();
  }

  private applySpeed(): void {
    if (this.api) this.api.playbackSpeed = speedForBpm(this.baseBpm, this.s.bpm);
  }

  private updateBpmUi(): void {
    const bpm = this.s.bpm ?? this.baseBpm;
    this.el.bpmSlider.value = String(bpm);
    this.el.bpmValue.textContent = String(bpm);
    this.el.bpmValue.classList.toggle('changed', this.s.bpm !== null);
    this.el.bpmValue.title = this.s.bpm !== null ? `Tap to reset to ${this.baseBpm} BPM` : 'File tempo';
  }

  // ---------- click / count-in ----------

  private applyClick(): void {
    if (this.api) {
      this.api.metronomeVolume = this.s.click ? 1 : 0;
      this.api.countInVolume = this.s.countIn ? 1 : 0;
    }
    this.applyTogglesUi();
  }

  private applyTogglesUi(): void {
    setPressed(this.el.click, this.s.click);
    setPressed(this.el.countIn, this.s.countIn);
    setPressed(this.el.loop, this.s.loop);
    this.updateLoopUi();
  }

  // ---------- loop ----------

  private setCurrentBar(beat: Beat): void {
    this.currentBar = beat.voice.bar.masterBar.index;
    this.el.bar.textContent = `Bar ${this.currentBar + 1}`;
  }

  private setLoopEdge(edge: 'start' | 'end'): void {
    const bar = this.currentBar;
    const range = this.s.loopBars ?? { start: bar, end: bar };
    if (edge === 'start') {
      range.start = bar;
      if (range.end < bar) range.end = bar;
    } else {
      range.end = bar;
      if (range.start > bar) range.start = bar;
    }
    this.s.loopBars = range;
    if (!this.s.loop) this.s.loop = true;
    this.applyLoop();
    this.save();
  }

  private barAtTick(tick: number): number | null {
    const lookups = this.api.tickCache?.masterBars;
    if (!lookups) return null;
    for (const mb of lookups) if (tick >= mb.start && tick < mb.end) return mb.masterBar.index;
    return null;
  }

  private applyLoop(): void {
    const api = this.api;
    if (!api) return;
    api.isLooping = this.s.loop;
    this.settingRange = true;
    try {
      const bars = this.s.loopBars;
      const lookups = api.tickCache?.masterBars;
      if (!bars || !lookups) {
        api.playbackRange = null;
        api.clearPlaybackRangeHighlight();
      } else {
        const first = lookups.find((mb) => mb.masterBar.index === bars.start);
        const last = first && lookups.find((mb) => mb.masterBar.index === bars.end && mb.start >= first.start);
        if (first && last) {
          api.playbackRange = { startTick: first.start, endTick: last.end } as alphaTab.synth.PlaybackRange;
          const beats = this.edgeBeats(bars.start, bars.end);
          if (beats) api.highlightPlaybackRange(beats[0], beats[1]);
        }
      }
    } finally {
      this.settingRange = false;
    }
    setPressed(this.el.loop, this.s.loop);
    this.updateLoopUi();
  }

  private edgeBeats(start: number, end: number): [Beat, Beat] | null {
    const track = this.score?.tracks[this.s.shownTracks[0] ?? 0];
    const staff = track?.staves[0];
    const startBeats = staff?.bars[start]?.voices[0]?.beats;
    const endBeats = staff?.bars[end]?.voices[0]?.beats;
    if (!startBeats?.length || !endBeats?.length) return null;
    return [startBeats[0], endBeats[endBeats.length - 1]];
  }

  private updateLoopUi(): void {
    const b = this.s.loopBars;
    this.el.loopLabel.textContent = b ? (b.start === b.end ? `Bar ${b.start + 1}` : `Bars ${b.start + 1}–${b.end + 1}`) : 'Whole song';
    this.el.loopClear.hidden = !b;
  }

  // ---------- tracks ----------

  private toggleDrawer(): void {
    this.el.viewMenu.hidden = true;
    this.el.drawer.hidden = !this.el.drawer.hidden;
    setPressed(this.el.tracksBtn, !this.el.drawer.hidden);
    setPressed(this.el.viewBtn, false);
  }

  private renderDrawer(): void {
    const score = this.score;
    if (!score) return;
    const rows = score.tracks.map((track) => {
      const i = track.index;
      const mix = mixFor(this.s, i);
      const shown = this.s.shownTracks.includes(i);
      const showBox = h('input', { type: 'checkbox', 'aria-label': `Show ${track.name}` });
      showBox.checked = shown;
      showBox.addEventListener('change', () => this.setShown(i, showBox.checked));
      const mute = h('button', { class: 'btn small toggle', 'aria-label': `Mute ${track.name}` }, 'M');
      const solo = h('button', { class: 'btn small toggle', 'aria-label': `Solo ${track.name}` }, 'S');
      setPressed(mute, mix.mute);
      setPressed(solo, mix.solo);
      mute.addEventListener('click', () => this.setMix(i, { mute: !mixFor(this.s, i).mute }));
      solo.addEventListener('click', () => this.setMix(i, { solo: !mixFor(this.s, i).solo }));
      const vol = h('input', { type: 'range', min: 0, max: 2, step: 0.05, class: 'vol', 'aria-label': `${track.name} volume` });
      vol.value = String(mix.volume);
      vol.addEventListener('input', () => this.setMix(i, { volume: Number(vol.value) }, false));
      return h(
        'li',
        { class: shown ? 'shown' : '' },
        h('label', { class: 'track-show' }, showBox),
        h(
          'button',
          { class: 'track-name', title: 'Show only this track', onclick: () => this.showOnly(i) },
          h('span', {}, track.name || `Track ${i + 1}`),
          h('span', { class: 'muted small' }, trackKind(track)),
        ),
        mute,
        solo,
        vol,
      );
    });
    this.el.drawer.replaceChildren(
      h(
        'div',
        { class: 'drawer-head' },
        h('strong', {}, 'Tracks'),
        h('span', { class: 'muted small' }, 'Tap a name to show only that part. Muted tracks stay on screen; hidden tracks still play.'),
      ),
      h('ul', { class: 'tracks' }, ...rows),
      h(
        'div',
        { class: 'drawer-foot' },
        h('button', { class: 'btn small', onclick: () => this.showAll() }, 'Show all'),
        h('button', { class: 'btn small', onclick: () => this.resetMix() }, 'Reset mixer'),
      ),
    );
  }

  private showOnly(i: number): void {
    this.s.shownTracks = [i];
    this.renderTracks();
  }

  private showAll(): void {
    if (!this.score) return;
    this.s.shownTracks = this.score.tracks.map((t) => t.index);
    this.renderTracks();
  }

  private setShown(i: number, on: boolean): void {
    const set = new Set(this.s.shownTracks);
    if (on) set.add(i);
    else set.delete(i);
    if (!set.size) {
      toast('At least one track has to stay on screen');
      this.renderDrawer();
      return;
    }
    this.s.shownTracks = [...set].sort((a, b) => a - b);
    this.renderTracks();
  }

  private renderTracks(): void {
    if (!this.score) return;
    const tracks = this.s.shownTracks.map((i) => this.score!.tracks[i]).filter(Boolean) as Track[];
    this.api.renderTracks(tracks);
    this.renderDrawer();
    this.save();
  }

  private setMix(i: number, patch: Partial<SongSettings['mix'][number]>, redraw = true): void {
    this.s.mix[i] = { ...mixFor(this.s, i), ...patch };
    this.applyMix();
    if (redraw) this.renderDrawer();
    this.save();
  }

  private resetMix(): void {
    this.s.mix = {};
    this.applyMix();
    this.renderDrawer();
    this.save();
  }

  private applyMix(): void {
    if (!this.score || !this.api) return;
    for (const track of this.score.tracks) {
      const mix = mixFor(this.s, track.index);
      this.api.changeTrackMute([track], mix.mute);
      this.api.changeTrackSolo([track], mix.solo);
      this.api.changeTrackVolume([track], mix.volume);
    }
  }

  // ---------- view menu ----------

  private toggleViewMenu(): void {
    this.el.drawer.hidden = true;
    this.el.viewMenu.hidden = !this.el.viewMenu.hidden;
    setPressed(this.el.viewBtn, !this.el.viewMenu.hidden);
    setPressed(this.el.tracksBtn, false);
    if (!this.el.viewMenu.hidden) this.renderViewMenu();
  }

  private renderViewMenu(): void {
    const choice = <T extends string>(label: string, current: T, options: [T, string][], set: (v: T) => void) =>
      h(
        'div',
        { class: 'menu-row' },
        h('span', { class: 'muted' }, label),
        h(
          'div',
          { class: 'seg' },
          ...options.map(([value, text]) => {
            const b = h('button', { class: 'btn small toggle' }, text);
            setPressed(b, value === current);
            b.addEventListener('click', () => {
              set(value);
              this.renderViewMenu();
            });
            return b;
          }),
        ),
      );

    this.el.viewMenu.replaceChildren(
      choice<StaveMode>('Show', this.s.stave, [['tab', 'Tab'], ['scoretab', 'Notes + tab'], ['score', 'Notes']], (v) => {
        this.s.stave = v;
        this.api.settings.display.staveProfile = STAVE[v];
        this.rerender();
      }),
      choice<'page' | 'horizontal'>('Layout', this.s.layout, [['page', 'Page'], ['horizontal', 'One line']], (v) => {
        this.s.layout = v;
        this.api.settings.display.layoutMode = v === 'horizontal' ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
        this.rerender();
      }),
      h(
        'div',
        { class: 'menu-row' },
        h('span', { class: 'muted' }, 'Zoom'),
        h(
          'div',
          { class: 'seg' },
          h('button', { class: 'btn small', onclick: () => this.zoom(-0.1), 'aria-label': 'Zoom out' }, '−'),
          h('span', { class: 'zoom-val' }, `${Math.round(this.s.zoom * 100)}%`),
          h('button', { class: 'btn small', onclick: () => this.zoom(0.1), 'aria-label': 'Zoom in' }, '+'),
        ),
      ),
    );
  }

  private zoom(delta: number): void {
    this.s.zoom = Math.round(Math.min(2, Math.max(0.5, this.s.zoom + delta)) * 10) / 10;
    this.api.settings.display.scale = this.s.zoom;
    this.rerender();
    this.renderViewMenu();
  }

  private rerender(): void {
    this.api.updateSettings();
    this.api.render();
    this.save();
  }

  // ---------- misc ----------

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    }
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'visible' && this.api?.playerState === alphaTab.synth.PlayerState.Playing) {
      void this.setWakeLock(true);
    }
  };

  private async setWakeLock(on: boolean): Promise<void> {
    const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    try {
      if (on && wl && !this.wakeLock) this.wakeLock = await wl.request('screen');
      if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      /* wake lock refused; not fatal */
    }
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      void updateSong(this.song.id, { settings: structuredClone(this.s) });
    }, 300);
  }

  dispose(): void {
    clearTimeout(this.saveTimer);
    void updateSong(this.song.id, { settings: structuredClone(this.s) });
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.setWakeLock(false);
    this.api?.destroy();
  }
}

function setPressed(el: HTMLElement, on: boolean): void {
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function holdToRepeat(el: HTMLElement, fn: () => void): void {
  let delay: number | undefined;
  let repeat: number | undefined;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
  };
  el.addEventListener('pointerdown', () => {
    stop();
    delay = window.setTimeout(() => (repeat = window.setInterval(fn, 70)), 400);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, stop);
}

function defaultTrack(score: alphaTab.model.Score): number {
  const guitar = score.tracks.find((t) => !t.staves[0]?.isPercussion && t.staves.some((s) => s.showTablature && s.tuning.length >= 6));
  return (guitar ?? score.tracks.find((t) => !t.staves[0]?.isPercussion) ?? score.tracks[0]).index;
}

function trackKind(track: Track): string {
  const staff = track.staves[0];
  if (!staff) return '';
  if (staff.isPercussion) return 'Drums';
  const n = staff.tuning.length;
  if (n === 4 || n === 5) return `${n}-string bass`;
  if (n >= 6) return `${n}-string`;
  return '';
}
