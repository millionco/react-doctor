import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validateAgentGuidanceDocuments, validateSkillDocuments } from "./check-skills.mjs";

const FIXTURE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "check-skills",
);

const validateFixture = (fixtureName, manifestPath) =>
  validateSkillDocuments({
    repositoryRoot: path.join(FIXTURE_ROOT, fixtureName),
    skillManifestPaths: [manifestPath],
  });

describe("skill document validation", () => {
  it("accepts nested skills, local resources, external paths, and slash commands", () => {
    assert.deepEqual(validateFixture("valid-nested", "skills/groups/nested-skill/SKILL.md"), []);
  });

  it("reports missing required frontmatter", () => {
    assert.deepEqual(validateFixture("broken-frontmatter", "skills/broken/SKILL.md"), [
      {
        manifestPath: "skills/broken/SKILL.md",
        line: 1,
        message: 'missing frontmatter field "description"',
      },
    ]);
  });

  it("reports broken relative Markdown links", () => {
    assert.deepEqual(validateFixture("broken-link", "skills/broken/SKILL.md"), [
      {
        manifestPath: "skills/broken/SKILL.md",
        line: 8,
        message: "broken relative Markdown link: references/missing.md",
      },
    ]);
  });

  it("reports missing explicitly skill-local assets and scripts", () => {
    assert.deepEqual(validateFixture("broken-asset", "skills/broken/SKILL.md"), [
      {
        manifestPath: "skills/broken/SKILL.md",
        line: 8,
        message: "missing local resource: assets/missing.json",
      },
    ]);
  });
});

const withGuidanceFixture = (files, runTest) => {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-agent-guidance-"));
  try {
    for (const [relativePath, sourceText] of Object.entries(files)) {
      const filePath = path.join(repositoryRoot, relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, sourceText);
    }
    runTest(repositoryRoot);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
};

describe("agent guidance validation", () => {
  it("accepts existing links, canonical paths, and root or workspace scripts", () => {
    withGuidanceFixture(
      {
        "package.json": '{"scripts":{"test":"node --test"}}',
        "packages/example/package.json":
          '{"name":"@fixture/example","scripts":{"gen:check":"node generate.mjs"}}',
        "scripts/check.mjs": "",
        ".agents/references/testing.md": "# Testing\n",
        "AGENTS.md":
          "[Testing](.agents/references/testing.md) uses `scripts/check.mjs`, `nr test`, and `nr --filter @fixture/example gen:check`.\n",
      },
      (repositoryRoot) => {
        assert.deepEqual(validateAgentGuidanceDocuments({ repositoryRoot }), []);
      },
    );
  });

  it("reports broken links, canonical paths, workspaces, and scripts", () => {
    withGuidanceFixture(
      {
        "package.json": '{"scripts":{}}',
        "AGENTS.md":
          "[Missing](.agents/references/missing.md) uses `scripts/missing.mjs`, `nr missing`, and `nr --filter @fixture/missing test`.\n",
      },
      (repositoryRoot) => {
        assert.deepEqual(validateAgentGuidanceDocuments({ repositoryRoot }), [
          {
            manifestPath: "AGENTS.md",
            line: 1,
            message: "broken relative Markdown link: .agents/references/missing.md",
          },
          {
            manifestPath: "AGENTS.md",
            line: 1,
            message: "canonical repository path does not exist: scripts/missing.mjs",
          },
          {
            manifestPath: "AGENTS.md",
            line: 1,
            message: "documented nr workspace does not exist: @fixture/missing",
          },
          {
            manifestPath: "AGENTS.md",
            line: 1,
            message: "documented script does not exist: nr missing",
          },
        ]);
      },
    );
  });

  it("accepts the repository's complete agent guidance set", () => {
    assert.deepEqual(validateAgentGuidanceDocuments(), []);
  });
});
