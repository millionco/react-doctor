import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";
import type { ClosedJsonSnapshotProjectInput } from "./get-closed-json-snapshot-project.js";
import type { ClosedJsonSnapshotSourceResolutionPolicy } from "./closed-json-snapshot-config/interfaces.js";
import { parseSourceText } from "./parse-source-file.js";
import { CLOSED_JSON_SNAPSHOT_PROJECT_MAX_FILES } from "./closed-json-snapshot/constants.js";
import { normalizeFilename } from "./normalize-filename.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";

const temporaryDirectories: string[] = [];

interface SnapshotProjectTestInput extends Omit<
  ClosedJsonSnapshotProjectInput,
  "sourceResolutionPolicy"
> {
  readonly sourceResolutionPolicy?: ClosedJsonSnapshotSourceResolutionPolicy;
}

const readSourceProject = ({
  rootDirectory,
  sourceResolutionPolicy,
  ...input
}: SnapshotProjectTestInput) =>
  getClosedJsonSnapshotProject({
    ...input,
    rootDirectory,
    sourceResolutionPolicy: sourceResolutionPolicy ?? {
      rootDirectory,
      extensions: [
        ".web.mjs",
        ".mjs",
        ".web.js",
        ".js",
        ".web.ts",
        ".ts",
        ".web.tsx",
        ".tsx",
        ".json",
        ".web.jsx",
        ".jsx",
      ],
      aliases: [],
    },
  });

