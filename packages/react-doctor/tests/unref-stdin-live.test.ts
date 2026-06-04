import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import * as fs from "node:fs";
import * as path from "node:path";

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

// If the prompt is still running this long after it rendered, the event loop
// is being held open correctly. The regression exits within ~70ms of render.
const STAY_ALIVE_WINDOW_MS = 750;
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

const runPromptProbe = (stdinMode: "tty" | "pipe"): Promise<LiveProbeResult> =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [probeScriptPath, stdinMode], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    let didSettle = false;
    const stayAliveTimer = setTimeout(() => {
      if (didSettle) return;
      didSettle = true;
      child.kill();
      resolve({ didExitByItself: false, stdout });
    }, STAY_ALIVE_WINDOW_MS);

    child.on("exit", () => {
      if (didSettle) return;
      didSettle = true;
      clearTimeout(stayAliveTimer);
      resolve({ didExitByItself: true, stdout });
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

  it("still exits on its own when stdin is a non-interactive pipe (one-shot runs)", async () => {
    const result = await runPromptProbe("pipe");
    expect(result.stdout).toContain(PROMPT_OPEN_MARKER);
    // Preserves the original #576 fix: a parent-held stdin pipe must not keep
    // a finished one-shot run (e.g. `--json` from an eval runner) alive.
    expect(result.didExitByItself).toBe(true);
  });
});
