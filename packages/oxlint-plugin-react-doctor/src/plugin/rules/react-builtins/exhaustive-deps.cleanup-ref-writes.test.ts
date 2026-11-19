import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const analyzeCleanup = (body: string) => {
  const result = runRule(
    exhaustiveDeps,
    `import { useEffect } from 'react';

    export function Example({ resources }: Props) {
      useEffect(() => {
        return () => {
          ${body}
        };
      }, [resources]);
    }`,
  );
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.map(({ message }) => message);
};

describe("exhaustive-deps cleanup ref reads", () => {
  it("accepts two plain writes to refs received through an object", () => {
    expect(
      analyzeCleanup("resources.left.current = false; resources.right.current! = false;"),
    ).toEqual([]);
  });

  it.each([
    [
      "a read after a write",
      "resources.left.current = false; consume(resources.right.current);",
      "right",
    ],
    ["an assignment value", "resources.left.current = resources.right.current;", "right"],
    ["a self-assignment value", "resources.left.current = resources.left.current;", "left"],
    ["a compound assignment", "resources.left.current += 1;", "left"],
    ["a logical assignment", "resources.left.current ||= true;", "left"],
    ["an update", "resources.left.current++;", "left"],
    ["a nested write", "resources.left.current.child.current = false;", "left"],
    ["a computed key", "target[resources.left.current] = false;", "left"],
    ["a computed receiver", "resources.left.current[key] = false;", "left"],
  ])("still reports %s", (_name, body, property) => {
    expect(analyzeCleanup(body)).toEqual([
      `Your cleanup may read the wrong node since the ref \`resources.${property}.current\` can change before it runs.`,
    ]);
  });
});
