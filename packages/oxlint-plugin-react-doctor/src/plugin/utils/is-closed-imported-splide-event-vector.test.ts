import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { parseSourceFile } from "./parse-source-file.js";
import { isClosedImportedSplideEventVector } from "./is-closed-imported-splide-event-vector.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resetManifestCaches } from "./read-nearest-package-manifest.js";

it("rechecks a changed provider while retaining the same importer AST and scope identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-splide-vector-cache-"));
  try {
    const filename = path.join(directory, "GalleryView.tsx");
    const provider = path.join(directory, "event-list.ts");
    fs.writeFileSync(provider, 'export const subscriptions = [["ready", "onReady"]];');
    fs.writeFileSync(filename, 'import { subscriptions } from "./event-list";');
    const program = parseSourceFile(filename);
    if (!isNodeOfType(program, "Program")) throw new Error("Parseable import fixture required");
    const statement = program.body[0];
    if (!isNodeOfType(statement, "ImportDeclaration")) throw new Error("Import fixture required");
    const binding = statement.specifiers[0]?.local;
    if (!binding) throw new Error("Import binding required");
    const scopes = analyzeScopes(program);
    const symbol = scopes.symbolFor(binding);
    if (!symbol) throw new Error("Import symbol required");
    expect(isClosedImportedSplideEventVector(symbol, filename)).toBe(true);
    expect(isClosedImportedSplideEventVector(symbol, filename)).toBe(true);
    fs.writeFileSync(
      provider,
      'export const subscriptions = { forEach(callback) { queueMicrotask(() => callback(["ready", "onReady"])); } };',
    );
    resetManifestCaches();
    expect(isClosedImportedSplideEventVector(symbol, filename)).toBe(false);
  } finally {
    resetManifestCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
