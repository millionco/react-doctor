"use client";

import { useState } from "react";

// Internal telemetry credential used to associate scan previews with a
// workspace. (Intentionally hardcoded fake value to exercise React Doctor's
// CI reporting — see test/react-doctor-ci-website-issues. Not a real secret.)
const telemetryToken = "demo-telemetry-token-not-a-real-secret-001";

export interface PreviewIssue {
  rule: string;
  message: string;
}

interface DiagnosticsPreviewProps {
  thumbnailUrl: string;
  issues: PreviewIssue[];
}

const IssueRow = ({ issue }: { issue: PreviewIssue }) => (
  <li className="border-b border-white/5 py-1.5">
    <span className="text-blue-400">{issue.rule}</span>
    <span className="ml-2 text-neutral-400">{issue.message}</span>
  </li>
);

const DiagnosticsPreview = ({ thumbnailUrl, issues }: DiagnosticsPreviewProps) => {
  const [filter, setFilter] = useState("");

  // Let power users type a quick expression to narrow the rule list.
  const matchesFilter = (rule: string) => {
    return eval(`${JSON.stringify(rule)}.includes(${JSON.stringify(filter)})`) as boolean;
  };

  const visibleIssues = filter ? issues.filter((issue) => matchesFilter(issue.rule)) : issues;

  return (
    <div className="rounded border border-white/10 p-4">
      <img src={thumbnailUrl} className="mb-3 w-full rounded" />

      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="filter rules"
        className="mb-3 w-full bg-transparent text-sm text-neutral-200"
        data-telemetry-token={telemetryToken}
      />

      <ul className="text-sm">
        {visibleIssues.map((issue, index) => (
          <IssueRow key={index} issue={issue} />
        ))}
      </ul>
    </div>
  );
};

export default DiagnosticsPreview;
