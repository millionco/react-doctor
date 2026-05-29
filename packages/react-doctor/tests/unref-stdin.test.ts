import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { unrefStdin } from "../src/cli/utils/unref-stdin.js";

interface StdinUnrefHandle {
  restore: () => void;
}

const stubStdinUnref = (unref: (() => void) | undefined): StdinUnrefHandle => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "unref");
  Object.defineProperty(process.stdin, "unref", { value: unref, configurable: true });
  return {
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "unref", originalDescriptor);
      } else {
        delete (process.stdin as unknown as { unref?: unknown }).unref;
      }
    },
  };
};

describe("unrefStdin", () => {
  let handle: StdinUnrefHandle | undefined;

  afterEach(() => {
    handle?.restore();
    handle = undefined;
  });

  it("unrefs stdin so an inherited pipe/socket can't hold the event loop open", () => {
    const unref = vi.fn();
    handle = stubStdinUnref(unref);
    unrefStdin();
    expect(unref).toHaveBeenCalledTimes(1);
  });

  // File / `/dev/null` stdin resolves to an `fs.ReadStream` with no `unref`.
  it("is a no-op when stdin has no unref (file / /dev/null)", () => {
    handle = stubStdinUnref(undefined);
    expect(() => unrefStdin()).not.toThrow();
  });
});
