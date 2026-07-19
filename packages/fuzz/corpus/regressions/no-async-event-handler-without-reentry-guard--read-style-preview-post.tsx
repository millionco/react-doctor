// rule: no-async-event-handler-without-reentry-guard
// weakness: name-heuristic
// source: react-bench corpus audit 2026-07 (prompt manager: POST to a preview endpoint is a read-style compute — double-fire is last-write-wins)
import { useState } from "react";

export function PromptManager({ selectedStage }: { selectedStage: string }) {
  const [preview, setPreview] = useState("");
  const previewStage = async () => {
    const res = await fetch(`/api/prompts/${selectedStage}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testData: {} }),
    });
    if (!res.ok) return;
    const data = await res.json();
    setPreview(data.preview);
  };
  return (
    <div>
      <button type="button" onClick={previewStage}>
        Preview
      </button>
      <pre>{preview}</pre>
    </div>
  );
}
