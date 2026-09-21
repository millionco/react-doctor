import { describe, expect, test } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("effect-needs-cleanup React 19 callback ref cleanup (issue #1831)", () => {
  test("simple check with explicit JSX ref usage", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from 'react';

export const Component = () => {
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }

    const observer = new ResizeObserver(() => {});
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} />;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("should not report when callback ref returns cleanup function", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from 'react';

export const useContainerWidth = () => {
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }

    const observer = new ResizeObserver(() => {});
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return containerRef;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("should report when callback ref does not return cleanup", () => {
    const result = runRule(
      effectNeedsCleanup,
      `import { useCallback } from 'react';

export const useContainerWidth = () => {
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }

    const observer = new ResizeObserver(() => {});
    observer.observe(node);
  }, []);

  return containerRef;
};`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("observe");
  });
});
