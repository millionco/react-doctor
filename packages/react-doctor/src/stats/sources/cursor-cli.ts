import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { asArray, asNullableString, asRecord, asString } from "../coerce.js";
import { STATS_UNKNOWN_MODEL } from "../constants.js";
import { readCursorCliStore } from "../cursor-cli-store.js";
import { isLintablePath } from "../reconstruct-files.js";
import { statMtimeMs } from "../walk-transcripts.js";
import type { AgentSession, FileEdit, FileRead, SessionCandidate, SourceDef } from "./index.js";

// The Cursor CLI agent keeps one content-addressed SQLite store per chat at
// `<home>/chats/<workspaceHash>/<sessionId>/store.db`, beside a `meta.json` that
// records the chat's last-updated time. Two install channels exist — stable
// (`~/.cursor`) and nightly (`~/.cursor-nightly`).
const cursorCliHomes = (): string[] => {
  const override = process.env.REACT_DOCTOR_CURSOR_CLI_HOME;
  if (override) return override.split(path.delimiter).filter(Boolean);
  return [path.join(os.homedir(), ".cursor"), path.join(os.homedir(), ".cursor-nightly")];
};

// File-mutating tool calls. `Write` carries the full post-edit content;
// `ApplyPatch` carries a raw apply_patch envelope (the same format as Codex);
// `StrReplace` carries an old/new string pair; `Delete` removes a path. Planning
// tools (`CreatePlan`, `TodoWrite`) write no source file and are ignored.
const READ_TOOL_NAMES = new Set(["Read", "ReadFile"]);

const editFromToolCall = (toolName: string, args: unknown): FileEdit | null => {
  if (toolName === "ApplyPatch") {
    return typeof args === "string" && args.length > 0
      ? { kind: "patch", path: "", patch: args }
      : null;
  }
  const record = asRecord(args);
  const filePath = record && asString(record.path);
  if (!record || !filePath) return null;
  if (toolName === "Write") {
    const contents = asNullableString(record.contents);
    return contents === null ? null : { kind: "write", path: filePath, resultContent: contents };
  }
  if (toolName === "Delete") {
    return { kind: "delete", path: filePath };
  }
  if (toolName === "StrReplace") {
    const oldString = asNullableString(record.old_string);
    const newString = asNullableString(record.new_string);
    if (oldString === null || newString === null) return null;
    return { kind: "replace", path: filePath, oldString, newString };
  }
  return null;
};

const buildCliSession = (storeDbPath: string, sessionId: string): AgentSession | null => {
  const store = readCursorCliStore(storeDbPath);
  if (!store) return null;

  const edits: FileEdit[] = [];
  const reads: FileRead[] = [];
  const capturedReadPaths = new Set<string>();
  // tool-call → tool-result are separate messages, so a Read's path is recorded
  // when its call is seen, then paired with the content in its later result.
  const pendingReadPaths = new Map<string, string>();

  for (const message of store.messages) {
    for (const rawBlock of asArray(message.content)) {
      const block = asRecord(rawBlock);
      if (!block) continue;
      if (block.type === "tool-call") {
        const toolName = asString(block.toolName);
        if (!toolName) continue;
        const edit = editFromToolCall(toolName, block.args);
        if (edit) {
          edits.push(edit);
          continue;
        }
        const toolCallId = asString(block.toolCallId);
        const readRecord = asRecord(block.args);
        const readPath = readRecord && asString(readRecord.path);
        if (READ_TOOL_NAMES.has(toolName) && toolCallId && readPath && isLintablePath(readPath)) {
          pendingReadPaths.set(toolCallId, readPath);
        }
      } else if (block.type === "tool-result") {
        const toolCallId = asString(block.toolCallId);
        const readPath = toolCallId ? pendingReadPaths.get(toolCallId) : undefined;
        // Keep the first read of a path (the pre-edit base); a later post-edit
        // read would otherwise overwrite it and desync replace/patch replay.
        if (readPath && !capturedReadPaths.has(readPath) && typeof block.result === "string") {
          reads.push({ path: readPath, content: block.result });
          capturedReadPaths.add(readPath);
        }
      }
    }
  }

  if (edits.length === 0) return null;

  return {
    provider: "cursor",
    sessionId,
    transcriptPath: storeDbPath,
    model: store.lastUsedModel ?? STATS_UNKNOWN_MODEL,
    cwd: null,
    edits,
    reads,
  };
};

/** mtime key for `--since`/sorting: the chat's `meta.json` time, else the store's. */
const sessionModifiedMs = (sessionDir: string, storeDbPath: string): number => {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(sessionDir, "meta.json"), "utf8"));
    if (meta && typeof meta.updatedAtMs === "number") return meta.updatedAtMs;
  } catch {
    // No or unreadable meta.json — fall back to the store's mtime.
  }
  return statMtimeMs(storeDbPath);
};

const discoverCliSessions = (home: string): SessionCandidate[] => {
  const chatsRoot = path.join(home, "chats");
  let workspaceEntries: fs.Dirent[];
  try {
    workspaceEntries = fs.readdirSync(chatsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: SessionCandidate[] = [];
  for (const workspace of workspaceEntries) {
    if (!workspace.isDirectory()) continue;
    const workspaceDir = path.join(chatsRoot, workspace.name);
    let sessionEntries: fs.Dirent[];
    try {
      sessionEntries = fs.readdirSync(workspaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const session of sessionEntries) {
      if (!session.isDirectory()) continue;
      const sessionDir = path.join(workspaceDir, session.name);
      const storeDbPath = path.join(sessionDir, "store.db");
      if (!fs.existsSync(storeDbPath)) continue;
      candidates.push({
        provider: "cursor",
        modifiedMs: sessionModifiedMs(sessionDir, storeDbPath),
        load: async () => buildCliSession(storeDbPath, session.name),
      });
    }
  }
  return candidates;
};

export const cursorCliCandidates = (homes: ReadonlyArray<string>): SessionCandidate[] =>
  homes.flatMap((home) => discoverCliSessions(home));

export const cursorCliSource: SourceDef = {
  name: "cursor",
  candidates() {
    return cursorCliCandidates(cursorCliHomes());
  },
};
