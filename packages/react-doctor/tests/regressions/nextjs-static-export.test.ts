/**
 * Regression tests for issue #976: under Next.js `output: "export"` (static
 * export) there is no request-time server, so rules must not recommend
 * server-only fixes (server `redirect()`, middleware, Server Actions).
 *
 *   nextjs-no-client-side-redirect → still fires, but the recommendation drops
 *     the middleware / getServerSideProps clause (Channel C, via core's
 *     `getRuleRecommendation`).
 *   no-prevent-default → the `<form>` finding falls back to the framework-
 *     neutral message instead of "server action" (the project carries no
 *     `server-actions` capability once statically exported).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { discoverProject, runOxlint } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { buildTestProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-nextjs-static-export-"));

const CLIENT_REDIRECT_SOURCE = `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export const Gate = ({ isLoggedIn }: { isLoggedIn: boolean }) => {
  const router = useRouter();
  useEffect(() => {
    if (isLoggedIn) router.replace("/dashboard");
  }, [isLoggedIn, router]);
  return null;
};
`;

const FORM_SOURCE = `"use client";

export const SignUp = () => (
  <form onSubmit={(event) => { event.preventDefault(); }}>
    <button type="submit">Submit</button>
  </form>
);
`;

let projectCounter = 0;
const setupProject = (source: string, filename: string): string => {
  const projectDir = path.join(tempRoot, `project-${projectCounter++}`);
  fs.mkdirSync(path.join(projectDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(projectDir, "src", filename), source, "utf-8");
  return projectDir;
};

const scanRule = async (
  projectDir: string,
  isStaticExport: boolean,
  ruleId: string,
): Promise<Diagnostic | undefined> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({ rootDirectory: projectDir, framework: "nextjs", isStaticExport }),
  });
  return diagnostics.find((diagnostic) => diagnostic.rule === ruleId);
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("Next.js static export (#976)", () => {
  it("softens the client-side-redirect recommendation under output: export", async () => {
    const projectDir = setupProject(CLIENT_REDIRECT_SOURCE, "gate.tsx");

    const staticExport = await scanRule(projectDir, true, "nextjs-no-client-side-redirect");
    expect(staticExport, "rule still fires under static export").toBeDefined();
    // The softened advice names the static-export constraint and recommends a
    // render-time/client fix rather than a server-side redirect.
    expect(staticExport?.help ?? "").toContain("static export");
    expect(staticExport?.help ?? "").not.toContain("server-side redirect");

    const server = await scanRule(projectDir, false, "nextjs-no-client-side-redirect");
    expect(server?.help ?? "").toContain("server-side redirect");
    expect(server?.help ?? "").not.toContain("static export");
  });

  it("gives no-prevent-default the framework-neutral form message under output: export", async () => {
    const projectDir = setupProject(FORM_SOURCE, "sign-up.tsx");

    const staticExport = await scanRule(projectDir, true, "no-prevent-default");
    expect(staticExport, "form finding still fires under static export").toBeDefined();
    expect(staticExport?.message ?? "").not.toContain("server action");

    const server = await scanRule(projectDir, false, "no-prevent-default");
    expect(server?.message ?? "").toContain("server action");
  });

  it("softens the advice end-to-end when the static export lives in a workspace", async () => {
    // No ProjectInfo override: discovery itself must see the workspace-level
    // `output: "export"` on a monorepo-root scan (the Bugbot gap on #976).
    const monorepoRoot = path.join(tempRoot, "workspace-static-export");
    const webDirectory = path.join(monorepoRoot, "apps", "web");
    fs.mkdirSync(path.join(webDirectory, "src"), { recursive: true });
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
      'export default { output: "export" };\n',
    );
    fs.writeFileSync(path.join(webDirectory, "src", "gate.tsx"), CLIENT_REDIRECT_SOURCE, "utf-8");

    const project = discoverProject(monorepoRoot);
    expect(project.isStaticExport).toBe(true);

    const diagnostics = await runOxlint({ rootDirectory: monorepoRoot, project });
    const redirect = diagnostics.find(
      (diagnostic) => diagnostic.rule === "nextjs-no-client-side-redirect",
    );
    expect(redirect, "rule still fires under a workspace static export").toBeDefined();
    expect(redirect?.help ?? "").toContain("static export");
    expect(redirect?.help ?? "").not.toContain("server-side redirect");
  });
});
