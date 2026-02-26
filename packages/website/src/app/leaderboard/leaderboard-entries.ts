interface LeaderboardEntry {
  name: string;
  githubUrl: string;
  packageName: string;
  score: number;
  errorCount: number;
  warningCount: number;
  fileCount: number;
}

const buildShareUrl = (entry: LeaderboardEntry): string => {
  const searchParams = new URLSearchParams({
    p: entry.packageName,
    s: String(entry.score),
    e: String(entry.errorCount),
    w: String(entry.warningCount),
    f: String(entry.fileCount),
  });
  return `/share?${searchParams.toString()}`;
};

const RAW_ENTRIES: LeaderboardEntry[] = [
  {
    name: "tldraw",
    githubUrl: "https://github.com/tldraw/tldraw",
    packageName: "tldraw",
    score: 84,
    errorCount: 98,
    warningCount: 139,
    fileCount: 40,
  },
  {
    name: "excalidraw",
    githubUrl: "https://github.com/excalidraw/excalidraw",
    packageName: "@excalidraw/excalidraw",
    score: 84,
    errorCount: 2,
    warningCount: 196,
    fileCount: 80,
  },
  {
    name: "twenty",
    githubUrl: "https://github.com/twentyhq/twenty",
    packageName: "twenty-front",
    score: 78,
    errorCount: 99,
    warningCount: 293,
    fileCount: 268,
  },
  {
    name: "plane",
    githubUrl: "https://github.com/makeplane/plane",
    packageName: "web",
    score: 78,
    errorCount: 7,
    warningCount: 525,
    fileCount: 292,
  },
  {
    name: "formbricks",
    githubUrl: "https://github.com/formbricks/formbricks",
    packageName: "@formbricks/web",
    score: 75,
    errorCount: 15,
    warningCount: 389,
    fileCount: 242,
  },
  {
    name: "posthog",
    githubUrl: "https://github.com/PostHog/posthog",
    packageName: "@posthog/frontend",
    score: 72,
    errorCount: 82,
    warningCount: 1177,
    fileCount: 585,
  },
  {
    name: "supabase",
    githubUrl: "https://github.com/supabase/supabase",
    packageName: "studio",
    score: 69,
    errorCount: 74,
    warningCount: 1087,
    fileCount: 566,
  },
  {
    name: "onlook",
    githubUrl: "https://github.com/onlook-dev/onlook",
    packageName: "@onlook/web-client",
    score: 69,
    errorCount: 64,
    warningCount: 418,
    fileCount: 178,
  },
  {
    name: "payload",
    githubUrl: "https://github.com/payloadcms/payload",
    packageName: "@payloadcms/ui",
    score: 68,
    errorCount: 139,
    warningCount: 408,
    fileCount: 298,
  },
  {
    name: "sentry",
    githubUrl: "https://github.com/getsentry/sentry",
    packageName: "sentry",
    score: 64,
    errorCount: 94,
    warningCount: 1345,
    fileCount: 818,
  },
  {
    name: "cal.com",
    githubUrl: "https://github.com/calcom/cal.com",
    packageName: "@calcom/web",
    score: 63,
    errorCount: 31,
    warningCount: 558,
    fileCount: 311,
  },
  {
    name: "dub",
    githubUrl: "https://github.com/dubinc/dub",
    packageName: "web",
    score: 62,
    errorCount: 52,
    warningCount: 966,
    fileCount: 457,
  },
  {
    name: "nodejs.org",
    githubUrl: "https://github.com/nodejs/node",
    packageName: "@node-core/website",
    score: 88,
    errorCount: 9,
    warningCount: 169,
    fileCount: 169,
  },
];

export interface ResolvedLeaderboardEntry extends LeaderboardEntry {
  shareUrl: string;
}

export const LEADERBOARD_ENTRIES: ResolvedLeaderboardEntry[] = RAW_ENTRIES.sort(
  (entryA, entryB) => entryB.score - entryA.score,
).map((entry) => ({ ...entry, shareUrl: buildShareUrl(entry) }));
