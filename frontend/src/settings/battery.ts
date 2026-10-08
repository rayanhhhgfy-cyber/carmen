/**
 * Battery tracking for the low-battery auto mode.
 *
 * Two sources, best effort ("if it's possible" — a missing one degrades to a
 * manual-only toggle, never to a crash):
 *
 *  1. the webview's Battery Status API (`navigator.getBattery`) — present in
 *     Chromium webviews (Windows, Android) and event-driven, no polling;
 *  2. the `battery_status` Tauri command (`src-tauri/commands/battery.rs`,
 *     backed by the `battery` crate) — for macOS / Linux, whose WebKit
 *     webviews have no battery API. Polled once a minute.
 *
 * The reading combines with the manual toggle in `settings/store.ts`
 * (`useLowBatteryMode`).
 */
import { useSyncExternalStore } from 'react';

import { invoke } from '@tauri-apps/api/core';

/** A battery reading; `level` / `charging` are `null` while unknown. */
export interface BatteryState {
  /** Charge level in `0..1`, or `null` when no source reported one. */
  level: number | null;
  /** Whether the battery is charging (plugged in), `null` when unknown. */
  charging: boolean | null;
  /** True once a source produced a reading — auto mode is possible. */
  supported: boolean;
}

/** Auto-on threshold: below this share of charge, while on battery power. */
const LOW_THRESHOLD = 0.2;
/** Native fallback poll interval — the web API path is event-driven. */
const POLL_MS = 60_000;

const UNKNOWN: BatteryState = { level: null, charging: null, supported: false };

let snapshot: BatteryState = UNKNOWN;
let started: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: BatteryState): void {
  if (
    next.level === snapshot.level &&
    next.charging === snapshot.charging &&
    next.supported === snapshot.supported
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function getBatterySnapshot(): BatteryState {
  return snapshot;
}

export function subscribeBattery(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live battery reading of the current device. */
export function useBattery(): BatteryState {
  return useSyncExternalStore(subscribeBattery, getBatterySnapshot, getBatterySnapshot);
}

/**
 * Whether the battery is low enough to switch the mode on by itself: under
 * 20% and not gaining charge — while plugged in there is nothing to save.
 */
export function isBatteryLow(state: BatteryState): boolean {
  return state.level !== null && state.level < LOW_THRESHOLD && state.charging !== true;
}

/** Shape returned by the `battery_status` Tauri command. */
interface NativeBatteryStatus {
  level: number | null;
  charging: boolean | null;
  supported: boolean;
}

/**
 * Starts tracking — called once from bootstrap (`main.tsx`); resolves when
 * the first reading is in, so the first frame already wears the right mode.
 * Idempotent: repeated calls return the same in-flight promise.
 */
export function startBatteryTracking(): Promise<void> {
  if (started) return started;
  started = track().catch(() => startNativePolling());
  return started;
}

async function track(): Promise<void> {
  const nav = navigator as Navigator & {
    getBattery?: () => Promise<BatteryManagerLike>;
  };
  if (typeof nav.getBattery !== 'function') {
    // WebKit (macOS / Linux) — no web API, ask Rust instead.
    return startNativePolling();
  }
  const battery = await nav.getBattery();
  const sync = () => publish({ level: battery.level, charging: battery.charging, supported: true });
  sync();
  battery.addEventListener('levelchange', sync);
  battery.addEventListener('chargingchange', sync);
}

/** Minimal shape of the non-standard Battery Status API object. */
interface BatteryManagerLike {
  level: number;
  charging: boolean;
  addEventListener(type: 'levelchange' | 'chargingchange', listener: () => void): void;
}

function startNativePolling(): Promise<void> {
  const first = pollNativeBattery();
  window.setInterval(() => void pollNativeBattery(), POLL_MS);
  return first;
}

async function pollNativeBattery(): Promise<void> {
  try {
    const status = await invoke<NativeBatteryStatus>('battery_status');
    publish({
      level: status.level,
      charging: status.charging,
      supported: status.supported,
    });
  } catch {
    // Command unavailable (e.g. plain-web build) → stay manual-only.
    publish(UNKNOWN);
  }
}
