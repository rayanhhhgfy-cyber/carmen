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
import { cdnArtworkJpg, pickArtwork } from './track';

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
 * Fetch one artwork URL, retrying a `429` / `503` with a short pause.
 *
 * @returns {Promise<Blob|null>}
 */
async function fetchImage(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response.status === 429 || response.status === 503) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      const blob = await response.blob();
      return blob.size > 1024 ? blob : null;
    } catch {
      await sleep(300);
      return null;
    }
  }
  return null;
}

/**
 * Cut the cover down to a **1:1** square.
 *
 * The CDN artwork is a 16:9 video frame while MP3 players expect square
 * cover art, so the centre of the frame is cropped here in the browser —
 * the image is never resized or re-encoded by the server.
 *
 * @param {Blob} blob original image
 * @returns {Promise<ArrayBuffer|null>} JPEG bytes, or null when unavailable
 */
async function toSquareJpeg(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      side,
      side,
    );
    if (typeof bitmap.close === 'function') bitmap.close();
    const jpeg = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );
    if (!jpeg) return null;
    const buffer = await jpeg.arrayBuffer();
    return buffer.byteLength > 1024 ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Cover art for the ID3 APIC frame — always square.
 *
 * The song's own cover comes from the i.ytimg CDN
 * (`/vi/<id>/maxresdefault.jpg`), then progressively smaller sizes of the
 * same CDN, and finally whatever the track payload carried.  Each answer is
 * centre cropped to 1:1 before it is embedded.
 */
async function fetchArtwork(track, meta) {
  const candidates = [
    ...new Set(
      [
        cdnArtworkJpg(track.videoId),
        track.videoId
          ? `https://i.ytimg.com/vi/${track.videoId}/hq720.jpg`
          : null,
        track.videoId
          ? `https://i.ytimg.com/vi/${track.videoId}/sddefault.jpg`
          : null,
        track.videoId
          ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`
          : null,
        pickArtwork(meta?.thumbnails),
        track.artwork,
      ].filter(Boolean),
    ),
  ];

  for (const url of candidates) {
    const blob = await fetchImage(url);
    if (!blob) continue;
    const square = await toSquareJpeg(blob);
    if (square) return square;
    const buffer = await blob.arrayBuffer();
    if (buffer.byteLength > 1024) return buffer;
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
