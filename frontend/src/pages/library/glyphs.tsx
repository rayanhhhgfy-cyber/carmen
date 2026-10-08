/**
 * Typed facades over the shared glyph + artwork components.
 *
 * `components/icons` and `components/Artwork` migrate from `.jsx` to `.tsx`
 * while the rest of the app does, and `allowJs` stays off — until their
 * typed twins exist, a `.tsx` file importing them directly would raise
 * TS7016 ("implicitly has an 'any' type"). The two single-line imports
 * below therefore carry a targeted `@ts-ignore` (a silent no-op once the
 * module resolves to a typed `.tsx`) and every export is re-typed by hand,
 * so the rest of the Library code keeps full type safety in either state.
 *
 * New glyphs the shared set gains during the migration (shuffle, hearts,
 * sort, …) are pulled through the same door — they exist by the time the
 * app builds, and the facade hides which format they ship in.
 */
import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

// @ts-ignore — silences TS7016 while this resolves to the `.jsx` original.
import * as glyphs from '../../components/icons';
// @ts-ignore — silences TS7016 while this resolves to the `.jsx` original.
import ArtworkComponent from '../../components/Artwork';

/** Every glyph is an `SvgIcon`: it honours `sx`, `fontSize`, `color`, … */
export type Glyph = ComponentType<SvgIconProps>;

/** Re-types an untyped `.jsx` export without changing its runtime value. */
function glyph(value: unknown): Glyph {
  return value as Glyph;
}

/* ── transport / playback ─────────────────────────────────────────────── */

export const PlayArrowIcon = glyph(glyphs.PlayArrowIcon);
export const PauseIcon = glyph(glyphs.PauseIcon);
export const ShuffleIcon = glyph(glyphs.ShuffleIcon);

/* ── favourites ───────────────────────────────────────────────────────── */

export const HeartIcon = glyph(glyphs.HeartIcon);
export const HeartFilledIcon = glyph(glyphs.HeartFilledIcon);

/* ── navigation / chrome ──────────────────────────────────────────────── */

export const LibraryIcon = glyph(glyphs.LibraryIcon);
export const ArrowBackIcon = glyph(glyphs.ArrowBackIcon);
export const ChevronLeftIcon = glyph(glyphs.ChevronLeftIcon);
export const ChevronRightIcon = glyph(glyphs.ChevronRightIcon);
export const CloseIcon = glyph(glyphs.CloseIcon);

/* ── library actions ──────────────────────────────────────────────────── */

export const SortIcon = glyph(glyphs.SortIcon);
export const PlaylistAddIcon = glyph(glyphs.PlaylistAddIcon);
export const EditIcon = glyph(glyphs.EditIcon);
export const PlusIcon = glyph(glyphs.PlusIcon);
export const TrashIcon = glyph(glyphs.TrashIcon);
export const MoreVertIcon = glyph(glyphs.MoreVertIcon);
export const CheckCircleIcon = glyph(glyphs.CheckCircleIcon);
export const DownloadIcon = glyph(glyphs.DownloadIcon);
export const RefreshIcon = glyph(glyphs.RefreshIcon);

/* ── row / card furniture ─────────────────────────────────────────────── */

export const MusicNoteIcon = glyph(glyphs.MusicNoteIcon);
export const QueueMusicIcon = glyph(glyphs.QueueMusicIcon);
export const ExplicitIcon = glyph(glyphs.ExplicitIcon);
export const AlbumIcon = glyph(glyphs.AlbumIcon);
export const UserIcon = glyph(glyphs.UserIcon);
export const HistoryIcon = glyph(glyphs.HistoryIcon);
export const InfoIcon = glyph(glyphs.InfoIcon);

/* ── artwork tile ─────────────────────────────────────────────────────── */

export interface ArtworkProps {
  /** Artwork URL (largest JPEG available) — `null` falls back to the glyph. */
  src?: string | null;
  alt?: string;
  /** Fallback glyph shown while there is no / no usable artwork. */
  icon?: Glyph;
  /** `fontSize` of the fallback glyph. */
  iconSize?: number;
  sx?: SxProps<Theme>;
  imgSx?: SxProps<Theme>;
  /** Anything else is forwarded to the underlying `Box` (e.g. `className`). */
  [key: string]: unknown;
}

/** The throttled, cached artwork tile (see `components/Artwork`). */
export const Artwork = ArtworkComponent as unknown as ComponentType<ArtworkProps>;
