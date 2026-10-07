import { describe, expect, it, vi } from "vite-plus/test";
import { setChildProcessRef } from "../src/utils/set-child-process-ref.js";

interface MockChildProcess {
  channel?: {
    ref?: () => void;
    unref?: () => void;
  };
  ref: () => void;
  unref: () => void;
}

const createMockChildProcess = (channel: MockChildProcess["channel"]): MockChildProcess => ({
  channel,
  ref: vi.fn(),
  unref: vi.fn(),
});

describe("setChildProcessRef", () => {
  it("updates the child and channel references when channel methods are available", () => {
    const childProcess = createMockChildProcess({
      ref: vi.fn(),
      unref: vi.fn(),
    });

    setChildProcessRef(childProcess, true);
    setChildProcessRef(childProcess, false);

    expect(childProcess.ref).toHaveBeenCalledOnce();
    expect(childProcess.unref).toHaveBeenCalledOnce();
    expect(childProcess.channel?.ref).toHaveBeenCalledOnce();
    expect(childProcess.channel?.unref).toHaveBeenCalledOnce();
  });

  it("ignores a Bun-compatible channel without reference methods", () => {
    const childProcess = createMockChildProcess({});

    expect(() => setChildProcessRef(childProcess, true)).not.toThrow();
    expect(() => setChildProcessRef(childProcess, false)).not.toThrow();
    expect(childProcess.ref).toHaveBeenCalledOnce();
    expect(childProcess.unref).toHaveBeenCalledOnce();
  });

  it("ignores an absent channel", () => {
    const childProcess = createMockChildProcess(undefined);

    expect(() => setChildProcessRef(childProcess, true)).not.toThrow();
    expect(() => setChildProcessRef(childProcess, false)).not.toThrow();
    expect(childProcess.ref).toHaveBeenCalledOnce();
    expect(childProcess.unref).toHaveBeenCalledOnce();
  });
});
