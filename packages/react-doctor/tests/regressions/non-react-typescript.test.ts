import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, writeFile } from "./_helpers.js";

// Regression coverage for scanning a plain TypeScript / JavaScript project
// that has NO React dependency. React Doctor should run its framework-
// agnostic rules there (the project still benefits from the security,
// bundle-size, and js-performance checks) while keeping every React-flavoured
// rule off — a function named `useThing` or a nested PascalCase helper is just
// ordinary code without React, so the hook / component heuristics would
// otherwise false-fire. The `react` capability (set only when React or Preact
// is present) is the gate; `reactMajorVersion: null` here models its absence.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-non-react-ts-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const setupTypeScriptProject = (caseId: string, files: Record<string, string>): string => {
  const projectDir = path.join(tempRoot, caseId);
  fs.mkdirSync(projectDir, { recursive: true });
  writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify({ name: caseId, version: "1.0.0" }),
  );
  for (const [relativePath, content] of Object.entries(files)) {
    writeFile(path.join(projectDir, relativePath), content);
  }
  return projectDir;
};

describe("non-React TypeScript scanning", () => {
  it("does not flag a local `useEffect()` call as a hook (rules-of-hooks gated)", async () => {
    const projectDir = setupTypeScriptProject("rules-of-hooks-no-react", {
      "src/index.ts": `const useEffect = (fn: () => void, _deps: unknown[]) => fn();
if (Math.random() > 0.5) {
  useEffect(() => {}, []);
}
export const ok = true;
`,
    });

    const hits = await collectRuleHits(projectDir, "rules-of-hooks", { reactMajorVersion: null });
    expect(hits).toHaveLength(0);
  });

  it("does not flag a non-React class with lifecycle-named methods (no-legacy-class-lifecycles gated)", async () => {
    const projectDir = setupTypeScriptProject("legacy-lifecycles-no-react", {
      "src/store.ts": `export class Store {
  componentWillMount() { return 1; }
  UNSAFE_componentWillUpdate() { return 2; }
}
`,
    });

    const hits = await collectRuleHits(projectDir, "no-legacy-class-lifecycles", {
      reactMajorVersion: null,
    });
    expect(hits).toHaveLength(0);
  });

  it("does not flag a nested PascalCase helper as a component (no-nested-component-definition gated)", async () => {
    const projectDir = setupTypeScriptProject("nested-component-no-react", {
      "src/index.ts": `export function Outer() {
  function Inner() {
    return 1;
  }
  return Inner();
}
`,
    });

    const hits = await collectRuleHits(projectDir, "no-nested-component-definition", {
      reactMajorVersion: null,
    });
    expect(hits).toHaveLength(0);
  });

  it("still runs framework-agnostic rules (no-full-lodash-import fires without React)", async () => {
    const projectDir = setupTypeScriptProject("agnostic-rule-no-react", {
      "src/index.ts": `import _ from "lodash";
export const cloned = _.cloneDeep({ a: 1 });
`,
    });

    const hits = await collectRuleHits(projectDir, "no-full-lodash-import", {
      reactMajorVersion: null,
    });
    expect(hits.length).toBeGreaterThan(0);
  });

  it("re-enables the React rule once React is present (gate is React-conditional, not removed)", async () => {
    const projectDir = setupTypeScriptProject("nested-component-with-react", {
      "src/app.tsx": `export function Outer() {
  function Inner() {
    return 1;
  }
  return Inner();
}
`,
    });

    const hits = await collectRuleHits(projectDir, "no-nested-component-definition", {
      reactMajorVersion: 19,
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});
