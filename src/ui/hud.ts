import { classifyVowel } from "../dsp/vowel.ts";
import { noteNameForFrequency } from "../render/frequency-axis.ts";
import { drawSparkline } from "../render/sparkline.ts";
import { goldAccent } from "../render/theme.ts";
import type { SpectrumResult } from "../shared/protocol.ts";
import type { SmoothedFeedback } from "../state/feedback-smoother.ts";
import { MetricHistory } from "../state/metric-history.ts";
import { resolveTargetRange, targetDistanceHz, type ViewSettings } from "../state/view-settings.ts";

/** Plain-language explanations shown by each metric's info bubble — written for a voice trainer
 *  or student, not a DSP audience, but accurate to what's actually computed (see src/dsp/*.ts). */
const INFO = {
  level: "Raw microphone input level in dB, shown instantly with no smoothing or gating — use it to check you're loud enough without clipping. It's a gain-staging aid, not an acoustic-quality measure.",
  pitch: "Fundamental frequency (F0), estimated with the YIN algorithm from how strongly the waveform matches a delayed copy of itself. The note name is the nearest musical pitch.",
  inflection: "How much your pitch moves around, not just where it sits — the standard deviation of pitch (in semitones) over roughly the last few seconds of voiced speech. Low = monotone, high = varied/expressive.",
  cpp: 'Cepstral Peak Prominence — a standard clinical measure of vocal "weight"/breathiness (Hillenbrand & Houde, 1996). A clean, resonant voice has a sharp cepstral peak; a breathy voice has a flatter one. Higher dB = fuller, less breathy.',
  hnr: "Harmonic-to-Noise Ratio in dB — how strongly the waveform correlates with a shifted copy of itself at your pitch period. Periodic, clear voice scores high; breathy or noisy voice scores low.",
  perturbation: "Frame-to-frame percent change in pitch period (jitter) and amplitude (shimmer) — approximate perturbation indicators, useful as a trend. True clinical jitter/shimmer are measured cycle-by-cycle on individual glottal pulses; this is a coarser ~10ms-frame approximation, not a diagnostic number.",
  ring: 'Percent of total spectral energy in the 2.8-3.5 kHz "singer\'s formant" band. More energy there reads as a brighter, more forward, ringing quality.',
  f1: "First vocal-tract resonance (formant), estimated via Linear Predictive Coding. Relates mostly to jaw/tongue height (open vs. closed vowels).",
  f2: "Second vocal-tract resonance (formant), estimated via Linear Predictive Coding. Relates mostly to tongue front/back position — the main driver of perceived brightness/resonance.",
  f3: "Third vocal-tract resonance (formant), estimated via Linear Predictive Coding. Contributes to \"ring\"/timbre quality and, along with F4, to the singer's-formant clustering measured separately by Ring/Twang. Noisier frame-to-frame than F1/F2 — treat it as a coarser trend, not a precise readout.",
  avgFormant: "Mean of whichever formants (F1/F2/F3) are currently detected — a single rough resonance-brightness indicator.",
  ianchor: 'Difference between your current F2 and the F2 you calibrated while sustaining an /i/ ("ee") vowel. Based on carrying that vowel\'s tongue position across other vowels to brighten resonance consistently.',
  targetDistance:
    "How far your pitch is from your Target range band, in Hz — negative means below the band, positive means above it, zero means you're inside it. A companion to \"% in target\" (History/Progress): that's a strict hit/miss count, this shows which direction to adjust and by how much. Only meaningful when a Target range is set in Settings.",
  vowel: "Nearest-neighbor match of your current F1/F2 position against averaged American English vowel formants (Hillenbrand et al. 1995). Approximate, not a diagnostic vowel classifier.",
} as const satisfies Record<string, string>;

function infoButton(id: string, label: string, text: string): string {
  return `<button type="button" class="info-btn" aria-expanded="false" aria-controls="info-${id}" aria-label="About ${label}">i</button><div class="info-bubble" id="info-${id}" role="note" hidden>${text}</div>`;
}

/** Visual scaling only, applied to meter bar widths — these ratios/ranges are typically small. */
const RING_METER_GAIN = 4;
const LEVEL_METER_MIN_DB = -60;
const LEVEL_METER_MAX_DB = 0;
/** ~10s of history at the ~100Hz analysis frame rate — a rolling trend, not a full session log. */
const HISTORY_LENGTH = 1000;

