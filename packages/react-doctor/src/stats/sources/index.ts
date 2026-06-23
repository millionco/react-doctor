import type { SessionCandidate, StatsProvider } from "../types.js";
import { claudeSource } from "./claude.js";
import { codexSource } from "./codex.js";
import { cursorSource } from "./cursor.js";
import { cursorCliSource } from "./cursor-cli.js";

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
 * from the GUI composer database and the CLI per-session stores for Cursor — so
 * the rest of the pipeline is provider-agnostic. A provider may have more than
 * one source (Cursor's GUI app and CLI agent store chats differently).
 */
export interface SourceDef {
  readonly name: StatsProvider;
  /** Enumerate every candidate session for this provider (cheap; no parsing). */
  candidates(): SessionCandidate[];
}

export const STATS_SOURCES: ReadonlyArray<SourceDef> = [
  claudeSource,
  codexSource,
  cursorSource,
  cursorCliSource,
];
