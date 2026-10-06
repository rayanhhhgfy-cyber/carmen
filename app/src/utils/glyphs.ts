/**
 * Codepoints of MaterialIcons.ttf actually used by the app.
 *
 * Every value is a REAL codepoint from
 * `node_modules/react-native-vector-icons/glyphmaps/MaterialIcons.json`
 * (the glyphmap stores kebab-case names; camelCase entries below were
 * resolved through them, e.g. `queueMusic` → `queue-music`).
 *
 * Dropped vs the plan's example, because no such glyph exists in
 * MaterialIcons.json:
 * - `chevronDown` (plan hex e5c7 actually resolves to `arrow-drop-up`);
 *   restored as `expand-more` (e5cf).
 * - `device` (plan hex e337 actually resolves to `devices-other`);
 *   restored as `devices` (e1b1).
 *
 * `play` has no literal `play` entry; it maps to `play-arrow` (e037),
 * which is exactly what the plan's hex pointed at.
 */
export const GLYPHS = {
  home: 'e88a', search: 'e8b6', queueMusic: 'e03d', settings: 'e8b8',
  play: 'e037', pause: 'e034', skipNext: 'e044', skipPrevious: 'e045',
  shuffle: 'e043', repeat: 'e040', repeatOne: 'e041', favorite: 'e87d',
  favoriteBorder: 'e87e', download: 'f090', lyrics: 'ec0b', libraryMusic: 'e030',
  album: 'e019', person: 'e7fd', close: 'e5cd', arrowBack: 'e5c4',
  moreVert: 'e5d4', chevronDown: 'e5cf', chevronRight: 'e5cc', check: 'e5ca',
  refresh: 'e5d5', history: 'e889', lightMode: 'e518', darkMode: 'e51c',
  device: 'e1b1', add: 'e145', delete: 'e872', edit: 'e3c9', sort: 'e164',
  filterList: 'e152', info: 'e88e', openInNew: 'e89e', musicNote: 'e405',
} as const;
export type GlyphName = keyof typeof GLYPHS;
