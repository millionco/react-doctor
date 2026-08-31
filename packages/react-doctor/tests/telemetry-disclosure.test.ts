import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  TELEMETRY_DISCLOSURE_LINES,
  showTelemetryDisclosureIfNeeded,
} from "../src/cli/utils/telemetry-disclosure.js";

describe("showTelemetryDisclosureIfNeeded", () => {
  let configDirectory: string;

  beforeEach(() => {
    configDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-telemetry-notice-"));
  });

  afterEach(() => {
    fs.rmSync(configDirectory, { recursive: true, force: true });
  });

  it("shows the disclosure once for an interactive telemetry-enabled run", () => {
    const lines: string[] = [];
    const input = {
      isInteractive: true,
      store: { cwd: configDirectory },
      telemetryEnabled: true,
      writeLine: (line: string) => lines.push(line),
    };

    expect(showTelemetryDisclosureIfNeeded(input)).toBe(true);
    expect(lines).toEqual(["", ...TELEMETRY_DISCLOSURE_LINES, ""]);
    expect(showTelemetryDisclosureIfNeeded(input)).toBe(false);
  });

  it("does not consume the disclosure during a headless run", () => {
    const input = {
      isInteractive: false,
      store: { cwd: configDirectory },
      telemetryEnabled: true,
      writeLine: (): void => {},
    };

    expect(showTelemetryDisclosureIfNeeded(input)).toBe(false);
    expect(showTelemetryDisclosureIfNeeded({ ...input, isInteractive: true })).toBe(true);
  });

  it("does not show or consume the disclosure when telemetry is disabled", () => {
    const input = {
      isInteractive: true,
      store: { cwd: configDirectory },
      telemetryEnabled: false,
      writeLine: (): void => {},
    };

    expect(showTelemetryDisclosureIfNeeded(input)).toBe(false);
    expect(showTelemetryDisclosureIfNeeded({ ...input, telemetryEnabled: true })).toBe(true);
  });
});
