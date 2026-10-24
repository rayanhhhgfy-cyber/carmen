/**
 * Faithful TypeScript port of `server/matching.py` — Spotify → YouTube
 * Music track matching, run entirely in the client so playlist import
 * works against a Carmen server that has no `/convert/*` endpoints.
 *
 * Every function mirrors the Python original, quirks included:
 *
 * - title similarity 55% / artist 30% / duration 15%;
 * - `matched` ≥ 0.78, `approximate` ≥ 0.50, below that `not_found`;
 * - a title similarity under the 0.45 floor zeroes the candidate outright;
 * - unknown durations score a neutral 0.5 (absence of evidence is not
 *   evidence of a wrong match);
 * - string similarity is difflib's `SequenceMatcher.ratio()` (Ratcliff–
 *   Obershelp), ported below — including the multi-token containment
 *   fast-lane (0.93) and the "The Beatles" artist containment bonus (0.92).
 *
 * The one deliberate divergence: `matchTrack` is async and its `search`
 * callable returns a promise — the client's searches are network calls,
 * where the Python caller injects a blocking callable. The query cascade,
 * candidate pooling and early exit at the matched threshold are unchanged.
 * (difflib's `autojunk` heuristic is omitted: it only engages for strings
 * longer than 200 characters, which normalized titles/artists never are.)
 */
import type { SourceTrackInfo } from './spotifyConvert';

/* ── constants (server/matching.py) ───────────────────────────────────── */

export const MATCHED_THRESHOLD = 0.78;
export const APPROXIMATE_THRESHOLD = 0.5;
export const TITLE_WEIGHT = 0.55;
export const ARTIST_WEIGHT = 0.3;
export const DURATION_WEIGHT = 0.15;
export const TITLE_FLOOR = 0.45;

/* ── text normalization ───────────────────────────────────────────────── */

const VERSION_SUFFIX_RES = [
  /\s*-\s*.*\bremaster\w*\b.*$/i,
  /\s*-\s*(single|ep|deluxe|expanded|anniversary|tour)\b.*$/i,
];
const PAREN_RE = /\s*[(\[].*?[)\]]/g;
// Trailing "feat. X" / "ft. X" without parentheses.
const FEAT_RE = /\s*\b(feat|ft|featuring)\b\.?\s+[^-]+$/i;
// Collaboration separators inside one artist string ("with" excluded —
// real band names like "With Confidence" would split into nonsense).
const ARTIST_SPLIT_RE =
  /\s*(?:,|&|\+|×|\bx\b|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b)\s*/i;

const COMBINING_RE = /\p{M}/u;

/** Lowercase, de-accent, de-punctuate — the canonical compare form. */
export function normalizeText(value: string | null | undefined): string {
  let text = (value ?? '').normalize('NFKD');
  // Drop combining marks (unicodedata.combining() != 0 in the original).
  text = [...text].filter((char) => !COMBINING_RE.test(char)).join('');
  text = text.toLowerCase();
  text = text.replace(PAREN_RE, ' ');
  for (const pattern of VERSION_SUFFIX_RES) text = text.replace(pattern, '');
  text = text.replace(FEAT_RE, '');
  text = text.replace(/[^a-z0-9\s]/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

/* ── difflib SequenceMatcher.ratio() port ─────────────────────────────── */

interface MatchBlock {
  a: number;
  b: number;
  size: number;
}

function buildB2j(b: string[]): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  b.forEach((char, index) => {
    const list = b2j.get(char);
    if (list) list.push(index);
    else b2j.set(char, [index]);
  });
  return b2j;
}

function findLongestMatch(
  a: string[],
  b: string[],
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): MatchBlock {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  // j2len[j] = length of the longest match ending at a[i-1], b[j].
  let j2len = new Map<number, number>();
  for (let i = alo; i < ahi; i += 1) {
    const newj2len = new Map<number, number>();
    for (const j of b2j.get(a[i]) ?? []) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newj2len.set(j, k);
      if (k > bestSize) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestSize = k;
      }
    }
    j2len = newj2len;
  }
  return { a: bestI, b: bestJ, size: bestSize };
}

function matchingBlocks(a: string[], b: string[]): MatchBlock[] {
  const b2j = buildB2j(b);
  const blocks: MatchBlock[] = [];
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop() as [number, number, number, number];
    const match = findLongestMatch(a, b, alo, ahi, blo, bhi, b2j);
    const { a: i, b: j, size: k } = match;
    if (k > 0) {
      blocks.push(match);
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  blocks.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size);
  // Collapse adjacent equal blocks (difflib's merge step).
  const merged: MatchBlock[] = [];
  let i1 = 0;
  let j1 = 0;
  let k1 = 0;
  for (const block of blocks) {
    if (i1 + k1 === block.a && j1 + k1 === block.b) {
      k1 += block.size;
    } else {
      if (k1 > 0) merged.push({ a: i1, b: j1, size: k1 });
      i1 = block.a;
      j1 = block.b;
      k1 = block.size;
    }
  }
  if (k1 > 0) merged.push({ a: i1, b: j1, size: k1 });
  merged.push({ a: a.length, b: b.length, size: 0 });
  return merged;
}

