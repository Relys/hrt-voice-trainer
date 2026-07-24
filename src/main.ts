import "./style.css";
import { isDisplayCaptureSupported, startCapture, type AnalysisConfig, type CaptureHandle, type CaptureSource } from "./audio/capture.ts";
import { listAudioInputDevices, type AudioInputDevice } from "./audio/devices.ts";
import { calibrateNoiseFloor } from "./audio/noise-calibration.ts";
import { startPlayback } from "./audio/playback.ts";
import { precomputeAnalysis, startPrecomputedPlayback } from "./audio/precompute.ts";
import { drawVerticalFrequencyRuler } from "./render/frequency-ruler.ts";
import { SpectrogramRenderer } from "./render/spectrogram.ts";
import { Spectrogram3D, type CameraPreset } from "./render/spectrogram3d.ts";
import { VowelChartRenderer } from "./render/vowel-chart.ts";
import { EXERCISES, type ExerciseDefinition } from "./state/exercises.ts";
import { FeedbackSmoother, type SmoothedFeedback } from "./state/feedback-smoother.ts";
import { createPersistedSettings } from "./state/persistence.ts";
import type { PracticeCard } from "./state/practice-cards.ts";
import { SessionAggregator } from "./state/session-aggregator.ts";
import {
  CHART_HEIGHT_PX,
  createDefaultSettings,
  HISTORY_LENGTH_SLICES,
  resolveTargetRange,
  RESOLUTION_WINDOW_SECONDS,
  type TargetRangePreset,
} from "./state/view-settings.ts";
import { saveSession, type SessionSummary } from "./storage/sessions.ts";
import { ExercisePanel } from "./ui/exercise-panel.ts";
import { Hud } from "./ui/hud.ts";
import { setupInfoBubbles } from "./ui/info-bubble.ts";
import { createModal } from "./ui/modal.ts";
import { AcousticProximityPanel } from "./ui/acoustic-proximity-panel.ts";
import { PlaybackTransport } from "./ui/playback-transport.ts";
import { PracticeCardsPanel } from "./ui/practice-cards-panel.ts";
import { ProgressPanel } from "./ui/progress-panel.ts";
import { createSettingsPanel } from "./ui/settings-panel.ts";
import { SessionsPanel } from "./ui/sessions-panel.ts";
import type { SpectrumResult } from "./shared/protocol.ts";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    // BASE_URL (not a hardcoded "/") — a service worker's scope can't exceed the directory it's
    // served from, so this must resolve under whatever subpath the app is actually deployed at
    // (e.g. "/voice-trainer/sw.js" for a GitHub Pages project page, not "/sw.js").
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch((err) => console.warn("Service worker registration failed:", err));
  });
}

