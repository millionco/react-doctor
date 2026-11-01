import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMutatingArrayMethodOnPropOrHookResult } from "./no-mutating-array-method-on-prop-or-hook-result.js";

interface ParameterCase {
  readonly label: string;
  readonly source: string;
  readonly expected: number;
}

const parameterCases: ReadonlyArray<ParameterCase> = [
  {
    label: "first destructured prop",
    source: "function Panel({items}, context){items.splice(0,1);return null;}",
    expected: 1,
  },
  {
    label: "first prop member",
    source: "function Panel(props, context){props.items.reverse();return null;}",
    expected: 1,
  },
  {
    label: "first nested default binding",
    source: "function Panel({data:{items=[]}}={}, context){items.sort();return null;}",
    expected: 1,
  },
  {
    label: "first default prop alias",
    source:
      "function Panel(props={}, context){const items=props.items;items.reverse();return null;}",
    expected: 1,
  },
  {
    label: "first runtime prop after typed this",
    source: "function Panel(this:void,{items},context){items.sort();return null;}",
    expected: 1,
  },
  {
    label: "second destructured context",
    source:
      "function Panel(props,{entries}){entries.splice(0,1);return null;}Panel.contextTypes={entries:Array};",
    expected: 0,
  },
  {
    label: "second context member",
    source: "function Panel(props,context){context.entries.reverse();return null;}",
    expected: 0,
  },
  {
    label: "second context default",
    source: "function Panel(props,{entries=[]}={}){entries.sort();return null;}",
    expected: 0,
  },
  {
    label: "second context alias",
    source:
      "function Panel(props,context){const entries=context.entries;entries.splice(0,1);return null;}",
    expected: 0,
  },
  {
    label: "second context callback capture",
    source: "function Panel(props,{entries}){useMemo(()=>{entries.splice(0,1);},[]);return null;}",
    expected: 0,
  },
  {
    label: "third component input",
    source: "function Panel(props,context,entries){entries.sort();return null;}",
    expected: 0,
  },
  {
    label: "second runtime input after typed this",
    source: "function Panel(this:void,props,{entries}){entries.reverse();return null;}",
    expected: 0,
  },
  {
    label: "component first prop and second context",
    source: "function Panel({items},{entries}){items.sort();entries.sort();return null;}",
    expected: 1,
  },
  {
    label: "arrow component context",
    source: "const Panel=(props,{entries})=>{entries.splice(0,1);return null;};",
    expected: 0,
  },
  {
    label: "function expression component context",
    source: "const Panel=function(props,{entries}){entries.reverse();return null;};",
    expected: 0,
  },
  {
    label: "forwardRef first props",
    source: "const Panel=forwardRef(({items},ref)=>{items.sort();return null;});",
    expected: 1,
  },
  {
    label: "forwardRef second input",
    source: "const Panel=forwardRef((props,ref)=>{ref.entries.splice(0,1);return null;});",
    expected: 0,
  },
  {
    label: "nested component wrappers",
    source: "const Panel=memo(forwardRef((props,ref)=>{ref.entries.reverse();return null;}));",
    expected: 0,
  },
  {
    label: "hook second array input",
    source: "function useRows(options,items){items.sort();return items;}",
    expected: 1,
  },
  {
    label: "hook third nested input",
    source: "function useRows(options,enabled,{items}){items.splice(0,1);return items;}",
    expected: 1,
  },
  {
    label: "hook default second input",
    source: "function useRows(options,{items=[]}={}){items.reverse();return items;}",
    expected: 1,
  },
  {
    label: "arrow hook second input",
    source: "const useRows=(options,items)=>{items.sort();return items;};",
    expected: 1,
  },
  {
    label: "named hook expression second input",
    source: "const useRows=function useRows(options,items){items.reverse();return items;};",
    expected: 1,
  },
  {
    label: "named expression component marker takes precedence",
    source: "const useRows=function Panel(options,items){items.sort();return items;};",
    expected: 0,
  },
  {
    label: "named expression hook marker takes precedence",
    source: "const Panel=function useRows(options,items){items.sort();return items;};",
    expected: 1,
  },
  {
    label: "first rest binding materializes a copy",
    source: "function Panel(...items){items.sort();return null;}",
    expected: 0,
  },
  {
    label: "nested callback parameter stays unrelated",
    source:
      "function Panel(props,context){const read=useCallback(items=>items.sort(),[]);return null;}",
    expected: 0,
  },
  {
    label: "shadowed nested parameter stays unrelated",
    source: "function Panel({items},context){const read=items=>items.sort();return null;}",
    expected: 0,
  },
  {
    label: "plain utility parameter",
    source: "function processRows(options,items){items.sort();return items;}",
    expected: 0,
  },
  {
    label: "local hook array preserves hook origin",
    source:
      "function Panel(props,context){const [items,setItems]=useState([]);items.splice(0,1);return null;}",
    expected: 1,
  },
];

describe("no-mutating-array-method-on-prop-or-hook-result parameter origins", () => {
  it.each(parameterCases)("$label", ({ source, expected }) => {
    const result = runRule(noMutatingArrayMethodOnPropOrHookResult, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
