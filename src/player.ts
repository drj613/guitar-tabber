import * as alphaTab from '@coderline/alphatab';
import { getSong, getSongBytes, updateSong, type SongMeta } from './db';
import { formatTime, h, toast } from './dom';
import { backButton, closeButton, icon, led } from './icons';
import { preferPlaybackAudioSession } from './metronome';
import { createTempoControl, type TempoControl } from './tempoControl';
import { mixFor, normalizeSettings, type SongSettings, type StaveMode } from './songSettings';
import { defaultTrack } from './importer';
import { bpmRange, clampBpm, speedForBpm } from './tempo';

const BASE = import.meta.env.BASE_URL;

const STAVE: Record<StaveMode, alphaTab.StaveProfile> = {
  tab: alphaTab.StaveProfile.Tab,
  scoretab: alphaTab.StaveProfile.ScoreTab,
  score: alphaTab.StaveProfile.Score,
};

type Track = alphaTab.model.Track;
type Beat = alphaTab.model.Beat;

export async function renderPlayer(
  root: HTMLElement,
  songId: string,
  back: () => void,
  isStale: () => boolean,
): Promise<() => void> {
  const song = await getSong(songId);
  const bytes = await getSongBytes(songId);
  if (isStale()) return () => {};
  if (!song || !bytes) {
    toast('That tab is no longer on this device');
    back();
    return () => {};
  }
  void updateSong(songId, { lastOpenedAt: Date.now() });
  if (song.kind === 'pdf') {
    const { renderPdfView } = await import('./pdfView');
    if (isStale()) return () => {};
    return renderPdfView(root, song, new Uint8Array(bytes), back);
  }
  return new PlayerView(root, song, new Uint8Array(bytes), back).dispose;
}

class PlayerView {
  private s: SongSettings;
  private api!: alphaTab.AlphaTabApi;
  private score: alphaTab.model.Score | null = null;
  private baseBpm = 120;
  private currentBar = 0;
  /** Bar the loop panel's "Use bar" buttons refer to: the last tapped bar, or the bar playing. */
  private selectedBar = 0;
  /** Range we last sent to alphaTab, so its echo event is not mistaken for a user selection. */
  private sentRange: { startTick: number; endTick: number } | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  private saveTimer: number | undefined;
  private tempo: TempoControl;

  // elements
  private el = {
    surface: h('div', { class: 'score-surface' }),
    scroller: h('div', { class: 'score-scroll' }),
    overlay: h('div', { class: 'score-overlay' }, 'Loading…'),
    play: h('button', { class: 'btn transport play', 'aria-label': 'Play' }, icon('play', 24)),
    stop: h('button', { class: 'btn transport stop', 'aria-label': 'Stop' }, icon('stop')),
    time: h('span', { class: 'time' }, '0:00 / 0:00'),
    bar: h('span', { class: 'bar-pos' }, 'Bar 1'),
    click: h('button', { class: 'btn switch' }, led(), h('span', {}, 'Click')),
    countIn: h('button', { class: 'btn switch' }, led(), h('span', {}, 'Count-in')),
    loop: h('button', { class: 'btn switch' }, led(), h('span', {}, 'Loop')),
    loopRangeText: h('span', { class: 'loop-range-text' }, 'Set range'),
    loopRange: h('button', { class: 'btn loop-range', 'aria-label': 'Edit loop range', 'aria-haspopup': 'dialog' }),
    tracksBtn: h('button', { class: 'btn' }, 'Tracks'),
    viewBtn: h('button', { class: 'btn' }, 'View'),
    drawer: h('aside', { class: 'drawer', hidden: true }),
    viewMenu: h('div', { class: 'popover', hidden: true }),
    loopPanel: h('div', { class: 'popover loop-panel', role: 'dialog', 'aria-label': 'Loop range', hidden: true }),
  };

  constructor(
    private root: HTMLElement,
    private song: SongMeta,
    private bytes: Uint8Array,
    private back: () => void,
  ) {
    this.s = normalizeSettings(song.settings);
    this.dispose = this.dispose.bind(this);
    this.tempo = createTempoControl({
      min: 20,
      max: 360,
      value: 120,
      base: 120,
      onChange: (bpm) => this.setBpm(bpm),
    });
    this.build();
    this.createApi();
  }

