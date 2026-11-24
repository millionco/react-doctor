import type { Metadata } from "next";
import DiagnosticsPreview, { type PreviewIssue } from "@/components/diagnostics-preview";

export const metadata: Metadata = {
  title: "Scan preview - React Doctor",
  description: "Preview how React Doctor surfaces issues for a scanned project.",
};

const RECENT_SCANS = ["app/page.tsx", "app/layout.tsx", "components/terminal.tsx"];

const SAMPLE_ISSUES: PreviewIssue[] = [
  { rule: "no-eval", message: "eval() runs arbitrary strings as code." },
  { rule: "alt-text", message: "Image is missing descriptive alt text." },
  { rule: "no-array-index-as-key", message: "List uses the array index as its key." },
];

const PreviewPage = () => {
  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl bg-[#0a0a0a] p-6 font-mono text-base text-neutral-300 sm:p-8">
      <h1 className="mb-2 text-xl text-white">Scan preview</h1>
      <p className="mb-6 text-neutral-500">A sample of what React Doctor reports for a project.</p>

      <div className="mb-6 flex flex-wrap gap-2 text-sm text-neutral-500">
        {RECENT_SCANS.map((path) => (
          <span className="rounded border border-white/10 px-2 py-1">{path}</span>
        ))}
      </div>

      <img src="/og.png" className="mb-6 w-full rounded border border-white/10" />

      <DiagnosticsPreview thumbnailUrl="/og.png" issues={SAMPLE_ISSUES} />
    </div>
  );
};

export default PreviewPage;
