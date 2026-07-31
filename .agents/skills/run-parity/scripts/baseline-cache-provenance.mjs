import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { compareStrings } from "./compare-parity.mjs";

const PROVENANCE_SCHEMA_VERSION = 1;
const PROCESS_ARGUMENT_START_INDEX = 2;
const OPTION_ARGUMENT_STRIDE = 2;
const OPTION_PREFIX_LENGTH = 2;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_OPTIONS = [
  "baseline",
  "corpus-manifest",
  "base-commit",
  "repository",
  "evaluator-source-hash",
  "config-contract",
  "rule-set-hash",
];
const ALLOWED_OPTIONS = new Set([...REQUIRED_OPTIONS, "provenance"]);
const PRODUCER_KEYS = [
  "configContract",
  "evaluatorSourceHash",
  "reactDoctorCommit",
  "reactDoctorRepository",
  "ruleKeys",
  "ruleSetHash",
];
const PROJECT_KEYS = ["name", "org", "ref", "rootDir"];

const hashBytes = (contents) => createHash("sha256").update(contents).digest("hex");

const canonicalizeJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey))
        .map(([key, innerValue]) => [key, canonicalizeJsonValue(innerValue)]),
    );
  }
  return value;
};

const serializeCanonicalValue = (value) => JSON.stringify(canonicalizeJsonValue(value));

const hashCanonicalValue = (value) => hashBytes(serializeCanonicalValue(value));

const getDefaultProvenancePath = (baselinePath) => {
  const extension = extname(baselinePath);
  const stem = extension.length === 0 ? basename(baselinePath) : basename(baselinePath, extension);
  return join(dirname(baselinePath), `${stem}.provenance.json`);
};

const assertExactKeys = (value, expectedKeys, description) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
  const actualKeys = Object.keys(value).sort(compareStrings);
  const sortedExpectedKeys = [...expectedKeys].sort(compareStrings);
  if (serializeCanonicalValue(actualKeys) !== serializeCanonicalValue(sortedExpectedKeys)) {
    throw new Error(`${description} has unexpected fields`);
  }
};

const assertNonemptyString = (value, description) => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${description} must be a nonempty string`);
  }
};

const assertSha256 = (value, description) => {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${description} must be a lowercase SHA-256 digest`);
  }
};

const assertPositiveSafeInteger = (value, description) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${description} must be a positive safe integer`);
  }
};

const validateProducer = (producer, description) => {
  assertExactKeys(producer, PRODUCER_KEYS, description);
  assertNonemptyString(producer.reactDoctorRepository, `${description}.reactDoctorRepository`);
  assertNonemptyString(producer.reactDoctorCommit, `${description}.reactDoctorCommit`);
  if (!GIT_COMMIT_PATTERN.test(producer.reactDoctorCommit)) {
    throw new Error(`${description}.reactDoctorCommit must be a 40-character commit`);
  }
  assertSha256(producer.evaluatorSourceHash, `${description}.evaluatorSourceHash`);
  assertNonemptyString(producer.configContract, `${description}.configContract`);
  assertSha256(producer.ruleSetHash, `${description}.ruleSetHash`);
  if (
    !Array.isArray(producer.ruleKeys) ||
    producer.ruleKeys.some((ruleKey) => typeof ruleKey !== "string")
  ) {
    throw new Error(`${description}.ruleKeys must be a string array`);
  }
};

const buildExpectedProducer = ({
  reactDoctorRepository,
  reactDoctorCommit,
  evaluatorSourceHash,
  configContract,
  ruleSetHash,
}) => {
  const producer = {
    reactDoctorRepository,
    reactDoctorCommit,
    evaluatorSourceHash,
    configContract,
    ruleSetHash,
    ruleKeys: [],
  };
  validateProducer(producer, "expected producer");
  return producer;
};

const canonicalizeProjectTuple = (repository, description) => {
  assertExactKeys(repository, PROJECT_KEYS, description);
  for (const key of PROJECT_KEYS) {
    assertNonemptyString(repository[key], `${description}.${key}`);
  }
  if (!GIT_COMMIT_PATTERN.test(repository.ref)) {
    throw new Error(`${description}.ref must be a 40-character commit`);
  }
  return [repository.org, repository.name, repository.ref, repository.rootDir];
};

const buildProjectSet = (repositories, description) => {
  if (!Array.isArray(repositories) || repositories.length === 0) {
    throw new Error(`${description} must be a nonempty array`);
  }
  const tupleKeys = repositories.map((repository, index) =>
    JSON.stringify(canonicalizeProjectTuple(repository, `${description}[${index}]`)),
  );
  const uniqueTupleKeys = new Set(tupleKeys);
  if (uniqueTupleKeys.size !== tupleKeys.length) {
    throw new Error(`${description} contains duplicate project tuples`);
  }
  return [...uniqueTupleKeys].sort(compareStrings).map((tupleKey) => JSON.parse(tupleKey));
};

const loadCorpusManifest = async (manifestPath) => {
  const contents = await readFile(manifestPath);
  let repositories;
  try {
    repositories = JSON.parse(contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Corpus manifest is not valid JSON: ${error.message}`);
  }
  const projectSet = buildProjectSet(repositories, "corpus manifest");
  return {
    manifestSha256: hashBytes(contents),
    projectCount: projectSet.length,
    projectSet,
    projectSetSha256: hashCanonicalValue(projectSet),
  };
};

