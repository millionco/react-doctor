import { describe, expect, it } from "vite-plus/test";
import { hasPotentialSplitGenerationReactSource } from "./has-potential-split-generation-react-proof.js";

const source = (
  binding = `import {useRef} from 'react';`,
  test = "ref.current === token",
  publication = "const token=ref.current+1; ref.current=token;",
) => `${binding}
export function useTask(){const ref=useRef(0);return async()=>{${publication} await work();if(${test}) finish();};}`;

describe("published-generation cache candidate", () => {
  it.each([
    ["genuine direct import", source()],
    [
      "renamed import",
      source(`import {useRef as useSlot} from 'react';`).replace("ref=useRef", "ref=useSlot"),
    ],
    ["reversed parenthesized comparison", source(undefined, "(token) === ref.current")],
    ["escaped import name", source(`import {\\u0075seRef} from 'react';`)],
  ])("recognizes %s without granting a provider proof", (_name, text) => {
    expect(hasPotentialSplitGenerationReactSource("Panel.tsx", text)).toBe(true);
  });
  it.each([
    ["foreign provider", source(`import {useRef} from './provider';`)],
    ["erased import", source(`import type {useRef} from 'react';`)],
    ["shadowed hook", source().replace("function useTask()", "function useTask(useRef)")],
    [
      "nonadjacent publication",
      source(undefined, undefined, "const token=ref.current+1; work(); ref.current=token;"),
    ],
    ["no identity test", source(undefined, "token > 0")],
    ["computed property", source().replaceAll("ref.current", `ref['current']`)],
    ["comment only", "// useRef current === token\nexport const value=1;"],
  ])("does not bypass caching for %s", (_name, text) => {
    expect(hasPotentialSplitGenerationReactSource("Panel.tsx", text)).toBe(false);
  });
});
