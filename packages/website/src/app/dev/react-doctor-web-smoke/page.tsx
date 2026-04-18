"use client";

import { useMemo } from "react";
import { calculateScoreLocally } from "react-doctor-web";

const SAMPLE_DIAGNOSTIC = {
  filePath: "/app/page.tsx",
  plugin: "react-doctor",
  rule: "no-fetch-in-effect",
  severity: "error" as const,
  message: "m",
  help: "h",
  line: 1,
  column: 1,
  category: "State & Effects",
};

export default function ReactDoctorWebSmokePage() {
  const payload = useMemo(() => calculateScoreLocally([SAMPLE_DIAGNOSTIC]), []);

  return (
    <main className="p-8 font-mono text-sm">
      <h1 className="mb-4 text-lg font-semibold">react-doctor-web (client bundle)</h1>
      <p className="mb-2 text-neutral-400">
        Client-side import of <code>react-doctor-web</code> for CI smoke tests.
      </p>
      <pre data-testid="core-smoke-result">{JSON.stringify(payload)}</pre>
    </main>
  );
}
