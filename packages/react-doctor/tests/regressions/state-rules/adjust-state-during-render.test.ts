/**
 * Regression: React's "adjust state while rendering" / "store information
 * from previous renders" pattern must not be flagged.
 *
 * Surfaced by the Harbor `bench-all-20260629-202930` corpus, where the
 * `rerender-state-only-in-handlers` and `no-derived-useState` rules both
 * fired on test-passing solutions that used the canonical pattern from
 * https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
 *
 *   const [prevValue, setPrevValue] = useState(value);
 *   if (prevValue !== value) {
 *     setPrevValue(value);
 *     setSelected(value ?? null);
 *   }
 *
 * `prevValue` is read in a render-phase guard and re-synced by calling its
 * setter during render — it is neither write-only (so `useRef` advice is
 * wrong) nor a stale prop copy (the guard keeps it fresh every render).
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "../_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-adjust-during-render-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const ADJUST_DURING_RENDER_SOURCE = `import { useState } from "react";

export const RadioGroup = ({ value }: { value?: string }) => {
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [prevValue, setPrevValue] = useState(value);

  if (prevValue !== value) {
    setPrevValue(value);
    setSelectedValue(value ?? null);
  }

  return <div role="radiogroup">{selectedValue}</div>;
};
`;

describe("adjust state during render — no false positives", () => {
  it("does NOT flag rerender-state-only-in-handlers on the prev-value guard", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-prev-value", {
      files: { "src/radio-group.tsx": ADJUST_DURING_RENDER_SOURCE },
    });
    const hits = await collectRuleHits(projectDir, "rerender-state-only-in-handlers");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag no-derived-useState on the prev-value guard", async () => {
    const projectDir = setupReactProject(tempRoot, "derived-prev-value", {
      files: { "src/radio-group.tsx": ADJUST_DURING_RENDER_SOURCE },
    });
    const hits = await collectRuleHits(projectDir, "no-derived-useState");
    expect(hits).toHaveLength(0);
  });

  it("DOES still flag no-derived-useState when a prop is copied without a render-phase re-sync", async () => {
    const projectDir = setupReactProject(tempRoot, "derived-stale-copy", {
      files: {
        "src/profile.tsx": `import { useState } from "react";

export const Profile = ({ name }: { name: string }) => {
  const [draftName, setDraftName] = useState(name);
  return <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />;
};
`,
      },
    });
    const hits = await collectRuleHits(projectDir, "no-derived-useState");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("DOES still flag rerender-state-only-in-handlers when state is only set in a handler", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-handler-only", {
      files: {
        "src/tracker.tsx": `import { useState } from "react";

declare const track: (value: number) => void;

export const Tracker = () => {
  const [count, setCount] = useState(0);
  return (
    <button
      onClick={() => {
        track(count);
        setCount(count + 1);
      }}
    >
      Bump
    </button>
  );
};
`,
      },
    });
    const hits = await collectRuleHits(projectDir, "rerender-state-only-in-handlers");
    expect(hits.length).toBeGreaterThan(0);
  });
});
