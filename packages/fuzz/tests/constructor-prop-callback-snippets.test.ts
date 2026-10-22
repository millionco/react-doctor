import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { noPropCallbackInRender } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-prop-callback-in-render.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

describe("constructor prop callback fuzz inputs", () => {
  it("reports the module-scope pool entry", () => {
    const source = MODULE_SCOPE_SNIPPET_POOL.find((entry) =>
      entry.includes("FuzzConstructorPropNotice"),
    );
    expect(source).toBeDefined();
    if (!source) throw new Error("Missing constructor module snippet");
    const result = runRule(noPropCallbackInRender, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("reports the standalone true-positive corpus seed", () => {
    const filename = fileURLToPath(
      new URL(
        "../corpus/true-positives/no-prop-callback-in-render--constructor-notification.tsx",
        import.meta.url,
      ),
    );
    const source = fs.readFileSync(filename, "utf8");
    const result = runRule(noPropCallbackInRender, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
