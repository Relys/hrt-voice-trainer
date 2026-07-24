import type { AnalysisConfig } from "../audio/capture.ts";
import type { ColorScheme } from "../render/color-ramp.ts";
import type { ChartHeight, HistoryLength, Resolution, TargetRangePreset, Theme, ViewSettings } from "../state/view-settings.ts";

export interface SettingsPanelElements {
  toggleBtn: HTMLButtonElement;
  drawer: HTMLElement;
  themeSelect: HTMLSelectElement;
  scaleSelect: HTMLSelectElement;
  colorSchemeSelect: HTMLSelectElement;
  rangeSelect: HTMLSelectElement;
  resolutionSelect: HTMLSelectElement;
  lpcOrderSelect: HTMLSelectElement;
  historySelect: HTMLSelectElement;
  chartHeightSelect: HTMLSelectElement;
  brightnessSlider: HTMLInputElement;
  brightnessValue: HTMLOutputElement;
  floorSlider: HTMLInputElement;
  floorValue: HTMLOutputElement;
  micGainSlider: HTMLInputElement;
  micGainValue: HTMLOutputElement;
  targetRangeSelect: HTMLSelectElement;
  customTargetRow: HTMLDivElement;
  customTargetMin: HTMLInputElement;
  customTargetMax: HTMLInputElement;
  inputLevelToggle: HTMLInputElement;
  pitchToggle: HTMLInputElement;
  pitchTraceToggle: HTMLInputElement;
  targetDistanceToggle: HTMLInputElement;
  inflectionToggle: HTMLInputElement;
  cppToggle: HTMLInputElement;
  hnrToggle: HTMLInputElement;
  perturbationToggle: HTMLInputElement;
  ringToggle: HTMLInputElement;
  f1f2Toggle: HTMLInputElement;
  f3Toggle: HTMLInputElement;
  formantTraceToggle: HTMLInputElement;
  avgFormantToggle: HTMLInputElement;
  vowelToggle: HTMLInputElement;
  vowelChartPanel: HTMLDivElement;
  acousticProximityToggle: HTMLInputElement;
  acousticProximityPanel: HTMLDivElement;
  recordAudioToggle: HTMLInputElement;
  precomputePlaybackToggle: HTMLInputElement;
}

export interface SettingsPanelCallbacks {
  /** Theme changed — applies the new data-theme attribute to the document. */
  onThemeChange: () => void;
  /** Scale/range changed — invalidates on-screen scroll history and the frequency ruler. */
  onAxisSettingsChange: () => void;
  /** Color scheme changed — existing on-screen pixels were drawn under the old palette. */
  onColorSchemeChange: () => void;
  /** Resolution/LPC order changed — needs to reconfigure the running analysis worker, if any. */
  onAnalysisConfigChange: (config: AnalysisConfig) => void;
  onHistoryLengthChange: () => void;
  onChartHeightChange: () => void;
  onTargetRangeChange: () => void;
  /** Mic gain changed — pushes the new value live to a running capture, if any. */
  onMicGainChange: (db: number) => void;
  /** Fires when the Acoustic Proximity panel is switched on, so it starts from a clean state. */
  onAcousticProximityEnabled: () => void;
  currentAnalysisConfig: () => AnalysisConfig;
}

export interface SettingsPanelController {
  /** Reflects the (possibly persisted) settings object onto every control's displayed state. */
  sync: () => void;
  closeDrawer: () => void;
}

