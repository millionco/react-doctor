import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

describe("parent data provenance — native initializer and memo parity", () => {
  it.each([
    {
      name: "live-async-helper-assigned-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(); useEffect(() => { const update = async () => { let value; value = state.value; onChange({ ...config, value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "live-async-helper-direct-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(); useEffect(() => { const update = async () => { onChange({ ...config, value: state.value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "live-async-helper-const-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(); useEffect(() => { const update = async () => { const value = state.value; onChange({ ...config, value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-local-constant-array-includes",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect } from 'react'; export function Child({ items, onChange }) { useEffect(() => { const allowed = ['a', 'b']; const filtered = items.filter(item => allowed.includes(item.kind)); onChange(filtered); }, [items]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-string-read-local-constants",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect } from 'react'; export function Child({ items, onChange }) { useEffect(() => { const allowed = ['a', 'b']; const filtered = items.filter(item => !(allowed.includes(item.kind) && allowed.includes(item.value.toString()))); onChange(filtered); }, [items]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-child-set-has",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect } from 'react'; export function Child({ items, onChange }) { useEffect(() => { const allowed = new Set(['a', 'b']); const filtered = items.filter(item => allowed.has(item.kind)); onChange(filtered); }, [items]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-map-imported-converter",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert } from 'data-library'; export function Child({ items, onChange }) { const value = useMemo(() => items.map(item => convert(item)), [items]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-map-local-converted-return",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert, isDefined } from 'data-library'; export function Child({ items, onChange }) { const value = useMemo(() => { const filtered = items.filter(item => item.enabled); return filtered.map(item => { const extra = items.find(other => other.id === item.id); return convert(item, extra); }).filter(isDefined); }, [items]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-map-for-of-item",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert } from 'data-library'; export function Child({ items, onChange }) { const value = useMemo(() => items.map(item => convert(item)), [items]); useEffect(() => { for (const item of value) onChange(item); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 245,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-nested-imported-transform",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo, useState } from 'react'; import { normalize } from 'data-library'; export function Child({ items, onChange }) { const [search] = useState(''); const value = useMemo(() => { const term = normalize(search); return items.filter(item => normalize(item.label).includes(term)); }, [items, search]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 340,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-nested-local-string",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo, useState } from 'react'; export function Child({ items, onChange }) { const [search] = useState(''); const value = useMemo(() => { const term = search.trim(); return items.filter(item => item.label.includes(term)); }, [items, search]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 283,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-nested-imported-transform-chain",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo, useState } from 'react'; import { normalize } from 'data-library'; export function Child({ items, initial, onChange }) { const [search] = useState(''); const [selected] = useState(initial); const filtered = useMemo(() => { const term = normalize(search); return items.filter(item => item.value !== selected?.value && normalize(item.label).includes(term)); }, [items, search, selected]); const value = useMemo(() => selected ? [selected, ...filtered] : filtered, [selected, filtered]); useEffect(() => { onChange?.(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 532,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "live-seeded-async-helper-assigned-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(config); useEffect(() => { const update = async () => { let value; value = state.value; onChange({ ...config, value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "live-seeded-async-helper-direct-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(config); useEffect(() => { const update = async () => { onChange({ ...config, value: state.value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [
        {
          column: 252,
          line: 1,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "live-seeded-async-helper-const-state",
      ruleId: "no-pass-live-state-to-parent",
      source:
        "import { useEffect } from 'react'; import { useRemote } from 'state-library'; export function Child({ config, onChange }) { const state = useRemote(config); useEffect(() => { const update = async () => { const value = state.value; onChange({ ...config, value }); }; update(); }, [state]); return null; }",
      expectedDiagnostics: [
        {
          column: 266,
          line: 1,
          message:
            "Pushing state up to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "for-of-parent-items-data-leaf",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect } from 'react'; export function Child({ items, onChange }) { useEffect(() => { for (const item of items) onChange(item); }, [items]); return null; }",
      expectedDiagnostics: [
        {
          column: 124,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-local-initializer-converter",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; import { convert } from 'data-library'; export function Child({ items, onChange }) { const value = useMemo(() => { const mapped = items.map(item => convert(item)); return mapped; }, [items]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-filter-state-nested-no-local",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo, useState } from 'react'; export function Child({ items, onChange }) { const [search] = useState(''); const value = useMemo(() => items.filter(item => item.label.includes(search)), [items, search]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 245,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-local-constant-term",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; export function Child({ items, onChange }) { const value = useMemo(() => { const term = 'a'; return items.filter(item => item.label.includes(term)); }, [items]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "memo-parent-filter-unused-local-imported-transform",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo, useState } from 'react'; import { normalize } from 'data-library'; export function Child({ items, onChange }) { const [search] = useState(''); const value = useMemo(() => { const term = normalize(search); return items.filter(item => item.enabled); }, [items, search]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [
        {
          column: 316,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "memo-parent-filter-unknown-member-converter",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect, useMemo } from 'react'; export function Child({ items, onChange }) { const value = useMemo(() => items.filter(item => item.label.normalize()), [items]); useEffect(() => { onChange(value); }, [value]); return null; }",
      expectedDiagnostics: [],
    },
    {
      name: "parent-filter-logical-initializer-child-set",
      ruleId: "no-pass-data-to-parent",
      source:
        "import { useEffect } from 'react'; export function Child({ items, onChange }) { const allowed = new Set(['a']); useEffect(() => { const value = items.filter(item => allowed.has(item.id)) || []; onChange(value); }, [items]); return null; }",
      expectedDiagnostics: [
        {
          column: 194,
          line: 1,
          message:
            "Handing data back to a parent from a useEffect costs your users an extra render.",
          nodeType: "CallExpression",
        },
      ],
    },
  ])("$name", ({ ruleId, source, expectedDiagnostics }) => {
    const rule = ruleId === "no-pass-data-to-parent" ? noPassDataToParent : noPassLiveStateToParent;
    const result = runRule(rule, source, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(expectedDiagnostics);
  });
});
