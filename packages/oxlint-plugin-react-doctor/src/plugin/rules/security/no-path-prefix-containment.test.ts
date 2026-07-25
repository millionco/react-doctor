import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPathPrefixContainment } from "./no-path-prefix-containment.js";

const runPathPrefixRule = (code: string) =>
  runRule(noPathPrefixContainment, code, { filename: "src/files.ts" });

describe("security/no-path-prefix-containment", () => {
  it("flags namespace path.resolve results checked with the bare root prefix", () => {
    const result = runPathPrefixRule(`
      import * as path from "node:path";

      export const readProjectFile = (rootDirectory, requestedPath) => {
        const candidatePath = path.resolve(rootDirectory, requestedPath);
        if (!candidatePath.startsWith(rootDirectory)) throw new Error("Outside project");
        return candidatePath;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags named resolve imports and direct call receivers", () => {
    const result = runPathPrefixRule(`
      import { resolve as resolvePath } from "path";

      export const isInside = (rootDirectory, requestedPath) =>
        resolvePath(rootDirectory, requestedPath).startsWith(rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags stable aliases of the candidate and root", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const rootDirectory = process.cwd();
      const containmentRoot = rootDirectory;
      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const resolvedCandidatePath = candidatePath;
      const isInside = resolvedCandidatePath.startsWith(containmentRoot);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags unchanged mutable root bindings", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      let firstRootDirectory;
      firstRootDirectory = process.cwd();
      const firstCandidatePath = path.resolve(firstRootDirectory, requestedPath);
      const firstIsInside = firstCandidatePath.startsWith(firstRootDirectory);

      var secondRootDirectory;
      secondRootDirectory = process.cwd();
      const secondCandidatePath = path.resolve(secondRootDirectory, requestedPath);
      const secondIsInside = secondCandidatePath.startsWith(secondRootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows path.relative containment checks", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const relativePath = path.relative(rootDirectory, candidatePath);
      const isInside =
        relativePath === "" ||
        (!relativePath.startsWith(\`..\${path.sep}\`) &&
          relativePath !== ".." &&
          !path.isAbsolute(relativePath));
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows separator-aware prefix checks", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const isInside =
        candidatePath === rootDirectory ||
        candidatePath.startsWith(rootDirectory + path.sep);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows separator-aware roots passed through stable aliases", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const containmentPrefix = rootDirectory + path.sep;
      const candidatePath = path.resolve(containmentPrefix, requestedPath);
      const isInside = candidatePath.startsWith(containmentPrefix);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags bare prefixes when resolve receives a separator-suffixed root", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve(rootDirectory + path.sep, requestedPath);
      const isInside = candidatePath.startsWith(rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags template and literal separator-suffixed resolve roots", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const templateCandidate = path.resolve(\`\${rootDirectory}/\`, requestedPath);
      const templateIsInside = templateCandidate.startsWith(rootDirectory);
      const separatorCandidate = path.resolve(\`\${rootDirectory}\${path.sep}\`, requestedPath);
      const separatorIsInside = separatorCandidate.startsWith(rootDirectory);
      const literalCandidate = path.resolve("/srv/uploads/", requestedPath);
      const literalIsInside = literalCandidate.startsWith("/srv/uploads");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows static root paths that end at a separator boundary", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve("/srv/uploads/", requestedPath);
      const isInside = candidatePath.startsWith("/srv/uploads/");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores startsWith checks that use a non-default offset", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const hasNestedPrefix = candidatePath.startsWith(rootDirectory, rootDirectory.length);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows ordinary string and URL prefix checks", () => {
    const result = runPathPrefixRule(`
      const hasApiPrefix = pathname.startsWith("/api/");
      const isSecure = url.startsWith("https://");
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores shadowed path objects", () => {
    const result = runPathPrefixRule(`
      const path = {
        resolve: (rootDirectory, requestedPath) => rootDirectory + requestedPath,
      };
      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const isInside = candidatePath.startsWith(rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores reassigned candidate aliases", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      let candidatePath = path.resolve(rootDirectory, requestedPath);
      candidatePath = normalize(candidatePath);
      const isInside = candidatePath.startsWith(rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores roots reassigned after candidate resolution", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      let rootDirectory = process.cwd();
      const candidatePath = path.resolve(rootDirectory, requestedPath);
      rootDirectory = otherRootDirectory;
      const isInside = candidatePath.startsWith(rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a different comparison root", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const isInside = candidatePath.startsWith(otherRootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores dynamic startsWith property access", () => {
    const result = runPathPrefixRule(`
      import path from "node:path";

      const candidatePath = path.resolve(rootDirectory, requestedPath);
      const methodName = "startsWith";
      const isInside = candidatePath[methodName](rootDirectory);
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
