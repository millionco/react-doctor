import {
  LOCAL_UTILITY_SMALL_CALL_COUNT,
  LOCAL_UTILITY_LARGE_CALL_COUNT,
  LOCAL_UTILITY_MAX_WORK_GROWTH_RATIO,
} from "../../../test-utils/constants.js";
import { describe, expect, it, vi } from "vite-plus/test";
import { defineRule } from "../../utils/define-rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import * as staticObjectProperty from "../../utils/get-static-object-property-value.js";
import { noMutatingArrayMethodOnPropOrHookResult } from "./no-mutating-array-method-on-prop-or-hook-result.js";

const cases = [
  {
    name: "owned-fresh-array-utility",
    source:
      'function drive(){"use strict";function Drain(rows){rows.reverse();}Drain([]);}drive();',
    warnings: 0,
  },
  {
    name: "react-props-passed-to-utility",
    source:
      'function App(props){"use strict";function Drain(request){request.items.splice(0,1);}Drain(props);return <div/>;}',
    warnings: 1,
  },
  {
    name: "react-prop-array-passed-to-utility",
    source:
      'function App({items}){"use strict";function Drain(rows){rows.reverse();}Drain(items);return <div/>;}',
    warnings: 1,
  },
  {
    name: "react-state-array-passed-to-utility",
    source:
      'import {useState} from "react";function App(){"use strict";const[items]=useState([]);function Drain(rows){rows.reverse();}Drain(items);return <div/>;}',
    warnings: 1,
  },
  {
    name: "react-memo-array-passed-to-utility",
    source:
      'import {useMemo} from "react";function App(props){"use strict";const items=useMemo(()=>props.items,[props.items]);function Drain(rows){rows.sort();}Drain(items);return <div/>;}',
    warnings: 1,
  },
  {
    name: "component-own-fresh-array-utility",
    source:
      'function App(){"use strict";function Drain(rows){rows.reverse();}Drain([]);return <div/>;}',
    warnings: 0,
  },
  {
    name: "props-array-via-local-alias",
    source:
      'function App(props){"use strict";const shared=props.items;function Drain(rows){rows.reverse();}Drain(shared);return <div/>;}',
    warnings: 1,
  },
  {
    name: "direct-memo-prop-array-control",
    source:
      'import {useMemo} from "react";function App(props){"use strict";const items=useMemo(()=>props.items,[props.items]);items.sort();return <div/>;}',
    warnings: 1,
  },
  {
    name: "direct-fresh-memo-policy-control",
    source:
      'import {useMemo} from "react";function App(){const items=useMemo(()=>[],[]);items.sort();return <div/>;}',
    warnings: 0,
  },
  {
    name: "self-recursive-only",
    source:
      'function drive(){"use strict";function Drain(rows){rows.reverse();Drain(rows);}}drive();',
    warnings: 1,
  },
  {
    name: "destructured-helper-parameter",
    source:
      'function App(props){"use strict";function Drain({items}){items.reverse();}Drain(props);return <div/>;}',
    warnings: 1,
  },
  {
    name: "nested-destructured-helper-parameter",
    source:
      'function App(props){"use strict";function Drain({data:{items}}){items.reverse();}Drain(props);return <div/>;}',
    warnings: 1,
  },
  {
    name: "defaulted-helper-property",
    source:
      'function App(props){"use strict";function Drain({items=[]}){items.reverse();}Drain(props);return <div/>;}',
    warnings: 1,
  },
  {
    name: "shared-array-in-object-argument",
    source:
      'function App(props){"use strict";function Drain(request){request.items.reverse();}Drain({items:props.items});return <div/>;}',
    warnings: 1,
  },
  {
    name: "shared-array-in-object-alias-argument",
    source:
      'function App(props){"use strict";const request={items:props.items};function Drain(value){value.items.reverse();}Drain(request);return <div/>;}',
    warnings: 1,
  },
  {
    name: "shared-array-in-array-argument",
    source:
      'function App(props){"use strict";function Drain(rows){rows[0].reverse();}Drain([props.items]);return <div/>;}',
    warnings: 1,
  },
  {
    name: "shared-rest-element",
    source:
      'function App(props){"use strict";function Drain(...rows){rows[0].reverse();}Drain(props.items);return <div/>;}',
    warnings: 1,
  },
  {
    name: "direct-call-spread-known-array",
    source:
      'function App(props){"use strict";function Drain(rows){rows.reverse();}Drain(...[props.items]);return <div/>;}',
    warnings: 1,
  },
  {
    name: "owned-fresh-object-argument",
    source:
      'function drive(){"use strict";function Drain(request){request.items.reverse();}Drain({items:[]});}drive();',
    warnings: 0,
  },
  {
    name: "owned-fresh-rest-array",
    source:
      'function drive(){"use strict";function Drain(...rows){rows.reverse();}Drain(1,2);}drive();',
    warnings: 0,
  },
  {
    name: "fresh-selected-field-with-shared-sibling",
    source:
      'function App(props){"use strict";function Drain(request){request.items.reverse();}Drain({items:[],other:props.items});return <div/>;}',
    warnings: 0,
  },
  {
    name: "shared-selected-field-with-fresh-sibling",
    source:
      'function App(props){"use strict";function Drain(request){request.items.reverse();}Drain({items:props.items,other:[]});return <div/>;}',
    warnings: 1,
  },
  {
    name: "caller-shared-rebound-fresh",
    source:
      'function App(props){"use strict";let items=props.items;items=[];function Drain(rows){rows.sort();}Drain(items);return <div/>;}',
    warnings: 0,
  },
  {
    name: "caller-fresh-rebound-shared",
    source:
      'function App(props){"use strict";let items=[];items=props.items;function Drain(rows){rows.sort();}Drain(items);return <div/>;}',
    warnings: 1,
  },
  {
    name: "three-caller-aliases",
    source:
      'function App(props){"use strict";const first=props.items;const second=first;const third=second;function Drain(rows){rows.sort();}Drain(third);return <div/>;}',
    warnings: 1,
  },
  {
    name: "utility-fresh-memo-policy",
    source:
      'import {useMemo} from "react";function App(){"use strict";const items=useMemo(()=>[],[]);function Drain(rows){rows.sort();}Drain(items);return <div/>;}',
    warnings: 0,
  },
  {
    name: "fresh-object-alias",
    source:
      'function drive(){"use strict";const request={items:[]};function Drain(value){value.items.reverse();}Drain(request);}drive();',
    warnings: 0,
  },
  {
    name: "fresh-destructured-param",
    source:
      'function drive(){"use strict";function Drain({items}){items.reverse();}Drain({items:[]});}drive();',
    warnings: 0,
  },
  {
    name: "unknown-spread-stays-conservative",
    source:
      'function App(props){"use strict";function Drain(request){request.items.reverse();}Drain({items:[],...props});return <div/>;}',
    warnings: 1,
  },
  {
    name: "known-field-after-spread",
    source:
      'function App(props){"use strict";function Drain(request){request.items.reverse();}Drain({...props,items:[]});return <div/>;}',
    warnings: 0,
  },
  {
    name: "caller-property-replaced",
    source:
      'function App(props){"use strict";const request={items:[]};request.items=props.items;function Drain(value){value.items.reverse();}Drain(request);return <div/>;}',
    warnings: 1,
  },
  {
    name: "caller-object-escapes",
    source:
      'function App(props){"use strict";const request={items:[]};mutate(request);function Drain(value){value.items.reverse();}Drain(request);return <div/>;}',
    warnings: 1,
  },
  {
    name: "utility-parameter-reassigned",
    source:
      'function App(props){"use strict";function Drain(rows){rows=props.items;rows.reverse();}Drain([]);return <div/>;}',
    warnings: 1,
  },
  {
    name: "utility-property-replaced",
    source:
      'function App(props){"use strict";function Drain(request){request.items=props.items;request.items.reverse();}Drain({items:[]});return <div/>;}',
    warnings: 1,
  },
  {
    name: "utility-container-escapes",
    source:
      'function App(props){"use strict";function Drain(request){mutate(request);request.items.reverse();}Drain({items:[]});return <div/>;}',
    warnings: 1,
  },
  {
    name: "destructured-member-shared-object",
    source:
      'function App(props){"use strict";function Drain(request){const {items}=request.nested;items.splice(0,1);}Drain({nested:{items:props.items}});return <div/>;}',
    warnings: 1,
  },
  {
    name: "destructured-member-shared-array",
    source:
      'function App(props){"use strict";function Drain(request){const [items]=request.rows;items.reverse();}Drain({rows:[props.items]});return <div/>;}',
    warnings: 1,
  },
  {
    name: "destructured-member-fresh-array",
    source:
      'function drive(){"use strict";function Drain(request){const [items]=request.rows;items.reverse();}Drain({rows:[[]]});}drive();',
    warnings: 0,
  },
  {
    name: "caller-fresh-then-shared-writes",
    source:
      'function App(props){"use strict";let items=props.items;items=[];items=props.items;function Drain(rows){rows.reverse();}Drain(items);return <div/>;}',
    warnings: 1,
  },
];

