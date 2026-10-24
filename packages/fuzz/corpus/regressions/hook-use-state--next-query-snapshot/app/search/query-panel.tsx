// rule: hook-use-state
// weakness: cross-file
// verdict: pass
// file-path: corpus/regressions/hook-use-state--next-query-snapshot/app/search/query-panel.tsx
"use client";

import { useState } from "react";

export const QueryPanel = ({ query }) => {
  const [params] = useState(() => {
    const result = new URLSearchParams();
    for (const key in query) {
      result.set(key, query[key] ?? "");
    }
    return result;
  });
  return <span>{params.toString()}</span>;
};