/** Chrome/Edge/Android fire this instead of showing their own install UI, once a manifest +
 *  service worker + a couple engagement heuristics are satisfied. Not in lib.dom.d.ts. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const installBanner = document.querySelector<HTMLDivElement>("#install-banner")!;
const installBannerText = document.querySelector<HTMLSpanElement>("#install-banner-text")!;
const installBtn = document.querySelector<HTMLButtonElement>("#install-btn")!;
const installDismissBtn = document.querySelector<HTMLButtonElement>("#install-dismiss-btn")!;

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// Dismissing only hides it for this page load — as long as the app isn't installed, it's
// worth re-offering next visit rather than remembering a dismissal forever.
installDismissBtn.addEventListener("click", () => {
  installBanner.hidden = true;
});

if (!isStandalone()) {
  let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e as BeforeInstallPromptEvent;
    installBtn.hidden = false;
    installBanner.hidden = false;
  });

  installBtn.addEventListener("click", () => {
    void (async () => {
      if (!deferredInstallPrompt) return;
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      installBanner.hidden = true;
    })();
  });

  window.addEventListener("appinstalled", () => {
    installBanner.hidden = true;
  });

  // iOS Safari never fires beforeinstallprompt — "Add to Home Screen" is a manual Share-sheet
  // action there, so just point people at it instead of showing a button that would do nothing.
  if (isIos()) {
    installBannerText.textContent = 'Install this app: tap Share, then "Add to Home Screen". It works offline and nothing ever leaves your device.';
    installBanner.hidden = false;
  } else {
    // Chrome/Edge on Android normally fire beforeinstallprompt within a second or two of load.
    // If it doesn't show up — a self-signed dev cert the phone hasn't trusted is the most common
    // reason, since that blocks the installability check even though the page still loads fine
    // over TLS — fall back to pointing at the browser's own menu instead of showing nothing.
    setTimeout(() => {
      if (deferredInstallPrompt) return;
      installBannerText.textContent =
        'Install this app: open your browser menu and look for "Install app" / "Add to Home screen". It works offline and nothing ever leaves your device.';
      installBanner.hidden = false;
    }, 3000);
  }
}

const startBtn = document.querySelector<HTMLButtonElement>("#start-btn")!;
const stopBtn = document.querySelector<HTMLButtonElement>("#stop-btn")!;
const clearBtn = document.querySelector<HTMLButtonElement>("#clear-btn")!;
const statusEl = document.querySelector<HTMLSpanElement>("#status")!;
const sourceSelect = document.querySelector<HTMLSelectElement>("#source-select")!;
const deviceSelect = document.querySelector<HTMLSelectElement>("#device-select")!;
const onboardingDeviceSelect = document.querySelector<HTMLSelectElement>("#onboarding-device-select")!;
const viewToggleBtn = document.querySelector<HTMLButtonElement>("#view-toggle-btn")!;
const settingsToggleBtn = document.querySelector<HTMLButtonElement>("#settings-toggle-btn")!;
const settingsDrawer = document.querySelector<HTMLElement>("#settings-drawer")!;
const view2d = document.querySelector<HTMLDivElement>("#view-2d")!;
const view3d = document.querySelector<HTMLDivElement>("#view-3d")!;
const canvas2d = document.querySelector<HTMLCanvasElement>("#spectrogram")!;
const canvas3d = document.querySelector<HTMLCanvasElement>("#spectrogram-3d")!;
const rulerCanvas = document.querySelector<HTMLCanvasElement>("#freq-ruler-2d")!;
const axisLabels3d = document.querySelector<HTMLDivElement>("#axis-labels-3d")!;
const hint2d = document.querySelector<HTMLParagraphElement>("#hint-2d")!;
const hint3d = document.querySelector<HTMLParagraphElement>("#hint-3d")!;
const hudContainer = document.querySelector<HTMLDivElement>("#hud")!;
const vowelChartPanel = document.querySelector<HTMLDivElement>("#vowel-chart-panel")!;
const vowelChartCanvas = document.querySelector<HTMLCanvasElement>("#vowel-chart")!;
const acousticProximityContainer = document.querySelector<HTMLDivElement>("#acoustic-proximity-panel")!;

const historyBtn = document.querySelector<HTMLButtonElement>("#history-btn")!;
const exercisesBtn = document.querySelector<HTMLButtonElement>("#exercises-btn")!;
const practiceCardsBtn = document.querySelector<HTMLButtonElement>("#practice-cards-btn")!;
const progressBtn = document.querySelector<HTMLButtonElement>("#progress-btn")!;
const mobileMenuToggleBtn = document.querySelector<HTMLButtonElement>("#mobile-menu-toggle-btn")!;
const mobileMenuGroup = document.querySelector<HTMLDivElement>("#mobile-menu-group")!;
const historyBackdrop = document.querySelector<HTMLDivElement>("#history-backdrop")!;
const exercisesBackdrop = document.querySelector<HTMLDivElement>("#exercises-backdrop")!;
const practiceCardsBackdrop = document.querySelector<HTMLDivElement>("#practice-cards-backdrop")!;
const progressBackdrop = document.querySelector<HTMLDivElement>("#progress-backdrop")!;
const historyPanel = document.querySelector<HTMLDivElement>("#history-panel")!;
const exercisesPanel = document.querySelector<HTMLDivElement>("#exercises-panel")!;
const practiceCardsPanelEl = document.querySelector<HTMLDivElement>("#practice-cards-panel")!;
const progressPanelEl = document.querySelector<HTMLDivElement>("#progress-panel-el")!;
const historyCloseBtn = document.querySelector<HTMLButtonElement>("#history-close-btn")!;
const exercisesCloseBtn = document.querySelector<HTMLButtonElement>("#exercises-close-btn")!;
const practiceCardsCloseBtn = document.querySelector<HTMLButtonElement>("#practice-cards-close-btn")!;
const progressCloseBtn = document.querySelector<HTMLButtonElement>("#progress-close-btn")!;
const historyBody = document.querySelector<HTMLDivElement>("#history-body")!;
const exercisesBody = document.querySelector<HTMLDivElement>("#exercises-body")!;
const practiceCardsBody = document.querySelector<HTMLDivElement>("#practice-cards-body")!;
const progressBody = document.querySelector<HTMLDivElement>("#progress-body")!;
const activeCardBanner = document.querySelector<HTMLDivElement>("#active-card-banner")!;
const activeCardText = document.querySelector<HTMLSpanElement>("#active-card-text")!;
const activeCardClearBtn = document.querySelector<HTMLButtonElement>("#active-card-clear-btn")!;

const onboardingBackdrop = document.querySelector<HTMLDivElement>("#onboarding-backdrop")!;
const onboardingPanel = document.querySelector<HTMLDivElement>("#onboarding-panel")!;
const onboardingCloseBtn = document.querySelector<HTMLButtonElement>("#onboarding-close-btn")!;
const onboardingTargetButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>(".onboarding-target-buttons button[data-preset]"),
);
const onboardingTargetStatus = document.querySelector<HTMLElement>("#onboarding-target-status")!;
const onboardingRecordToggle = document.querySelector<HTMLInputElement>("#onboarding-record-toggle")!;
const onboardingCalibrateBtn = document.querySelector<HTMLButtonElement>("#onboarding-calibrate-btn")!;
const onboardingCalibrateStatus = document.querySelector<HTMLElement>("#onboarding-calibrate-status")!;
const onboardingDoneBtn = document.querySelector<HTMLButtonElement>("#onboarding-done-btn")!;
const runSetupAgainBtn = document.querySelector<HTMLButtonElement>("#run-setup-again-btn")!;

const settings = createPersistedSettings();

let renderer2d = new SpectrogramRenderer(canvas2d, settings, () => redrawRuler());
let renderer3d: Spectrogram3D | null = null;
try {
  renderer3d = new Spectrogram3D(canvas3d, settings, {
    labelContainer: axisLabels3d,
    timeSlices: HISTORY_LENGTH_SLICES[settings.historyLength],
  });
} catch (err) {
  console.warn("3D view unavailable:", err);
  viewToggleBtn.disabled = true;
  viewToggleBtn.title = "3D view requires WebGL2, which isn't available in this browser/context.";
  document.querySelector<HTMLSelectElement>("#history-select")!.disabled = true;
}

const cameraPresetButtons = document.querySelectorAll<HTMLButtonElement>("#camera-presets button[data-preset]");
for (const btn of cameraPresetButtons) {
  btn.addEventListener("click", () => {
    renderer3d?.setCameraPreset(btn.dataset.preset as CameraPreset);
    for (const b of cameraPresetButtons) b.setAttribute("aria-pressed", String(b === btn));
  });
}
// A manual drag no longer matches whichever preset was last clicked — drop the "pressed" state
// rather than leave a stale button highlighted.
canvas3d.addEventListener("pointerdown", () => {
  for (const b of cameraPresetButtons) b.setAttribute("aria-pressed", "false");
});

const hud = new Hud(hudContainer);
// One global wiring covers every info bubble on the page (HUD + vowel chart), so "click
// elsewhere closes it" and "only one open at a time" both hold across the whole app, not just
// within whichever component happened to render the button.
setupInfoBubbles(document.body);
const vowelChart = new VowelChartRenderer(vowelChartCanvas);
const acousticProximityPanel = new AcousticProximityPanel(acousticProximityContainer);

const vowelChartModeBtn = document.querySelector<HTMLButtonElement>("#vowel-chart-mode-btn")!;
vowelChartModeBtn.addEventListener("click", () => {
  const next = vowelChart.getMode() === "vowel" ? "cluster" : "vowel";
  vowelChart.setMode(next);
  vowelChartModeBtn.textContent = next === "vowel" ? "IPA vowels" : "M/F clusters";
});

// Lives next to the Vowel Chart (not in the Settings drawer) since that's exactly where the
// dashed anchor line it controls is drawn — an active drill, not a passive setting.
const ianchorStatus = document.querySelector<HTMLElement>("#ianchor-status")!;
function updateIAnchorStatus(): void {
  ianchorStatus.textContent = settings.iAnchorF2 !== null ? `Calibrated: F2 ≈ ${Math.round(settings.iAnchorF2)} Hz` : "Not calibrated yet";
}
updateIAnchorStatus();

document.querySelector<HTMLButtonElement>("#calibrate-i-btn")!.addEventListener("click", () => {
  const f2 = lastSmoothed?.formants[1]?.frequency;
  if (f2 === undefined) {
    ianchorStatus.textContent = "No signal — press Start, sustain /i/, then try again.";
    return;
  }
  settings.iAnchorF2 = f2;
  updateIAnchorStatus();
});
document.querySelector<HTMLButtonElement>("#clear-i-btn")!.addEventListener("click", () => {
  settings.iAnchorF2 = null;
  updateIAnchorStatus();
});

const feedbackSmoother = new FeedbackSmoother();
const sessionAggregator = new SessionAggregator();
let lastSmoothed: SmoothedFeedback | undefined;

const sessionsPanel = new SessionsPanel(historyBody, {
  onPlay: (session) => void playClip(session),
  onImportAudio: (file) => void importAudioFile(file),
});
void sessionsPanel.refresh();

function currentAnalysisConfig(): AnalysisConfig {
  return { windowSeconds: RESOLUTION_WINDOW_SECONDS[settings.resolution], lpcOrder: settings.lpcOrder };
}

function redrawRuler(): void {
  const [viewMin, viewMax] = renderer2d.getViewRange();
  const mapping = { minFreq: viewMin, maxFreq: viewMax, scale: settings.scale };
  drawVerticalFrequencyRuler(rulerCanvas, mapping, resolveTargetRange(settings));
}

function rebuildRenderer3d(): void {
  if (!renderer3d) return;
  const wasRunning = is3d;
  renderer3d.stop();
  renderer3d.dispose();
  renderer3d = new Spectrogram3D(canvas3d, settings, {
    labelContainer: axisLabels3d,
    timeSlices: HISTORY_LENGTH_SLICES[settings.historyLength],
  });
  renderer3d.setTargetRange(resolveTargetRange(settings));
  if (wasRunning) renderer3d.start();
}

/** Resizes the 2D/3D canvases' backing pixel buffers (not just their CSS display size) to match
 *  the chosen height, then rebuilds the 2D renderer (which reads canvas.height once at
 *  construction). The 3D renderer reads canvas.width/height fresh every frame already, so it just
 *  needs the element resized, not a full rebuild. */
