import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexAsKey } from "./no-array-index-as-key.js";

const cases = [
  {
    name: "nominal",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "token-interface",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{interface part {}return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "token-alias",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{type part = string;return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "source-inner-interface",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{interface text {} void text;return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "source-inner-alias",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{type text = string; void text;return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "token-masked-write-interface",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{(()=>{interface part {} part=other;})();return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 1,
  },
  {
    name: "token-masked-write-alias",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{(()=>{type part=string; part=other;})();return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 1,
  },
  {
    name: "source-masked-write-interface",
    code: 'export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{(()=>{interface text {} text=other;})();return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 1,
  },
  {
    name: "readonly-dictionary-inner-interface",
    code: 'const styles={small:"compact"};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{interface styles {} void styles[selection];return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 0,
  },
  {
    name: "dictionary-masked-write-interface",
    code: 'const styles={small:"compact"};export const Example=({text}:{text:string})=><span>{text.split(" ").map((part,index)=>{(()=>{interface styles {} styles.small=other;})(); void styles[selection];return <span key={index}><b>{part.split("=")[1]}</b></span>})}</span>;',
    expected: 1,
  },
];

describe("primitive split child runtime bindings", () => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(noArrayIndexAsKey, code, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
