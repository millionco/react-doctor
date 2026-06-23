import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { closeCursorDb } from "../src/stats/cursor-db.js";
import { parseClaudeSession } from "../src/stats/sources/claude.js";
import { parseCodexSession } from "../src/stats/sources/codex.js";
import { cursorComposerCandidates } from "../src/stats/sources/cursor.js";
import { cursorCliCandidates } from "../src/stats/sources/cursor-cli.js";

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): void };
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (filePath: string) => SqliteDb;
}

// `node:sqlite` is built in on Node 22.13+/24+ and absent on older Node, where
// the require throws. Mirror cursor-db.ts and skip the Cursor suite there rather
// than crashing the whole file at import time.
const loadSqlite = (): SqliteModule | null => {
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } catch {
    return null;
  }
};
const sqlite = loadSqlite();

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stats-adapters-"));

const writeTranscript = (name: string, lines: unknown[]): string => {
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, lines.map((line) => JSON.stringify(line)).join("\n"));
  return filePath;
};

afterAll(() => {
  closeCursorDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("parseClaudeSession", () => {
  it("extracts model, cwd, edits, and post-edit result content", async () => {
    const filePath = writeTranscript("claude.jsonl", [
      {
        type: "assistant",
        cwd: "/repo",
        timestamp: "2026-06-20T00:00:00Z",
        message: {
          model: "claude-x",
          content: [
            {
              type: "tool_use",
              name: "Write",
              id: "t1",
              input: { file_path: "/repo/src/a.ts", content: "export const a=1;" },
            },
          ],
        },
      },
      {
        type: "user",
        toolUseResult: { filePath: "/repo/src/a.ts", content: "export const a = 1;\n" },
      },
    ]);
    const session = await parseClaudeSession(filePath);
    expect(session?.model).toBe("claude-x");
    expect(session?.cwd).toBe("/repo");
    expect(session?.edits.some((edit) => edit.resultContent === "export const a = 1;\n")).toBe(
      true,
    );
  });
});

describe("parseCodexSession", () => {
  it("extracts model from turn_context, cwd from session_meta, and apply_patch edits", async () => {
    const filePath = writeTranscript("codex.jsonl", [
      { type: "session_meta", payload: { cwd: "/repo" } },
      { type: "turn_context", payload: { model: "gpt-5.5" } },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "apply_patch",
          input: "*** Begin Patch\n*** Add File: /repo/d.ts\n+x\n*** End Patch",
        },
      },
    ]);
    const session = await parseCodexSession(filePath);
    expect(session?.model).toBe("gpt-5.5");
    expect(session?.cwd).toBe("/repo");
    expect(session?.edits).toHaveLength(1);
    expect(session?.edits[0].kind).toBe("patch");
  });
});

interface ComposerFixture {
  readonly composerId: string;
  readonly modelName: string | null;
  readonly bubbles: ReadonlyArray<Record<string, unknown>>;
  readonly content?: Record<string, string>;
}

const writeComposerDb = (name: string, composers: ReadonlyArray<ComposerFixture>): string => {
  if (!sqlite) throw new Error("node:sqlite unavailable");
  const dbPath = path.join(tempDir, name);
  const database = new sqlite.DatabaseSync(dbPath);
  database.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  database.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");

  const headers = composers.map((composer, index) => ({
    composerId: composer.composerId,
    lastUpdatedAt: 1_000 + index,
  }));
  const insertItem = database.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  insertItem.run("composer.composerHeaders", JSON.stringify({ allComposers: headers }));

  const insertKv = database.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
  for (const composer of composers) {
    insertKv.run(
      `composerData:${composer.composerId}`,
      JSON.stringify(composer.modelName ? { modelConfig: { modelName: composer.modelName } } : {}),
    );
    composer.bubbles.forEach((bubble, index) => {
      insertKv.run(`bubbleId:${composer.composerId}:b${index}`, JSON.stringify(bubble));
    });
    for (const [contentId, body] of Object.entries(composer.content ?? {})) {
      insertKv.run(contentId, body);
    }
  }
  database.close();
  return dbPath;
};