function applyChartHeight(): void {
  const px = CHART_HEIGHT_PX[settings.chartHeight];
  canvas2d.height = px;
  canvas2d.style.height = `${px}px`;
  rulerCanvas.height = px;
  rulerCanvas.style.height = `${px}px`;
  canvas3d.height = px;
  canvas3d.style.height = `${px}px`;

  renderer2d.dispose();
  renderer2d = new SpectrogramRenderer(canvas2d, settings, () => redrawRuler());
  redrawRuler();
  clearDisplays();
}

/** Scale/range changes invalidate the on-screen scroll history, so redraw from scratch. */
function applyAxisSettingsChange(): void {
  renderer2d.resetView(); // also redraws the ruler via its onViewChange callback
  renderer3d?.refreshFrequencyMapping();
  clearDisplays();
}

function applyTargetRangeChange(): void {
  redrawRuler();
  renderer3d?.setTargetRange(resolveTargetRange(settings));
  clearDisplays();
}

function applyTheme(): void {
  document.documentElement.dataset.theme = settings.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", settings.theme === "light" ? "#f3f4f8" : "#0b0d12");
  // The vowel chart reads the theme at draw time (unlike CSS, a canvas won't repaint on its own).
  vowelChart.setMode(vowelChart.getMode());
}
applyTheme();

