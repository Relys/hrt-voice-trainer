import { startCapture, type AnalysisConfig } from "./capture.ts";

export interface NoiseCalibrationResult {
  measuredDb: number;
  recommendedFloorDb: number;
}

/** How far above the measured noise floor to set Floor — enough margin that normal ambient
 *  fluctuation doesn't creep back above the line. */
const CALIBRATION_MARGIN_DB = 10;
const FLOOR_MIN_DB = -110;
const FLOOR_MAX_DB = -40;
const DEFAULT_CONFIG: AnalysisConfig = { windowSeconds: 0.032, lpcOrder: 12 };

/**
 * Records ~durationMs of ambient audio through the same live-capture pipeline used everywhere
 * else in the app, averages the measured input level, and suggests a Floor setting above it —
 * replacing slider guesswork with an actual measurement of this mic/room's real noise floor.
 */
export async function calibrateNoiseFloor(
  durationMs = 3000,
  onTick?: (remainingMs: number) => void,
  deviceId?: string,
): Promise<NoiseCalibrationResult> {
  const levels: number[] = [];
  const handle = await startCapture(
    (result) => levels.push(result.inputLevelDb),
    "microphone",
    deviceId,
    DEFAULT_CONFIG,
    { record: false },
  );

  const start = Date.now();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const remaining = durationMs - (Date.now() - start);
      if (remaining <= 0) {
        clearInterval(interval);
        resolve();
      } else {
        onTick?.(remaining);
      }
    }, 200);
  });

  await handle.stop();

  const finiteLevels = levels.filter((v) => Number.isFinite(v));
  const measuredDb = finiteLevels.length > 0 ? finiteLevels.reduce((a, b) => a + b, 0) / finiteLevels.length : FLOOR_MIN_DB;
  const recommendedFloorDb = Math.max(FLOOR_MIN_DB, Math.min(FLOOR_MAX_DB, Math.round(measuredDb + CALIBRATION_MARGIN_DB)));
  return { measuredDb, recommendedFloorDb };
}
