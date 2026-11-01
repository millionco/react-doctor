import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "unmasked",
    code: 'import {mutate} from "./external";const View=()=>[{token:"A A"}].map(record=>{function expose(){mutate(record);}expose();return record.token.split(" ").map((part,index)=><span key={index}>{part}</span>);});',
    expectedCount: 1,
  },
  {
    name: "interface",
    code: 'import {mutate} from "./external";const View=()=>[{token:"A A"}].map(record=>{function expose(){interface record {}mutate(record);}expose();return record.token.split(" ").map((part,index)=><span key={index}>{part}</span>);});',
    expectedCount: 1,
  },
  {
    name: "type-alias",
    code: 'import {mutate} from "./external";const View=()=>[{token:"A A"}].map(record=>{function expose(){type record=unknown;mutate(record);}expose();return record.token.split(" ").map((part,index)=><span key={index}>{part}</span>);});',
    expectedCount: 1,
  },
  {
    name: "real-local-interface",
    code: 'import {mutate} from "./external";const View=()=>[{token:"A A"}].map(record=>{function expose(){const record={token:"A A"};interface record {}mutate(record);}expose();return record.token.split(" ").map((part,index)=><span key={index}>{part}</span>);});',
    expectedCount: 0,
  },
];

describe("no-array-index-as-key runtime provider references", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noArrayIndexAsKey, code, {
      filename: "/tmp/rd-runtime-provider-references/view.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
