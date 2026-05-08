/**
 * Regression tests for the "empty-frame-as-barrier" semantic in the
 * shared prop-stack scaffolding used by `no-prop-callback-in-effect`
 * and `no-derived-useState`. The visitor pushes an empty `Set` when
 * entering a non-component FunctionDeclaration / ArrowFunctionExpression
 * so identifiers inside the helper don't resolve against an outer
 * component's props (a closed-over `value` is NOT a prop of the
 * helper).
 *
 * The original `isPropName` walked the entire stack without honoring
 * the barrier, so a useState / useEffect inside a nested helper would
 * pick up the outer component's prop names and produce false positives.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "../../src/utils/run-oxlint.js";
import { setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prop-stack-barrier-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const collectRuleHits = async (
  projectDir: string,
  ruleId: string,
): Promise<Array<{ filePath: string; message: string }>> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    hasTypeScript: true,
    framework: "unknown",
    hasReactCompiler: false,
    hasTanStackQuery: false,
  });
  return diagnostics
    .filter((diagnostic) => diagnostic.rule === ruleId)
    .map((diagnostic) => ({
      filePath: diagnostic.filePath,
      message: diagnostic.message,
    }));
};

describe("no-derived-useState — empty-frame barrier", () => {
  it("flags `useState(value)` when `value` is a real prop of the current component", async () => {
    const projectDir = setupReactProject(tempRoot, "no-derived-usestate-real-prop", {
      files: {
        "src/Field.tsx": `import { useState } from "react";

export const Field = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-useState");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("value");
  });

  it("does NOT flag `useState(value)` when `value` is closed over from an outer component", async () => {
    // The inner FunctionDeclaration pushes an empty barrier frame; the
    // barrier-aware isPropName must stop the walk there and not see
    // Outer's prop set.
    const projectDir = setupReactProject(tempRoot, "no-derived-usestate-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useState } from "react";

export const Outer = ({ value }: { value: string }) => {
  function inner() {
    const [draft, setDraft] = useState(value);
    void draft;
    void setDraft;
  }
  inner();
  return <span>{value}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-useState");
    expect(hits).toHaveLength(0);
  });
});

describe("no-prop-callback-in-effect — empty-frame barrier", () => {
  it("flags the canonical `useEffect(() => onChange(state), [state, onChange])` shape", async () => {
    const projectDir = setupReactProject(tempRoot, "no-prop-callback-real-prop", {
      files: {
        "src/Toggle.tsx": `import { useEffect, useState } from "react";

export const Toggle = ({ onChange }: { onChange: (next: boolean) => void }) => {
  const [isOn, setIsOn] = useState(false);
  useEffect(() => {
    onChange(isOn);
  }, [isOn, onChange]);
  return <button onClick={() => setIsOn(!isOn)}>{isOn ? "on" : "off"}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-callback-in-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("onChange");
  });

  it("does NOT flag `useEffect(() => onChange(state), [state, onChange])` inside a nested helper", async () => {
    // Same nested-helper shape — the outer component's `onChange` prop
    // must not leak into the helper's effect-callback check.
    const projectDir = setupReactProject(tempRoot, "no-prop-callback-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ onChange }: { onChange: (next: boolean) => void }) => {
  function inner() {
    const [isOn, setIsOn] = useState(false);
    useEffect(() => {
      onChange(isOn);
    }, [isOn, onChange]);
    void setIsOn;
  }
  inner();
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-prop-callback-in-effect");
    expect(hits).toHaveLength(0);
  });
});
