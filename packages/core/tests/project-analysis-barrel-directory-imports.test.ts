import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProjectForWorker as analyzeProject } from "../src/project-analysis/analyze-project.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  packageJson: Readonly<Record<string, unknown>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-barrel-directory-"),
  );
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const unusedFilePaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

describe("barrel file directory imports with tsconfig paths", () => {
  it("does not flag barrel files imported via directory path with tsconfig alias", async () => {
    const rootDirectory = createProject(
      {
        "src/App.tsx": `
          import { BarScreen } from "./screens/bar";
          export const App = () => <BarScreen />;
        `,
        "src/screens/bar.tsx": `
          import { FooList } from "@/features/foo";
          export const BarScreen = () => <FooList />;
        `,
        "src/features/foo/index.ts": `export * from "./foo-list";`,
        "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@/*": ["./src/*"] },
            jsx: "react",
          },
        }),
      },
      { dependencies: { react: "^18.0.0" } },
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/App.tsx"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    
    // The barrel file should NOT be flagged as unused
    expect(unused).not.toContain("src/features/foo/index.ts");
    // The actual component should also not be flagged
    expect(unused).not.toContain("src/features/foo/foo-list.tsx");
  });

  it("does not flag barrel in Next.js app with auto-detected entries", async () => {
    const rootDirectory = createProject(
      {
        "app/page.tsx": `
          import { BarScreen } from "@/screens/bar";
          export default function Home() {
            return <BarScreen />;
          }
        `,
        "src/screens/bar.tsx": `
          import { FooList, FooCard } from "@/features/foo";
          export const BarScreen = () => (
            <div>
              <FooList />
              <FooCard />
            </div>
          );
        `,
        "src/features/foo/index.ts": `
          export * from "./foo-list";
          export * from "./foo-card";
        `,
        "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
        "src/features/foo/foo-card.tsx": `export const FooCard = () => <div>Foo Card</div>;`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            target: "ES2017",
            lib: ["dom", "dom.iterable", "esnext"],
            allowJs: true,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }],
            paths: { "@/*": ["./src/*"] },
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"],
        }),
        "next.config.js": "module.exports = {};",
      },
      { dependencies: { react: "^18.0.0", next: "^14.0.0" } },
    );

    // Don't provide explicit entry patterns - let it auto-detect
    const result = await analyzeProject({
      rootDirectory,
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    
    // The barrel file should NOT be flagged as unused
    expect(unused).not.toContain("src/features/foo/index.ts");
    // The actual components should also not be flagged
    expect(unused).not.toContain("src/features/foo/foo-list.tsx");
    expect(unused).not.toContain("src/features/foo/foo-card.tsx");
  });

  it("resolves barrel with baseUrl but no paths alias", async () => {
    const rootDirectory = createProject(
      {
        "src/App.tsx": `
          import { FooList } from "features/foo";
          export const App = () => <FooList />;
        `,
        "src/features/foo/index.ts": `export * from "./foo-list";`,
        "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: "./src",
            jsx: "react",
          },
        }),
      },
      { dependencies: { react: "^18.0.0" } },
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/App.tsx"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    
    expect(unused).not.toContain("src/features/foo/index.ts");
    expect(unused).not.toContain("src/features/foo/foo-list.tsx");
  });

  it("resolves barrel with relative directory import", async () => {
    const rootDirectory = createProject(
      {
        "src/App.tsx": `
          import { FooList } from "./features/foo";
          export const App = () => <FooList />;
        `,
        "src/features/foo/index.ts": `export * from "./foo-list";`,
        "src/features/foo/foo-list.tsx": `export const FooList = () => <div>Foo List</div>;`,
      },
      { dependencies: { react: "^18.0.0" } },
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/App.tsx"],
    });

    const unused = unusedFilePaths(rootDirectory, result.unusedFiles);
    
    expect(unused).not.toContain("src/features/foo/index.ts");
    expect(unused).not.toContain("src/features/foo/foo-list.tsx");
  });
});
