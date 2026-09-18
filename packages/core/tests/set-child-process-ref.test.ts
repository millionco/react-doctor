import type { ChildProcess } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { setChildProcessRef } from "../src/utils/set-child-process-ref.js";

interface MockChildProcess extends Partial<ChildProcess> {
  ref: () => void;
  unref: () => void;
  channel?: {
    ref?: () => void;
    unref?: () => void;
  };
  stdout?: {
    ref?: () => void;
    unref?: () => void;
  };
  stderr?: {
    ref?: () => void;
    unref?: () => void;
  };
}

const createMockChild = (options: {
  hasChannelMethods?: boolean;
  hasChannel?: boolean;
}): MockChildProcess => {
  const child: MockChildProcess = {
    ref: vi.fn(),
    unref: vi.fn(),
  };

  if (options.hasChannel !== false) {
    if (options.hasChannelMethods) {
      child.channel = {
        ref: vi.fn(),
        unref: vi.fn(),
      };
    } else {
      child.channel = {};
    }
  }

  return child;
};

describe("setChildProcessRef", () => {
  it("calls ref() on the child process and channel when shouldRef is true", () => {
    const child = createMockChild({ hasChannelMethods: true });
    setChildProcessRef(child as ChildProcess, true);

    expect(child.ref).toHaveBeenCalledOnce();
    expect(child.channel?.ref).toHaveBeenCalledOnce();
  });

  it("calls unref() on the child process and channel when shouldRef is false", () => {
    const child = createMockChild({ hasChannelMethods: true });
    setChildProcessRef(child as ChildProcess, false);

    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.channel?.unref).toHaveBeenCalledOnce();
  });

  it("does not throw when channel exists but has no ref method (Bun runtime)", () => {
    const child = createMockChild({ hasChannelMethods: false });

    expect(() => {
      setChildProcessRef(child as ChildProcess, true);
    }).not.toThrow();

    expect(child.ref).toHaveBeenCalledOnce();
  });

  it("does not throw when channel exists but has no unref method (Bun runtime)", () => {
    const child = createMockChild({ hasChannelMethods: false });

    expect(() => {
      setChildProcessRef(child as ChildProcess, false);
    }).not.toThrow();

    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("does not throw when channel does not exist at all", () => {
    const child = createMockChild({ hasChannel: false });

    expect(() => {
      setChildProcessRef(child as ChildProcess, true);
    }).not.toThrow();

    expect(() => {
      setChildProcessRef(child as ChildProcess, false);
    }).not.toThrow();

    expect(child.ref).toHaveBeenCalledOnce();
    expect(child.unref).toHaveBeenCalledOnce();
  });
});
