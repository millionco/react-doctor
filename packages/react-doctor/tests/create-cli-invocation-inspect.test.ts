import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  isRequired: false,
  run: vi.fn(async () => []),
  dispose: vi.fn(async () => {}),
  inspectProject: vi.fn(),
  createInvocationInspect: vi.fn(),
  createSecurityScanWorker: vi.fn(),
}));

vi.mock("@react-doctor/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@react-doctor/core")>()),
  isNativeOxlintRequired: () => mocks.isRequired,
  createSecurityScanWorker: mocks.createSecurityScanWorker,
}));

vi.mock("../src/inspect.js", () => ({
  createInvocationInspect: mocks.createInvocationInspect,
}));

import { createCliInvocationInspect } from "../src/cli/utils/create-cli-invocation-inspect.js";

describe("CLI security scan ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isRequired = false;
    mocks.createInvocationInspect.mockReturnValue(mocks.inspectProject);
    mocks.createSecurityScanWorker.mockReturnValue({ run: mocks.run, dispose: mocks.dispose });
  });

  it.each([false, true])(
    "keeps serial scans inline in required-native mode %s",
    async (isRequired) => {
      mocks.isRequired = isRequired;
      const invocation = createCliInvocationInspect(1);
      expect(invocation.inspectProject).toBe(mocks.inspectProject);
      expect(mocks.createInvocationInspect).toHaveBeenCalledWith(1, undefined);
      expect(mocks.createSecurityScanWorker).not.toHaveBeenCalled();
      await invocation.dispose();
      expect(mocks.dispose).not.toHaveBeenCalled();
    },
  );

  it("keeps the ordinary parallel CLI inline", async () => {
    const invocation = createCliInvocationInspect(4);
    expect(mocks.createInvocationInspect).toHaveBeenCalledWith(4, undefined);
    expect(mocks.createSecurityScanWorker).not.toHaveBeenCalled();
    await invocation.dispose();
  });

  it("shares one lazy worker across an invocation and waits for its disposal", async () => {
    mocks.isRequired = true;
    let finishDisposal: (() => void) | undefined;
    mocks.dispose.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDisposal = resolve;
        }),
    );
    const invocation = createCliInvocationInspect(4);
    await invocation.inspectProject("/first");
    await invocation.inspectProject("/second");
    expect(mocks.createSecurityScanWorker).toHaveBeenCalledTimes(1);
    expect(mocks.createInvocationInspect).toHaveBeenCalledWith(4, mocks.run);
    expect(mocks.run).not.toHaveBeenCalled();
    let didDispose = false;
    const disposal = invocation.dispose().then(() => {
      didDispose = true;
    });
    await Promise.resolve();
    expect(didDispose).toBe(false);
    finishDisposal?.();
    await disposal;
    expect(didDispose).toBe(true);
  });

  it("creates separate owners for successive invocations", async () => {
    mocks.isRequired = true;
    const firstInvocation = createCliInvocationInspect(4);
    await firstInvocation.dispose();
    const secondInvocation = createCliInvocationInspect(4);
    expect(mocks.createSecurityScanWorker).toHaveBeenCalledTimes(2);
    await secondInvocation.dispose();
  });
});