export class Hud {
  private readonly pitchHistory = new MetricHistory(HISTORY_LENGTH);
  private readonly targetDistanceHistory = new MetricHistory(HISTORY_LENGTH);
  private readonly cppHistory = new MetricHistory(HISTORY_LENGTH);
  private readonly hnrHistory = new MetricHistory(HISTORY_LENGTH);
  private readonly ringHistory = new MetricHistory(HISTORY_LENGTH);
  private readonly inflectionHistory = new MetricHistory(HISTORY_LENGTH);

  constructor(private readonly container: HTMLElement) {
    container.innerHTML = `
      <div class="hud-item hud-level" data-role="level-item">
        <span class="hud-label">Input</span>
        ${infoButton("level", "Input level", INFO.level)}
        <div class="hud-meter"><div class="hud-meter-fill" data-role="level-fill"></div></div>
        <span class="hud-value" data-role="level-value">--</span>
      </div>
      <div class="hud-item" data-role="pitch-item">
        <span class="hud-label">Pitch</span>
        ${infoButton("pitch", "Pitch", INFO.pitch)}
        <span class="hud-value" data-role="pitch-value">--</span>
        <span class="hud-range-dot" data-role="pitch-range-dot" hidden></span>
        <canvas class="hud-sparkline" data-role="pitch-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="target-distance-item">
        <span class="hud-label">Target &Delta;</span>
        ${infoButton("target-distance", "Target Distance", INFO.targetDistance)}
        <span class="hud-value" data-role="target-distance-value">--</span>
        <canvas class="hud-sparkline" data-role="target-distance-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="inflection-item">
        <span class="hud-label">Inflection</span>
        ${infoButton("inflection", "Inflection", INFO.inflection)}
        <span class="hud-value" data-role="inflection-value">--</span>
        <canvas class="hud-sparkline" data-role="inflection-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="cpp-item">
        <span class="hud-label">Weight</span>
        ${infoButton("cpp", "Weight", INFO.cpp)}
        <span class="hud-value" data-role="cpp-value">--</span>
        <canvas class="hud-sparkline" data-role="cpp-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="hnr-item">
        <span class="hud-label">HNR</span>
        ${infoButton("hnr", "HNR", INFO.hnr)}
        <span class="hud-value" data-role="hnr-value">--</span>
        <canvas class="hud-sparkline" data-role="hnr-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="perturbation-item">
        <span class="hud-label">Jitter/Shimmer</span>
        ${infoButton("perturbation", "Jitter/Shimmer", INFO.perturbation)}
        <span class="hud-value" data-role="perturbation-value">--</span>
      </div>
      <div class="hud-item hud-ring" data-role="ring-item">
        <span class="hud-label">Ring/Twang</span>
        ${infoButton("ring", "Ring/Twang", INFO.ring)}
        <div class="hud-meter"><div class="hud-meter-fill" data-role="ring-fill"></div></div>
        <span class="hud-value" data-role="ring-value">--</span>
        <canvas class="hud-sparkline" data-role="ring-spark" width="60" height="20"></canvas>
      </div>
      <div class="hud-item" data-role="f1-item">
        <span class="hud-label">F1</span>
        ${infoButton("f1", "F1", INFO.f1)}
        <span class="hud-value" data-role="f1-value">--</span>
      </div>
      <div class="hud-item" data-role="f2-item">
        <span class="hud-label">F2</span>
        ${infoButton("f2", "F2", INFO.f2)}
        <span class="hud-value" data-role="f2-value">--</span>
      </div>
      <div class="hud-item" data-role="f3-item">
        <span class="hud-label">F3</span>
        ${infoButton("f3", "F3", INFO.f3)}
        <span class="hud-value" data-role="f3-value">--</span>
      </div>
      <div class="hud-item" data-role="avg-formant-item">
        <span class="hud-label">Avg Formant</span>
        ${infoButton("avg-formant", "Avg Formant", INFO.avgFormant)}
        <span class="hud-value" data-role="avg-formant-value">--</span>
      </div>
      <div class="hud-item" data-role="ianchor-item">
        <span class="hud-label">&Delta;F2 vs /i/</span>
        ${infoButton("ianchor", "Delta F2 vs /i/", INFO.ianchor)}
        <span class="hud-value" data-role="ianchor-value">not set</span>
      </div>
      <div class="hud-item" data-role="vowel-item">
        <span class="hud-label">Vowel</span>
        ${infoButton("vowel", "Vowel", INFO.vowel)}
        <span class="hud-value" data-role="vowel-value">--</span>
      </div>
    `;
    // Info bubbles are wired globally (see main.ts) so a bubble opened here and one opened
    // elsewhere on the page (e.g. the vowel chart) share one "click outside closes everything" scope.
  }