const settingsPanel = createSettingsPanel(
  settings,
  {
    toggleBtn: settingsToggleBtn,
    drawer: settingsDrawer,
    themeSelect: document.querySelector("#theme-select")!,
    scaleSelect: document.querySelector("#scale-select")!,
    colorSchemeSelect: document.querySelector("#color-scheme-select")!,
    rangeSelect: document.querySelector("#range-select")!,
    resolutionSelect: document.querySelector("#resolution-select")!,
    lpcOrderSelect: document.querySelector("#lpc-order-select")!,
    historySelect: document.querySelector("#history-select")!,
    chartHeightSelect: document.querySelector("#chart-height-select")!,
    brightnessSlider: document.querySelector("#brightness-slider")!,
    brightnessValue: document.querySelector("#brightness-value")!,
    floorSlider: document.querySelector("#floor-slider")!,
    floorValue: document.querySelector("#floor-value")!,
    micGainSlider: document.querySelector("#mic-gain-slider")!,
    micGainValue: document.querySelector("#mic-gain-value")!,
    targetRangeSelect: document.querySelector("#target-range-select")!,
    customTargetRow: document.querySelector("#custom-target-row")!,
    customTargetMin: document.querySelector("#custom-target-min")!,
    customTargetMax: document.querySelector("#custom-target-max")!,
    inputLevelToggle: document.querySelector("#input-level-toggle")!,
    pitchToggle: document.querySelector("#pitch-toggle")!,
    pitchTraceToggle: document.querySelector("#pitch-trace-toggle")!,
    targetDistanceToggle: document.querySelector("#target-distance-toggle")!,
    inflectionToggle: document.querySelector("#inflection-toggle")!,
    cppToggle: document.querySelector("#cpp-toggle")!,
    hnrToggle: document.querySelector("#hnr-toggle")!,
    perturbationToggle: document.querySelector("#perturbation-toggle")!,
    ringToggle: document.querySelector("#ring-toggle")!,
    f1f2Toggle: document.querySelector("#f1f2-toggle")!,
    f3Toggle: document.querySelector("#f3-toggle")!,
    formantTraceToggle: document.querySelector("#formant-trace-toggle")!,
    avgFormantToggle: document.querySelector("#avg-formant-toggle")!,
    vowelToggle: document.querySelector("#vowel-toggle")!,
    vowelChartPanel,
    acousticProximityToggle: document.querySelector("#acoustic-proximity-toggle")!,
    acousticProximityPanel: acousticProximityContainer,
    recordAudioToggle: document.querySelector("#record-audio-toggle")!,
    precomputePlaybackToggle: document.querySelector("#precompute-playback-toggle")!,
  },
  {
    onThemeChange: applyTheme,
    onAxisSettingsChange: applyAxisSettingsChange,
    onColorSchemeChange: clearDisplays,
    onAnalysisConfigChange: (config) => handle?.configure(config),
    onHistoryLengthChange: rebuildRenderer3d,
    onChartHeightChange: applyChartHeight,
    onTargetRangeChange: applyTargetRangeChange,
    onMicGainChange: (db) => handle?.setInputGainDb(db),
    onAcousticProximityEnabled: () => acousticProximityPanel.reset(),
    currentAnalysisConfig,
  },
);
settingsPanel.sync();
applyChartHeight(); // picks up any persisted non-default height; a no-op redraw at the default
redrawRuler();
renderer3d?.setTargetRange(resolveTargetRange(settings));

