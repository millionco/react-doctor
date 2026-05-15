import { beforeAll, describe } from "vite-plus/test";
import type { Diagnostic } from "../../src/types/diagnostic.js";
import { runOxlint } from "../../src/core/run-oxlint.js";
import { buildTestProject } from "../regressions/_helpers.js";
import { BASIC_REACT_DIRECTORY, describeRules } from "./_helpers.js";

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
    "architecture rules",
    {
      "no-giant-component": {
        fixture: "giant-component.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-render-in-render": {
        fixture: "architecture-issues.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-nested-component-definition": {
        fixture: "architecture-issues.tsx",
        ruleSource: "rules/architecture.ts",
        severity: "error",
      },
      "no-many-boolean-props": {
        fixture: "new-rules.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-react19-deprecated-apis": {
        fixture: "legacy-react.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
      "no-render-prop-children": {
        fixture: "composition-issues.tsx",
        ruleSource: "rules/architecture.ts",
        category: "Architecture",
      },
    },
    () => basicReactDiagnostics,
  );
});