const describeCursor = sqlite ? describe : describe.skip;

describeCursor("cursorComposerCandidates", () => {
  beforeEach(() => closeCursorDb());

  it("attributes the composer model and reconstructs exact content via afterContentId", async () => {
    const dbPath = writeComposerDb("cursor-model.vscdb", [
      {
        composerId: "comp-1",
        modelName: "claude-opus-4-8",
        content: { "composer.content.hash1": "export const x = 1;\n" },
        bubbles: [
          {
            createdAt: 10,
            toolFormerData: {
              name: "edit_file_v2",
              status: "completed",
              params: JSON.stringify({
                relativeWorkspacePath: "/repo/b.ts",
                streamingContent: "export const x=1;",
              }),
              result: JSON.stringify({ afterContentId: "composer.content.hash1" }),
            },
          },
          {
            createdAt: 20,
            toolFormerData: {
              name: "delete_file",
              status: "completed",
              params: JSON.stringify({ relativeWorkspacePath: "/repo/old.ts" }),
            },
          },
        ],
      },
    ]);

    const candidates = cursorComposerCandidates(dbPath);
    expect(candidates).toHaveLength(1);
    const session = await candidates[0].load();
    expect(session?.provider).toBe("cursor");
    expect(session?.model).toBe("claude-opus-4-8");
    expect(session?.edits).toHaveLength(2);
    const write = session?.edits.find((edit) => edit.kind === "write");
    expect(write?.path).toBe("/repo/b.ts");
    expect(write?.resultContent).toBe("export const x = 1;\n");
    expect(
      session?.edits.some((edit) => edit.kind === "delete" && edit.path === "/repo/old.ts"),
    ).toBe(true);
  });

  it("falls back to the dominant bubble model when the composer is on Auto", async () => {
    const dbPath = writeComposerDb("cursor-auto.vscdb", [
      {
        composerId: "comp-2",
        modelName: null,
        content: { "composer.content.hash2": "export const y = 2;\n" },
        bubbles: [
          { modelInfo: { modelName: "gpt-5.5" } },
          {
            createdAt: 5,
            modelInfo: { modelName: "gpt-5.5" },
            toolFormerData: {
              name: "edit_file_v2",
              status: "completed",
              params: JSON.stringify({ relativeWorkspacePath: "/repo/c.ts" }),
              result: JSON.stringify({ afterContentId: "composer.content.hash2" }),
            },
          },
        ],
      },
    ]);

    const session = await cursorComposerCandidates(dbPath)[0]?.load();
    expect(session?.model).toBe("gpt-5.5");
    expect(session?.edits[0]?.resultContent).toBe("export const y = 2;\n");
  });

  it("ignores non-lintable edits and skips when the database is absent", async () => {
    expect(cursorComposerCandidates(null)).toEqual([]);

    const dbPath = writeComposerDb("cursor-nonlintable.vscdb", [
      {
        composerId: "comp-3",
        modelName: "claude-opus-4-8",
        content: { "composer.content.hash3": "# readme" },
        bubbles: [
          {
            createdAt: 1,
            toolFormerData: {
              name: "edit_file_v2",
              status: "completed",
              params: JSON.stringify({ relativeWorkspacePath: "/repo/README.md" }),
              result: JSON.stringify({ afterContentId: "composer.content.hash3" }),
            },
          },
        ],
      },
    ]);
    const session = await cursorComposerCandidates(dbPath)[0]?.load();
    expect(session?.edits).toEqual([]);
  });
});

interface CliStoreFixture {
  readonly model: string;
  readonly updatedAtMs: number;
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
}

const CLI_ROOT_BLOB_ID = "f".repeat(64);

