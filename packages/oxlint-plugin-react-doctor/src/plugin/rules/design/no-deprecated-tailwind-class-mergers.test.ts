import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { resetCrossFileExportCaches } from "../../utils/resolve-cross-file-function-export.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noDeprecatedTailwindClass } from "./no-deprecated-tailwind-class.js";

const mergerManifest = JSON.stringify({
  dependencies: { "tailwind-merge": "3.4.0", clsx: "2.1.1" },
});
const mergerWrapper = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
`;
const wrapperComponent = `import { cn } from "./classes";
export const Example = () => <span className={cn("flex-shrink-0", "shrink")}/>;
`;
let fixtureDirectory: string;

const writeMergerFile = (relativePath: string, contents: string): string => {
  const filename = path.join(fixtureDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};

const resetMergerScanCaches = (): void => {
  __clearParseSourceFileCacheForTests();
  resetManifestCaches();
  resetCrossFileExportCaches();
  resetTsconfigAliasCaches();
};

const scanMergerCode = (code: string) => {
  resetMergerScanCaches();
  const filename = writeMergerFile("src/example.tsx", code);
  const result = runRule(noDeprecatedTailwindClass, code, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

const mergerWarning = (token: string) => ({
  nodeType: "JSXOpeningElement",
  message: `\`${token}\` is a legacy Tailwind name — use the canonical v4 utility \`${token.replace("flex-", "")}\`.`,
});

const mergerProbeSnapshot = (filename: string) => {
  const trace = collectCrossFileDependencyProbes({
    absoluteFilePath: filename,
    sourceText: fs.readFileSync(filename, "utf8"),
    ruleIds: ["no-deprecated-tailwind-class"],
  });
  expect(trace).not.toBeNull();
  return [...new Set([...(trace?.contentPaths ?? []), ...(trace?.existencePaths ?? [])])]
    .sort()
    .map((probe) => ({
      path: probe,
      contents: fs.existsSync(probe)
        ? fs.statSync(probe).isFile()
          ? fs.readFileSync(probe, "utf8")
          : "DIRECTORY"
        : "ABSENT",
    }));
};

beforeEach(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-merger-"));
  writeMergerFile("package.json", mergerManifest);
  writeMergerFile("src/classes.ts", mergerWrapper);
  resetMergerScanCaches();
});

afterEach(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  resetMergerScanCaches();
});

