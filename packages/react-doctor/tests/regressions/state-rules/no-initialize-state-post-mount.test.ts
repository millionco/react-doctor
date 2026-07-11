import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-initialize-state-post-mount");

describe("no-initialize-state — post-mount reads in the effect body", () => {
  it("does not flag a setter fed from a ref.current DOM measurement", async () => {
    const projectDir = setupReactProject(tempRoot, "ref-current-measurement", {
      files: {
        "src/ScrollView.tsx": `import { useEffect, useRef, useState } from "react";

export const ScrollView = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [showThumb, setShowThumb] = useState(false);
  useEffect(() => {
    if (viewportRef.current) setShowThumb(viewportRef.current.scrollHeight > 0);
  }, []);
  return <div ref={viewportRef}>{showThumb ? "thumb" : null}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-initialize-state");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter fed from a localStorage read via a local variable", async () => {
    const projectDir = setupReactProject(tempRoot, "localStorage-local-var", {
      files: {
        "src/Theme.tsx": `import { useEffect, useState } from "react";

export const Theme = () => {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    setTheme(saved ?? "light");
  }, []);
  return <div data-theme={theme} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-initialize-state");
    expect(hits).toEqual([]);
  });

  it("does not flag an effect that wires a matchMedia listener on mount", async () => {
    const projectDir = setupReactProject(tempRoot, "matchmedia-listener", {
      files: {
        "src/Mode.tsx": `import { useEffect, useState } from "react";

export const Mode = () => {
  const [mode, setMode] = useState("system");
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    setMode(mediaQuery.matches ? "dark" : "light");
  }, []);
  return <div data-mode={mode} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-initialize-state");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a constant with no copied render source", async () => {
    const projectDir = setupReactProject(tempRoot, "render-knowable-constant", {
      files: {
        "src/Greeting.tsx": `import { useEffect, useState } from "react";

export const Greeting = () => {
  const [text, setText] = useState("");
  useEffect(() => {
    setText("Hello");
  }, []);
  return <span>{text}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-initialize-state");
    expect(hits).toEqual([]);
  });
});
