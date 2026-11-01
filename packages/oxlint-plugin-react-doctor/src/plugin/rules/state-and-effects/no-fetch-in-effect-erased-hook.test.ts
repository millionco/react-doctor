import { expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { IMMEDIATE_IIFE_BINDING_CONTROLS } from "../../../test-utils/immediate-iife-proof/constants.js";
import { noFetchInEffect } from "./no-fetch-in-effect.js";

for (const controlName of ["erased-use-effect", "runtime-fetch-shadow"]) {
  it(controlName, () => {
    const control = IMMEDIATE_IIFE_BINDING_CONTROLS.find((control) => control.name === controlName);
    expect(control).toBeDefined();
    if (!control) throw new Error("Missing erased effect fixture");
    const result = runRule(noFetchInEffect, control.code, {
      filename: "synthetic-iife.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(
      controlName === "erased-use-effect"
        ? [
            {
              column: 2,
              line: 5,
              message:
                "fetch() inside useEffect can race, double-fire, or leak. Use a data-fetching layer or Server Component instead.",
              nodeType: "CallExpression",
            },
          ]
        : [],
    );
  });
}
