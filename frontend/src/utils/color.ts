/**
 * Colour helpers for the Tailwind era.
 *
 * `alpha()` replaces `@mui/material/styles`'s `alpha()` with a CSS
 * `color-mix()` string — it works on the theme variables (`var(--app-text)`)
 * as well as hex literals, which the MUI version never could, and every
 * target of this app (modern WKWebView) supports `color-mix`.
 */

/**
 * Blend `color` toward transparency by `amount` (0–1).
 *
 * `alpha('var(--app-text)', 0.16)` → `color-mix(in srgb, var(--app-text) 16%, transparent)`
 */
export function alpha(color: string, amount: number): string {
  const pct = Math.round(Math.min(Math.max(amount, 0), 1) * 100);
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}
