/**
 * Regression tests for `react-doctor/rerender-state-only-in-handlers`
 * — issue #146.
 *
 * The rule advised replacing `useState` with `useRef` whenever the
 * state value did not appear by name inside the JSX `return`. That
 * heuristic ignored every common shape where state still ends up
 * affecting render via an indirection:
 *   - `useMemo` / derived constants computed during render
 *   - context `value` passed to a Provider
 *   - props or attributes on JSX that aren't text children
 *
 * Following the bad advice and switching to `useRef` would silently
 * break consumers because `ref.current = …` does not trigger a
 * re-render. These tests pin down the transitive "render-reaches"
 * analysis so the false-positive hint never comes back.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "../../src/core/run-oxlint.js";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-state-only-in-handlers-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const RULE_NAME = "rerender-state-only-in-handlers";

const findStateOnlyInHandlersDiagnostics = (
  diagnostics: Array<{ rule: string; filePath: string }>,
  fileSuffix: string,
): Array<{ rule: string; filePath: string }> =>
  diagnostics.filter(
    (diagnostic) => diagnostic.rule === RULE_NAME && diagnostic.filePath.endsWith(fileSuffix),
  );

describe("issue #146: rerenderStateOnlyInHandlers — no false positives via indirection", () => {
  it("does NOT flag state read through a useMemo whose result is used in JSX", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-usememo", {
      files: {
        "src/search.tsx": `import { useMemo, useState } from "react";

declare const mediasWithIndex: { lc: string }[];
declare const RowVirtualizer: (props: { rows: { lc: string }[] }) => null;

export const Search = () => {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query) return mediasWithIndex;
    return mediasWithIndex.filter((media) => media.lc.includes(query));
  }, [query]);

  return (
    <div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} />
      <RowVirtualizer rows={filtered} />
    </div>
  );
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/search.tsx")).toHaveLength(0);
  });

  it("does NOT flag state read through a derived constant used in JSX", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-derived", {
      files: {
        "src/preview.tsx": `import { useState } from "react";
declare const FileIconByMime: (props: { mime: string }) => null;

export const Preview = ({ mime, src }: { mime: string; src: string }) => {
  const [imgError, setImgError] = useState(false);
  const isImage = mime.startsWith("image/") && Boolean(src) && !imgError;
  return (
    <div>
      {isImage ? <img src={src} onError={() => setImgError(true)} /> : <FileIconByMime mime={mime} />}
    </div>
  );
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/preview.tsx")).toHaveLength(0);
  });

  it("does NOT flag state passed as the value of a context provider", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-context", {
      files: {
        "src/desktop-updater.tsx": `import { createContext, useMemo, useState } from "react";

interface Snapshot { version: string }
const DEFAULT_SNAPSHOT: Snapshot = { version: "0.0.0" };

const DesktopUpdaterContext = createContext<{ snapshot: Snapshot } | null>(null);

declare const isSupported: boolean;
declare const DesktopUpdaterDialogs: () => null;

export const DesktopUpdaterProvider = ({
  children,
  renderDialogs,
}: {
  children: React.ReactNode;
  renderDialogs: boolean;
}) => {
  const [snapshot, setSnapshot] = useState<Snapshot>(DEFAULT_SNAPSHOT);
  void setSnapshot;
  const value = useMemo(() => ({ isSupported, snapshot }), [snapshot]);
  return (
    <DesktopUpdaterContext value={value}>
      {children}
      {renderDialogs ? <DesktopUpdaterDialogs /> : null}
    </DesktopUpdaterContext>
  );
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/desktop-updater.tsx")).toHaveLength(
      0,
    );
  });

  it("DOES still flag truly transient state — only mutated, never reachable from render", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-true-positive", {
      files: {
        "src/scroll-tracker.tsx": `import { useEffect, useState } from "react";

export const ScrollTracker = () => {
  const [scrollY, setScrollY] = useState(0);
  void scrollY;
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <div>tracking</div>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/scroll-tracker.tsx").length,
    ).toBeGreaterThan(0);
  });
});
