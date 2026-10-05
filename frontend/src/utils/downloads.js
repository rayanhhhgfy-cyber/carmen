/**
 * Client side MP3 download pipeline.
 *
 * Everything happens in the browser:
 *   1. fetch the audio bytes from the server side buffer (/stream)
 *   2. transcode to MP3 with ffmpeg.wasm
 *   3. attach ID3v2.3 tags — title, artists, album, year, genre, cover art
 *      and both synced (SYLT) and unsynced (USLT) lyrics
 *   4. save the resulting .mp3 file
 */
import { ID3Writer } from 'browser-id3-writer';
import { streamUrl } from '../api';
import { safeFileName } from './format';
import { pickArtwork } from './track';

// ── Observable download store ───────────────────────────────────────────────

const listeners = new Set();

let store = { jobs: {}, notice: null };
let noticeSeq = 0;

function commit(next) {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

function patchJob(videoId, patch) {
  const job = store.jobs[videoId] || { videoId };
  commit({ jobs: { ...store.jobs, [videoId]: { ...job, ...patch } } });
}

function setNotice(severity, message) {
  noticeSeq += 1;
  commit({ notice: { id: noticeSeq, severity, message } });
}

export function subscribeDownloads(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDownloadsSnapshot() {
  return store;
}

export function clearNotice() {
  if (store.notice) commit({ notice: null });
}

// ── ffmpeg.wasm ─────────────────────────────────────────────────────────────

let ffmpegPromise = null;

async function loadFFmpeg() {
  const { FFmpeg } = await import('@ffmpeg/ffmpeg');
  const ffmpeg = new FFmpeg();

  const localCore = (await import('@ffmpeg/core?url')).default;
  const localWasm = (await import('@ffmpeg/core/wasm?url')).default;
  const cdn = import.meta.env.VITE_FFMPEG_CDN;

  try {
    await ffmpeg.load({ coreURL: localCore, wasmURL: localWasm });
  } catch (localError) {
    if (!cdn) throw localError;
    await ffmpeg.load({
      coreURL: `${cdn}/ffmpeg-core.js`,
      wasmURL: `${cdn}/ffmpeg-core.wasm`,
    });
  }
  return ffmpeg;
}

function getFFmpeg() {
  if (!ffmpegPromise) {
    ffmpegPromise = loadFFmpeg().catch((error) => {
      ffmpegPromise = null; // allow a retry on the next download
      throw error;
    });
  }
  return ffmpegPromise;
}

async function fetchAudio(videoId, onProgress) {
  const response = await fetch(streamUrl(videoId));
  if (!response.ok) {
    let detail = `audio request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = String(payload.detail);
    } catch {
      /* not a json body */
    }
    throw new Error(detail);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body || !total) return response.arrayBuffer();

  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(Math.min(loaded / total, 1));
  }

  const buffer = new Uint8Array(loaded);
  let offset = 0;
  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });
  return buffer.buffer;
}

async function toMp3(arrayBuffer, onProgress) {
  const ffmpeg = await getFFmpeg();
  const inputName = 'input.audio';
  const outputName = 'output.mp3';

  const handleProgress = ({ progress }) => {
    if (Number.isFinite(progress)) onProgress(Math.min(Math.max(progress, 0), 1));
  };
  ffmpeg.on('progress', handleProgress);

  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuffer));
    const code = await ffmpeg.exec([
      '-i',
      inputName,
      '-vn',
      '-map_metadata',
      '-1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      outputName,
    ]);
    if (code !== 0) throw new Error(`transcoding failed (code ${code})`);

    const data = await ffmpeg.readFile(outputName);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } finally {
    ffmpeg.off('progress', handleProgress);
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      /* files may not exist */
    }
  }
}

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Cover art for the ID3 APIC frame.
 *
 * The largest YouTube Music artwork is the last entry of the payload's
 * thumbnail list, so it is tried first; the plain YouTube thumbnail is only
 * a last resort.  A `429` from the image CDN is retried after a short pause.
 */
async function fetchArtwork(track, meta) {
  const candidates = [
    ...new Set(
      [
        pickArtwork(meta?.thumbnails),
        track.artwork,
        track.videoId
          ? `https://i.ytimg.com/vi/${track.videoId}/maxresdefault.jpg`
          : null,
        track.videoId
          ? `https://i.ytimg.com/vi/${track.videoId}/hq720.jpg`
          : null,
      ].filter(Boolean),
    ),
  ];

  for (const url of candidates) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, { mode: 'cors' });
        if (response.status === 429 || response.status === 503) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        if (!response.ok) break;
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 1024) return buffer;
        break;
      } catch {
        await sleep(300);
        break;
      }
    }
  }
  return null;
}

