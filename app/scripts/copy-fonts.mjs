#!/usr/bin/env node
/**
 * Copies the static TTFs used by the app into app/assets/fonts (committed to git).
 *
 * - @expo-google-fonts/* ships one TTF per weight inside a per-weight folder
 *   (e.g. 400Regular/Alexandria_400Regular.ttf), so we glob by filename prefix
 *   recursively instead of assuming a flat layout.
 * - react-native-vector-icons' font path varies by version, so MaterialIcons
 *   is located with a prefix search too (find -name 'MaterialIcons*.ttf').
 *
 * A missing weight only prints a warning; it never crashes the script.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(APP_ROOT, 'assets', 'fonts');

const WEIGHTS = ['400Regular', '500Medium', '600SemiBold', '700Bold', '800ExtraBold'];

/** Recursively collect files under `dir` whose basename matches `pred`. */
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p, pred, out);
    } else if (pred(basename(p))) {
      out.push(p);
    }
  }
  return out;
}

/** Copy `{Family}_{weight}.ttf` for each expected weight of an @expo-google-fonts package. */
function copyGoogleFont(pkgDir, family) {
  const files = walk(
    join(APP_ROOT, 'node_modules', pkgDir),
    (name) => name.startsWith(`${family}_`) && name.endsWith('.ttf'),
  );
  let copied = 0;
  for (const weight of WEIGHTS) {
    const expected = `${family}_${weight}.ttf`;
    const hit = files.find((f) => basename(f) === expected);
    if (hit) {
      cpSync(hit, join(OUT_DIR, expected));
      copied += 1;
    } else {
      console.warn(`warning: missing ${expected} in node_modules/${pkgDir} (skipping)`);
    }
  }
  return copied;
}

mkdirSync(OUT_DIR, { recursive: true });

let total = copyGoogleFont('@expo-google-fonts/alexandria', 'Alexandria');
total += copyGoogleFont('@expo-google-fonts/cairo', 'Cairo');

// MaterialIcons.ttf — path varies by version, glob by prefix.
const iconCandidates = walk(
  join(APP_ROOT, 'node_modules', 'react-native-vector-icons'),
  (name) => /^MaterialIcons.*\.ttf$/.test(name),
);
const material =
  iconCandidates.find((f) => basename(f) === 'MaterialIcons.ttf') ?? iconCandidates[0];
if (material) {
  cpSync(material, join(OUT_DIR, 'MaterialIcons.ttf'));
  total += 1;
} else {
  console.warn(
    'warning: MaterialIcons*.ttf not found under node_modules/react-native-vector-icons (skipping)',
  );
}

console.log(`copy-fonts: ${total} TTF(s) copied to ${OUT_DIR}`);
if (total === 0) {
  console.warn('copy-fonts: nothing was copied — check that devDependencies are installed');
  process.exitCode = 1;
}
