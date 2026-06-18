import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import type { Diagnostic } from "@react-doctor/core";
import { printDiagnostics } from "../src/cli/utils/render-diagnostics.js";

const ESCAPE = String.fromCharCode(27);

const diagnostic: Diagnostic = {
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "no-array-index-key",
  severity: "error",
  message: "Using the array index as a key breaks reconciliation when the list reorders.",
  help: "",
  line: 12,
  column: 5,
  category: "Bugs",
} as Diagnostic;

const captureOutput = async (run: () => Promise<void>): Promise<string> => {
  const chunks: string[] = [];
  const consoleObject = globalThis.console as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const sink =
    () =>
    (...args: unknown[]) => {
      chunks.push(args.join(" ") + "\n");
    };
  for (const key of ["log", "info", "warn", "error"]) {
    originals.set(key, consoleObject[key]);
    consoleObject[key] = sink();
  }
  try {
    await run();
  } finally {
    for (const [key, original] of originals) consoleObject[key] = original;
  }
  return chunks.join("");
};

describe("printDiagnostics hyperlinks", () => {
  it("wraps the location in an OSC 8 link to the absolute file:// URI when enabled", async () => {
    const output = await captureOutput(() =>
      Effect.runPromise(printDiagnostics([diagnostic], false, "/repo", undefined, false, {}, true)),
    );
    // Derive the expected URI the way the renderer does, so the absolute-path
    // form matches on every platform (Windows resolves to `file:///C:/repo/…`).
    const expectedUri = pathToFileURL(path.resolve("/repo", diagnostic.filePath)).href;
    expect(output).toContain(`${ESCAPE}]8;;${expectedUri}`);
    // The visible location text is still present and unchanged.
    expect(output).toContain("src/App.tsx:12");
  });

  it("emits a plain relative location with no escape sequences by default", async () => {
    const output = await captureOutput(() =>
      Effect.runPromise(printDiagnostics([diagnostic], false, "/repo")),
    );
    expect(output).toContain("src/App.tsx:12");
    expect(output).not.toContain("file://");
    expect(output).not.toContain(`${ESCAPE}]8;;`);
  });
});