/** Wires every control in the settings drawer to the shared `ViewSettings` object. */
export function createSettingsPanel(
  settings: ViewSettings,
  el: SettingsPanelElements,
  callbacks: SettingsPanelCallbacks,
): SettingsPanelController {
  function sync(): void {
    el.themeSelect.value = settings.theme;
    el.scaleSelect.value = settings.scale;
    el.colorSchemeSelect.value = settings.colorScheme;
    el.rangeSelect.value = String(settings.maxFreq);
    el.resolutionSelect.value = settings.resolution;
    el.lpcOrderSelect.value = String(settings.lpcOrder);
    el.historySelect.value = settings.historyLength;
    el.chartHeightSelect.value = settings.chartHeight;
    el.brightnessSlider.value = String(settings.brightnessDb);
    el.brightnessValue.textContent = `${settings.brightnessDb} dB`;
    el.floorSlider.value = String(settings.floorDb);
    el.floorValue.textContent = `${settings.floorDb} dB`;
    el.micGainSlider.value = String(settings.micGainDb);
    el.micGainValue.textContent = `${settings.micGainDb} dB`;
    el.targetRangeSelect.value = settings.targetRangePreset;
    el.customTargetRow.hidden = settings.targetRangePreset !== "custom";
    el.customTargetMin.value = String(settings.customTargetMin);
    el.customTargetMax.value = String(settings.customTargetMax);
    el.inputLevelToggle.checked = settings.showInputLevel;
    el.pitchToggle.checked = settings.showPitch;
    el.pitchTraceToggle.checked = settings.showPitchTrace;
    el.targetDistanceToggle.checked = settings.showTargetDistance;
    el.inflectionToggle.checked = settings.showInflection;
    el.cppToggle.checked = settings.showCpp;
    el.hnrToggle.checked = settings.showHnr;
    el.perturbationToggle.checked = settings.showJitterShimmer;
    el.ringToggle.checked = settings.showRingTwang;
    el.f1f2Toggle.checked = settings.showF1F2;
    el.f3Toggle.checked = settings.showF3;
    el.formantTraceToggle.checked = settings.showFormantTrace;
    el.avgFormantToggle.checked = settings.showAvgFormant;
    el.vowelToggle.checked = settings.showVowel;
    el.vowelChartPanel.hidden = !settings.showVowel;
    el.acousticProximityToggle.checked = settings.showAcousticProximity;
    el.acousticProximityPanel.hidden = !settings.showAcousticProximity;
    el.recordAudioToggle.checked = settings.recordAudio;
    el.precomputePlaybackToggle.checked = settings.precomputePlayback;
  }

  function closeDrawer(): void {
    el.toggleBtn.setAttribute("aria-expanded", "false");
    el.drawer.hidden = true;
  }

  el.themeSelect.addEventListener("change", () => {
    settings.theme = el.themeSelect.value as Theme;
    callbacks.onThemeChange();
  });

  el.toggleBtn.addEventListener("click", () => {
    const expanded = el.toggleBtn.getAttribute("aria-expanded") === "true";
    el.toggleBtn.setAttribute("aria-expanded", String(!expanded));
    el.drawer.hidden = expanded;
  });

  el.scaleSelect.addEventListener("change", () => {
    settings.scale = el.scaleSelect.value as "log" | "linear";
    callbacks.onAxisSettingsChange();
  });

  el.colorSchemeSelect.addEventListener("change", () => {
    settings.colorScheme = el.colorSchemeSelect.value as ColorScheme;
    callbacks.onColorSchemeChange();
  });

  el.rangeSelect.addEventListener("change", () => {
    settings.maxFreq = Number(el.rangeSelect.value);
    callbacks.onAxisSettingsChange();
  });

  el.resolutionSelect.addEventListener("change", () => {
    settings.resolution = el.resolutionSelect.value as Resolution;
    callbacks.onAnalysisConfigChange(callbacks.currentAnalysisConfig());
  });

  el.lpcOrderSelect.addEventListener("change", () => {
    settings.lpcOrder = Number(el.lpcOrderSelect.value);
    callbacks.onAnalysisConfigChange(callbacks.currentAnalysisConfig());
  });

  el.historySelect.addEventListener("change", () => {
    settings.historyLength = el.historySelect.value as HistoryLength;
    callbacks.onHistoryLengthChange();
  });

  el.chartHeightSelect.addEventListener("change", () => {
    settings.chartHeight = el.chartHeightSelect.value as ChartHeight;
    callbacks.onChartHeightChange();
  });

  el.brightnessSlider.addEventListener("input", () => {
    settings.brightnessDb = Number(el.brightnessSlider.value);
    el.brightnessValue.textContent = `${settings.brightnessDb} dB`;
  });

  el.floorSlider.addEventListener("input", () => {
    settings.floorDb = Number(el.floorSlider.value);
    el.floorValue.textContent = `${settings.floorDb} dB`;
  });

  el.micGainSlider.addEventListener("input", () => {
    settings.micGainDb = Number(el.micGainSlider.value);
    el.micGainValue.textContent = `${settings.micGainDb} dB`;
    callbacks.onMicGainChange(settings.micGainDb);
  });

  el.targetRangeSelect.addEventListener("change", () => {
    settings.targetRangePreset = el.targetRangeSelect.value as TargetRangePreset;
    el.customTargetRow.hidden = settings.targetRangePreset !== "custom";
    callbacks.onTargetRangeChange();
  });

  el.customTargetMin.addEventListener("change", () => {
    settings.customTargetMin = Number(el.customTargetMin.value);
    if (settings.targetRangePreset === "custom") callbacks.onTargetRangeChange();
  });

  el.customTargetMax.addEventListener("change", () => {
    settings.customTargetMax = Number(el.customTargetMax.value);
    if (settings.targetRangePreset === "custom") callbacks.onTargetRangeChange();
  });

  el.inputLevelToggle.addEventListener("change", () => {
    settings.showInputLevel = el.inputLevelToggle.checked;
  });

  el.pitchToggle.addEventListener("change", () => {
    settings.showPitch = el.pitchToggle.checked;
  });

  el.pitchTraceToggle.addEventListener("change", () => {
    settings.showPitchTrace = el.pitchTraceToggle.checked;
  });

  el.targetDistanceToggle.addEventListener("change", () => {
    settings.showTargetDistance = el.targetDistanceToggle.checked;
  });

  el.inflectionToggle.addEventListener("change", () => {
    settings.showInflection = el.inflectionToggle.checked;
  });

  el.cppToggle.addEventListener("change", () => {
    settings.showCpp = el.cppToggle.checked;
  });

  el.hnrToggle.addEventListener("change", () => {
    settings.showHnr = el.hnrToggle.checked;
  });

  el.perturbationToggle.addEventListener("change", () => {
    settings.showJitterShimmer = el.perturbationToggle.checked;
  });

  el.ringToggle.addEventListener("change", () => {
    settings.showRingTwang = el.ringToggle.checked;
  });

  el.f1f2Toggle.addEventListener("change", () => {
    settings.showF1F2 = el.f1f2Toggle.checked;
  });

  el.f3Toggle.addEventListener("change", () => {
    settings.showF3 = el.f3Toggle.checked;
  });

  el.formantTraceToggle.addEventListener("change", () => {
    settings.showFormantTrace = el.formantTraceToggle.checked;
  });

  el.avgFormantToggle.addEventListener("change", () => {
    settings.showAvgFormant = el.avgFormantToggle.checked;
  });

  el.vowelToggle.addEventListener("change", () => {
    settings.showVowel = el.vowelToggle.checked;
    el.vowelChartPanel.hidden = !settings.showVowel;
  });

  el.acousticProximityToggle.addEventListener("change", () => {
    settings.showAcousticProximity = el.acousticProximityToggle.checked;
    el.acousticProximityPanel.hidden = !settings.showAcousticProximity;
    if (settings.showAcousticProximity) callbacks.onAcousticProximityEnabled();
  });

  el.recordAudioToggle.addEventListener("change", () => {
    settings.recordAudio = el.recordAudioToggle.checked;
  });

  el.precomputePlaybackToggle.addEventListener("change", () => {
    settings.precomputePlayback = el.precomputePlaybackToggle.checked;
  });

  return { sync, closeDrawer };
}
