import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "License - React Doctor",
  description:
    "React Doctor is free for most uses. AI training and large-scale commercial use require a written license from Million Software, Inc.",
};

const LICENSE_URL =
  "https://github.com/millionco/react-doctor/blob/main/LICENSE";

const PERMITTED: readonly { label: string; detail: string }[] = [
  { label: "Use", detail: "Run react-doctor in any project or pipeline." },
  { label: "Modify", detail: "Fork and change the source for your needs." },
  { label: "Distribute", detail: "Ship it as part of your own tooling." },
  { label: "Sell", detail: "Include it in a commercial product or service." },
];

const REQUIRES_PERMISSION: readonly { label: string; detail: string }[] = [
  {
    label: "AI / ML training",
    detail:
      "Using the source code, outputs, or derivative works as training data, fine-tuning data, or evaluation data for any machine learning model.",
  },
  {
    label: "Automated data collection",
    detail:
      "Feeding react-doctor into a pipeline whose primary purpose is building or improving an AI system.",
  },
];

const Row = ({
  label,
  detail,
  permitted,
}: {
  label: string;
  detail: string;
  permitted: boolean;
}) => (
  <div className="flex gap-4 py-3 border-b border-white/10 last:border-0">
    <span
      className={`mt-0.5 text-xs font-mono shrink-0 w-4 ${permitted ? "text-green-400" : "text-red-400"}`}
    >
      {permitted ? "✓" : "⊘"}
    </span>
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-white font-mono">{label}</span>
      <span className="text-xs text-white/50 leading-relaxed">{detail}</span>
    </div>
  </div>
);

const LicensePage = () => (
  <main className="min-h-screen bg-[#0a0a0a] text-white font-mono px-6 py-16 flex justify-center">
    <div className="w-full max-w-xl flex flex-col gap-10">

      <div className="flex flex-col gap-2">
        <span className="text-xs text-white/40 uppercase tracking-widest">
          Million Software, Inc.
        </span>
        <h1 className="text-2xl text-white">License</h1>
        <p className="text-sm text-white/50 leading-relaxed">
          React Doctor is free for most uses under the{" "}
          <Link
            href={LICENSE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline underline-offset-4 hover:text-white/70 transition-colors"
          >
            react-doctor license
          </Link>
          . AI training use requires written permission.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/30 uppercase tracking-widest mb-2">
          Permitted
        </span>
        <div className="border border-white/10 rounded px-4">
          {PERMITTED.map((item) => (
            <Row key={item.label} {...item} permitted={true} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/30 uppercase tracking-widest mb-2">
          Requires written permission
        </span>
        <div className="border border-white/10 rounded px-4">
          {REQUIRES_PERMISSION.map((item) => (
            <Row key={item.label} {...item} permitted={false} />
          ))}
        </div>
      </div>

      <div className="border border-white/10 rounded p-5 flex flex-col gap-3">
        <p className="text-sm text-white/70 leading-relaxed">
          If your use case requires a commercial license — or if you&apos;re
          unsure whether your use qualifies — reach out. We respond quickly.
        </p>
        <a
          href="mailto:founders@million.dev"
          className="text-sm text-white border border-white/20 rounded px-4 py-2 hover:bg-white hover:text-black transition-colors w-fit"
        >
          founders@million.dev
        </a>
      </div>

      <div className="text-xs text-white/25 leading-relaxed">
        Copyright &copy; 2026 Million Software, Inc. &mdash;{" "}
        <Link
          href={LICENSE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/50 transition-colors underline underline-offset-2"
        >
          Full license text
        </Link>
      </div>

    </div>
  </main>
);

export default LicensePage;
