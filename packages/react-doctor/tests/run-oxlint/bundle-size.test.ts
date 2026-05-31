import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import type { Diagnostic } from "@react-doctor/core";
import { runOxlint } from "@react-doctor/core";
import { buildTestProject, collectRuleHits, setupReactProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY, describeRules } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-no-barrel-import-"));

let basicReactDiagnostics: Diagnostic[];

describe("runOxlint", () => {
  beforeAll(async () => {
    basicReactDiagnostics = await runOxlint({
      rootDirectory: BASIC_REACT_DIRECTORY,
      project: buildTestProject({
        rootDirectory: BASIC_REACT_DIRECTORY,
        hasTanStackQuery: true,
      }),
    });
  });

  describeRules(
    "bundle size rules",
    {
      "no-full-lodash-import": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
        category: "Performance",
      },
      "no-barrel-import": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "no-moment": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "use-lazy-motion": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "prefer-dynamic-import": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
      "no-undeferred-third-party": {
        fixture: "bundle-issues.tsx",
        ruleSource: "rules/bundle-size.ts",
      },
    },
    () => basicReactDiagnostics,
  );

  describe("no-barrel-import", () => {
    it("does not flag a test importing the sibling index module under test", async () => {
      const projectDir = setupReactProject(tempRoot, "sibling-index-module", {
        files: {
          "src/index.ts": "export const Route = '/users';\n",
          "src/index.e2e.test.ts": "import { Route } from './index';\nvoid Route;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toEqual([]);
    });

    it("flags explicit index and directory imports when the resolved index is a barrel", async () => {
      const projectDir = setupReactProject(tempRoot, "barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/index.ts": "export { Button } from './Button';\n",
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
          "src/import-explicit-index.tsx":
            "import { Button } from './components/index';\nvoid Button;\n",
          "src/import-js-extension.tsx":
            "import { Button } from './components/index.js';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");
      const hitFilePaths = hits.map((hit) => hit.filePath.replaceAll("\\", "/"));

      expect(hits).toHaveLength(3);
      expect(hits[0]?.message).toContain('"./components/Button"');
      expect(hitFilePaths.some((filePath) => filePath.endsWith("src/import-directory.tsx"))).toBe(
        true,
      );
      expect(
        hitFilePaths.some((filePath) => filePath.endsWith("src/import-explicit-index.tsx")),
      ).toBe(true);
      expect(
        hitFilePaths.some((filePath) => filePath.endsWith("src/import-js-extension.tsx")),
      ).toBe(true);
    });

    it("flags aliased default and namespace re-exports with direct source guidance", async () => {
      const projectDir = setupReactProject(tempRoot, "aliased-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export default function Button() { return null; }\n",
          "src/components/Input.tsx": "export const Input = () => null;\n",
          "src/components/parts.ts": "export const Root = () => null;\n",
          "src/components/index.ts":
            "export { default as Button } from './Button';\nexport { Input as TextInput } from './Input';\nexport * as ButtonParts from './parts';\n",
          "src/import-directory.tsx":
            "import { Button, TextInput, ButtonParts } from './components';\nvoid Button;\nvoid TextInput;\nvoid ButtonParts;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/Button"');
      expect(hits[0]?.message).toContain('"./components/Input"');
      expect(hits[0]?.message).toContain('"./components/parts"');
    });

    it("flags single-source star barrels and nested barrels", async () => {
      const projectDir = setupReactProject(tempRoot, "star-and-nested-barrel-index-module", {
        files: {
          "src/components/button/Button.tsx": "export const Button = () => null;\n",
          "src/components/button/index.ts": "export * from './Button';\n",
          "src/components/index.ts": "export * from './button';\n",
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/button/Button"');
    });

    it("resolves direct guidance through multi-source star barrels when names are unambiguous", async () => {
      const projectDir = setupReactProject(tempRoot, "multi-star-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/Input.tsx": "export const Input = () => null;\n",
          "src/components/index.ts": "export * from './Button';\nexport * from './Input';\n",
          "src/import-directory.tsx":
            "import { Button, Input } from './components';\nvoid Button;\nvoid Input;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/Button"');
      expect(hits[0]?.message).toContain('"./components/Input"');
    });

    it("does not guess direct guidance for ambiguous multi-source star barrels", async () => {
      const projectDir = setupReactProject(tempRoot, "ambiguous-star-barrel-index-module", {
        files: {
          "src/components/PrimaryButton.tsx": "export const Button = () => null;\n",
          "src/components/SecondaryButton.tsx": "export const Button = () => null;\n",
          "src/components/index.ts":
            "export * from './PrimaryButton';\nexport * from './SecondaryButton';\n",
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toBe(
        "Importing from an index file pulls in extra code. Import directly from the source file instead.",
      );
    });

    it("flags barrel re-exports with trailing inline comments", async () => {
      const projectDir = setupReactProject(tempRoot, "commented-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/index.ts": "export { Button } from './Button'; // UI component\n",
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.filePath.replaceAll("\\", "/").endsWith("src/import-directory.tsx")).toBe(
        true,
      );
    });

    it("flags import-then-export index barrels", async () => {
      const projectDir = setupReactProject(tempRoot, "import-export-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/icons.ts": "export const Icon = () => null;\n",
          "src/components/index.ts":
            "import { Button } from './Button';\nimport DefaultButton, * as Icons from './icons';\n\nexport { Button, DefaultButton, Icons };\n",
          "src/import-directory.tsx":
            "import { Button, DefaultButton, Icons } from './components';\nvoid Button;\nvoid DefaultButton;\nvoid Icons;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.filePath.replaceAll("\\", "/").endsWith("src/import-directory.tsx")).toBe(
        true,
      );
      expect(hits[0]?.message).toContain('"./components/Button"');
      expect(hits[0]?.message).toContain('"./components/icons"');
    });

    it("does not flag type-only imports from type-only barrels", async () => {
      const projectDir = setupReactProject(tempRoot, "type-only-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export interface ButtonProps { label: string }\n",
          "src/components/index.ts": "export type { ButtonProps } from './Button';\n",
          "src/import-directory.tsx":
            "import type { ButtonProps } from './components';\nconst props: ButtonProps = { label: 'Save' };\nvoid props;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toEqual([]);
    });

    it("does not flag mixed index modules with side effects or runtime work", async () => {
      const projectDir = setupReactProject(tempRoot, "mixed-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/styles.css": ".button {}\n",
          "src/components/with-side-effect/index.ts":
            "import '../styles.css';\nexport { Button } from '../Button';\n",
          "src/components/with-runtime-work/index.ts":
            "console.log('init');\nexport { Button } from '../Button';\n",
          "src/import-side-effect.tsx":
            "import { Button } from './components/with-side-effect';\nvoid Button;\n",
          "src/import-runtime-work.tsx":
            "import { Button } from './components/with-runtime-work';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toEqual([]);
    });

    it("resolves package directory entries before index fallback", async () => {
      const projectDir = setupReactProject(tempRoot, "package-entry-barrel-index-module", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/index.ts": "export { Button } from './Button';\n",
          "src/components/package.json": JSON.stringify({ exports: "./index.ts" }),
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/Button"');
    });

    it("resolves package export condition objects and directory entries", async () => {
      const projectDir = setupReactProject(tempRoot, "package-conditional-entry-barrel", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/entry/index.ts": "export { Button } from '../Button';\n",
          "src/components/package.json": JSON.stringify({
            exports: {
              import: {
                default: "./entry",
              },
            },
          }),
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/Button"');
    });

    it("resolves package export array fallbacks", async () => {
      const projectDir = setupReactProject(tempRoot, "package-export-array-barrel", {
        files: {
          "src/components/Button.tsx": "export const Button = () => null;\n",
          "src/components/entry/index.ts": "export { Button } from '../Button';\n",
          "src/components/package.json": JSON.stringify({
            exports: [
              {
                import: "./entry",
              },
            ],
          }),
          "src/import-directory.tsx": "import { Button } from './components';\nvoid Button;\n",
        },
      });

      const hits = await collectRuleHits(projectDir, "no-barrel-import");

      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).toContain('"./components/Button"');
    });
  });
});