const resetSettingsBtn = document.querySelector<HTMLButtonElement>("#reset-settings-btn")!;
resetSettingsBtn.addEventListener("click", () => {
  // settings is a Proxy over localStorage persistence — assigning field-by-field (not replacing
  // the object outright) keeps that binding intact and saves each field as it's set.
  Object.assign(settings, createDefaultSettings());
  settingsPanel.sync();
  applyTheme();
  applyAxisSettingsChange();
  rebuildRenderer3d();
  applyChartHeight();
  applyTargetRangeChange();
  updateIAnchorStatus();
});

/** Shared by the Settings button and the onboarding modal — measures ~3s of ambient mic input
 *  and sets Floor above it, replacing slider guesswork with an actual measurement. */
async function runNoiseCalibration(btn: HTMLButtonElement, statusEl: HTMLElement): Promise<void> {
  if (handle || transport.isActive()) {
    statusEl.textContent = "Stop your current session first.";
    return;
  }
  btn.disabled = true;
  statusEl.textContent = "Listening… stay quiet.";
  try {
    const result = await calibrateNoiseFloor(
      3000,
      (remainingMs) => {
        statusEl.textContent = `Listening… ${Math.ceil(remainingMs / 1000)}s — stay quiet.`;
      },
      deviceSelect.value || undefined,
    );
    settings.floorDb = result.recommendedFloorDb;
    settingsPanel.sync();
    statusEl.textContent = `Done — Floor set to ${result.recommendedFloorDb} dB (measured ${Math.round(result.measuredDb)} dB).`;
    await refreshDeviceList(); // first-ever mic permission grant is often what unlocks real device labels
  } catch (err) {
    statusEl.textContent = `Couldn't calibrate: ${(err as Error).message}`;
  } finally {
    btn.disabled = false;
  }
}

const calibrateNoiseBtn = document.querySelector<HTMLButtonElement>("#calibrate-noise-btn")!;
const calibrateNoiseStatus = document.querySelector<HTMLElement>("#calibrate-noise-status")!;
calibrateNoiseBtn.addEventListener("click", () => void runNoiseCalibration(calibrateNoiseBtn, calibrateNoiseStatus));

let handle: CaptureHandle | undefined;
let is3d = false;
let captureSource: CaptureSource = "microphone";
let sessionStartedAt = 0;
let currentExerciseId: string | null = null;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function clearDisplays(): void {
  renderer2d.clear();
  renderer3d?.clear();
  vowelChart.reset();
  acousticProximityPanel.reset();
  hud.reset();
  feedbackSmoother.reset();
  lastSmoothed = undefined;
}

const transport = new PlaybackTransport(
  {
    bar: document.querySelector("#playback-bar")!,
    playPauseBtn: document.querySelector("#playback-playpause-btn")!,
    skipBackBtn: document.querySelector("#playback-skip-back-btn")!,
    skipFwdBtn: document.querySelector("#playback-skip-fwd-btn")!,
    seek: document.querySelector("#playback-seek")!,
    time: document.querySelector("#playback-time")!,
    closeBtn: document.querySelector("#playback-close-btn")!,
  },
  // clearDisplays() runs BEFORE seek(), not after: the precomputed-playback path replays frames
  // synchronously inside seek() itself, so clearing afterward would wipe out what it just drew.
  () => clearDisplays(),
  () => void finishSession(),
);

/** Mirrors the same device list into both the main toolbar's selector and the onboarding
 *  modal's — they always show the same options and stay in sync (see the change listeners
 *  below), so picking a mic during onboarding carries over into real practice sessions. */
function populateDeviceSelect(select: HTMLSelectElement, devices: AudioInputDevice[], previous: string): void {
  select.innerHTML = "";
  for (const device of devices) {
    const option = document.createElement("option");
    option.value = device.deviceId;
    option.textContent = device.label;
    select.appendChild(option);
  }
  if (devices.some((d) => d.deviceId === previous)) {
    select.value = previous;
  }
}

async function refreshDeviceList(): Promise<void> {
  const devices = await listAudioInputDevices();
  const previous = deviceSelect.value || onboardingDeviceSelect.value;
  populateDeviceSelect(deviceSelect, devices, previous);
  populateDeviceSelect(onboardingDeviceSelect, devices, previous);
}

function setView(next3d: boolean): void {
  if (next3d && !renderer3d) return;
  is3d = next3d;
  view2d.hidden = is3d;
  view3d.hidden = !is3d;
  hint2d.hidden = is3d;
  hint3d.hidden = !is3d;
  viewToggleBtn.textContent = is3d ? "Switch to 2D" : "Switch to 3D";
  if (is3d) renderer3d?.start();
  else renderer3d?.stop();
}

viewToggleBtn.addEventListener("click", () => setView(!is3d));

