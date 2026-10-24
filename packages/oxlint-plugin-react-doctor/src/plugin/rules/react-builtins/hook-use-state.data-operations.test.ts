import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

describe("hook-use-state omitted setters with data operations", () => {
  it.each([
    'import {useState} from "react"; const removeEntry = (records, key) => { const {[key]: removed, ...remaining} = records; return remaining; }; export const Panel = ({records, selectedKey}) => { const [initialCount] = useState(records.length); return <section>{Object.keys(removeEntry(records, selectedKey)).length + initialCount}</section>; };',
    'import {useState} from "react"; export const Panel = (props) => { const [initialTitle] = useState(props.title); const labels = Object.keys(props.labels); return <section title={initialTitle}>{labels.join(",")}</section>; };',
    'import {useState} from "react"; export const Panel = ({registry, selectedKey}) => { const [handle] = useState(() => new Map()); handle.set(selectedKey, registry[selectedKey]); return <section>{handle.size}</section>; };',
    'import React from "react"; export const Panel = ({records, selectedKey}) => { const [initialRecord] = React.useState(records[selectedKey]); return <section>{initialRecord.title}</section>; };',
    'import * as React from "react"; export const Panel = ({records}) => { const [initialCount] = React.useState(records.length); return <section>{Object.values(records).length + initialCount}</section>; };',
  ])("allows a retained value beside unrelated data operations: %s", (code) => {
    const result = runRule(hookUseState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    'const Provider = require("react"); Provider.useState = customHook;',
    'import Provider from "react"; Provider.useState = customHook;',
    'import {createRequire} from "node:module"; const load = createRequire(import.meta.url); load("react").useState = customHook;',
    'const execute = Reflect.get(() => {}, "constructor"); execute("return import(\'react\')")();',
    "const candidate = () => {}; const execute = candidate[methodName]; execute(\"return import('react')\")();",
    'const candidate = () => {}; const alias = candidate; const execute = alias[methodName]; execute("return null")();',
    "const {entries} = Object; entries(records);",
    'const candidate = () => {}; const {[methodName]: execute} = candidate; execute("return null")();',
    'import Provider from "react"; const {[methodName]: execute} = Provider; execute();',
  ])("keeps provider capabilities outside the data exception: %s", (operation) => {
    const result = runRule(
      hookUseState,
      `import {useState} from "react"; ${operation} const recordKeys = Object.keys(records); const selected = records[selectedKey]; const [count] = useState(0);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const retainedTuple = useState(0);",
    "const [count, updateCount] = useState(0);",
    "const [count, setCount, extra] = useState(0);",
    "const [count, {}] = useState(0);",
    "let [count] = useState(0);",
    "const [count] = useState(0); count = 1;",
  ])("preserves destructuring and naming reports beside data operations: %s", (declaration) => {
    const result = runRule(
      hookUseState,
      `import {useState} from "react"; const entries = Object.keys(records); const selected = records[selectedKey]; ${declaration}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
