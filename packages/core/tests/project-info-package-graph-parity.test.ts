import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { buildCapabilities } from "../src/project-info/capabilities.js";
import { clearProjectCache, discoverProject } from "../src/project-info/discover-project.js";
import type { PackageJson } from "../src/types/index.js";

const FIXTURES_DIRECTORY = path.join(import.meta.dirname, "fixtures");
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "react-doctor-project-info-parity-"),
);

interface ProjectFixture {
  readonly name: string;
  readonly directory: string;
}

interface CreatePackageFixtureOptions {
  readonly name: string;
  readonly packageJson: PackageJson;
}

const createPackageFixture = ({
  name,
  packageJson,
}: CreatePackageFixtureOptions): ProjectFixture => {
  const directory = path.join(temporaryDirectory, name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(packageJson));
  return { name, directory };
};

const fixtures: ReadonlyArray<ProjectFixture> = [
  ...[
    "basic-react",
    "component-library",
    "nextjs-app",
    "tanstack-start-app",
    "mixed-rn-web-monorepo",
    "pnpm-catalog-workspace",
    "pnpm-named-catalog",
    "bun-multiple-grouped-catalogs",
    "package-local-capabilities",
  ].map((name) => ({
    name,
    directory: path.join(FIXTURES_DIRECTORY, name),
  })),
  createPackageFixture({
    name: "react-17",
    packageJson: {
      name: "react-17",
      dependencies: { react: "^17.0.2", "react-dom": "^17.0.2" },
    },
  }),
  createPackageFixture({
    name: "non-react",
    packageJson: {
      name: "non-react",
      dependencies: { typescript: "^5.9.0", zod: "^4.0.0" },
    },
  }),
];

afterAll(() => {
  clearProjectCache();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("ProjectInfo PackageGraph parity", () => {
  for (const fixture of fixtures) {
    it(`preserves ${fixture.name}`, () => {
      clearProjectCache();
      const projectInfo = discoverProject(fixture.directory);

      expect({
        projectInfo: {
          ...projectInfo,
          rootDirectory: `<fixture:${fixture.name}>`,
        },
        capabilities: [...buildCapabilities(projectInfo)].toSorted(),
      }).toMatchSnapshot();
    });
  }
});
