/** Singer's-formant / "ring-twang" cluster: energy here reads as a bright, forward, ringing quality. */
export const RING_TWANG_BAND_HZ: [number, number] = [2800, 3500];

/** Fraction of total spectral energy falling within [loHz, hiHz]. */
export function bandEnergyRatio(
  magnitudes: Float64Array,
  sampleRate: number,
  fftSize: number,
  loHz: number,
  hiHz: number,
): number {
  const loBin = Math.max(0, Math.round((loHz * fftSize) / sampleRate));
  const hiBin = Math.min(magnitudes.length - 1, Math.round((hiHz * fftSize) / sampleRate));
  let bandEnergy = 0;
  let totalEnergy = 0;
  for (let k = 0; k < magnitudes.length; k++) {
    const energy = magnitudes[k] * magnitudes[k];
    totalEnergy += energy;
    if (k >= loBin && k <= hiBin) bandEnergy += energy;
  }
  return totalEnergy > 0 ? bandEnergy / totalEnergy : 0;
}
