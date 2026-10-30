import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

const guardedCopy = `import { useState } from "react";
export const Inventory = ({ items, epoch, ready, onInspect }) => {
  const [record, setRecord] = useState({ epoch: 0, entries: {} });
  const apply = () => setRecord(prior => {
      let copied = prior.epoch !== epoch;
      let draft = copied ? {} : prior.entries;
      for (const item of items) {
        const entry = draft[item.id];
        if (!entry) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { caption: item.caption, expanded: false };
          copied = true;
        } else if (entry.caption !== item.caption) {
          if (!copied) draft = { ...draft };
          draft[item.id] = { ...entry, caption: item.caption, expanded: false };
          copied = true;
        }
      }
      return copied ? { epoch, entries: draft } : prior;
  });
  return <button onClick={apply}>{record.epoch}</button>;
};
`;

const settings = { "react-doctor": { portedRuleMode: "curated" } };

describe("guarded copies preserve runtime bindings", () => {
  it("ignores a type-only interface sharing the copy flag name", () => {
    const result = runRule(
      noSideEffectInStateUpdaterFunction,
      guardedCopy.replace(
        "      for (const item",
        "      interface copied {}\n      for (const item",
      ),
      { filename: "guarded-copy.tsx", settings },
    );
    expect(result).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it.each(["useState", "setRecord"])(
    "retains unsafe writes behind an erased %s interface",
    (bindingName) => {
      const code = guardedCopy
        .replace("  const apply", `  interface ${bindingName} {}\n  const apply`)
        .replace(
          "          if (!copied) draft = { ...draft };\n          draft[item.id] = { ...entry",
          "          draft[item.id] = { ...entry",
        );
      const result = runRule(noSideEffectInStateUpdaterFunction, code, {
        filename: "unsafe-guarded-copy.tsx",
        settings,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.map((diagnostic) => diagnostic.nodeType)).toEqual([
        "AssignmentExpression",
        "AssignmentExpression",
      ]);
    },
  );
});
