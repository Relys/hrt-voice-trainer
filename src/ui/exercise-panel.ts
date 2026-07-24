import { noteNameForFrequency } from "../render/frequency-axis.ts";
import type { ExerciseDefinition } from "../state/exercises.ts";
import type { SessionSummary } from "../storage/sessions.ts";

/** Read at ~1Hz (every countdown tick) — a quick glance during the exercise, not a full HUD replica. */
export interface LiveExerciseStatus {
  pitchHz: number | null;
  /** null when no target range is set in Settings, so there's nothing to compare against. */
  inTarget: boolean | null;
  ringTwangPct: number | null;
}

export interface ExercisePanelCallbacks {
  onStart: (exercise: ExerciseDefinition) => Promise<void>;
  onFinish: () => Promise<SessionSummary | null>;
  onCancel: () => void;
  getLiveStatus: () => LiveExerciseStatus | null;
}

export class ExercisePanel {
  private countdownHandle: number | undefined;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ExercisePanelCallbacks,
    private readonly exercises: ExerciseDefinition[],
  ) {
    this.renderList();
  }

  private renderList(): void {
    const { container } = this;
    container.innerHTML = `<h3 class="settings-subhead">Guided Exercises</h3>`;
    for (const exercise of this.exercises) {
      const row = document.createElement("div");
      row.className = "exercise-row";
      row.innerHTML = `<strong>${exercise.title}</strong><p class="settings-note">${exercise.instructions} (${exercise.durationSec}s)</p>`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Start";
      btn.addEventListener("click", () => void this.runExercise(exercise));
      row.appendChild(btn);
      container.appendChild(row);
    }
  }

  private async runExercise(exercise: ExerciseDefinition): Promise<void> {
    const { container } = this;
    container.innerHTML = `
      <h3 class="settings-subhead">${exercise.title}</h3>
      <p class="settings-note">${exercise.instructions}</p>
      <div class="exercise-countdown" id="ex-countdown">${exercise.durationSec}</div>
      <div class="exercise-live-status" id="ex-live-status"></div>
    `;
    const countdownEl = container.querySelector<HTMLElement>("#ex-countdown")!;
    const liveStatusEl = container.querySelector<HTMLElement>("#ex-live-status")!;
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    container.appendChild(cancelBtn);

    let cancelled = false;
    cancelBtn.addEventListener("click", () => {
      cancelled = true;
      if (this.countdownHandle !== undefined) window.clearInterval(this.countdownHandle);
      this.callbacks.onCancel();
      this.renderList();
    });

    await this.callbacks.onStart(exercise);
    if (cancelled) return;
    this.updateLiveStatus(liveStatusEl);

    let remaining = exercise.durationSec;
    await new Promise<void>((resolve) => {
      this.countdownHandle = window.setInterval(() => {
        remaining -= 1;
        countdownEl.textContent = String(Math.max(0, remaining));
        this.updateLiveStatus(liveStatusEl);
        if (remaining <= 0) {
          window.clearInterval(this.countdownHandle);
          resolve();
        }
      }, 1000);
    });
    if (cancelled) return;

    const summary = await this.callbacks.onFinish();
    if (cancelled) return;
    this.renderResults(exercise, summary);
  }

  private updateLiveStatus(el: HTMLElement): void {
    const status = this.callbacks.getLiveStatus();
    if (!status) {
      el.textContent = "";
      return;
    }
    const parts: string[] = [];
    if (status.pitchHz !== null) parts.push(`Pitch: ${Math.round(status.pitchHz)} Hz`);
    if (status.inTarget !== null) parts.push(status.inTarget ? "✓ in target" : "outside target");
    if (status.ringTwangPct !== null) parts.push(`Ring/Twang: ${status.ringTwangPct.toFixed(1)}%`);
    el.textContent = parts.length > 0 ? parts.join("  ·  ") : "Listening…";
  }

  private renderResults(exercise: ExerciseDefinition, summary: SessionSummary | null): void {
    const { container } = this;
    container.innerHTML = `<h3 class="settings-subhead">${exercise.title} &mdash; Results</h3>`;

    if (!summary || summary.voicedFrameCount === 0) {
      container.innerHTML +=
        '<p class="settings-note">No voiced signal was detected during the exercise — try again a little louder or closer to the mic.</p>';
    } else {
      const lines: string[] = [];
      if (summary.avgPitchHz !== null) {
        lines.push(`Average pitch: ${Math.round(summary.avgPitchHz)} Hz (${noteNameForFrequency(summary.avgPitchHz)})`);
      }
      if (summary.pitchStddevSemitones !== null) {
        lines.push(`Pitch variation: ${summary.pitchStddevSemitones.toFixed(1)} semitones`);
      }
      if (summary.avgCppDb !== null) {
        lines.push(`Average weight (CPP): ${summary.avgCppDb.toFixed(1)} dB`);
      }
      if (summary.percentInTargetRange !== null) {
        lines.push(`Time in your target range: ${Math.round(summary.percentInTargetRange * 100)}%`);
      }
      container.innerHTML += `<ul class="exercise-results">${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
    }

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => this.renderList());
    container.appendChild(doneBtn);
  }
}
