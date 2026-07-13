import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { withRootScanIsolation } from "../src/utils/with-root-scan-isolation.js";

const temporaryDirectories: string[] = [];

const makeTemporaryDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-root-scan-isolation-"));
  temporaryDirectories.push(directory);
  return directory;
};

const makeBarrier = () => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("withRootScanIsolation", () => {
  it("lets ordinary scans overlap", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const firstBarrier = makeBarrier();
    const secondStarted = makeBarrier();
    const first = withRootScanIsolation(rootDirectory, false, async () => {
      await firstBarrier.promise;
    });
    const second = withRootScanIsolation(rootDirectory, false, async () => {
      secondStarted.release();
    });

    await secondStarted.promise;
    firstBarrier.release();
    await Promise.all([first, second]);
  });

  it("keeps ordinary scans outside an audit scan", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const auditBarrier = makeBarrier();
    const auditStarted = makeBarrier();
    let didOrdinaryScanStart = false;
    const audit = withRootScanIsolation(rootDirectory, true, async () => {
      auditStarted.release();
      await auditBarrier.promise;
    });
    await auditStarted.promise;
    const ordinary = withRootScanIsolation(rootDirectory, false, async () => {
      didOrdinaryScanStart = true;
    });

    await Promise.resolve();
    expect(didOrdinaryScanStart).toBe(false);
    auditBarrier.release();
    await Promise.all([audit, ordinary]);
    expect(didOrdinaryScanStart).toBe(true);
  });

  it("keeps audit scans outside an ordinary scan", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const ordinaryBarrier = makeBarrier();
    const ordinaryStarted = makeBarrier();
    let didAuditScanStart = false;
    const ordinary = withRootScanIsolation(rootDirectory, false, async () => {
      ordinaryStarted.release();
      await ordinaryBarrier.promise;
    });
    await ordinaryStarted.promise;
    const audit = withRootScanIsolation(rootDirectory, true, async () => {
      didAuditScanStart = true;
    });

    await Promise.resolve();
    expect(didAuditScanStart).toBe(false);
    ordinaryBarrier.release();
    await Promise.all([ordinary, audit]);
    expect(didAuditScanStart).toBe(true);
  });

  it("treats symlinked roots as the same scan root", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const symlinkDirectory = `${rootDirectory}-link`;
    fs.symlinkSync(rootDirectory, symlinkDirectory);
    temporaryDirectories.push(symlinkDirectory);
    const auditBarrier = makeBarrier();
    const auditStarted = makeBarrier();
    let didOrdinaryScanStart = false;
    const audit = withRootScanIsolation(rootDirectory, true, async () => {
      auditStarted.release();
      await auditBarrier.promise;
    });
    await auditStarted.promise;
    const ordinary = withRootScanIsolation(symlinkDirectory, false, async () => {
      didOrdinaryScanStart = true;
    });

    await Promise.resolve();
    expect(didOrdinaryScanStart).toBe(false);
    auditBarrier.release();
    await Promise.all([audit, ordinary]);
    expect(didOrdinaryScanStart).toBe(true);
  });

  it("does not let new ordinary scans overtake a waiting audit", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const firstOrdinaryBarrier = makeBarrier();
    const firstOrdinaryStarted = makeBarrier();
    const auditBarrier = makeBarrier();
    const auditStarted = makeBarrier();
    let didSecondOrdinaryStart = false;
    const firstOrdinary = withRootScanIsolation(rootDirectory, false, async () => {
      firstOrdinaryStarted.release();
      await firstOrdinaryBarrier.promise;
    });
    await firstOrdinaryStarted.promise;
    const audit = withRootScanIsolation(rootDirectory, true, async () => {
      auditStarted.release();
      await auditBarrier.promise;
    });
    const secondOrdinary = withRootScanIsolation(rootDirectory, false, async () => {
      didSecondOrdinaryStart = true;
    });

    firstOrdinaryBarrier.release();
    await auditStarted.promise;
    expect(didSecondOrdinaryStart).toBe(false);
    auditBarrier.release();
    await Promise.all([firstOrdinary, audit, secondOrdinary]);
    expect(didSecondOrdinaryStart).toBe(true);
  });

  it("releases isolation when a scan fails", async () => {
    const rootDirectory = makeTemporaryDirectory();
    const expectedError = new Error("scan failed");
    await expect(
      withRootScanIsolation(rootDirectory, true, async () => {
        throw expectedError;
      }),
    ).rejects.toBe(expectedError);

    let didOrdinaryScanStart = false;
    await withRootScanIsolation(rootDirectory, false, async () => {
      didOrdinaryScanStart = true;
    });
    expect(didOrdinaryScanStart).toBe(true);
  });

  it("does not serialize scans from different roots", async () => {
    const firstRootDirectory = makeTemporaryDirectory();
    const secondRootDirectory = makeTemporaryDirectory();
    const firstBarrier = makeBarrier();
    const firstStarted = makeBarrier();
    const secondStarted = makeBarrier();
    const first = withRootScanIsolation(firstRootDirectory, true, async () => {
      firstStarted.release();
      await firstBarrier.promise;
    });
    await firstStarted.promise;
    const second = withRootScanIsolation(secondRootDirectory, true, async () => {
      secondStarted.release();
    });

    await secondStarted.promise;
    firstBarrier.release();
    await Promise.all([first, second]);
  });
});
