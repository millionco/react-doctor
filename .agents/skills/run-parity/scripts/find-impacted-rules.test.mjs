import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./find-impacted-rules.mjs", import.meta.url));
const PLUGIN_ROOT = "packages/oxlint-plugin-react-doctor/src/plugin";
const RULES_ROOT = "packages/oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects";
const UTILS_ROOT = "packages/oxlint-plugin-react-doctor/src/plugin/utils";

const writeRepositoryFile = (repositoryDirectory, filePath, contents) => {
  const absolutePath = join(repositoryDirectory, filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
};

const commit = (repositoryDirectory, message) => {
  execFileSync("git", ["-C", repositoryDirectory, "add", "."]);
  execFileSync("git", ["-C", repositoryDirectory, "commit", "-m", message]);
  return execFileSync("git", ["-C", repositoryDirectory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
};

const makeRule = (identifier, id, dependencyPath) => `import { shared } from "${dependencyPath}";
import type { Rule } from "../../utils/rule.js";
import { defineRule } from "../../utils/define-rule.js";
export const ${identifier}: Rule = defineRule({ id: "${id}", create: () => shared });
`;

const initializeRepository = () => {
  const repositoryDirectory = mkdtempSync(join(tmpdir(), "react-doctor-rule-impact-"));
  execFileSync("git", ["-C", repositoryDirectory, "init", "-q"]);
  execFileSync("git", ["-C", repositoryDirectory, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repositoryDirectory, "config", "user.name", "Test"]);
  writeRepositoryFile(
    repositoryDirectory,
    `${UTILS_ROOT}/shared.ts`,
    "export const shared = {};\n",
  );
  writeRepositoryFile(
    repositoryDirectory,
    `${UTILS_ROOT}/define-rule.ts`,
    "export const defineRule = (rule) => rule;\n",
  );
  writeRepositoryFile(
    repositoryDirectory,
    `${UTILS_ROOT}/rule.ts`,
    "export interface Rule { id: string; create: () => unknown }\n",
  );
  writeRepositoryFile(
    repositoryDirectory,
    `${RULES_ROOT}/first.ts`,
    makeRule("first", "first", "../../utils/shared.js"),
  );
  writeRepositoryFile(
    repositoryDirectory,
    `${RULES_ROOT}/second.ts`,
    makeRule("second", "second", "../../utils/shared.js"),
  );
  return repositoryDirectory;
};

const runImpact = (repositoryDirectory, baseRef, headRef) => {
  const outputPath = join(repositoryDirectory, "impact.json");
  const result = spawnSync(
    process.execPath,
    [scriptPath, repositoryDirectory, baseRef, headRef, outputPath],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(outputPath, "utf8"));
};

test("selects every rule that transitively imports a changed utility", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/shared.ts`,
      "export const shared = { changed: true };\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
    assert.equal(
      manifest.rules.every((rule) => rule.baseFingerprint !== rule.headFingerprint),
      true,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("selects one directly changed rule", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      makeRule("first", "first", "../../utils/define-rule.js"),
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("tracks TypeScript import-equals require edges", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import shared = require("../../utils/shared.js");
import type Missing = require("../../utils/missing.js");
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => shared });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/shared.ts`,
      "export const shared = { changed: true };\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("tracks side-effect imports", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/side-effect.ts`,
      "export const marker = 1;\n",
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import "../../utils/side-effect.js";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => ({}) });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/side-effect.ts`,
      "export const marker = 2;\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("tracks named re-exports and export-star chains", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/re-export-leaf.ts`,
      "export const reExported = {};\n",
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/named-barrel.ts`,
      'export { reExported } from "./re-export-leaf.js";\n',
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/star-barrel.ts`,
      'export * from "./named-barrel.js";\n',
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { reExported } from "../../utils/star-barrel.js";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => reExported });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/re-export-leaf.ts`,
      "export const reExported = { changed: true };\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("resolves JavaScript specifiers to TypeScript and TSX sources", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/typescript-helper.ts`,
      "export const typescriptHelper = {};\n",
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/tsx-helper.tsx`,
      `import { typescriptHelper } from "./typescript-helper.js";
export const tsxHelper = typescriptHelper;
`,
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { tsxHelper } from "../../utils/tsx-helper.js";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => tsxHelper });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/typescript-helper.ts`,
      "export const typescriptHelper = { changed: true };\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("resolves extensionless files, directory indexes, and JSON modules", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(repositoryDirectory, `${UTILS_ROOT}/data.json`, '{"marker":1}\n');
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/directory/index.ts`,
      `import data from "../data.json";
