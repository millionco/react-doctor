import type { Metadata } from "next";
import AnimatedScore from "./animated-score";
import BadgeSnippet from "./badge-snippet";

const PERFECT_SCORE = 100;
const SCORE_GOOD_THRESHOLD = 75;
const SCORE_OK_THRESHOLD = 50;
const COMMAND = "npx -y react-doctor@latest .";
const FIX_COMMAND = "npx -y react-doctor@latest . --fix";
const SHARE_BASE_URL = "https://www.react.doctor/share";
const X_ICON_PATH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const LINKEDIN_ICON_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

interface ShareSearchParams {
  p?: string;
  s?: string;
  e?: string;
  w?: string;
  f?: string;
}

const clampScore = (value: number): number => Math.max(0, Math.min(PERFECT_SCORE, value));

const getScoreLabel = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "Great";
  if (score >= SCORE_OK_THRESHOLD) return "Needs work";
  return "Critical";
};

const getScoreColorClass = (score: number): string => {
  if (score >= SCORE_GOOD_THRESHOLD) return "text-green-400";
  if (score >= SCORE_OK_THRESHOLD) return "text-yellow-500";
  return "text-red-400";
};

const getDoctorFace = (score: number): [string, string] => {
  if (score >= SCORE_GOOD_THRESHOLD) return ["\u25E0 \u25E0", " \u25BD "];
  if (score >= SCORE_OK_THRESHOLD) return ["\u2022 \u2022", " \u2500 "];
  return ["x x", " \u25BD "];
};

const DoctorFace = ({ score }: { score: number }) => {
  const [eyes, mouth] = getDoctorFace(score);
  const colorClass = getScoreColorClass(score);

  return (
    <pre className={`${colorClass} leading-tight`}>
      {`  \u250C\u2500\u2500\u2500\u2500\u2500\u2510\n  \u2502 ${eyes} \u2502\n  \u2502 ${mouth} \u2502\n  \u2514\u2500\u2500\u2500\u2500\u2500\u2518`}
    </pre>
  );
};

export const generateMetadata = async ({
  searchParams,
}: {
  searchParams: Promise<ShareSearchParams>;
}): Promise<Metadata> => {
  const resolvedParams = await searchParams;
  const projectName = resolvedParams.p ?? null;
  const score = clampScore(Number(resolvedParams.s) || 0);
  const errorCount = Math.max(0, Number(resolvedParams.e) || 0);
  const warningCount = Math.max(0, Number(resolvedParams.w) || 0);
  const label = getScoreLabel(score);

  const titlePrefix = projectName ? `${projectName} - ` : "";
  const title = `React Doctor - ${titlePrefix}Score: ${score}/100 (${label})`;
  const descriptionParts: string[] = [];
  if (errorCount > 0) descriptionParts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  if (warningCount > 0)
    descriptionParts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  const description =
    descriptionParts.length > 0
      ? `${descriptionParts.join(", ")} found. Run react-doctor on your codebase to find React issues.`
      : "Run react-doctor on your codebase to find React issues.";

  const ogSearchParams = new URLSearchParams();
  if (resolvedParams.p) ogSearchParams.set("p", resolvedParams.p);
  if (resolvedParams.s) ogSearchParams.set("s", resolvedParams.s);
  if (resolvedParams.e) ogSearchParams.set("e", resolvedParams.e);
  if (resolvedParams.w) ogSearchParams.set("w", resolvedParams.w);
  if (resolvedParams.f) ogSearchParams.set("f", resolvedParams.f);
  const ogImageUrl = `/share/og?${ogSearchParams.toString()}`;

  return {
    title,
    description,
    openGraph: { title, description, images: [ogImageUrl] },
    twitter: { card: "summary_large_image", title, description, images: [ogImageUrl] },
  };
};

const SharePage = async ({ searchParams }: { searchParams: Promise<ShareSearchParams> }) => {
  const resolvedParams = await searchParams;
  const projectName = resolvedParams.p ?? null;
  const score = clampScore(Number(resolvedParams.s) || 0);
  const errorCount = Math.max(0, Number(resolvedParams.e) || 0);
  const warningCount = Math.max(0, Number(resolvedParams.w) || 0);
  const fileCount = Math.max(0, Number(resolvedParams.f) || 0);
  const label = getScoreLabel(score);

  const shareSearchParams = new URLSearchParams();
  if (resolvedParams.p) shareSearchParams.set("p", resolvedParams.p);
  if (resolvedParams.s) shareSearchParams.set("s", resolvedParams.s);
  if (resolvedParams.e) shareSearchParams.set("e", resolvedParams.e);
  if (resolvedParams.w) shareSearchParams.set("w", resolvedParams.w);
  if (resolvedParams.f) shareSearchParams.set("f", resolvedParams.f);
  const shareUrl = `${SHARE_BASE_URL}?${shareSearchParams.toString()}`;

  const projectLabel = projectName ? `${projectName} ` : "My React codebase ";
  const tweetText = `${projectLabel}scored ${score}/100 (${label}) on React Doctor. Run it on yours:`;
  const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(shareUrl)}`;
  const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-[#0a0a0a] p-6 pb-32 font-mono text-base leading-relaxed text-neutral-300 sm:p-8 sm:pb-40 sm:text-lg">
      <div className="mb-6">
        {projectName && <div className="mb-4 text-xl text-white">{projectName}</div>}
        <DoctorFace score={score} />
        <div className="mt-2 text-neutral-500">
          React Doctor <span className="text-neutral-600">(www.react.doctor)</span>
        </div>
      </div>

      <AnimatedScore targetScore={score} />

      {(errorCount > 0 || warningCount > 0 || fileCount > 0) && (
        <div className="mb-8 pl-2">
          {errorCount > 0 && (
            <span className="text-red-400">
              {errorCount} error{errorCount === 1 ? "" : "s"}
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-yellow-500">
              {"  "}
              {warningCount} warning{warningCount === 1 ? "" : "s"}
            </span>
          )}
          {fileCount > 0 && (
            <span className="text-neutral-500">
              {"  "}across {fileCount} file{fileCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

      <div className="text-neutral-500">Run it on your codebase:</div>
      <div className="mt-2">
        <span className="border border-white/20 px-3 py-1.5 text-white">{COMMAND}</span>
      </div>

      <div className="mt-6 text-neutral-500">Auto-fix with Ami:</div>
      <div className="mt-2">
        <span className="border border-white/20 px-3 py-1.5 text-white">{FIX_COMMAND}</span>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a
          href={twitterShareUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap border border-white/20 bg-white px-3 py-1.5 text-black transition-all hover:bg-white/90 active:scale-[0.98]"
        >
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d={X_ICON_PATH} />
          </svg>
          Share on X
        </a>
        <a
          href={linkedinShareUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap border border-white/20 bg-white px-3 py-1.5 text-black transition-all hover:bg-white/90 active:scale-[0.98]"
        >
          <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
            <path d={LINKEDIN_ICON_PATH} />
          </svg>
          Share on LinkedIn
        </a>
      </div>

      <BadgeSnippet searchParamsString={shareSearchParams.toString()} />
    </div>
  );
};

export default SharePage;
