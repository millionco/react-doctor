import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import * as astWalker from "../../utils/walk-ast.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

const createObserverCleanupEffect = (
  observerCount: number,
  hasStoredDisposer: boolean,
  hasSharedReceiver = false,
): string => {
  const declarations = hasSharedReceiver
    ? "const observer = new IntersectionObserver(() => {});"
    : Array.from(
        { length: observerCount },
        (_, observerIndex) =>
          `const observer${observerIndex} = new IntersectionObserver(() => {});`,
      ).join("\n");
  const registrations = Array.from(
    { length: observerCount },
    (_, observerIndex) =>
      `${hasSharedReceiver ? "observer" : `observer${observerIndex}`}.observe(element);`,
  ).join("\n");
  const releases = hasSharedReceiver
    ? "observer.disconnect();"
    : Array.from(
        { length: observerCount },
        (_, observerIndex) => `observer${observerIndex}.disconnect();`,
      ).join("\n");
  const factoryBody = `${declarations} ${registrations} return () => { ${releases} };`;
  const effectBody = hasStoredDisposer
    ? `let release = () => {}; const createObservers = () => { ${factoryBody} };
       release = createObservers(); const cleanup = () => release(); return () => cleanup();`
    : factoryBody;
  return `import { useEffect } from "react";
    export const Component = ({ element }) => {
      useEffect(() => { ${effectBody} }, [element]); return null;
    };`;
};

afterEach(() => vi.restoreAllMocks());

describe("observer cleanup operation growth", () => {
  describe.each([false, true])("stored disposer: %s", (hasStoredDisposer) => {
    it.each([16, 64, 256])(
      hasStoredDisposer
        ? "bounds stored-disposer cleanup walks for %s observers"
        : "preserves direct cleanup for %s observers",
      (observerCount) => {
        const walker = hasStoredDisposer ? vi.spyOn(astWalker, "walkAst") : null;
        const result = runRule(
          effectNeedsCleanup,
          createObserverCleanupEffect(observerCount, hasStoredDisposer),
          { filename: "/app/src/observer-cleanup-work.tsx", includeLocations: true },
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        const cleanupBodyWalks = walker?.mock.calls.filter(
          ([root]) =>
            isNodeOfType(root, "BlockStatement") &&
            root.body.length === observerCount &&
            root.body.every(
              (statement) =>
                isNodeOfType(statement, "ExpressionStatement") &&
                isNodeOfType(statement.expression, "CallExpression") &&
                isNodeOfType(statement.expression.callee, "MemberExpression") &&
                isNodeOfType(statement.expression.callee.property, "Identifier") &&
                statement.expression.callee.property.name === "disconnect",
            ),
        );
        if (cleanupBodyWalks) expect(cleanupBodyWalks.length).toBeLessThanOrEqual(2);
      },
    );
  });

  it.each([16, 64, 256])("keeps one receiver with %s registrations supported", (observerCount) => {
    const result = runRule(
      effectNeedsCleanup,
      createObserverCleanupEffect(observerCount, true, true),
      { filename: "/app/src/shared-observer-cleanup-work.tsx", includeLocations: true },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a shared receiver with a long type wrapper supported", () => {
    let initializer = "new IntersectionObserver(() => {})";
    for (let wrapperIndex = 0; wrapperIndex < 256; wrapperIndex += 1) {
      initializer = `(${initializer} as unknown)`;
    }
    const source = createObserverCleanupEffect(256, true, true).replace(
      "new IntersectionObserver(() => {})",
      initializer,
    );
    const result = runRule(effectNeedsCleanup, source, {
      filename: "/app/src/shared-observer-wrapper-work.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "return () => {};",
    "const other = new IntersectionObserver(() => {}); return () => other.disconnect();",
  ])("still reports an observer without a matching release: %s", (cleanup) => {
    const source = `import { useEffect } from "react";
      export const Component = ({ element }) => {
        useEffect(() => {
          const observer = new IntersectionObserver(() => {});
          observer.observe(element); ${cleanup}
        }, [element]); return null;
      };`;
    const result = runRule(effectNeedsCleanup, source, {
      filename: "/app/src/observer-cleanup-negative.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
