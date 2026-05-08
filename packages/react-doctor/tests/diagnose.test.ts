import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-diagnose-api-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("diagnose() programmatic API", () => {
  // Regression: pre-fix the programmatic `diagnose()` entry forgot to
  // forward `reactMajorVersion` to `runOxlint`. After the directional
  // version-gating change, that meant every "prefer-newer-api" rule
  // (today: `prefer-use-effect-event`) was silently skipped for all
  // programmatic API consumers, even on React 19+ projects. The CLI
  // entry (`scan.ts`) was unaffected because it always passed the
  // version explicitly.
  it("emits prefer-use-effect-event diagnostics on a React 19 project (the prefer-newer-api version-gated rule fires)", async () => {
    const projectDir = setupReactProject(tempRoot, "diagnose-prefer-use-effect-event-fires", {
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ onChange }: { onChange: (value: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return <input value={text} onChange={(event) => setText(event.target.value)} />;
};
`,
      },
    });

    const result = await diagnose(projectDir, { lint: true, deadCode: false });
    const preferUseEffectEventHits = result.diagnostics.filter(
      (diagnostic) => diagnostic.rule === "prefer-use-effect-event",
    );
    expect(preferUseEffectEventHits.length).toBeGreaterThanOrEqual(1);
  });

  it("skips prefer-use-effect-event when the project's React version cannot be resolved (no react dep)", async () => {
    // Symmetric guard: when the project has no React dependency the
    // function throws before lint runs, so we synthesize a project
    // with an unresolvable React version range. Its major can't be
    // parsed, so `parseReactMajor` returns null and the prefer-newer-
    // api rule should be skipped pessimistically — confirming the
    // forward really is honoring the version-gate boundary.
    const projectDir = setupReactProject(tempRoot, "diagnose-prefer-use-effect-event-skipped", {
      reactVersion: "github:facebook/react",
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ onChange }: { onChange: (value: string) => void }) => {
  const [text, setText] = useState("");
  useEffect(() => {
    const id = setTimeout(() => onChange(text), 300);
    return () => clearTimeout(id);
  }, [text, onChange]);
  return <input value={text} onChange={(event) => setText(event.target.value)} />;
};
`,
      },
    });

    const result = await diagnose(projectDir, { lint: true, deadCode: false });
    const preferUseEffectEventHits = result.diagnostics.filter(
      (diagnostic) => diagnostic.rule === "prefer-use-effect-event",
    );
    expect(preferUseEffectEventHits).toHaveLength(0);
  });
});
