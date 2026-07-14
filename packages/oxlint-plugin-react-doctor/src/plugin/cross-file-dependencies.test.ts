import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CROSS_FILE_DEPENDENCY_COLLECTORS,
  UNBOUNDED_CROSS_FILE_RULE_IDS,
  collectCrossFileDependencyProbes,
} from "./cross-file-dependencies.js";
import { CROSS_FILE_RULE_IDS } from "./constants/cross-file-rule-ids.js";
import { __clearParseSourceFileCacheForTests } from "./utils/parse-source-file.js";
import { resetManifestCaches } from "./utils/read-nearest-package-manifest.js";
import { __clearTsconfigAliasCacheForTests } from "./utils/resolve-tsconfig-alias.js";

// The collectors' contract (see cross-file-dependencies.ts): for a given file,
// the recorded probe set must contain every path whose existence or content
// the corresponding rule's cross-file reads can consult. These tests pin the
// per-rule probe sets on real fixture trees — a dependency file must appear,
// an unrelated file must not, and the negative resolution candidates that make
// shadowing detectable must be present.

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-cross-file-deps-"));
  __clearParseSourceFileCacheForTests();
  __clearTsconfigAliasCacheForTests();
  resetManifestCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixtureFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const collectFor = (absoluteFilePath: string, ruleIds: ReadonlyArray<string>) =>
  collectCrossFileDependencyProbes({
    absoluteFilePath,
    sourceText: fs.readFileSync(absoluteFilePath, "utf8"),
    ruleIds,
  });

const fixturePath = (relativePath: string): string => path.join(temporaryDirectory, relativePath);

describe("collectCrossFileDependencyProbes — driver", () => {
  it("returns null for a rule without a collector (must degrade to unbounded)", () => {
    const appPath = writeFixtureFile("App.tsx", "export const App = () => null;\n");
    expect(collectFor(appPath, ["some-future-cross-file-rule"])).toBeNull();
  });

  it("returns null for a file with a fatal parse error (always re-lint)", () => {
    const appPath = writeFixtureFile("broken.tsx", "const = ;;; <<<\n");
    expect(collectFor(appPath, ["no-barrel-import"])).toBeNull();
  });

  it("collects an empty trace for a file with no cross-file reads", () => {
    const appPath = writeFixtureFile("plain.tsx", "export const Plain = () => <div>ok</div>;\n");
    const trace = collectFor(appPath, [
      "no-barrel-import",
      "no-mutating-reducer-state",
      "nextjs-missing-metadata",
      "nextjs-no-use-search-params-without-suspense",
    ]);
    expect(trace).not.toBeNull();
    expect(trace?.contentPaths.size).toBe(0);
    expect(trace?.existencePaths.size).toBe(0);
  });
});

