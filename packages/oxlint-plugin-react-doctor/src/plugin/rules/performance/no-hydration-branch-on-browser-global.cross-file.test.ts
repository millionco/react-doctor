import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { noHydrationBranchOnBrowserGlobal } from "./no-hydration-branch-on-browser-global.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "hydration-browser-helper-"));
  __clearParseSourceFileCacheForTests();
  resetTsconfigAliasCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (source: string): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/AnimatedBackgroundImage.tsx", source);
  return runRule(noHydrationBranchOnBrowserGlobal, source, { filename: consumerPath });
};

describe("no-hydration-branch-on-browser-global — imported helper provenance", () => {
  it.each([
    ["image on the server", "false"],
    ["video on the server", "true"],
  ])("reports a media capability branch with %s", (_, serverFallback) => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return ${serverFallback};
        return document.createElement("video").canPlayType(mime) !== "";
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when an imported helper returns the same result on both runtimes", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = (mime) => {
        if (typeof document === "undefined") return false;
        document.createElement("video").canPlayType(mime);
        return false;
      };`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime } from "./video-background-mime";
      const AnimatedBackgroundImage = ({ mime, src }) =>
        canPlayVideoBackgroundMime(mime) ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not attribute imported provenance to a shadowing local helper", () => {
    writeFile(
      "src/video-background-mime.ts",
      `export const canPlayVideoBackgroundMime = () =>
        typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { canPlayVideoBackgroundMime as importedCapability } from "./video-background-mime";
      const canPlayVideoBackgroundMime = () => false;
      const AnimatedBackgroundImage = ({ src }) =>
        canPlayVideoBackgroundMime() ? <video src={src} /> : <Image src={src} />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when an immutable argument statically disables the browser branch", () => {
    writeFile(
      "src/environment.ts",
      `export const isBrowser = (enabled) =>
        enabled && typeof document !== "undefined";`,
    );
    const result = runConsumer(`
      "use client";
      import { isBrowser } from "./environment";
      const isEnabled = false;
      const AnimatedBackgroundImage = () =>
        isBrowser(isEnabled) ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a caller browser predicate passed through an imported helper", () => {
    writeFile("src/environment.ts", `export const identity = (value) => value;`);
    const result = runConsumer(`
      "use client";
      import { identity } from "./environment";
      const AnimatedBackgroundImage = () =>
        identity(typeof window !== "undefined") ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not crash on circular cross-file parameter dependencies (issue #1836)", () => {
    writeFile(
      "src/helpers-a.ts",
      `import { checkB } from "./helpers-b";
      export const checkA = (value) => checkB(value);`,
    );
    writeFile(
      "src/helpers-b.ts",
      `import { checkA } from "./helpers-a";
      export const checkB = (value) => checkA(value);`,
    );
    const result = runConsumer(`
      "use client";
      import { checkA } from "./helpers-a";
      const AnimatedBackgroundImage = () =>
        checkA(typeof window !== "undefined") ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a browser predicate forwarded through imported helpers with matching symbol IDs", () => {
    writeFile("src/identity.ts", `export const identity = (value) => value;`);
    writeFile(
      "src/helpers-b.ts",
      `import { identity } from "./identity";
      export const checkB = (value) => identity(value);`,
    );
    writeFile(
      "src/helpers-a.ts",
      `import { checkB } from "./helpers-b";
      export const checkA = (value) => checkB(value);`,
    );
    const result = runConsumer(`
      "use client";
      import { checkA } from "./helpers-a";
      const AnimatedBackgroundImage = () =>
        checkA(typeof window !== "undefined") ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not cycle through colliding caller and imported helper parameter IDs", () => {
    writeFile("src/identity.ts", `export const identity = (value) => value;`);
    writeFile(
      "src/helpers.ts",
      `import { identity } from "./identity";
      export const check = (value) => identity(value);`,
    );
    const result = runConsumer(`
      "use client";
      import { check } from "./helpers";
      export default (loading) => check(loading) ? <video /> : <Image />;
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("proven server snapshot gates", () => {
  it.each([
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); }`,
    `import { useSyncExternalStore } from 'react'; const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false); export { useReady };`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } useReady.description = 'ready';`,
    `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false); useReady.description = 'ready';`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } [useReady.description] = ['ready'];`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } let value; ({ [useReady]: value } = {});`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } let value; [value = useReady] = [];`,
  ])("preserves an immutable exported hook: %s", (hook) => {
    writeFile("src/ready.ts", hook);
    const result = runConsumer(`
      import { useReady } from './ready';
      const Panel = () => { const ready = useReady(); return ready && typeof window !== 'undefined' ? <main /> : <aside />; };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `return ready && available() ? <main /> : <aside />;`,
    `if (!ready) return null; return available() ? <main /> : <aside />;`,
    `const supported = ready ? available() : false; return supported ? <main /> : <aside />;`,
    `return !ready || available() ? <main /> : <aside />;`,
    `return ready ? available() ? <main /> : <aside /> : null;`,
    `if (ready) return available() ? <main /> : <aside />; return null;`,
    `if (ready) {} else return null; return available() ? <main /> : <aside />;`,
    `const selected = useMemo(() => ready ? available() : false, [ready]); return selected ? <main /> : <aside />;`,
  ])("preserves a proven initial snapshot: %s", (body) => {
    writeFile(
      "src/ready.ts",
      `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false);`,
    );
    writeFile("src/available.ts", `export const available = () => typeof window !== 'undefined';`);
    const result = runConsumer(`
      import { useMemo } from 'react';
      import { useReady } from './ready';
      import { available } from './available';
      const Panel = () => { const ready = useReady(); ${body} };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `export const useReady = () => true;`,
    `export const useReady = () => typeof window !== 'undefined';`,
    `import { useSyncExternalStore } from 'other'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false);`,
    `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => true);`,
    `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true);`,
    `import { useSyncExternalStore } from 'react'; let initial = false; initial = true; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => initial);`,
    `import { useSyncExternalStore } from 'react'; let snapshot = () => false; snapshot = () => true; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, snapshot);`,
    `import { useSyncExternalStore } from 'react'; export let useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false); useReady = () => true;`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } useReady = () => true;`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } [useReady] = [() => true];`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } ({ value: useReady } = { value: () => true });`,
    `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false); [useReady] = [() => true];`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } [useReady = () => false] = [() => true];`,
    `import { useSyncExternalStore } from 'react'; export function useReady() { return useSyncExternalStore(() => () => {}, () => true, () => false); } for ({ value: useReady } of [{ value: () => true }]) {}`,
    `import { useSyncExternalStore } from 'react'; export const useReady = (initial = true) => useSyncExternalStore(() => () => {}, () => true, () => initial);`,
    `import { useSyncExternalStore } from 'react'; export const useReady = () => { if (unknown) return true; return useSyncExternalStore(() => () => {}, () => true, () => false); };`,
  ])("retains unsupported snapshot provenance: %s", (hook) => {
    writeFile("src/ready.ts", hook);
    writeFile("src/available.ts", `export const available = () => typeof window !== 'undefined';`);
    const result = runConsumer(`
      import React from 'react';
      import { useReady } from './ready';
      import { available } from './available';
      const Panel = () => { const ready = useReady(); return ready && available() ? <main /> : <aside />; };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    `const ready = useReady(); return available() ? <main /> : <aside />;`,
    `let ready = useReady(); ready = true; return ready && available() ? <main /> : <aside />;`,
    `let ready = useReady(); [ready] = [true]; return ready && available() ? <main /> : <aside />;`,
    `const ready = props.ready; return ready && available() ? <main /> : <aside />;`,
    `const ready = useReady(); return (!ready && available()) ? <main /> : <aside />;`,
    `const ready = useReady(); return (ready || available()) ? <main /> : <aside />;`,
    `const ready = useReady(); return (ready && available()) || available() ? <main /> : <aside />;`,
    `const ready = useReady(); if (ready) return null; return available() ? <main /> : <aside />;`,
  ])("retains an unguarded initial browser branch: %s", (body) => {
    writeFile(
      "src/ready.ts",
      `import { useSyncExternalStore } from 'react'; export const useReady = () => useSyncExternalStore(() => () => {}, () => true, () => false);`,
    );
    writeFile("src/available.ts", `export const available = () => typeof window !== 'undefined';`);
    const result = runConsumer(`
      import React from 'react';
      import { useReady } from './ready';
      import { available } from './available';
      const Panel = (props) => { ${body} };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

describe("native server snapshot return completion", () => {
  it.each([
    "if (!ready) return null;",
    "if (!ready) { return null; }",
    "if (ready) {} else return null;",
    "if (ready) {} else { return null; }",
  ])("preserves a direct initial return: %s", (guard) => {
    const result = runConsumer(`
      import { useSyncExternalStore } from 'react';
      const subscribe = () => () => {};
      const Panel = () => {
        const ready = useSyncExternalStore(subscribe, () => true, () => false);
        ${guard}
        return typeof window === 'undefined' ? <aside /> : <main />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "do { try { return null; } finally { break; } } while (false);",
    "do { break; return null; } while (false);",
  ])("retains a browser branch after a normally completed loop: %s", (body) => {
    const result = runConsumer(`
      import { useSyncExternalStore } from 'react';
      const subscribe = () => () => {};
      const Panel = () => {
        const ready = useSyncExternalStore(subscribe, () => true, () => false);
        if (!ready) { ${body} }
        return typeof window === 'undefined' ? <aside /> : <main />;
      };
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
