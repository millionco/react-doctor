import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

const cases = [
  {
    name: "Boolean-unmasked",
    code: '\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};import {mutate} from "./external";function expose(){mutate(Boolean);}expose();',
    expectedCount: 1,
  },
  {
    name: "Boolean-interface",
    code: '\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};import {mutate} from "./external";function expose(){interface Boolean {}mutate(Boolean);}expose();',
    expectedCount: 1,
  },
  {
    name: "Boolean-type-alias",
    code: '\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};import {mutate} from "./external";function expose(){type Boolean=unknown;mutate(Boolean);}expose();',
    expectedCount: 1,
  },
  {
    name: "Boolean-real-local-interface",
    code: '\nimport React from "react";import {useMediaQuery} from "./media";const Panel=({enabled,onChange})=>{const media=useMediaQuery("query");const value=Boolean(enabled)&&media;React.useEffect(()=>{onChange(value);},[value,onChange]);return null;};import {mutate} from "./external";function expose(){const Boolean=()=>true;interface Boolean {}mutate(Boolean);}expose();',
    expectedCount: 0,
  },
];

describe("no-pass-data-to-parent runtime provider references", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noPassDataToParent, code, {
      filename: "/tmp/rd-runtime-provider-references/view.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
