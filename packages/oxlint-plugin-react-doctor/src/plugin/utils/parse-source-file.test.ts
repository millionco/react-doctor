import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseSync } from "oxc-parser";
import type { ParserOptions } from "oxc-parser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface TestParseOptions extends ParserOptions {
  readonly experimentalRawTransfer?: boolean;
}

const parserControls = vi.hoisted(() => ({
  rejectRawJavascript: false,
  rejectRawJsx: false,
  rejectAllJsx: false,
}));

vi.mock("oxc-parser", async (importOriginal) => {
  const original = await importOriginal<typeof import("oxc-parser")>();
  return {
    ...original,
    rawTransferSupported: () => true,
    parseSync: vi.fn((filename: string, sourceText: string, options?: TestParseOptions) => {
      if (
        parserControls.rejectRawJavascript &&
        options?.lang === "js" &&
        options.experimentalRawTransfer
      ) {
        throw new Error("Unavailable JavaScript transfer");
      }
      if (
        options?.lang === "jsx" &&
        (parserControls.rejectAllJsx ||
          (parserControls.rejectRawJsx && options.experimentalRawTransfer))
      ) {
        throw new Error("Unavailable JSX transfer");
      }
      const parserOptions = { ...options };
      delete parserOptions.experimentalRawTransfer;
      return original.parseSync(filename, sourceText, parserOptions);
    }),
  };
});

beforeEach(() => {
  parserControls.rejectRawJavascript = false;
  parserControls.rejectRawJsx = false;
  parserControls.rejectAllJsx = false;
  vi.clearAllMocks();
  vi.resetModules();
});

