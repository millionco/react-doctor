import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-mirror-prop-effect");

describe("no-mirror-prop-effect", () => {
  it("flags the canonical `useState(prop) + useEffect(setX(prop), [prop])` shape", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-canonical", {
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
    expect(hits[0].message).toContain("draft");
    expect(hits[0].message).toContain("value");
  });

  it("does NOT flag a multi-dep mirror when the prop root is NOT one of the deps (FP guard for L1)", async () => {
    // Regression / FP guard: L1 widened the deps check from
    // "exactly one dep" to "any deps including the prop root". Without
    // the `depIdentifierNames.has(propRootName)` clause this would
    // false-positive on effects that mention the setter+value but
    // are actually keyed off something else entirely.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-prop-not-in-deps", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ value, theme }: { value: string; theme: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [theme]);
  return <input value={draft} data-theme={theme} onChange={(event) => setDraft(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("flags the multi-dep mirror shape `useEffect(setX(value), [value, otherDep])`", async () => {
    // Regression: previously required EXACTLY one dep, missing the
    // common case where the mirror effect lists additional deps for
    // exhaustive-deps compliance. The mirror anti-pattern still
    // applies — `value` is mirrored even if `otherDep` is co-listed.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-multi-deps", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = ({ value, theme }: { value: string; theme: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value, theme]);
  return <input value={draft} data-theme={theme} onChange={(event) => setDraft(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("draft");
    expect(hits[0].message).toContain("value");
  });

  it("flags the MemberExpression variant `useState(prop.x) + setDraft(prop.x)`", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-member", {
      files: {
        "src/Profile.tsx": `import { useEffect, useState } from "react";

interface User { name: string }

export const Profile = ({ user }: { user: User }) => {
  const [draftName, setDraftName] = useState(user.name);
  useEffect(() => {
    setDraftName(user.name);
  }, [user]);
  return <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("draftName");
    expect(hits[0].message).toContain("user");
  });

  it("does NOT flag a `useState(prop)` without a paired mirror effect (uncontrolled-with-key shape)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-uncontrolled", {
      files: {
        "src/Field.tsx": `import { useState } from "react";

export const Field = ({ initialValue }: { initialValue: string }) => {
  const [value, setValue] = useState(initialValue);
  return <input value={value} onChange={(event) => setValue(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `useEffect(() => setX(value), [value])` without a paired `useState(value)` mirror", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-no-paired", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ value }: { value: string }) => {
  const [doubled, setDoubled] = useState("");
  useEffect(() => {
    setDoubled(value + value);
  }, [value]);
  return <span>{doubled}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag when the useState initializer doesn't match the setter argument", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-mismatch", {
      files: {
        "src/Mismatch.tsx": `import { useEffect, useState } from "react";

export const Mismatch = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);
  return <span>{draft}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(0);
  });

  it("flags a method-call mirror — `useState(value.toUpperCase())` paired with `setX(value.toUpperCase())`", async () => {
    // `getPropRootName` now follows call chains so a prop-rooted
    // method call counts as the prop root, and the structural-
    // equality check uses the shared helper that handles
    // CallExpression. Both upgrades are required to detect this
    // shape — the previous narrow local helper missed it silently.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-method-call", {
      files: {
        "src/Capitalize.tsx": `import { useEffect, useState } from "react";

export const Capitalize = ({ value }: { value: string }) => {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);
  return <span>{draft}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mirror-prop-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("draft");
    expect(hits[0].message).toContain("value");
  });

  it("does NOT flag a useEffect inside a nested helper that closes over an outer prop", async () => {
    // The inner helper isn't a component; its mirror-shape useState +
    // useEffect uses `value` from Outer's closure, not its own props.
    // The outer prop set must NOT leak into Inner's lookup.
    const projectDir = setupReactProject(tempRoot, "no-mirror-prop-effect-nested-helper", {
      files: {
        "src/Outer.tsx": `import { useEffect, useState } from "react";

export const Outer = ({ value }: { value: string }) => {
  function inner() {
    const [draft, setDraft] = useState(value);
    useEffect(() => {
      setDraft(value);
    }, [value]);
    void draft;
    void setDraft;
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
