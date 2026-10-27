import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resetFilesystemCaches } from "../../../utils/reset-filesystem-caches.js";
import { runRule } from "../../../../test-utils/run-rule.js";
import { noAsyncEventHandlerWithoutReentryGuard } from "../no-async-event-handler-without-reentry-guard.js";
import { resolveReferencedTsconfigAliasPath } from "./resolve-referenced-tsconfig-alias-path.js";
import { readDirectReferencedTsconfig } from "./read-direct-referenced-tsconfig.js";
import { matchTsconfigFilePattern } from "./match-tsconfig-file-pattern.js";

const editorSource = `import { useState } from "react";
import { ActionControl } from "@/ui/action-control";
export const Editor = () => {
  const [, setSaved] = useState(false);
  const save = async () => {
    await fetch("/records", { method: "POST" });
    setSaved(true);
  };
  return <ActionControl onClick={save}>Save</ActionControl>;
};`;
const producerSource = `import { forwardRef } from "react";
export const ActionControl = forwardRef(({ children, ...nativeProps }, forwardedRef) =>
  <button ref={forwardedRef} {...nativeProps}>{children}</button>
);`;
const solution = {
  files: [],
  references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.tools.json" }],
};
const app = {
  include: ["src/**/*"],
  exclude: ["src/**/__tests__/*"],
  compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["./src/*"] } },
};
const tools = { include: ["vite.config.*"], compilerOptions: { module: "ESNext" } };

const withProject = (
  inspect: (directory: string, filename: string, producer: string) => void,
): void => {
  const directory = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "rd-referenced-control-"),
  );
  const filename = path.join(directory, "src/editor.tsx");
  const producer = path.join(directory, "src/ui/action-control.tsx");
  try {
    fs.mkdirSync(path.dirname(producer), { recursive: true });
    fs.writeFileSync(
      path.join(directory, "package.json"),
      JSON.stringify({ dependencies: { react: "18.2.0" } }),
    );
    fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify(solution));
    fs.writeFileSync(path.join(directory, "tsconfig.app.json"), JSON.stringify(app));
    fs.writeFileSync(path.join(directory, "tsconfig.tools.json"), JSON.stringify(tools));
    fs.writeFileSync(filename, editorSource);
    fs.writeFileSync(producer, producerSource);
    resetFilesystemCaches();
    inspect(directory, filename, producer);
  } finally {
    resetFilesystemCaches();
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("direct referenced configuration aliases", () => {
  it("matches bounded whole-segment recursive patterns", () => {
    expect(matchTsconfigFilePattern("src/ui/control.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchTsconfigFilePattern("src/control.tsx", "src/**/*.tsx")).toBe(true);
    expect(matchTsconfigFilePattern("src/ui/deep/control.tsx", "src/*/control.tsx")).toBe(false);
  });
  it("resolves one owning direct reference and preserves caller context", () =>
    withProject((directory, filename, producer) => {
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).toEqual({
        filePath: producer,
        relativeSpecifier: "./ui/action-control.tsx",
      });
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, editorSource, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }));
  it("joins the same alias route for sibling component mutation", () =>
    withProject((directory, filename) => {
      const source = editorSource.replace(
        "export const Editor",
        'import { ActionControl as Other } from "@/ui/action-control";\nOther.defaultProps={disabled:true};\nexport const Editor',
      );
      fs.writeFileSync(filename, source);
      const result = runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }));
  it("declines ambiguous reference ownership", () =>
    withProject((directory, filename) => {
      fs.writeFileSync(path.join(directory, "tsconfig.tools.json"), JSON.stringify(app));
      expect(readDirectReferencedTsconfig(filename)).toBe(false);
    }));
  it("applies excluded paths and refuses unsupported directory shorthand", () =>
    withProject((directory, filename) => {
      const excluded = path.join(directory, "src/__tests__/editor.tsx");
      expect(readDirectReferencedTsconfig(excluded)).toBe(false);
      fs.writeFileSync(
        path.join(directory, "tsconfig.tools.json"),
        JSON.stringify({ include: ["src"], compilerOptions: {} }),
      );
      expect(readDirectReferencedTsconfig(filename)).toBe(false);
    }));
  it("rejects custom child JSX and React remapping", () =>
    withProject((directory, filename) => {
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({
          ...app,
          compilerOptions: { ...app.compilerOptions, jsxImportSource: "custom-jsx" },
        }),
      );
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).toBeNull();
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({
          ...app,
          compilerOptions: { ...app.compilerOptions, paths: { react: ["./shim"] } },
        }),
      );
      expect(readDirectReferencedTsconfig(filename)).toBe(false);
    }));
  it("rejects traversal, multiple alias targets and nested references", () =>
    withProject((directory, filename) => {
      expect(resolveReferencedTsconfigAliasPath(filename, "@/../outside")).toBeNull();
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({
          ...app,
          compilerOptions: { ...app.compilerOptions, paths: { "@/*": ["./src/*", "./other/*"] } },
        }),
      );
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).toBeNull();
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({ ...app, references: [{ path: "./nested.json" }] }),
      );
      expect(readDirectReferencedTsconfig(filename)).toBe(false);
    }));
  it("rejects loader and query suffixes even when matching literal files exist", () =>
    withProject((directory, filename) => {
      for (const suffix of ["?raw", "#fragment", "!loader"]) {
        fs.writeFileSync(
          path.join(directory, `src/ui/action-control${suffix}.tsx`),
          producerSource,
        );
        resetFilesystemCaches();
        expect(
          resolveReferencedTsconfigAliasPath(filename, `@/ui/action-control${suffix}`),
        ).toBeNull();
      }
    }));
  it("rereads a changed referenced configuration between lint passes", () =>
    withProject((directory, filename) => {
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).not.toBeNull();
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({ ...app, compilerOptions: { ...app.compilerOptions, jsx: "custom" } }),
      );
      resetFilesystemCaches();
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).toBeNull();
      fs.writeFileSync(path.join(directory, "tsconfig.app.json"), JSON.stringify(app));
      resetFilesystemCaches();
      expect(resolveReferencedTsconfigAliasPath(filename, "@/ui/action-control")).not.toBeNull();
      expect(fs.readFileSync(filename, "utf8")).toBe(editorSource);
    }));
});
