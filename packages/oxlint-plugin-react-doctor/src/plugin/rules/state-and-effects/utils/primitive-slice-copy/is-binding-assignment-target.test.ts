import { describe, expect, it } from "vite-plus/test";
import { parseFixture } from "../../../../../test-utils/parse-fixture.js";
import { attachParentReferences } from "../../../../../test-utils/attach-parent-references.js";
import { analyzeScopes } from "../../../../semantic/scope-analysis.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";

const cases = [
  { code: "let selected; ({selected}=source);", expected: true },
  { code: "let selected; ({value:selected}=source);", expected: true },
  { code: 'let selected; ({selected="fallback"}=source);', expected: true },
  { code: "let selected; [selected]=source;", expected: true },
  { code: "let selected; [...selected]=source;", expected: true },
  { code: "let selected; ({...selected}=source);", expected: true },
  { code: "let selected; for(selected of values) {}", expected: true },
  { code: "let selected; for(selected in values) {}", expected: true },
  { code: "let selected; selected++;", expected: true },
  { code: "let selected; selected=source;", expected: true },
  { code: "let selected; target[selected]=value;", expected: false },
  { code: "let selected; ({[selected]:other}=source);", expected: false },
  { code: "let selected; target.value=selected;", expected: false },
];

describe("primitive slice binding assignment targets", () => {
  it.each(cases)("$code", ({ code, expected }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const selected = scopes.rootScope.symbols.find((symbol) => symbol.name === "selected");
    expect(selected?.references.length).toBeGreaterThan(0);
    const targets = selected?.references.map((reference) =>
      isBindingAssignmentTarget(reference.identifier),
    );
    expect(targets?.some(Boolean)).toBe(expected);
  });
});
