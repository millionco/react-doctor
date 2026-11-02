import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

let projectDirectory: string;

const writeProjectFile = (relativePath: string, source: string): string => {
  const filename = join(projectDirectory, relativePath);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, source);
  return filename;
};

const runPage = (source: string, relativePath = "pages/index.tsx") => {
  const code = `import { useState, useEffect, useEffectEvent } from "react"; ${source}`;
  const filename = writeProjectFile(relativePath, code);
  const result = runRule(rulesOfHooks, code, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

beforeEach(() => {
  projectDirectory = mkdtempSync(join(tmpdir(), "rd-next-pages-hooks-"));
  writeProjectFile(
    "package.json",
    JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0" } }),
  );
  resetManifestCaches();
});

afterEach(() => {
  rmSync(projectDirectory, { recursive: true, force: true });
  resetManifestCaches();
});

describe("rules-of-hooks Next Pages component scope", () => {
  it.each([
    "const home = () => { const [value] = useState(0); return <main>{value}</main>; }; export default home;",
    "function home() { useEffect(() => {}, []); return <main />; } export default home;",
    "export default function home() { useState(0); return <main />; }",
    "const home = function render() { useState(0); return <main />; }; export default home;",
    "const home = () => { useState(0); return <></>; }; export { home as default };",
    "const home = (() => { useState(0); return <main />; }) satisfies React.FC; export default home;",
    "const home = () => <main>{useState(0)[0]}</main>; export default home;",
    "const home = () => { const callback = useEffectEvent(() => {}); useEffect(() => callback(), []); return <main />; }; export default home;",
  ])("recognizes the exact exported page function: %s", (source) => {
    expect(runPage(source)).toEqual([]);
  });

  it.each([
    "pages/about.jsx",
    "pages/[slug].tsx",
    "src/pages/index.tsx",
    "src/pages/account/profile.tsx",
    "pages/_app.tsx",
  ])("recognizes a Pages route at %s", (filename) => {
    expect(
      runPage(
        "const home = () => { useState(0); return <main />; }; export default home;",
        filename,
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "conditional",
      "const home = ({ ready }) => { if (ready) useState(0); return <main />; }; export default home;",
      "changes Hook order",
    ],
    [
      "early return",
      "const home = ({ ready }) => { if (!ready) return null; useState(0); return <main />; }; export default home;",
      "changes Hook order",
    ],
    [
      "loop",
      "const home = ({ items }) => { for (const item of items) useState(item); return <main />; }; export default home;",
      "inside a loop",
    ],
    [
      "async",
      "const home = async () => { useState(0); return <main />; }; export default home;",
      "async function",
    ],
    [
      "try",
      "const home = () => { try { useState(0); } catch {} return <main />; }; export default home;",
      "try/catch/finally",
    ],
    [
      "named callback",
      "const home = () => { const readValue = () => useState(0); return <main />; }; export default home;",
      "not a component or Hook",
    ],
    [
      "anonymous callback",
      "const home = () => { Promise.resolve().then(() => useState(0)); return <main />; }; export default home;",
      "changes Hook order",
    ],
    [
      "effect event in render",
      "const home = () => { const callback = useEffectEvent(() => {}); callback(); return <main />; }; export default home;",
      "only works when called from Effects",
    ],
  ])("retains the %s warning", (_name, source, message) => {
    expect(runPage(source)).toEqual([
      expect.objectContaining({ message: expect.stringContaining(message) }),
    ]);
  });

  it.each([
    "components/index.tsx",
    "lib/pages/index.tsx",
    "pages/api/data.tsx",
    "src/pages/api/data.tsx",
    "pages/_document.tsx",
    "app/page.tsx",
  ])("does not infer a Pages component at %s", (filename) => {
    expect(
      runPage(
        "const home = () => { useState(0); return <main />; }; export default home;",
        filename,
      ),
    ).toHaveLength(1);
  });

  it.each([
    "const helper = () => { useState(0); return {}; }; export default helper;",
    "const helper = () => { useState(0); const child = () => <main />; return child; }; export default helper;",
    "const helper = () => { useState(0); return <main />; }; export const named = helper;",
    "const helper = () => { useState(0); return <main />; }; const home = () => <aside />; export default home;",
    "let home = () => { useState(0); return <main />; }; home = () => <aside />; export default home;",
    "function home() { useState(0); return <main />; } home = () => <aside />; export default home;",
    "const home = () => { const helper = () => { useState(0); return <aside />; }; return <main />; }; export default home;",
    "const home = () => { useState(0); return <main />; }; const alias = home; export default alias;",
    "export default function* home() { useState(0); return <main />; }",
    "const home = memo(() => <main />, () => { useState(0); return true; }); export default home;",
  ])("does not exempt ordinary or unstable functions: %s", (source) => {
    expect(runPage(source)).toHaveLength(1);
  });

  it.each([
    "next.config.js",
    "next.config.mjs",
    "next.config.cjs",
    "next.config.ts",
    "next.config.mts",
    "next.config.cts",
  ])("keeps custom routing configuration unresolved: %s", (filename) => {
    writeProjectFile(filename, 'export default { pageExtensions: ["page.tsx"] };');
    expect(
      runPage("const home = () => { useState(0); return <main />; }; export default home;"),
    ).toHaveLength(1);
  });

  it("does not use ignored src/pages when root pages exists", () => {
    writeProjectFile("pages/other.tsx", "export default () => <main />;");
    expect(
      runPage(
        "const home = () => { useState(0); return <main />; }; export default home;",
        "src/pages/index.tsx",
      ),
    ).toHaveLength(1);
  });

  it.each([{}, { dependencies: { react: "19.0.0" } }])(
    "requires a Next dependency in the owning package: %j",
    (manifest) => {
      writeProjectFile("package.json", JSON.stringify(manifest));
      expect(
        runPage("const home = () => { useState(0); return <main />; }; export default home;"),
      ).toHaveLength(1);
    },
  );

  it("does not inherit a sibling package's Next dependency", () => {
    writeProjectFile(
      "packages/ui/package.json",
      JSON.stringify({ dependencies: { react: "19.0.0" } }),
    );
    expect(
      runPage(
        "const home = () => { useState(0); return <main />; }; export default home;",
        "packages/ui/pages/index.tsx",
      ),
    ).toHaveLength(1);
  });
});
