import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as Schema from "effect/Schema";
import { JsonReport } from "@react-doctor/core/schemas";
import { describe, expect, it } from "vite-plus/test";
import { createScopedTempRoot, setupReactProject } from "./_helpers.js";

const temporaryRoot = createScopedTempRoot("stable-class-matchers");
const builtCliPath = path.resolve(import.meta.dirname, "../../../bin/react-doctor.js");
const ruleId = "class-component-missing-component-will-unmount-teardown";

describe("built CLI stable class matcher cleanup", () => {
  it.each([
    {
      name: "releases every matcher listener",
      caseId: "stable-class-matchers-cleaned",
      unmountRelease:
        "Object.values(this.state.matchers).forEach((matcher) => matcher.removeListener(onChange));",
      expectedDiagnosticCount: 0,
    },
    {
      name: "reports a missing matcher listener release",
      caseId: "stable-class-matchers-leaked",
      unmountRelease: "",
      expectedDiagnosticCount: 1,
    },
  ])("$name", ({ caseId, unmountRelease, expectedDiagnosticCount }) => {
    const projectDirectory = setupReactProject(temporaryRoot, caseId, {
      reactVersion: "18.3.1",
      packageJsonExtras: { private: true },
      files: {
        "src/ResponsivePanel.tsx": `import React from "react";

class MatcherComponent extends React.Component {
  constructor(props) {
    super(props);
    this.state = { matchers: this.createMatchers(props.queries) };
  }

  createMatchers = (queries) =>
    Object.keys(queries).reduce(
      (record, key) => ({ ...record, [key]: window.matchMedia(queries[key]) }),
      {},
    );

  onChange = () => {
    this.setState({ changed: true });
  };

  componentDidMount() {
    if (this.state.matchers) {
      const { onChange } = this;
      Object.values(this.state.matchers).forEach((matcher) => matcher.addListener(onChange));
    }
  }

  componentWillUnmount() {
    if (this.state.matchers) {
      const { onChange } = this;
      ${unmountRelease}
    }
  }

  render() {
    return null;
  }
}

export { MatcherComponent };
`,
        "doctor.config.json": JSON.stringify({
          customRulesOnly: false,
          rules: { [`react-doctor/${ruleId}`]: "error" },
        }),
      },
    });
    const result = spawnSync(
      process.execPath,
      [
        builtCliPath,
        projectDirectory,
        "--json",
        "--no-score",
        "--no-telemetry",
        "--no-supply-chain",
        "--no-dead-code",
        "--no-cache",
        "--yes",
        "--blocking",
        "error",
      ],
      {
        cwd: projectDirectory,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "1",
          REACT_DOCTOR_NO_TELEMETRY: "1",
          REACT_DOCTOR_NO_UPDATE_NOTIFIER: "1",
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stdout, result.stderr).not.toBe("");
    const report = Schema.decodeUnknownSync(JsonReport)(JSON.parse(result.stdout));
    expect(report.ok).toBe(true);
    expect(report.schemaVersion).toBe(3);
    expect(
      report.diagnostics.filter(
        (diagnostic) => diagnostic.plugin === "react-doctor" && diagnostic.rule === ruleId,
      ),
    ).toHaveLength(expectedDiagnosticCount);
    expect(report.summary.errorCount).toBe(expectedDiagnosticCount);
    expect(report.summary.totalDiagnosticCount).toBe(report.diagnostics.length);
    expect(result.status, result.stderr).toBe(expectedDiagnosticCount);
  });
});