const historyModal = createModal(historyBackdrop, historyPanel);
const exercisesModal = createModal(exercisesBackdrop, exercisesPanel);
const practiceCardsModal = createModal(practiceCardsBackdrop, practiceCardsPanelEl);
const progressModal = createModal(progressBackdrop, progressPanelEl);

historyBtn.addEventListener("click", () => {
  void sessionsPanel.refresh();
  historyModal.open();
});
historyCloseBtn.addEventListener("click", () => historyModal.close());
exercisesBtn.addEventListener("click", () => exercisesModal.open());
exercisesCloseBtn.addEventListener("click", () => exercisesModal.close());
practiceCardsBtn.addEventListener("click", () => practiceCardsModal.open());
practiceCardsCloseBtn.addEventListener("click", () => practiceCardsModal.close());

/** Only visible on narrow viewports (CSS-gated) — collapses Settings/History/Exercises/
 *  Practice Cards/Progress into one disclosure so the toolbar doesn't sprawl on a phone. On
 *  desktop the group renders via `display: contents` regardless of the `collapsed` class, so
 *  this never hides them there. A plain class rather than `hidden` on purpose — the app-wide
 *  `[hidden] { display: none !important; }` rule would otherwise win on desktop too, with no
 *  toggle button visible (it's CSS-hidden there) to bring the buttons back. Settings keeps its
 *  own separate open/close state (settings-panel.ts); this only governs whether the *button* is
 *  visible inside the collapsed group. */
function closeMobileMenu(): void {
  mobileMenuToggleBtn.setAttribute("aria-expanded", "false");
  mobileMenuGroup.classList.add("collapsed");
}
mobileMenuToggleBtn.addEventListener("click", () => {
  const expanded = mobileMenuToggleBtn.getAttribute("aria-expanded") === "true";
  mobileMenuToggleBtn.setAttribute("aria-expanded", String(!expanded));
  mobileMenuGroup.classList.toggle("collapsed", expanded);
});
mobileMenuGroup.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).tagName === "BUTTON") closeMobileMenu();
});

const progressPanel = new ProgressPanel(progressBody, settings);
progressBtn.addEventListener("click", () => {
  void progressPanel.refresh();
  progressModal.open();
});
progressCloseBtn.addEventListener("click", () => progressModal.close());

const ONBOARDED_KEY = "hrt-voice-trainer:onboarded";
function hasOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return true; // private browsing / blocked storage — don't nag on every load
  }
}
function markOnboarded(): void {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    // ignore — worst case the modal reopens next load
  }
}

function targetPresetLabel(preset: TargetRangePreset): string {
  switch (preset) {
    case "masculine":
      return "Masculine";
    case "androgynous":
      return "Androgynous";
    case "feminine":
      return "Feminine";
    case "custom":
      return "Custom";
    default:
      return "Off";
  }
}

function syncOnboardingControls(): void {
  for (const btn of onboardingTargetButtons) {
    btn.setAttribute("aria-pressed", String(btn.dataset.preset === settings.targetRangePreset));
  }
  onboardingTargetStatus.textContent = `Current: ${targetPresetLabel(settings.targetRangePreset)}`;
  onboardingRecordToggle.checked = settings.recordAudio;
  onboardingCalibrateStatus.textContent = "";
}

const onboardingModal = createModal(onboardingBackdrop, onboardingPanel);

for (const btn of onboardingTargetButtons) {
  btn.addEventListener("click", () => {
    settings.targetRangePreset = btn.dataset.preset as TargetRangePreset;
    settingsPanel.sync();
    applyTargetRangeChange();
    syncOnboardingControls();
  });
}

onboardingRecordToggle.addEventListener("change", () => {
  settings.recordAudio = onboardingRecordToggle.checked;
  settingsPanel.sync();
});

onboardingCalibrateBtn.addEventListener("click", () =>
  void runNoiseCalibration(onboardingCalibrateBtn, onboardingCalibrateStatus),
);

function closeOnboarding(): void {
  markOnboarded();
  onboardingModal.close();
}
onboardingDoneBtn.addEventListener("click", closeOnboarding);
onboardingCloseBtn.addEventListener("click", closeOnboarding);

runSetupAgainBtn.addEventListener("click", () => {
  syncOnboardingControls();
  onboardingModal.open();
});

if (!hasOnboarded()) {
  syncOnboardingControls();
  onboardingModal.open();
}

let activeCard: PracticeCard | null = null;

function updateActiveCardBanner(): void {
  activeCardBanner.hidden = !activeCard;
  if (activeCard) activeCardText.textContent = activeCard.text;
}

const practiceCardsPanel = new PracticeCardsPanel(practiceCardsBody, {
  onSelectCard: (card) => {
    activeCard = card;
    updateActiveCardBanner();
    practiceCardsModal.close();
  },
});
void practiceCardsPanel; // constructed for its side effects (renders into practiceCardsBody)

activeCardClearBtn.addEventListener("click", () => {
  activeCard = null;
  updateActiveCardBanner();
});

