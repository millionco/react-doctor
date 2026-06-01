import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./regressions/_helpers.js";

const tempRoot = mkdtempSync(path.join(tmpdir(), "rd-user-plugins-"));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// User plugin source — mirrors the oxlint plugin contract documented
// in `oxlint-plugin-react-doctor`'s `RulePlugin` type:
//   { meta: { name }, rules: Record<ruleName, { create(context) => visitors }> }
// Visitor walks every JSX text child and flags occurrences of "FORBIDDEN".
const FORBIDDEN_WORD_PLUGIN = `
const noForbiddenWordRule = {
  create: (context) => ({
    JSXText(node) {
      if (typeof node.value !== "string") return;
      if (node.value.includes("FORBIDDEN")) {
        context.report({
          node,
          message: "team policy: 'FORBIDDEN' is not allowed in JSX text",
        });
      }
    },
  }),
};

module.exports = {
  meta: { name: "team-conventions" },
  rules: {
    "no-forbidden-word": noForbiddenWordRule,
  },
};
`;

describe("user plugins (config.plugins)", () => {
  it("loads a relative-path plugin and surfaces its rules when enabled", async () => {
    const projectDir = setupReactProject(tempRoot, "loads-plugin", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content here</div>;\n`,
        "lint/team-conventions.cjs": FORBIDDEN_WORD_PLUGIN,
      },
    });
    writeFileSync(
      path.join(projectDir, "doctor.config.json"),
      JSON.stringify({
        plugins: ["./lint/team-conventions.cjs"],
        rules: { "team-conventions/no-forbidden-word": "error" },
      }),
    );

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      userConfig: {
        plugins: ["./lint/team-conventions.cjs"],
        rules: { "team-conventions/no-forbidden-word": "error" },
      },
    });

    const userHits = diagnostics.filter((diagnostic) => diagnostic.rule === "no-forbidden-word");
    expect(userHits.length).toBeGreaterThan(0);
    expect(userHits[0].message).toContain("FORBIDDEN");
  });

  it("opts user-plugin rules out by default (no severity → rule never registers)", async () => {
    const projectDir = setupReactProject(tempRoot, "opt-in-by-default", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content here</div>;\n`,
        "lint/team-conventions.cjs": FORBIDDEN_WORD_PLUGIN,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      userConfig: {
        plugins: ["./lint/team-conventions.cjs"],
        // No `rules: {...}` — user-plugin rules MUST be opt-in.
      },
    });

    const userHits = diagnostics.filter((diagnostic) => diagnostic.rule === "no-forbidden-word");
    expect(userHits).toEqual([]);
  });

  it("honors per-rule severity overrides from `rules: { ... }`", async () => {
    const projectDir = setupReactProject(tempRoot, "honors-severity", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content here</div>;\n`,
        "lint/team-conventions.cjs": FORBIDDEN_WORD_PLUGIN,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      userConfig: {
        plugins: ["./lint/team-conventions.cjs"],
        rules: { "team-conventions/no-forbidden-word": "warn" },
      },
    });

    const userHits = diagnostics.filter((diagnostic) => diagnostic.rule === "no-forbidden-word");
    expect(userHits.length).toBeGreaterThan(0);
    expect(userHits[0].severity).toBe("warning");
  });

  it("skips a plugin that can't be resolved and continues the scan", async () => {
    const projectDir = setupReactProject(tempRoot, "skips-unresolvable", {
      files: {
        "src/App.tsx": `export const App = () => <div>hello</div>;\n`,
      },
    });

    // Doesn't throw — bad plugin entries warn and continue.
    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      userConfig: {
        plugins: ["./does-not-exist.cjs"],
        rules: { "does-not-exist/no-anything": "error" },
      },
    });

    // Scan still completes; just no rule from the missing plugin fires.
    expect(diagnostics.filter((d) => d.plugin === "does-not-exist")).toEqual([]);
  });

  it("resolves a plugin spec from the config's source directory, not the scan root (rootDir redirect)", async () => {
    // Bugbot regression (#438): `doctor.config.json` lives at
    // a workspace root and redirects the scan via `rootDir: "apps/web"`,
    // but the plugin file sits next to the CONFIG, not next to the
    // scan target. The resolver MUST use the config source directory.
    //
    // Layout:
    //   <workspace>/
    //     lint/team-conventions.cjs      ← plugin (next to config)
    //     apps/web/                      ← scan root after rootDir
    //       package.json
    //       src/App.tsx
    const workspaceDir = path.join(tempRoot, "rootdir-redirect-workspace");
    const scanDir = setupReactProject(workspaceDir, "apps/web", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content</div>;\n`,
      },
    });
    mkdirSync(path.join(workspaceDir, "lint"), { recursive: true });
    writeFileSync(path.join(workspaceDir, "lint/team-conventions.cjs"), FORBIDDEN_WORD_PLUGIN, {
      encoding: "utf-8",
    });

    const diagnostics = await runOxlint({
      rootDirectory: scanDir, // scan root (post-rootDir-redirect)
      project: buildTestProject({ rootDirectory: scanDir }),
      userConfig: {
        plugins: ["./lint/team-conventions.cjs"], // relative to config dir, not scan dir
        rules: { "team-conventions/no-forbidden-word": "error" },
      },
      configSourceDirectory: workspaceDir, // ← the fix: config dir
    });

    const userHits = diagnostics.filter((d) => d.rule === "no-forbidden-word");
    expect(userHits.length).toBeGreaterThan(0);
  });

  it("keeps user plugins when the extends-retry fallback fires (bugbot regression)", async () => {
    // Bugbot regression (#438): when oxlint crashes on the user's
    // adopted `.oxlintrc.json`, react-doctor retries once without
    // `extends`. The retry must NOT silently drop user plugins —
    // every config field threaded into the first attempt has to
    // make the trip into the fallback too. Simulated here by
    // pointing `adoptExistingLintConfig: true` at a project with a
    // deliberately broken `.oxlintrc.json` (one that oxlint can't
    // parse), then asserting the user-plugin diagnostic still
    // surfaces from the retry.
    const projectDir = setupReactProject(tempRoot, "extends-retry-keeps-plugins", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content here</div>;\n`,
        "lint/team-conventions.cjs": FORBIDDEN_WORD_PLUGIN,
        // Broken extends target: declares a plugin that doesn't
        // resolve, so oxlint's first attempt fails and the retry
        // fires.
        ".oxlintrc.json": JSON.stringify({
          jsPlugins: [
            { name: "definitely-not-installed", specifier: "definitely-not-installed-plugin" },
          ],
        }),
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      adoptExistingLintConfig: true,
      userConfig: {
        plugins: ["./lint/team-conventions.cjs"],
        rules: { "team-conventions/no-forbidden-word": "error" },
      },
    });

    const userHits = diagnostics.filter((d) => d.rule === "no-forbidden-word");
    expect(userHits.length).toBeGreaterThan(0);
  });

  it("skips a plugin that omits `meta.name` (required, no slug fallback)", async () => {
    const projectDir = setupReactProject(tempRoot, "meta-name-required", {
      files: {
        "src/App.tsx": `export const App = () => <div>FORBIDDEN content</div>;\n`,
        "lint/anonymous-plugin.cjs": `
const noForbiddenWordRule = {
  create: (context) => ({
    JSXText(node) {
      if (typeof node.value === "string" && node.value.includes("FORBIDDEN")) {
        context.report({ node, message: "no FORBIDDEN" });
      }
    },
  }),
};
module.exports = { rules: { "no-forbidden-word": noForbiddenWordRule } };
`,
      },
    });

    const diagnostics = await runOxlint({
      rootDirectory: projectDir,
      project: buildTestProject({ rootDirectory: projectDir }),
      userConfig: {
        plugins: ["./lint/anonymous-plugin.cjs"],
        // Any namespace the user tries here matches nothing — the plugin
        // is rejected for missing `meta.name` before any rules register.
        rules: { "anonymous-plugin/no-forbidden-word": "error" },
      },
    });

    const userHits = diagnostics.filter((diagnostic) => diagnostic.rule === "no-forbidden-word");
    expect(userHits).toEqual([]);
  });
});