const createProjectDirectory = (): string => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-project-")));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("getClosedJsonSnapshotProject", () => {
  it.each([".css", ".less"])(
    "refreshes a competing %s file without treating styles as executable source",
    (extension) => {
      const rootDirectory = createProjectDirectory();
      const ownerPath = path.join(rootDirectory, "owner.js");
      const receiverPath = path.join(rootDirectory, "receiver.js");
      const stylePath = path.join(rootDirectory, `receiver${extension}`);
      fs.writeFileSync(ownerPath, "import Receiver from './receiver'; export default Receiver;");
      fs.writeFileSync(receiverPath, "export default () => null;");
      const sourceResolutionPolicy = {
        rootDirectory,
        extensions: [".css", ".less", ".js"],
        aliases: [],
      };
      const sourceProjectInput = {
        rootDirectory,
        allowJsxInJs: false,
        sourceResolutionPolicy,
      };
      expect(
        readSourceProject(sourceProjectInput)?.resolveImport(ownerPath, "./receiver")?.filePath,
      ).toBe(normalizeFilename(receiverPath));
      fs.writeFileSync(stylePath, ".row { color: blue; }");
      expect(readSourceProject(sourceProjectInput)).toBeNull();
      fs.rmSync(stylePath);
      expect(
        readSourceProject(sourceProjectInput)?.resolveImport(ownerPath, "./receiver")?.filePath,
      ).toBe(normalizeFilename(receiverPath));
    },
  );
  it("projects source without compiler entries, bootstrap or HTML attestation", () => {
    const rootDirectory = createProjectDirectory();
    const currentFilePath = path.join(rootDirectory, "reader.js");
    const configFilePath = path.join(rootDirectory, "webpack.config.js");
    fs.writeFileSync(currentFilePath, "export default () => <div />;");
    fs.writeFileSync(
      configFilePath,
      "require('./missing-build-only-module'); module.exports = factory();",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "index.html"),
      "<script>JSON.parse = decoder;</script>",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "unmounted-writer.js"),
      "export const writer = true;",
    );
    const sourceResolutionPolicy = {
      rootDirectory,
      extensions: [".js", ".jsx", ".json"],
      aliases: [],
      configFilePaths: [configFilePath],
    };
    const project = readSourceProject({
      rootDirectory,
      allowJsxInJs: true,
      sourceResolutionPolicy,
    });
    expect([...(project?.modules.keys() ?? [])]).toEqual([
      normalizeFilename(currentFilePath),
      normalizeFilename(path.join(rootDirectory, "unmounted-writer.js")),
    ]);
    expect(project?.sourceResolutionPolicy).toBe(sourceResolutionPolicy);
    expect(project?.index.htmlFilePaths).toEqual([]);
    expect(project?.index.unresolvedRuntimeSources.size).toBe(0);
  });

  it("retains authoritative engine AST and source binding identities in the source projection", () => {
    const rootDirectory = createProjectDirectory();
    const currentFilePath = path.join(rootDirectory, "reader.js");
    fs.writeFileSync(currentFilePath, "export const value = diskValue;");
    const sourceText = "export const value = engineValue;";
    const currentProgramNode = parseSourceText({ filename: currentFilePath, sourceText });
    if (!currentProgramNode) throw new Error("Expected an engine program");
    const currentScopes = analyzeScopes(currentProgramNode);
    const project = readSourceProject({
      rootDirectory,
      allowJsxInJs: true,
      currentFilePath,
      currentProgramNode,
      currentScopes,
      currentSourceText: sourceText,
      sourceResolutionPolicy: { rootDirectory, extensions: [".js"], aliases: [] },
    });
    expect(project?.modules.get(normalizeFilename(currentFilePath))?.program).toBe(
      currentProgramNode,
    );
    expect(project?.modules.get(normalizeFilename(currentFilePath))?.scopes).toBe(currentScopes);
    expect(project?.modules.get(normalizeFilename(currentFilePath))?.sourceText).toBe(sourceText);
  });

  it("keeps ordinary asset imports outside the JavaScript source projection", () => {
    const rootDirectory = createProjectDirectory();
    const currentFilePath = path.join(rootDirectory, "reader.js");
    fs.writeFileSync(
      currentFilePath,
      "import './reader.css'; import icon from './icon.svg'; export const value = icon;",
    );
    fs.writeFileSync(path.join(rootDirectory, "icon.svg"), "<svg><script>foreign()</script></svg>");
    const sourceResolutionPolicy = { rootDirectory, extensions: [".js"], aliases: [] };
    const project = readSourceProject({
      rootDirectory,
      allowJsxInJs: true,
      sourceResolutionPolicy,
    });
    expect(project?.modules.size).toBe(1);
    expect(project?.resolveImport(currentFilePath, "./reader.css")).toBeNull();
    fs.writeFileSync(currentFilePath, "import './missing-reader.js'; export const value = true;");
    expect(
      readSourceProject({ rootDirectory, allowJsxInJs: true, sourceResolutionPolicy }),
    ).toBeNull();
  });

  it.each([
    "import config from './webpack.config.js'; export const value = config;",
    "export { default } from './webpack.config.js';",
    "const config = require('./webpack.config.js'); export const value = config;",
  ])("declines runtime source entering an excluded compiler module: %s", (sourceText) => {
    const rootDirectory = createProjectDirectory();
    const configFilePath = path.join(rootDirectory, "webpack.config.js");
    fs.writeFileSync(configFilePath, "module.exports = factory();");
    fs.writeFileSync(path.join(rootDirectory, "reader.js"), sourceText);
    expect(
      readSourceProject({
        rootDirectory,
        allowJsxInJs: true,
        sourceResolutionPolicy: {
          rootDirectory,
          extensions: [".js"],
          aliases: [],
          configFilePaths: [configFilePath],
        },
      }),
    ).toBeNull();
  });

  it("never excludes the current source or a config-looking file by basename", () => {
    const rootDirectory = createProjectDirectory();
    const currentFilePath = path.join(rootDirectory, "webpack.config.js");
    fs.writeFileSync(currentFilePath, "export const writer = true;");
    const sourceResolutionPolicy = { rootDirectory, extensions: [".js"], aliases: [] };
    expect(
      readSourceProject({
        rootDirectory,
        allowJsxInJs: true,
        sourceResolutionPolicy,
      })?.modules.has(normalizeFilename(currentFilePath)),
    ).toBe(true);
    expect(
      readSourceProject({
        rootDirectory,
        allowJsxInJs: true,
        currentFilePath,
        sourceResolutionPolicy: { ...sourceResolutionPolicy, configFilePaths: [currentFilePath] },
      }),
    ).toBeNull();
  });

  it("freshly resolves source aliases and preserves their complete incoming reference inventory", () => {
    const rootDirectory = createProjectDirectory();
    const targetPath = path.join(rootDirectory, "reader.js");
    const ownerPath = path.join(rootDirectory, "owner.js");
    fs.writeFileSync(targetPath, "export default () => null;");
    fs.writeFileSync(ownerPath, "import Reader from 'views/reader'; export default Reader;");
    const sourceResolutionPolicy = {
      rootDirectory,
      extensions: [".js", ".jsx"],
      aliases: [{ name: "views", exact: false, targetAbsolutePath: rootDirectory }],
    };
    const initial = readSourceProject({
      rootDirectory,
      allowJsxInJs: true,
      sourceResolutionPolicy,
    });
    expect(initial?.resolveImport(ownerPath, "views/reader")?.filePath).toBe(
      normalizeFilename(targetPath),
    );
    expect(initial?.index.consumerModulesByFilePath.get(normalizeFilename(targetPath))?.size).toBe(
      1,
    );
    const writerPath = path.join(rootDirectory, "writer.js");
    fs.writeFileSync(writerPath, "export { default } from 'views/reader';");
    const next = readSourceProject({
      rootDirectory,
      allowJsxInJs: true,
      sourceResolutionPolicy,
    });
    expect(next?.index.consumerModulesByFilePath.get(normalizeFilename(targetPath))?.size).toBe(2);
    fs.writeFileSync(path.join(rootDirectory, "reader.jsx"), "export default () => null;");
    expect(
      readSourceProject({ rootDirectory, allowJsxInJs: true, sourceResolutionPolicy }),
    ).toBeNull();
  });

  it("declines source policies for another package root", () => {
    const rootDirectory = createProjectDirectory();
    fs.writeFileSync(path.join(rootDirectory, "reader.js"), "export default () => null;");
    expect(
      readSourceProject({
        rootDirectory,
        allowJsxInJs: true,
        sourceResolutionPolicy: {
          rootDirectory: path.dirname(rootDirectory),
          extensions: [".js"],
          aliases: [],
        },
      }),
    ).toBeNull();
  });

  it("keeps disjoint public exports separate from fresh local import ambiguity", () => {
    const rootDirectory = createProjectDirectory();
    const readerPath = path.join(rootDirectory, "reader.js");
    const ownerPath = path.join(rootDirectory, "owner.js");
    const manifestPath = path.join(rootDirectory, "package.json");
    fs.writeFileSync(readerPath, "export default () => null;");
    fs.writeFileSync(ownerPath, "import Reader from './reader.js'; export default Reader;");
    fs.writeFileSync(path.join(rootDirectory, "unrelated.js"), "export const unrelated = true;");
    fs.writeFileSync(manifestPath, "{}");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).not.toBeNull();
    fs.writeFileSync(manifestPath, JSON.stringify({ exports: { ".": "./unrelated.js" } }));
    const project = readSourceProject({ rootDirectory, allowJsxInJs: true });
    expect(project?.resolveImport(ownerPath, "./reader.js")?.filePath).toBe(
      normalizeFilename(readerPath),
    );
    fs.writeFileSync(path.join(rootDirectory, "reader.jsx"), "export default () => null;");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).not.toBeNull();
    fs.writeFileSync(ownerPath, "import Reader from './reader'; export default Reader;");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
  });

  it.each(["browser", "imports", "concord"])(
    "retains fresh nested manifest uncertainty for %s mappings",
    (fieldName) => {
      const rootDirectory = createProjectDirectory();
      const sourceDirectory = path.join(rootDirectory, "src");
      fs.mkdirSync(sourceDirectory);
      fs.writeFileSync(path.join(sourceDirectory, "reader.js"), "export default () => null;");
      fs.writeFileSync(
        path.join(rootDirectory, "owner.js"),
        "import Reader from './src/reader.js'; export default Reader;",
      );
      expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).not.toBeNull();
      fs.writeFileSync(
        path.join(sourceDirectory, "package.json"),
        JSON.stringify({ [fieldName]: {} }),
      );
      expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
    },
  );

  it("preserves the authoritative current engine program and its binding identities", () => {
    const rootDirectory = createProjectDirectory();
    const currentFilePath = path.join(rootDirectory, "leaf.js");
    const sourceText = "export const value = 1;";
    fs.writeFileSync(currentFilePath, sourceText);
    const currentProgramNode = parseSourceText({ filename: currentFilePath, sourceText });
    if (!currentProgramNode) throw new Error("Expected a parsed engine program");
    const currentScopes = analyzeScopes(currentProgramNode);
    const project = readSourceProject({
      rootDirectory,
      allowJsxInJs: false,
      currentFilePath,
      currentProgramNode,
      currentScopes,
    });
    expect(project?.modules.get(normalizeFilename(currentFilePath))?.program).toBe(
      currentProgramNode,
    );
    expect(project?.modules.get(normalizeFilename(currentFilePath))?.scopes).toBe(currentScopes);
  });
  it("selects JSX for JavaScript only when the caller proved its transform role", () => {
    const rootDirectory = createProjectDirectory();
    const sourceText = "export const Panel = () => <div>Ready</div>;";
    const filename = path.join(rootDirectory, "panel.js");
    fs.writeFileSync(filename, sourceText);
    expect(parseSourceText({ filename, sourceText })).toBeNull();
    expect(parseSourceText({ filename, sourceText, language: "jsx" })).not.toBeNull();
    expect(readSourceProject({ rootDirectory, allowJsxInJs: false })).toBeNull();
    const project = readSourceProject({ rootDirectory, allowJsxInJs: true });
    expect(project?.modules.get(normalizeFilename(filename))?.scopes.rootScope.node.type).toBe(
      "Program",
    );
    expect(project?.modules.get(normalizeFilename(filename))?.sourceText).toBe(sourceText);
  });

  it("reads new incoming importers and changed module contents on every call", () => {
    const rootDirectory = createProjectDirectory();
    const targetPath = path.join(rootDirectory, "target.js");
    fs.writeFileSync(targetPath, "export const state = 1;");
    const initialProject = readSourceProject({ rootDirectory, allowJsxInJs: false });
    const originalStat = fs.statSync(targetPath);
    fs.writeFileSync(targetPath, "export const state = 2;");
    fs.utimesSync(targetPath, originalStat.atime, originalStat.mtime);
    const importerPath = path.join(rootDirectory, "writer.js");
    fs.writeFileSync(importerPath, 'import { state } from "./target"; mutate(state);');
    const nextProject = readSourceProject({ rootDirectory, allowJsxInJs: false });
    expect(initialProject?.modules.size).toBe(1);
    expect(nextProject?.modules.size).toBe(2);
    expect(nextProject?.modules.get(normalizeFilename(targetPath))?.sourceText).toContain(
      "state = 2",
    );
    expect(nextProject?.resolveImport(importerPath, "./target")?.filePath).toBe(
      normalizeFilename(targetPath),
    );
  });

  it("resolves unique local extension and index modules and declines ambiguous alternatives", () => {
    const rootDirectory = createProjectDirectory();
    const importerPath = path.join(rootDirectory, "owner.js");
    fs.writeFileSync(importerPath, "export const owner = true;");
    fs.mkdirSync(path.join(rootDirectory, "view"));
    const targetPath = path.join(rootDirectory, "view", "index.jsx");
    fs.writeFileSync(targetPath, "export default () => <div />;");
    fs.writeFileSync(path.join(rootDirectory, "source.ts"), "export const value = 1;");
    fs.writeFileSync(path.join(rootDirectory, "source.js"), "export const value = 2;");
    const project = readSourceProject({ rootDirectory, allowJsxInJs: false });
    expect(project?.resolveImport(importerPath, "./view")?.filePath).toBe(
      normalizeFilename(targetPath),
    );
    expect(project?.resolveImport(importerPath, "./source")).toBeNull();
    expect(project?.resolveImport(importerPath, "react")).toBeNull();
    expect(project?.resolveImport(importerPath, "./source.js")?.filePath).toBe(
      normalizeFilename(path.join(rootDirectory, "source.js")),
    );
  });

  it("declines package directory entry selection and malformed source", () => {
    const rootDirectory = createProjectDirectory();
    const importerPath = path.join(rootDirectory, "owner.js");
    fs.writeFileSync(importerPath, "export const owner = true;");
    fs.mkdirSync(path.join(rootDirectory, "view"));
    fs.writeFileSync(path.join(rootDirectory, "view", "index.js"), "export const value = 1;");
    fs.writeFileSync(path.join(rootDirectory, "view", "package.json"), '{"main":"other.js"}');
    expect(
      readSourceProject({ rootDirectory, allowJsxInJs: false })?.resolveImport(
        importerPath,
        "./view",
      ),
    ).toBeNull();
    fs.writeFileSync(path.join(rootDirectory, "broken.js"), "export const =;");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
  });

  it("declines newly added configured web candidates and retains explicit JavaScript resolution", () => {
    const rootDirectory = createProjectDirectory();
    const importerPath = path.join(rootDirectory, "owner.js");
    const targetPath = path.join(rootDirectory, "leaf.js");
    const webTargetPath = path.join(rootDirectory, "leaf.web.js");
    fs.writeFileSync(importerPath, 'import Leaf from "./leaf";');
    fs.writeFileSync(targetPath, "export default () => null;");
    expect(
      readSourceProject({ rootDirectory, allowJsxInJs: true })?.resolveImport(
        importerPath,
        "./leaf",
      )?.filePath,
    ).toBe(normalizeFilename(targetPath));
    fs.writeFileSync(webTargetPath, "export default () => null;");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
    fs.writeFileSync(importerPath, 'import Leaf from "./leaf.js";');
    const project = readSourceProject({ rootDirectory, allowJsxInJs: true });
    expect(project?.resolveImport(importerPath, "./leaf")).toBeNull();
    expect(project?.resolveImport(importerPath, "./leaf.js")?.filePath).toBe(
      normalizeFilename(targetPath),
    );
    expect(project?.resolveImport(importerPath, "./leaf.web.js")?.filePath).toBe(
      normalizeFilename(webTargetPath),
    );
  });

  it("resolves a sole configured web index and declines JSON or configured TypeScript competitors", () => {
    const rootDirectory = createProjectDirectory();
    const importerPath = path.join(rootDirectory, "owner.js");
    fs.writeFileSync(importerPath, 'import Leaf from "./leaf";');
    fs.mkdirSync(path.join(rootDirectory, "leaf"));
    const webIndexPath = path.join(rootDirectory, "leaf", "index.web.jsx");
    fs.writeFileSync(webIndexPath, "export default () => <div />;");
    expect(
      readSourceProject({ rootDirectory, allowJsxInJs: true })?.resolveImport(
        importerPath,
        "./leaf",
      )?.filePath,
    ).toBe(normalizeFilename(webIndexPath));
    fs.writeFileSync(path.join(rootDirectory, "leaf", "index.json"), "{}");
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
    fs.unlinkSync(path.join(rootDirectory, "leaf", "index.json"));
    fs.writeFileSync(
      path.join(rootDirectory, "leaf", "index.web.tsx"),
      "export default () => null;",
    );
    expect(readSourceProject({ rootDirectory, allowJsxInJs: true })).toBeNull();
  });

  it("declines exact JSON files and extensionless JSON that precedes JSX", () => {
    const rootDirectory = createProjectDirectory();
    const importerPath = path.join(rootDirectory, "owner.js");
    fs.writeFileSync(importerPath, "export const owner = true;");
    fs.writeFileSync(path.join(rootDirectory, "leaf.jsx"), "export default () => <div />;");
    fs.writeFileSync(path.join(rootDirectory, "leaf.json"), "{}");
    const project = readSourceProject({ rootDirectory, allowJsxInJs: true });
    expect(project?.resolveImport(importerPath, "./leaf")).toBeNull();
    expect(project?.resolveImport(importerPath, "./leaf.json")).toBeNull();
  });

  it("declines links and exhausted file bounds", () => {
    const rootDirectory = createProjectDirectory();
    const targetPath = path.join(rootDirectory, "target.js");
    fs.writeFileSync(targetPath, "export const value = 1;");
    const linkPath = path.join(rootDirectory, "link.js");
    fs.symlinkSync(targetPath, linkPath);
    expect(readSourceProject({ rootDirectory, allowJsxInJs: false })).toBeNull();
    fs.unlinkSync(linkPath);
    for (let fileIndex = 0; fileIndex < CLOSED_JSON_SNAPSHOT_PROJECT_MAX_FILES; fileIndex += 1) {
      fs.writeFileSync(path.join(rootDirectory, `file-${fileIndex}.js`), "");
    }
    expect(readSourceProject({ rootDirectory, allowJsxInJs: false })).toBeNull();
  });
});
