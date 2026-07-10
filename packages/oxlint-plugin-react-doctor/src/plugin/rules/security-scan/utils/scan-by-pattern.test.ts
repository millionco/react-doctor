import { describe, expect, it } from "vite-plus/test";
import { scanByPattern } from "./scan-by-pattern.js";

const scannedFile = {
  absolutePath: "/tmp/source.ts",
  relativePath: "src/source.ts",
  content: "first();\nsecond();\n",
  isGeneratedBundle: false,
};

describe("scanByPattern", () => {
  it("reports the first configured pattern that matches without rescanning it", () => {
    const scan = scanByPattern({
      shouldScan: () => true,
      pattern: [/second/, /first/],
      message: "matched",
    });

    expect(scan(scannedFile)).toEqual([
      {
        message: "matched",
        line: 2,
        column: 1,
      },
    ]);
  });

  it("supports one pattern and suppression gates", () => {
    const scan = scanByPattern({
      shouldScan: () => true,
      pattern: /first/,
      suppressWhen: /second/,
      message: "matched",
    });

    expect(scan(scannedFile)).toEqual([]);
  });
});
