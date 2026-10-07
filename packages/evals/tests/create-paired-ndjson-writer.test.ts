import * as fs from "node:fs";
import { open } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { EVALUATION_ARTIFACT_FILE_MODE } from "../src/constants.js";
import type { PairedBaselineFile } from "../src/utils/create-paired-ndjson-writer.js";
import { createPairedNdjsonWriter } from "../src/utils/create-paired-ndjson-writer.js";

const CONCURRENT_PAIR_COUNT = 100;
const PARTIAL_BASELINE_WRITE_BYTE_COUNT = 3;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true });
  }
});

const makeBaselineFile = async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-pair-writer-"));
  temporaryDirectories.push(temporaryDirectory);
  const baselinePath = path.join(temporaryDirectory, "baseline.ndjson");
  return {
    baselineFileHandle: await open(baselinePath, "wx+", EVALUATION_ARTIFACT_FILE_MODE),
    baselinePath,
  };
};

describe("createPairedNdjsonWriter", () => {
  it("rolls back the baseline and rejects later pairs when the treatment write fails", async () => {
    const { baselineFileHandle, baselinePath } = await makeBaselineFile();
    const treatmentOutput = new Writable({
      write: (_chunk, _encoding, callback) => callback(new Error("treatment write failed")),
    });
    const writePairedRecords = createPairedNdjsonWriter({
      baselineFileHandle,
      treatmentOutput,
    });

    await expect(
      writePairedRecords({
        baselineRecord: { identity: "baseline-success" },
        treatmentRecord: { identity: "treatment-failure" },
      }),
    ).rejects.toThrow("treatment write failed");
    await expect(
      writePairedRecords({
        baselineRecord: { identity: "later-baseline" },
        treatmentRecord: { identity: "later-treatment" },
      }),
    ).rejects.toThrow("treatment write failed");

    expect(fs.readFileSync(baselinePath, "utf8")).toBe("");
    await baselineFileHandle.close();
  });

  it("serializes concurrent pairs with every identity exactly once", async () => {
    const { baselineFileHandle, baselinePath } = await makeBaselineFile();
    const treatmentChunks: string[] = [];
    const treatmentOutput = new Writable({
      write: (chunk, _encoding, callback) => {
        treatmentChunks.push(chunk.toString());
        callback();
      },
    });
    const writePairedRecords = createPairedNdjsonWriter({
      baselineFileHandle,
      treatmentOutput,
    });

    await Promise.all(
      Array.from({ length: CONCURRENT_PAIR_COUNT }, (_, identity) =>
        writePairedRecords({
          baselineRecord: { identity },
          treatmentRecord: { identity },
        }),
      ),
    );

    const baselineIdentities = fs
      .readFileSync(baselinePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).identity);
    const treatmentIdentities = treatmentChunks
      .join("")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).identity);
    const expectedIdentities = Array.from(
      { length: CONCURRENT_PAIR_COUNT },
      (_, identity) => identity,
    );
    expect(baselineIdentities).toEqual(expectedIdentities);
    expect(treatmentIdentities).toEqual(expectedIdentities);
    expect(new Set(baselineIdentities).size).toBe(CONCURRENT_PAIR_COUNT);
    expect(new Set(treatmentIdentities).size).toBe(CONCURRENT_PAIR_COUNT);
    await baselineFileHandle.close();
  });

  it("rolls a partial baseline write back to the prior committed offset", async () => {
    let baselineContents = Buffer.alloc(0);
    let shouldFailBaselineWrite = false;
    const baselineFileHandle: PairedBaselineFile = {
      write: async (contents, offset, length, position) => {
        const requestedContents = contents.subarray(offset, offset + length);
        const writtenContents = shouldFailBaselineWrite
          ? requestedContents.subarray(0, PARTIAL_BASELINE_WRITE_BYTE_COUNT)
          : requestedContents;
        const nextBaselineContents = Buffer.alloc(
          Math.max(baselineContents.byteLength, position + writtenContents.byteLength),
        );
        baselineContents.copy(nextBaselineContents);
        writtenContents.copy(nextBaselineContents, position);
        baselineContents = nextBaselineContents;
        if (shouldFailBaselineWrite) throw new Error("partial baseline write failed");
        return { bytesWritten: writtenContents.byteLength };
      },
      truncate: async (length = 0) => {
        baselineContents = baselineContents.subarray(0, length);
      },
    };
    const treatmentChunks: string[] = [];
    const treatmentOutput = new Writable({
      write: (chunk, _encoding, callback) => {
        treatmentChunks.push(chunk.toString());
        callback();
      },
    });
    const writePairedRecords = createPairedNdjsonWriter({
      baselineFileHandle,
      treatmentOutput,
    });
    const committedBaselineRecord = { identity: "committed-baseline" };
    const committedTreatmentRecord = { identity: "committed-treatment" };
    await writePairedRecords({
      baselineRecord: committedBaselineRecord,
      treatmentRecord: committedTreatmentRecord,
    });
    shouldFailBaselineWrite = true;

    await expect(
      writePairedRecords({
        baselineRecord: { identity: "partial-baseline" },
        treatmentRecord: { identity: "unwritten-treatment" },
      }),
    ).rejects.toThrow("partial baseline write failed");

    expect(baselineContents.toString()).toBe(`${JSON.stringify(committedBaselineRecord)}\n`);
    expect(treatmentChunks.join("")).toBe(`${JSON.stringify(committedTreatmentRecord)}\n`);
  });
});
