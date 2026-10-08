/**
 * Tiny classname joiner — the `clsx` role without the dependency.
 *
 * Falsy entries drop out, so call sites can write
 * `cn(base, isActive && 'bg-accent', className)`.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