export const indexed = data;
`,
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/resolver.ts`,
      `import { indexed } from "./directory";
export const resolved = indexed;
`,
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { resolved } from "../../utils/resolver";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => resolved });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(repositoryDirectory, `${UTILS_ROOT}/data.json`, '{"marker":2}\n');
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("terminates and preserves impact through dependency cycles", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/cycle-a.ts`,
      `import { cycleB } from "./cycle-b.js";
export const cycleA = cycleB;
`,
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/cycle-b.ts`,
      `import { cycleA } from "./cycle-a.js";
export const cycleB = cycleA;
`,
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { cycleA } from "../../utils/cycle-a.js";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => cycleA });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/cycle-b.ts`,
      `import { cycleA } from "./cycle-a.js";
export const cycleB = { cycleA };
`,
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
    assert.equal(manifest.rules[0].baseFingerprint === manifest.rules[0].headFingerprint, false);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to all rules for global runtime changes", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      "packages/core/src/run-oxlint.ts",
      "export const changed = true;\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
    assert.match(manifest.fallbackReasons[0], /Global runtime change/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity when a changed utility is imported only by the plugin host", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/host-only.ts`,
      "export const hostOnly = 1;\n",
    );
    writeRepositoryFile(
      repositoryDirectory,
      `${PLUGIN_ROOT}/react-doctor-plugin.ts`,
      `import { hostOnly } from "./utils/host-only.js";
export const plugin = { hostOnly };
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/host-only.ts`,
      "export const hostOnly = 2;\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
    assert.match(
      manifest.fallbackReasons.join("\n"),
      /Plugin host dependency requires full parity.*react-doctor-plugin\.ts/,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity when a changed utility reaches both a rule and a global host", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${PLUGIN_ROOT}/cross-file-dependencies.ts`,
      `import { shared } from "./utils/shared.js";
export const crossFileDependencies = shared;
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/shared.ts`,
      "export const shared = { changed: true };\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
    assert.match(
      manifest.fallbackReasons.join("\n"),
      /Plugin host dependency requires full parity.*cross-file-dependencies\.ts/,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to all rules for non-literal runtime imports", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { defineRule } from "../../utils/define-rule.js";
const moduleName = "./dynamic.js";
export const first = defineRule({ id: "first", create: () => import(moduleName) });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/second.ts`,
      `${makeRule("second", "second", "../../utils/shared.js")}\n`,
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Non-literal runtime module edge/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity when a rule is deleted", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    rmSync(join(repositoryDirectory, `${RULES_ROOT}/first.ts`));
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Removed or renamed rule.*first/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity when a rule identifier is renamed", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      makeRule("renamed", "renamed", "../../utils/shared.js"),
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Removed or renamed rule.*first/);
    assert.deepEqual(manifest.impactedRuleKeys, [
      "react-doctor/first",
      "react-doctor/renamed",
      "react-doctor/second",
    ]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("keeps a source-only rule file rename incremental", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    execFileSync("git", [
      "-C",
      repositoryDirectory,
      "mv",
      `${RULES_ROOT}/first.ts`,
      `${RULES_ROOT}/first-renamed.ts`,
    ]);
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "incremental");
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first"]);
    assert.equal(manifest.rules[0].baseFingerprint === manifest.rules[0].headFingerprint, false);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for parse failures", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${UTILS_ROOT}/shared.ts`,
      "export const shared = ;\n",
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /TypeScript could not parse.*shared\.ts/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for unresolved relative runtime modules", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `import { missing } from "../../utils/missing.js";
import { defineRule } from "../../utils/define-rule.js";
export const first = defineRule({ id: "first", create: () => missing });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/second.ts`,
      `${makeRule("second", "second", "../../utils/shared.js")}
export const marker = 1;
`,
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Unresolved runtime module.*missing\.js/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for duplicate rule keys", () => {
  const repositoryDirectory = initializeRepository();
  try {
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/second.ts`,
      makeRule("second", "first", "../../utils/shared.js"),
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.ts`,
      `${makeRule("first", "first", "../../utils/shared.js")}
export const marker = 1;
`,
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Duplicate rule key react-doctor\/first/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity when a changed rule implementation cannot be mapped", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const wrappedRulePath = `${RULES_ROOT}/wrapped.ts`;
    writeRepositoryFile(
      repositoryDirectory,
      wrappedRulePath,
      `import { defineRule as buildRule } from "../../utils/define-rule.js";
const ruleId = "wrapped";
export const wrapped = buildRule({ id: ruleId, create: () => ({}) });
`,
    );
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      wrappedRulePath,
      `import { defineRule as buildRule } from "../../utils/define-rule.js";
const ruleId = "wrapped";
export const wrapped = buildRule({ id: ruleId, create: () => ({ changed: true }) });
`,
    );
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.match(
      manifest.fallbackReasons.join("\n"),
      /Changed plugin runtime cannot be mapped to a rule/,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for test and documentation-only changes", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const baseRef = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/first.test.ts`,
      "export const testMarker = true;\n",
    );
    writeRepositoryFile(repositoryDirectory, "docs/parity.md", "# Parity\n");
    const headRef = commit(repositoryDirectory, "head");

    const manifest = runImpact(repositoryDirectory, baseRef, headRef);

    assert.equal(manifest.mode, "full");
    assert.deepEqual(manifest.runtimeChangedPaths, []);
    assert.deepEqual(manifest.impactedRuleKeys, ["react-doctor/first", "react-doctor/second"]);
    assert.deepEqual(manifest.candidateRuleKeys, []);
    assert.match(
      manifest.fallbackReasons.join("\n"),
      /No runtime rule impact requires full parity/,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("closes derived-state and hooks diagnostic interactions", () => {
  const repositoryDirectory = initializeRepository();
  try {
    for (const ruleName of [
      "no-adjust-state-on-prop-change",
      "no-derived-state",
      "no-derived-state-effect",
      "no-initialize-state",
      "rules-of-hooks",
    ]) {
      writeRepositoryFile(
        repositoryDirectory,
        `${RULES_ROOT}/${ruleName}.ts`,
        makeRule(ruleName.replaceAll("-", "_"), ruleName, "../../utils/shared.js"),
      );
    }
    const baseCommit = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/no-derived-state.ts`,
      `${makeRule("no_derived_state", "no-derived-state", "../../utils/shared.js")}
export const marker = 1;
`,
    );
    const derivedStateHeadCommit = commit(repositoryDirectory, "derived state");
    const derivedStateManifest = runImpact(repositoryDirectory, baseCommit, derivedStateHeadCommit);
    assert.deepEqual(derivedStateManifest.candidateRuleKeys, [
      "react-doctor/no-adjust-state-on-prop-change",
      "react-doctor/no-derived-state",
      "react-doctor/no-derived-state-effect",
      "react-doctor/no-initialize-state",
    ]);

    rmSync(join(repositoryDirectory, "impact.json"), { force: true });
    writeRepositoryFile(
      repositoryDirectory,
      `${RULES_ROOT}/rules-of-hooks.ts`,
      `${makeRule("rules_of_hooks", "rules-of-hooks", "../../utils/shared.js")}
export const marker = 2;
`,
    );
    const hooksHeadCommit = commit(repositoryDirectory, "hooks");
    const hooksManifest = runImpact(repositoryDirectory, derivedStateHeadCommit, hooksHeadCommit);
    assert.deepEqual(hooksManifest.candidateRuleKeys, [
      "react-doctor/rules-of-hooks",
      "react-hooks-js/hooks",
    ]);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for security scan rules", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const securityRulePath =
      "packages/oxlint-plugin-react-doctor/src/plugin/rules/security-scan/no-risk.ts";
    writeRepositoryFile(
      repositoryDirectory,
      securityRulePath,
      makeRule("no_risk", "no-risk", "../../utils/shared.js"),
    );
    const baseCommit = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      securityRulePath,
      `${makeRule("no_risk", "no-risk", "../../utils/shared.js")}
export const marker = 1;
`,
    );
    const headCommit = commit(repositoryDirectory, "head");
    const manifest = runImpact(repositoryDirectory, baseCommit, headCommit);
    assert.equal(manifest.mode, "full");
    assert.match(manifest.fallbackReasons.join("\n"), /Security scan rule requires full parity/);
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});

test("falls back to full parity for cross-rule suppression", () => {
  const repositoryDirectory = initializeRepository();
  try {
    const manualMemoizationRulePath = `${RULES_ROOT}/react-compiler-no-manual-memoization.ts`;
    writeRepositoryFile(
      repositoryDirectory,
      manualMemoizationRulePath,
      makeRule(
        "react_compiler_no_manual_memoization",
        "react-compiler-no-manual-memoization",
        "../../utils/shared.js",
      ),
    );
    const baseCommit = commit(repositoryDirectory, "base");
    writeRepositoryFile(
      repositoryDirectory,
      manualMemoizationRulePath,
      `${makeRule(
        "react_compiler_no_manual_memoization",
        "react-compiler-no-manual-memoization",
        "../../utils/shared.js",
      )}
export const marker = 1;
`,
    );
    const headCommit = commit(repositoryDirectory, "head");
    const manifest = runImpact(repositoryDirectory, baseCommit, headCommit);

    assert.equal(manifest.mode, "full");
    assert.match(
      manifest.fallbackReasons.join("\n"),
      /Cross-rule suppression requires full parity/,
    );
  } finally {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  }
});
