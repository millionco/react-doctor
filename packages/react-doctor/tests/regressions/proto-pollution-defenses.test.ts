/**
 * Regression tests for the prototype-pollution defenses added to every
 * rule that does `OBJECT[someAstName]` lookups.
 *
 * The original blocker hit was `no-legacy-class-lifecycles` flagging
 * EVERY `class { constructor() {} }` because
 * `LEGACY_LIFECYCLE_REPLACEMENTS["constructor"]` falls through to
 * `Object.prototype.constructor` (the native `Object` function — truthy,
 * bypassing the `if (!replacement)` guard). The same shape exists in:
 *   - `rn-no-deprecated-modules` (Map of imported names -> replacement)
 *   - `no-side-tab-border` (Map of border CSS keys -> side label)
 *   - `no-prevent-default` (Map of JSX tag name -> event prop list)
 *
 * Each rule is now backed by a `Map.get()` lookup so the prototype chain
 * can never leak through. These tests pin the defense.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-proto-defenses-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("rn-no-deprecated-modules — prototype-pollution defense", () => {
  it("does NOT flag `import { constructor } from 'react-native'` (or other Object.prototype names)", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-deprecated-proto-import", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/index.ts": `import { constructor, toString, hasOwnProperty } from "react-native";

void constructor;
void toString;
void hasOwnProperty;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rn-no-deprecated-modules", {
      framework: "react-native",
    });
    expect(hits).toHaveLength(0);
  });

  it("STILL flags a real removed RN export (`AsyncStorage`)", async () => {
    const projectDir = setupReactProject(tempRoot, "rn-deprecated-real-hit", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      },
      files: {
        "src/index.ts": `import { AsyncStorage } from "react-native";

void AsyncStorage;
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rn-no-deprecated-modules", {
      framework: "react-native",
    });
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("AsyncStorage");
  });
});

describe("no-prevent-default — prototype-pollution defense", () => {
  it("does NOT flag a JSX tag whose name shadows an Object.prototype property", async () => {
    const projectDir = setupReactProject(tempRoot, "prevent-default-proto-tag", {
      files: {
        "src/Custom.tsx": `export const Custom = () => (
  // @ts-expect-error custom intrinsic with a clashing name
  <constructor onSubmit={(event) => { event.preventDefault(); }} />
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prevent-default");
    expect(hits).toHaveLength(0);
  });

  it("STILL flags preventDefault on a real `<form>` onSubmit handler", async () => {
    const projectDir = setupReactProject(tempRoot, "prevent-default-real-form", {
      files: {
        "src/SignUp.tsx": `export const SignUp = () => (
  <form onSubmit={(event) => { event.preventDefault(); }}>
    <input />
  </form>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prevent-default");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("no-side-tab-border — prototype-pollution defense", () => {
  it("does NOT flag an inline-style key whose name shadows an Object.prototype property", async () => {
    const projectDir = setupReactProject(tempRoot, "side-tab-border-proto-key", {
      files: {
        "src/Card.tsx": `export const Card = () => (
  <div style={{ constructor: "4px solid red", toString: "blue" } as any} />
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-side-tab-border");
    expect(hits).toHaveLength(0);
  });

  it("STILL flags a real `borderLeft: 4px solid` style", async () => {
    const projectDir = setupReactProject(tempRoot, "side-tab-border-real", {
      files: {
        "src/Card.tsx": `export const Card = () => (
  <div style={{ borderLeft: "4px solid #00f" }} />
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-side-tab-border");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