// ── ID3 tagging ─────────────────────────────────────────────────────────────

function buildTaggedBuffer(mp3Buffer, track, meta, coverBuffer) {
  const writer = new ID3Writer(mp3Buffer);

  const artists = (track.artists || [])
    .map((artist) => (typeof artist === 'string' ? artist : artist?.name))
    .filter(Boolean);

  writer.setFrame('TIT2', track.title || 'Unknown title');
  if (artists.length) writer.setFrame('TPE1', artists);
  else if (track.artist) writer.setFrame('TPE1', [track.artist]);
  if (track.albumName) writer.setFrame('TALB', track.albumName);

  const year = Number.parseInt(meta?.year || track.year || '', 10);
  if (Number.isFinite(year)) writer.setFrame('TYER', year);

  if (meta?.genre) writer.setFrame('TCON', [String(meta.genre)]);
  if (track.durationSeconds) writer.setFrame('TLEN', Math.round(track.durationSeconds * 1000));
  if (track.isExplicit) writer.setFrame('TCMP', 0);

  if (coverBuffer) {
    writer.setFrame('APIC', {
      type: 3,
      data: coverBuffer,
      description: 'Cover picture',
    });
  }

  const synced = Array.isArray(meta?.lyrics?.synced) ? meta.lyrics.synced : null;
  const unsynced =
    typeof meta?.lyrics?.unsynced === 'string' && meta.lyrics.unsynced.trim()
      ? meta.lyrics.unsynced
      : null;

  if (synced?.length) {
    writer.setFrame('SYLT', {
      type: 1, // lyrics
      timestampFormat: 2, // milliseconds
      language: 'eng',
      description: 'Synced lyrics',
      text: synced.map((line) => [String(line.text ?? ''), Number(line.timeMs) || 0]),
    });
  }

  // USLT keeps plain lyrics readable in players that ignore SYLT
  const plain = unsynced || (synced ? synced.map((line) => line.text).join('\n') : null);
  if (plain) {
    writer.setFrame('USLT', {
      language: 'eng',
      description: 'Lyrics',
      lyrics: plain,
    });
  }

  if (meta?.album?.name && !track.albumName) writer.setFrame('TALB', meta.album.name);

  writer.addTag();
  return writer;
}

function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ── Public API ──────────────────────────────────────────────────────────────

function isRunning(videoId) {
  const job = store.jobs[videoId];
  return Boolean(job && (job.status === 'running' || job.status === 'done'));
}

/**
 * Download a track as a tagged .mp3 file.
 *
 * @param {object} track normalized track
 * @param {object|null} meta enriched payload from /browsing/track/{id}
 */
export function startDownload(track, meta) {
  if (!track?.videoId || isRunning(track.videoId)) return;

  patchJob(track.videoId, {
    title: track.title,
    status: 'running',
    step: 'Downloading audio',
    progress: 0,
  });

  const videoId = track.videoId;
  const finish = async () => {
    const audioBuffer = await fetchAudio(videoId, (ratio) =>
      patchJob(videoId, { step: 'Downloading audio', progress: ratio * 0.4 }),
    );

    patchJob(videoId, { step: 'Loading converter', progress: 0.42 });
    const mp3Buffer = await toMp3(audioBuffer, (ratio) =>
      patchJob(videoId, { step: 'Converting to MP3', progress: 0.42 + ratio * 0.43 }),
    );

    patchJob(videoId, { step: 'Writing tags', progress: 0.88 });
    const cover = await fetchArtwork(track, meta);

    const writer = buildTaggedBuffer(mp3Buffer, track, meta, cover);
    const fileName = `${safeFileName(
      track.artist ? `${track.artist} - ${track.title}` : track.title,
    )}.mp3`;
    saveBlob(writer.getBlob(), fileName);

    patchJob(videoId, { status: 'done', step: 'Saved', progress: 1 });
    setNotice('success', `Saved "${fileName}"`);
  };

  finish().catch((error) => {
    patchJob(videoId, {
      status: 'error',
      step: 'Failed',
      progress: 0,
      error: error?.message || 'Download failed',
    });
    setNotice('error', error?.message || 'Download failed');
  });
}
