import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-initialize-state-post-mount");

// A mount effect whose setter argument derives from a DOM/layout measurement
// (matchMedia, a ref's `.current`) — directly OR through a local variable —
// produces a value that is not render-time-knowable, so the rule must stay
// silent. Storage reads (localStorage/sessionStorage) are NOT exempt: the
// react-bench-2 must-detect oracles (digitalocean sea-notes Theme) require the
// rule to flag storage-seeded mount inits, and the read is synchronous and
// cheap enough to belong in the useState initializer.
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

  it("flags a setter fed from a localStorage read via a local variable", async () => {
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
    expect(hits).toHaveLength(1);
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

  it("still flags a render-knowable constant set from a mount effect", async () => {
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
    expect(hits).toHaveLength(1);
  });
});