navigator.mediaDevices.addEventListener("devicechange", () => {
  void refreshDeviceList();
});
void refreshDeviceList();

/** Everything except the 2D spectrogram — cheap enough to call once per replayed frame. */
function renderNonSpectrogram(result: SpectrumResult, smoothed: SmoothedFeedback): void {
  const displayResult = {
    ...result,
    formants: smoothed.formants,
    ringTwangRatio: smoothed.ringTwangRatio,
    pitch: smoothed.pitchHz !== null ? { frequency: smoothed.pitchHz, clarity: 1 } : null,
  };
  renderer3d?.pushSpectrum(displayResult);
  hud.update(result, smoothed, settings);
  const f1 = smoothed.formants[0]?.frequency;
  const f2 = smoothed.formants[1]?.frequency;
  vowelChart.update(f1 !== undefined && f2 !== undefined ? { f1, f2 } : null, settings.iAnchorF2);
  if (settings.showAcousticProximity) {
    acousticProximityPanel.update(smoothed.pitchHz, f1 ?? null, f2 ?? null, smoothed.hasSignal, settings.targetRangePreset);
  }
}

/** Shared by live capture and clip playback: feeds one frame through smoothing + every view. */
function renderSpectrumResult(result: SpectrumResult): SmoothedFeedback {
  const smoothed = feedbackSmoother.process(result, settings.floorDb);
  lastSmoothed = smoothed;
  const displayResult = {
    ...result,
    formants: smoothed.formants,
    ringTwangRatio: smoothed.ringTwangRatio,
    pitch: smoothed.pitchHz !== null ? { frequency: smoothed.pitchHz, clarity: 1 } : null,
  };
  renderer2d.pushColumn(displayResult);
  renderNonSpectrogram(result, smoothed);
  return smoothed;
}

/**
 * Bulk path for a seek/jump during precomputed playback: one fast redraw of the whole visible
 * spectrogram strip instead of replaying pushColumn (a get+putImageData over nearly the whole
 * canvas) hundreds of times synchronously — that's what was freezing the tab.
 */
function replaySeek(results: SpectrumResult[]): void {
  renderer2d.replayColumns(results);
  for (const result of results) {
    const smoothed = feedbackSmoother.process(result, settings.floorDb);
    lastSmoothed = smoothed;
    renderNonSpectrogram(result, smoothed);
  }
}

async function start(exerciseId: string | null = null): Promise<void> {
  transport.stop();
  startBtn.disabled = true;
  setStatus(captureSource === "microphone" ? "requesting microphone…" : "choose a tab/window to share…");
  try {
    const deviceId = deviceSelect.value || undefined;
    sessionAggregator.reset();
    currentExerciseId = exerciseId;
    handle = await startCapture(
      (result) => {
        const smoothed = renderSpectrumResult(result);
        sessionAggregator.addFrame(smoothed, resolveTargetRange(settings), {
          clipping: result.clipping,
          iAnchorF2: settings.iAnchorF2,
        });
      },
      captureSource,
      deviceId,
      currentAnalysisConfig(),
      { record: settings.recordAudio, gainDb: settings.micGainDb },
    );
    sessionStartedAt = Date.now();
    await refreshDeviceList(); // labels populate only after permission is granted
    setStatus("listening");
    stopBtn.disabled = false;
  } catch (err) {
    setStatus(`error: ${(err as Error).message}`);
    startBtn.disabled = false;
  }
}

/** Stops whatever's active (live capture or playback), finalizes + saves a session if applicable. */
async function finishSession(): Promise<SessionSummary | null> {
  if (transport.isActive()) {
    transport.stop();
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("idle");
    return null;
  }
  if (!handle) return null;

  const endedAt = Date.now();
  const blob = await handle.stop();
  handle = undefined;
  stopBtn.disabled = true;
  startBtn.disabled = false;
  setStatus("idle");

  const targetRangeHz = resolveTargetRange(settings);
  const wasExercise = currentExerciseId !== null;
  const summary = sessionAggregator.finalize({
    startedAt: sessionStartedAt || endedAt,
    endedAt,
    targetRangePreset: settings.targetRangePreset,
    targetRangeHz,
    audioBlob: blob,
    audioMimeType: blob?.type ?? null,
    exerciseId: currentExerciseId,
    cardId: activeCard?.id ?? null,
    cardText: activeCard?.text ?? null,
  });
  currentExerciseId = null;
  activeCard = null;
  updateActiveCardBanner();
  sessionAggregator.reset();
  feedbackSmoother.reset();
  hud.reset();
  lastSmoothed = undefined;

  if (summary.durationMs > 2000) {
    const saved = await saveSession(summary);
    if (saved) await sessionsPanel.refresh();
    else setStatus("session finished (couldn't save to history)");
  }

  // Exercises show their own results screen right after — auto-replaying on top of that would
  // just be two things competing for attention, so only jump straight to playback for free sessions.
  if (summary.audioBlob && !wasExercise) {
    await playClip(summary);
  }
  return summary;
}

