import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-state-only-in-handlers-more-"));

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

describe("issue #146: rerenderStateOnlyInHandlers — event-handler-only state", () => {
  it("DOES flag state read only inside an aliased JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-aliased-handler-read-only", {
      files: {
        "src/aliased-handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const AliasedHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const handleClick = () => {
    track(view);
    setView("signup");
  };
  const click = handleClick;

  return <button onClick={click}>Continue</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/aliased-handler-read-only.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a member JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-member-handler-read-only", {
      files: {
        "src/member-handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const MemberHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const handlers = {
    click: () => {
      track(view);
      setView("signup");
    },
  };

  return <button onClick={handlers.click}>Continue</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/member-handler-read-only.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a React.useCallback event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-react-usecallback-handler", {
      files: {
        "src/react-usecallback-handler.tsx": `import React, { useState } from "react";

declare const track: (value: string) => void;

export const ReactUseCallbackHandler = () => {
  const [view, setView] = useState("login");

  const handleClick = React.useCallback(() => {
    track(view);
    setView("signup");
  }, [view]);

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
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/react-usecallback-handler.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a named spread JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-named-spread-handler-read-only", {
      files: {
        "src/named-spread-handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const NamedSpreadHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const handleClick = () => {
    track(view);
    setView("signup");
  };

  const buttonProps = {
    onClick: handleClick,
  };

  return <button {...buttonProps}>Continue</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/named-spread-handler-read-only.tsx")
        .length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state read only inside a spread JSX event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-spread-handler-read-only", {
      files: {
        "src/spread-handler-read-only.tsx": `import { useState } from "react";

declare const track: (value: string) => void;

export const SpreadHandlerReadOnly = () => {
  const [view, setView] = useState("login");

  const buttonProps = {
    onClick: () => {
      track(view);
      setView("signup");
    },
  };

  return <button {...buttonProps}>Continue</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/spread-handler-read-only.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state when only a shadowed render callback parameter uses the same name", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-shadowed-render-callback", {
      files: {
        "src/shadowed-render-callback.tsx": `import { useState } from "react";

const views = ["login", "signup"];

export const ShadowedRenderCallback = () => {
  const [view, setView] = useState("login");

  return (
    <div>
      {views.map((view) => (
        <span>{view}</span>
      ))}
      <button onClick={() => setView("signup")}>Continue</button>
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

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/shadowed-render-callback.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("DOES flag state when only a shadowed block local with the same name reads it", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-shadowed-block-local", {
      files: {
        "src/shadowed-block-local.tsx": `import { useState } from "react";

export const ShadowedBlockLocal = ({ enabled }: { enabled: boolean }) => {
  const [view, setView] = useState("login");

  if (enabled) {
    const label = view === "login" ? "Log in" : "Create account";
    void label;
  }

  const label = "Continue";

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
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/shadowed-block-local.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("does NOT flag state read through a returned shadowed block local", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-returned-shadowed-block-local", {
      files: {
        "src/returned-shadowed-block-local.tsx": `import { useState } from "react";

export const ReturnedShadowedBlockLocal = ({ enabled }: { enabled: boolean }) => {
  const [view, setView] = useState("login");
  const label = "Continue";

  if (enabled) {
    const label = view === "login" ? "Log in" : "Create account";
    return <button onClick={() => setView("signup")}>{label}</button>;
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
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/returned-shadowed-block-local.tsx"),
    ).toHaveLength(0);
  });

  it("does NOT flag state read by a for-of iterable before a shadowed loop binding", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-for-of-shadowed-iterable", {
      files: {
        "src/for-of-shadowed-iterable.tsx": `import { useState } from "react";

interface TreeNode {
  children: string[];
}

export const ForOfShadowedIterable = () => {
  const [item, setItem] = useState<TreeNode>({ children: ["Continue"] });

  for (const item of item.children) {
    return <button onClick={() => setItem({ children: ["Done"] })}>{item}</button>;
  }

  return <button onClick={() => setItem({ children: ["Done"] })}>Empty</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/for-of-shadowed-iterable.tsx"),
    ).toHaveLength(0);
  });

  it("DOES flag state when only a shadowed catch parameter is returned", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-shadowed-catch-parameter", {
      files: {
        "src/shadowed-catch-parameter.tsx": `import { useState } from "react";

export const ShadowedCatchParameter = () => {
  const [error, setError] = useState("tracked");

  try {
    throw new Error("boom");
  } catch (error) {
    return <span>{String(error)}</span>;
  }

  return <button onClick={() => setError("next")}>Retry</button>;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/shadowed-catch-parameter.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("does NOT let a shadowed block handler prune a rendered custom on prop", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-shadowed-handler-on-prop", {
      files: {
        "src/shadowed-handler-on-prop.tsx": `import { useState } from "react";

interface PanelProps {
  onCommit: () => void;
  onValue: string;
}

declare const Panel: (props: PanelProps) => null;

export const ShadowedHandlerOnProp = () => {
  const [handler, setHandler] = useState("login");

  if (true) {
    const handler = () => {};
    void handler;
  }

  return <Panel onValue={handler} onCommit={() => setHandler("signup")} />;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/shadowed-handler-on-prop.tsx"),
    ).toHaveLength(0);
  });

  it("DOES flag state read only through a scoped custom event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-scoped-custom-event-handler", {
      files: {
        "src/scoped-custom-event-handler.tsx": `import { useState } from "react";

interface PanelProps {
  onCommit: () => void;
}

declare const Panel: (props: PanelProps) => null;
declare const track: (value: string) => void;

export const ScopedCustomEventHandler = ({ enabled }: { enabled: boolean }) => {
  const [view, setView] = useState("login");

  if (enabled) {
    const handleCommit = () => {
      track(view);
      setView("signup");
    };

    return <Panel onCommit={handleCommit} />;
  }

  return <Panel onCommit={() => setView("signup")} />;
};
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
    });

    expect(
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/scoped-custom-event-handler.tsx").length,
    ).toBeGreaterThan(0);
  });

  it("does NOT flag state read through a logical-expression left assignment", async () => {
    const projectDir = setupReactProject(tempRoot, "issue-146-logical-left-assignment", {
      files: {
        "src/logical-left-assignment.tsx": `import { useState } from "react";

export const LogicalLeftAssignment = () => {
  const [view, setView] = useState("login");

  let label = "Continue";
  (label = view) && label.length > 0;

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
      findStateOnlyInHandlersDiagnostics(diagnostics, "src/logical-left-assignment.tsx"),
    ).toHaveLength(0);
  });
});
