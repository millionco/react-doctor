import { describe, expect, it } from "vite-plus/test";
import { buildDiagnosticIssueUrl } from "../src/cli/utils/build-diagnostic-issue-url.js";
import type { Diagnostic } from "@react-doctor/core";

const diagnostic: Diagnostic = {
  category: "State & Effects",
  filePath: "/repo/src/App.tsx",
  help: "Move the state update into an event handler or effect that runs after render.",
  line: 12,
  column: 3,
  message:
    "State is updated during render, so React can immediately re-render in a loop before the UI settles.",
  plugin: "react-doctor",
  rule: "no-set-state-in-render",
  severity: "error",
};

describe("buildDiagnosticIssueUrl", () => {
  it("builds a prefilled GitHub issue URL for diagnostic follow-up", () => {
    const issueUrl = new URL(
      buildDiagnosticIssueUrl({
        diagnostic,
        relativeFilePath: "src/App.tsx",
      }),
    );
    const body = issueUrl.searchParams.get("body") ?? "";

    expect(issueUrl.origin + issueUrl.pathname).toBe(
      "https://github.com/millionco/react-doctor/issues/new",
    );
    expect(issueUrl.searchParams.get("title")).toBe(
      "Diagnostic follow-up: react-doctor/no-set-state-in-render",
    );
    expect(issueUrl.searchParams.get("labels")).toBe("bug");
    expect(body).toContain("Rule: react-doctor/no-set-state-in-render");
    expect(body).toContain("Location: src/App.tsx:12");
    expect(body).toContain("React can immediately re-render in a loop");
    expect(body).toContain("Move the state update into an event handler or effect");
    expect(body).toContain("false positive");
  });
});
