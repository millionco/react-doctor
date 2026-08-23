import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireFromScript = createRequire(import.meta.url);
const nativeDirectory = path.join(repositoryRoot, "native", "oxlint");
const nativeRulesDirectory = path.join(nativeDirectory, "rules");
const upstream = JSON.parse(fs.readFileSync(path.join(nativeDirectory, "upstream.json"), "utf8"));
const patchPath = path.join(nativeDirectory, "react-doctor.patch");
const delegatedRules = new Map(
  (upstream.delegatedRules ?? []).map((delegatedRule) => [delegatedRule.id, delegatedRule]),
);

const argumentsList = process.argv.slice(2);
const readOption = (name) => {
  const optionIndex = argumentsList.indexOf(name);
  if (optionIndex === -1) return null;
  const optionValue = argumentsList[optionIndex + 1];
  if (!optionValue || optionValue.startsWith("--")) throw new Error(`${name} requires a value`);
  return optionValue;
};

const sourcePath = readOption("--source");
const outputDirectory = path.resolve(
  readOption("--output") ?? path.join(repositoryRoot, "dist", "native-oxlint"),
);
const shouldCheckOnly = argumentsList.includes("--check-only");
const shouldCompileCheck = argumentsList.includes("--compile-check");
const shouldUseAllocator = !argumentsList.includes("--no-allocator");
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxc-"));
const checkoutDirectory = path.join(temporaryDirectory, "oxc");

const run = (command, commandArguments, options = {}) =>
  execFileSync(command, commandArguments, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    stdio: "inherit",
  });

