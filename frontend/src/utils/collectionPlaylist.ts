/**
 * "Download this collection" starts by saving it into the user's library:
 * a remote playlist / album (CollectionPage) has no library entry of its
 * own, so downloading its tracks one by one would leave a pile of loose
 * songs with no playlist to reopen.
 *
 * `ensureCollectionPlaylist` returns the library playlist holding exactly
 * these tracks under this name — the one that is already there when a
 * playlist with the same name *and* the same ordered track list exists
 * (tapping Download all twice, or on two collections that share a name,
 * must never duplicate), and a freshly created + filled one otherwise.
 */
import {
  addTrackToPlaylist,
  createPlaylist,
  listPlaylists,
  listPlaylistTracks,
} from '../db/repos/playlists';
import type { Track } from '../types/models';

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export async function ensureCollectionPlaylist(
  name: string,
  tracks: Track[],
): Promise<number> {
  const wanted = (tracks ?? []).filter((track) => track?.videoId);
  const wantedIds = wanted.map((track) => track.videoId);

  const candidates = (await listPlaylists()).filter((playlist) => playlist.name === name);
  for (const playlist of candidates) {
    const songs = await listPlaylistTracks(playlist.id);
    if (sameIds(songs.map((song) => song.videoId), wantedIds)) {
      return playlist.id;
    }
  }

  const playlistId = await createPlaylist(name);
  for (const track of wanted) {
    await addTrackToPlaylist(playlistId, track);
  }
  return playlistId;
}
