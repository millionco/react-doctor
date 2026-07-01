import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-architecture-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
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
