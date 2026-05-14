import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-mutable-in-deps");

describe("no-mutable-in-deps", () => {
  it("flags `location.pathname` in a useEffect deps array", async () => {
    // https://react.dev/learn/lifecycle-of-reactive-effects#can-global-or-mutable-values-be-dependencies
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-location", {
      files: {
        "src/Page.tsx": `import { useEffect } from "react";

declare const trackPageView: (path: string) => void;

export const Page = () => {
  useEffect(() => {
    trackPageView(location.pathname);
  }, [location.pathname]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("location.*");
  });

  it("flags `<refIdent>.current` from a useRef binding in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-ref-current", {
      files: {
        "src/Spy.tsx": `import { useEffect, useRef } from "react";

declare const observeNode: (element: HTMLDivElement | null) => void;

export const Spy = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    observeNode(containerRef.current);
  }, [containerRef.current]);
  return <div ref={containerRef} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("containerRef.current");
  });

  it("flags `window.innerWidth` (deeper mutable global access) in deps", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-window", {
      files: {
        "src/Layout.tsx": `import { useEffect, useState } from "react";

export const Layout = () => {
  const [, setSize] = useState(0);
  useEffect(() => {
    setSize(window.innerWidth);
  }, [window.innerWidth]);
  return <div />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag a bare ref Identifier (the ref object itself is stable)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-bare-ref", {
      files: {
        "src/Stable.tsx": `import { useEffect, useRef } from "react";

declare const setupObserver: (target: { current: HTMLDivElement | null }) => () => void;

export const Stable = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return setupObserver(containerRef);
  }, [containerRef]);
  return <div ref={containerRef} />;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a regular state.field MemberExpression (state IS reactive)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-mutable-in-deps-state-field", {
      files: {
        "src/Settings.tsx": `import { useEffect, useState } from "react";

export const Settings = () => {
  const [profile] = useState({ name: "ada" });
  useEffect(() => {
    document.title = profile.name;
  }, [profile.name]);
  return <span>{profile.name}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-mutable-in-deps");
    expect(hits).toHaveLength(0);
  });
});
