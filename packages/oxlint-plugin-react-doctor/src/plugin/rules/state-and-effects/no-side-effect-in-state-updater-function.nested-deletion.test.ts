import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideEffectInStateUpdaterFunction } from "./no-side-effect-in-state-updater-function.js";

const checkDraft = (updaterBody: string) =>
  runRule(
    noSideEffectInStateUpdaterFunction,
    `import { useState } from 'react';
     export function Panel({ items, omit, id, save }) {
       const [entries, setEntries] = useState({ byKey: { one: { shown: true } } });
       const update = () => setEntries((previous) => { ${updaterBody} });
       return <button onClick={update}>{Object.keys(entries.byKey).length}</button>;
     }`,
    { filename: "Panel.tsx" },
  ).diagnostics;

const clone = "if (draft === previous) draft = { ...previous, byKey: { ...previous.byKey } };";

describe("deletion from a copied state dictionary", () => {
  it("allows a guarded deletion when a loop retains the same copy", () => {
    expect(
      checkDraft(`
      let draft = previous;
      for (const item of items) {
        if (!item.expired) continue;
        ${clone}
        if (omit) delete draft.byKey[item.key];
      }
      return draft;
    `),
    ).toHaveLength(0);
  });

  it("still reports a computed assignment alongside the deletion", () => {
    expect(
      checkDraft(`
      let draft = previous;
      ${clone}
      if (omit) delete draft.byKey[id];
      else draft.byKey[id] = { shown: false };
      return draft;
    `),
    ).toHaveLength(1);
  });

  it.each([
    `let draft = previous; if (draft !== previous) draft = { ...previous, byKey: { ...previous.byKey } }; delete draft.byKey[id];`,
    `let draft = previous; if (draft === previous) draft = { ...previous }; delete draft.byKey[id];`,
    `let draft = previous; ${clone} delete draft.byKey[id].shown;`,
    `let { draft } = previous; ${clone} delete draft.byKey[id];`,
    `let draft = previous; ${clone} if ((eval('draft = previous'), omit)) delete draft.byKey[id];`,
    `let draft = previous; ${clone} if (omit) { save(draft); delete draft.byKey[id]; }`,
  ])("retains the warning when the deletion can reach old state", (body) => {
    expect(checkDraft(`${body} return draft;`).length).toBeGreaterThan(0);
  });
});
