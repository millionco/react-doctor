import { describe, expect, it } from "vite-plus/test";
import { attachParentReferences } from "../../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isOwnedObjectCallbackDataConsumer } from "./is-owned-object-callback-data-consumer.js";

interface CallbackDataCase {
  readonly name: string;
  readonly source: string;
  readonly expected: boolean;
}

const DISPATCHER = `const choose = (candidate, data) => {
  if (typeof candidate === "function") return candidate(data);
  const { check: inspect, error } = candidate;
  const message = inspect(data);
  return message ? error || message : "";
};`;
const BODY = `const { attributes } = record;
  const data = { ...attributes, value: attributes.value };
  const message = choose(checks[position], data);
  return message;`;
const BASE = `${DISPATCHER}
const collect = (record, checks, position) => { ${BODY} };`;
const CASES: ReadonlyArray<CallbackDataCase> = [
  { name: "ordinary two-arm data dispatcher", source: BASE, expected: true },
  {
    name: "direct callable input remains a data purpose",
    source: BASE.replace("checks[position]", "checks"),
    expected: true,
  },
  {
    name: "truthy data result",
    source: BASE.replace("return message;", "return !!message;"),
    expected: true,
  },
  {
    name: "JSX text result",
    source: BASE.replace("return message;", "return <span>{message}</span>;"),
    expected: true,
  },
  {
    name: "string is not the selected callback-data source",
    source: BASE.replace("checks[position]", "'code'"),
    expected: false,
  },
  {
    name: "native receiver cannot be supplied",
    source: BASE.replace("attributes.value", "document.body"),
    expected: false,
  },
  {
    name: "global callable cannot be supplied as data",
    source: BASE.replace("attributes.value", "Function"),
    expected: false,
  },
  {
    name: "effectful argument object override",
    source: BASE.replace("attributes.value", "acquire()"),
    expected: false,
  },
  {
    name: "dispatcher extra work",
    source: BASE.replace(
      "const message = inspect(data);",
      "foreign(); const message = inspect(data);",
    ),
    expected: false,
  },
  { name: "dispatcher alias escape", source: BASE + "\nconst alias = choose;", expected: false },
  {
    name: "direct result invocation",
    source: BASE.replace("return message;", "return message();"),
    expected: false,
  },
  {
    name: "result new transport",
    source: BASE.replace("return message;", "return new message();"),
    expected: false,
  },
  {
    name: "result call transport",
    source: BASE.replace("return message;", "return message.call(null);"),
    expected: false,
  },
  {
    name: "result event attribute",
    source: BASE.replace("return message;", "return <button onClick={message} />;"),
    expected: false,
  },
  {
    name: "result ref attribute",
    source: BASE.replace("return message;", "return <div ref={message} />;"),
    expected: false,
  },
  {
    name: "object container result invocation",
    source: BASE.replace(
      "const message = choose(checks[position], data);\n  return message;",
      "const bucket = { message: choose(checks[position], data) }; return bucket.message();",
    ),
    expected: false,
  },
  {
    name: "record extracted result invocation",
    source: BASE.replace(
      "const message = choose(checks[position], data);\n  return message;",
      "const errors = {}; errors.message = choose(checks[position], data); const invoke = errors.message; return invoke();",
    ),
    expected: false,
  },
  {
    name: "record opaque callback consumer",
    source: BASE.replace(
      "const message = choose(checks[position], data);\n  return message;",
      "const errors = {}; errors[position] = choose(checks[position], data); return Object.values(errors).some(value => value());",
    ),
    expected: false,
  },
  {
    name: "data record escape",
    source: BASE.replace("return message;", "publish(data); return message;"),
    expected: false,
  },
  {
    name: "direct IIFE outward data result",
    source: `${DISPATCHER} const collect=(record,checks,position)=>((record)=>{${BODY}})(record);`,
    expected: true,
  },
  {
    name: "direct IIFE returned result invoked",
    source: `${DISPATCHER} const collect=(record,checks,position)=>((record)=>{${BODY}})(record)();`,
    expected: false,
  },
  {
    name: "opaque map initializer",
    source: BASE.replace(
      "const message = choose(checks[position], data);\n  return message;",
      "const errors = acquire(); errors[position] = choose(checks[position], data);",
    ),
    expected: false,
  },
  {
    name: "parameter map destination",
    source: BASE.replace(
      "(record, checks, position)",
      "(record, checks, position, errors)",
    ).replace(
      "const message = choose(checks[position], data);\n  return message;",
      "errors[position] = choose(checks[position], data);",
    ),
    expected: false,
  },
  {
    name: "own fresh React error map data boundary",
    source: `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const errors={}; errors[position]=choose(checks[position],data); this.setState({errors}); } }`,
    expected: true,
  },
  {
    name: "constructor-owned empty state error map",
    source: `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`,
    expected: true,
  },
  {
    name: "opaque constructor state error map",
    source:
      `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`.replace(
        "errors:{}",
        "errors:acquire()",
      ),
    expected: false,
  },
  {
    name: "whole state replacement",
    source:
      `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`.replace(
        "const {attributes}",
        "this.state={errors:foreign}; const {attributes}",
      ),
    expected: false,
  },
  {
    name: "selected state field replacement",
    source:
      `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`.replace(
        "const {attributes}",
        "this.state.errors=foreign; const {attributes}",
      ),
    expected: false,
  },
  {
    name: "unknown computed this setter replacement",
    source:
      `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`.replace(
        "const {attributes}",
        "const key=['setState'][0]; this[key]=foreign; const {attributes}",
      ),
    expected: false,
  },
  {
    name: "raw this alias mutation",
    source:
      `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`.replace(
        "const {attributes}",
        "const receiver=this; receiver.setState=foreign; const {attributes}",
      ),
    expected: false,
  },
  {
    name: "state callback slot is not a data boundary",
    source: `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { collect(record,checks,position){ const {attributes}=record; const data={...attributes,value:attributes.value}; const errors={}; errors[position]=choose(checks[position],data); this.setState({}, {errors}); } }`,
    expected: false,
  },
  {
    name: "opaque selected field setState replacement",
    source: `import {Component} from "react"; ${DISPATCHER} class Panel extends Component { constructor(props){super(props);this.state={errors:{},valid:false};} collect(record,checks,position){ this.setState({errors:acquire()}); const {attributes}=record; const data={...attributes,value:attributes.value}; const {errors}=this.state; const currentErrors=errors; currentErrors[position]=choose(checks[position],data); this.setState({errors:currentErrors}); } }`,
    expected: false,
  },
  {
    name: "known prototype input",
    source: BASE.replace("checks[position]", "checks.constructor"),
    expected: false,
  },
];

