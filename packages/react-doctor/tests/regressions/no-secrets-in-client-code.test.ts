import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { ProjectInfo } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-secrets-"));
const RULE_ID = "no-secrets-in-client-code";

interface SecretIssueOptions {
  framework?: ProjectInfo["framework"];
}

const getSecretIssues = async (projectDir: string, options: SecretIssueOptions = {}) => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDir,
    project: buildTestProject({
      rootDirectory: projectDir,
      framework: options.framework,
    }),
  });

  return diagnostics.filter((diagnostic) => diagnostic.rule === RULE_ID);
};

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("no-secrets-in-client-code", () => {
  it("uses Vite env guidance for Vite projects", async () => {
    const projectDir = setupReactProject(tempRoot, "vite-secret-help", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "src/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "vite" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].help).toContain("Vite");
    expect(secretIssues[0].help).toContain("VITE_*");
    expect(secretIssues[0].help).not.toContain("NEXT_PUBLIC");
  });

  it("does not run the weak variable-name heuristic in Vite config files", async () => {
    const projectDir = setupReactProject(tempRoot, "vite-config-secret-false-positive", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "vite.config.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export default {};
`,
      },
    });

    await expect(getSecretIssues(projectDir, { framework: "vite" })).resolves.toEqual([]);
  });

  it("does not run the weak variable-name heuristic in server-only directories", async () => {
    const projectDir = setupReactProject(tempRoot, "server-secret-false-positive", {
      files: {
        "src/server/auth.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("classifies files relative to the project root, not parent folder names", async () => {
    const serverParentProjectDir = setupReactProject(
      path.join(tempRoot, "server"),
      "client-entry",
      {
        packageJsonExtras: {
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
        },
        files: {
          "App.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const App = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
        },
      },
    );
    const appParentProjectDir = setupReactProject(path.join(tempRoot, "app"), "ambiguous-source", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "token.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    const secretIssues = await getSecretIssues(serverParentProjectDir, { framework: "vite" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("App.tsx");
    await expect(getSecretIssues(appParentProjectDir, { framework: "vite" })).resolves.toEqual([]);
  });

  it("does not run the weak variable-name heuristic in server-owned package source roots", async () => {
    const projectDir = setupReactProject(tempRoot, "server-package-secret-false-positive", {
      files: {
        "packages/server/src/index.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
        "apps/backend/src/components/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
        "apps/api/src/index.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
        "packages/worker/src/components/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("runs the weak variable-name heuristic for explicit client files in server-named directories", async () => {
    const projectDir = setupReactProject(tempRoot, "explicit-client-in-server-directory", {
      files: {
        "src/server/token.client.tsx": `const PUBLIC_CLIENT_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_CLIENT_TOKEN_FALLBACK;
`,
        "src/server/token-display.tsx": `"use client";

const PUBLIC_DISPLAY_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_DISPLAY_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(2);
    expect(secretIssues.map((secretIssue) => secretIssue.filePath)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/server/token.client.tsx"),
        expect.stringContaining("src/server/token-display.tsx"),
      ]),
    );
  });

  it("does not run the weak variable-name heuristic in server-suffixed files", async () => {
    const projectDir = setupReactProject(tempRoot, "server-suffix-secret-false-positive", {
      files: {
        "src/components/token-display.server.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("does not run the weak variable-name heuristic in test-only directories", async () => {
    const projectDir = setupReactProject(tempRoot, "test-secret-false-positive", {
      files: {
        "src/__tests__/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("runs the weak variable-name heuristic in client entry files", async () => {
    const projectDir = setupReactProject(tempRoot, "client-entry-secret", {
      files: {
        "src/main.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/main.ts");
  });

  it("runs the weak variable-name heuristic in root App entry files", async () => {
    const projectDir = setupReactProject(tempRoot, "root-app-entry-secret", {
      files: {
        "App.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const App = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("App.tsx");
  });

  it("still runs the weak variable-name heuristic in client-bundled api helpers", async () => {
    const projectDir = setupReactProject(tempRoot, "client-api-helper-secret", {
      files: {
        "src/api/client.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/api/client.ts");
  });

  it("runs the weak variable-name heuristic in client-suffixed files", async () => {
    const projectDir = setupReactProject(tempRoot, "client-suffix-secret", {
      files: {
        "src/app/token.client.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/app/token.client.ts");
  });

  it("runs the weak variable-name heuristic in Vite app-directory client code", async () => {
    const projectDir = setupReactProject(tempRoot, "vite-app-directory-secret", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "src/app/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "vite" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/app/token-display.tsx");
  });

  it("runs the weak variable-name heuristic in Vite files that look like Next server routes", async () => {
    const projectDir = setupReactProject(tempRoot, "vite-route-name-secret", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "src/routes/route.tsx": `const PUBLIC_ROUTE_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const Route = () => <div>{PUBLIC_ROUTE_TOKEN_FALLBACK}</div>;
`,
        "src/pages/api/token.ts": `const PUBLIC_API_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_API_TOKEN_FALLBACK;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "vite" });
    expect(secretIssues).toHaveLength(2);
    expect(secretIssues.map((secretIssue) => secretIssue.filePath)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src/routes/route.tsx"),
        expect.stringContaining("src/pages/api/token.ts"),
      ]),
    );
  });

  it("runs the weak variable-name heuristic in Expo app-directory screens", async () => {
    const projectDir = setupReactProject(tempRoot, "expo-app-directory-secret", {
      packageJsonExtras: {
        dependencies: { expo: "^54.0.0", react: "^19.0.0", "react-native": "^0.81.0" },
      },
      files: {
        "app/profile.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const Profile = () => <Text>{PUBLIC_BEARER_TOKEN_FALLBACK}</Text>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "expo" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("app/profile.tsx");
  });

  it("does not run the weak variable-name heuristic in ambiguous TypeScript source files", async () => {
    const projectDir = setupReactProject(tempRoot, "ambiguous-source-secret-false-positive", {
      files: {
        "src/token.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const token = PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("still reports literal values that match known secret shapes in ambiguous TypeScript source files", async () => {
    const projectDir = setupReactProject(tempRoot, "ambiguous-source-real-secret-shape", {
      files: {
        "src/token.ts": `const stripeSecret = "sk\\u005ftest_fixture_token_1234567890abcdef";

export const token = stripeSecret;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("hardcoded secret is a security vulnerability");
  });

  it("still reports camel-case api key variables through the weak variable-name heuristic", async () => {
    const projectDir = setupReactProject(tempRoot, "client-api-key-secret", {
      files: {
        "src/token-display.tsx": `const apiKey = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{apiKey}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("apiKey");
  });

  it("does not report UI-suffixed client constants through the weak variable-name heuristic", async () => {
    const projectDir = setupReactProject(tempRoot, "client-ui-suffix-secret-false-positive", {
      files: {
        "src/token-display.tsx": `const SECRET_LABEL = "fixture_token_1234567890abcdef";
const hiddenSecretText = "Values of secret constants are hidden";

export const TokenDisplay = () => <div>{SECRET_LABEL}{hiddenSecretText}</div>;
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("does not report client storage key prefixes through the weak variable-name heuristic", async () => {
    const projectDir = setupReactProject(tempRoot, "client-storage-prefix-secret-false-positive", {
      files: {
        "src/desktop-auth-token.tsx": `const DESKTOP_AUTH_PREFIX = "desktop_auth_client_token";

export const token = sessionStorage.getItem(DESKTOP_AUTH_PREFIX);
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("runs the weak variable-name heuristic in use-client App Router files", async () => {
    const projectDir = setupReactProject(tempRoot, "next-use-client-secret", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/app/token-display.tsx": `"use client";

const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "nextjs" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/app/token-display.tsx");
  });

  it("does not run the weak variable-name heuristic in App Router server components", async () => {
    const projectDir = setupReactProject(tempRoot, "next-server-component-secret-false-positive", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/app/token-display.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    await expect(getSecretIssues(projectDir, { framework: "nextjs" })).resolves.toEqual([]);
  });

  it("does not run the weak variable-name heuristic inside inline use-server functions", async () => {
    const projectDir = setupReactProject(tempRoot, "inline-use-server-secret-false-positive", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/components/token-display.tsx": `const PUBLIC_CLIENT_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export async function saveToken() {
  "use server";
  const PUBLIC_SERVER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";
  return PUBLIC_SERVER_TOKEN_FALLBACK;
}

export const TokenDisplay = () => <div>{PUBLIC_CLIENT_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "nextjs" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("PUBLIC_CLIENT_TOKEN_FALLBACK");
  });

  it("does not run the weak variable-name heuristic in use-server files", async () => {
    const projectDir = setupReactProject(tempRoot, "use-server-secret-false-positive", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/components/actions.ts": `"use server";

const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const getToken = async () => PUBLIC_BEARER_TOKEN_FALLBACK;
`,
      },
    });

    await expect(getSecretIssues(projectDir, { framework: "nextjs" })).resolves.toEqual([]);
  });

  it("does not run the weak variable-name heuristic inside TanStack server function handlers", async () => {
    const projectDir = setupReactProject(tempRoot, "tanstack-server-fn-secret-false-positive", {
      packageJsonExtras: {
        dependencies: {
          "@tanstack/react-start": "^1.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      files: {
        "src/routes/account.tsx": `import { createServerFn } from "@tanstack/react-start";

const PUBLIC_CLIENT_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

const getToken = createServerFn().handler(async () => {
  const PUBLIC_SERVER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";
  return PUBLIC_SERVER_TOKEN_FALLBACK;
});

export const Route = () => <div>{PUBLIC_CLIENT_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "tanstack-start" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("PUBLIC_CLIENT_TOKEN_FALLBACK");
  });

  it("does not run the weak variable-name heuristic in Next.js Pages API routes", async () => {
    const projectDir = setupReactProject(tempRoot, "next-pages-api-secret-false-positive", {
      packageJsonExtras: {
        dependencies: { next: "^15.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
      },
      files: {
        "src/pages/api/token.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export default function handler() {
  return Response.json({ ok: true });
}
`,
      },
    });

    await expect(getSecretIssues(projectDir, { framework: "nextjs" })).resolves.toEqual([]);
  });

  it("still runs the weak variable-name heuristic in regular files whose basename ends in rc", async () => {
    const projectDir = setupReactProject(tempRoot, "src-basename-secret", {
      files: {
        "src/src.tsx": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export const TokenDisplay = () => <div>{PUBLIC_BEARER_TOKEN_FALLBACK}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].filePath).toContain("src/src.tsx");
  });

  it("does not run the weak variable-name heuristic in explicit rc config files", async () => {
    const projectDir = setupReactProject(tempRoot, "rc-config-secret-false-positive", {
      files: {
        ".eslintrc.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export default {};
`,
        "lint.rc.ts": `const PUBLIC_BEARER_TOKEN_FALLBACK = "fixture_token_1234567890abcdef";

export default {};
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("still reports literal values that match known secret shapes in config files", async () => {
    const projectDir = setupReactProject(tempRoot, "config-real-secret-shape", {
      packageJsonExtras: {
        dependencies: { react: "^19.0.0", "react-dom": "^19.0.0", vite: "^7.0.0" },
      },
      files: {
        "vite.config.ts": `const stripeSecret = "sk\\u005ftest_fixture_token_1234567890abcdef";

export default {};
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir, { framework: "vite" });
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("hardcoded secret is a security vulnerability");
  });

  it("does not flag known public client keys that are designed to ship in the browser", async () => {
    const projectDir = setupReactProject(tempRoot, "public-client-keys-allowlisted", {
      files: {
        "src/payments.tsx": `const revenueCatApiKey = "appl_FIXTUREkey1234567890abcdef";
const stripeApiKey = "pk_test_FIXTUREkey1234567890abcdef";
const supabaseApiKey = "sb_publishable_FIXTUREkey1234567890";

export const Payments = () => (
  <div>{revenueCatApiKey}{stripeApiKey}{supabaseApiKey}</div>
);
`,
      },
    });

    await expect(getSecretIssues(projectDir)).resolves.toEqual([]);
  });

  it("still flags a real secret literal even when a public client key sits beside it", async () => {
    const projectDir = setupReactProject(tempRoot, "public-key-with-real-secret", {
      files: {
        "src/payments.tsx": `const revenueCatApiKey = "appl_FIXTUREkey1234567890abcdef";
const stripeKey = "sk\\u005ftest_FIXTUREsecret1234567890";

export const Payments = () => <div>{revenueCatApiKey}{stripeKey}</div>;
`,
      },
    });

    const secretIssues = await getSecretIssues(projectDir);
    expect(secretIssues).toHaveLength(1);
    expect(secretIssues[0].message).toContain("hardcoded secret is a security vulnerability");
  });
});