const scanBaseline = async ({ baselinePath, expectedProducer }) => {
  const artifactHash = createHash("sha256");
  const decoder = new StringDecoder("utf8");
  const repositories = [];
  let byteLength = 0;
  let bufferedText = "";
  let recordCount = 0;

  const consumeLine = (line) => {
    if (line.trim().length === 0) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`Baseline record ${recordCount + 1} is not valid JSON: ${error.message}`);
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Baseline record ${recordCount + 1} must be an object`);
    }
    const recordNumber = recordCount + 1;
    validateProducer(record.evaluation, `baseline record ${recordNumber}.evaluation`);
    if (serializeCanonicalValue(record.evaluation) !== serializeCanonicalValue(expectedProducer)) {
      throw new Error(
        `Baseline record ${recordNumber} producer provenance does not match expected`,
      );
    }
    if (record.evaluation.ruleKeys.length !== 0) {
      throw new Error(`Baseline record ${recordNumber} is not a full baseline`);
    }
    repositories.push(record.repository);
    recordCount = recordNumber;
  };

  for await (const chunk of createReadStream(baselinePath)) {
    artifactHash.update(chunk);
    byteLength += chunk.byteLength;
    bufferedText += decoder.write(chunk);
    let newlineIndex = bufferedText.indexOf("\n");
    while (newlineIndex !== -1) {
      consumeLine(bufferedText.slice(0, newlineIndex));
      bufferedText = bufferedText.slice(newlineIndex + 1);
      newlineIndex = bufferedText.indexOf("\n");
    }
  }
  bufferedText += decoder.end();
  if (bufferedText.length !== 0) consumeLine(bufferedText);
  if (recordCount === 0) throw new Error("Baseline must contain at least one record");

  const projectSet = buildProjectSet(repositories, "baseline");
  return {
    artifact: {
      sha256: artifactHash.digest("hex"),
      byteLength,
      recordCount,
    },
    projectSet,
    projectSetSha256: hashCanonicalValue(projectSet),
  };
};

const assertProjectSetsMatch = (baseline, corpus) => {
  if (
    baseline.projectSetSha256 !== corpus.projectSetSha256 ||
    serializeCanonicalValue(baseline.projectSet) !== serializeCanonicalValue(corpus.projectSet)
  ) {
    throw new Error("Baseline project tuple set does not exactly match the corpus manifest");
  }
};

const buildProvenance = ({ baseline, corpus, producer }) => ({
  schemaVersion: PROVENANCE_SCHEMA_VERSION,
  artifact: baseline.artifact,
  corpus: {
    manifestSha256: corpus.manifestSha256,
    projectSetSha256: corpus.projectSetSha256,
    projectCount: corpus.projectCount,
  },
  producer,
});

const writeProvenance = async (provenancePath, provenance) => {
  const temporaryPath = `${provenancePath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(provenance, null, 2)}\n`, {
    flag: "wx",
  });
  await rename(temporaryPath, provenancePath);
};

export const createBaselineCacheProvenance = async ({
  baselinePath,
  corpusManifestPath,
  provenancePath = getDefaultProvenancePath(baselinePath),
  reactDoctorRepository,
  reactDoctorCommit,
  evaluatorSourceHash,
  configContract,
  ruleSetHash,
}) => {
  const producer = buildExpectedProducer({
    reactDoctorRepository,
    reactDoctorCommit,
    evaluatorSourceHash,
    configContract,
    ruleSetHash,
  });
  const [baseline, corpus] = await Promise.all([
    scanBaseline({ baselinePath, expectedProducer: producer }),
    loadCorpusManifest(corpusManifestPath),
  ]);
  assertProjectSetsMatch(baseline, corpus);
  const provenance = buildProvenance({ baseline, corpus, producer });
  await writeProvenance(provenancePath, provenance);
  return provenance;
};

const validateProvenance = (provenance) => {
  assertExactKeys(provenance, ["artifact", "corpus", "producer", "schemaVersion"], "provenance");
  if (provenance.schemaVersion !== PROVENANCE_SCHEMA_VERSION) {
    throw new Error(`Unsupported provenance schema version: ${provenance.schemaVersion}`);
  }
  assertExactKeys(
    provenance.artifact,
    ["byteLength", "recordCount", "sha256"],
    "provenance.artifact",
  );
  assertExactKeys(
    provenance.corpus,
    ["manifestSha256", "projectCount", "projectSetSha256"],
    "provenance.corpus",
  );
  assertSha256(provenance.artifact.sha256, "provenance.artifact.sha256");
  assertPositiveSafeInteger(provenance.artifact.byteLength, "provenance.artifact.byteLength");
  assertPositiveSafeInteger(provenance.artifact.recordCount, "provenance.artifact.recordCount");
  assertSha256(provenance.corpus.manifestSha256, "provenance.corpus.manifestSha256");
  assertSha256(provenance.corpus.projectSetSha256, "provenance.corpus.projectSetSha256");
  assertPositiveSafeInteger(provenance.corpus.projectCount, "provenance.corpus.projectCount");
  validateProducer(provenance.producer, "provenance.producer");
};

const assertExactValue = (actual, expected, description) => {
  if (serializeCanonicalValue(actual) !== serializeCanonicalValue(expected)) {
    throw new Error(`${description} does not match`);
  }
};

export const verifyBaselineCacheProvenance = async ({
  baselinePath,
  corpusManifestPath,
  provenancePath = getDefaultProvenancePath(baselinePath),
  reactDoctorRepository,
  reactDoctorCommit,
  evaluatorSourceHash,
  configContract,
  ruleSetHash,
}) => {
  const expectedProducer = buildExpectedProducer({
    reactDoctorRepository,
    reactDoctorCommit,
    evaluatorSourceHash,
    configContract,
    ruleSetHash,
  });
  const provenanceContents = await readFile(provenancePath, "utf8");
  let provenance;
  try {
    provenance = JSON.parse(provenanceContents);
  } catch (error) {
    throw new Error(`Provenance is not valid JSON: ${error.message}`);
  }
  validateProvenance(provenance);
  assertExactValue(provenance.producer, expectedProducer, "Provenance producer");

  const [baseline, corpus] = await Promise.all([
    scanBaseline({ baselinePath, expectedProducer }),
    loadCorpusManifest(corpusManifestPath),
  ]);
  assertProjectSetsMatch(baseline, corpus);
  assertExactValue(provenance.artifact, baseline.artifact, "Raw baseline artifact");
  assertExactValue(
    provenance.corpus,
    {
      manifestSha256: corpus.manifestSha256,
      projectSetSha256: corpus.projectSetSha256,
      projectCount: corpus.projectCount,
    },
    "Corpus provenance",
  );
  return provenance;
};

const parseCliArguments = (argumentsList) => {
  const [mode, ...optionArguments] = argumentsList;
  if (mode !== "create" && mode !== "verify") {
    throw new Error("Usage: baseline-cache-provenance.mjs <create|verify> [options]");
  }
  const options = {};
  for (let index = 0; index < optionArguments.length; index += OPTION_ARGUMENT_STRIDE) {
    const option = optionArguments[index];
    const value = optionArguments[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid option near ${option ?? "<end>"}`);
    }
    const optionName = option.slice(OPTION_PREFIX_LENGTH);
    if (!ALLOWED_OPTIONS.has(optionName)) throw new Error(`Unknown option: ${option}`);
    if (options[optionName] !== undefined) throw new Error(`Duplicate option: ${option}`);
    options[optionName] = value;
  }
  for (const requiredOption of REQUIRED_OPTIONS) {
    if (options[requiredOption] === undefined) {
      throw new Error(`Missing required option: --${requiredOption}`);
    }
  }
  const baselinePath = resolve(options.baseline);
  return {
    mode,
    input: {
      baselinePath,
      corpusManifestPath: resolve(options["corpus-manifest"]),
      provenancePath:
        options.provenance === undefined
          ? getDefaultProvenancePath(baselinePath)
          : resolve(options.provenance),
      reactDoctorCommit: options["base-commit"],
      reactDoctorRepository: options.repository,
      evaluatorSourceHash: options["evaluator-source-hash"],
      configContract: options["config-contract"],
      ruleSetHash: options["rule-set-hash"],
    },
  };
};

const main = async () => {
  const { mode, input } = parseCliArguments(process.argv.slice(PROCESS_ARGUMENT_START_INDEX));
  const provenance =
    mode === "create"
      ? await createBaselineCacheProvenance(input)
      : await verifyBaselineCacheProvenance(input);
  process.stdout.write(`${JSON.stringify(provenance)}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
