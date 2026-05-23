import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LEADERBOARD_URL =
  "https://raw.githubusercontent.com/millionco/react-doctor-benchmarks/main/results/leaderboard.json";
const LEADERBOARD_TOP_COUNT = 10;
const MARKER_START = "<!-- LEADERBOARD:START -->";
const MARKER_END = "<!-- LEADERBOARD:END -->";

interface LeaderboardEntry {
  slug: string;
  name: string;
  githubUrl: string;
  packageName: string;
  score: number;
  errorCount: number;
  warningCount: number;
  fileCount: number;
  commitSha: string;
  scannedAt: string;
}

interface LeaderboardFile {
  schemaVersion: number;
  generatedAt: string;
  doctorVersion: string;
  source: { repo: string; path: string; docs: string };
  entries: LeaderboardEntry[];
}

const fetchLeaderboard = async (): Promise<LeaderboardFile> => {
  const response = await fetch(LEADERBOARD_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as LeaderboardFile;
};

const isSafeGithubUrl = (candidate: unknown): candidate is string => {
  if (typeof candidate !== "string") return false;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" && parsed.host === "github.com";
  } catch {
    return false;
  }
};

const escapeMarkdownTableCell = (text: string): string =>
  text
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("`", "\\`")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll(/[\r\n]+/g, " ");

const renderLeaderboardTable = (entries: LeaderboardEntry[]): string => {
  const header = ["| #  | Repo | Score |", "| -- | ---- | ----: |"];
  const rows = entries
    .filter((entry) => isSafeGithubUrl(entry.githubUrl) && Number.isFinite(entry.score))
    .slice(0, LEADERBOARD_TOP_COUNT)
    .map((entry, innerIndex) => {
      const rank = String(innerIndex + 1).padEnd(2, " ");
      const safeName = escapeMarkdownTableCell(entry.name);
      const safeUrl = encodeURI(entry.githubUrl);
      return `| ${rank} | [${safeName}](${safeUrl}) | ${entry.score} |`;
    });
  return [...header, ...rows].join("\n");
};

const renderLeaderboardSection = (entries: LeaderboardEntry[]): string => {
  const table = renderLeaderboardTable(entries);
  return `${MARKER_START}\n<!-- prettier-ignore -->\n${table}\n\n${MARKER_END}`;
};

const replaceLeaderboardSection = (markdown: string, replacement: string): string => {
  const startIndex = markdown.indexOf(MARKER_START);
  const endIndex = markdown.indexOf(MARKER_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(
      `Leaderboard markers not found in README. Expected ${MARKER_START} ... ${MARKER_END}.`,
    );
  }
  const before = markdown.slice(0, startIndex);
  const after = markdown.slice(endIndex + MARKER_END.length);
  return `${before}${replacement}${after}`;
};

const main = async (): Promise<void> => {
  const leaderboard = await fetchLeaderboard();
  if (!Array.isArray(leaderboard.entries) || leaderboard.entries.length === 0) {
    throw new Error("Leaderboard contains no entries");
  }
  const sortedEntries = leaderboard.entries.toSorted(
    (leftEntry, rightEntry) => rightEntry.score - leftEntry.score,
  );
  const replacement = renderLeaderboardSection(sortedEntries);

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const readmePath = resolve(scriptDirectory, "..", "packages", "react-doctor", "README.md");
  const previousMarkdown = await readFile(readmePath, "utf-8");
  const updatedMarkdown = replaceLeaderboardSection(previousMarkdown, replacement);

  if (previousMarkdown === updatedMarkdown) {
    console.log("Leaderboard already up to date.");
    return;
  }

  await writeFile(readmePath, updatedMarkdown, "utf-8");
  console.log(
    `Updated leaderboard with ${Math.min(LEADERBOARD_TOP_COUNT, sortedEntries.length)} entries.`,
  );
};

await main();