describe("no-barrel-import collector", () => {
  const setupBarrelFixture = (): string => {
    writeFixtureFile("src/components/Button.tsx", "export const Button = () => null;\n");
    writeFixtureFile("src/components/index.ts", "export { Button } from './Button';\n");
    writeFixtureFile("src/unrelated.tsx", "export const Unrelated = () => null;\n");
    return writeFixtureFile(
      "src/App.tsx",
      `import { Button } from "./components";\nexport const App = () => <Button />;\n`,
    );
  };

  it("records the barrel, its export target, and the resolution candidates", () => {
    const appPath = setupBarrelFixture();
    const trace = collectFor(appPath, ["no-barrel-import"]);
    expect(trace).not.toBeNull();
    // The barrel's content is read; a NAMED re-export target is only
    // resolved (existence) — the rule never reads its content.
    expect(trace?.contentPaths.has(fixturePath("src/components/index.ts"))).toBe(true);
    expect(trace?.existencePaths.has(fixturePath("src/components/Button.tsx"))).toBe(true);
    // The extension candidates probed (and absent) BEFORE the directory
    // resolution — a file appearing at one of them shadows the barrel.
    expect(trace?.existencePaths.has(fixturePath("src/components.ts"))).toBe(true);
    expect(trace?.existencePaths.has(fixturePath("src/components.tsx"))).toBe(true);
    // An unrelated sibling is NOT a dependency.
    expect(trace?.contentPaths.has(fixturePath("src/unrelated.tsx"))).toBe(false);
    expect(trace?.existencePaths.has(fixturePath("src/unrelated.tsx"))).toBe(false);
  });

  it("reads star-export targets' content (the name lookup goes through them)", () => {
    writeFixtureFile("src/components/Button.tsx", "export const Button = () => null;\n");
    writeFixtureFile("src/components/index.ts", "export * from './Button';\n");
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { Button } from "./components";\nexport const App = () => <Button />;\n`,
    );
    const trace = collectFor(appPath, ["no-barrel-import"]);
    expect(trace?.contentPaths.has(fixturePath("src/components/Button.tsx"))).toBe(true);
  });

  it("records no probes for bare-module and side-effect-only imports", () => {
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import * as React from "react";\nimport "./styles.css";\nexport const App = () => null;\n`,
    );
    const trace = collectFor(appPath, ["no-barrel-import"]);
    expect(trace?.contentPaths.size).toBe(0);
    expect(trace?.existencePaths.size).toBe(0);
  });

  it("records no probes for type-only relative imports (mirrors the rule)", () => {
    writeFixtureFile("src/types/index.ts", "export type { Props } from './props';\n");
    writeFixtureFile("src/types/props.ts", "export interface Props { id: string }\n");
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import type { Props } from "./types";\nexport const App = (props: Props) => null;\n`,
    );
    const trace = collectFor(appPath, ["no-barrel-import"]);
    expect(trace?.contentPaths.size).toBe(0);
    expect(trace?.existencePaths.size).toBe(0);
  });
});

describe("no-mutating-reducer-state collector", () => {
  it("resolves import targets only when the file can reference useReducer", () => {
    writeFixtureFile("src/reducer.ts", "export const reducer = (state) => state;\n");
    const withHook = writeFixtureFile(
      "src/Store.tsx",
      `import { useReducer } from "react";\nimport { reducer } from "./reducer";\nexport const useStore = () => useReducer(reducer, {});\n`,
    );
    const withoutHook = writeFixtureFile(
      "src/Plain.tsx",
      `import { reducer } from "./reducer";\nexport const usePlain = () => reducer({});\n`,
    );

    const gatedInTrace = collectFor(withHook, ["no-mutating-reducer-state"]);
    expect(gatedInTrace?.contentPaths.has(fixturePath("src/reducer.ts"))).toBe(true);

    const gatedOutTrace = collectFor(withoutHook, ["no-mutating-reducer-state"]);
    expect(gatedOutTrace?.contentPaths.size).toBe(0);
    expect(gatedOutTrace?.existencePaths.size).toBe(0);
  });

  it("resolves only the imports actually passed to useReducer", () => {
    writeFixtureFile("src/reducer.ts", "export const reducer = (state) => state;\n");
    writeFixtureFile("src/helper.ts", "export const helper = () => 1;\n");
    const storePath = writeFixtureFile(
      "src/Store.tsx",
      `import { useReducer } from "react";\nimport { reducer } from "./reducer";\nimport { helper } from "./helper";\nexport const useStore = () => useReducer(reducer, helper());\n`,
    );
    const trace = collectFor(storePath, ["no-mutating-reducer-state"]);
    expect(trace?.contentPaths.has(fixturePath("src/reducer.ts"))).toBe(true);
    // Imported but never a reducer argument — the rule never follows it.
    expect(trace?.contentPaths.has(fixturePath("src/helper.ts"))).toBe(false);
  });

  it("records the tsconfig chain for alias-imported reducers on EVERY collection", () => {
    writeFixtureFile("tsconfig.json", `{ "extends": "./tsconfig.base.json" }\n`);
    writeFixtureFile(
      "tsconfig.base.json",
      `{ "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } } }\n`,
    );
    writeFixtureFile("src/reducer.ts", "export const reducer = (state) => state;\n");
    const storeSource = (label: string): string =>
      `import { useReducer } from "react";\nimport { reducer } from "@app/reducer";\nexport const use${label} = () => useReducer(reducer, {});\n`;
    const firstPath = writeFixtureFile("src/StoreA.tsx", storeSource("A"));
    const secondPath = writeFixtureFile("src/StoreB.tsx", storeSource("B"));

    const chainPaths = [fixturePath("tsconfig.json"), fixturePath("tsconfig.base.json")];
    const firstTrace = collectFor(firstPath, ["no-mutating-reducer-state"]);
    for (const chainPath of chainPaths) {
      expect(firstTrace?.contentPaths.has(chainPath)).toBe(true);
    }
    expect(firstTrace?.contentPaths.has(fixturePath("src/reducer.ts"))).toBe(true);
    // The second file resolves through the now-MEMOIZED tsconfig loader —
    // the memo hit must replay the chain's probes, not swallow them.
    const secondTrace = collectFor(secondPath, ["no-mutating-reducer-state"]);
    for (const chainPath of chainPaths) {
      expect(secondTrace?.contentPaths.has(chainPath)).toBe(true);
    }
    expect(secondTrace?.contentPaths.has(fixturePath("src/reducer.ts"))).toBe(true);
  });

  it("keeps the gate open for unicode-escaped identifiers (soundness fallback)", () => {
    writeFixtureFile("src/reducer.ts", "export const reducer = (state) => state;\n");
    // The fixture spells the property as `React.useReducer` — the raw
    // text never contains "useReducer", only the cooked identifier does.
    const escapedHook = writeFixtureFile(
      "src/Escaped.tsx",
      `import * as React from "react";\nimport { reducer } from "./reducer";\nexport const useStore = () => React.\\u0075seReducer(reducer, {});\n`,
    );
    const trace = collectFor(escapedHook, ["no-mutating-reducer-state"]);
    expect(trace?.contentPaths.has(fixturePath("src/reducer.ts"))).toBe(true);
  });
});