describe("isOwnedObjectCallbackDataConsumer", () => {
  for (const fixture of CASES)
    it(fixture.name, () => {
      const parsed = parseFixture(fixture.source);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      if (!isNodeOfType(parsed.program, "Program")) throw new Error("Expected program");
      const module = {
        filePath: "/synthetic/callback-data.tsx",
        programNode: parsed.program,
        scopes: analyzeScopes(parsed.program),
      };
      const nativeValue = (raw: EsTreeNode): boolean => {
        const value = stripParenExpression(raw);
        if (isNodeOfType(value, "Identifier"))
          return (
            module.scopes.isGlobalReference(value) && ["document", "window"].includes(value.name)
          );
        if (isNodeOfType(value, "MemberExpression")) return nativeValue(value.object);
        if (isNodeOfType(value, "CallExpression")) return nativeValue(value.callee);
        return false;
      };
      const callableValue = (raw: EsTreeNode): boolean => {
        const value = stripParenExpression(raw);
        if (isNodeOfType(value, "Identifier"))
          return (
            module.scopes.isGlobalReference(value) &&
            ["Function", "eval", "parseInt", "Number"].includes(value.name)
          );
        return (
          isNodeOfType(value, "MemberExpression") &&
          ["constructor", "call", "apply", "bind"].includes(getStaticPropertyName(value) ?? "")
        );
      };
      const results: boolean[] = [];
      walkAst(parsed.program, (node) => {
        if (
          !isNodeOfType(node, "CallExpression") ||
          !isNodeOfType(node.callee, "Identifier") ||
          node.callee.name !== "choose"
        )
          return;
        const [argument] = node.arguments;
        if (!argument) throw new Error("Expected callback argument");
        results.push(
          isOwnedObjectCallbackDataConsumer({
            call: node,
            argument,
            module,
            isNativeValue: nativeValue,
            isKnownCallableReceiver: callableValue,
          }),
        );
      });
      expect(results).toEqual([fixture.expected]);
    });
});
