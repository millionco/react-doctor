import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { ChangedFileLineRanges } from "../../src/types/index.js";
import { DeadCode } from "../../src/services/dead-code.js";
import { Maintainability } from "../../src/services/maintainability.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const componentSource = (componentName: string, valueName: string): string => `
export const ${componentName} = () => (
  <${componentName}Screen>
    <Page>
      <section>
        <header><Title /></header>
        <main><Value value={${valueName}} /></main>
        <footer><Button /></footer>
      </section>
    </Page>
  </${componentName}Screen>
);
`;

const createProject = (): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-maintainability-"));
  temporaryDirectories.push(rootDirectory);
  fs.mkdirSync(path.join(rootDirectory, "src"));
  fs.writeFileSync(
    path.join(rootDirectory, "src", "account.tsx"),
    componentSource("Account", "account"),
  );
  fs.writeFileSync(path.join(rootDirectory, "src", "user.tsx"), componentSource("User", "user"));
  fs.writeFileSync(
    path.join(rootDirectory, "src", "ignored.test.tsx"),
    componentSource("Ignored", "ignored"),
  );
  return rootDirectory;
};

const createSingleFileProject = (): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-maintainability-"));
  temporaryDirectories.push(rootDirectory);
  fs.mkdirSync(path.join(rootDirectory, "src"));
  fs.writeFileSync(
    path.join(rootDirectory, "src", "cards.tsx"),
    [componentSource("Account", "account"), componentSource("User", "user")].join("\n"),
  );
  return rootDirectory;
};

const runService = (
  rootDirectory: string,
  focusPaths?: ReadonlyArray<string>,
  changedLineRanges?: ReadonlyArray<ChangedFileLineRanges>,
  ignorePatterns?: ReadonlyArray<string>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const maintainability = yield* Maintainability;
      return yield* Stream.runCollect(
        maintainability.run({ rootDirectory, focusPaths, changedLineRanges, ignorePatterns }),
      );
    }).pipe(Effect.provide(Maintainability.layerNode)),
  );

describe("Maintainability.layerNode", () => {
  it("reports maximal cross-file JSX families with related composition paths", async () => {
    const diagnostics = Array.from(await runService(createProject()));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: "src/account.tsx",
      plugin: "react-doctor",
      rule: "duplicate-jsx-subtree",
      category: "Maintainability",
      relatedLocations: [
        {
          filePath: "src/user.tsx",
          message: expect.stringContaining("User > UserScreen > Page"),
        },
      ],
    });
    expect(diagnostics[0].message).toContain("Composition path: Account > AccountScreen > Page");
    expect(diagnostics[0].message).toContain("2 copies");
  });

  it("analyzes the whole corpus but focuses the primary location on a changed file", async () => {
    const diagnostics = Array.from(await runService(createProject(), ["src/user.tsx"]));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("src/user.tsx");
    expect(diagnostics[0].relatedLocations?.[0].filePath).toBe("src/account.tsx");
  });

  it("reports substantial duplication across components in one production file", async () => {
    const diagnostics = Array.from(await runService(createSingleFileProject()));

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].filePath).toBe("src/cards.tsx");
    expect(diagnostics[0].message).toContain("Composition path: Account > AccountScreen > Page");
    expect(diagnostics[0].relatedLocations?.[0]).toMatchObject({
      filePath: "src/cards.tsx",
      message: expect.stringContaining("User > UserScreen > Page"),
    });
  });

  it("excludes ignored files from the duplicate JSX corpus", async () => {
    const rootDirectory = createProject();
    const diagnostics = Array.from(
      await runService(rootDirectory, undefined, undefined, ["src/user.tsx"]),
    );

    expect(diagnostics).toEqual([]);
  });

  it("promotes a changed-line occurrence and suppresses unchanged matches", async () => {
    const rootDirectory = createSingleFileProject();
    const changedUser = Array.from(
      await runService(
        rootDirectory,
        ["src/cards.tsx"],
        [{ file: "src/cards.tsx", ranges: [[14, 24]] }],
      ),
    );
    const unchangedOnly = Array.from(
      await runService(
        rootDirectory,
        ["src/cards.tsx"],
        [{ file: "src/cards.tsx", ranges: [[1, 1]] }],
      ),
    );

    expect(changedUser).toHaveLength(1);
    expect(changedUser[0].message).toContain("Composition path: User > UserScreen > Page");
    expect(unchangedOnly).toEqual([]);
  });
});

describe("DeadCode compatibility alias", () => {
  it("resolves to the maintainability service", () => {
    expect(DeadCode).toBe(Maintainability);
  });
});
