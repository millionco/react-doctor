import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-derived-state-effect");

describe("no-derived-state-effect render-source contract", () => {
  it("stays silent for an opaque external derivation", async () => {
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
    expect(hits).toEqual([]);
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
    expect(hits[0].message).toContain("you can derive from other values");
    expect(hits[0].message).not.toContain("state derived from other values");
  });

  it("stays silent for a constant reset with an independent input writer", async () => {
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
    expect(hits).toEqual([]);
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
    expect(hits[0].message).toContain("you can derive from other values");
    expect(hits[0].message).not.toContain("state derived from other values");
  });

  it("flags `Math.floor(raw)` and treats it as a trivial derivation (Bugbot #153 round 2)", async () => {
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
    expect(hits[0].message).toContain("you can derive from other values");
    expect(hits[0].message).not.toContain("state derived from other values");
  });

  it("stays silent for an opaque external call even when its argument is render-known", async () => {
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
    expect(hits).toEqual([]);
  });
});