// Build a Cursor CLI per-session store: hex-encoded `meta`, a protobuf-style
// manifest blob (`0x0a 0x20` + 32-byte id per message, in order), and one JSON
// message blob per entry — the shape `readCursorCliStore` parses.
const writeCliStore = (home: string, sessionId: string, fixture: CliStoreFixture): void => {
  if (!sqlite) throw new Error("node:sqlite unavailable");
  const sessionDir = path.join(home, "chats", "workspace-hash", sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionDir, "meta.json"),
    JSON.stringify({ schemaVersion: 1, updatedAtMs: fixture.updatedAtMs }),
  );

  const database = new sqlite.DatabaseSync(path.join(sessionDir, "store.db"));
  database.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)");
  database.exec("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB)");

  const messageIds = fixture.messages.map((_, index) => index.toString(16).padStart(64, "0"));
  const manifest = Buffer.concat(
    messageIds.map((id) => Buffer.concat([Buffer.from([0x0a, 0x20]), Buffer.from(id, "hex")])),
  );

  const insertMeta = database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)");
  insertMeta.run(
    "0",
    Buffer.from(
      JSON.stringify({ latestRootBlobId: CLI_ROOT_BLOB_ID, lastUsedModel: fixture.model }),
    ).toString("hex"),
  );

  const insertBlob = database.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)");
  insertBlob.run(CLI_ROOT_BLOB_ID, manifest);
  fixture.messages.forEach((message, index) => {
    insertBlob.run(messageIds[index], Buffer.from(JSON.stringify(message)));
  });
  database.close();
};

describeCursor("cursorCliCandidates", () => {
  it("reconstructs model, ordered edits, and read bases from a CLI store", async () => {
    const home = path.join(tempDir, "cursor-cli-home");
    writeCliStore(home, "session-1", {
      model: "claude-opus-4-8",
      updatedAtMs: 5_000,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "Write",
              toolCallId: "w1",
              args: { path: "/repo/a.tsx", contents: "export const A = () => null;\n" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "ApplyPatch",
              toolCallId: "p1",
              args: "*** Begin Patch\n*** Add File: /repo/b.ts\n+export const b = 2;\n*** End Patch",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "Read",
              toolCallId: "r1",
              args: { path: "/repo/c.tsx" },
            },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", toolCallId: "r1", result: "export const C = 1;\n" }],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "StrReplace",
              toolCallId: "s1",
              args: { path: "/repo/c.tsx", old_string: "1", new_string: "2" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolName: "Delete",
              toolCallId: "d1",
              args: { path: "/repo/old.ts" },
            },
          ],
        },
        {
          role: "assistant",
          content: [
            { type: "tool-call", toolName: "TodoWrite", toolCallId: "t1", args: { todos: [] } },
          ],
        },
      ],
    });

    const candidates = cursorCliCandidates([home]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].modifiedMs).toBe(5_000);

    const session = await candidates[0].load();
    expect(session?.provider).toBe("cursor");
    expect(session?.model).toBe("claude-opus-4-8");

    const write = session?.edits.find((edit) => edit.kind === "write");
    expect(write?.path).toBe("/repo/a.tsx");
    expect(write?.resultContent).toBe("export const A = () => null;\n");

    const patch = session?.edits.find((edit) => edit.kind === "patch");
    expect(patch?.patch).toContain("Add File: /repo/b.ts");

    const replace = session?.edits.find((edit) => edit.kind === "replace");
    expect(replace?.path).toBe("/repo/c.tsx");
    expect(replace?.oldString).toBe("1");
    expect(replace?.newString).toBe("2");

    expect(
      session?.edits.some((edit) => edit.kind === "delete" && edit.path === "/repo/old.ts"),
    ).toBe(true);
    // Write + ApplyPatch + StrReplace + Delete; the Read and the TodoWrite plan are not edits.
    expect(session?.edits).toHaveLength(4);
    // The Read result is captured as a base so the StrReplace reconstructs.
    expect(session?.reads).toEqual([{ path: "/repo/c.tsx", content: "export const C = 1;\n" }]);
  });

  it("returns no candidates when the CLI home has no chats", () => {
    expect(cursorCliCandidates([path.join(tempDir, "missing-cli-home")])).toEqual([]);
  });
});
