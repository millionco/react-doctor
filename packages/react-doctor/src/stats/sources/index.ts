import type { SessionCandidate, StatsProvider } from "../types.js";
import { claudeSource } from "./claude.js";
import { codexSource } from "./codex.js";
import { cursorSource } from "./cursor.js";

export type {
  AgentSession,
  FileEdit,
  FileRead,
  SessionCandidate,
  StatsProvider,
} from "../types.js";

/**
 * A per-provider session source. Each source enumerates its sessions as cheap,
 * lazily-loadable `SessionCandidate`s — transcript files for Claude/Codex, rows
 * from the Cursor composer database for Cursor — so the rest of the pipeline is
 * provider-agnostic.
 */
export interface SourceDef {
  readonly name: StatsProvider;
  /** Enumerate every candidate session for this provider (cheap; no parsing). */
  candidates(): SessionCandidate[];
}

export const STATS_SOURCES: ReadonlyArray<SourceDef> = [claudeSource, codexSource, cursorSource];
