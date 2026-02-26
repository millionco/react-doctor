"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

const AMI_DEEPLINK_PREFIX = "ami://open-project";
const AMI_RELEASES_URL = "https://github.com/millionco/ami-releases/releases";
const REDIRECT_DELAY_MS = 500;

const OpenPageContent = () => {
  const searchParams = useSearchParams();
  const deeplink = `${AMI_DEEPLINK_PREFIX}?${searchParams.toString()}`;
  const [didAttemptOpen, setDidAttemptOpen] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      window.location.href = deeplink;
      setDidAttemptOpen(true);
    }, REDIRECT_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [deeplink]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center bg-[#0a0a0a] p-6 font-mono text-base leading-relaxed text-neutral-300 sm:p-8 sm:text-lg">
      <pre className="mb-6 text-green-400 leading-tight">
        {`  ┌─────┐\n  │ ◠ ◠ │\n  │  ▽  │\n  └─────┘`}
      </pre>

      <div className="mb-8 text-center">
        <h1 className="mb-2 text-xl text-white">Opening Ami...</h1>
        <p className="text-neutral-500">
          {didAttemptOpen
            ? "If Ami didn\u2019t open, it may not be installed."
            : "Redirecting to Ami to fix react-doctor issues."}
        </p>
      </div>

      {didAttemptOpen && (
        <div className="flex flex-col items-center gap-4">
          <a
            href={AMI_RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 border border-white/20 bg-white px-4 py-2 text-black transition-all hover:bg-white/90 active:scale-[0.98]"
          >
            Download Ami
          </a>

          <div className="mt-4 text-center">
            <p className="mb-2 text-sm text-neutral-500">Or open manually:</p>
            <a
              href={deeplink}
              className="break-all text-sm text-blue-400 underline underline-offset-2 hover:text-blue-300"
            >
              Open deeplink
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

const OpenPage = () => (
  <Suspense
    fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] font-mono text-neutral-500">
        Loading...
      </div>
    }
  >
    <OpenPageContent />
  </Suspense>
);

export default OpenPage;