cases.push(
  ...[
    {
      name: "caller-extracted-ancestor",
      source:
        'function App(props){"use strict";const request={nested:{items:[]}};const {nested}=request;nested.items=props.items;function Drain(value){value.nested.items.reverse();}Drain(request);return <div/>;}',
      warnings: 1,
    },
    {
      name: "callee-extracted-ancestor",
      source:
        'function App(props){"use strict";function Drain(request){const {nested}=request;nested.items=props.items;request.nested.items.reverse();}Drain({nested:{items:[]}});return <div/>;}',
      warnings: 1,
    },
    {
      name: "caller-extracted-array-ancestor",
      source:
        'function App(props){"use strict";const request=[[[]]];const [nested]=request;nested[0]=props.items;function Drain(value){value[0][0].reverse();}Drain(request);return <div/>;}',
      warnings: 1,
    },
    {
      name: "caller-unknown-container-method",
      source:
        'function App(props){"use strict";const request={items:[],reset(next){this.items=next}};request.reset(props.items);function Drain(value){value.items.reverse();}Drain(request);return <div/>;}',
      warnings: 1,
    },
    {
      name: "caller-wrapped-escape",
      source:
        'function App(props){"use strict";const request={items:[]};mutate(flag?request:{});function Drain(value){value.items.reverse();}Drain(request);return <div/>;}',
      warnings: 1,
    },
    {
      name: "callee-wrapped-escape",
      source:
        'function App(props){"use strict";function Drain(request){mutate(flag?request:{});request.items.reverse();}Drain({items:[]});return <div/>;}',
      warnings: 1,
    },
    {
      name: "same-owned-object-repeated-calls",
      source:
        'function drive(){"use strict";const request={items:[]};function Drain(value){value.items.reverse();}Drain(request);Drain(request);}drive();',
      warnings: 0,
    },
    {
      name: "same-object-aliased-parameters",
      source:
        'function App(props){"use strict";const request={items:[]};function Drain(value,target){target.items=props.items;value.items.reverse();}Drain(request,request);return <div/>;}',
      warnings: 1,
    },
  ],
);