describe("effect value helper collectors", () => {
  const affectedRuleIds = [
    "client-passive-event-listeners",
    "no-adjust-state-on-prop-change",
    "no-derived-state",
    "no-derived-state-effect",
    "no-event-handler",
    "no-initialize-state",
  ];

  it("records imported helper content for every affected rule and replays cached parse probes", () => {
    writeFixtureFile(
      "src/derive-visible.ts",
      "export const deriveVisible = (items) => items.filter((item) => item.visible);\n",
    );
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { deriveVisible as selectVisible } from "./derive-visible";
export const App = ({ items }) => {
  const [visible, setVisible] = useState([]);
  useEffect(() => setVisible(selectVisible(items)), [items]);
  return visible.length;
};\n`,
    );
    const firstTrace = collectFor(appPath, affectedRuleIds);
    const repeatTrace = collectFor(appPath, affectedRuleIds);
    for (const trace of [firstTrace, repeatTrace]) {
      expect(trace?.contentPaths.has(fixturePath("src/derive-visible.ts"))).toBe(true);
    }
  });

  it("records alias manifests and every renamed re-export target on cached collections", () => {
    writeFixtureFile("tsconfig.json", `{ "extends": "./tsconfig.base.json" }\n`);
    writeFixtureFile(
      "tsconfig.base.json",
      `{ "compilerOptions": { "baseUrl": ".", "paths": { "@helpers": ["src/index"] } } }\n`,
    );
    writeFixtureFile(
      "src/derive-visible.ts",
      "export const internalVisible = (items) => items.filter((item) => item.visible);\n",
    );
    writeFixtureFile(
      "src/index.ts",
      `export { internalVisible as deriveVisible } from "./derive-visible";\n`,
    );
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { deriveVisible } from "@helpers";
export const App = ({ items }) => {
  const [visible, setVisible] = useState([]);
  useEffect(() => setVisible(deriveVisible(items)), [items]);
  return visible.length;
};\n`,
    );
    const expectedContentPaths = [
      fixturePath("tsconfig.json"),
      fixturePath("tsconfig.base.json"),
      fixturePath("src/index.ts"),
      fixturePath("src/derive-visible.ts"),
    ];
    for (const trace of [
      collectFor(appPath, affectedRuleIds),
      collectFor(appPath, affectedRuleIds),
    ]) {
      for (const expectedPath of expectedContentPaths) {
        expect(trace?.contentPaths.has(expectedPath)).toBe(true);
      }
    }
  });
});

describe("forwarded Hook dependency collectors", () => {
  const affectedRuleIds = [
    "exhaustive-deps",
    "no-effect-with-fresh-deps",
    "rerender-memo-with-default-value",
  ];

  it("records direct and nested imported Hook modules for every affected rule", () => {
    writeFixtureFile(
      "src/use-inner.ts",
      `import { useEffect } from "react";\nexport const useInner = (dependencies) => useEffect(() => {}, dependencies);\n`,
    );
    writeFixtureFile(
      "src/use-outer.ts",
      `import { useInner } from "./use-inner";\nexport const useOuter = (dependencies) => useInner(dependencies);\n`,
    );
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { useOuter } from "./use-outer";\nexport const App = () => { useOuter([]); return null; };\n`,
    );

    const trace = collectFor(appPath, affectedRuleIds);
    expect(trace?.contentPaths.has(fixturePath("src/use-outer.ts"))).toBe(true);
    expect(trace?.contentPaths.has(fixturePath("src/use-inner.ts"))).toBe(true);
  });

  it("records conditional imported Hook aliases used by a reached module", () => {
    writeFixtureFile(
      "src/use-isomorphic-layout-effect.ts",
      `import { useEffect, useLayoutEffect } from "react";\nexport const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;\n`,
    );
    writeFixtureFile(
      "src/use-document-events.ts",
      `import { useIsomorphicLayoutEffect } from "./use-isomorphic-layout-effect";\nexport const useDocumentEvents = (dependencies) => useIsomorphicLayoutEffect(() => {}, dependencies);\n`,
    );
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { useDocumentEvents } from "./use-document-events";\nexport const App = () => { useDocumentEvents([]); return null; };\n`,
    );

    const trace = collectFor(appPath, affectedRuleIds);
    expect(trace?.contentPaths.has(fixturePath("src/use-document-events.ts"))).toBe(true);
    expect(trace?.contentPaths.has(fixturePath("src/use-isomorphic-layout-effect.ts"))).toBe(true);
  });
});

