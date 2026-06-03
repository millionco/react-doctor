/**
 * Regression tests for the "empty-frame-as-barrier" semantic in the
 * shared prop-stack scaffolding used by all four `createComponentPropStackTracker`
 * consumers (`no-derived-useState`, `no-prop-callback-in-effect`,
 * `no-mirror-prop-effect`, `prefer-use-effect-event`). The visitor pushes
 * an empty `Set` when entering a non-component FunctionDeclaration /
 * ArrowFunctionExpression so identifiers inside the helper don't resolve
 * against an outer component's props (a closed-over `value` is NOT a
 * prop of the helper).
 *
 * The original `isPropName` walked the entire stack without honoring
 * the barrier, so a useState / useEffect inside a nested helper would
 * pick up the outer component's prop names and produce false positives.
 */

import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prop-stack-barrier-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

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

  it("flags `if (didChange) onChange(state)` inside a control-flow descendant (deep-walk regression)", async () => {
    // Regression: previously only top-level statements of the effect
    // body were inspected. The "lift state via callback" anti-pattern
    // frequently lives behind a guard — that case was a silent FN.
    const projectDir = setupReactProject(tempRoot, "no-prop-callback-deep-walk", {
      files: {
        "src/Toggle.tsx": `import { useEffect, useState } from "react";

export const Toggle = ({ onChange }: { onChange: (next: boolean) => void }) => {
  const [isOn, setIsOn] = useState(false);
  useEffect(() => {
    if (isOn) {
      onChange(isOn);
    }
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

  it("does NOT flag `setTimeout(() => onChange(state))` (sub-handler belongs to prefer-use-effect-event, not this rule)", async () => {
    // Sub-handler reads are the domain of `prefer-use-effect-event`.
    // The deep-walk MUST stop at function boundaries so they don't
    // double-fire here.
    const projectDir = setupReactProject(tempRoot, "no-prop-callback-no-subhandler", {
      files: {
        "src/Debounced.tsx": `import { useEffect, useState } from "react";

export const Debounced = ({ onChange }: { onChange: (next: string) => void }) => {
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

    const hits = await collectRuleHits(projectDir, "no-prop-callback-in-effect");
    expect(hits).toHaveLength(0);
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

describe("no-mirror-prop-effect — empty-frame barrier", () => {
  it("flags the canonical `useEffect(setDraft(value), [value])` shape", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-real-prop", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return <input value={draft} onChange={(event) => setDraft(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("value");
  });

  it("does NOT flag the same mirror shape when it lives inside a nested helper", async () => {
    // The barrier must hide `Outer`'s `value` prop from the inner
    // helper. Without the barrier the closed-over `value` would
    // resolve as a prop of the helper and the mirror check would
    // false-positive.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ value }: { value: string }) => {
  function inner() {
    const [draft, setDraft] = useState(value);
    useEffect(() => {
      setDraft(value);
    }, [value]);
    void draft;
  }
  inner();
  return <span>{value}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });
});

describe("prefer-use-effect-event — empty-frame barrier", () => {
  it("flags the canonical sub-handler-only prop read shape", async () => {
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-real-prop", {
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

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((hit) => hit.message.includes("onChange"))).toBe(true);
  });

  it("does NOT flag the same shape when it lives inside a nested helper", async () => {
    // Outer's `onChange` prop must not leak into the helper's
    // dep-classification logic.
    const projectDir = setupReactProject(tempRoot, "prefer-use-effect-event-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ onChange }: { onChange: (value: string) => void }) => {
  function inner() {
    const [text, setText] = useState("");
    useEffect(() => {
      const id = setTimeout(() => onChange(text), 300);
      return () => clearTimeout(id);
    }, [text, onChange]);
    void setText;
  }
  inner();
  return <span />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-use-effect-event");
    expect(hits).toHaveLength(0);
  });
});
