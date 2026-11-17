import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("ESM lexical timer shadows", () => {
  it.each(["setInterval", "setTimeout"])(
    "retains the native %s warning outside a never-entered block",
    (timer) => {
      const source = `import {useEffect} from 'react';
        if(false){function ${timer}(){}}
        const Panel=()=>{useEffect(()=>{${timer}(refresh,100);},[]);return null;};`;
      for (const rule of [effectNeedsCleanup, wrapWithSemanticContext(effectNeedsCleanup)]) {
        const result = runRule(rule, source);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(1);
      }
    },
  );

  it("keeps an actual lexical timer-name shadow quiet inside its block", () => {
    const source = `import {useEffect} from 'react';
      {function setInterval(){}
        const Panel=()=>{useEffect(()=>{setInterval(refresh,100);},[]);return null;};}`;
    for (const rule of [effectNeedsCleanup, wrapWithSemanticContext(effectNeedsCleanup)]) {
      const result = runRule(rule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});
