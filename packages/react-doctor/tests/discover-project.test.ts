import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  discoverProject,
  discoverReactSubprojects,
  formatFrameworkName,
  listWorkspacePackages,
} from "@react-doctor/project-info";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");
const VALID_FRAMEWORKS = ["nextjs", "vite", "cra", "remix", "gatsby", "unknown"];

describe("discoverProject", () => {
  it("detects React version from package.json", () => {
    const projectInfo = discoverProject(path.join(FIXTURES_DIRECTORY, "basic-react"));
    expect(projectInfo.reactVersion).toBe("^19.0.0");
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

  it("does not apply monorepo dependency versions to a leaf without declarations", () => {
    const monorepoRoot = path.join(tempDirectory, "leaf-skips-root-dependency-fallbacks");
    fs.mkdirSync(path.join(monorepoRoot, "apps", "web"), { recursive: true });
    fs.mkdirSync(path.join(monorepoRoot, "packages", "eslint-config"), { recursive: true });
    fs.writeFileSync(
      path.join(monorepoRoot, "pnpm-workspace.yaml"),
      "packages:\n  - apps/*\n  - packages/*\n\ncatalog:\n  react: ^19.0.0\n  tailwindcss: ^4.0.0\n",
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
        dependencies: { react: "catalog:", tailwindcss: "catalog:" },
      }),
    );
    fs.writeFileSync(
      path.join(monorepoRoot, "packages", "eslint-config", "package.json"),
      JSON.stringify({
        name: "eslint-config",
        devDependencies: { eslint: "^9.0.0" },
      }),
    );

    const projectInfo = discoverProject(path.join(monorepoRoot, "packages", "eslint-config"));
    expect(projectInfo.reactVersion).toBeNull();
    expect(projectInfo.reactMajorVersion).toBeNull();
    expect(projectInfo.tailwindVersion).toBeNull();
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
});

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-discover-test-"));

afterAll(() => {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
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
});
