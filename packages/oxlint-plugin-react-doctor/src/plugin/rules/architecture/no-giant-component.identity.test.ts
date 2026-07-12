import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGiantComponent } from "./no-giant-component.js";

const buildComponent = (statementCount: number): string => `function ReactPhotoEditor() {
${Array.from(
  { length: statementCount },
  (_, statementIndex) => `const value${statementIndex} = ${statementIndex};`,
).join("\n")}
return <main />;
}`;

describe("no-giant-component — diagnostic identity", () => {
  it("keeps the message stable when only measured line count changes", () => {
    const before = runRule(noGiantComponent, buildComponent(468));
    const after = runRule(noGiantComponent, buildComponent(467));
    expect(before.parseErrors).toEqual([]);
    expect(after.parseErrors).toEqual([]);
    expect(before.diagnostics).toHaveLength(1);
    expect(after.diagnostics).toHaveLength(1);
    expect(after.diagnostics[0]?.message).toBe(before.diagnostics[0]?.message);
  });
});
