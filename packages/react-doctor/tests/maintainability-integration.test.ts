import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { diagnose } from "../src/index.js";
import { setupReactProject } from "./regressions/_helpers.js";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-maintainability-integration-"));

afterAll(() => {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diagnose() maintainability integration", () => {
  it("surfaces duplicated JSX trees through the public API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ score: 100, label: "Perfect" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    const projectDirectory = setupReactProject(temporaryRoot, "duplicated-jsx", {
      packageJsonExtras: { type: "module" },
      files: {
        "src/account-card.tsx": `export const AccountCard = ({ title, description }: { title: string; description: string }) => (
  <section className="card">
    <header><h2>{title}</h2></header>
    <div><article><p>{description}</p></article></div>
  </section>
);\n`,
        "src/project-card.tsx": `export const ProjectCard = ({ name, summary }: { name: string; summary: string }) => (
  <section className="card">
    <header><h2>{name}</h2></header>
    <div><article><p>{summary}</p></article></div>
  </section>
);\n`,
      },
    });

    const result = await diagnose(projectDirectory, {
      lint: false,
      deadCode: true,
      warnings: true,
    });

    const diagnostic = result.diagnostics.find(
      (candidate) => candidate.rule === "duplicate-jsx-subtree",
    );
    expect(diagnostic?.plugin).toBe("react-doctor");
    expect(diagnostic?.category).toBe("Maintainability");
    expect(diagnostic?.relatedLocations).toHaveLength(1);
  });
});