/** difflib `SequenceMatcher(None, a, b).ratio()` — 2*M/T. */
function sequenceRatio(a: string, b: string): number {
  const aChars = [...a];
  const bChars = [...b];
  const total = aChars.length + bChars.length;
  if (total === 0) return 1;
  const matches = matchingBlocks(aChars, bChars).reduce((sum, block) => sum + block.size, 0);
  return (2 * matches) / total;
}

/* ── similarity ───────────────────────────────────────────────────────── */

/** 0–1 string similarity on the normalized forms. */
export function similarity(left: string | null | undefined, right: string | null | undefined): number {
  const leftNorm = normalizeText(left);
  const rightNorm = normalizeText(right);
  if (!leftNorm || !rightNorm) return 0;
  if (leftNorm === rightNorm) return 1;
  // Token containment (multi-token titles only): "blinding lights" inside
  // "blinding lights single" is the same song with a suffix. Single-token
  // titles skip this — "up" inside "stand up" would be a false friend.
  const leftTokens = new Set(leftNorm.split(' '));
  const rightTokens = new Set(rightNorm.split(' '));
  if (
    leftTokens.size >= 2 &&
    rightTokens.size >= 2 &&
    ([...leftTokens].every((token) => rightTokens.has(token)) ||
      [...rightTokens].every((token) => leftTokens.has(token)))
  ) {
    return 0.93;
  }
  return sequenceRatio(leftNorm, rightNorm);
}

/* ── YouTube Music candidate helpers ──────────────────────────────────── */

type RawItem = Record<string, unknown>;

function isRecord(value: unknown): value is RawItem {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Artist display names out of a YouTube Music search item, any shape. */
export function ytmArtistNames(item: RawItem): string[] {
  const names: string[] = [];
  const artists = item?.artists;
  if (typeof artists === 'string') {
    names.push(artists);
  } else if (Array.isArray(artists)) {
    for (const artist of artists) {
      if (typeof artist === 'string' && artist.trim()) names.push(artist.trim());
      else if (isRecord(artist) && artist.name) names.push(String(artist.name).trim());
    }
  }
  const artist = item?.artist;
  if (typeof artist === 'string' && artist.trim()) names.push(artist.trim());
  // De-dupe, keep order.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const key = normalizeText(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(name);
    }
  }
  return unique;
}

/** Split one artist string into its collaborators: "A, B" → {"a", "b"}. */
function artistTokens(name: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of (name || '').split(ARTIST_SPLIT_RE)) {
    const token = normalizeText(part);
    if (token) tokens.add(token);
  }
  return tokens;
}

/**
 * Best artist similarity across both sides: pairwise string similarity
 * (with the "Beatles"/"The Beatles" containment fast-lane) plus
 * collaboration-aware token overlap.
 */
export function artistSimilarity(sourceArtists: string[], ytmItem: RawItem): number {
  const candidates = ytmArtistNames(ytmItem);
  if (!sourceArtists.length || !candidates.length) return 0;
  let best = 0;
  for (const sourceArtist of sourceArtists) {
    const sourceNorm = normalizeText(sourceArtist);
    const sourceTokens = artistTokens(sourceArtist);
    for (const candidate of candidates) {
      const candidateNorm = normalizeText(candidate);
      let score = similarity(sourceArtist, candidate);
      // "The Beatles" vs "Beatles" (or vice versa) is the same act.
      if (
        sourceNorm &&
        candidateNorm &&
        (candidateNorm.includes(sourceNorm) || sourceNorm.includes(candidateNorm))
      ) {
        score = Math.max(score, 0.92);
      }
      // Token overlap: any shared collaborator counts.
      const candidateTokens = artistTokens(candidate);
      const shared = [...sourceTokens].filter((token) => candidateTokens.has(token));
      if (shared.length) {
        const union = new Set([...sourceTokens, ...candidateTokens]);
        score = Math.max(score, 0.6 + 0.4 * (shared.length / union.size));
      }
      best = Math.max(best, score);
    }
  }
  return best;
}

/** `server/filters.parse_duration_seconds` — the subset matching needs. */
export function parseDurationSeconds(value: unknown): number | null {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Math.trunc(value);
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
    const parts = text.split(':');
    if (
      parts.length > 1 &&
      parts.length <= 4 &&
      parts.every((part) => /^\d+$/.test(part.trim()))
    ) {
      let seconds = 0;
      for (const part of parts) seconds = seconds * 60 + Number.parseInt(part.trim(), 10);
      return seconds;
    }
  }
  return null;
}

