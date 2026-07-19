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

  it("stays silent on a redirect-only page exported through a local binding", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
const ChangelogRedirect = () => redirect("/docs/community/changelog");
export default ChangelogRedirect;`,
      { filename: "app/changelog/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on direct default functions returning renamed redirect imports", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { permanentRedirect as movePermanently } from "next/navigation";
export default function LegacyPage() {
  return movePermanently("/docs");
}`,
      { filename: "app/legacy/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on async arrow pages awaiting redirects", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
export default async () => await redirect("/docs");`,
      { filename: "app/legacy/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on redirect-only blocks with awaited statements", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { permanentRedirect as movePermanently } from "next/navigation";
export default async function LegacyPage() {
  await movePermanently("/docs");
}`,
      { filename: "app/legacy/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on redirect-only blocks returning awaited redirects", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
export default async function LegacyPage() {
  return await redirect("/docs");
}`,
      { filename: "app/legacy/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a page that can render after a conditional redirect", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
export default function AccountPage({ user }) {
  if (!user) redirect("/login");
  return <main>Account</main>;
}`,
      { filename: "app/profile/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a local function named redirect", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `const redirect = (path) => <main>{path}</main>;
export default function Page() {
  return redirect("/dashboard");
}`,
      { filename: "app/products/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust an awaited redirect imported from another module", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "./navigation";
export default async function Page() {
  return await redirect("/dashboard");
}`,
      { filename: "app/products/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed redirect import", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
export default async function Page(redirect) {
  return await redirect("/dashboard");
}`,
      { filename: "app/products/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags async pages that can render after a conditional redirect", () => {
    const result = runRule(
      nextjsMissingMetadata,
      `import { redirect } from "next/navigation";
export default async function Page(user) {
  if (!user) await redirect("/login");
  return <main>Account</main>;
}`,
      { filename: "app/products/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
