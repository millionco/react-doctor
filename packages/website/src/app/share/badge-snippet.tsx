"use client";

import { useState } from "react";

const COPY_FEEDBACK_DURATION_MS = 2000;
const BADGE_BASE_URL = "https://www.react.doctor/share/badge";
const SHARE_BASE_URL = "https://www.react.doctor/share";

interface BadgeSnippetProps {
  searchParamsString: string;
}

const BadgeSnippet = ({ searchParamsString }: BadgeSnippetProps) => {
  const [didCopy, setDidCopy] = useState(false);

  const badgeFullUrl = `${BADGE_BASE_URL}?${searchParamsString}`;
  const shareFullUrl = `${SHARE_BASE_URL}?${searchParamsString}`;
  const badgePreviewPath = `/share/badge?${searchParamsString}`;
  const markdownSnippet = `[![React Doctor](${badgeFullUrl})](${shareFullUrl})`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdownSnippet);
    setDidCopy(true);
    setTimeout(() => setDidCopy(false), COPY_FEEDBACK_DURATION_MS);
  };

  return (
    <div className="mt-8">
      <div className="text-neutral-500">Add a badge to your README:</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <img src={badgePreviewPath} alt="React Doctor score badge" height={20} className="block" />
        <a
          href={badgePreviewPath}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-500 underline underline-offset-2 transition-colors hover:text-neutral-300"
        >
          Open SVG
        </a>
      </div>

      <div className="mt-3 flex flex-wrap items-start gap-2">
        <code className="min-w-0 flex-1 break-all border border-white/20 px-3 py-1.5 text-xs text-neutral-300">
          {markdownSnippet}
        </code>
        <button
          type="button"
          onClick={handleCopy}
          className="shrink-0 border border-white/20 px-3 py-1.5 text-xs text-neutral-300 transition-all hover:bg-white/10 active:scale-[0.98]"
        >
          {didCopy ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
};

export default BadgeSnippet;
