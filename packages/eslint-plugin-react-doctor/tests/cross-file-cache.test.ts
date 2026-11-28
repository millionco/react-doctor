import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import eslintPlugin from "../src/index.js";

describe("ESLint cross-file dependency cache", () => {
  it("uses the current alias when inherited or nearer config changes", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "eslint-alias-"));
    const ruleId = "no-unguarded-browser-global-in-render-or-hook-init";
    const rule: Parameters<typeof runRule>[0] = {
      id: ruleId,
      severity: "warn",
      create: eslintPlugin.rules[ruleId].create,
    };
    const source = `
      import { useReady } from "@/readiness";
      export function Widget() {
        const ready = useReady();
        if (!ready) return null;
        return document.title;
      }
    `;
    const directory = path.join(workspace, "src");
    const check = () => {
      const result = runRule(rule, source, { filename: path.join(directory, "Widget.js") });
      expect(result.parseErrors).toEqual([]);
      return result.diagnostics.length;
    };
    const mapAlias = (target: string, baseUrl = ".") =>
      JSON.stringify({ compilerOptions: { baseUrl, paths: { "@/readiness": [target] } } });
    const writeFixture = (name: string, sourceText: string) =>
      fs.writeFileSync(path.join(workspace, name), sourceText);

    try {
      fs.mkdirSync(directory);
      for (const [name, serverValue] of [
        ["on-server", true],
        ["on-client", false],
      ]) {
        writeFixture(
          `${name}.js`,
          `import { useSyncExternalStore } from "react";
          const subscribe = () => () => {};
          export const useReady = () => useSyncExternalStore(subscribe, () => true, () => ${serverValue});`,
        );
      }
      writeFixture("tsconfig.json", JSON.stringify({ extends: "./tsconfig.base.json" }));
      writeFixture("tsconfig.base.json", mapAlias("./on-server.js"));
      expect(check()).toBe(1);

      writeFixture("tsconfig.base.json", mapAlias("./on-client.js"));
      expect(check()).toBe(0);

      writeFixture("src/tsconfig.json", mapAlias("./on-server.js", ".."));
      expect(check()).toBe(1);

      fs.unlinkSync(path.join(directory, "tsconfig.json"));
      expect(check()).toBe(0);

      writeFixture("tsconfig.base.json", mapAlias("./on-server.js"));
      expect(check()).toBe(1);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
