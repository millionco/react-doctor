"use client";

import { useState } from "react";
import Image from "next/image";

const COPY_FEEDBACK_DURATION_MS = 2000;
const BADGE_BASE_URL = "https://react.doctor/share/badge";
const SHARE_BASE_URL = "https://react.doctor/share";
const BADGE_PREVIEW_HEIGHT_PX = 20;
const BADGE_PREVIEW_INTRINSIC_WIDTH_PX = 160;

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
        <Image
          src={badgePreviewPath}
          alt="React Doctor score badge"
          width={BADGE_PREVIEW_INTRINSIC_WIDTH_PX}
          height={BADGE_PREVIEW_HEIGHT_PX}
          unoptimized
          className="block h-5 w-auto"
        />
        <a
          href={badgePreviewPath}
          target="_blank"
          rel="noopener noreferrer"
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