cases.push(
  ...[
    {
      name: "short-utility-call-chain",
      source:
        'function drive(){"use strict";function First(rows){Second(rows);}function Second(rows){rows.reverse();}First([]);}drive();',
      warnings: 0,
    },
    {
      name: "bounded-long-utility-call-chain",
      source:
        'function drive(){"use strict";function Utility0(rows){Utility1(rows);}function Utility1(rows){Utility2(rows);}function Utility2(rows){Utility3(rows);}function Utility3(rows){Utility4(rows);}function Utility4(rows){Utility5(rows);}function Utility5(rows){Utility6(rows);}function Utility6(rows){Utility7(rows);}function Utility7(rows){rows.reverse();}Utility0([]);}drive();',
      warnings: 1,
    },
    {
      name: "cyclic-utility-call-chain",
      source:
        'function drive(){"use strict";function First(rows){Second(rows);}function Second(rows){rows.reverse();First(rows);}First([]);}drive();',
      warnings: 1,
    },
  ],
);

describe("closed utility caller array provenance", () => {
  it.each(cases)("$name", ({ source, warnings }) => {
    const result = runRule(noMutatingArrayMethodOnPropOrHookResult, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(warnings);
  });

  it("resolves repeated mutations and direct callers without multiplicative projection work", () => {
    const measure = (size: number): number => {
      const projection = vi.spyOn(staticObjectProperty, "getStaticObjectPropertyValue");
      const mutations = Array.from({ length: size }, () => "request.items.reverse();").join("");
      const callers = Array.from({ length: size }, () => "Drain({items:[]});").join("");
      try {
        const result = runRule(
          noMutatingArrayMethodOnPropOrHookResult,
          `function drive(){"use strict";function Drain(request){${mutations}}${callers}}drive();`,
        );
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toEqual([]);
        return projection.mock.calls.length;
      } finally {
        projection.mockRestore();
      }
    };
    const small = measure(LOCAL_UTILITY_SMALL_CALL_COUNT);
    const large = measure(LOCAL_UTILITY_LARGE_CALL_COUNT);
    expect(small).toBe(LOCAL_UTILITY_SMALL_CALL_COUNT);
    expect(large).toBe(LOCAL_UTILITY_LARGE_CALL_COUNT);
    expect(large).toBeLessThanOrEqual(small * LOCAL_UTILITY_MAX_WORK_GROWTH_RATIO);
  });
});

it("keeps repeated readonly caller aliases within linear reference-proof work", () => {
  const measure = (size: number): number => {
    let reads = 0;
    const observed = new WeakSet<object>();
    const probe = defineRule({
      ...noMutatingArrayMethodOnPropOrHookResult,
      create: (context) => {
        const symbolFor = context.scopes.symbolFor;
        vi.spyOn(context.scopes, "symbolFor").mockImplementation((identifier) => {
          const symbol = symbolFor(identifier);
          if (symbol?.name === "ownedRows" && !observed.has(symbol)) {
            observed.add(symbol);
            for (const reference of symbol.references) {
              const flag = reference.flag;
              Object.defineProperty(reference, "flag", {
                get: () => {
                  reads += 1;
                  return flag;
                },
              });
            }
          }
          return symbol;
        });
        return noMutatingArrayMethodOnPropOrHookResult.create(context);
      },
    });
    const callers = Array.from({ length: size }, () => "Drain(ownedRows);").join("");
    const result = runRule(
      probe,
      `function drive(){"use strict";const ownedRows=[];function Drain(rows){rows.reverse();rows.reverse();rows.reverse();rows.reverse();}${callers}}drive();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    return reads;
  };
  const small = measure(LOCAL_UTILITY_SMALL_CALL_COUNT);
  const large = measure(LOCAL_UTILITY_LARGE_CALL_COUNT);
  expect(small).toBe(LOCAL_UTILITY_SMALL_CALL_COUNT);
  expect(large).toBe(LOCAL_UTILITY_LARGE_CALL_COUNT);
  expect(large).toBeLessThanOrEqual(small * LOCAL_UTILITY_MAX_WORK_GROWTH_RATIO);
});
