import * as os from "node:os";
import * as path from "node:path";
import { fileSessionCandidates, findJsonlFiles, readJsonlEntries } from "../walk-transcripts.js";
import { STATS_UNKNOWN_MODEL } from "../constants.js";
import type { AgentSession, FileEdit, SourceDef } from "./index.js";

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

// Codex reconstructs only `apply_patch` (`custom_tool_call`) edits — `shell`
// function calls (sed, heredoc redirects, …) are not faithfully reconstructable
// and are skipped. Model comes from `turn_context`, cwd from `session_meta`.
export const parseCodexSession = (transcriptPath: string): AgentSession | null => {
  const edits: FileEdit[] = [];
  const modelCounts = new Map<string, number>();
  let cwd: string | null = null;
  let sawAnything = false;

  readJsonlEntries(transcriptPath, (entry) => {
    sawAnything = true;
    const payload = asRecord(entry.payload);
    if (!payload) return;

    if (entry.type === "session_meta" && !cwd) {
      cwd = asString(payload.cwd) ?? null;
    }
    if (entry.type === "turn_context") {
      if (!cwd) cwd = asString(payload.cwd) ?? null;
      const model = asString(payload.model);
      if (model) modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }

    if (
      payload.type === "custom_tool_call" &&
      payload.name === "apply_patch" &&
      typeof payload.input === "string"
    ) {
      edits.push({ kind: "patch", path: "", patch: payload.input });
    }
  });

  if (!sawAnything) return null;

  let model = STATS_UNKNOWN_MODEL;
  let bestCount = 0;
  for (const [candidate, count] of modelCounts) {
    if (count > bestCount) {
      model = candidate;
      bestCount = count;
    }
  }

  return {
    provider: "codex",
    sessionId: path.basename(transcriptPath, ".jsonl"),
    transcriptPath,
    model,
    cwd,
    edits,
    reads: [],
  };
};

const codexRoots = (): string[] => {
  const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  return [path.join(home, "sessions"), path.join(home, "archived_sessions")];
};

export const codexSource: SourceDef = {
  name: "codex",
  candidates() {
    // sessions/YYYY/MM/DD/rollout-*.jsonl → 4 levels.
    return fileSessionCandidates(
      "codex",
      codexRoots(),
      (root) => findJsonlFiles(root, 5),
      parseCodexSession,
    );
  },
};
