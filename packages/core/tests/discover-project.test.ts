import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  discoverProject,
  discoverReactSubprojects,
  formatFrameworkName,
  listWorkspacePackages,
  PackageJsonNotFoundError,
} from "@react-doctor/core";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const VALID_FRAMEWORKS = ["nextjs", "vite", "cra", "remix", "gatsby", "unknown"];

describe("discoverProject", () => {
  it("detects React version from package.json", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("detects React from a UTF-8 BOM-prefixed package.json", () => {
    const projectDirectory = path.join(tempDirectory, "bom-prefixed-package-json");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      `\uFEFF${JSON.stringify({
        name: "bom-prefixed-package-json",
        dependencies: { react: "^18.3.1" },
      })}`,
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("returns a valid framework", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(VALID_FRAMEWORKS).toContain(projectInfo.framework);
  });

  it("detects TypeScript when tsconfig.json exists", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.hasTypeScript).toBe(true);
  });

  it("detects React version from peerDependencies", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "component-library"));
    expect(projectInfo.reactVersion).toBe("^18.0.0 || ^19.0.0");
  });

  it("detects React version from devDependencies only", () => {
    const projectDirectory = path.join(tempDirectory, "react-in-dev-deps-only");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-in-dev-deps-only",
        devDependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("detects Tailwind version from devDependencies when present", () => {
    const projectDirectory = path.join(tempDirectory, "tw-from-dev-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "tw-app",
        dependencies: { react: "^19.0.0" },
        devDependencies: { tailwindcss: "^3.4.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.tailwindVersion).toBe("^3.4.1");
  });

  it("prefers runtime React dependencies over conflicting devDependencies", () => {
    const projectDirectory = path.join(tempDirectory, "react-runtime-over-dev-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-runtime-over-dev-deps",
        dependencies: { react: "^18.3.1" },
        devDependencies: { react: "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("uses concrete React devDependencies when runtime React uses an unresolvable workspace protocol", () => {
    const projectDirectory = path.join(tempDirectory, "react-workspace-protocol-over-dev-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-workspace-protocol-over-dev-deps",
        dependencies: { react: "workspace:*" },
        devDependencies: { react: "^18.3.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("uses concrete React devDependencies when peer React uses an unresolvable workspace protocol", () => {
    const projectDirectory = path.join(
      tempDirectory,
      "react-peer-workspace-protocol-over-dev-deps",
    );
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-peer-workspace-protocol-over-dev-deps",
        peerDependencies: { react: "workspace:*" },
        devDependencies: { react: "^18.3.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("prefers runtime React catalog declarations over concrete devDependencies", () => {
    const monorepoRoot = path.join(tempDirectory, "react-runtime-catalog-over-dev-deps");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  react: ^18.3.1\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "catalog:" },
        devDependencies: { react: "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "apps", "web"));
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("returns null tailwindVersion when neither the project nor its monorepo root depend on Tailwind", () => {
    const projectDirectory = path.join(tempDirectory, "tw-not-installed");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "no-tw-app",
        dependencies: { react: "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.tailwindVersion).toBeNull();
  });

  it("resolves Tailwind version from a pnpm workspace catalog", () => {
    const monorepoRoot = path.join(tempDirectory, "tw-from-pnpm-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.0.0\n  tailwindcss: ^4.0.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", private: true }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "ui",
        dependencies: { react: "catalog:", tailwindcss: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "ui"));
    expect(projectInfo.tailwindVersion).toBe("^4.0.0");
  });

  it("uses concrete Tailwind devDependencies when runtime Tailwind uses an unresolvable workspace protocol", () => {
    const projectDirectory = path.join(tempDirectory, "tw-workspace-protocol-over-dev-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "tw-workspace-protocol-over-dev-deps",
        dependencies: { react: "^19.0.0", tailwindcss: "workspace:*" },
        devDependencies: { tailwindcss: "^3.4.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.tailwindVersion).toBe("^3.4.1");
  });

  it("prefers Tailwind dependency catalog declarations over concrete devDependencies", () => {
    const monorepoRoot = path.join(tempDirectory, "tw-runtime-catalog-over-dev-deps");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  tailwindcss: ^4.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "ui",
        dependencies: { tailwindcss: "catalog:" },
        devDependencies: { tailwindcss: "^3.4.1" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "ui"));
    expect(projectInfo.tailwindVersion).toBe("^4.0.0");
  });

  it("throws when package.json is missing", () => {
    expect(() => discoverProject("/nonexistent/path")).toThrow("No package.json found");
  });

  it("throws when package.json is a directory instead of a file", () => {
    const projectDirectory = path.join(tempDirectory, "eisdir-root");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.mkdirSync(path.join(projectDirectory, "package.json"), { recursive: true });

    expect(() => discoverProject(projectDirectory)).toThrow("No package.json found");
  });

  it("resolves React version from pnpm workspace default catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "pnpm-catalog-workspace", "packages", "ui"),
    );
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("prefers concrete workspace React versions over root catalog fallback", () => {
    const monorepoRoot = path.join(tempDirectory, "workspace-react-over-root-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  react: ^19.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^18.3.1" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("resolves workspace catalog React versions from the monorepo root", () => {
    const monorepoRoot = path.join(tempDirectory, "root-scan-workspace-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  react: ^19.0.0\n  tailwindcss: ^4.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "catalog:", tailwindcss: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.reactMajorVersion).toBe(19);
    expect(projectInfo.tailwindVersion).toBe("^4.0.0");
  });

  it("prefers dependency catalog references over devDependency catalog references", () => {
    const monorepoRoot = path.join(tempDirectory, "dependency-catalog-over-dev-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalogs:\n  react18:\n    react: ^18.3.1\n  react19:\n    react: ^19.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "catalog:react18" },
        devDependencies: { react: "catalog:react19" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("preserves default catalog references when devDependencies use named catalogs", () => {
    const monorepoRoot = path.join(tempDirectory, "default-catalog-over-dev-named-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  react: ^18.3.1\ncatalogs:\n  react19:\n    react: ^19.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "catalog:" },
        devDependencies: { react: "catalog:react19" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("does not resolve default catalog references from unrelated named catalogs", () => {
    const monorepoRoot = path.join(tempDirectory, "default-catalog-skips-unrelated-named-catalog");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalogs:\n  react19:\n    react: ^19.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "apps", "web"));
    expect(projectInfo.reactVersion).toBeNull();
    expect(projectInfo.reactMajorVersion).toBeNull();
  });

  it("does not apply root React catalogs to workspaces without React declarations", () => {
    const monorepoRoot = path.join(tempDirectory, "root-catalog-skips-non-react-workspaces");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.mkdirSync(path.join(monorepoRoot, "packages", "eslint-config"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n  - packages/*\n\ncatalog:\n  react: ^17.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^18.3.1" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "eslint-config", "package.json"),
      JSON.stringify({
        name: "eslint-config",
        devDependencies: { eslint: "^9.0.0" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("continues workspace scanning for Tailwind after finding React and a framework", () => {
    const monorepoRoot = path.join(tempDirectory, "workspace-tailwind-after-react-framework");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.mkdirSync(path.join(monorepoRoot, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n  - packages/*\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^17.0.2", vite: "^5.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "ui",
        devDependencies: { tailwindcss: "^4.0.0" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^17.0.2");
    expect(projectInfo.framework).toBe("vite");
    expect(projectInfo.tailwindVersion).toBe("^4.0.0");
  });

  it("does not scan workspaces only to discover Zod", () => {
    const monorepoRoot = path.join(tempDirectory, "skip-workspace-zod-only-scan");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "schema"), { recursive: true });
    fs.writeFileSync(path.join(monorepoRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "root",
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "schema", "package.json"),
      JSON.stringify({
        name: "schema",
        dependencies: { zod: "^4.0.0" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.zodVersion).toBeNull();
  });

  it("applies the monorepo root React catalog to leaves that do not declare React (hoisted-react workspaces)", () => {
    // Pinned for #310 / #311: in pnpm/yarn/npm workspaces with React
    // hoisted to the root, a leaf package that omits React from its
    // own package.json should still resolve to the root catalog
    // version instead of failing with `NoReactDependencyError`.
    const monorepoRoot = path.join(tempDirectory, "leaf-uses-root-react-catalog-fallback");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  react: ^19.0.0\n  tailwindcss: ^4.0.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "root",
        devDependencies: { react: "^19.0.0", tailwindcss: "^4.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "apps", "web"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.reactMajorVersion).toBe(19);
  });

  it("uses monorepo React fallback for Next leaf packages without direct React declarations", () => {
    const monorepoRoot = path.join(tempDirectory, "next-leaf-uses-root-react-fallback");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "next-adapter"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.0.0\n  next: ^16.0.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "root",
        devDependencies: { react: "catalog:", next: "catalog:" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "next-adapter", "package.json"),
      JSON.stringify({
        name: "next-adapter",
        peerDependencies: { next: ">=15" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "next-adapter"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.reactMajorVersion).toBe(19);
  });

  it("resolves React version from pnpm workspace named catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "pnpm-named-catalog", "packages", "app"),
    );
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("resolves React version from Bun workspace catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "bun-catalog-workspace", "apps", "web"),
    );
    expect(projectInfo.reactVersion).toBe("^19.1.4");
  });

  it("resolves React version from Bun grouped workspace catalog", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "bun-grouped-catalog", "apps", "web"),
    );
    expect(projectInfo.reactVersion).toBe("19.2.0");
  });

  it("resolves React version from a Bun grouped catalog when the leaf also uses devDependencies", () => {
    const monorepoRoot = path.join(tempDirectory, "bun-grouped-catalog-dev-deps");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "monorepo",
        private: true,
        workspaces: ["apps/*"],
        catalogs: {
          react19: {
            react: "19.2.1",
            "react-dom": "19.2.1",
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        devDependencies: { react: "catalog:react19", "react-dom": "catalog:react19" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "apps", "web"));
    expect(projectInfo.reactVersion).toBe("19.2.1");
    expect(projectInfo.reactMajorVersion).toBe(19);
  });

  it("picks the leaf-referenced group when multiple Bun grouped catalogs define the same package", () => {
    const projectInfo = discoverProject(
      path.join(FIXTURES_DIRECTORY, "bun-multiple-grouped-catalogs", "apps", "web"),
    );
    expect(projectInfo.reactVersion).toBe("19.2.0");
  });

  it("resolves React version when only in peerDependencies with catalog reference", () => {
    const monorepoRoot = path.join(tempDirectory, "peer-deps-catalog-root");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.2.0\n  react-dom: ^19.2.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", private: true }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "ui", "package.json"),
      JSON.stringify({
        name: "ui",
        peerDependencies: { react: "catalog:", "react-dom": "catalog:" },
        devDependencies: { react: "catalog:", "react-dom": "catalog:" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "ui"));
    expect(projectInfo.reactVersion).toBe("^19.2.0");
  });

  it("resolves React when catalog reference name does not exist (falls back to default)", () => {
    const monorepoRoot = path.join(tempDirectory, "nonexistent-catalog-name");
    fs.mkdirSync(path.join(monorepoRoot, "packages", "app"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - packages/*\n\ncatalog:\n  react: ^19.3.0\n",
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "monorepo", private: true }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "app", "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "catalog:nonexistent" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "app"));
    expect(projectInfo.reactVersion).toBe("^19.3.0");
  });

  it("handles empty pnpm-workspace.yaml gracefully", () => {
    const monorepoRoot = path.join(tempDirectory, "empty-workspace-yaml");
    fs.mkdirSync(monorepoRoot, { recursive: true });
    fs.writeFileSync(path.join(monorepoRoot, "pnpm-workspace.yaml"), "");
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "app", dependencies: { react: "^19.0.0" } }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("handles malformed package.json gracefully during workspace discovery", () => {
    const monorepoRoot = path.join(tempDirectory, "malformed-workspace-pkg");
    const subDir = path.join(monorepoRoot, "packages", "broken");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "monorepo",
        dependencies: { react: "^19.0.0" },
        workspaces: ["packages/*"],
      }),
    );
    fs.writeFileSync(path.join(subDir, "package.json"), "{ invalid json }}}");

    expect(() => discoverProject(monorepoRoot)).not.toThrow();
    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
  });

  it("discovers React and framework from workspace packages when scanning a monorepo root", () => {
    const monorepoRoot = path.join(tempDirectory, "root-project-from-workspace-packages");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "monorepo-root",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.framework).toBe("nextjs");
  });

  it("does not detect React Compiler when next.config sets reactCompiler to false", () => {
    const projectDirectory = path.join(tempDirectory, "next-react-compiler-disabled");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "next-react-compiler-disabled",
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "next.config.ts"),
      "import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = { reactCompiler: false };\nexport default nextConfig;\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(false);
    expect(projectInfo.hasReactCompilerLintPlugin).toBe(false);
  });

  it("detects React Compiler when next.config sets reactCompiler to true", () => {
    const projectDirectory = path.join(tempDirectory, "next-react-compiler-enabled");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "next-react-compiler-enabled",
        dependencies: { next: "^15.0.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "next.config.ts"),
      "import type { NextConfig } from 'next';\nconst nextConfig: NextConfig = { reactCompiler: true };\nexport default nextConfig;\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(true);
  });

  it("does not treat the React Compiler ESLint plugin as a build transform", () => {
    const projectDirectory = path.join(tempDirectory, "react-compiler-eslint-only");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-compiler-eslint-only",
        dependencies: { react: "^19.0.0" },
        devDependencies: { "eslint-plugin-react-compiler": "^19.0.0-beta" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(false);
    expect(projectInfo.hasReactCompilerLintPlugin).toBe(true);
  });

  it("does not treat a React Compiler ESLint plugin reference in build config as a transform", () => {
    const projectDirectory = path.join(tempDirectory, "react-compiler-eslint-config-only");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-compiler-eslint-config-only",
        dependencies: { react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "vite.config.ts"),
      "const lintPlugin = 'eslint-plugin-react-compiler';\nexport default { lintPlugin };\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(false);
    expect(projectInfo.hasReactCompilerLintPlugin).toBe(false);
  });

  it("does not inherit React Compiler capability from ancestor lint tooling", () => {
    const workspaceDirectory = path.join(tempDirectory, "react-compiler-eslint-workspace");
    const projectDirectory = path.join(workspaceDirectory, "packages", "app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify({
        name: "react-compiler-eslint-workspace",
        private: true,
        devDependencies: { "eslint-plugin-react-compiler": "^19.0.0-beta" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "app",
        dependencies: { react: "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(false);
    expect(projectInfo.hasReactCompilerLintPlugin).toBe(true);
  });

  it("detects a Babel Compiler transform alongside the ESLint plugin", () => {
    const projectDirectory = path.join(tempDirectory, "react-compiler-eslint-and-babel");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "react-compiler-eslint-and-babel",
        dependencies: { react: "^19.0.0" },
        devDependencies: { "eslint-plugin-react-compiler": "^19.0.0-beta" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "babel.config.js"),
      "module.exports = { plugins: ['babel-plugin-react-compiler'] };\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactCompiler).toBe(true);
    expect(projectInfo.hasReactCompilerLintPlugin).toBe(true);
  });
});

describe("listWorkspacePackages", () => {
  it("resolves nested workspace patterns like apps/*/ClientApp", () => {
    const packages = listWorkspacePackages(path.join(FIXTURES_DIRECTORY, "nested-workspaces"));
    const packageNames = packages.map((workspacePackage) => workspacePackage.name);

    expect(packageNames).toContain("my-app-client");
    expect(packageNames).toContain("ui");
    expect(packages).toHaveLength(2);
  });

  it("includes monorepo root when it has a React dependency", () => {
    const packages = listWorkspacePackages(
      path.join(FIXTURES_DIRECTORY, "monorepo-with-root-react"),
    );
    const packageNames = packages.map((workspacePackage) => workspacePackage.name);

    expect(packageNames).toContain("monorepo-root");
    expect(packageNames).toContain("ui");
    expect(packages).toHaveLength(2);
  });

  it("supports package.json workspaces object form", () => {
    const rootDirectory = path.join(tempDirectory, "workspace-object-form");
    const appDirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "workspace-object-root",
        workspaces: { packages: ["apps/*"] },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
    );

    const packages = listWorkspacePackages(rootDirectory);
    expect(packages).toEqual([{ name: "web", directory: appDirectory }]);
  });

  // HACK: cal.com's workspace patterns include both `"packages/*"` AND
  // `"packages/app-store"` — overlapping globs that resolve the same
  // directory through two patterns. Without dedup-by-directory the
  // same workspace gets scanned twice and downstream every diagnostic
  // is emitted twice. Pin the invariant that overlapping patterns
  // produce ONE entry per directory.
  it("dedupes packages discovered via overlapping workspace patterns (same directory matched twice)", () => {
    const rootDirectory = path.join(tempDirectory, "overlapping-workspaces");
    fs.mkdirSync(path.join(rootDirectory, "packages", "ui"), { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "monorepo-root",
        workspaces: ["packages/*", "packages/ui"],
      }),
    );
    fs.writeFileSync(
      path.join(rootDirectory, "packages", "ui", "package.json"),
      JSON.stringify({ name: "@example/ui", dependencies: { react: "^19.0.0" } }),
    );

    const packages = listWorkspacePackages(rootDirectory);
    const directories = packages.map((workspacePackage) => workspacePackage.directory);
    const uiOccurrences = directories.filter((directory) =>
      directory.endsWith(path.join("packages", "ui")),
    );

    expect(packages, "overlapping workspace patterns should yield one entry").toHaveLength(1);
    expect(uiOccurrences, "packages/ui should appear exactly once").toHaveLength(1);
  });

  it("flags a managed Expo app as an Expo project", () => {
    const projectDirectory = path.join(tempDirectory, "expo-managed-app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "expo-managed-app",
        dependencies: { expo: "~51.0.0", react: "^18.2.0", "react-native": "0.74.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("expo");
    expect(projectInfo.expoVersion).toBe("~51.0.0");
  });

  it("flags an Expo project even when a web bundler wins framework detection", () => {
    const projectDirectory = path.join(tempDirectory, "expo-with-vite");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "expo-with-vite",
        dependencies: { expo: "~51.0.0", "react-native": "0.74.0", react: "^18.2.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework, "vite is matched before expo").toBe("vite");
    expect(projectInfo.expoVersion, "expo dependency still flags the project").toBe("~51.0.0");
  });

  it("flags a web-rooted monorepo with an Expo workspace as an Expo project", () => {
    const rootDirectory = path.join(tempDirectory, "expo-workspace-monorepo");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "monorepo-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { expo: "~51.0.0", react: "^18.2.0", "react-native": "0.74.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.expoVersion, "expo version is resolved from the workspace").toBe("~51.0.0");
  });

  it("detects `expo` declared only in peerDependencies", () => {
    const projectDirectory = path.join(tempDirectory, "expo-peer-dep");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "expo-peer-dep",
        dependencies: { react: "^18.2.0", "react-native": "0.74.0" },
        peerDependencies: { expo: "~51.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.expoVersion).toBe("~51.0.0");
  });

  it("does not crash and stays null on a non-string `expo` spec", () => {
    const projectDirectory = path.join(tempDirectory, "expo-non-string");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      // `expo` as a number is malformed but parseable JSON.
      '{"name":"bad","dependencies":{"react":"^18.2.0","react-native":"0.74.0","expo":54}}',
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.expoVersion).toBeNull();
  });

  it("resolves an Expo `catalog:` spec from the pnpm workspace catalog", () => {
    const monorepoRoot = path.join(tempDirectory, "expo-pnpm-catalog");
    const mobileDirectory = path.join(monorepoRoot, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  expo: ~54.0.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { expo: "catalog:", react: "^18.2.0", "react-native": "0.74.0" },
      }),
    );

    const projectInfo = discoverProject(mobileDirectory);
    expect(projectInfo.expoVersion, "catalog spec resolves so the SDK major can be parsed").toBe(
      "~54.0.0",
    );
  });

  it("does not flag a bare React Native (non-Expo) project as an Expo project", () => {
    const projectDirectory = path.join(tempDirectory, "bare-react-native");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "bare-react-native",
        dependencies: { "react-native": "0.74.0", react: "^18.2.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("react-native");
    expect(projectInfo.expoVersion).toBeNull();
  });

  it("does not flag a plain web project as an Expo project", () => {
    const projectDirectory = path.join(tempDirectory, "plain-web-app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "plain-web-app",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.expoVersion).toBeNull();
  });
});

describe("discoverProject — node-resolution React fallback", () => {
  const writeInstalledReact = (rootDirectory: string, version: string): void => {
    const reactDirectory = path.join(rootDirectory, "node_modules", "react");
    fs.mkdirSync(reactDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(reactDirectory, "package.json"),
      JSON.stringify({ name: "react", version, main: "index.js" }),
    );
    fs.writeFileSync(path.join(reactDirectory, "index.js"), "module.exports = {};\n");
  };

  it("resolves the installed React version when the declaration is version-less", () => {
    const projectDirectory = path.join(tempDirectory, "react-workspace-protocol-installed");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "widget", dependencies: { react: "workspace:*" } }),
    );
    writeInstalledReact(projectDirectory, "19.1.0");

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("19.1.0");
    expect(projectInfo.reactMajorVersion).toBe(19);
  });

  it("detects React hoisted into an enclosing node_modules with no declaration", () => {
    const repositoryRoot = path.join(tempDirectory, "hoisted-react-repo");
    const packageDirectory = path.join(repositoryRoot, "packages", "widget");
    fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: "widget" }),
    );
    writeInstalledReact(repositoryRoot, "18.3.1");

    const projectInfo = discoverProject(packageDirectory);
    expect(projectInfo.reactVersion).toBe("18.3.1");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("does not adopt a React installed outside the enclosing repo boundary", () => {
    const outsideDirectory = path.join(tempDirectory, "containment-outside");
    const repositoryRoot = path.join(outsideDirectory, "repo");
    fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repositoryRoot, "package.json"), JSON.stringify({ name: "repo" }));
    // React lives one level ABOVE the git root, so the guard rejects it.
    writeInstalledReact(outsideDirectory, "18.0.0");

    const projectInfo = discoverProject(repositoryRoot);
    expect(projectInfo.reactVersion).toBeNull();
    expect(projectInfo.reactMajorVersion).toBeNull();
  });

  it("leaves a parseable peer range untouched even when a different React is installed", () => {
    const projectDirectory = path.join(tempDirectory, "peer-range-installed");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "component-lib",
        peerDependencies: { react: "^18.0.0 || ^19.0.0" },
      }),
    );
    writeInstalledReact(projectDirectory, "19.5.0");

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBe("^18.0.0 || ^19.0.0");
    expect(projectInfo.reactMajorVersion).toBe(18);
  });

  it("does not override a concrete declared version with a different install", () => {
    const projectDirectory = path.join(tempDirectory, "concrete-not-overridden");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "app", dependencies: { react: "18.2.0" } }),
    );
    writeInstalledReact(projectDirectory, "19.9.9");

    // The declared concrete version parses to a major, so the fallback stays out.
    expect(discoverProject(projectDirectory).reactVersion).toBe("18.2.0");
  });

  it("detects React when the project's node_modules is symlinked outside the repo", () => {
    // Docker-volume / shared-store shape: node_modules is a symlink to a
    // directory outside the working tree, but it is still the project's install.
    const storeDirectory = path.join(tempDirectory, "symlink-store");
    const reactInStore = path.join(storeDirectory, "react");
    fs.mkdirSync(reactInStore, { recursive: true });
    fs.writeFileSync(
      path.join(reactInStore, "package.json"),
      JSON.stringify({ name: "react", version: "19.0.0" }),
    );
    const repositoryRoot = path.join(tempDirectory, "symlink-repo");
    fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
    fs.writeFileSync(
      path.join(repositoryRoot, "package.json"),
      JSON.stringify({ name: "repo", dependencies: { react: "*" } }),
    );
    fs.symlinkSync(storeDirectory, path.join(repositoryRoot, "node_modules"));

    expect(discoverProject(repositoryRoot).reactVersion).toBe("19.0.0");
  });

  it("does not walk to a global node_modules when the scan tree has no boundary", () => {
    // No git root and no workspace marker: the search floors at the scanned
    // package, so a React hoisted above it isn't adopted.
    const parentDirectory = path.join(tempDirectory, "no-boundary-parent");
    fs.mkdirSync(parentDirectory, { recursive: true });
    writeInstalledReact(parentDirectory, "18.0.0");
    const packageDirectory = path.join(parentDirectory, "pkg");
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({ name: "pkg", dependencies: { react: "*" } }),
    );

    // The fallback fires (`*` has no major) but floors at the package, so the
    // hoisted `18.0.0` is not adopted — the declared `*` is left in place.
    const projectInfo = discoverProject(packageDirectory);
    expect(projectInfo.reactVersion).toBe("*");
    expect(projectInfo.reactMajorVersion).toBeNull();
  });

  it("ignores an installed React whose package.json has no usable version", () => {
    const projectDirectory = path.join(tempDirectory, "installed-no-version");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "app", dependencies: { react: "*" } }),
    );
    const reactDirectory = path.join(projectDirectory, "node_modules", "react");
    fs.mkdirSync(reactDirectory, { recursive: true });
    fs.writeFileSync(path.join(reactDirectory, "package.json"), JSON.stringify({ name: "react" }));

    // `react: "*"` parses to no major and the install has no version → stays as-is.
    expect(discoverProject(projectDirectory).reactVersion).toBe("*");
  });
});

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-discover-test-"));

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

describe("discoverProject without a package.json", () => {
  it("synthesizes a non-React project for a bare directory of source files", () => {
    const projectDirectory = path.join(tempDirectory, "bare-ts-dir");
    fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "src", "index.ts"),
      "export const add = (a: number, b: number) => a + b;\n",
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.reactVersion).toBeNull();
    expect(projectInfo.preactVersion).toBeNull();
    expect(projectInfo.framework).toBe("unknown");
    expect(projectInfo.sourceFileCount).toBeGreaterThan(0);
    expect(projectInfo.rootDirectory).toBe(projectDirectory);
  });

  it("detects TypeScript from a tsconfig.json even without a package.json", () => {
    const projectDirectory = path.join(tempDirectory, "bare-ts-with-config");
    fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "tsconfig.json"), "{}\n");
    fs.writeFileSync(path.join(projectDirectory, "src", "main.ts"), "export const x = 1;\n");

    expect(discoverProject(projectDirectory).hasTypeScript).toBe(true);
  });

  it("inherits React detection from the enclosing workspace root", () => {
    const workspaceRoot = path.join(tempDirectory, "react-workspace");
    const subdirectory = path.join(workspaceRoot, "packages");
    fs.mkdirSync(path.join(subdirectory, "ui", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, "package.json"),
      JSON.stringify({
        name: "react-workspace",
        dependencies: { react: "^19.0.0" },
        workspaces: ["packages/*"],
      }),
    );
    fs.writeFileSync(path.join(subdirectory, "ui", "src", "index.ts"), "export const ok = true;\n");

    // `packages` has no package.json of its own, so detection is inherited
    // from the React workspace root above it.
    const projectInfo = discoverProject(subdirectory);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.rootDirectory).toBe(subdirectory);
  });

  it("inherits React detection from a plain (non-monorepo) enclosing app root", () => {
    const appRoot = path.join(tempDirectory, "plain-react-app");
    const subdirectory = path.join(appRoot, "src", "components");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(appRoot, "package.json"),
      JSON.stringify({ name: "plain-react-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(path.join(subdirectory, "button.tsx"), "export const ok = true;\n");

    // `src/components` has no package.json and the app is not a workspace root,
    // so the nearest-ancestor walk adopts the app root to keep React on.
    const projectInfo = discoverProject(subdirectory);
    expect(projectInfo.reactVersion).toBe("^19.0.0");
    expect(projectInfo.rootDirectory).toBe(subdirectory);
  });

  it("does not escape a boundary scan directory to an ancestor package.json", () => {
    const outsideDirectory = path.join(tempDirectory, "boundary-escape-outside");
    const repositoryRoot = path.join(outsideDirectory, "repo");
    fs.mkdirSync(path.join(repositoryRoot, ".git"), { recursive: true });
    // An unrelated React package.json ABOVE the repo boundary.
    fs.writeFileSync(
      path.join(outsideDirectory, "package.json"),
      JSON.stringify({ name: "outside", dependencies: { react: "^19.0.0" } }),
    );
    // The repo root is a git boundary with no package.json of its own, just source.
    fs.writeFileSync(path.join(repositoryRoot, "index.ts"), "export const ok = true;\n");

    const projectInfo = discoverProject(repositoryRoot);
    expect(projectInfo.reactVersion).toBeNull();
    expect(projectInfo.rootDirectory).toBe(repositoryRoot);
  });

  it("throws PackageJsonNotFoundError for an empty directory with nothing to scan", () => {
    const emptyDirectory = path.join(tempDirectory, "truly-empty");
    fs.mkdirSync(emptyDirectory, { recursive: true });
    expect(() => discoverProject(emptyDirectory)).toThrow(PackageJsonNotFoundError);
  });
});

describe("discoverReactSubprojects", () => {
  it("skips subdirectories where package.json is a directory (EISDIR)", () => {
    const rootDirectory = path.join(tempDirectory, "eisdir-package-json");
    const subdirectory = path.join(rootDirectory, "broken-sub");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.mkdirSync(path.join(subdirectory, "package.json"), { recursive: true });

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
  });

  it("includes root directory when it has a react dependency", () => {
    const rootDirectory = path.join(tempDirectory, "root-with-react");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toContainEqual({ name: "my-app", directory: rootDirectory });
  });

  it("includes both root and subdirectory when both have react", () => {
    const rootDirectory = path.join(tempDirectory, "root-and-sub");
    const subdirectory = path.join(rootDirectory, "extension");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(subdirectory, "package.json"),
      JSON.stringify({ name: "my-extension", dependencies: { react: "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(2);
    expect(packages[0]).toEqual({ name: "my-app", directory: rootDirectory });
    expect(packages[1]).toEqual({ name: "my-extension", directory: subdirectory });
  });

  it("includes deeply nested React packages", () => {
    const rootDirectory = path.join(tempDirectory, "deep-react-package");
    const subdirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(subdirectory, { recursive: true });
    fs.writeFileSync(
      path.join(subdirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toContainEqual({ name: "web", directory: subdirectory });
  });

  it("skips OS/editor app-data directories during filesystem recursion", () => {
    // Repro for #545: a home-directory scan must not surface React packages
    // vendored inside editor installs (here, a VS Code extension under AppData).
    const rootDirectory = path.join(tempDirectory, "home-with-appdata");
    const editorExtension = path.join(
      rootDirectory,
      "AppData",
      "Local",
      "Programs",
      "Microsoft VS Code",
      "resources",
      "app",
      "extensions",
      "copilot",
    );
    const realProject = path.join(rootDirectory, "Downloads", "my-app", "frontend");
    fs.mkdirSync(editorExtension, { recursive: true });
    fs.mkdirSync(realProject, { recursive: true });
    fs.writeFileSync(
      path.join(editorExtension, "package.json"),
      JSON.stringify({ name: "copilot", dependencies: { react: "^18.0.0" } }),
    );
    fs.writeFileSync(
      path.join(realProject, "package.json"),
      JSON.stringify({ name: "frontend", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toEqual([{ name: "frontend", directory: realProject }]);
  });

  it("does not descend past the maximum scan depth during filesystem recursion", () => {
    const rootDirectory = path.join(tempDirectory, "deeply-vendored");
    const tooDeep = path.join(rootDirectory, "a", "b", "c", "d", "e", "f", "g");
    fs.mkdirSync(tooDeep, { recursive: true });
    fs.writeFileSync(
      path.join(tooDeep, "package.json"),
      JSON.stringify({ name: "too-deep", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("prefers pnpm workspace packages over filesystem recursion", () => {
    const rootDirectory = path.join(tempDirectory, "pnpm-workspace-preferred");
    const workspaceDirectory = path.join(rootDirectory, "apps", "web");
    const unlistedDirectory = path.join(rootDirectory, "examples", "preview");
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    fs.mkdirSync(unlistedDirectory, { recursive: true });
    fs.writeFileSync(path.join(rootDirectory, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
    fs.writeFileSync(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(unlistedDirectory, "package.json"),
      JSON.stringify({ name: "preview", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toEqual([{ name: "web", directory: workspaceDirectory }]);
  });

  it("skips ignored generated directories during filesystem recursion", () => {
    const rootDirectory = path.join(tempDirectory, "ignored-generated-directories");
    const ignoredDirectory = path.join(rootDirectory, "node_modules", "preview");
    fs.mkdirSync(ignoredDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(ignoredDirectory, "package.json"),
      JSON.stringify({ name: "preview", dependencies: { react: "^19.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("does not match packages with only @types/react", () => {
    const rootDirectory = path.join(tempDirectory, "types-only");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "types-only", devDependencies: { "@types/react": "^18.0.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(0);
  });

  it("matches packages with react-native dependency", () => {
    const rootDirectory = path.join(tempDirectory, "rn-app");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "rn-app", dependencies: { "react-native": "^0.74.0" } }),
    );

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
  });

  it("handles nonexistent root directory without crashing", () => {
    const packages = discoverReactSubprojects("/nonexistent/path/that/doesnt/exist");
    expect(packages).toHaveLength(0);
  });

  it("skips subdirectory entries that are files instead of directories", () => {
    const rootDirectory = path.join(tempDirectory, "file-as-subdir");
    fs.mkdirSync(rootDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "my-app", dependencies: { react: "^19.0.0" } }),
    );
    fs.writeFileSync(path.join(rootDirectory, "not-a-dir"), "just a file");

    const packages = discoverReactSubprojects(rootDirectory);
    expect(packages).toHaveLength(1);
    expect(packages[0].name).toBe("my-app");
  });
});

describe("discoverProject — hasReactNativeWorkspace", () => {
  it("is true when the entry-point package itself declares `react-native`", () => {
    const projectDirectory = path.join(tempDirectory, "rn-aware-self");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "mobile-app",
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when the entry-point package declares `expo`", () => {
    const projectDirectory = path.join(tempDirectory, "rn-aware-expo");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "expo-app",
        dependencies: { react: "^19.0.0", expo: "^51.0.0", "expo-router": "^3.5.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace sibling declares `react-native` even if the root is web-only (inverted-gate fixture)", () => {
    // Root `package.json` is Next.js-shaped; `apps/mobile` is an Expo
    // workspace. The capability gate in `buildCapabilities` keys off
    // this bit so `rn-*` rules still load on `apps/mobile` despite
    // the root framework being `nextjs`. Without the workspace walk
    // the bit would be `false` and every `rn-*` rule would be
    // dropped at the project level before the file-level wrapper
    // could ever silence them.
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo");
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "inverted-monorepo",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0", "react-native": "0.76.0", expo: "^51.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace lists `react-native` only in `optionalDependencies` (parity with the file-level classifier)", () => {
    // pinned because the project-info predicate previously only
    // walked `dependencies` / `devDependencies` / `peerDependencies`
    // while the oxlint plugin's `classifyPackagePlatform` also walks
    // `optionalDependencies`. The drift meant a workspace with
    // `react-native` in optionalDependencies would classify as RN
    // for the file-level rule gate but stay invisible to the
    // project-level capability gate, dropping every `rn-*` rule.
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-opt-deps");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "opt-deps-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0" },
        optionalDependencies: { "react-native": "0.76.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace declares only an `@react-native-*` namespace dependency (prefix match)", () => {
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-namespace");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "namespace-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: { react: "^19.0.0", "@react-native-firebase/app": "^21.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is true when a workspace library sets Metro's top-level `react-native` resolution field", () => {
    const rootDirectory = path.join(tempDirectory, "inverted-monorepo-metro-field");
    const libDirectory = path.join(rootDirectory, "packages", "native-lib");
    fs.mkdirSync(libDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "metro-field-root",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["packages/*"],
      }),
    );
    fs.writeFileSync(
      path.join(libDirectory, "package.json"),
      JSON.stringify({
        name: "native-lib",
        dependencies: { react: "^19.0.0" },
        "react-native": "./dist/native/index.js",
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
  });

  it("is false on a pure web monorepo where no workspace declares any RN dependency", () => {
    const rootDirectory = path.join(tempDirectory, "pure-web-monorepo");
    const webDirectory = path.join(rootDirectory, "apps", "web");
    const docsDirectory = path.join(rootDirectory, "apps", "docs");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.mkdirSync(docsDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "pure-web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(docsDirectory, "package.json"),
      JSON.stringify({
        name: "docs",
        dependencies: { "@docusaurus/core": "^3.4.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(false);
  });

  it("is false on a single-package web project (no workspaces, no RN deps)", () => {
    const projectDirectory = path.join(tempDirectory, "single-web-app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "single-web",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(false);
  });
});

describe("discoverProject — hasReanimated", () => {
  it("is true when the entry-point Expo app declares `react-native-reanimated`", () => {
    const projectDirectory = path.join(tempDirectory, "reanimated-self");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "spinning-app",
        dependencies: {
          react: "^19.0.0",
          expo: "^51.0.0",
          "react-native-reanimated": "~3.16.0",
        },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReanimated).toBe(true);
    expect(projectInfo.reanimatedVersion).toBe("~3.16.0");
  });

  it("is true when a workspace sibling declares `react-native-reanimated` (web-rooted monorepo)", () => {
    const rootDirectory = path.join(tempDirectory, "reanimated-monorepo");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "reanimated-monorepo",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: {
          react: "^19.0.0",
          "react-native": "0.76.0",
          "react-native-reanimated": "^3.16.0",
        },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.hasReanimated).toBe(true);
  });

  it("is false for a React Native project that does not depend on reanimated", () => {
    const projectDirectory = path.join(tempDirectory, "rn-without-reanimated");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "plain-rn-app",
        dependencies: { react: "^19.0.0", "react-native": "0.76.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
    expect(projectInfo.hasReanimated).toBe(false);
  });

  it("is false for a web project (the reanimated walk is gated behind React Native)", () => {
    const projectDirectory = path.join(tempDirectory, "web-no-reanimated");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "web-app",
        dependencies: { next: "^14.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.hasReanimated).toBe(false);
  });
});

describe("discoverProject — Zod", () => {
  it("detects Zod version from dependencies", () => {
    const projectDirectory = path.join(tempDirectory, "zod-from-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "zod-app",
        dependencies: { react: "^19.0.0", zod: "^4.1.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.zodVersion).toBe("^4.1.0");
    expect(projectInfo.zodMajorVersion).toBe(4);
  });

  it("detects Zod version from workspace packages", () => {
    const rootDirectory = path.join(tempDirectory, "zod-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "zod-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { zod: "^4.1.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.zodVersion).toBe("^4.1.0");
    expect(projectInfo.zodMajorVersion).toBe(4);
  });
});

describe("discoverProject — MobX", () => {
  it("detects a direct MobX dependency and parses its major", () => {
    const projectDirectory = path.join(tempDirectory, "mobx-from-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "mobx-app",
        dependencies: { react: "^19.0.0", mobx: "^6.16.1" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.mobxVersion).toBe("^6.16.1");
    expect(projectInfo.mobxMajorVersion).toBe(6);
  });

  it("detects MobX core and bindings across workspace packages", () => {
    const rootDirectory = path.join(tempDirectory, "mobx-monorepo");
    const coreDirectory = path.join(rootDirectory, "packages", "core");
    const reactDirectory = path.join(rootDirectory, "packages", "react");
    fs.mkdirSync(coreDirectory, { recursive: true });
    fs.mkdirSync(reactDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "mobx-monorepo",
        workspaces: ["packages/*"],
        dependencies: { react: "^19.0.0", "mobx-react-observer": "^2.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(coreDirectory, "package.json"),
      JSON.stringify({
        name: "core",
        dependencies: { mobx: "^6.16.1", "mobx-state-tree": "^7.0.2" },
      }),
    );
    fs.writeFileSync(
      path.join(reactDirectory, "package.json"),
      JSON.stringify({
        name: "react",
        dependencies: { "mobx-react": "^9.2.1", "mobx-react-lite": "^4.1.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.mobxVersion).toBe("^6.16.1");
    expect(projectInfo.mobxMajorVersion).toBe(6);
    expect(projectInfo.hasMobxReact).toBe(true);
    expect(projectInfo.hasMobxReactLite).toBe(true);
    expect(projectInfo.hasMobxStateTree).toBe(true);
    expect(projectInfo.hasMobxReactObserver).toBe(true);
  });

  it("uses the oldest supported MobX major across a mixed-version workspace", () => {
    const rootDirectory = path.join(tempDirectory, "mixed-mobx-monorepo");
    const legacyDirectory = path.join(rootDirectory, "apps", "legacy");
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "mixed-mobx-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", mobx: "^6.16.1" },
      }),
    );
    fs.writeFileSync(
      path.join(legacyDirectory, "package.json"),
      JSON.stringify({ name: "legacy", dependencies: { mobx: "^5.15.7" } }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.mobxVersion).toBe("^5.15.7");
    expect(projectInfo.mobxMajorVersion).toBe(5);
  });

  it("fails closed when any workspace has an unparseable MobX declaration", () => {
    const rootDirectory = path.join(tempDirectory, "unknown-mobx-monorepo");
    const unknownDirectory = path.join(rootDirectory, "apps", "unknown");
    fs.mkdirSync(unknownDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "unknown-mobx-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", mobx: "^6.16.1" },
      }),
    );
    fs.writeFileSync(
      path.join(unknownDirectory, "package.json"),
      JSON.stringify({ name: "unknown", dependencies: { mobx: "workspace:*" } }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.mobxVersion).toBe("workspace:*");
    expect(projectInfo.mobxMajorVersion).toBeNull();
  });

  it("fails closed when any workspace declares a future MobX major", () => {
    const rootDirectory = path.join(tempDirectory, "future-mobx-monorepo");
    const futureDirectory = path.join(rootDirectory, "apps", "future");
    fs.mkdirSync(futureDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "future-mobx-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", mobx: "^6.16.1" },
      }),
    );
    fs.writeFileSync(
      path.join(futureDirectory, "package.json"),
      JSON.stringify({ name: "future", dependencies: { mobx: "^7.0.0" } }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.mobxVersion).toBe("^7.0.0");
    expect(projectInfo.mobxMajorVersion).toBe(7);
  });

  it("resolves a MobX version from a package catalog", () => {
    const projectDirectory = path.join(tempDirectory, "catalog-mobx");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "catalog-mobx",
        catalog: { mobx: "^6.16.1" },
        dependencies: { react: "^19.0.0", mobx: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.mobxVersion).toBe("^6.16.1");
    expect(projectInfo.mobxMajorVersion).toBe(6);
  });
});

describe("discoverProject — Zustand", () => {
  it("detects a direct Zustand dependency and parses its major", () => {
    const projectDirectory = path.join(tempDirectory, "zustand-from-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "zustand-app",
        dependencies: { react: "^19.0.0", zustand: "^5.0.8" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.zustandVersion).toBe("^5.0.8");
    expect(projectInfo.zustandMajorVersion).toBe(5);
  });

  it("detects Zustand from a workspace package", () => {
    const rootDirectory = path.join(tempDirectory, "zustand-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "zustand-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { zustand: "^4.5.7" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.zustandVersion).toBe("^4.5.7");
    expect(projectInfo.zustandMajorVersion).toBe(4);
  });

  it("uses the oldest supported Zustand major across a mixed-version workspace", () => {
    const rootDirectory = path.join(tempDirectory, "mixed-zustand-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "legacy");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "mixed-zustand-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", zustand: "^5.0.8" },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "legacy",
        dependencies: { zustand: "^4.5.7" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.zustandVersion).toBe("^4.5.7");
    expect(projectInfo.zustandMajorVersion).toBe(4);
  });

  it("fails closed when any workspace has an unparseable Zustand declaration", () => {
    const rootDirectory = path.join(tempDirectory, "unknown-zustand-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "unknown");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "unknown-zustand-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", zustand: "^5.0.8" },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "unknown",
        dependencies: { zustand: "workspace:*" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.zustandVersion).toBe("workspace:*");
    expect(projectInfo.zustandMajorVersion).toBeNull();
  });

  it("fails closed when any workspace declares a future Zustand major", () => {
    const rootDirectory = path.join(tempDirectory, "future-zustand-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "future");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        name: "future-zustand-monorepo",
        workspaces: ["apps/*"],
        dependencies: { react: "^19.0.0", zustand: "^5.0.8" },
      }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "future",
        dependencies: { zustand: "^6.0.0" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.zustandVersion).toBe("^6.0.0");
    expect(projectInfo.zustandMajorVersion).toBe(6);
  });

  it("resolves a Zustand version from a package catalog", () => {
    const projectDirectory = path.join(tempDirectory, "catalog-zustand");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "catalog-zustand",
        catalog: { zustand: "^5.0.8" },
        dependencies: { react: "^19.0.0", zustand: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.zustandVersion).toBe("^5.0.8");
    expect(projectInfo.zustandMajorVersion).toBe(5);
  });
});

describe("formatFrameworkName", () => {
  it("formats known frameworks", () => {
    expect(formatFrameworkName("nextjs")).toBe("Next.js");
    expect(formatFrameworkName("vite")).toBe("Vite");
    expect(formatFrameworkName("cra")).toBe("Create React App");
    expect(formatFrameworkName("remix")).toBe("Remix");
    expect(formatFrameworkName("gatsby")).toBe("Gatsby");
  });

  it("formats unknown framework as React", () => {
    expect(formatFrameworkName("unknown")).toBe("React");
  });

  it("formats Preact", () => {
    expect(formatFrameworkName("preact")).toBe("Preact");
  });
});

describe("discoverProject — Preact", () => {
  it("classifies a Preact-only project as `preact` and sets `preactVersion`", () => {
    const projectDirectory = path.join(tempDirectory, "preact-only-project");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "preact-only-project",
        dependencies: { preact: "^10.22.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("preact");
    expect(projectInfo.reactVersion).toBe(null);
    expect(projectInfo.preactVersion).toBe("^10.22.0");
    expect(projectInfo.preactMajorVersion).toBe(10);
  });

  it("keeps `framework: vite` for Preact-on-Vite but still sets `preactVersion`", () => {
    const projectDirectory = path.join(tempDirectory, "preact-with-vite");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "preact-with-vite",
        dependencies: { preact: "^10.22.0" },
        devDependencies: { vite: "^7.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("vite");
    expect(projectInfo.preactVersion).toBe("^10.22.0");
    expect(projectInfo.preactMajorVersion).toBe(10);
  });

  it("stays `unknown` when both `react` and `preact` peer-deps are declared (component library shape)", () => {
    const projectDirectory = path.join(tempDirectory, "react-and-preact-peer-deps");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "dual-peer-component-library",
        peerDependencies: { react: "^18.0.0 || ^19.0.0", preact: "^10.22.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("unknown");
    expect(projectInfo.preactVersion).toBe("^10.22.0");
    expect(projectInfo.preactMajorVersion).toBe(10);
    expect(projectInfo.reactVersion).toBe("^18.0.0 || ^19.0.0");
  });

  it("`preactVersion` is null for projects with no `preact` declaration", () => {
    const projectDirectory = path.join(tempDirectory, "no-preact-here");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "no-preact-here",
        dependencies: { react: "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.preactVersion).toBe(null);
    expect(projectInfo.preactMajorVersion).toBe(null);
  });
});

describe("discoverProject — FlashList", () => {
  it("detects @shopify/flash-list v2 in a React Native project", () => {
    const projectDirectory = path.join(tempDirectory, "flash-list-v2");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "flash-list-v2",
        dependencies: {
          react: "^19.0.0",
          "react-native": "0.76.0",
          "@shopify/flash-list": "^2.0.0",
        },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.shopifyFlashListVersion).toBe("^2.0.0");
    expect(projectInfo.shopifyFlashListMajorVersion).toBe(2);
  });

  it("resolves @shopify/flash-list from a workspace catalog", () => {
    const rootDirectory = path.join(tempDirectory, "flash-list-workspace-catalog");
    const mobileDirectory = path.join(rootDirectory, "apps", "mobile");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "pnpm-workspace.yaml"),
      'packages:\n  - apps/*\n\ncatalog:\n  "@shopify/flash-list": ^2.1.0\n',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "root", workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "mobile",
        dependencies: {
          react: "^19.0.0",
          "react-native": "0.76.0",
          "@shopify/flash-list": "catalog:",
        },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.shopifyFlashListVersion).toBe("^2.1.0");
    expect(projectInfo.shopifyFlashListMajorVersion).toBe(2);
  });
});

describe("discoverProject — Next.js version", () => {
  it("detects the `next` version and major from a single-package app", () => {
    const projectDirectory = path.join(tempDirectory, "nextjs-single-app");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "nextjs-single-app",
        dependencies: { next: "^15.3.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.nextjsVersion).toBe("^15.3.0");
    expect(projectInfo.nextjsMajorVersion).toBe(15);
  });

  it("resolves a `next` `catalog:` spec from the pnpm workspace catalog so the major parses", () => {
    // Repro for the Bugbot "Next catalog refs unresolved" finding: a `catalog:`
    // spec must resolve to a concrete version, otherwise `nextjsMajorVersion`
    // stays null and `server-fetch-without-revalidate` keeps firing on Next 15+.
    const monorepoRoot = path.join(tempDirectory, "nextjs-pnpm-catalog");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  next: ^15.3.0\n",
    );
    fs.writeFileSync(path.join(monorepoRoot, "package.json"), JSON.stringify({ name: "root" }));
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "catalog:", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(webDirectory);
    expect(projectInfo.nextjsVersion).toBe("^15.3.0");
    expect(projectInfo.nextjsMajorVersion).toBe(15);
  });

  it("resolves `next` declared only in a workspace when scanning a monorepo root", () => {
    // Repro for the Bugbot "Next version ignores workspaces" finding: the root
    // manifest has no `next`, but the framework is promoted to nextjs by the
    // workspace walk — so the version lookup must walk workspaces too.
    const monorepoRoot = path.join(tempDirectory, "nextjs-workspace-monorepo");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({
        name: "monorepo-root",
        private: true,
        workspaces: ["apps/*"],
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^15.3.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.nextjsVersion).toBe("^15.3.0");
    expect(projectInfo.nextjsMajorVersion).toBe(15);
  });

  it("does not crash and stays null on a non-string `next` spec", () => {
    const projectDirectory = path.join(tempDirectory, "nextjs-non-string");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      // `next` as a number is malformed but parseable JSON.
      '{"name":"bad","dependencies":{"react":"^19.0.0","next":15}}',
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.nextjsVersion).toBeNull();
    expect(projectInfo.nextjsMajorVersion).toBeNull();
  });

  it("leaves `nextjsMajorVersion` null for an unresolvable dist-tag spec (rule stays enabled)", () => {
    const projectDirectory = path.join(tempDirectory, "nextjs-dist-tag");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "nextjs-dist-tag",
        dependencies: { next: "latest", react: "^19.0.0", "react-dom": "^19.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.nextjsVersion).toBe("latest");
    expect(projectInfo.nextjsMajorVersion).toBeNull();
  });

  it("is null for a non-Next project", () => {
    const projectDirectory = path.join(tempDirectory, "vite-no-next");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "vite-no-next",
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
        devDependencies: { vite: "^5.0.0" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.nextjsVersion).toBeNull();
    expect(projectInfo.nextjsMajorVersion).toBeNull();
  });
});

describe("discoverProject — Valtio", () => {
  it("records the declared Valtio version for a single-package project", () => {
    const projectDirectory = path.join(tempDirectory, "valtio-single-package");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "valtio-app",
        dependencies: { react: "^19.0.0", valtio: "^2.1.4" },
      }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.valtioVersion).toBe("^2.1.4");
    expect(projectInfo.valtioMajorVersion).toBe(2);
  });

  it("records Valtio declared by a workspace when scanning the monorepo root", () => {
    const rootDirectory = path.join(tempDirectory, "valtio-monorepo");
    const appDirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^19.0.0", valtio: "^1.13.2" },
      }),
    );

    const projectInfo = discoverProject(rootDirectory);
    expect(projectInfo.valtioVersion).toBe("^1.13.2");
    expect(projectInfo.valtioMajorVersion).toBe(1);
  });

  it("resolves a Valtio catalog declaration from the pnpm workspace", () => {
    const rootDirectory = path.join(tempDirectory, "valtio-workspace-catalog");
    const appDirectory = path.join(rootDirectory, "apps", "web");
    fs.mkdirSync(appDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(rootDirectory, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n\ncatalog:\n  valtio: ^1.13.2\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({ name: "root", private: true }),
    );
    fs.writeFileSync(
      path.join(appDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { react: "^19.0.0", valtio: "catalog:" },
      }),
    );

    const projectInfo = discoverProject(appDirectory);
    expect(projectInfo.valtioVersion).toBe("^1.13.2");
    expect(projectInfo.valtioMajorVersion).toBe(1);
  });

  it("keeps the Valtio fact null when no analyzed package declares it", () => {
    const projectDirectory = path.join(tempDirectory, "without-valtio");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({ name: "plain-react-app", dependencies: { react: "^19.0.0" } }),
    );

    const projectInfo = discoverProject(projectDirectory);
    expect(projectInfo.valtioVersion).toBeNull();
    expect(projectInfo.valtioMajorVersion).toBeNull();
  });
});

describe("discoverProject — Next.js static export", () => {
  it('detects `output: "export"` from the scan root\'s own next.config', () => {
    const projectDirectory = path.join(tempDirectory, "static-export-root");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "package.json"),
      JSON.stringify({
        name: "static-export-root",
        dependencies: { next: "^15.3.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(projectDirectory, "next.config.mjs"),
      'export default { output: "export" };\n',
    );

    expect(discoverProject(projectDirectory).isStaticExport).toBe(true);
  });

  it("detects a workspace-level static export when scanning the monorepo root (#976)", () => {
    const monorepoRoot = path.join(tempDirectory, "static-export-workspace");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { next: "^15.3.0", react: "^19.0.0" },
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "next.config.mjs"),
      'export default { output: "export" };\n',
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.isStaticExport).toBe(true);
  });

  it("attributes static export to the first workspace (walk order) that declares `next`", () => {
    // Documented first-match semantics: with several Next workspaces, the
    // config read follows the same workspace that supplied `nextjsVersion`.
    const monorepoRoot = path.join(tempDirectory, "static-export-two-apps");
    const adminDirectory = path.join(monorepoRoot, "apps", "admin");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(adminDirectory, { recursive: true });
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(adminDirectory, "package.json"),
      JSON.stringify({ name: "admin", dependencies: { next: "^15.3.0", react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { next: "^15.3.0", react: "^19.0.0" } }),
    );
    // Only the LATER workspace (apps/web) exports; apps/admin sorts first and
    // supplies the `next` signal, so the project is not a static export.
    fs.writeFileSync(
      path.join(webDirectory, "next.config.mjs"),
      'export default { output: "export" };\n',
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.isStaticExport).toBe(false);
  });

  it("classifies a web+mobile monorepo by the web framework regardless of walk order", () => {
    // apps/a-mobile sorts before apps/web, but the cross-workspace merge is
    // priority-ranked (web over mobile, mirroring detectFramework), so the
    // Expo workspace must not claim the framework slot.
    const monorepoRoot = path.join(tempDirectory, "web-mobile-priority");
    const mobileDirectory = path.join(monorepoRoot, "apps", "a-mobile");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(mobileDirectory, { recursive: true });
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(mobileDirectory, "package.json"),
      JSON.stringify({
        name: "a-mobile",
        dependencies: { expo: "~52.0.0", react: "18.3.1", "react-native": "0.76.0" },
      }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { next: "^15.3.0", react: "^19.0.0" } }),
    );

    const projectInfo = discoverProject(monorepoRoot);
    expect(projectInfo.framework).toBe("nextjs");
    expect(projectInfo.nextjsMajorVersion).toBe(15);
    // The mobile workspace still surfaces through the RN/Expo facts.
    expect(projectInfo.hasReactNativeWorkspace).toBe(true);
    expect(projectInfo.expoVersion).toBe("~52.0.0");
  });

  it("stays false when no next.config sets output: export anywhere", () => {
    const monorepoRoot = path.join(tempDirectory, "static-export-none");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(webDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["apps/*"] }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "package.json"),
      JSON.stringify({ name: "web", dependencies: { next: "^15.3.0", react: "^19.0.0" } }),
    );
    fs.writeFileSync(
      path.join(webDirectory, "next.config.mjs"),
      "export default { reactStrictMode: true };\n",
    );

    expect(discoverProject(monorepoRoot).isStaticExport).toBe(false);
  });
});
