import { describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject } from "../_helpers.js";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-derived-state-effect");

describe("editable native state with default derived-state sibling rules", () => {
  it.each([
    { name: "matched", inactiveAncestor: false, copyPlacement: "none", primary: 0, companion: 0 },
    {
      name: "unsupported renderer",
      inactiveAncestor: true,
      copyPlacement: "none",
      primary: 1,
      companion: 1,
    },
    {
      name: "independent copy last",
      inactiveAncestor: false,
      copyPlacement: "last",
      primary: 1,
      companion: 1,
    },
    {
      name: "independent copy first",
      inactiveAncestor: false,
      copyPlacement: "first",
      primary: 1,
      companion: 1,
    },
  ])("$name", async ({ name, inactiveAncestor, copyPlacement, primary, companion }) => {
    const projectDir = setupReactProject(tempRoot, name.replaceAll(" ", "-"), {
      files: {
        "src/EditablePanel.tsx": `import { useEffect, useRef, useState } from "react";
export const Panel = ({ seed, label }) => {
  const [value, setValue] = useState(seed);
  const [caption, setCaption] = useState(label);
  const writeValue = (nextValue) => setValue(nextValue);
  const latest = useRef({ writeValue });
  latest.current = { writeValue };
  const activate = (event) => { event.preventDefault(); writeValue(!value); };
  useEffect(() => {
    ${copyPlacement === "first" ? "setCaption(label);" : ""}
    setValue(seed);
    ${copyPlacement === "last" ? "setCaption(label);" : ""}
  }, [seed${copyPlacement !== "none" ? ", label" : ""}]);
  return ${inactiveAncestor ? "<noscript>" : "<section>"}<button onClick={activate}>{String(value)}{caption}</button>${inactiveAncestor ? "</noscript>" : "</section>"};
};`,
      },
    });
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });
    const primaryDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.rule === "no-derived-state",
    );
    expect(primaryDiagnostics).toHaveLength(primary);
    expect(
      diagnostics.filter((diagnostic) => diagnostic.rule === "no-derived-state-effect"),
    ).toHaveLength(companion);
    if (copyPlacement !== "none") {
      expect(primaryDiagnostics[0]?.message).toContain('"caption"');
    }
  });
});

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
