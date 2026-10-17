import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { hookUseState } from "./hook-use-state.js";

const cases = [
  {
    name: "useState-unmasked",
    code: 'import {useState} from "react";import {mutate} from "./external";function expose(){mutate(useState);}expose();export const Panel=()=>{const[value]=useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "useState-interface",
    code: 'import {useState} from "react";import {mutate} from "./external";function expose(){interface useState {}mutate(useState);}expose();export const Panel=()=>{const[value]=useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "useState-type-alias",
    code: 'import {useState} from "react";import {mutate} from "./external";function expose(){type useState=unknown;mutate(useState);}expose();export const Panel=()=>{const[value]=useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "useState-real-local-interface",
    code: 'import {useState} from "react";import {mutate} from "./external";function expose(){const useState=()=>[];interface useState {}mutate(useState);}expose();export const Panel=()=>{const[value]=useState(0);return <div>{value}</div>;};',
    expectedCount: 0,
  },
  {
    name: "React-unmasked",
    code: 'import React from "react";import {mutate} from "./external";function expose(){mutate(React);}expose();export const Panel=()=>{const[value]=React.useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "React-interface",
    code: 'import React from "react";import {mutate} from "./external";function expose(){interface React {}mutate(React);}expose();export const Panel=()=>{const[value]=React.useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "React-type-alias",
    code: 'import React from "react";import {mutate} from "./external";function expose(){type React=unknown;mutate(React);}expose();export const Panel=()=>{const[value]=React.useState(0);return <div>{value}</div>;};',
    expectedCount: 1,
  },
  {
    name: "React-real-local-interface",
    code: 'import React from "react";import {mutate} from "./external";function expose(){const React={useState:()=>[]};interface React {}mutate(React);}expose();export const Panel=()=>{const[value]=React.useState(0);return <div>{value}</div>;};',
    expectedCount: 0,
  },
];

describe("hook-use-state runtime provider references", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(hookUseState, code, {
      filename: "/tmp/rd-runtime-provider-references/view.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
