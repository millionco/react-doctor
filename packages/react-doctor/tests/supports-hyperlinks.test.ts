import { describe, expect, it } from "vite-plus/test";
import { supportsHyperlinks } from "../src/cli/utils/supports-hyperlinks.js";

// supportsHyperlinks is a pure function of (stream, env) — including its CI
// check — so each case passes an isolated env and a stub stream; the CI runner
// this suite runs in can't leak into the assertions.
const ttyStream = { isTTY: true } as unknown as NodeJS.WriteStream;
const pipeStream = { isTTY: false } as unknown as NodeJS.WriteStream;

describe("supportsHyperlinks", () => {
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
    expect(supportsHyperlinks(ttyStream, { CI: "true", TERM_PROGRAM: "iTerm.app" })).toBe(false);
    expect(
      supportsHyperlinks(ttyStream, { GITHUB_ACTIONS: "true", TERM_PROGRAM: "iTerm.app" }),
    ).toBe(false);
  });
});
