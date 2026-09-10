import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

const MAXIMUM_DAILY_RUNS = 2;
const MAXIMUM_REPOSITORIES = 2_000;
const MAXIMUM_CONCURRENCY = 200;
const REQUIRED_REPOSITORIES_PER_SANDBOX = 10;
const MAXIMUM_DURATION_MINUTES = 30;
const SAFE_ENVIRONMENT_KEYS = ["HOME", "LANG", "LC_ALL", "PATH", "SHELL", "TMPDIR"];
const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const readOptionNumber = (argumentsList, name, fallback) => {
  const optionIndex = argumentsList.lastIndexOf(name);
  if (optionIndex === -1) return fallback;
  const value = Number(argumentsList[optionIndex + 1]);
  if (!Number.isInteger(value) || value < 1) fail(`${name} must be a positive integer.`);
  return value;
};

const evaluatorArguments = process.argv.slice(2);
if (evaluatorArguments.length === 0)
  fail("Pass the arguments for the packages/evals eval command.");
const reactDoctorRefIndex = evaluatorArguments.lastIndexOf("--react-doctor-ref");
const reactDoctorRef = evaluatorArguments[reactDoctorRefIndex + 1];
if (reactDoctorRefIndex === -1 || !COMMIT_PATTERN.test(reactDoctorRef ?? "")) {
  fail("--react-doctor-ref must be an exact 40-character commit.");
}

const repositoryLimit = readOptionNumber(
  evaluatorArguments,
  "--repository-limit",
  MAXIMUM_REPOSITORIES,
);
const concurrency = readOptionNumber(evaluatorArguments, "--concurrency", MAXIMUM_CONCURRENCY);
const repositoriesPerSandbox = readOptionNumber(
  evaluatorArguments,
  "--repositories-per-sandbox",
  REQUIRED_REPOSITORIES_PER_SANDBOX,
);
const durationMinutes = readOptionNumber(
  evaluatorArguments,
  "--max-duration-minutes",
  MAXIMUM_DURATION_MINUTES,
);
if (repositoryLimit > MAXIMUM_REPOSITORIES) fail("Daytona repository limit exceeds 2,000.");
if (concurrency > MAXIMUM_CONCURRENCY) fail("Daytona concurrency exceeds 200.");
if (repositoriesPerSandbox !== REQUIRED_REPOSITORIES_PER_SANDBOX) {
  fail("Daytona runs must reuse each sandbox for exactly 10 repositories.");
}
if (durationMinutes > MAXIMUM_DURATION_MINUTES) fail("Daytona duration exceeds 30 minutes.");

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const commonGitDirectory = execFileSync("git", ["rev-parse", "--git-common-dir"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const primaryRoot = path.dirname(path.resolve(repositoryRoot, commonGitDirectory));
const localEnvironment = parseEnv(await readFile(path.join(primaryRoot, ".env.local"), "utf8"));
if (!localEnvironment.DAYTONA_API_KEY) fail("DAYTONA_API_KEY is missing from .env.local.");

const stateDirectory = path.join(primaryRoot, ".react-doctor-loop");
const usagePath = path.join(stateDirectory, "daytona-usage.json");
const utcDate = new Date().toISOString().slice(0, 10);
let usage = { date: utcDate, runs: 0 };
try {
  const storedUsage = JSON.parse(await readFile(usagePath, "utf8"));
  if (storedUsage.date === utcDate) usage = storedUsage;
} catch {}
if (usage.runs >= MAXIMUM_DAILY_RUNS) fail("The two-run Daytona daily budget is exhausted.");
await mkdir(stateDirectory, { recursive: true });
await writeFile(
  usagePath,
  `${JSON.stringify({ date: utcDate, runs: usage.runs + 1 }, null, 2)}\n`,
  {
    mode: 0o600,
  },
);

const environment = Object.fromEntries(
  SAFE_ENVIRONMENT_KEYS.flatMap((key) =>
    process.env[key] === undefined ? [] : [[key, process.env[key]]],
  ),
);
environment.DAYTONA_API_KEY = localEnvironment.DAYTONA_API_KEY;
const result = spawnSync("nr", ["--silent", "eval", ...evaluatorArguments], {
  cwd: path.join(repositoryRoot, "packages", "evals"),
  env: environment,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