  private el(role: string): HTMLElement {
    return this.container.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  }

  private canvas(role: string): HTMLCanvasElement {
    return this.container.querySelector<HTMLCanvasElement>(`[data-role="${role}"]`)!;
  }

  update(raw: SpectrumResult, smoothed: SmoothedFeedback, settings: ViewSettings): void {
    // Input level + clipping reflect the raw signal instantaneously (not smoothed/gated) —
    // a level meter that lags or blanks out during silence isn't useful for gain-staging.
    this.el("level-item").hidden = !settings.showInputLevel;
    if (settings.showInputLevel) {
      const t = (raw.inputLevelDb - LEVEL_METER_MIN_DB) / (LEVEL_METER_MAX_DB - LEVEL_METER_MIN_DB);
      const fill = this.el("level-fill");
      fill.style.width = `${Math.max(0, Math.min(100, t * 100))}%`;
      fill.classList.toggle("hud-meter-fill--clip", raw.clipping);
      this.el("level-value").textContent = raw.clipping ? "CLIPPING" : `${Math.round(raw.inputLevelDb)} dB`;
    }

    const target = resolveTargetRange(settings);
    const distance = targetDistanceHz(smoothed.pitchHz, target);

    // History buffers always record (even while an item is toggled off) so re-enabling a
    // metric doesn't start from a blank trend line — only the drawing itself is skipped.
    this.pitchHistory.push(smoothed.pitchHz);
    this.targetDistanceHistory.push(distance);
    this.inflectionHistory.push(smoothed.inflectionSemitones);
    this.cppHistory.push(smoothed.hasSignal ? smoothed.cppDb : null);
    this.hnrHistory.push(smoothed.hasSignal ? smoothed.hnrDb : null);
    this.ringHistory.push(smoothed.hasSignal ? smoothed.ringTwangRatio * 100 : null);

    const pitchItem = this.el("pitch-item");
    pitchItem.hidden = !settings.showPitch;
    if (settings.showPitch) {
      const pitchValueEl = this.el("pitch-value");
      const rangeDot = this.el("pitch-range-dot");
      if (smoothed.pitchHz !== null) {
        pitchValueEl.textContent = `${Math.round(smoothed.pitchHz)} Hz (${noteNameForFrequency(smoothed.pitchHz)})`;
        if (target) {
          const inRange = smoothed.pitchHz >= target[0] && smoothed.pitchHz <= target[1];
          rangeDot.hidden = false;
          rangeDot.classList.toggle("hud-range-dot--in", inRange);
          rangeDot.title = inRange ? "In target range" : "Outside target range";
        } else {
          rangeDot.hidden = true;
        }
      } else {
        pitchValueEl.textContent = "--";
        rangeDot.hidden = true;
      }
      drawSparkline(this.canvas("pitch-spark"), this.pitchHistory.getValues(), { color: "#5bcefa" });
    }

    this.el("target-distance-item").hidden = !settings.showTargetDistance;
    if (settings.showTargetDistance) {
      const valueEl = this.el("target-distance-value");
      if (distance === null) {
        valueEl.textContent = target === null ? "no target set" : "--";
      } else if (distance === 0) {
        valueEl.textContent = "in range";
      } else {
        valueEl.textContent = `${distance > 0 ? "+" : ""}${Math.round(distance)} Hz`;
      }
      drawSparkline(this.canvas("target-distance-spark"), this.targetDistanceHistory.getValues(), { color: "#5bcefa" });
    }

    this.el("inflection-item").hidden = !settings.showInflection;
    if (settings.showInflection) {
      this.el("inflection-value").textContent =
        smoothed.inflectionSemitones !== null ? `${smoothed.inflectionSemitones.toFixed(1)} st` : "--";
      drawSparkline(this.canvas("inflection-spark"), this.inflectionHistory.getValues(), { min: 0, color: "#f5a9b8" });
    }

    this.el("cpp-item").hidden = !settings.showCpp;
    if (settings.showCpp) {
      this.el("cpp-value").textContent = smoothed.hasSignal ? `${smoothed.cppDb.toFixed(1)} dB` : "--";
      drawSparkline(this.canvas("cpp-spark"), this.cppHistory.getValues(), { color: goldAccent() });
    }

    this.el("hnr-item").hidden = !settings.showHnr;
    if (settings.showHnr) {
      this.el("hnr-value").textContent = smoothed.hasSignal ? `${smoothed.hnrDb.toFixed(1)} dB` : "--";
      drawSparkline(this.canvas("hnr-spark"), this.hnrHistory.getValues(), { color: "#5bcefa" });
    }

    this.el("perturbation-item").hidden = !settings.showJitterShimmer;
    if (settings.showJitterShimmer) {
      const j = smoothed.jitterPercent !== null ? `${smoothed.jitterPercent.toFixed(2)}%` : "--";
      const s = smoothed.shimmerPercent !== null ? `${smoothed.shimmerPercent.toFixed(2)}%` : "--";
      this.el("perturbation-value").textContent = `J ${j} / S ${s}`;
    }

    this.el("ring-item").hidden = !settings.showRingTwang;
    if (settings.showRingTwang) {
      const pct = smoothed.ringTwangRatio * 100;
      this.el("ring-fill").style.width = `${Math.min(100, pct * RING_METER_GAIN)}%`;
      this.el("ring-value").textContent = `${pct.toFixed(1)}%`;
      drawSparkline(this.canvas("ring-spark"), this.ringHistory.getValues(), { min: 0, color: "#5bcefa" });
    }

    const f1Item = this.el("f1-item");
    const f2Item = this.el("f2-item");
    const f3Item = this.el("f3-item");
    const avgFormantItem = this.el("avg-formant-item");
    const ianchorItem = this.el("ianchor-item");
    const vowelItem = this.el("vowel-item");
    f1Item.hidden = !settings.showF1F2;
    f2Item.hidden = !settings.showF1F2;
    f3Item.hidden = !settings.showF3;
    avgFormantItem.hidden = !settings.showAvgFormant;
    ianchorItem.hidden = !settings.showIAnchor;
    vowelItem.hidden = !settings.showVowel;

    const f1 = smoothed.formants[0];
    const f2 = smoothed.formants[1];
    const f3 = smoothed.formants[2];
    if (settings.showF1F2) {
      this.el("f1-value").textContent = f1 ? `${Math.round(f1.frequency)} Hz` : "--";
      this.el("f2-value").textContent = f2 ? `${Math.round(f2.frequency)} Hz` : "--";
    }
    if (settings.showF3) {
      this.el("f3-value").textContent = f3 ? `${Math.round(f3.frequency)} Hz` : "--";
    }

    if (settings.showAvgFormant) {
      this.el("avg-formant-value").textContent =
        smoothed.avgFormantHz !== null ? `${Math.round(smoothed.avgFormantHz)} Hz` : "--";
    }

    if (settings.showIAnchor) {
      const anchorValueEl = this.el("ianchor-value");
      if (settings.iAnchorF2 === null) {
        anchorValueEl.textContent = "not set";
      } else if (f2) {
        const delta = Math.round(f2.frequency - settings.iAnchorF2);
        anchorValueEl.textContent = `${delta > 0 ? "+" : ""}${delta} Hz`;
      } else {
        anchorValueEl.textContent = "--";
      }
    }

    if (settings.showVowel) {
      const vowel = f1 && f2 ? classifyVowel(f1.frequency, f2.frequency) : null;
      this.el("vowel-value").textContent = vowel ? `/${vowel.symbol}/ ${vowel.label}` : "--";
    }
  }

  reset(): void {
    this.pitchHistory.reset();
    this.targetDistanceHistory.reset();
    this.cppHistory.reset();
    this.hnrHistory.reset();
    this.ringHistory.reset();
    this.inflectionHistory.reset();
    for (const role of ["pitch-spark", "target-distance-spark", "inflection-spark", "cpp-spark", "hnr-spark", "ring-spark"]) {
      const canvas = this.canvas(role);
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
    this.el("level-fill").style.width = "0%";
    this.el("level-value").textContent = "--";
    this.el("pitch-value").textContent = "--";
    this.el("pitch-range-dot").hidden = true;
    this.el("target-distance-value").textContent = "--";
    this.el("inflection-value").textContent = "--";
    this.el("cpp-value").textContent = "--";
    this.el("hnr-value").textContent = "--";
    this.el("perturbation-value").textContent = "--";
    this.el("ring-fill").style.width = "0%";
    this.el("ring-value").textContent = "--";
    this.el("f1-value").textContent = "--";
    this.el("f2-value").textContent = "--";
    this.el("f3-value").textContent = "--";
    this.el("avg-formant-value").textContent = "--";
    this.el("vowel-value").textContent = "--";
  }
}
