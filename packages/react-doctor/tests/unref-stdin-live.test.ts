import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  PROMPT_PROBE_OBSERVATION_WINDOW_MS,
  PROMPT_PROBE_STARTUP_TIMEOUT_MS,
  PROMPT_PROBE_SLOW_START_MS,
} from "./constants.js";

// Live smoke test: spawn a real Node process that runs the actual
// `unrefStdin()` against a real OS stdin pipe handle, then mimics exactly
// what `prompts` does when a prompt opens (readline interface + keypress
// listener). The regression we guard against is #576: unconditionally
// unref-ing stdin let the event loop drain while an interactive prompt was
// still waiting for input, so the CLI rendered the prompt and then exited
// by itself (code 0) before the user could answer.
//
// The bug only fires when `process.stdin.isTTY` is true, so the probe forces
// that branch. A real OS pipe is a faithful stand-in for a TTY socket here:
// both are libuv stream handles, and whether the handle is ref'd is the only
// thing that decides if the loop stays alive.

const PROMPT_OPEN_MARKER = "PROMPT_OPEN";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const unrefStdinSourceUrl = pathToFileURL(
  path.join(currentDirectory, "../src/cli/utils/unref-stdin.ts"),
).href;

// The probe spawns a child Node that imports the real `.ts` source, so it can
// only run where Node can natively strip TypeScript types (>= 22.6, unflagged
// from 22.18). Older Node (e.g. the 20.19 CI lane) has no type-strip path at
// all, so the child exits with no output — skip there instead of failing.
const canRunTypeScriptEntrypoint = Boolean(process.features.typescript);

const probeScript = `
import * as readline from "node:readline";
import { unrefStdin } from ${JSON.stringify(unrefStdinSourceUrl)};

const startupDelay = Number(process.argv[3]);
if (startupDelay > 0) await new Promise((resolve) => setTimeout(resolve, startupDelay));
const wantInteractiveTty = process.argv[2] === "tty";
Object.defineProperty(process.stdin, "isTTY", { value: wantInteractiveTty, configurable: true });

unrefStdin();

const readlineInterface = readline.createInterface({ input: process.stdin, escapeCodeTimeout: 50 });
readline.emitKeypressEvents(process.stdin, readlineInterface);
process.stdin.on("keypress", () => {});

process.stdout.write(${JSON.stringify(`${PROMPT_OPEN_MARKER}\n`)});
`;

interface LiveProbeResult {
  readonly didExitByItself: boolean;
  readonly stdout: string;
}

let probeDirectory: string;
let probeScriptPath: string;

const runPromptProbe = (stdinMode: "tty" | "pipe", startupDelayMs = 0): Promise<LiveProbeResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probeScriptPath, stdinMode, String(startupDelayMs)], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let didSettle = false;
    let didReachObservationWindow = false;
    let observationTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error): void => {
      if (didSettle) return;
      didSettle = true;
      clearTimeout(startupTimer);
      clearTimeout(observationTimer);
      if (error) reject(error);
      else resolve({ didExitByItself: !didReachObservationWindow, stdout });
    };
    const startupTimer = setTimeout(() => {
      child.kill();
      finish(new Error(`Prompt probe did not become ready: ${stderr}`));
    }, PROMPT_PROBE_STARTUP_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (observationTimer || !stdout.includes(PROMPT_OPEN_MARKER)) return;
      clearTimeout(startupTimer);
      observationTimer = setTimeout(() => {
        didReachObservationWindow = true;
        child.kill();
      }, PROMPT_PROBE_OBSERVATION_WINDOW_MS);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", finish);
    child.on("close", (exitCode) => {
      finish(
        exitCode && !didReachObservationWindow
          ? new Error(`Prompt probe failed (${exitCode}): ${stderr}`)
          : undefined,
      );
    });
  });

describe.skipIf(!canRunTypeScriptEntrypoint)("unrefStdin (live)", () => {
  beforeAll(() => {
    probeDirectory = fs.mkdtempSync(path.join(tmpdir(), "react-doctor-unref-stdin-"));
    probeScriptPath = path.join(probeDirectory, "prompt-keepalive-probe.ts");
    fs.writeFileSync(probeScriptPath, probeScript);
  });

  afterAll(() => {
    fs.rmSync(probeDirectory, { recursive: true, force: true });
  });

  it("keeps the event loop alive while an interactive (TTY) prompt waits for input", async () => {
    const result = await runPromptProbe("tty");
    expect(result.stdout).toContain(PROMPT_OPEN_MARKER);
    // The actual regression guard: the process must NOT die by itself while a
    // prompt is open. If this flips to true, an interactive prompt renders and
    // exits before the user can answer (the #576 unconditional-unref bug).
    expect(result.didExitByItself).toBe(false);
  });

  it.each([0, PROMPT_PROBE_SLOW_START_MS])(
    "still exits with piped stdin after a %i ms startup delay",
    async (startupDelayMs) => {
      const result = await runPromptProbe("pipe", startupDelayMs);
      expect(result.stdout).toContain(PROMPT_OPEN_MARKER);
      // Preserves the original #576 fix: a parent-held stdin pipe must not keep
      // a finished one-shot run (e.g. `--json` from an eval runner) alive.
      expect(result.didExitByItself).toBe(true);
    },
  );
});
