import * as os from "node:os";
import * as path from "node:path";
import { asRecord, asString } from "../coerce.js";
import { mostCommonKey } from "../most-common-key.js";
import { fileSessionCandidates, findJsonlFiles, readJsonlEntries } from "../walk-transcripts.js";
import { STATS_UNKNOWN_MODEL } from "../constants.js";
import type { AgentSession, FileEdit, SourceDef } from "./index.js";

// Codex reconstructs only `apply_patch` (`custom_tool_call`) edits — `shell`
// function calls (sed, heredoc redirects, …) are not faithfully reconstructable
// and are skipped. Model comes from `turn_context`, cwd from `session_meta`.
export const parseCodexSession = async (transcriptPath: string): Promise<AgentSession | null> => {
  const edits: FileEdit[] = [];
  const modelCounts = new Map<string, number>();
  let cwd: string | null = null;
  let sawAnything = false;

  await readJsonlEntries(transcriptPath, (entry) => {
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

  return {
    provider: "codex",
    sessionId: path.basename(transcriptPath, ".jsonl"),
    transcriptPath,
    model: mostCommonKey(modelCounts) ?? STATS_UNKNOWN_MODEL,
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
