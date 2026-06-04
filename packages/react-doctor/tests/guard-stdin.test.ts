import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { TERMINAL_HANGUP_EXIT_CODE } from "../src/cli/utils/constants.js";
import { guardStdin, handleStdinError } from "../src/cli/utils/guard-stdin.js";

const makeStdinError = (code: string | undefined): NodeJS.ErrnoException => {
  const error: NodeJS.ErrnoException = new Error(`read ${code}`);
  error.code = code;
  return error;
};

// Make `process.exit` throw a sentinel instead of exiting the test runner, so
// a call is observable and `handleStdinError`'s post-exit `throw` stays
// unreached (mirroring how a real exit halts execution there).
const stubProcessExitToThrow = () =>
  vi.spyOn(process, "exit").mockImplementation(((exitCode?: number) => {
    throw new Error(`__exit__:${exitCode}`);
  }) as never);

describe("handleStdinError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A vanished terminal surfaces as `read EIO` on the raw-mode stdin handle.
  // Exit like an interrupted run instead of crashing as an uncaught exception.
  it.each(["EIO", "ENXIO"])("exits with the hangup code on %s", (code) => {
    const exit = stubProcessExitToThrow();

    expect(() => handleStdinError(makeStdinError(code))).toThrow(
      `__exit__:${TERMINAL_HANGUP_EXIT_CODE}`,
    );
    expect(exit).toHaveBeenCalledWith(TERMINAL_HANGUP_EXIT_CODE);
  });

  // Anything that isn't a terminal hangup must keep funneling to the crash
  // reporter exactly as it did before the guard existed: re-thrown, not exited.
  it.each(["EPIPE", "EACCES", undefined])("re-throws and never exits on %s", (code) => {
    const exit = stubProcessExitToThrow();
    const error = makeStdinError(code);

    expect(() => handleStdinError(error)).toThrow(error);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe("guardStdin", () => {
  afterEach(() => {
    process.stdin.removeListener("error", handleStdinError);
  });

  it("registers the stdin error handler", () => {
    expect(process.stdin.listeners("error")).not.toContain(handleStdinError);
    guardStdin();
    expect(process.stdin.listeners("error")).toContain(handleStdinError);
  });
});