  // ---------- layout ----------

  private build(): void {
    const e = this.el;
    e.scroller.append(e.surface);
    e.loopRange.append(e.loopRangeText, icon('up', 16));
    const header = h(
      'header',
      { class: 'bar' },
      backButton(() => this.back()),
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
      h('div', { class: 'group play-group' }, e.stop, e.play, h('div', { class: 'pos' }, e.time, e.bar)),
      h('div', { class: 'group tempo' }, this.tempo.el),
      h('div', { class: 'group pair', role: 'group', 'aria-label': 'Click' }, e.click, e.countIn),
      h('div', { class: 'group pair loop-pair', role: 'group', 'aria-label': 'Loop' }, e.loop, e.loopRange),
    );

    this.root.replaceChildren(
      h(
        'div',
        { class: 'player' },
        header,
        h('div', { class: 'score-wrap' }, e.scroller, e.overlay, e.drawer, e.viewMenu, e.loopPanel),
        transport,
      ),
    );

    e.play.addEventListener('click', () => this.togglePlay());
    e.stop.addEventListener('click', () => this.api?.stop());
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
    e.loopRange.addEventListener('click', () => this.togglePanel('loop'));
    e.tracksBtn.addEventListener('click', () => this.togglePanel('tracks'));
    e.viewBtn.addEventListener('click', () => this.togglePanel('view'));
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.flush);
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
        // Tapping a bar seeks there without dropping the loop range.
        resetPlaybackRangeOnClick: false,
      },
    });
    this.api = api;

    api.scoreLoaded.on((score) => {
      this.score = score;
      this.baseBpm = score.tempo || 120;
      if (!this.s.shownTracks.length || this.s.shownTracks.some((i) => i >= score.tracks.length)) {
        // Older records without a stored default: alphaTab drew track 0, so redraw the right one.
        this.s.shownTracks = [defaultTrack(score)];
        if (this.s.shownTracks[0] !== 0) api.renderTracks([score.tracks[this.s.shownTracks[0]]]);
        this.save();
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
      // Redrawing (track or view change) drops the loop highlight; put it back.
      this.applyLoop();
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
      this.el.play.replaceChildren(icon(playing ? 'pause' : 'play', 24));
      this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      this.el.play.classList.toggle('playing', playing);
      void this.setWakeLock(playing);
    });
    api.playerPositionChanged.on((e) => {
      this.el.time.textContent = `${formatTime(e.currentTime)} / ${formatTime(e.endTime)}`;
      // Seeks (taps, loop jumps, stop) move the playhead without a played beat.
      const bar = this.barAtTick(e.currentTick);
      if (bar !== null) this.setCurrentBarIndex(bar);
    });
    api.playedBeatChanged.on((beat) => {
      this.setCurrentBarIndex(beat.voice.bar.masterBar.index);
      this.setSelectedBar(beat.voice.bar.masterBar.index);
    });
    // A tap selects its bar even when an active loop keeps the playhead elsewhere.
    api.beatMouseDown.on((beat) => this.setSelectedBar(beat.voice.bar.masterBar.index));
    api.playbackRangeChanged.on((e) => {
      const range = e.playbackRange;
      const sent = this.sentRange;
      // alphaTab echoes ranges we set ourselves (asynchronously, via the worker).
      if (sameRange(range, sent)) return;
      if (!range) return; // only our own code clears the range
      const start = this.barAtTick(range.startTick);
      const end = this.barAtTick(Math.max(range.startTick, range.endTick - 1));
      if (start === null || end === null) return;
      // A drag selection on the score: loop it.
      this.s.loopBars = { start, end };
      this.s.loop = true;
      this.applyLoop();
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
    if (this.s.bpm !== null) this.s.bpm = clampBpm(this.baseBpm, this.s.bpm);
    this.tempo.setRange(min, max, this.baseBpm);
    this.tempo.set(this.s.bpm ?? this.baseBpm);
  }

  private setBpm(bpm: number): void {
    this.s.bpm = clampBpm(this.baseBpm, bpm);
    if (this.s.bpm === this.baseBpm) this.s.bpm = null;
    this.applySpeed();
    this.save();
  }

  private applySpeed(): void {
    if (this.api) this.api.playbackSpeed = speedForBpm(this.baseBpm, this.s.bpm);
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

  private setCurrentBarIndex(bar: number): void {
    if (bar === this.currentBar) return;
    this.currentBar = bar;
    this.el.bar.textContent = `Bar ${bar + 1}`;
  }

  private setSelectedBar(bar: number): void {
    if (bar === this.selectedBar) return;
    this.selectedBar = bar;
    if (!this.el.loopPanel.hidden) this.renderLoopPanel();
  }

  private get barCount(): number {
    return this.score?.masterBars.length ?? 1;
  }

  /** Moves one end of the loop; the other end follows if they would cross. Turns Loop on. */
  private setLoopEdge(edge: 'start' | 'end', bar: number): void {
    bar = Math.min(this.barCount - 1, Math.max(0, bar));
    const range = { ...(this.s.loopBars ?? { start: bar, end: bar }) };
    if (edge === 'start') {
      range.start = bar;
      if (range.end < bar) range.end = bar;
    } else {
      range.end = bar;
      if (range.start > bar) range.start = bar;
    }
    this.setLoopBars(range);
  }

  private setLoopBars(range: { start: number; end: number } | null): void {
    this.s.loopBars = range;
    this.s.loop = range !== null;
    this.applyLoop();
    this.save();
    if (!this.el.loopPanel.hidden) this.renderLoopPanel();
  }

  private renderLoopPanel(): void {
    const b = this.s.loopBars;
    const cur = this.selectedBar;
    const edgeRow = (edge: 'start' | 'end', label: string) => {
      const value = b ? b[edge] : null;
      const step = (d: number) => this.setLoopEdge(edge, (value ?? cur) + d);
      return h(
        'div',
        { class: 'loop-row' },
        h('span', { class: 'loop-row-label' }, label),
        h(
          'div',
          { class: 'stepper' },
          h('button', { class: 'btn small', 'aria-label': `${label} bar earlier`, onclick: () => step(-1), disabled: value === 0 }, icon('minus')),
          h('span', { class: 'stepper-value', 'aria-live': 'polite' }, value === null ? 'Not set' : `Bar ${value + 1}`),
          h('button', { class: 'btn small', 'aria-label': `${label} bar later`, onclick: () => step(1), disabled: value === this.barCount - 1 }, icon('plus')),
        ),
        h(
          'button',
          { class: 'btn small', 'aria-label': `${label} at current bar`, onclick: () => this.setLoopEdge(edge, cur) },
          `Use bar ${cur + 1}`,
        ),
      );
    };
    this.el.loopPanel.replaceChildren(
      h('div', { class: 'panel-head' }, h('strong', {}, 'Loop range'), closeButton(() => this.togglePanel('loop'))),
      edgeRow('start', 'Start'),
      edgeRow('end', 'End'),
      h(
        'div',
        { class: 'loop-actions' },
        h('button', { class: 'btn small', onclick: () => this.setLoopBars({ start: cur, end: cur }) }, `Loop bar ${cur + 1} only`),
        h('button', { class: 'btn small quiet', 'aria-label': 'Clear loop range', onclick: () => this.setLoopBars(null), disabled: !b }, 'Clear'),
      ),
      h('p', { class: 'hint' }, 'Tap a bar on the score to pick it, then use it as the start or end. With a Pencil or mouse, drag across bars to loop them.'),
    );
  }

  private togglePanel(which: 'tracks' | 'view' | 'loop'): void {
    const panels = { tracks: this.el.drawer, view: this.el.viewMenu, loop: this.el.loopPanel };
    const buttons = { tracks: this.el.tracksBtn, view: this.el.viewBtn, loop: this.el.loopRange };
    const opening = panels[which].hidden;
    for (const key of Object.keys(panels) as (keyof typeof panels)[]) {
      panels[key].hidden = !(opening && key === which);
      buttons[key].setAttribute('aria-expanded', String(opening && key === which));
    }
    if (opening && which === 'view') this.renderViewMenu();
    if (opening && which === 'loop') this.renderLoopPanel();
  }

  private barAtTick(tick: number): number | null {
    const lookups = this.api.tickCache?.masterBars;
    if (!lookups) return null;
    for (const mb of lookups) if (tick >= mb.start && tick < mb.end) return mb.masterBar.index;
    return null;
  }

  /**
   * Sends the loop to alphaTab. The range only applies while Loop is on, so
   * with Loop off the whole song plays and the saved bars wait for next time.
   * Repeated bars loop on their first pass.
   */
  private applyLoop(): void {
    setPressed(this.el.loop, this.s.loop);
    this.updateLoopUi();
    const api = this.api;
    const lookups = api?.tickCache?.masterBars;
    if (!api || !lookups) return; // midiLoaded calls this again once timing data exists
    api.isLooping = this.s.loop;
    const bars = this.s.loop ? this.s.loopBars : null;
    const first = bars && lookups.find((mb) => mb.masterBar.index === bars.start);
    const last = bars && first && lookups.find((mb) => mb.masterBar.index === bars.end && mb.start >= first.start);
    if (!bars || !first || !last) {
      this.sentRange = null;
      api.playbackRange = null;
      api.clearPlaybackRangeHighlight();
      return;
    }
    this.sentRange = { startTick: first.start, endTick: last.end };
    api.playbackRange = { ...this.sentRange } as alphaTab.synth.PlaybackRange;
    const beats = this.edgeBeats(bars.start, bars.end);
    if (beats) api.highlightPlaybackRange(beats[0], beats[1]);
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
    this.el.loopRangeText.textContent = b ? (b.start === b.end ? `Bar ${b.start + 1}` : `Bars ${b.start + 1}–${b.end + 1}`) : 'Set range';
    this.el.loopRange.classList.toggle('empty', !b);
    // A saved range waits while Loop is off; show it as dormant.
    this.el.loopRange.classList.toggle('dormant', !!b && !this.s.loop);
  }

  // ---------- tracks ----------

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
      const mute = h('button', { class: 'btn small toggle', 'aria-label': `Mute ${track.name}` }, 'Mute');
      const solo = h('button', { class: 'btn small toggle', 'aria-label': `Solo ${track.name}` }, 'Solo');
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
        h('div', { class: 'panel-head' }, h('strong', {}, 'Tracks'), closeButton(() => this.togglePanel('tracks'))),
        h('span', { class: 'hint' }, 'Tap a name to show only that part. Muted tracks stay on screen; hidden tracks still play.'),
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

  private renderViewMenu(): void {
    const choice = <T extends string>(label: string, current: T, options: [T, string][], set: (v: T) => void) =>
      h(
        'div',
        { class: 'menu-row' },
        h('span', { class: 'muted' }, label),
        h(
          'div',
          { class: 'seg choice' },
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
          h('button', { class: 'btn small', onclick: () => this.zoom(-0.1), 'aria-label': 'Zoom out' }, icon('minus')),
          h('span', { class: 'zoom-val' }, `${Math.round(this.s.zoom * 100)}%`),
          h('button', { class: 'btn small', onclick: () => this.zoom(0.1), 'aria-label': 'Zoom in' }, icon('plus')),
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
    if (e.target instanceof HTMLButtonElement) return;
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePlay();
    }
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.flush();
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
    this.saveTimer = window.setTimeout(this.flush, 300);
  }

  private flush = (): void => {
    clearTimeout(this.saveTimer);
    void updateSong(this.song.id, { settings: structuredClone(this.s) });
  };

  dispose(): void {
    this.flush();
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.flush);
    void this.setWakeLock(false);
    this.api?.destroy();
  }
}

function sameRange(
  a: { startTick: number; endTick: number } | null,
  b: { startTick: number; endTick: number } | null,
): boolean {
  if (!a || !b) return a === b;
  return a.startTick === b.startTick && a.endTick === b.endTick;
}

function setPressed(el: HTMLElement, on: boolean): void {
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
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
