import type { FnMiningCase } from "../fn-mining-case.js";

// Doc pattern: `new RegExp(...)` with a constant pattern rebuilt inside
// a loop. Variants probe loop kinds, the call (non-new) form, and
// array-iteration callbacks.
export const jsHoistRegexpCases: FnMiningCase[] = [
  {
    ruleId: "js-hoist-regexp",
    description: "canonical: new RegExp in a for loop",
    filePath: "src/search.ts",
    code: `
      const countMatches = (lines: string[]): number => {
        let total = 0;
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const pattern = new RegExp("^\\\\d+:", "g");
          if (pattern.test(lines[lineIndex])) total += 1;
        }
        return total;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "js-hoist-regexp",
    description: "new RegExp with a static template-literal pattern in a while loop",
    filePath: "src/search.ts",
    code: `
      const drainQueue = (queue: string[]): string[] => {
        const matched: string[] = [];
        while (queue.length > 0) {
          const entry = queue.pop();
          if (entry && new RegExp(\`^token:\`).test(entry)) matched.push(entry);
        }
        return matched;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "js-hoist-regexp",
    description: "RegExp(...) called without `new` inside a for loop",
    filePath: "src/search.ts",
    code: `
      const countMatches = (lines: string[]): number => {
        let total = 0;
        for (const line of lines) {
          if (RegExp("^\\\\d+:").test(line)) total += 1;
        }
        return total;
      };
    `,
    shouldFire: true,
  },
  {
    ruleId: "js-hoist-regexp",
    description: "new RegExp inside a .map() callback (per-element iteration)",
    filePath: "src/search.ts",
    code: `
      const stripPrefixes = (lines: string[]): string[] =>
        lines.map((line) => line.replace(new RegExp("^\\\\d+:"), ""));
    `,
    shouldFire: true,
  },
  {
    ruleId: "js-hoist-regexp",
    description: "new RegExp in a for...of loop",
    filePath: "src/search.ts",
    code: `
      const findHeadings = (lines: string[]): string[] => {
        const headings: string[] = [];
        for (const line of lines) {
          if (new RegExp("^#{1,6} ").test(line)) headings.push(line);
        }
        return headings;
      };
    `,
    shouldFire: true,
  },
];
