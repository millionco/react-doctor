import { createHash } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { finished } from "node:stream/promises";

import { EVALUATION_ARTIFACT_FILE_MODE } from "./constants.js";
import type { CorpusEvaluationRecord, EvaluationProvenance } from "./corpus.js";
import type { LoadedMatrixTreatment } from "./matrix-treatment-descriptor.js";
import type {
  MaterializedMatrixBaseArtifactBinding,
  MatrixBaseArtifactBinding,
} from "./utils/matrix-base-artifact-binding.js";
import { materializeMatrixBaseArtifactBinding } from "./utils/matrix-base-artifact-binding.js";
import { serializeNdjsonRecord } from "./utils/serialize-ndjson-record.js";
import { writeWritableContents } from "./utils/write-writable-contents.js";

export interface MatrixArtifactProvenance {
  schemaVersion: number;
  evaluationId: string;
  laneId: string;
  status: "complete" | "failed" | "blocked";
  expectedProjectCount: number;
  recordCount: number;
  failedRecordCount: number;
  artifact: {
    path: string;
    sha256: string;
    byteLength: number;
  };
  corpusManifest: {
    path: string;
    sha256: string;
    byteLength: number;
  };
  descriptorSha256: string;
  impactManifestSha256: string;
  rulesSha256: string;
  baseArtifact?: MaterializedMatrixBaseArtifactBinding;
  ruleKeys: ReadonlyArray<string>;
  evaluation?: EvaluationProvenance;
}

export interface MatrixArtifactWriter {
  write: (record: CorpusEvaluationRecord) => Promise<void>;
  finalize: (baseArtifact?: MatrixBaseArtifactBinding) => Promise<MatrixArtifactProvenance>;
  abort: () => Promise<void>;
}

const hashFile = async (filePath: string): Promise<string> => {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hasher.update(chunk);
  return hasher.digest("hex");
};

interface RecordSpool {
  write: (record: CorpusEvaluationRecord) => Promise<void>;
  materialize: (outputPath: string) => Promise<void>;
}

const createRecordSpool = async (recordsDirectory: string): Promise<RecordSpool> => {
  await mkdir(recordsDirectory);
  return {
    write: async (record) => {
      const projectIdentity = JSON.stringify([
        record.repository.org,
        record.repository.name,
        record.repository.ref,
        record.repository.rootDir,
      ]);
      const recordName = `${createHash("sha256").update(projectIdentity).digest("hex")}.ndjson`;
      const recordPath = join(recordsDirectory, recordName);
      const pendingRecordPath = join(recordsDirectory, `.partial-${recordName}`);
      await access(recordPath).then(
        () => {
          throw new Error(`Duplicate matrix project record: ${projectIdentity}`);
        },
        () => undefined,
      );
      try {
        await writeFile(pendingRecordPath, serializeNdjsonRecord(record), {
          flag: "wx",
          mode: EVALUATION_ARTIFACT_FILE_MODE,
        });
        await rename(pendingRecordPath, recordPath);
      } catch (error) {
        await rm(pendingRecordPath, { force: true });
        throw error;
      }
    },
    materialize: async (outputPath) => {
      const outputStream = createWriteStream(outputPath, {
        flags: "wx",
        mode: EVALUATION_ARTIFACT_FILE_MODE,
      });
      await once(outputStream, "open");
      try {
        const recordNames = (await readdir(recordsDirectory))
          .filter((recordName) => recordName.endsWith(".ndjson"))
          .sort();
        for (const recordName of recordNames) {
          const contents = await readFile(join(recordsDirectory, recordName), "utf8");
          await writeWritableContents(outputStream, contents);
        }
      } finally {
        outputStream.end();
        await finished(outputStream);
      }
    },
  };
};

