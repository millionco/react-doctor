import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const CHILD = `
  import { useEffect, useState } from "react";
  export default function Child({ onStart }: { onStart?: () => void }) {
    const [phase, setPhase] = useState({ kind: "idle" });
    useEffect(() => {
      if (phase.kind !== "idle") setPhase({ kind: "idle" });
    });
    const start = () => {
      if (!onStart) return;
      setPhase({ kind: "running" });
      onStart();
    };
    return <button onClick={start}>{phase.kind}</button>;
  }
`;

let project: string;
let filename: string;

const place = (relative: string, contents: string): string => {
  const target = join(project, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
};

const placePage = (attributes: string) =>
  place(
    "app/page.tsx",
    `import Child from "../components/Child";
     export default function Page() { return <Child ${attributes} />; }`,
  );

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "rd-disabled-terminal-state-"));
  place(
    "package.json",
    JSON.stringify({
      private: true,
      scripts: { build: "next build" },
      dependencies: { next: "15.1.0", react: "19.2.0", "react-dom": "19.2.0" },
    }),
  );
  place("tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "preserve" } }));
  filename = place("components/Child.tsx", CHILD);
  resetManifestCaches();
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  resetManifestCaches();
});

describe("exhaustive-deps terminal state with a gated writer", () => {
  it("allows the gated terminal write when the only caller omits the prop", () => {
    placePage("");
    const curated = runRule(exhaustiveDeps, CHILD, { filename });
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual([]);
    const upstream = runRule(exhaustiveDeps, CHILD, {
      filename,
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(upstream.diagnostics).toHaveLength(1);
  });

  it.each(["onStart={() => {}}", "{...{ onStart: () => {} }}"])(
    "retains the warning for a caller that may provide the prop",
    (attributes) => {
      placePage(attributes);
      expect(runRule(exhaustiveDeps, CHILD, { filename }).diagnostics).toHaveLength(1);
    },
  );

  it("retains the warning when JSX body content supplies children", () => {
    const childWithChildren = CHILD.replaceAll("onStart", "children");
    place("components/Child.tsx", childWithChildren);
    place(
      "app/page.tsx",
      `import Child from "../components/Child";
       export default function Page() { return <Child>{() => {}}</Child>; }`,
    );
    expect(runRule(exhaustiveDeps, childWithChildren, { filename }).diagnostics).toHaveLength(1);
  });

  it.each(["app/child/page", "pages/child", "src/app/child/page", "src/pages/child"])(
    "retains the warning when Next owns the route entry %s",
    (route) => {
      const routeSource = CHILD.replaceAll("onStart", "params").replace(
        "params();",
        "void params;",
      );
      const routeFile = place(`${route}.tsx`, routeSource);
      place(
        "components/Caller.tsx",
        `import Child from "../${route}";
         export default function Caller() { return <Child />; }`,
      );
      expect(
        runRule(exhaustiveDeps, routeSource, { filename: routeFile }).diagnostics,
      ).toHaveLength(1);
    },
  );

  it("retains the warning when the selected JSX compiler is inherited", () => {
    placePage("");
    place(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "createCustomElement" } }),
    );
    place("tsconfig.json", JSON.stringify({ extends: "./tsconfig.base.json" }));
    expect(runRule(exhaustiveDeps, CHILD, { filename }).diagnostics).toHaveLength(1);
  });

  it("records the consumer file and containing directory for cache replay", () => {
    const consumer = placePage("");
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: CHILD,
      ruleIds: ["exhaustive-deps"],
    });
    expect(trace?.contentPaths.has(consumer)).toBe(true);
    expect(trace?.directoryPaths.has(dirname(consumer))).toBe(true);
  });
});

const NULL_REF_CHILD = `
  import { useEffect, useLayoutEffect, useRef, useState } from "react";
  export default function Child({ onStart }: { onStart?: () => void }) {
    const attemptRef = useRef<object | null>(null);
    const [, setTick] = useState(0);
    const callback = onStart ?? null;
    const start = () => {
      if (!callback || attemptRef.current !== null) return;
      attemptRef.current = {};
      callback();
    };
    useEffect(() => {
      const attempt = attemptRef.current;
      if (attempt !== null) {
        attemptRef.current = null;
        setTick((tick) => tick + 1);
      }
    });
    return <button onClick={start}>Start</button>;
  }
`;

const RESET_REF_CHILD = `
  import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
  export default function Child({ onStart }: { onStart?: () => void }) {
    const [phase, setPhase] = useState({ kind: "idle" });
    const resetRef = useRef(false);
    let shown = phase;
    if (phase.kind !== "idle") {
      shown = { kind: "idle" };
      resetRef.current = true;
    }
    useEffect(() => {
      if (resetRef.current) {
        resetRef.current = false;
        setPhase({ kind: "idle" });
      }
    });
    const start = useCallback(() => {
      if (!onStart) return;
      if (shown.kind !== "idle") return;
      onStart();
      setPhase({ kind: "running" });
    }, [onStart, shown]);
    return <button onClick={start}>{shown.kind}</button>;
  }
`;

describe("exhaustive-deps ref-guarded state writes", () => {
  it.each([NULL_REF_CHILD, RESET_REF_CHILD])(
    "skips the unreachable curated warning with an omitted prop",
    (source) => {
      place("components/Child.tsx", source);
      placePage("");
      const result = runRule(exhaustiveDeps, source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(
        runRule(exhaustiveDeps, source, {
          filename,
          settings: { "react-doctor": { portedRuleMode: "upstream" } },
        }).diagnostics,
      ).toHaveLength(1);
    },
  );

  it.each([NULL_REF_CHILD, RESET_REF_CHILD])(
    "retains the warning when a direct caller supplies the prop",
    (source) => {
      place("components/Child.tsx", source);
      placePage("onStart={() => {}}");
      expect(runRule(exhaustiveDeps, source, { filename }).diagnostics).toHaveLength(1);
    },
  );

  it.each([
    [NULL_REF_CHILD, "attemptRef.current = {};"],
    [RESET_REF_CHILD, "resetRef.current = true;"],
  ])("retains the warning when a layout effect rearms the ref", (source, rearm) => {
    const changed = source.replace(
      "useEffect(() => {",
      `useLayoutEffect(() => { ${rearm} }); useEffect(() => {`,
    );
    place("components/Child.tsx", changed);
    placePage("");
    expect(runRule(exhaustiveDeps, changed, { filename }).diagnostics).toHaveLength(1);
  });

  it.each([NULL_REF_CHILD, RESET_REF_CHILD])(
    "tracks incoming source paths so an omitted caller can become a supplied caller",
    (source) => {
      place("components/Child.tsx", source);
      const consumer = placePage("");
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: filename,
        sourceText: source,
        ruleIds: ["exhaustive-deps"],
      });
      expect(trace?.contentPaths.has(consumer)).toBe(true);
      expect(trace?.directoryPaths.has(dirname(consumer))).toBe(true);
    },
  );
});
