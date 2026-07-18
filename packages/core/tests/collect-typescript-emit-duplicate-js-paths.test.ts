import { describe, expect, it } from "vite-plus/test";
import { collectTypeScriptEmitDuplicateJsPaths } from "../src/utils/collect-typescript-emit-duplicate-js-paths.js";

interface EmitWorkspace {
  files: Map<string, string>;
  trackedPaths: Set<string>;
  untrackedPaths: string[];
  readFileText: (relativePath: string) => string;
}

const createEmitWorkspace = (): EmitWorkspace => {
  const files = new Map([
    ["src/store.ts", "export const store = 1;\n"],
    ["src/store.js", "export const store = 1;\n//# sourceMappingURL=store.js.map\n"],
    ["src/store.js.map", JSON.stringify({ file: "store.js", sources: ["store.ts"] })],
    [
      "src/store.d.ts",
      "export declare const store: number;\n//# sourceMappingURL=store.d.ts.map\n",
    ],
    ["src/store.d.ts.map", JSON.stringify({ file: "store.d.ts", sources: ["store.ts"] })],
  ]);
  return {
    files,
    trackedPaths: new Set(["src/store.ts"]),
    untrackedPaths: ["src/store.js", "src/store.js.map", "src/store.d.ts", "src/store.d.ts.map"],
    readFileText: (relativePath) => {
      const contents = files.get(relativePath);
      if (contents === undefined) throw new Error(`missing ${relativePath}`);
      return contents;
    },
  };
};

describe("collectTypeScriptEmitDuplicateJsPaths", () => {
  it("excludes a complete untracked quartet duplicating a tracked same-stem source", () => {
    const workspace = createEmitWorkspace();

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set(["src/store.js"]));
  });

  it("accepts a tracked .tsx source referenced through relative map sources", () => {
    const workspace = createEmitWorkspace();
    workspace.trackedPaths = new Set(["src/store.tsx"]);
    workspace.files.set(
      "src/store.js.map",
      JSON.stringify({ file: "store.js", sources: ["../src/store.tsx"] }),
    );
    workspace.files.set(
      "src/store.d.ts.map",
      JSON.stringify({ file: "store.d.ts", sources: ["../src/store.tsx"] }),
    );

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set(["src/store.js"]));
  });

  it("never excludes a tracked .js file", () => {
    const workspace = createEmitWorkspace();
    workspace.trackedPaths.add("src/store.js");

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set());
  });

  it("keeps the .js file when the quartet is incomplete", () => {
    const workspace = createEmitWorkspace();
    workspace.untrackedPaths = workspace.untrackedPaths.filter(
      (filePath) => filePath !== "src/store.d.ts.map",
    );

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set());
  });

  it("keeps the .js file when no tracked same-stem source exists", () => {
    const workspace = createEmitWorkspace();
    workspace.trackedPaths = new Set();

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set());
  });

  it("keeps the .js file on a mismatched sourceMappingURL reference", () => {
    const workspace = createEmitWorkspace();
    workspace.files.set(
      "src/store.js",
      "export const store = 1;\n//# sourceMappingURL=other.js.map\n",
    );

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set());
  });

  it("keeps the .js file when a map's target file or sources mismatch", () => {
    const wrongFile = createEmitWorkspace();
    wrongFile.files.set(
      "src/store.js.map",
      JSON.stringify({ file: "other.js", sources: ["store.ts"] }),
    );
    expect(collectTypeScriptEmitDuplicateJsPaths(wrongFile)).toEqual(new Set());

    const wrongSource = createEmitWorkspace();
    wrongSource.files.set(
      "src/store.d.ts.map",
      JSON.stringify({ file: "store.d.ts", sources: ["other.ts"] }),
    );
    expect(collectTypeScriptEmitDuplicateJsPaths(wrongSource)).toEqual(new Set());
  });

  it("keeps the .js file when a quartet member is unreadable or malformed", () => {
    const workspace = createEmitWorkspace();
    workspace.files.set("src/store.js.map", "{");

    expect(collectTypeScriptEmitDuplicateJsPaths(workspace)).toEqual(new Set());
  });
});