export const createMatrixArtifactWriter = async ({
  evaluationId,
  treatment,
  expectedProjectCount,
  corpusManifestContents,
}: {
  evaluationId: string;
  treatment: LoadedMatrixTreatment;
  expectedProjectCount: number;
  corpusManifestContents: Buffer;
}): Promise<MatrixArtifactWriter> => {
  const corpusManifestSha256 = createHash("sha256").update(corpusManifestContents).digest("hex");
  if (corpusManifestSha256 !== treatment.descriptor.group.corpusManifestSha256) {
    throw new Error("Matrix corpus manifest contents do not match the descriptor");
  }
  const artifactDirectory = treatment.descriptor.artifactDirectory;
  const pendingDirectory = join(
    dirname(artifactDirectory),
    `.partial-${basename(artifactDirectory)}-${evaluationId}`,
  );
  await access(artifactDirectory).then(
    () => {
      throw new Error(`Matrix artifact directory already exists: ${artifactDirectory}`);
    },
    () => undefined,
  );
  await mkdir(dirname(artifactDirectory), { recursive: true });
  await mkdir(pendingDirectory);
  const candidatePath = join(pendingDirectory, "candidate.ndjson");
  const corpusManifestPath = join(pendingDirectory, "corpus-manifest.json");
  const rulesPath = join(pendingDirectory, "rules.json");
  const rulesContents = `${JSON.stringify(treatment.ruleKeys, null, 2)}\n`;
  const recordsDirectory = join(pendingDirectory, "records");
  const recordSpool = await createRecordSpool(recordsDirectory)
    .then(async (createdRecordSpool) => {
      await Promise.all([
        writeFile(join(pendingDirectory, "descriptor.json"), treatment.descriptorContents, {
          flag: "wx",
          mode: EVALUATION_ARTIFACT_FILE_MODE,
        }),
        writeFile(
          join(pendingDirectory, "impact-manifest.json"),
          treatment.impactManifestContents,
          {
            flag: "wx",
            mode: EVALUATION_ARTIFACT_FILE_MODE,
          },
        ),
        writeFile(rulesPath, rulesContents, {
          flag: "wx",
          mode: EVALUATION_ARTIFACT_FILE_MODE,
        }),
        writeFile(corpusManifestPath, corpusManifestContents, {
          flag: "wx",
          mode: EVALUATION_ARTIFACT_FILE_MODE,
        }),
      ]);
      return createdRecordSpool;
    })
    .catch(async (error) => {
      await rm(pendingDirectory, { recursive: true, force: true });
      throw error;
    });
  let recordCount = 0;
  let failedRecordCount = 0;
  let evaluation: EvaluationProvenance | undefined;
  let isClosed = false;

  return {
    write: async (record) => {
      if (isClosed) throw new Error(`Matrix artifact ${treatment.descriptor.id} is closed`);
      await recordSpool.write(record);
      recordCount += 1;
      if (record.error) failedRecordCount += 1;
      if (record.evaluation) evaluation = record.evaluation;
    },
    finalize: async (baseArtifact) => {
      if (isClosed) throw new Error(`Matrix artifact ${treatment.descriptor.id} is closed`);
      isClosed = true;
      await recordSpool.materialize(candidatePath);
      await rm(recordsDirectory, { recursive: true });
      const [candidateStats, corpusManifestStats, copiedCorpusManifestSha256] = await Promise.all([
        stat(candidatePath),
        stat(corpusManifestPath),
        hashFile(corpusManifestPath),
      ]);
      if (copiedCorpusManifestSha256 !== corpusManifestSha256) {
        throw new Error("Matrix corpus manifest changed before artifact finalization");
      }
      const didTreatmentComplete = failedRecordCount === 0 && recordCount === expectedProjectCount;
      const materializedBaseArtifact =
        didTreatmentComplete && baseArtifact
          ? await materializeMatrixBaseArtifactBinding({
              binding: baseArtifact,
              destinationDirectory: pendingDirectory,
            })
          : undefined;
      let status: MatrixArtifactProvenance["status"] = "complete";
      if (!didTreatmentComplete) status = "failed";
      else if (!materializedBaseArtifact?.verified) status = "blocked";
      const provenance: MatrixArtifactProvenance = {
        schemaVersion: 1,
        evaluationId,
        laneId: treatment.descriptor.id,
        status,
        expectedProjectCount,
        recordCount,
        failedRecordCount,
        artifact: {
          path: "candidate.ndjson",
          sha256: await hashFile(candidatePath),
          byteLength: candidateStats.size,
        },
        corpusManifest: {
          path: "corpus-manifest.json",
          sha256: corpusManifestSha256,
          byteLength: corpusManifestStats.size,
        },
        descriptorSha256: treatment.descriptorSha256,
        impactManifestSha256: treatment.descriptor.impactManifestSha256,
        rulesSha256: await hashFile(rulesPath),
        baseArtifact: materializedBaseArtifact,
        ruleKeys: treatment.ruleKeys,
        evaluation,
      };
      await writeFile(
        join(pendingDirectory, "provenance.json"),
        `${JSON.stringify(provenance, null, 2)}\n`,
        { flag: "wx", mode: EVALUATION_ARTIFACT_FILE_MODE },
      );
      await rename(pendingDirectory, artifactDirectory);
      return provenance;
    },
    abort: async () => {
      isClosed = true;
      await rm(pendingDirectory, { recursive: true, force: true });
    },
  };
};

export interface AtomicNdjsonWriter {
  write: (record: CorpusEvaluationRecord) => Promise<void>;
  finalize: () => Promise<void>;
  abort: () => Promise<void>;
}

export const createAtomicNdjsonWriter = async ({
  outputPath,
  evaluationId,
}: {
  outputPath: string;
  evaluationId: string;
}): Promise<AtomicNdjsonWriter> => {
  const pendingPath = `${outputPath}.partial-${evaluationId}`;
  await access(outputPath).then(
    () => {
      throw new Error(`Evaluation artifact already exists: ${outputPath}`);
    },
    () => undefined,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(pendingPath);
  const recordsDirectory = join(pendingPath, "records");
  const recordSpool = await createRecordSpool(recordsDirectory).catch(async (error) => {
    await rm(pendingPath, { recursive: true, force: true });
    throw error;
  });
  let isClosed = false;
  return {
    write: async (record) => {
      if (isClosed) throw new Error(`Evaluation artifact is closed: ${outputPath}`);
      await recordSpool.write(record);
    },
    finalize: async () => {
      if (isClosed) throw new Error(`Evaluation artifact is closed: ${outputPath}`);
      isClosed = true;
      const materializedPath = join(pendingPath, "artifact.ndjson");
      await recordSpool.materialize(materializedPath);
      await rename(materializedPath, outputPath);
      await rm(pendingPath, { recursive: true });
    },
    abort: async () => {
      isClosed = true;
      await rm(pendingPath, { recursive: true, force: true });
    },
  };
};
