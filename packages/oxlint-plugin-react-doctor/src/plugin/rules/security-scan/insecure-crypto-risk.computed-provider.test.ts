import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { insecureCryptoRisk } from "./insecure-crypto-risk.js";

const randomClass =
  'class Data{constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token in expression")}}';

describe("insecure-crypto-risk computed Error provider", () => {
  it.each([
    'const provider="Error";globalThis[provider]=class {};',
    'const provider="Error";const host=globalThis;host[provider]=class {};',
    'const provider="Error";({value:globalThis[provider]}=replacement);',
  ])("retains the warning for an unknown computed global write: %s", (setup) => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-source.js",
        content: `${setup}\n${randomClass}`,
      }),
    ).toEqual([
      {
        message:
          "Code uses weak hashes, deprecated ciphers, timing-unsafe comparisons, or Math.random in a security-shaped context.",
        line: 2,
        column: randomClass.indexOf("Math.random") + 1,
      },
    ]);
  });

  it("keeps an unrelated computed global read quiet", () => {
    expect(
      runScanRule(insecureCryptoRisk, {
        relativePath: "src/random-source.js",
        content: `const provider="Error";const saved=globalThis[provider];\n${randomClass}`,
      }),
    ).toEqual([]);
  });
});
