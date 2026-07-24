import { abs, add, div, mul, sub, type Complex } from "./complex.ts";

function evalPoly(coeffs: number[], z: Complex): Complex {
  let result: Complex = { re: 0, im: 0 };
  for (const c of coeffs) {
    result = add(mul(result, z), { re: c, im: 0 });
  }
  return result;
}

/**
 * Durand-Kerner method: finds all roots of a real polynomial simultaneously.
 * `coeffs` is descending-degree (leading coefficient first), length = degree + 1.
 */
export function durandKerner(coeffs: number[], iterations = 100): Complex[] {
  const degree = coeffs.length - 1;
  if (degree <= 0) return [];
  const leading = coeffs[0];
  const normalized = coeffs.map((c) => c / leading);

  // Seed with powers of a non-real base so initial guesses are distinct and asymmetric.
  const base: Complex = { re: 0.4, im: 0.9 };
  let roots: Complex[] = [];
  let seed: Complex = { re: 1, im: 0 };
  for (let i = 0; i < degree; i++) {
    seed = mul(seed, base);
    roots.push(seed);
  }

  for (let iter = 0; iter < iterations; iter++) {
    let maxDelta = 0;
    const next = roots.slice();
    for (let i = 0; i < degree; i++) {
      let denom: Complex = { re: 1, im: 0 };
      for (let j = 0; j < degree; j++) {
        if (j !== i) denom = mul(denom, sub(roots[i], roots[j]));
      }
      const numerator = evalPoly(normalized, roots[i]);
      const delta = div(numerator, denom);
      next[i] = sub(roots[i], delta);
      maxDelta = Math.max(maxDelta, abs(delta));
    }
    roots = next;
    if (maxDelta < 1e-9) break;
  }
  return roots;
}
