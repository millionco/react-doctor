import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-derived-state-effect");

describe("no-derived-state-effect (memo-message branch)", () => {
  it("flags an expensive derivation with a useMemo recommendation", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#caching-expensive-calculations
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-memo", {
      files: {
        "src/TodoList.tsx": `import { useEffect, useState } from "react";

declare const getFilteredTodos: (todos: string[], filter: string) => string[];

export const TodoList = ({ todos, filter }: { todos: string[]; filter: string }) => {
  const [visibleTodos, setVisibleTodos] = useState<string[]>([]);
  useEffect(() => {
    setVisibleTodos(getFilteredTodos(todos, filter));
  }, [todos, filter]);

  return <div>{visibleTodos.length}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useMemo");
  });

  it("keeps the 'compute during render' message for trivial derivations", async () => {
    // https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-trivial", {
      files: {
        "src/Form.tsx": `import { useEffect, useState } from "react";

export const Form = () => {
  const [firstName] = useState("Taylor");
  const [lastName] = useState("Swift");
  const [fullName, setFullName] = useState("");
  useEffect(() => {
    setFullName(firstName + " " + lastName);
  }, [firstName, lastName]);
  return <div>{fullName}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("still uses the 'state reset' message when no dep is referenced", async () => {
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-reset", {
      files: {
        "src/ProfilePage.tsx": `import { useEffect, useState } from "react";

export const ProfilePage = ({ userId }: { userId: string }) => {
  const [comment, setComment] = useState("");
  useEffect(() => {
    setComment("");
  }, [userId]);
  return <textarea value={comment} onChange={(event) => setComment(event.target.value)} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("key prop");
  });

  it("treats coercion helpers (Number, parseInt) as trivial", async () => {
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-coercion", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ raw }: { raw: string }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(Number(raw));
  }, [raw]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("flags `Math.floor(raw)` and treats it as a trivial derivation (Bugbot #153 round 2)", async () => {
    // Regression: \`Math.floor(raw)\` previously bailed the rule
    // entirely — \`collectValueIdentifierNames\` collected "Math" as
    // a reactive read, "Math" wasn't in deps, allArgumentsDeriveFromDeps
    // went false, no diagnostic. The chain root is now skipped when
    // it's a built-in global namespace, and the call is trivial.
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-math-floor", {
      files: {
        "src/Counter.tsx": `import { useEffect, useState } from "react";

export const Counter = ({ raw }: { raw: number }) => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(Math.floor(raw));
  }, [raw]);
  return <span>{count}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("compute during render");
    expect(hits[0].message).not.toContain("useMemo");
  });

  it("flags `setX(applyFilters())` as expensive, not as a state reset (Bugbot #153 round 2)", async () => {
    // Regression: zero-arg call \`applyFilters()\` produced an empty
    // identifier list, both .some() checks vacuously passed, and the
    // rule fired with the wrong "state reset" message. Now the
    // callee identifier is collected so the dep mismatch correctly
    // bails or — in this case — is recognized as expensive (because
    // \`applyFilters\` isn't in TRIVIAL_DERIVATION_CALLEE_NAMES) AND
    // referenced via deps (\`filter\`).
    const projectDir = setupReactProject(tempRoot, "no-derived-state-effect-zero-arg-call", {
      files: {
        "src/TodoList.tsx": `import { useEffect, useState } from "react";

declare const applyFilters: (todos: string[]) => string[];

export const TodoList = ({ todos, filter }: { todos: string[]; filter: string }) => {
  const [visible, setVisible] = useState<string[]>([]);
  useEffect(() => {
    setVisible(applyFilters(todos));
  }, [todos, filter]);
  return <div>{visible.length}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-derived-state-effect");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).not.toContain("key prop");
    expect(hits[0].message).toContain("useMemo");
  });
});
