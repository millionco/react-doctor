import { asRecord, asString, parseJson } from "../coerce.js";
import { STATS_UNKNOWN_MODEL } from "../constants.js";
import { openCursorDb, resolveCursorDbPaths, type CursorDbHandle } from "../cursor-db.js";
import { mostCommonKey } from "../most-common-key.js";
import { isLintablePath } from "../reconstruct-files.js";
import type { AgentSession, FileEdit, SessionCandidate, SourceDef } from "./index.js";

// The composer's selected model, ignoring the "Auto" sentinel which carries no
// concrete model id.
const composerModelName = (composer: Record<string, unknown> | undefined): string | undefined => {
  const modelConfig = composer && asRecord(composer.modelConfig);
  const modelName = modelConfig && asString(modelConfig.modelName);
  return modelName && modelName !== "default" ? modelName : undefined;
};

// One Cursor tool call. `edit_file_v2` records the full post-edit file behind a
// content id (`result.afterContentId`), giving exact reconstruction; the inline
// `streamingContent` is the fallback when that blob is gone. `delete_file`
// removes a path. Other tools (read, search, terminal) are ignored.
const editFromToolCall = (
  toolData: Record<string, unknown>,
  db: CursorDbHandle,
): FileEdit | null => {
  if (toolData.status !== "completed") return null;
  const name = asString(toolData.name);
  if (!name) return null;
  const params = asRecord(parseJson(asString(toolData.params)));
  const filePath = params && asString(params.relativeWorkspacePath);
  if (!filePath || !isLintablePath(filePath)) return null;

  if (name === "delete_file") {
    return { kind: "delete", path: filePath };
  }
  if (name !== "edit_file_v2") return null;

  const result = asRecord(parseJson(asString(toolData.result)));
  const afterContentId = result && asString(result.afterContentId);
  const content = afterContentId ? db.contentValue(afterContentId) : null;
  const resultContent = content ?? asString(params?.streamingContent);
  if (resultContent === undefined) return null;
  return { kind: "write", path: filePath, resultContent };
};

// A composer can switch models mid-chat; when the conversation-level selection
// is "Auto", fall back to the model most bubbles were generated with.
const bubbleModelName = (bubble: Record<string, unknown>): string | undefined => {
  const modelInfo = asRecord(bubble.modelInfo);
  const modelName = modelInfo && asString(modelInfo.modelName);
  return modelName && modelName !== "default" ? modelName : undefined;
};

interface OrderedEdit {
  readonly createdAt: number;
  readonly edit: FileEdit;
}

const buildCursorSession = (db: CursorDbHandle, composerId: string): AgentSession | null => {
  const composer = asRecord(parseJson(db.composerValue(composerId)));
  const orderedEdits: OrderedEdit[] = [];
  const bubbleModelCounts = new Map<string, number>();

  for (const rawBubble of db.bubbleValues(composerId)) {
    const bubble = asRecord(parseJson(rawBubble));
    if (!bubble) continue;
    const model = bubbleModelName(bubble);
    if (model) bubbleModelCounts.set(model, (bubbleModelCounts.get(model) ?? 0) + 1);
    const toolData = asRecord(bubble.toolFormerData);
    if (!toolData) continue;
    const edit = editFromToolCall(toolData, db);
    if (edit) {
      const createdAt = typeof bubble.createdAt === "number" ? bubble.createdAt : 0;
      orderedEdits.push({ createdAt, edit });
    }
  }

  // Apply edits in chronological order so the last write to a file wins.
  orderedEdits.sort((left, right) => left.createdAt - right.createdAt);

  return {
    provider: "cursor",
    sessionId: composerId,
    transcriptPath: `cursor-composer:${composerId}`,
    model: composerModelName(composer) ?? mostCommonKey(bubbleModelCounts) ?? STATS_UNKNOWN_MODEL,
    cwd: null,
    edits: orderedEdits.map((entry) => entry.edit),
    reads: [],
  };
};

/**
 * Enumerate every composer in the database as a lazy candidate. The header
 * index is cheap to read; the per-composer bubble/content walk only runs when a
 * candidate survives scope/`--since`/`--limit` filtering and `load()` is called.
 */
export const cursorComposerCandidates = (dbPath: string | null): SessionCandidate[] => {
  const db = openCursorDb(dbPath);
  if (!db) return [];
  return db.composerHeaders().map((header) => ({
    provider: "cursor" as const,
    modifiedMs: header.modifiedMs,
    load: async () => buildCursorSession(db, header.composerId),
  }));
};

export const cursorSource: SourceDef = {
  name: "cursor",
  candidates() {
    return resolveCursorDbPaths().flatMap((dbPath) => cursorComposerCandidates(dbPath));
  },
};