describe("cross-file JavaScript JSX retry", () => {
  it.each([".js", ".mjs", ".cjs", ".JS", ".MJS", ".CJS"])(
    "reads JSX in %s without changing the source filename",
    async (extension) => {
      const { parseCrossFileSource } = await import("./parse-source-file.js");
      const filename = `/tmp/view${extension}`;
      const sourceText = "const View = () => <section />;";
      const result = parseCrossFileSource(filename, sourceText);
      expect(result.errors).toEqual([]);
      const firstResult = vi.mocked(parseSync).mock.results[0];
      expect(result.program.sourceType).toBe(firstResult?.value.program.sourceType);
      expect(result.program).toMatchObject({
        type: "Program",
        body: [{ declarations: [{ init: { body: { type: "JSXElement" } } }] }],
      });
      expect(
        vi.mocked(parseSync).mock.calls.every(([parsedFilename]) => parsedFilename === filename),
      ).toBe(true);
    },
  );

  it.each([
    [".cjs", "module.exports = <section />;", "script"],
    [".mjs", "export default <section />;", "module"],
  ])(
    "preserves filename-derived source type for JSX in %s",
    async (extension, sourceText, sourceType) => {
      const { parseCrossFileSource } = await import("./parse-source-file.js");
      const filename = `/tmp/entry${extension}`;
      const result = parseCrossFileSource(filename, sourceText);
      expect(result.errors).toEqual([]);
      expect(result.program.sourceType).toBe(sourceType);
      expect(
        vi.mocked(parseSync).mock.calls.every(([parsedFilename]) => parsedFilename === filename),
      ).toBe(true);
    },
  );

  it("keeps a top-level CommonJS return invalid after the JSX retry", async () => {
    const { parseCrossFileSource, parseSourceText } = await import("./parse-source-file.js");
    const filename = "/tmp/entry.cjs";
    const sourceText = "return <section />;";
    const result = parseCrossFileSource(filename, sourceText);
    const firstResult = vi.mocked(parseSync).mock.results[0];
    expect(result).toBe(firstResult?.value);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.program.sourceType).toBe("script");
    expect(parseSourceText({ filename, sourceText })).toBeNull();
  });

  it.each([
    [".js", "export const answer = 42;"],
    [".mjs", "export default 42;"],
    [".cjs", "module.exports = 42;"],
  ])("preserves the first successful %s parse", async (extension, sourceText) => {
    const { parseCrossFileSource } = await import("./parse-source-file.js");
    const result = parseCrossFileSource(`/tmp/plain${extension}`, sourceText);
    const firstResult = vi.mocked(parseSync).mock.results[0];
    expect(firstResult?.type).toBe("return");
    expect(result).toBe(firstResult?.value);
    expect(result.errors).toEqual([]);
    expect(vi.mocked(parseSync).mock.calls.every(([, , options]) => options?.lang === "js")).toBe(
      true,
    );
  });

  it.each([
    [".js", "const answer: number = 42;"],
    [".mjs", "interface Shape { value: string }"],
    [".cjs", "const answer = 42 as number;"],
    [".js", "const View = () => <section />; const broken = ;"],
  ])("retains the first failure for invalid JavaScript in %s", async (extension, sourceText) => {
    const { parseCrossFileSource, parseSourceText } = await import("./parse-source-file.js");
    const filename = `/tmp/broken${extension}`;
    const result = parseCrossFileSource(filename, sourceText);
    const firstResult = vi.mocked(parseSync).mock.results[0];
    expect(firstResult?.type).toBe("return");
    expect(result).toBe(firstResult?.value);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(parseSourceText({ filename, sourceText })).toBeNull();
  });

  it.each([".ts", ".mts", ".cts"])("does not retry a %s source as JSX", async (extension) => {
    const { parseSourceText } = await import("./parse-source-file.js");
    expect(
      parseSourceText({
        filename: `/tmp/typed${extension}`,
        sourceText: "const View = () => <section />;",
      }),
    ).toBeNull();
    expect(vi.mocked(parseSync).mock.calls.every(([, , options]) => options?.lang === "ts")).toBe(
      true,
    );
  });

  it("retains the first result and program when the JSX retry throws", async () => {
    parserControls.rejectAllJsx = true;
    const { parseCrossFileSource } = await import("./parse-source-file.js");
    const result = parseCrossFileSource("/tmp/broken.js", "const View = () => <section />;");
    const firstResult = vi.mocked(parseSync).mock.results[0];
    expect(firstResult?.type).toBe("return");
    expect(result).toBe(firstResult?.value);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.program).toBe(firstResult?.value.program);
  });

  it.skipIf(process.platform === "win32")(
    "keeps the existing sticky JSON-transfer fallback when a raw JSX retry throws",
    async () => {
      parserControls.rejectRawJsx = true;
      const { parseCrossFileSource } = await import("./parse-source-file.js");
      expect(
        parseCrossFileSource("/tmp/view.js", "const View = () => <section />;").errors,
      ).toEqual([]);
      expect(
        vi
          .mocked(parseSync)
          .mock.calls.some(
            ([, , options]) =>
              options?.lang === "jsx" && Reflect.get(options, "experimentalRawTransfer") === true,
          ),
      ).toBe(true);
      vi.mocked(parseSync).mockClear();
      expect(parseCrossFileSource("/tmp/next.js", "const answer = 42;").errors).toEqual([]);
      expect(
        vi
          .mocked(parseSync)
          .mock.calls.every(
            ([, , options]) => Reflect.get(options ?? {}, "experimentalRawTransfer") === false,
          ),
      ).toBe(true);
    },
  );

  it.each([
    [".ts", "const answer: number = 42;"],
    [".tsx", "const View = () => <section />;"],
  ])("preserves the first successful %s parse", async (extension, sourceText) => {
    const { parseCrossFileSource } = await import("./parse-source-file.js");
    const result = parseCrossFileSource(`/tmp/typed${extension}`, sourceText);
    const firstResult = vi.mocked(parseSync).mock.results[0];
    expect(result).toBe(firstResult?.value);
    expect(result.errors).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "uses the sticky JSON-transfer fallback when the first JavaScript attempt throws",
    async () => {
      parserControls.rejectRawJavascript = true;
      const { parseCrossFileSource } = await import("./parse-source-file.js");
      expect(
        parseCrossFileSource("/tmp/view.js", "const View = () => <section />;").errors,
      ).toEqual([]);
      const calls = vi.mocked(parseSync).mock.calls;
      expect(Reflect.get(calls[0]?.[2] ?? {}, "experimentalRawTransfer")).toBe(true);
      expect(
        calls
          .slice(1)
          .every(
            ([, , options]) => Reflect.get(options ?? {}, "experimentalRawTransfer") === false,
          ),
      ).toBe(true);
      vi.mocked(parseSync).mockClear();
      expect(parseCrossFileSource("/tmp/next.js", "const answer = 42;").errors).toEqual([]);
      expect(
        vi
          .mocked(parseSync)
          .mock.calls.every(
            ([, , options]) => Reflect.get(options ?? {}, "experimentalRawTransfer") === false,
          ),
      ).toBe(true);
    },
  );

  it.skipIf(process.platform === "win32")(
    "preserves the first result when raw JSX fails and JSON JSX still has syntax errors",
    async () => {
      parserControls.rejectRawJsx = true;
      const { parseCrossFileSource } = await import("./parse-source-file.js");
      const result = parseCrossFileSource(
        "/tmp/broken.js",
        "const View = () => <section />; const broken = ;",
      );
      const firstResult = vi.mocked(parseSync).mock.results[0];
      expect(result).toBe(firstResult?.value);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(
        vi
          .mocked(parseSync)
          .mock.calls.some(
            ([, , options]) =>
              options?.lang === "jsx" && Reflect.get(options, "experimentalRawTransfer") === false,
          ),
      ).toBe(true);
    },
  );

  it("indexes a mixed JavaScript/JSX project and preserves source probes across cache/reset", async () => {
    const { buildSourceProjectIndex } = await import("./build-source-project-index.js");
    const { analyzeScopes } = await import("../semantic/scope-analysis.js");
    const { captureCrossFileProbes } = await import("./cross-file-probe-recorder.js");
    const { isNodeOfType } = await import("./is-node-of-type.js");
    const { parseSourceFile } = await import("./parse-source-file.js");
    const { resetFilesystemCaches } = await import("./reset-filesystem-caches.js");
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cross-file-jsx-"));
    const sourceDirectory = path.join(temporaryDirectory, "src");
    const entryPath = path.join(sourceDirectory, "entry.jsx");
    const viewPath = path.join(sourceDirectory, "view.js");
    const preservedTimestamp = new Date("2025-01-01T00:00:00.000Z");
    try {
      fs.mkdirSync(sourceDirectory);
      fs.writeFileSync(path.join(temporaryDirectory, "package.json"), '{"private":true}');
      fs.writeFileSync(
        entryPath,
        'import { View } from "./view.js"; export const App = () => <View />;',
      );
      fs.writeFileSync(viewPath, "export const View = () => <span />;");
      fs.writeFileSync(
        path.join(sourceDirectory, "module.mjs"),
        "export const View = () => <div />;",
      );
      fs.writeFileSync(path.join(sourceDirectory, "common.cjs"), "exports.View = () => <aside />;");
      fs.utimesSync(viewPath, preservedTimestamp, preservedTimestamp);
      const program = parseSourceFile(entryPath);
      if (!program || !isNodeOfType(program, "Program")) throw new Error("Missing entry program");
      const input = {
        rootDirectory: temporaryDirectory,
        currentFilePath: entryPath,
        currentProgramNode: program,
        currentScopes: analyzeScopes(program),
      };
      const first = captureCrossFileProbes(() => buildSourceProjectIndex(input));
      expect(first.value?.modulesByFilePath.size).toBe(4);
      expect(first.trace.contentPaths.has(viewPath)).toBe(true);
      const warm = captureCrossFileProbes(() => parseSourceFile(viewPath));
      expect(warm.value).not.toBeNull();
      expect(warm.trace.contentPaths.has(viewPath)).toBe(true);
      fs.writeFileSync(viewPath, "export const View = () => <main />;");
      fs.utimesSync(viewPath, preservedTimestamp, preservedTimestamp);
      expect(fs.statSync(viewPath).mtimeMs).toBe(preservedTimestamp.getTime());
      expect(fs.statSync(viewPath).size).toBe(
        Buffer.byteLength("export const View = () => <span />;"),
      );
      resetFilesystemCaches();
      const refreshed = captureCrossFileProbes(() => parseSourceFile(viewPath));
      expect(refreshed.value).toMatchObject({
        body: [
          {
            declaration: {
              declarations: [
                {
                  init: {
                    body: {
                      openingElement: { name: { name: "main" } },
                    },
                  },
                },
              ],
            },
          },
        ],
      });
      expect(refreshed.trace.contentPaths.has(viewPath)).toBe(true);
      fs.writeFileSync(path.join(sourceDirectory, "broken.js"), "const broken = ;");
      resetFilesystemCaches();
      expect(buildSourceProjectIndex(input)).toBeNull();
    } finally {
      resetFilesystemCaches();
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
