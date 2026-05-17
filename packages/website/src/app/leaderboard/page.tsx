import type { Metadata } from "next";
import Link from "next/link";
import { PERFECT_SCORE } from "@/constants";
import { clampScore } from "@/utils/clamp-score";
import { getDoctorFace } from "@/utils/get-doctor-face";
import { getScoreColorClass } from "@/utils/get-score-color-class";

const SCORE_BAR_WIDTH = 20;
const REVALIDATE_SECONDS = 60 * 60;
const COMMAND = "npx react-doctor@latest";
const BENCHMARKS_REPO_URL = "https://github.com/millionco/react-doctor-benchmarks";
const LEADERBOARD_URL =
  "https://raw.githubusercontent.com/millionco/react-doctor-benchmarks/main/results/leaderboard.json";
const BOX_TOP = "\u250C\u2500\u2500\u2500\u2500\u2500\u2510";
const BOX_BOTTOM = "\u2514\u2500\u2500\u2500\u2500\u2500\u2518";

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

export const metadata: Metadata = {
  title: "Leaderboard - React Doctor",
  description:
    "Scores for popular open-source React projects, diagnosed by React Doctor. Updated automatically from public benchmarks.",
};

const formatGeneratedAt = (isoTimestamp: string): string => {
  const parsedDate = new Date(isoTimestamp);
  if (Number.isNaN(parsedDate.getTime())) return isoTimestamp;
  return `${parsedDate.toISOString().replace("T", " ").slice(0, 16)} UTC`;
};

const fetchLeaderboard = async (): Promise<LeaderboardFile | null> => {
  try {
    const response = await fetch(LEADERBOARD_URL, { next: { revalidate: REVALIDATE_SECONDS } });
    if (!response.ok) return null;
    return (await response.json()) as LeaderboardFile;
  } catch {
    return null;
  }
};

const ScoreBar = ({ score }: { score: number }) => {
  const clampedScore = clampScore(score);
  const filledCount = Math.round((clampedScore / PERFECT_SCORE) * SCORE_BAR_WIDTH);
  const emptyCount = SCORE_BAR_WIDTH - filledCount;
  const colorClass = getScoreColorClass(clampedScore);

  return (
    <span className="text-xs sm:text-sm">
      <span className={colorClass}>{"\u2588".repeat(filledCount)}</span>
      <span className="text-neutral-700">{"\u2591".repeat(emptyCount)}</span>
    </span>
  );
};

const LeaderboardRow = ({ entry, rank }: { entry: LeaderboardEntry; rank: number }) => {
  const colorClass = getScoreColorClass(entry.score);

  return (
    <div className="group grid grid-cols-[2rem_1fr_auto] items-center border-b border-white/5 py-2 transition-colors hover:bg-white/2 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto] sm:py-2.5">
      <span className="text-right text-neutral-600">{rank}</span>

      <a
        href={entry.githubUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-2 truncate text-white transition-colors hover:text-blue-400 sm:ml-4"
      >
        {entry.name}
        <span className="ml-2 hidden text-sm text-neutral-500 sm:inline">{entry.packageName}</span>
      </a>

      <span className="ml-4 hidden sm:inline">
        <ScoreBar score={entry.score} />
      </span>

      <span className="ml-4 text-right">
        <span className={`${colorClass} font-medium`}>{entry.score}</span>
        <span className="text-neutral-600">/{PERFECT_SCORE}</span>
      </span>
    </div>
  );
};

const LeaderboardPage = async () => {
  const leaderboard = await fetchLeaderboard();
  const sortedEntries = leaderboard
    ? leaderboard.entries.toSorted((leftEntry, rightEntry) => rightEntry.score - leftEntry.score)
    : [];
  const topScore = sortedEntries[0]?.score ?? 0;
  const [eyes, mouth] = getDoctorFace(topScore);
  const topScoreColor = getScoreColorClass(topScore);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-[#0a0a0a] p-6 pb-32 font-mono text-base leading-relaxed text-neutral-300 sm:p-8 sm:pb-40 sm:text-lg">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-neutral-500 transition-colors hover:text-neutral-300"
        >
          <img src="/favicon.svg" alt="React Doctor" width={20} height={20} />
          <span>react-doctor</span>
        </Link>
      </div>

      {leaderboard && (
        <div className="mb-2">
          <pre className={`${topScoreColor} leading-tight`}>
            {`  ${BOX_TOP}\n  \u2502 ${eyes} \u2502\n  \u2502 ${mouth} \u2502\n  ${BOX_BOTTOM}`}
          </pre>
        </div>
      )}

      <div className="mb-1 text-xl text-white">Leaderboard</div>
      <div className="mb-2 text-neutral-500">Scores for popular open-source React projects.</div>

      {leaderboard && (
        <div className="mb-8 text-sm text-neutral-600">
          {sortedEntries.length} repos scanned with v{leaderboard.doctorVersion} on{" "}
          {formatGeneratedAt(leaderboard.generatedAt)}.
        </div>
      )}

      {leaderboard ? (
        <div className="mb-8">
          {sortedEntries.map((entry, innerIndex) => (
            <LeaderboardRow key={entry.slug} entry={entry} rank={innerIndex + 1} />
          ))}
        </div>
      ) : (
        <div className="mb-8 text-red-400">
          Could not load the leaderboard right now. Check{" "}
          <a
            href={BENCHMARKS_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-red-300"
          >
            the benchmarks repo
          </a>
          .
        </div>
      )}

      <div className="min-h-[1.4em]" />

      <div className="text-neutral-500">Run it on your codebase:</div>
      <div className="mt-2">
        <span className="border border-white/20 px-3 py-1.5 text-white">{COMMAND}</span>
      </div>

      <div className="min-h-[1.4em]" />
      <div className="min-h-[1.4em]" />

      <div className="text-neutral-500">
        {"+ "}
        <a
          href={BENCHMARKS_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-green-400 transition-colors hover:text-green-300 hover:underline"
        >
          Add your project
        </a>
        <span className="text-neutral-600">{" - open a PR on react-doctor-benchmarks"}</span>
      </div>
    </div>
  );
};

export default LeaderboardPage;