describe("no-deprecated-tailwind-class preserved merger tokens", () => {
  it.each(["flex-shrink", "flex-shrink-0", "flex-grow", "flex-grow-0"])(
    "reports the preserved plain %s token",
    (token) => {
      expect(
        scanMergerCode(
          `import { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge("${token}", "shrink grow")}/>;`,
        ),
      ).toEqual([mergerWarning(token)]);
    },
  );

  it("reports each guaranteed token once across repeated arguments", () => {
    expect(
      scanMergerCode(
        `import { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge("flex-shrink-0 flex-shrink-0", "flex-grow", "flex-shrink-0")}/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0"), mergerWarning("flex-grow")]);
  });

  it("accepts named import aliases and the default clsx export", () => {
    expect(
      scanMergerCode(
        `import combine from "clsx"; import { twMerge as mergeClasses } from "tailwind-merge"; export const Example = ({active}) => <span className={mergeClasses(combine("flex-shrink-0", active ? "bg-green-500" : "bg-red-500"))}/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("intersects closed conditional branches", () => {
    expect(
      scanMergerCode(
        `import { twMerge } from "tailwind-merge"; export const Example = ({active}) => <span className={twMerge(active ? "flex-shrink-0 flex-grow" : "flex-grow flex-shrink-0")}/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0"), mergerWarning("flex-grow")]);
  });

  it("follows one initialized readonly const in the same function body", () => {
    expect(
      scanMergerCode(
        `import { cn } from "./classes"; export const Example = ({status}) => { const tone = status === "ready" ? "bg-green-500" : status === "pending" ? "bg-yellow-500" : "bg-red-500"; return <span className={cn("flex-shrink-0", tone)}/>; };`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("accepts an exact const arrow rest wrapper", () => {
    writeMergerFile(
      "src/classes.ts",
      `import { clsx } from "clsx"; import { twMerge } from "tailwind-merge"; export const cn = (...inputs) => twMerge(clsx(inputs));`,
    );
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("preserves old literal duplicate reports", () => {
    expect(
      scanMergerCode(
        `export const Example = () => <span className="flex-shrink-0 flex-shrink-0"/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0"), mergerWarning("flex-shrink-0")]);
  });

  it("allows an earlier spread but declines an overriding later spread", () => {
    expect(
      scanMergerCode(
        `import { cn } from "./classes"; export const Example = ({attributes}) => <span {...attributes} className={cn("flex-shrink-0")}/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0")]);
    expect(
      scanMergerCode(
        `import { cn } from "./classes"; export const Example = ({attributes}) => <span className={cn("flex-shrink-0")} {...attributes}/>;`,
      ),
    ).toEqual([]);
  });

  it.each([
    `import { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge("bg-gradient-to-br", "bg-red-500")}/>;`,
    `import { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge("md:flex-shrink-0 !flex-grow flex-grow-2")}/>;`,
    `import { twMerge } from "tailwind-merge"; export const Example = (twMerge) => <span className={twMerge("flex-shrink-0")}/>;`,
    `const cn = () => "shrink"; export const Example = () => <span className={cn("flex-shrink-0")}/>;`,
    `import { extendTailwindMerge } from "tailwind-merge"; const merge = extendTailwindMerge({}); export const Example = () => <span className={merge("flex-shrink-0", "shrink")}/>;`,
    `import type { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge("flex-shrink-0")}/>;`,
    `import * as merger from "tailwind-merge"; export const Example = () => <span className={merger.twMerge("flex-shrink-0")}/>;`,
    `import { twMerge } from "tailwind-merge"; export const Example = () => <span className={twMerge?.("flex-shrink-0")}/>;`,
  ])("does not infer a default plain-token provider for %s", (code) => {
    expect(scanMergerCode(code)).toEqual([]);
  });

  it.each([
    { pnpm: { overrides: { "tailwind-merge": "file:./fake-merge" } } },
    { overrides: { "tailwind-merge": "npm:other-merger@1.0.0" } },
    { overrides: { parent: { "tailwind-merge": "file:./fake-merge" } } },
    { resolutions: { "**/tailwind-merge": "file:./fake-merge" } },
    { pnpm: { patchedDependencies: { "tailwind-merge@3.4.0": "patches/merger.patch" } } },
    { resolutions: { "unknown-*": "file:./replacement" } },
    { pnpm: { overrides: { clsx: "file:./fake-clsx" } } },
  ])("declines explicit or unresolved SDK replacement selectors %j", (metadata) => {
    writeMergerFile("package.json", JSON.stringify({ ...JSON.parse(mergerManifest), ...metadata }));
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("preserves unrelated literal package overrides", () => {
    writeMergerFile(
      "package.json",
      JSON.stringify({
        ...JSON.parse(mergerManifest),
        overrides: { "cpu-features": "npm:empty-npm-package@1.0.0", axios: "1.13.5" },
      }),
    );
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("declines a wrapper prelude or changed return implementation", () => {
    writeMergerFile(
      "src/classes.ts",
      `import { clsx } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs) { inputs.length = 0; return twMerge(clsx(inputs)); }`,
    );
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
    writeMergerFile("src/classes.ts", `export const cn = (...inputs) => "shrink";`);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("declines reassigned live wrapper exports", () => {
    writeMergerFile("src/classes.ts", mergerWrapper + `cn = () => "shrink";`);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("declines wrapper writes in runtime TypeScript initializers", () => {
    writeMergerFile(
      "src/classes.ts",
      mergerWrapper +
        `class Redirect { constructor(public ignored = (cn = () => "shrink")) {} } new Redirect();`,
    );
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("declines direct eval that can rebind an exported wrapper", () => {
    writeMergerFile("src/classes.ts", mergerWrapper + `eval('cn = () => "shrink"');`);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("accepts an initialized module const used inside JSX functions", () => {
    expect(
      scanMergerCode(
        `import { twMerge } from "tailwind-merge"; const classes = "flex-shrink-0"; export const Example = () => <span className={twMerge(classes)}/>;`,
      ),
    ).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("declines a module const referenced before initialization", () => {
    expect(
      scanMergerCode(
        `import { twMerge } from "tailwind-merge"; const element = <span className={twMerge(classes)}/>; const classes = "flex-shrink-0"; export const Example = () => element;`,
      ),
    ).toEqual([]);
  });

  it("declines a barrel even when it resolves the supported function", () => {
    writeMergerFile("src/implementation.ts", mergerWrapper);
    writeMergerFile("src/classes.ts", `export { cn } from "./implementation";`);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });
});

describe("merger dependency probes across scans", () => {
  it("preserves cold/warm probes and detects an edited helper", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
    const cold = mergerProbeSnapshot(filename);
    expect(mergerProbeSnapshot(filename)).toEqual(cold);
    writeMergerFile("src/classes.ts", `export const cn = () => "shrink";`);
    expect(mergerProbeSnapshot(filename)).not.toEqual(cold);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("detects helper deletion and subsequent appearance", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    const existing = mergerProbeSnapshot(filename);
    fs.unlinkSync(path.join(fixtureDirectory, "src/classes.ts"));
    expect(mergerProbeSnapshot(filename)).not.toEqual(existing);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
    const missing = mergerProbeSnapshot(filename);
    writeMergerFile("src/classes.ts", mergerWrapper);
    expect(mergerProbeSnapshot(filename)).not.toEqual(missing);
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
  });

  it("invalidates a nearest manifest version edit", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    const initial = mergerProbeSnapshot(filename);
    writeMergerFile(
      "package.json",
      JSON.stringify({ dependencies: { "tailwind-merge": "^3.4.0", clsx: "2.1.1" } }),
    );
    expect(mergerProbeSnapshot(filename)).not.toEqual(initial);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("invalidates exact dependency pins when an SDK override is added", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
    const prior = mergerProbeSnapshot(filename);
    writeMergerFile(
      "package.json",
      JSON.stringify({
        ...JSON.parse(mergerManifest),
        pnpm: { overrides: { "tailwind-merge": "file:./fake-merge" } },
      }),
    );
    expect(mergerProbeSnapshot(filename)).not.toEqual(prior);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("records a closer manifest appearing only above the imported wrapper", () => {
    writeMergerFile("src/helpers/classes.ts", mergerWrapper);
    const code = wrapperComponent.replace('"./classes"', '"./helpers/classes"');
    const filename = writeMergerFile("src/example.tsx", code);
    expect(scanMergerCode(code)).toEqual([mergerWarning("flex-shrink-0")]);
    const prior = mergerProbeSnapshot(filename);
    writeMergerFile("src/helpers/package.json", mergerManifest);
    expect(mergerProbeSnapshot(filename)).not.toEqual(prior);
    expect(scanMergerCode(code)).toEqual([]);
  });

  it("records SDK tsconfig alias retargeting", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    writeMergerFile("src/custom.ts", `export const twMerge = () => "shrink";`);
    const prior = mergerProbeSnapshot(filename);
    writeMergerFile(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "tailwind-merge": ["./src/custom.ts"] } } }),
    );
    expect(mergerProbeSnapshot(filename)).not.toEqual(prior);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });

  it("records relative import resolution retargeting to a different extension", () => {
    const filename = writeMergerFile("src/example.tsx", wrapperComponent);
    expect(scanMergerCode(wrapperComponent)).toEqual([mergerWarning("flex-shrink-0")]);
    const prior = mergerProbeSnapshot(filename);
    fs.unlinkSync(path.join(fixtureDirectory, "src/classes.ts"));
    writeMergerFile("src/classes.tsx", `export const cn = () => "shrink";`);
    expect(mergerProbeSnapshot(filename)).not.toEqual(prior);
    expect(scanMergerCode(wrapperComponent)).toEqual([]);
  });
});
