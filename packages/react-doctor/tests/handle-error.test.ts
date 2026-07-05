import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { GitBaseBranchInvalid, ReactDoctorError } from "@react-doctor/core";
import { buildErrorIssueUrl, handleError, handleUserError } from "../src/cli/utils/handle-error.js";
import { formatEnvironmentError } from "../src/cli/utils/is-environment-error.js";

const OTLP_ENDPOINT_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_ENDPOINT";
const OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_AUTH_HEADER";

interface EnvironmentSnapshot {
  [environmentVariableName: string]: string | undefined;
}

describe("handleError", () => {
  let savedEnvironment: EnvironmentSnapshot;
  let savedExitCode: number | string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
    savedEnvironment = {
      [OTLP_ENDPOINT_ENVIRONMENT_VARIABLE]: process.env[OTLP_ENDPOINT_ENVIRONMENT_VARIABLE],
      [OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE]: process.env[OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE],
    };
    process.env[OTLP_ENDPOINT_ENVIRONMENT_VARIABLE] = "https://otel.example.test";
    process.env[OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE] = "Bearer secret-token";
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    for (const [environmentVariableName, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) {
        delete process.env[environmentVariableName];
      } else {
        process.env[environmentVariableName] = value;
      }
    }
  });

  it("builds a prefilled GitHub issue URL with redacted OTel context", () => {
    const issueUrl = new URL(buildErrorIssueUrl(new Error("boom")));
    const body = issueUrl.searchParams.get("body") ?? "";

    expect(issueUrl.origin + issueUrl.pathname).toBe(
      "https://github.com/millionco/react-doctor/issues/new",
    );
    expect(issueUrl.searchParams.get("title")).toBe("CLI error: boom");
    expect(issueUrl.searchParams.get("labels")).toBe("bug");
    expect(body).toContain("```text\nboom\n```");
    expect(body).toContain("REACT_DOCTOR_OTLP_ENDPOINT configured: yes");
    expect(body).toContain("REACT_DOCTOR_OTLP_AUTH_HEADER configured: yes (value redacted)");
    expect(body).toContain("OTLP exporter enabled: yes");
    expect(body).toContain("trace/span link, if exported:");
    expect(body).not.toContain("secret-token");
  });

  it("adds the Sentry reference to the issue body when an event id is provided", () => {
    const body =
      new URL(buildErrorIssueUrl(new Error("boom"), "evt-abc123")).searchParams.get("body") ?? "";
    expect(body).toContain("Sentry reference: evt-abc123");
  });

  it("scrubs sensitive paths and tokens from the prefilled issue", () => {
    const token = `ghp_${"a".repeat(36)}`;
    const error = new Error(`failed at /home/alice/app/src/index.ts with token ${token}`);
    const issueUrl = new URL(buildErrorIssueUrl(error));
    const title = issueUrl.searchParams.get("title") ?? "";
    const body = issueUrl.searchParams.get("body") ?? "";

    expect(title).not.toContain("/home/alice");
    expect(body).not.toContain("/home/alice");
    expect(body).toContain("~/app/src/index.ts");
    expect(title).not.toContain(token);
    expect(body).not.toContain(token);
  });

  it("omits the Sentry reference line when no event id is provided", () => {
    const body = new URL(buildErrorIssueUrl(new Error("boom"))).searchParams.get("body") ?? "";
    expect(body).not.toContain("Sentry reference:");
  });

  it("prints the reference id so the user can quote it when reporting", () => {
    const errorMessages: string[] = [];
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...messages) => {
      errorMessages.push(messages.join(" "));
    });

    try {
      handleError(new Error("boom"), { shouldExit: false, sentryEventId: "evt-xyz789" });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(errorMessages.join("\n")).toContain(
      "Reference (mention this when reporting): evt-xyz789",
    );
  });

  it("suggests Discord when printing an error", () => {
    const errorMessages: string[] = [];
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...messages) => {
      errorMessages.push(messages.join(" "));
    });

    try {
      handleError(new Error("boom"), { shouldExit: false });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    expect(errorMessages.join("\n")).toContain(
      "You can also ask for help in Discord: https://react.doctor/discord",
    );
    expect(process.exitCode).toBe(1);
  });
});

describe("formatEnvironmentError", () => {
  it("scrubs absolute paths from permission errors", () => {
    const error = Object.assign(new Error("permission denied"), {
      code: "EACCES",
      path: "/home/alice/private/project",
    });

    const message = formatEnvironmentError(error);

    expect(message).toContain("~/private/project");
    expect(message).not.toContain("/home/alice");
  });
});

describe("handleUserError", () => {
  let savedExitCode: number | string | undefined;

  beforeEach(() => {
    savedExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
  });

  it("prints just the message — no crash framing, issue link, Discord, or Sentry reference", () => {
    const errorMessages: string[] = [];
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...messages) => {
      errorMessages.push(messages.join(" "));
    });

    const userError = new ReactDoctorError({
      reason: new GitBaseBranchInvalid({
        detail: 'Diff range "7694215..c4de712" has an invalid endpoint "..".',
      }),
    });
    try {
      handleUserError(userError, { shouldExit: false });
    } finally {
      consoleErrorSpy.mockRestore();
    }

    const output = errorMessages.join("\n");
    expect(output).toContain('Diff range "7694215..c4de712" has an invalid endpoint');
    expect(output).not.toContain("Something went wrong");
    expect(output).not.toContain("open this prefilled issue");
    expect(output).not.toContain("Discord");
    expect(output).not.toContain("Reference (mention this when reporting)");
    expect(process.exitCode).toBe(1);
  });
});