/** Duration of a YouTube Music item in seconds, any key shape. */
export function ytmDurationSeconds(item: RawItem): number | null {
  const seconds = parseDurationSeconds(item?.duration_seconds);
  if (seconds !== null) return seconds;
  return parseDurationSeconds(item?.duration);
}

/**
 * 1.0 when the durations agree within ~30 s, fading to 0 past that.
 * Unknown YouTube Music duration scores neutral (0.5).
 */
export function durationScore(sourceMs: number | null | undefined, ytmItem: RawItem): number {
  const ytmSeconds = ytmDurationSeconds(ytmItem);
  if (!sourceMs || ytmSeconds === null) return 0.5;
  const diff = Math.abs(sourceMs / 1000 - ytmSeconds);
  return Math.max(0, 1 - diff / 30);
}

/* ── scoring ──────────────────────────────────────────────────────────── */

/** The matcher input: the app's source track (stand-in for SpotifyTrack). */
export type MatchableTrack = Pick<SourceTrackInfo, 'title' | 'artists' | 'duration_ms'> &
  Partial<SourceTrackInfo>;

/** Weighted 0–1 match score for one YouTube Music candidate. */
export function scoreCandidate(track: MatchableTrack, ytmItem: RawItem): number {
  const titleSim = similarity(track.title, String(ytmItem?.title ?? ''));
  if (titleSim < TITLE_FLOOR) return 0;
  const artistSim = artistSimilarity(track.artists ?? [], ytmItem);
  const duration = durationScore(track.duration_ms, ytmItem);
  return TITLE_WEIGHT * titleSim + ARTIST_WEIGHT * artistSim + DURATION_WEIGHT * duration;
}

export type MatchStatusName = 'matched' | 'approximate' | 'not_found';

export function statusForScore(score: number): MatchStatusName {
  if (score >= MATCHED_THRESHOLD) return 'matched';
  if (score >= APPROXIMATE_THRESHOLD) return 'approximate';
  return 'not_found';
}

/* ── match loop ───────────────────────────────────────────────────────── */

export interface TrackMatch<T extends MatchableTrack = MatchableTrack> {
  track: T;
  status: MatchStatusName | 'error';
  /** 0–1, the winning candidate's score (rounded to 3 dp, as the server). */
  confidence: number;
  /** The raw YouTube Music item, or null when nothing was close enough. */
  match: RawItem | null;
  error: string | null;
}

export type SearchFn = (query: string) => Promise<unknown[]> | unknown[];

async function searchCandidates(search: SearchFn, query: string): Promise<RawItem[]> {
  try {
    const results = await search(query);
    return (results ?? []).filter(isRecord);
  } catch {
    // One bad query must not kill the batch (the server swallows too).
    return [];
  }
}

/**
 * Query cascade, cheapest first:
 * 1. `"<title> <first artist>"` — nails the common case;
 * 2. `"<normalized title> <first artist>"` — retry without version suffixes;
 * 3. bare `"<title>"` — last resort when the artist spelling differs.
 */
export function buildSearchQueries(track: MatchableTrack): string[] {
  const primaryArtist = track.artists?.[0] ?? '';
  const title = track.title ?? '';
  const queries = [`${title} ${primaryArtist}`.trim()];
  const normalizedTitle = normalizeText(title);
  if (normalizedTitle && normalizedTitle !== title.toLowerCase().trim()) {
    queries.push(`${normalizedTitle} ${primaryArtist}`.trim());
  }
  if (title) queries.push(title);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const query of queries) {
    if (query && !seen.has(query)) {
      seen.add(query);
      unique.push(query);
    }
  }
  return unique;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Find the best YouTube Music match for one source track.
 *
 * Walks the query cascade, stopping as soon as a candidate scores a
 * confident match — most tracks resolve on the first query.
 */
export async function matchTrack<T extends MatchableTrack>(
  track: T,
  search: SearchFn,
): Promise<TrackMatch<T>> {
  let bestItem: RawItem | null = null;
  let bestScore = 0;
  for (const query of buildSearchQueries(track)) {
    for (const candidate of await searchCandidates(search, query)) {
      const score = scoreCandidate(track, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestItem = candidate;
      }
    }
    if (bestScore >= MATCHED_THRESHOLD) break;
  }
  const status = statusForScore(bestScore);
  if (status === 'not_found') {
    return { track, status, confidence: round3(bestScore), match: null, error: null };
  }
  return { track, status, confidence: round3(bestScore), match: bestItem, error: null };
}

/* Snake-case aliases mirroring the Python module's public names. */
export const normalize_text = normalizeText;
export const ytm_artist_names = ytmArtistNames;
export const artist_similarity = artistSimilarity;
export const ytm_duration_seconds = ytmDurationSeconds;
export const duration_score = durationScore;
export const score_candidate = scoreCandidate;
export const status_for_score = statusForScore;
export const match_track = matchTrack;