try {
  if (sourcePath) {
    run("git", ["clone", "--no-checkout", path.resolve(sourcePath), checkoutDirectory]);
  } else {
    run("git", [
      "clone",
      "--filter=blob:none",
      "--no-checkout",
      "--branch",
      upstream.tag,
      "--depth=1",
      upstream.repository,
      checkoutDirectory,
    ]);
  }

  run("git", ["checkout", "--detach", upstream.commit], { cwd: checkoutDirectory });
  const resolvedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutDirectory,
    encoding: "utf8",
  }).trim();
  if (resolvedCommit !== upstream.commit) {
    throw new Error(`expected upstream commit ${upstream.commit}, received ${resolvedCommit}`);
  }

  run("git", ["apply", "--check", patchPath], { cwd: checkoutDirectory });
  if (shouldCheckOnly) {
    process.stdout.write(`Patch applies to ${upstream.tag} (${upstream.commit}).\n`);
    process.exitCode = 0;
  } else {
    run("git", ["apply", patchPath], { cwd: checkoutDirectory });
    const upstreamRulesDirectory = path.join(
      checkoutDirectory,
      "crates",
      "oxc_linter",
      "src",
      "rules",
      "react_doctor_native",
    );
    fs.mkdirSync(upstreamRulesDirectory, { recursive: true });
    const buildDelegatedRuleSource = (delegatedRule) => {
      const fixCapability = delegatedRule.fix ? `\n    ${delegatedRule.fix},` : "";
      const shouldRun = delegatedRule.skipNonProduction
        ? "!is_non_production_file(ctx) && self.upstream_rule.should_run(ctx)"
        : "self.upstream_rule.should_run(ctx)";
      return `use crate::{
    AstNode,
    context::{ContextHost, LintContext},
    rule::Rule,
    rules::${delegatedRule.module}::${delegatedRule.struct} as UpstreamRule,
};
use oxc_macros::declare_oxc_lint;

#[derive(Debug, Default, Clone)]
pub struct ${delegatedRule.struct} {
    upstream_rule: UpstreamRule,
}

declare_oxc_lint!(
    /// React Doctor adapter for Oxc's native detector.
    ${delegatedRule.struct},
    react_doctor_native,
    ${delegatedRule.category},${fixCapability}
    version = "0.1.0",
    short_description = "Runs the parity-matched native Oxc detector with React Doctor diagnostics.",
);

impl Rule for ${delegatedRule.struct} {
    fn from_configuration(value: serde_json::Value) -> Result<Self, serde_json::Error> {
        UpstreamRule::from_configuration(value).map(|upstream_rule| Self { upstream_rule })
    }

    fn run<'a>(&self, node: &AstNode<'a>, ctx: &LintContext<'a>) {
        self.upstream_rule.run(node, ctx);
    }

    fn run_once(&self, ctx: &LintContext) {
        self.upstream_rule.run_once(ctx);
    }

    fn should_run(&self, ctx: &ContextHost) -> bool {
        ${shouldRun}
    }
}
`;
    };
    const nativeUtilitySources = new Map(
      [
        "is-non-production-file",
        "is-create-element-call",
        "is-react-api-call",
        "property-key-matches-name",
        "is-type-only-import",
        "for-each-named-import",
        "for-each-value-import",
        "resolve-jsx-element-type",
        "get-string-literal-attribute-value",
        "get-direct-string-literal-attribute-value",
        "parse-finite-number",
        "parse-static-jsx-number",
        "get-authoritative-jsx-attribute",
        "is-proven-intrinsic-jsx-element",
        "find-jsx-attribute",
        "get-static-class-name",
        "is-in-project-directory",
        "is-next-file-active",
        "program-estree-span",
        "collect-static-jsx-opening-elements",
        "is-static-jsx-tree-root",
        "get-static-jsx-tree-opening-elements",
        "is-js-whitespace",
        "motion-react-api-path-matches",
        "is-render-phase-component-or-hook",
        "is-inside-stable-react-initializer",
      ].map((utilityName) => [
        utilityName.replaceAll("-", "_"),
        fs.readFileSync(path.join(nativeRulesDirectory, `${utilityName}.rs`), "utf8").trim(),
      ]),
    );
    for (const nativeRuleId of upstream.nativeRules) {
      const delegatedRule = delegatedRules.get(nativeRuleId);
      const nativeRuleSource = delegatedRule
        ? buildDelegatedRuleSource(delegatedRule)
        : fs.readFileSync(path.join(nativeRulesDirectory, `${nativeRuleId}.rs`), "utf8");
      const requiredUtilitySources = [];
      let sourceWithUtilities = nativeRuleSource;
      const remainingUtilitySources = new Map(nativeUtilitySources);
      while (true) {
        const requiredUtility = [...remainingUtilitySources].find(([utilityName]) =>
          sourceWithUtilities.includes(`${utilityName}(`),
        );
        if (!requiredUtility) break;
        const [utilityName, utilitySource] = requiredUtility;
        remainingUtilitySources.delete(utilityName);
        requiredUtilitySources.push(utilitySource);
        sourceWithUtilities += `\n${utilitySource}`;
      }
      const requiredUtilities = requiredUtilitySources.join("\n\n");
      fs.writeFileSync(
        path.join(upstreamRulesDirectory, `${nativeRuleId.replaceAll("-", "_")}.rs`),
        requiredUtilities ? `${requiredUtilities}\n\n${nativeRuleSource}` : nativeRuleSource,
      );
    }
    const rulesRegistryPath = path.join(
      checkoutDirectory,
      "crates",
      "oxc_linter",
      "src",
      "rules.rs",
    );
    const nativeModuleDeclarations = upstream.nativeRules
      .map((nativeRuleId) => `    pub mod ${nativeRuleId.replaceAll("-", "_")};`)
      .join("\n");
    const rulesRegistry = fs
      .readFileSync(rulesRegistryPath, "utf8")
      .replace(
        "pub(crate) mod react_doctor_native;",
        `pub(crate) mod react_doctor_native {\n${nativeModuleDeclarations}\n}`,
      );
    fs.writeFileSync(rulesRegistryPath, rulesRegistry);
    run("rustfmt", ["--version"], { cwd: checkoutDirectory });
    run("cargo", ["lintgen"], { cwd: checkoutDirectory });
    if (shouldCompileCheck) {
      run("cargo", ["check", "--locked", "-p", "oxc_linter"], { cwd: checkoutDirectory });
      process.stdout.write(`Native rules compile against ${upstream.tag} (${upstream.commit}).\n`);
      process.exitCode = 0;
    } else {
      const targetDirectory = path.resolve(
        process.env.CARGO_TARGET_DIR ?? path.join(temporaryDirectory, "target"),
      );
      const cargoArguments = ["build", "--locked", "-p", "oxlint", "--release", "--lib"];
      if (shouldUseAllocator) cargoArguments.push("--features", "allocator");
      run("cargo", cargoArguments, {
        cwd: checkoutDirectory,
        env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
      });

      const libraryName =
        process.platform === "win32"
          ? "oxlint.dll"
          : process.platform === "darwin"
            ? "liboxlint.dylib"
            : "liboxlint.so";
      const platformSuffix =
        process.platform === "linux"
          ? `${process.platform}-${process.arch}-gnu`
          : `${process.platform}-${process.arch}`;
      const bindingFileName = `oxlint-react-doctor.${platformSuffix}.node`;
      const builtLibraryPath = path.join(targetDirectory, "release", libraryName);
      const outputBindingPath = path.join(outputDirectory, bindingFileName);
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.copyFileSync(builtLibraryPath, outputBindingPath);
      const nativeBinding = requireFromScript(outputBindingPath);
      if (typeof nativeBinding.lint !== "function") {
        throw new Error(`built binding does not export lint: ${outputBindingPath}`);
      }

      const sha256 = (filePath) =>
        crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
      fs.writeFileSync(
        path.join(outputDirectory, `${bindingFileName}.json`),
        `${JSON.stringify(
          {
            upstreamRepository: upstream.repository,
            upstreamTag: upstream.tag,
            upstreamCommit: upstream.commit,
            oxlintVersion: upstream.oxlintVersion,
            rustToolchain: upstream.rustToolchain,
            nativeRules: upstream.nativeRules,
            bindingFile: bindingFileName,
            bindingSha256: sha256(outputBindingPath),
            patchSha256: sha256(patchPath),
          },
          null,
          2,
        )}\n`,
      );
      process.stdout.write(`Built ${outputBindingPath}\n`);
    }
  }
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
