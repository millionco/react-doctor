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

import { runOxlint } from "@react-doctor/core";
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
  it("does NOT flag state read by an early-return guard", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-early-return-guard", {
      files: {
        "src/auth-form.tsx": `import { useState } from "react";

export const AuthForm = () => {
  const [view, setView] = useState("login");

  if (view === "login") {
    return <button onClick={() => setView("signup")}>Create account</button>;
  }

  return <button onClick={() => setView("login")}>Log in</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/auth-form.tsx")).toHaveLength(0);
  });

  it("does NOT flag state read by an inline early-return guard", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-inline-early-return-guard", {
      files: {
        "src/inline-auth-form.tsx": `import { useState } from "react";

export const InlineAuthForm = () => {
  const [view, setView] = useState("login");

  if (view === "login") return <button onClick={() => setView("signup")}>Create account</button>;

  return <button onClick={() => setView("login")}>Log in</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/inline-auth-form.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read by a switch that chooses the returned branch", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-switch-render-branch", {
      files: {
        "src/auth-panel.tsx": `import { useState } from "react";

export const AuthPanel = () => {
  const [view, setView] = useState("login");

  switch (view) {
    case "login":
      return <button onClick={() => setView("signup")}>Create account</button>;
    default:
      return <button onClick={() => setView("login")}>Log in</button>;
  }
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/auth-panel.tsx")).toHaveLength(0);
  });

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

  it("does NOT flag state read through a function declaration used in JSX", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-function-declaration", {
      files: {
        "src/function-declaration.tsx": `import { useState } from "react";

export const FunctionDeclaration = () => {
  const [view, setView] = useState("login");

  function getLabel() {
    return view === "login" ? "Log in" : "Create account";
  }

  return <button onClick={() => setView("signup")}>{getLabel()}</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/function-declaration.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read through a block-scoped derived value before return", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-block-scoped-derived", {
      files: {
        "src/block-scoped-derived.tsx": `import { useState } from "react";

export const BlockScopedDerived = () => {
  const [view, setView] = useState("login");

  if (view === "login") {
    const label = view === "login" ? "Create account" : "Log in";
    return <button onClick={() => setView("signup")}>{label}</button>;
  }

  return <button onClick={() => setView("login")}>Log in</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/block-scoped-derived.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read through an assigned render value", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-assigned-render-value", {
      files: {
        "src/assigned-render-value.tsx": `import { useEffect, useState } from "react";

export const AssignedRenderValue = ({ href }: { href: string }) => {
  const [sessionId, setSessionId] = useState<string | undefined>();

  useEffect(() => {
    setSessionId("session-1");
  }, []);

  let nextHref = href;
  if (href.includes("example.com") && sessionId) {
    nextHref = href + "#session_id=" + sessionId;
  }

  return <a href={nextHref}>Open</a>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/assigned-render-value.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read only through an assignment guard", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-assignment-guard", {
      files: {
        "src/assignment-guard.tsx": `import { useState } from "react";

export const AssignmentGuard = () => {
  const [view, setView] = useState("login");

  let label = "Log in";
  if (view === "login") {
    label = "Create account";
  }

  return <button onClick={() => setView("signup")}>{label}</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/assignment-guard.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read through a destructuring assignment default", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-destructuring-assignment", {
      files: {
        "src/destructuring-assignment.tsx": `import { useState } from "react";

export const DestructuringAssignment = ({ providedLabel }: { providedLabel?: string }) => {
  const [view, setView] = useState("login");

  let label = "Log in";
  ({ label = view } = { label: providedLabel });

  return <button onClick={() => setView("signup")}>{label}</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/destructuring-assignment.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read through a destructuring default used in JSX", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-destructuring-default", {
      files: {
        "src/destructuring-default.tsx": `import { useState } from "react";

export const DestructuringDefault = ({ label: providedLabel }: { label?: string }) => {
  const [view, setView] = useState("login");
  const { label = view } = { label: providedLabel };

  return <button onClick={() => setView("signup")}>{label}</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/destructuring-default.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read through a function parameter default used in JSX", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-parameter-default", {
      files: {
        "src/parameter-default.tsx": `import { useState } from "react";

export const ParameterDefault = () => {
  const [view, setView] = useState("login");

  const getLabel = (label = view) => label;

  return <button onClick={() => setView("signup")}>{getLabel()}</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/parameter-default.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read inside a render-time callback", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-render-callback", {
      files: {
        "src/render-callback.tsx": `import { useState } from "react";

const labels = ["primary", "secondary"];

export const RenderCallback = () => {
  const [selectedLabel, setSelectedLabel] = useState("primary");

  return (
    <div>
      {labels.map((label) => (
        <span data-active={label === selectedLabel}>{label}</span>
      ))}
      <button onClick={() => setSelectedLabel("secondary")}>Select secondary</button>
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

    expect(findStateOnlyInHandlersDiagnostics(diagnostics, "src/render-callback.tsx")).toHaveLength(
      0,
    );
  });

  it("does NOT flag state passed to a non-function on-prefixed prop", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-on-prefixed-data-prop", {
      files: {
        "src/on-prefixed-data-prop.tsx": `import { useState } from "react";

declare const CustomThing: (props: { onState: string; onPayload: string }) => null;

export const OnPrefixedDataProp = () => {
  const [view, setView] = useState("login");

  const props = { onPayload: view };

  return <CustomThing onState={view} {...props} />;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/on-prefixed-data-prop.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state passed through an aliased non-function on-prefixed prop", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-on-prefixed-data-alias", {
      files: {
        "src/on-prefixed-data-alias.tsx": `import { useState } from "react";

declare const CustomThing: (props: { onState: string }) => null;

export const OnPrefixedDataAlias = () => {
  const [view, setView] = useState("login");
  const visibleState = view;

  return <CustomThing onState={visibleState} />;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/on-prefixed-data-alias.tsx"),
    ).toHaveLength(0);
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

  it("DOES flag state read only inside a named custom JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-custom-named-handler-read-only", {
      files: {
        "src/custom-named-handler-read-only.tsx": `import { useState } from "react";

declare const CustomButton: (props: { onClick: () => void; children: React.ReactNode }) => null;
declare const track: (value: string) => void;

export const CustomNamedHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const handleClick = () => {
    track(view);
    setView("signup");
  };

  return <CustomButton onClick={handleClick}>Continue</CustomButton>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/custom-named-handler-read-only.tsx")
        .length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-handler-read-only", {
      files: {
        "src/handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const HandlerReadOnly = () => {
  const [view, setView] = useState("login");

  return (
    <button
      onClick={() => {
        track(view);
        setView("signup");
      }}
    >
      Continue
    </button>
  );
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/handler-read-only.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a named JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-named-handler-read-only", {
      files: {
        "src/named-handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const NamedHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const handleClick = () => {
    track(view);
    setView("signup");
  };

  return <button onClick={handleClick}>Continue</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/named-handler-read-only.tsx").length,
    ).toBeGreaterThan(0);
  });
});
