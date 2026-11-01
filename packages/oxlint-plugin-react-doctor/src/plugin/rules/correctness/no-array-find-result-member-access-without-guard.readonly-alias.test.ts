import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

interface FindAliasCase {
  name: string;
  code: string;
  expectedCount: number;
}

const commonOptions: RunRuleOptions = {
  filename: "independent-find-result.tsx",
  forceJsx: true,
  includeLocations: true,
  settings: { "react-doctor": { capabilities: ["react"] } },
};

const cases: FindAliasCase[] = [
  {
    name: "readonly-find-result-alias",
    code: "const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected); return <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "direct-find-result-positive",
    code: "const Label = ({ items, selected }) => <span>{items.find((item) => item.id === selected).label}</span>;",
    expectedCount: 1,
  },
  {
    name: "alias-truthy-branch",
    code: "const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected); return found ? <span>{found.label}</span> : null; };",
    expectedCount: 0,
  },
  {
    name: "alias-early-return-guard",
    code: "const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected); if (!found) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "alias-optional-member",
    code: "const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected); return <span>{found?.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "fallback-initializer-abstention",
    code: 'const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected) ?? { label: "none" }; return <span>{found.label}</span>; };',
    expectedCount: 0,
  },
  {
    name: "custom-object-find-abstention",
    code: 'const Label = () => { const directory = { find: () => ({ label: "ready" }) }; const found = directory.find((item) => item.enabled); return <span>{found.label}</span>; };',
    expectedCount: 0,
  },
  {
    name: "pascal-case-producer-abstention",
    code: "const Label = ({ Catalog }) => { const found = Catalog.find((item) => item.enabled); return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "mutable-result-abstention",
    code: 'const Label = ({ items }) => { let found = items.find((item) => item.enabled); found = { label: "ready" }; return <span>{found.label}</span>; };',
    expectedCount: 0,
  },
  {
    name: "opaque-assertion-transport-abstention",
    code: "const Label = ({ items, ensure }) => { const found = items.find((item) => item.enabled); ensure(found); return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "shadowed-result-is-not-find",
    code: 'const Label = ({ items }) => { const found = items.find((item) => item.enabled); { const found = { label: "ready" }; return <span>{found.label}</span>; } };',
    expectedCount: 0,
  },
  {
    name: "readonly-find-last-result-alias",
    code: "const Label = ({ items, selected }) => { const found = items.findLast((item) => item.id === selected); return <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "different-binding-guard-does-not-prove-presence",
    code: "const Label = ({ items, selected }) => { const found = items.find((item) => item.id === selected); const other = items.find((item) => item.enabled); return other ? <span>{found.label}</span> : null; };",
    expectedCount: 1,
  },
  {
    name: "projected-options-do-not-prove-callback-input",
    code: "const Picker = ({ items, onPick }) => <Choice options={items.map((item) => item.id)} onSelect={(selection) => { const found = items.find((item) => item.id === selection[0]); onPick(found.label); }} />;",
    expectedCount: 1,
  },
  {
    name: "if-alias-truthy",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found) return <span>{found.label}</span>; return null; };",
    expectedCount: 0,
  },
  {
    name: "typeof-guard-abstention",
    code: 'const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (typeof found === "object") return <span>{found.label}</span>; return null; };',
    expectedCount: 0,
  },
  {
    name: "undefined-positive-guard",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return found !== undefined ? <span>{found.label}</span> : null; };",
    expectedCount: 0,
  },
  {
    name: "nullish-positive-guard",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return found != null ? <span>{found.label}</span> : null; };",
    expectedCount: 0,
  },
  {
    name: "undefined-early-exit",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found === undefined) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "nullish-early-exit",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found == null) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "null-only-not-undefined-proof",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found === null) return null; return <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "shadowed-undefined-not-a-proof",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); const undefined = marker; if (found === undefined) return null; return <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "negated-else-guard",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (!found) return null; else return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "truthy-or-alternate-is-unsafe",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return found || <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "negated-or-right-guard",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return !found || <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "compound-and-guard",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return found && enabled && <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "compound-or-not-a-proof",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return (found || enabled) && <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "array-assignment-target-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); [found] = replacements; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "object-assignment-target-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); ({ current: found } = replacement); return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "loop-pattern-target-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); for ([found] of replacements) {} return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "member-write-abstention",
    code: 'const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); found.label = "ready"; return <span>{found.label}</span>; };',
    expectedCount: 0,
  },
  {
    name: "capture-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); const render = () => found.label; return <span>{render()}</span>; };",
    expectedCount: 0,
  },
  {
    name: "whole-return-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (enabled) return found; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "second-alias-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); const selected = found; return <span>{selected.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "non-null-assertion-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>{found!.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "wrapped-binding-read",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>{(found as { label: string }).label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "computed-property-read",
    code: 'const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>{found["label"]}</span>; };',
    expectedCount: 1,
  },
  {
    name: "member-method-receiver-read",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>{found.getLabel()}</span>; };",
    expectedCount: 1,
  },
  {
    name: "unconsumed-result",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>Ready</span>; };",
    expectedCount: 0,
  },
  {
    name: "module-binding-abstention",
    code: "const found = items.find((item) => item.enabled); const Label = () => <span>{found.label}</span>;",
    expectedCount: 0,
  },
  {
    name: "truthy-boolean-array-exception",
    code: 'const Label = ({ override }) => { const found = [override, "ready"].find(Boolean); return <span>{found.label}</span>; };',
    expectedCount: 0,
  },
  {
    name: "native-mutating-repeated-predicate-does-not-guard-readonly-alias",
    code: 'const Label = () => { const rows = [{ label: "ready", enabled: true }]; let calls = 0; if (rows.some(() => ++calls === 1)) { const found = rows.find(() => ++calls === 1); return <span>{found.label}</span>; } return null; };',
    expectedCount: 1,
  },
  {
    name: "native-pure-repeated-predicate-guards-readonly-alias",
    code: 'const Label = () => { const rows = [{ label: "ready", enabled: true }]; if (rows.some((row) => row.enabled)) { const found = rows.find((row) => row.enabled); return <span>{found.label}</span>; } return null; };',
    expectedCount: 0,
  },
  {
    name: "same-find-guard-retained",
    code: "const Label = ({ items, predicate }) => { if (items.find(predicate)) { const found = items.find(predicate); return <span>{found.label}</span>; } return null; };",
    expectedCount: 0,
  },
  {
    name: "genuine-eval-read-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); void eval; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "nested-non-null-wrapper-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <span>{(found! as { label: string }).label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "void-comparison-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found === void 0) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "type-query-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); let selected: typeof found; return <span>{found.label}</span>; };",
    expectedCount: 1,
  },
  {
    name: "destructured-result-abstention",
    code: "const Label = ({ items }) => { const { label } = items.find((item) => item.enabled); return <span>{label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "var-binding-abstention",
    code: "const Label = ({ items }) => { var found = items.find((item) => item.enabled); return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "whole-value-jsx-prop-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); return <Choice value={found} label={found.label} />; };",
    expectedCount: 0,
  },
  {
    name: "optional-earlier-read-abstention",
    code: "const Label = ({ items, marker, enabled, replacements, replacement }) => { const found = items.find((item) => item.enabled); if (found?.enabled) return <span>{found.label}</span>; return null; };",
    expectedCount: 0,
  },
  {
    name: "derived-boolean-guard-abstention",
    code: "const Label = ({ items }) => { const found = items.find((item) => item.enabled); const present = !found; if (present === false) return <span>{found.label}</span>; return null; };",
    expectedCount: 0,
  },
  {
    name: "double-negation-guard-abstention",
    code: "const Label = ({ items }) => { const found = items.find((item) => item.enabled); if (!!found) return <span>{found.label}</span>; return null; };",
    expectedCount: 0,
  },
  {
    name: "null-first-compound-absence-abstention",
    code: "const Label = ({ items }) => { const found = items.find((item) => item.enabled); if (found === null || found === undefined) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
  {
    name: "undefined-first-compound-absence-abstention",
    code: "const Label = ({ items }) => { const found = items.find((item) => item.enabled); if (found === undefined || found === null) return null; return <span>{found.label}</span>; };",
    expectedCount: 0,
  },
];

describe("readonly local find result aliases", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = runRule(
        noArrayFindResultMemberAccessWithoutGuard,
        testCase.code,
        commonOptions,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
    });
  }
});
