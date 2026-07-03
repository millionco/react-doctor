import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsMissingMetadata } from "./nextjs-missing-metadata.js";

describe("nextjs/nextjs-missing-metadata — regressions", () => {
  it('does not flag a "use client" page, which cannot export metadata', () => {
    const result = runRule(
      nextjsMissingMetadata,
      `"use client";
import { useChat } from "@ai-sdk/react";
export default function ChatPage() {
  const { messages } = useChat();
  return <div>{messages.length}</div>;
}`,
      { filename: "app/chat/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a server page with no metadata export", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `export default function Page() {
  return <main>Home</main>;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