async function playClip(session: SessionSummary): Promise<void> {
  if (!session.audioBlob) return;
  if (handle) await finishSession();
  transport.stop();

  historyModal.close();
  clearDisplays();
  startBtn.disabled = true;
  stopBtn.disabled = false;

  const onEndedAtClip = () => {
    transport.markEnded();
    setStatus("playback ended — rewind to replay");
  };

  if (settings.precomputePlayback) {
    setStatus("analyzing clip…");
    const timeline = await precomputeAnalysis(session.audioBlob, currentAnalysisConfig());
    setStatus("playing back…");
    transport.attach(
      await startPrecomputedPlayback(
        timeline,
        session.audioBlob,
        (result) => renderSpectrumResult(result),
        (results) => replaySeek(results),
        onEndedAtClip,
      ),
    );
  } else {
    setStatus("playing back…");
    transport.attach(
      await startPlayback(session.audioBlob, (result) => renderSpectrumResult(result), currentAnalysisConfig(), onEndedAtClip),
    );
  }
}

/** Runs an externally-recorded file through the same analysis pipeline as a live/precomputed
 *  clip, then saves it as a regular session — so an imported file is fully comparable (stats,
 *  history, Compare view) to anything captured in-app. */
async function importAudioFile(file: File): Promise<void> {
  if (handle) await finishSession();
  transport.stop();
  setStatus("analyzing imported audio…");
  feedbackSmoother.reset();
  sessionAggregator.reset();

  const timeline = await precomputeAnalysis(file, currentAnalysisConfig());
  for (const { result } of timeline) {
    const smoothed = feedbackSmoother.process(result, settings.floorDb);
    sessionAggregator.addFrame(smoothed, resolveTargetRange(settings), {
      clipping: result.clipping,
      iAnchorF2: settings.iAnchorF2,
    });
  }

  const durationMs = timeline.length > 0 ? timeline[timeline.length - 1].timeSec * 1000 : 0;
  const endedAt = Date.now();
  const summary = sessionAggregator.finalize({
    startedAt: endedAt - durationMs,
    endedAt,
    targetRangePreset: settings.targetRangePreset,
    targetRangeHz: resolveTargetRange(settings),
    audioBlob: file,
    audioMimeType: file.type || null,
    exerciseId: null,
  });
  feedbackSmoother.reset();
  sessionAggregator.reset();

  const saved = await saveSession(summary);
  if (saved) await sessionsPanel.refresh();
  else setStatus("import finished (couldn't save to history)");

  await playClip(summary);
}

const exercisePanel = new ExercisePanel(
  exercisesBody,
  {
    onStart: async (exercise: ExerciseDefinition) => {
      if (handle) await finishSession();
      await start(exercise.id);
    },
    onFinish: () => finishSession(),
    onCancel: () => {
      void finishSession();
    },
    getLiveStatus: () => {
      if (!lastSmoothed) return null;
      const target = resolveTargetRange(settings);
      const inTarget =
        target && lastSmoothed.pitchHz !== null ? lastSmoothed.pitchHz >= target[0] && lastSmoothed.pitchHz <= target[1] : null;
      return {
        pitchHz: lastSmoothed.pitchHz,
        inTarget,
        ringTwangPct: lastSmoothed.hasSignal ? lastSmoothed.ringTwangRatio * 100 : null,
      };
    },
  },
  EXERCISES,
);
void exercisePanel; // constructed for its side effects (renders into exercisesBody)

startBtn.addEventListener("click", () => void start());
stopBtn.addEventListener("click", () => void finishSession());
window.addEventListener("beforeunload", () => {
  void handle?.stop();
  transport.stop();
});

window.addEventListener("keydown", (e) => {
  const tag = (e.target as HTMLElement | null)?.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
  if (e.code === "Space") {
    e.preventDefault();
    if (transport.isActive()) transport.togglePlayPause();
    else if (handle) void finishSession();
    else if (!startBtn.disabled) void start();
  } else if (e.key.toLowerCase() === "c") {
    clearDisplays();
  } else if (e.key === "Escape" && !settingsDrawer.hidden) {
    settingsPanel.closeDrawer();
  }
});

clearBtn.addEventListener("click", () => clearDisplays());

deviceSelect.addEventListener("change", () => {
  onboardingDeviceSelect.value = deviceSelect.value;
  if (!handle) return;
  void start();
});

onboardingDeviceSelect.addEventListener("change", () => {
  deviceSelect.value = onboardingDeviceSelect.value;
  if (!handle) return;
  void start();
});

sourceSelect.addEventListener("change", () => {
  captureSource = sourceSelect.value as CaptureSource;
  deviceSelect.hidden = captureSource !== "microphone";
  if (handle) void finishSession(); // switching source mid-capture needs a fresh explicit Start
});

if (!isDisplayCaptureSupported()) {
  const displayOption = sourceSelect.querySelector<HTMLOptionElement>('option[value="display"]')!;
  displayOption.disabled = true;
  displayOption.textContent += " (not supported on this device)";
}
