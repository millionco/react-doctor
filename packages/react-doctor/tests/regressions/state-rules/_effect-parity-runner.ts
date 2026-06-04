import * as fs from "node:fs";
import * as path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

interface UpstreamCase {
  idx: number;
  name: string;
  code: string;
  todo: boolean;
  errors?: number;
}

interface UpstreamFixture {
  valid: UpstreamCase[];
  invalid: UpstreamCase[];
}

const slugify = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "case";

const fixturesRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "effect-fixtures");

const loadFixture = (ruleId: string): UpstreamFixture =>
  JSON.parse(fs.readFileSync(path.join(fixturesRoot, `${ruleId}.json`), "utf8"));

// Wraps each upstream `code` snippet in a `.tsx` file the synthetic
// React project can lint. Upstream code assumes `useState`, `useEffect`
// etc. as globals — we don't add any prelude / shims because doing so
// would create shadowing collisions (a `declare const Foo` next to the
// upstream `function Foo() {}` confuses eslint-scope's resolution).
// oxlint doesn't type-check, so undeclared references are tolerated.
// The rule recognizes `useState` / `useEffect` by Identifier name,
// not by resolved import, so this works.
const upstreamShimPrelude = "";

export interface RunUpstreamParityOptions {
  /**
   * Override the rule id we filter diagnostics by — defaults to the
   * fixture name. Used by the `syntax` fixture, which captures cases
   * upstream runs through the `no-derived-state` rule but lives under
   * a different fixture filename.
   */
  ruleId?: string;
  /**
   * When true, assert that NONE of the 8 ported `react-doctor/*` rules
   * fire on each `valid:` case (instead of just filtering by `ruleId`).
   * Mirrors upstream `real-world.test.js`, which runs the full
   * `recommended` config and asserts no diagnostics.
   */
  assertNoneOfPortedRules?: boolean;
}

const PORTED_RULE_IDS: ReadonlyArray<string> = [
  "no-derived-state",
  "no-chain-state-updates",
  "no-event-handler",
  "no-adjust-state-on-prop-change",
  "no-reset-all-state-on-prop-change",
  "no-pass-live-state-to-parent",
  "no-pass-data-to-parent",
  "no-initialize-state",
];

const collectAnyPortedRuleHits = async (
  projectDir: string,
): Promise<Array<{ rule: string; message: string }>> => {
  const aggregated: Array<{ rule: string; message: string }> = [];
  for (const ruleId of PORTED_RULE_IDS) {
    const hits = await collectRuleHits(projectDir, ruleId);
    for (const hit of hits) {
      aggregated.push({ rule: ruleId, message: hit.message });
    }
  }
  return aggregated;
};

export const runUpstreamParity = (
  fixtureName: string,
  options: RunUpstreamParityOptions = {},
): void => {
  const ruleIdToFilter = options.ruleId ?? fixtureName;
  const tempRoot = createScopedTempRoot(`effect-${fixtureName}-parity`);
  const failureLogPath = path.join(tempRoot, "parity-failures.log");
  const fixture = loadFixture(fixtureName);

  const wrapAsTsx = (code: string): string => {
    return `${upstreamShimPrelude}\n// === upstream snippet ===\n${code}\n`;
  };

  describe(`${fixtureName} parity (port of eslint-plugin-react-you-might-not-need-an-effect)`, () => {
    for (const validCase of fixture.valid) {
      const itFn = validCase.todo ? it.skip : it;
      itFn(`valid #${validCase.idx} "${validCase.name}"`, async () => {
        const projectDir = setupReactProject(
          tempRoot,
          `v-${validCase.idx}-${slugify(validCase.name)}`,
          {
            files: { "src/Component.tsx": wrapAsTsx(validCase.code) },
          },
        );
        if (options.assertNoneOfPortedRules) {
          const hits = await collectAnyPortedRuleHits(projectDir);
          if (hits.length !== 0) {
            fs.appendFileSync(
              failureLogPath,
              `[${fixtureName}/any-ported] valid #${validCase.idx} "${validCase.name}" expected=0 got=${hits.length}\n  code:\n${validCase.code
                .split("\n")
                .map((l) => `    ${l}`)
                .join("\n")}\n  hits:\n${JSON.stringify(hits, null, 2)}\n---\n`,
            );
          }
          expect(hits).toHaveLength(0);
          return;
        }
        const hits = await collectRuleHits(projectDir, ruleIdToFilter);
        if (hits.length !== 0) {
          fs.appendFileSync(
            failureLogPath,
            `[${ruleIdToFilter}] valid #${validCase.idx} "${validCase.name}" expected=0 got=${hits.length}\n  code:\n${validCase.code
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n")}\n  hits:\n${JSON.stringify(hits, null, 2)}\n---\n`,
          );
        }
        expect(hits).toHaveLength(0);
      });
    }

    for (const invalidCase of fixture.invalid) {
      const itFn = invalidCase.todo ? it.skip : it;
      itFn(`invalid #${invalidCase.idx} "${invalidCase.name}"`, async () => {
        const projectDir = setupReactProject(
          tempRoot,
          `i-${invalidCase.idx}-${slugify(invalidCase.name)}`,
          {
            files: { "src/Component.tsx": wrapAsTsx(invalidCase.code) },
          },
        );
        const hits = await collectRuleHits(projectDir, ruleIdToFilter);
        if (hits.length !== (invalidCase.errors ?? 1)) {
          fs.appendFileSync(
            failureLogPath,
            `[${ruleIdToFilter}] invalid #${invalidCase.idx} "${invalidCase.name}" expected=${invalidCase.errors ?? 1} got=${hits.length}\n  code:\n${invalidCase.code
              .split("\n")
              .map((l) => `    ${l}`)
              .join("\n")}\n  hits:\n${JSON.stringify(hits, null, 2)}\n---\n`,
          );
        }
        expect(hits.length).toBe(invalidCase.errors ?? 1);
      });
    }
  });
};
