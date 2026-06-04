import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { LspTestClient, pathToUri, waitForNotification } from "../lsp-client.js";

const PACKAGE_ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const FIXTURE_DIR = path.join(PACKAGE_ROOT, "tests", "fixtures", "simple-app");
const APP_FILE = path.join(FIXTURE_DIR, "src", "App.tsx");

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: Array<{
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    code?: string;
    source?: string;
    message: string;
    data?: unknown;
  }>;
}

const isAppDiagnostics = (params: unknown): params is PublishDiagnosticsParams => {
  if (params === null || typeof params !== "object") return false;
  const candidate = params as PublishDiagnosticsParams;
  return (
    typeof candidate.uri === "string" &&
    candidate.uri.endsWith("App.tsx") &&
    Array.isArray(candidate.diagnostics) &&
    candidate.diagnostics.length > 0
  );
};

describe("react-doctor language server (stdio)", () => {
  let client: LspTestClient;
  let appDiagnostics: PublishDiagnosticsParams;
  let serverInfo: { name?: string; version?: string } | undefined;
  const statusEvents: Array<{ health: string; quiescent: boolean }> = [];

  beforeAll(async () => {
    client = new LspTestClient();
    const initialize = (await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToUri(FIXTURE_DIR),
      capabilities: {
        textDocument: { publishDiagnostics: {}, hover: {}, codeAction: {} },
        workspace: {},
        experimental: { serverStatusNotification: true },
      },
      workspaceFolders: [{ uri: pathToUri(FIXTURE_DIR), name: "simple-app" }],
    })) as { capabilities?: unknown; serverInfo?: { name?: string; version?: string } };
    serverInfo = initialize.serverInfo;
    expect(initialize).toMatchObject({ capabilities: { hoverProvider: true } });

    client.onNotification((method, params) => {
      if (method === "experimental/serverStatus") {
        statusEvents.push(params as { health: string; quiescent: boolean });
      }
    });
    client.notify("initialized", {});

    const publishPromise = waitForNotification(
      client,
      "textDocument/publishDiagnostics",
      isAppDiagnostics,
    );

    client.notify("textDocument/didOpen", {
      textDocument: {
        uri: pathToUri(APP_FILE),
        languageId: "typescriptreact",
        version: 1,
        text: fs.readFileSync(APP_FILE, "utf8"),
      },
    });

    appDiagnostics = (await publishPromise) as PublishDiagnosticsParams;
  });

  afterAll(async () => {
    await client.stop();
  });

  it("publishes a precise array-index-key diagnostic for the opened file", () => {
    const indexKey = appDiagnostics.diagnostics.find((diagnostic) =>
      (diagnostic.code ?? "").includes("no-array-index"),
    );
    expect(indexKey).toBeDefined();
    expect(indexKey?.source).toBe("react-doctor");
    // `key={index}` lives on source line 9 (0-indexed line 8).
    expect(indexKey?.range.start.line).toBe(8);
    // Precise byte-span range, not a whole-line fallback.
    expect(indexKey?.range.end.character).toBeGreaterThan(indexKey?.range.start.character ?? 0);
  });

  it("offers a suppression quick fix and a file-level source action", async () => {
    const target = appDiagnostics.diagnostics.find((diagnostic) =>
      (diagnostic.code ?? "").includes("no-array-index"),
    );
    expect(target).toBeDefined();

    const actions = (await client.request("textDocument/codeAction", {
      textDocument: { uri: pathToUri(APP_FILE) },
      range: target?.range,
      context: { diagnostics: [target] },
    })) as Array<{ title: string; kind?: string; edit?: unknown; command?: unknown }>;

    const titles = actions.map((action) => action.title);
    expect(titles.some((title) => /Disable .*for this line/.test(title))).toBe(true);
    expect(titles.some((title) => title.includes("Suppress all React Doctor issues"))).toBe(true);
    expect(titles.some((title) => /Explain/.test(title))).toBe(true);
  });

  it("reports serverInfo with a name and version", () => {
    expect(serverInfo?.name).toBe("React Doctor");
    expect(typeof serverInfo?.version).toBe("string");
    expect((serverInfo?.version ?? "").length).toBeGreaterThan(0);
  });

  it("emits experimental/serverStatus (scanning then ready)", () => {
    // The open-file scan flips quiescent false while running; the initial
    // and post-scan statuses are quiescent true.
    expect(statusEvents.some((status) => status.quiescent === false)).toBe(true);
    expect(statusEvents.some((status) => status.quiescent === true)).toBe(true);
    expect(statusEvents.every((status) => ["ok", "warning", "error"].includes(status.health))).toBe(
      true,
    );
  });

  it("honors context.only when returning code actions", async () => {
    const target = appDiagnostics.diagnostics.find((diagnostic) =>
      (diagnostic.code ?? "").includes("no-array-index"),
    );
    // `triggerKind` 2 === CodeActionTriggerKind.Automatic (what editors send
    // for code-actions-on-save); omitted/1 is a manual (Invoked) request.
    const requestActions = (only: string[], triggerKind?: number) =>
      client.request("textDocument/codeAction", {
        textDocument: { uri: pathToUri(APP_FILE) },
        range: target?.range,
        context: { diagnostics: [target], only, ...(triggerKind ? { triggerKind } : {}) },
      }) as Promise<Array<{ title: string; kind?: string }>>;

    const quickFixOnly = await requestActions(["quickfix"]);
    expect(quickFixOnly.length).toBeGreaterThan(0);
    expect(quickFixOnly.every((action) => !(action.kind ?? "").startsWith("source"))).toBe(true);

    // Manual Source Action menu request (Invoked): suppress-all is offered.
    const sourceOnly = await requestActions(["source"]);
    expect(sourceOnly.some((action) => action.kind === "source.suppressAll.reactDoctor")).toBe(
      true,
    );
    expect(sourceOnly.every((action) => (action.kind ?? "").startsWith("source"))).toBe(true);

    // On-save (Automatic) request for `source`: the destructive suppress-all
    // must be withheld so editors can't auto-insert disable comments on save.
    const sourceOnSave = await requestActions(["source"], 2);
    expect(sourceOnSave.some((action) => action.kind === "source.suppressAll.reactDoctor")).toBe(
      false,
    );

    // An explicit opt-in to the exact kind still gets it, even on save.
    const explicitOnSave = await requestActions(["source.suppressAll.reactDoctor"], 2);
    expect(explicitOnSave.some((action) => action.kind === "source.suppressAll.reactDoctor")).toBe(
      true,
    );
  });

  it("returns a markdown hover describing the rule", async () => {
    const target = appDiagnostics.diagnostics.find((diagnostic) =>
      (diagnostic.code ?? "").includes("no-array-index"),
    );
    const hover = (await client.request("textDocument/hover", {
      textDocument: { uri: pathToUri(APP_FILE) },
      position: target?.range.start,
    })) as { contents?: { kind?: string; value?: string } } | null;

    expect(hover?.contents?.kind).toBe("markdown");
    expect(hover?.contents?.value ?? "").toContain("react-doctor/");
  });
});

describe("react-doctor language server (background workspace scan)", () => {
  let scanClient: LspTestClient;

  afterAll(async () => {
    await scanClient.stop();
  });

  // Regression: a client that does NOT advertise workspace-folder support
  // must still receive workspace diagnostics. The folder-change capability
  // used to make `onInitialized` throw, silently killing the background
  // scan for minimal LSP clients (and any client that never opens a file).
  it("publishes diagnostics from the chunked scan without didOpen", async () => {
    scanClient = new LspTestClient();
    await scanClient.request("initialize", {
      processId: process.pid,
      rootUri: pathToUri(FIXTURE_DIR),
      // Intentionally omit `workspace.workspaceFolders` and any
      // workspaceFolders param — the previously-broken scenario.
      capabilities: { textDocument: { publishDiagnostics: {} } },
    });
    const publishPromise = waitForNotification(
      scanClient,
      "textDocument/publishDiagnostics",
      isAppDiagnostics,
    );
    scanClient.notify("initialized", {});

    const params = (await publishPromise) as PublishDiagnosticsParams;
    expect(params.diagnostics.length).toBeGreaterThan(0);
  });
});
