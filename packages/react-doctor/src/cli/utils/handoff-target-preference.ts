import { type CliStateOptions, HANDOFF_TARGET_PREFERENCE_ID } from "./cli-state-store.js";
import { type Preference, readPreference, writePreference } from "./cli-lifecycle.js";

// The post-scan "What would you like to do next?" pick (an agent id, "copy to
// clipboard", or "skip"). Remembered globally — the preferred handoff is a
// personal habit, not a per-repo setting — so every scan defaults to whatever
// the user chose last, anywhere. A new value just overwrites the old one.
export const HANDOFF_TARGET_PREFERENCE: Preference = {
  id: HANDOFF_TARGET_PREFERENCE_ID,
  scope: "global",
};

// The handoff target the user picked last, or null if they never have (or the
// store is unreadable) — callers fall back to highlighting the first option.
export const readHandoffTarget = (options: CliStateOptions = {}): string | null =>
  readPreference(HANDOFF_TARGET_PREFERENCE, {}, options);

// Remembers the user's latest pick so the next scan defaults to it. Returns
// whether it persisted.
export const rememberHandoffTarget = (target: string, options: CliStateOptions = {}): boolean =>
  writePreference(HANDOFF_TARGET_PREFERENCE, target, {}, options);
