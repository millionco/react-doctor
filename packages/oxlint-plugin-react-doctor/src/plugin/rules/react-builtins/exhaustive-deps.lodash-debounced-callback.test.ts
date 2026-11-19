import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const cases = [
  {
    name: "genuine subpath stable ref",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: [],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "genuine subpath local name alias",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import delay from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    delay((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: [],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "genuine subpath missing reactive capture",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChange(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: ["`useCallback` can run with a stale `onChange` & show your users old data."],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "actual data forwarded through current ref",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T, enabled: boolean) => void, enabled: boolean) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value, enabled), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: ["`useCallback` can run with a stale `enabled` & show your users old data."],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "unrelated stale callback sibling",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  const stale = useCallback(() => onChange(null as T), []);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: ["`useCallback` can run with a stale `onChange` & show your users old data."],
      upstream: [
        "`useCallback` can run with a stale `onChange` & show your users old data.",
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "options object",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10, { trailing: true }),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "shadowed use ref is fresh",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  function useRef<V>(value: V) { return { current: value }; }
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "direct eval stale render value",
    entry: "entry.tsx",
    files: {
      "package.json": `{
  "name": "debounce-stale-capture-control",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control({ value, receive }: { value: string; receive: (value: string) => void }) {
  const sink = useRef(receive);
  const send = useCallback(
    debounce(() => sink.current(eval("value")), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "implicit arguments stale render props",
    entry: "entry.tsx",
    files: {
      "package.json": `{
  "name": "debounce-stale-capture-control",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control(props: { value: string; receive: (value: string) => void }) {
  const sink = useRef(props.receive);
  const send = useCallback(
    debounce(() => sink.current(arguments[0].value), 10),
    [],
  );
  return <button onClick={() => send()}>{props.value}</button>;
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "source visible react dispatcher replacement",
    entry: "entry.tsx",
    files: {
      "package.json": `{
  "name": "debounce-stale-capture-control",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "entry.tsx": `import React, { useCallback, useRef } from "react";
import debounce from "lodash/debounce";

type Dispatcher = {
  useRef(value: unknown): { current: unknown };
};
const shared = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: Dispatcher };
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

export function Control({ value }: { value: string }) {
  const original = shared.H;
  shared.H = {
    ...original,
    useRef(initialValue: unknown) {
      original.useRef(initialValue);
      return { current: initialValue };
    },
  };
  const holder = useRef(() => console.log(value));
  shared.H = original;
  const send = useCallback(
    debounce(() => holder.current(), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "scoped pnpm ancestor react override",
    entry: "packages/ui/entry.tsx",
    files: {
      "packages/ui/package.json": `{
  "name": "@local/ui",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "packages/ui/entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control({ value }: { value: string }) {
  const holder = useRef(() => console.log(value));
  const send = useCallback(
    debounce(() => holder.current(), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
      "package.json": `{
  "name": "nested-react-workspace-provider",
  "private": true,
  "packageManager": "pnpm@9.15.9",
  "pnpm": {
    "overrides": {
      "@local/ui>react": "link:./react-adapter"
    }
  }
}
`,
      "pnpm-workspace.yaml": `packages:
  - packages/*
  - react-adapter
`,
      "react-adapter/package.json": `{
  "name": "@local/react-adapter",
  "version": "19.2.3",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./jsx-runtime": "./jsx-runtime.js",
    "./jsx-dev-runtime": "./jsx-dev-runtime.js"
  },
  "dependencies": {
    "react-stock": "npm:react@19.2.3"
  }
}
`,
      "react-adapter/index.js": `export * from "react-stock";
export { default } from "react-stock";
import { useRef as useStockRef } from "react-stock";
export function useRef(initialValue) {
  useStockRef(initialValue);
  return { current: initialValue };
}
`,
      "react-adapter/jsx-runtime.js": `export * from "react-stock/jsx-runtime";
`,
      "react-adapter/jsx-dev-runtime.js": `export * from "react-stock/jsx-dev-runtime";
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "nested npm ancestor react override",
    entry: "packages/ui/entry.tsx",
    files: {
      "packages/ui/package.json": `{
  "name": "@local/ui",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "packages/ui/entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control({ value }: { value: string }) {
  const holder = useRef(() => console.log(value));
  const send = useCallback(
    debounce(() => holder.current(), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
      "package.json": `{
  "name": "nested-react-workspace-provider",
  "private": true,
  "packageManager": "pnpm@9.15.9",
  "overrides": {
    "@local/ui": {
      "react": "npm:staged-react-adapter@19.2.4"
    }
  }
}
`,
      "react-adapter/package.json": `{
  "name": "@local/react-adapter",
  "version": "19.2.3",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./jsx-runtime": "./jsx-runtime.js",
    "./jsx-dev-runtime": "./jsx-dev-runtime.js"
  },
  "dependencies": {
    "react-stock": "npm:react@19.2.3"
  }
}
`,
      "react-adapter/index.js": `export * from "react-stock";
export { default } from "react-stock";
import { useRef as useStockRef } from "react-stock";
export function useRef(initialValue) {
  useStockRef(initialValue);
  return { current: initialValue };
}
`,
      "react-adapter/jsx-runtime.js": `export * from "react-stock/jsx-runtime";
`,
      "react-adapter/jsx-dev-runtime.js": `export * from "react-stock/jsx-dev-runtime";
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "modern pnpm workspace react override",
    entry: "packages/ui/entry.tsx",
    files: {
      "packages/ui/package.json": `{
  "name": "@local/ui",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "packages/ui/entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control({ value }: { value: string }) {
  const holder = useRef(() => console.log(value));
  const send = useCallback(
    debounce(() => holder.current(), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
      "package.json": `{
  "name": "fixture-repository",
  "private": true,
  "packageManager": "pnpm@11.27.1"
}
`,
      "pnpm-workspace.yaml": `packages:
  - 'packages/*'
  - 'react-adapter'
overrides:
  '@local/ui>react': 'link:./react-adapter'
`,
      "react-adapter/package.json": `{
  "name": "@local/react-adapter",
  "version": "19.2.3",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./jsx-runtime": "./jsx-runtime.js",
    "./jsx-dev-runtime": "./jsx-dev-runtime.js"
  },
  "dependencies": {
    "react-stock": "npm:react@19.2.3"
  }
}
`,
      "react-adapter/index.js": `export * from "react-stock";
export { default } from "react-stock";
import { useRef as useStockRef } from "react-stock";
export function useRef(initialValue) {
  useStockRef(initialValue);
  return { current: initialValue };
}
`,
      "react-adapter/jsx-runtime.js": `export * from "react-stock/jsx-runtime";
`,
      "react-adapter/jsx-dev-runtime.js": `export * from "react-stock/jsx-dev-runtime";
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "passive exact workspace settings",
    entry: "packages/ui/entry.tsx",
    files: {
      "packages/ui/package.json": `{
  "name": "@local/ui",
  "private": true,
  "type": "module",
  "dependencies": {
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "lodash": "4.18.1"
  }
}
`,
      "packages/ui/entry.tsx": `import { useCallback, useRef } from "react";
import debounce from "lodash/debounce";
export function Control({ value }: { value: string }) {
  const holder = useRef(() => console.log(value));
  const send = useCallback(
    debounce(() => holder.current(), 10),
    [],
  );
  return <button onClick={() => send()}>{value}</button>;
}
`,
      "package.json": `{
  "name": "fixture-repository",
  "private": true,
  "packageManager": "pnpm@11.27.1"
}
`,
      "pnpm-workspace.yaml": `packages:
  - 'packages/*'
allowBuilds:
  '@parcel/watcher': false
  core-js: false
  esbuild: false
  lmdb: false
  msgpackr-extract: false
  nodent-runtime: false
  nx: false
minimumReleaseAgeIgnoreMissingTime: false
minimumReleaseAgeStrict: true
`,
      "react-adapter/package.json": `{
  "name": "@local/react-adapter",
  "version": "19.2.3",
  "type": "module",
  "exports": {
    ".": "./index.js",
    "./jsx-runtime": "./jsx-runtime.js",
    "./jsx-dev-runtime": "./jsx-dev-runtime.js"
  },
  "dependencies": {
    "react-stock": "npm:react@19.2.3"
  }
}
`,
      "react-adapter/index.js": `export * from "react-stock";
export { default } from "react-stock";
import { useRef as useStockRef } from "react-stock";
export function useRef(initialValue) {
  useStockRef(initialValue);
  return { current: initialValue };
}
`,
      "react-adapter/jsx-runtime.js": `export * from "react-stock/jsx-runtime";
`,
      "react-adapter/jsx-dev-runtime.js": `export * from "react-stock/jsx-dev-runtime";
`,
    },
    expected: {
      curated: [],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "genuine default react benign direct calls",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import React, { useCallback, useEffect, useRef } from "react";

const Context = React.createContext(null);
export const ReadOnlyComponent = React.memo(() => null);

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
    },
    expected: {
      curated: [],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
  {
    name: "rollup provider alias plugin",
    entry: "entry.tsx",
    files: {
      "entry.tsx": `import debounce from "lodash/debounce";
import { useCallback, useEffect, useRef } from "react";

export function useChange<T>(onChange: (value: T) => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  return useCallback(
    debounce((value: T) => onChangeRef.current(value), 10),
    [],
  );
}
`,
      "package.json": `{
  "name": "jsonforms-debounced-ref-native-controls",
  "private": true,
  "dependencies": {
    "react": "17.0.2",
    "lodash": "4.18.1"
  }
}
`,
      "rollup.config.js": `import alias from "@rollup/plugin-alias";
export default [{ plugins: [alias({ entries: [{ find: "lodash/debounce", replacement: "./local-factory.ts" }] })] }];
`,
      "local-factory.ts": `export default function substitute<T>(fn: (...args: T[]) => void, _wait: number) {
  const queued = String(globalThis.location.hash);
  return (...args: T[]) => {
    if (queued === "#active") fn(...args);
  };
}
`,
    },
    expected: {
      curated: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
      upstream: [
        "`useCallback`'s callback is defined elsewhere, so dependencies can't be checked and stale values can slip through.",
      ],
    },
  },
] as const;

const withFixture = (files: Readonly<Record<string, string>>, inspect: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), "rd-lodash-debounced-closure-"));
  try {
    for (const [relative, contents] of Object.entries(files)) {
      const absolute = join(root, relative);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    }
    inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

describe("exhaustive-deps inline lodash debounce callback", () => {
  it.each(cases)("$name", ({ entry, files, expected }) => {
    withFixture(files, (root) => {
      for (const mode of ["curated", "upstream"] as const) {
        const result = runRule(exhaustiveDeps, readFileSync(join(root, entry), "utf8"), {
          filename: join(root, entry),
          settings: { "react-doctor": { portedRuleMode: mode } },
        });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics.map(({ message }) => message).sort()).toEqual(expected[mode]);
      }
    });
  });

  it("includes the provider manifest and build-config candidates in the dependency trace", () => {
    const { entry, files } = cases[0];
    withFixture(files, (root) => {
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: join(root, entry),
        sourceText: files[entry],
        ruleIds: ["exhaustive-deps"],
      });
      expect(trace?.contentPaths.has(join(root, "package.json"))).toBe(true);
      expect(trace?.existencePaths.has(join(root, "vite.config.ts"))).toBe(true);
      expect(trace?.existencePaths.has(join(root, "rollup.config.js"))).toBe(true);
    });
  });
});
