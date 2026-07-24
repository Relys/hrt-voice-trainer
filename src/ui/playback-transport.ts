import type { PlaybackHandle } from "../audio/playback.ts";

export interface PlaybackTransportElements {
  bar: HTMLDivElement;
  playPauseBtn: HTMLButtonElement;
  skipBackBtn: HTMLButtonElement;
  skipFwdBtn: HTMLButtonElement;
  seek: HTMLInputElement;
  time: HTMLSpanElement;
  closeBtn: HTMLButtonElement;
}

const SKIP_SECONDS = 5;

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/**
 * Owns the play/pause/seek/skip transport bar and the one active `PlaybackHandle` it controls.
 * `attach`/`stop` take full responsibility for the handle's lifecycle so callers never touch a
 * `PlaybackHandle` directly — that's what let a prior seek/pause bug (silent frames still being
 * logged while paused, stale displays after a seek) slip through, since state was split across
 * both a handle reference and separate DOM bookkeeping in two different places.
 */
export class PlaybackTransport {
  private handle: PlaybackHandle | undefined;
  private isScrubbing = false;

  constructor(
    private readonly el: PlaybackTransportElements,
    private readonly onSeek: () => void,
    private readonly onClose: () => void,
  ) {
    el.playPauseBtn.addEventListener("click", () => this.togglePlayPause());
    el.skipBackBtn.addEventListener("click", () => this.seekRelative(-SKIP_SECONDS));
    el.skipFwdBtn.addEventListener("click", () => this.seekRelative(SKIP_SECONDS));
    el.seek.addEventListener("pointerdown", () => {
      this.isScrubbing = true;
    });
    el.seek.addEventListener("pointerup", () => {
      this.isScrubbing = false;
    });
    el.seek.addEventListener("input", () => {
      if (!this.handle) return;
      this.onSeek();
      this.handle.seek(Number(el.seek.value));
    });
    el.closeBtn.addEventListener("click", () => this.onClose());
  }

  isActive(): boolean {
    return this.handle !== undefined;
  }

  /** Takes ownership of a freshly started playback handle and shows the transport bar. */
  attach(handle: PlaybackHandle): void {
    this.handle = handle;
    this.el.bar.hidden = false;
    this.el.playPauseBtn.textContent = "Pause";
    const duration = handle.getDuration();
    this.el.seek.max = String(duration);
    this.el.time.textContent = `${formatTime(0)} / ${formatTime(duration)}`;
    handle.onTimeUpdate((currentTime, totalDuration) => {
      if (!this.isScrubbing) this.el.seek.value = String(currentTime);
      this.el.time.textContent = `${formatTime(currentTime)} / ${formatTime(totalDuration)}`;
    });
  }

  /** Reaching the end of a clip just pauses — the bar stays up so the user can rewind and replay. */
  markEnded(): void {
    this.el.playPauseBtn.textContent = "Play";
  }

  togglePlayPause(): void {
    if (!this.handle) return;
    if (this.handle.isPaused()) {
      this.handle.play();
      this.el.playPauseBtn.textContent = "Pause";
    } else {
      this.handle.pause();
      this.el.playPauseBtn.textContent = "Play";
    }
  }

  /** Stops the underlying handle (if any) and hides the transport bar. Safe to call idly. */
  stop(): void {
    this.handle?.stop();
    this.handle = undefined;
    this.el.bar.hidden = true;
  }

  private seekRelative(deltaSeconds: number): void {
    if (!this.handle) return;
    this.onSeek();
    this.handle.seek(this.handle.getCurrentTime() + deltaSeconds);
  }
}
