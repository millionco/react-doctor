import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { supportsHyperlinks } from "../src/cli/utils/supports-hyperlinks.js";

// supportsHyperlinks reads CI markers off the real process.env (via
// isCiEnvironment), so neutralize them — otherwise the "capable terminal"
// cases would always resolve false when the suite itself runs in CI.
const CI_MARKERS = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"] as const;

const ttyStream = { isTTY: true } as unknown as NodeJS.WriteStream;
const pipeStream = { isTTY: false } as unknown as NodeJS.WriteStream;

describe("supportsHyperlinks", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const marker of CI_MARKERS) {
      saved[marker] = process.env[marker];
      delete process.env[marker];
    }
  });

  afterEach(() => {
    for (const marker of CI_MARKERS) {
      if (saved[marker] === undefined) delete process.env[marker];
      else process.env[marker] = saved[marker];
    }
  });

  it("is true for a capable terminal attached to a TTY", () => {
    expect(supportsHyperlinks(ttyStream, { TERM_PROGRAM: "iTerm.app" })).toBe(true);
    expect(supportsHyperlinks(ttyStream, { WT_SESSION: "abc" })).toBe(true);
    expect(supportsHyperlinks(ttyStream, { TERM: "xterm-kitty" })).toBe(true);
    expect(supportsHyperlinks(ttyStream, { VTE_VERSION: "6003" })).toBe(true);
  });

  it("is false off a TTY, for dumb terminals, and unknown emulators", () => {
    expect(supportsHyperlinks(pipeStream, { TERM_PROGRAM: "iTerm.app" })).toBe(false);
    expect(supportsHyperlinks(ttyStream, { TERM: "dumb", TERM_PROGRAM: "iTerm.app" })).toBe(false);
    expect(supportsHyperlinks(ttyStream, { TERM_PROGRAM: "Apple_Terminal" })).toBe(false);
    expect(supportsHyperlinks(ttyStream, {})).toBe(false);
    expect(supportsHyperlinks(ttyStream, { VTE_VERSION: "4000" })).toBe(false);
  });

  it("honors FORCE_HYPERLINK over auto-detection", () => {
    // Forces on even off a TTY / unknown terminal.
    expect(supportsHyperlinks(pipeStream, { FORCE_HYPERLINK: "1" })).toBe(true);
    // Forces off even on a capable terminal.
    expect(supportsHyperlinks(ttyStream, { FORCE_HYPERLINK: "0", TERM_PROGRAM: "iTerm.app" })).toBe(
      false,
    );
    expect(
      supportsHyperlinks(ttyStream, { FORCE_HYPERLINK: "false", TERM_PROGRAM: "iTerm.app" }),
    ).toBe(false);
  });

  it("is false in CI even on a capable terminal", () => {
    process.env.CI = "true";
    expect(supportsHyperlinks(ttyStream, { TERM_PROGRAM: "iTerm.app" })).toBe(false);
  });
});
