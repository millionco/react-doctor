import * as os from "node:os";
import * as path from "node:path";
import { asArray, asRecord, asString } from "../coerce.js";
import { mostCommonKey } from "../most-common-key.js";
import { fileSessionCandidates, findJsonlFiles, readJsonlEntries } from "../walk-transcripts.js";
import { STATS_UNKNOWN_MODEL } from "../constants.js";
import type { AgentSession, FileEdit, FileRead, SourceDef } from "./index.js";

const EDIT_TOOL_NAMES = new Set(["Write", "Edit", "MultiEdit"]);

const editsFromToolUse = (name: string, input: Record<string, unknown>): FileEdit[] => {
  const filePath = asString(input.file_path);
  if (!filePath) return [];
  if (name === "Write") {
    return [{ kind: "write", path: filePath, content: asString(input.content) ?? "" }];
  }
  if (name === "Edit") {
    return [
      {
        kind: "replace",
        path: filePath,
        oldString: asString(input.old_string) ?? "",
        newString: asString(input.new_string) ?? "",
        replaceAll: input.replace_all === true,
      },
    ];
  }
  // MultiEdit: a sequence of replacements applied in order.
  return asArray(input.edits).flatMap((rawEdit) => {
    const edit = asRecord(rawEdit);
    if (!edit) return [];
    return [
      {
        kind: "replace" as const,
        path: filePath,
        oldString: asString(edit.old_string) ?? "",
        newString: asString(edit.new_string) ?? "",
        replaceAll: edit.replace_all === true,
      },
    ];
  });
};

export const parseClaudeSession = async (transcriptPath: string): Promise<AgentSession | null> => {
  const edits: FileEdit[] = [];
  const reads: FileRead[] = [];
  const modelCounts = new Map<string, number>();
  let cwd: string | null = null;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let sawAnything = false;

  await readJsonlEntries(transcriptPath, (entry) => {
    sawAnything = true;
    const timestamp = asString(entry.timestamp);
    if (timestamp) {
      if (!startedAt || timestamp < startedAt) startedAt = timestamp;
      if (!endedAt || timestamp > endedAt) endedAt = timestamp;
    }
    if (!cwd) cwd = asString(entry.cwd) ?? null;

    // Post-edit / read snapshots ride a top-level `toolUseResult` on the
    // following user/tool line — the most faithful reconstruction source.
    const toolResult = asRecord(entry.toolUseResult);
    if (toolResult) {
      const resultFilePath = asString(toolResult.filePath);
      if (resultFilePath && typeof toolResult.content === "string") {
        edits.push({ kind: "write", path: resultFilePath, resultContent: toolResult.content });
      }
      const readFile = asRecord(toolResult.file);
      const readPath = readFile && asString(readFile.filePath);
      if (readFile && readPath && typeof readFile.content === "string") {
        reads.push({ path: readPath, content: readFile.content });
      }
    }

    if (entry.type !== "assistant") return;
    const message = asRecord(entry.message);
    if (!message) return;
    const model = asString(message.model);
    if (model && model !== "<synthetic>") {
      modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
    }
    for (const rawBlock of asArray(message.content)) {
      const block = asRecord(rawBlock);
      if (!block || block.type !== "tool_use") continue;
      const name = asString(block.name);
      const input = asRecord(block.input);
      if (!name || !input || !EDIT_TOOL_NAMES.has(name)) continue;
      edits.push(...editsFromToolUse(name, input));
    }
  });

  if (!sawAnything) return null;

  return {
    provider: "claude",
    sessionId: path.basename(transcriptPath, ".jsonl"),
    transcriptPath,
    model: mostCommonKey(modelCounts) ?? STATS_UNKNOWN_MODEL,
    cwd,
    startedAt,
    endedAt,
    edits,
    reads,
  };
};

const claudeRoots = (): string[] => {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  const configDirs = fromEnv
    ? fromEnv
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [
        path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "claude"),
        path.join(os.homedir(), ".claude"),
      ];
  return configDirs.map((dir) => path.join(dir, "projects"));
};

export const claudeSource: SourceDef = {
  name: "claude",
  candidates() {
    return fileSessionCandidates(
      "claude",
      claudeRoots(),
      (root) => findJsonlFiles(root, 3),
      parseClaudeSession,
    );
  },
};
