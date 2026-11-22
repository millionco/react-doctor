import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const fixture = `import { useEffect, useRef } from "react";
export function TileWall({ ready, share, children }) {
  const wall = useRef(null);
  useEffect(() => {
    const section = wall.current;
    if (!section) return;
    const resize = new ResizeObserver(() => { section.classList.add("measured"); });
    const update = () => {
      resize.disconnect();
      for (const tile of section.children) {
        resize.observe(tile);
      }
    };
    update();
    const changes = new MutationObserver(update);
    changes.observe(section, { childList: true });
    return () => { resize.disconnect(); changes.disconnect(); };
  }, [ready, share]);
  return <section ref={wall}>{children}</section>;
}
`;

const run = (source: string) => runRule(effectNeedsCleanup, source, { filename: "TileWall.tsx" });

describe("paired observer cleanup", () => {
  it("accepts a local mutation observer used to refresh a resize observer", () => {
    const result = run(fixture);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a built-in host when all callers close a private component's forwarded props", () => {
    const withPrivateProps = fixture
      .replace(
        "export function TileWall({ ready, share, children })",
        "function TileWall({ ready, share, children, ...rest })",
      )
      .replace("<section ref={wall}>", "<section ref={wall} {...rest}>");
    const result = run(
      withPrivateProps + '\nexport const Grid = () => <TileWall className="tiles" />;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "async-returned-cleanup",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return async () => { await ready; resize.disconnect(); changes.disconnect(); };\n",
        ],
      ],
    ],
    [
      "cleanup-default-argument",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return (ignored = share()) => { resize.disconnect(); changes.disconnect(); };\n",
        ],
      ],
    ],
    [
      "cleanup-observer-argument",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return () => { resize.disconnect(); changes.disconnect(share()); };\n",
        ],
      ],
    ],
    [
      "competing-observation",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: true });\n    changes.observe(document.body, {childList: true});\n    if (ready) return;\n",
        ],
      ],
    ],
    [
      "custom-children",
      [
        [
          "      for (const tile of section.children) {\n",
          "      for (const tile of children()) {\n",
        ],
      ],
    ],
    [
      "custom-element",
      [
        [
          "  return <section ref={wall}>{children}</section>;\n",
          "  return <metric-grid ref={wall}>{children}</metric-grid>;\n",
        ],
      ],
    ],
    [
      "customized-builtin",
      [
        [
          "  return <section ref={wall}>{children}</section>;\n",
          '  return <section ref={wall} is="metric-grid">{children}</section>;\n',
        ],
      ],
    ],
    [
      "destructured-native-callback",
      [
        [
          "export function TileWall({ ready, share, children }) {\n",
          "export function TileWall({ ready, share, children, callbacks }) {\n",
        ],
        [
          '    const resize = new ResizeObserver(() => { section.classList.add("measured"); });\n',
          "    const { afterResize = () => {} } = callbacks;\n    const resize = new ResizeObserver(afterResize);\n",
        ],
      ],
    ],
    [
      "destructured-observer",
      [
        [
          "export function TileWall({ ready, share, children }) {\n",
          "export function TileWall({ ready, share, children, adapters }) {\n",
        ],
        [
          '    const resize = new ResizeObserver(() => { section.classList.add("measured"); });\n',
          "    const { resize = new ResizeObserver(() => {}) } = adapters;\n",
        ],
      ],
    ],
    [
      "different-observed-host",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(document.body, { childList: true });\n",
        ],
      ],
    ],
    ["escaped-handle", [["    };\n", "    };\n    share(resize);\n"]]],
    ["escaped-helper", [["    };\n", "    };\n    share(update);\n"]]],
    ["extra-trigger", [["    };\n", "    };\n    setTimeout(update, 20);\n"]]],
    [
      "invalid-trigger-options",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: false });\n",
        ],
      ],
    ],
    [
      "listener-initialization-after-call",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          '    changes.observe(section, { childList: true });\n    section.addEventListener("wheel", onWheel);\n    const onWheel = () => {};\n',
        ],
      ],
    ],
    [
      "missing-resize-cleanup",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return () => { changes.disconnect(); };\n",
        ],
      ],
    ],
    [
      "missing-trigger-cleanup",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return () => { resize.disconnect(); };\n",
        ],
      ],
    ],
    [
      "native-callback-receiver-escape",
      [
        [
          '    const resize = new ResizeObserver(() => { section.classList.add("measured"); });\n',
          "    const resize = new ResizeObserver((entries, instance) => { share(instance); });\n",
        ],
      ],
    ],
    [
      "observer-initialization-after-call",
      [
        [
          "    const changes = new MutationObserver(update);\n    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: true });\n    const changes = new MutationObserver(update);\n",
        ],
      ],
    ],
    [
      "opaque-cleanup-between-releases",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return () => { resize.disconnect(); share(); changes.disconnect(); };\n",
        ],
      ],
    ],
    [
      "opaque-setup-after-observe",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: true });\n    share();\n",
        ],
      ],
    ],
    [
      "partial-trigger-cleanup",
      [
        [
          "    return () => { resize.disconnect(); changes.disconnect(); };\n",
          "    return () => { resize.disconnect(); if (ready) changes.disconnect(); };\n",
        ],
      ],
    ],
    [
      "setup-destructured-arrow",
      [
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: true });\n    const { fallback = share() } = () => {};\n",
        ],
      ],
    ],
    [
      "shadowed-constructor",
      [
        [
          "export function TileWall({ ready, share, children }) {\n",
          "export function TileWall({ ready, share, children, MutationObserver }) {\n",
        ],
      ],
    ],
    [
      "trigger-before-initial-refresh",
      [
        ["    update();\n", ""],
        [
          "    changes.observe(section, { childList: true });\n",
          "    changes.observe(section, { childList: true });\n    share();\n    update();\n",
        ],
      ],
    ],
  ] as const)("retains the warning for %s", (_, replacements) => {
    let source = fixture;
    for (const [before, after] of replacements) {
      expect(source).toContain(before);
      source = source.replace(before, after);
    }
    const result = run(source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