describe("nextjs collectors", () => {
  it("records ancestor layout probes for a page file only", () => {
    writeFixtureFile("app/layout.tsx", "export default ({ children }) => children;\n");
    const pagePath = writeFixtureFile("app/products/page.tsx", "export default () => <div />;\n");
    const componentPath = writeFixtureFile(
      "app/products/list.tsx",
      "export const List = () => <div />;\n",
    );

    const pageTrace = collectFor(pagePath, ["nextjs-missing-metadata"]);
    expect(pageTrace?.contentPaths.has(fixturePath("app/products/layout.tsx"))).toBe(true);
    expect(pageTrace?.contentPaths.has(fixturePath("app/layout.tsx"))).toBe(true);

    const componentTrace = collectFor(componentPath, ["nextjs-missing-metadata"]);
    expect(componentTrace?.contentPaths.size).toBe(0);
  });

  it("resolves imported components for a page without an ancestor Suspense layout", () => {
    writeFixtureFile("app/results.tsx", "export const Results = () => <div />;\n");
    const pagePath = writeFixtureFile(
      "app/page.tsx",
      `import { Results } from "./results";\nexport default () => <Results />;\n`,
    );
    const trace = collectFor(pagePath, ["nextjs-no-use-search-params-without-suspense"]);
    expect(trace?.contentPaths.has(fixturePath("app/results.tsx"))).toBe(true);
    // The layout candidates were probed on the walk (absent → content "absent").
    expect(trace?.contentPaths.has(fixturePath("app/layout.tsx"))).toBe(true);
  });
});

describe("react-native collectors", () => {
  it("records the package.json walk for every file (the wrapper gate)", () => {
    writeFixtureFile("package.json", `{ "dependencies": { "expo": "^50.0.0" } }\n`);
    const appPath = writeFixtureFile("src/App.tsx", "export const App = () => null;\n");
    const trace = collectFor(appPath, ["rn-prefer-expo-image"]);
    expect(trace?.contentPaths.has(fixturePath("package.json"))).toBe(true);
    expect(trace?.existencePaths.has(fixturePath("src/package.json"))).toBe(true);

    // Re-collecting the same file hits the MEMOIZED directory walk — the
    // memo hit must regenerate the walk's probes, not swallow them.
    const repeatTrace = collectFor(appPath, ["rn-prefer-expo-image"]);
    expect(repeatTrace?.contentPaths.has(fixturePath("package.json"))).toBe(true);
    expect(repeatTrace?.existencePaths.has(fixturePath("src/package.json"))).toBe(true);
  });

  it("resolves imported components rendered as JSX for rn-no-raw-text", () => {
    writeFixtureFile("package.json", `{ "dependencies": { "react-native": "0.74.0" } }\n`);
    writeFixtureFile(
      "src/Banner.tsx",
      "export const Banner = ({ children }) => <>{children}</>;\n",
    );
    writeFixtureFile("src/helper.ts", "export const helper = () => 1;\n");
    const appPath = writeFixtureFile(
      "src/App.tsx",
      `import { Banner } from "./Banner";\nimport { helper } from "./helper";\nexport const App = () => <Banner>hi {helper()}</Banner>;\n`,
    );
    const trace = collectFor(appPath, ["rn-no-raw-text"]);
    expect(trace?.contentPaths.has(fixturePath("src/Banner.tsx"))).toBe(true);
    // Imported but never rendered as JSX → not consulted by the rule's
    // element resolution, so not a dependency.
    expect(trace?.contentPaths.has(fixturePath("src/helper.ts"))).toBe(false);
  });
});

describe("collector registry", () => {
  it("classifies every cross-file rule as bounded or unbounded", () => {
    expect(
      [...CROSS_FILE_DEPENDENCY_COLLECTORS.keys(), ...UNBOUNDED_CROSS_FILE_RULE_IDS].sort(),
    ).toEqual([...CROSS_FILE_RULE_IDS].sort());
  });
});
