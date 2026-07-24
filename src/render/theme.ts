/** True when the light theme is active (see main.ts's applyTheme(), which sets this attribute).
 *  Canvases can't use CSS custom properties directly, so anything drawn with a theme-dependent
 *  color needs to check this at draw time instead. */
export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === "light";
}

/**
 * The pale-gold accent used for Weight/CPP, F2, Shimmer, and Androgynous readouts. It reads fine
 * against the dark theme's near-black surfaces, but nearly disappears against the light theme's
 * white/light-gray ones — this picks a darker, more saturated amber there instead.
 */
export function goldAccent(): string {
  return isLightTheme() ? "#8a6d00" : "#ffe9a8";
}
