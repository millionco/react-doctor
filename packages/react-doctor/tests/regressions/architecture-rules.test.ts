import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-architecture-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// `react-compiler-destructure-method` is currently un-registered in
// `rule-registry.ts` — the React-Compiler memoization premise didn't
// hold up for the canonical hooks it targeted (`useRouter`,
// `useSearchParams`, `useNavigation`), all of which return stable
// references. The rule implementation and these regression suites are
// kept intact so re-registering the rule re-enables coverage in one
// diff; switch this back to `describe(...)` when that happens.
describe.skip("react-compiler-destructure-method", () => {
  it("does not flag React Navigation methods", async () => {
    const projectDir = setupReactProject(tempRoot, "react-navigation-methods", {
      files: {
        "src/Screen.tsx": `import { useNavigation } from "@react-navigation/native";

declare function useRouter(): {
  push: (path: string) => void;
};

declare module "@react-navigation/native" {
  export function useNavigation(): {
    navigate: (screen: string, params?: { sessionId: string }) => void;
  };
}

export const WebRouteButton = () => {
  const router = useRouter();
  return <button onClick={() => router.push("/home")}>Go home</button>;
};

export const NativeRouteButton = () => {
  const navigation = useNavigation();
  return (
    <button onClick={() => navigation.navigate("Chat", { sessionId: "abc" })}>
      Open chat
    </button>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useRouter");
    expect(hits[0].message).not.toContain("useNavigation");
  });

  it("does not flag React Navigation core methods", async () => {
    const projectDir = setupReactProject(tempRoot, "react-navigation-core-methods", {
      files: {
        "src/Screen.tsx": `import { useNavigation } from "@react-navigation/core";

declare module "@react-navigation/core" {
  export function useNavigation(): {
    dispatch: (action: { type: string }) => void;
  };
}

export const NativeRouteButton = () => {
  const navigation = useNavigation();
  return <button onClick={() => navigation.dispatch({ type: "GO_BACK" })}>Back</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(0);
  });

  it("still flags non-React-Navigation useNavigation hooks", async () => {
    const projectDir = setupReactProject(tempRoot, "custom-use-navigation-methods", {
      files: {
        "src/Screen.tsx": `declare function useNavigation(): {
  navigate: (screen: string, params?: { sessionId: string }) => void;
};

export const RouteButton = () => {
  const navigation = useNavigation();
  return (
    <button onClick={() => navigation.navigate("Chat", { sessionId: "abc" })}>
      Open chat
    </button>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useNavigation");
  });
});

describe("react-compiler-no-manual-memoization", () => {
  it("flags useMemo, useCallback, and memo when React Compiler is enabled", async () => {
    const projectDir = setupReactProject(tempRoot, "manual-memoization-with-compiler", {
      files: {
        "src/Widget.tsx": `import { memo, useCallback, useMemo } from "react";

interface WidgetProps {
  items: ReadonlyArray<{ id: string; label: string }>;
  onSelect: (id: string) => void;
}

export const Widget = memo(({ items, onSelect }: WidgetProps) => {
  const sortedItems = useMemo(() => [...items].sort(), [items]);
  const handleClick = useCallback((id: string) => onSelect(id), [onSelect]);
  return (
    <ul>
      {sortedItems.map((entry) => (
        <li key={entry.id} onClick={() => handleClick(entry.id)}>
          {entry.label}
        </li>
      ))}
    </ul>
  );
});
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-no-manual-memoization", {
      hasReactCompiler: true,
    });
    const messages = hits.map((hit) => hit.message);
    expect(messages).toHaveLength(3);
    expect(messages.some((message) => message.includes("useMemo"))).toBe(true);
    expect(messages.some((message) => message.includes("useCallback"))).toBe(true);
    expect(messages.some((message) => message.includes("memo()"))).toBe(true);
  });

  it("matches React.useMemo / React.useCallback / React.memo namespace calls", async () => {
    const projectDir = setupReactProject(tempRoot, "manual-memoization-namespaced", {
      files: {
        "src/Counter.tsx": `import * as React from "react";

interface CounterProps {
  initial: number;
}

export const Counter = React.memo(({ initial }: CounterProps) => {
  const doubled = React.useMemo(() => initial * 2, [initial]);
  const noop = React.useCallback(() => undefined, []);
  return <button onClick={noop}>{doubled}</button>;
});
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-no-manual-memoization", {
      hasReactCompiler: true,
    });
    expect(hits).toHaveLength(3);
  });

  it("does not flag manual memoization when React Compiler is disabled", async () => {
    const projectDir = setupReactProject(tempRoot, "manual-memoization-no-compiler", {
      files: {
        "src/Widget.tsx": `import { useMemo } from "react";

export const Widget = ({ items }: { items: ReadonlyArray<string> }) => {
  const sortedItems = useMemo(() => [...items].sort(), [items]);
  return <ul>{sortedItems.map((label) => <li key={label}>{label}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-no-manual-memoization", {
      hasReactCompiler: false,
    });
    expect(hits).toHaveLength(0);
  });

  it("does not flag userland helpers that share React-hook names", async () => {
    const projectDir = setupReactProject(tempRoot, "manual-memoization-userland-helpers", {
      files: {
        "src/use-memo.ts": `export const useMemo = <Value,>(compute: () => Value): Value => compute();
export const useCallback = <Fn extends (...args: never[]) => unknown>(fn: Fn): Fn => fn;
export const memo = <Component,>(component: Component): Component => component;
`,
        "src/Widget.tsx": `import { memo, useCallback, useMemo } from "./use-memo";

export const Widget = memo(() => {
  const value = useMemo(() => 1);
  const handler = useCallback(() => undefined);
  return <button onClick={handler}>{value}</button>;
});
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-no-manual-memoization", {
      hasReactCompiler: true,
    });
    expect(hits).toHaveLength(0);
  });
});
