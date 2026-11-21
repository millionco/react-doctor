import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const stock = `import { useCallback, type DependencyList } from "react";

type CallbackRef = ((element: HTMLDivElement | null) => void) & { current: HTMLDivElement | null };

function useTrackedNode(onNode: (element: HTMLDivElement | null) => void, deps: DependencyList) {
  const ref = useCallback((node: HTMLDivElement | null) => {
    ref.current = node;
    onNode(node);
  }, deps) as CallbackRef;
  return ref;
}

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
  const target = useTrackedNode(() => undefined, []);
  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
  return <div ref={target} onClick={() => onMeasure(measure())} data-revision={revision} />;
}
`;

const stale = (hook: string, capture: string): string =>
  `\`${hook}\` can run with a stale \`${capture}\` & show your users old data.`;

const withEdits = (...edits: ReadonlyArray<readonly [string, string]>): string =>
  edits.reduce((code, [from, to]) => code.replace(from, to), stock);

const cases = [
  {
    name: "a stock local callback ref",
    code: stock,
    curated: [],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a callback ref with reactive dependencies",
    code: withEdits([
      "  const target = useTrackedNode(() => undefined, []);\n",
      "  const target = useTrackedNode(() => undefined, [revision]);\n",
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a local factory that returns a fresh callback",
    code: withEdits(
      [
        "  const ref = useCallback((node: HTMLDivElement | null) => {\n",
        "  const ref = ((node: HTMLDivElement | null) => {\n",
      ],
      ["  }, deps) as CallbackRef;\n", "  }) as CallbackRef;\n"],
    ),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a render-selected callback ref factory",
    code: withEdits(
      [
        "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
        `declare function makeRef(callback: (element: HTMLDivElement | null) => void, deps: DependencyList): CallbackRef;

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
      ],
      [
        "  const target = useTrackedNode(() => undefined, []);\n",
        `  const dynamic = revision ? useTrackedNode : makeRef;
  const target = dynamic(() => undefined, []);
`,
      ],
    ),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a render-time snapshot of the ref value",
    code: withEdits([
      "  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);\n",
      `  const node = target.current;
  const measure = useCallback(() => node?.clientHeight ?? 0, []);
`,
    ]),
    curated: [stale("useCallback", "node.clientHeight")],
    upstream: [stale("useCallback", "node.clientHeight")],
  },
  {
    name: "a separate omitted revision capture",
    code: withEdits([
      "  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);\n",
      "  const measure = useCallback(() => (target.current?.clientHeight ?? 0) + revision, []);\n",
    ]),
    curated: [stale("useCallback", "revision")],
    upstream: [stale("useCallback", "target, revision")],
  },
  {
    name: "a wrapper around an unproven memoizer",
    code: withEdits(
      [
        `
type CallbackRef = ((element: HTMLDivElement | null) => void) & { current: HTMLDivElement | null };
`,
        `
declare function useLocalCallback<T>(next: T, deps: DependencyList): T;

type CallbackRef = ((element: HTMLDivElement | null) => void) & { current: HTMLDivElement | null };
`,
      ],
      [
        "  const ref = useCallback((node: HTMLDivElement | null) => {\n",
        "  const ref = useLocalCallback((node: HTMLDivElement | null) => {\n",
      ],
    ),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a bare invocation mixed with a current read",
    code: withEdits([
      `  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
  return <div ref={target} onClick={() => onMeasure(measure())} data-revision={revision} />;
`,
      `  const measure = useCallback(() => target.current ? target(null) : undefined, []);
  return <div ref={target} onClick={() => measure()} data-revision={revision} />;
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a useMemo consumer",
    code: withEdits(
      [
        'import { useCallback, type DependencyList } from "react";\n',
        'import { useCallback, useMemo, type DependencyList } from "react";\n',
      ],
      [
        `  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
  return <div ref={target} onClick={() => onMeasure(measure())} data-revision={revision} />;
`,
        `  const measure = useMemo(() => target.current?.clientHeight ?? 0, []);
  return <div ref={target} onClick={() => onMeasure(measure)} data-revision={revision} />;
`,
      ],
    ),
    curated: [stale("useMemo", "target")],
    upstream: [stale("useMemo", "target")],
  },
  {
    name: "an aliased callback ref wrapper",
    code: withEdits([
      "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
      `export const useElsewhere = useTrackedNode;

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a destructured module loader",
    code: withEdits([
      "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
      `declare function changeProvider(value: unknown): void;

const { ["require"]: load } = globalThis as { require: (packageName: string) => unknown };
changeProvider(load("react"));

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a dynamic React import",
    code: withEdits([
      "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
      `async function replaceProvider(load: (provider: object) => void) {
  load(await import("react"));
}

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a mutable default React import",
    code: withEdits([
      'import { useCallback, type DependencyList } from "react";\n',
      `import React, { useCallback, type DependencyList } from "react";

const provider = React as { useCallback: typeof useCallback };
provider.useCallback = (callback) => callback;
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a separate declared revision capture",
    code: withEdits([
      "  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);\n",
      "  const measure = useCallback(() => (target.current?.clientHeight ?? 0) + revision, [revision]);\n",
    ]),
    curated: [],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a const-computed destructured module loader",
    code: withEdits([
      "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
      `declare function changeProvider(value: unknown): void;

const providerField = "require";
const { [providerField]: load } = globalThis as { require: (name: string) => unknown };
changeProvider(load("react"));

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a const-computed member module loader",
    code: withEdits([
      "export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {\n",
      `declare function changeProvider(value: unknown): void;

const providerField = "require";
const load = (globalThis as { require: (name: string) => unknown })[providerField];
changeProvider(load("react"));

export function View({ revision, onMeasure }: { revision: number; onMeasure: (value: number) => void }) {
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a direct replacement of the current field",
    code: withEdits([
      "  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);\n",
      `  target.current = null;
  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
  {
    name: "a late callback ref with a neighboring useMemo write",
    code: withEdits(
      [
        'import { useCallback, type DependencyList } from "react";\n',
        'import { useCallback, useMemo, type DependencyList } from "react";\n',
      ],
      [
        "  const target = useTrackedNode(() => undefined, []);\n",
        `  const actions = useMemo(() => ({
    scroll(value: number) {
      if (target.current) target.current.scrollTop = value;
    },
  }), []);
  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
  const target = useTrackedNode(() => undefined, []);
`,
      ],
      [
        `  const measure = useCallback(() => target.current?.clientHeight ?? 0, []);
  return <div ref={target} onClick={() => onMeasure(measure())} data-revision={revision} />;
`,
        "  return <div ref={target} onClick={() => { actions.scroll(revision); onMeasure(measure()); }} data-revision={revision} />;\n",
      ],
    ),
    curated: [stale("useMemo", "target")],
    upstream: [stale("useMemo", "target"), stale("useCallback", "target")],
  },
  {
    name: "a reassigned callback ref binding",
    code: withEdits([
      "  const target = useTrackedNode(() => undefined, []);\n",
      `  let target = useTrackedNode(() => undefined, []);
  target = ((node: HTMLDivElement | null) => { void node; }) as CallbackRef;
`,
    ]),
    curated: [stale("useCallback", "target")],
    upstream: [stale("useCallback", "target")],
  },
] as const;

describe("exhaustive-deps for stable local callback refs", () => {
  for (const fixture of cases) {
    for (const mode of ["curated", "upstream"] as const) {
      it(`${fixture.name} in ${mode} mode`, () => {
        const result = runRule(exhaustiveDeps, fixture.code, {
          filename: "fixture.tsx",
          settings: { "react-doctor": { portedRuleMode: mode } },
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics.map(({ message }) => message).sort()).toEqual(
          [...fixture[mode]].sort(),
        );
      });
    }
  }
});
