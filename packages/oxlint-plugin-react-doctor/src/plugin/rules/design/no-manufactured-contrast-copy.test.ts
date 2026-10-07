import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noManufacturedContrastCopy } from "./no-manufactured-contrast-copy.js";

describe("no-manufactured-contrast-copy", () => {
  it("flags repeated contrast-first claims", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Not just another report. It is a plan.</p>
        <p>No busywork. Just useful diagnostics.</p>
        <p>Not a wall of warnings. You get prioritized fixes.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags repeated assertion-then-no cadence", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Start reviewing immediately. No account setup.</p>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. No wall of warnings.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags repeated assertion-then-just cadence", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <article>
        <p>Review the important changes. Just the highest-impact findings.</p>
        <p>Understand every warning. Just the evidence you need.</p>
        <p>Fix the release blocker. Just one focused workflow.</p>
      </article>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("counts mixed supported sentence pairs within one page root", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Not another raw report. It is a prioritized plan.</p>
        <p>Review the important changes. No manual sorting.</p>
        <p>Understand every warning. Just the evidence you need.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts one deliberate contrast", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main><p>No busywork. Just useful diagnostics.</p><p>Review the highest-impact finding first.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("counts no-just pairs once when patterns identify the same range", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>No busywork. Just useful diagnostics.</p>
        <p>No raw report. Just prioritized fixes.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("counts overlapping sentence-pair ranges once", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Not just warnings. It is action. Just focused action.</p>
        <p>Not just a report. It is guidance. No manual sorting.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine sentence pairs from separate page roots", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <>
        <main>
          <p>Review the important changes. No manual sorting.</p>
          <p>Understand every warning. Just the evidence you need.</p>
        </main>
        <article><p>Start reviewing immediately. No account setup.</p></article>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores copy rendered by code, terminal, and Markdown descendants", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Review the important changes. No manual sorting.</p>
        <p>Understand every warning. Just the evidence you need.</p>
        <pre>Start reviewing immediately. No account setup.</pre>
        <code>Keep the release moving. No manual sorting.</code>
        <kbd>Share a focused result. No wall of warnings.</kbd>
        <samp>Fix the release blocker. Just one focused workflow.</samp>
        <CodeBlock>Start reviewing immediately. No account setup.</CodeBlock>
        <ConsoleOutput>Keep the release moving. No manual sorting.</ConsoleOutput>
        <Terminal>Keep the release moving. No manual sorting.</Terminal>
        <Docs.Markdown>Share a focused result. No wall of warnings.</Docs.Markdown>
        <MDXContent>Fix the release blocker. Just one focused workflow.</MDXContent>
        <MdxRenderer>Start reviewing immediately. No account setup.</MdxRenderer>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not resolve dynamic or interprocedural copy", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const contrastCopy = "Review the important changes. No manual sorting. Understand every warning. Just the evidence you need. Start reviewing immediately. No account setup.";
      const SharedCopy = () => <><p>Keep the release moving. No manual sorting.</p><p>Share a focused result. No wall of warnings.</p><p>Fix the release blocker. Just one focused workflow.</p></>;
      const Page = () => <main>{contrastCopy}<SharedCopy /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not manufacture a pair across a dynamic template interpolation", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = ({ account }: { account: string }) => <main>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. Just the evidence you need.</p>
        <p>{\`Start reviewing immediately. \${account} No account setup.\`}</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps a root with any dynamic template interpolation quiet", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = ({ account }: { account: string }) => <main>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. Just the evidence you need.</p>
        <p>{\`Start reviewing immediately. No account setup. \${account}\`}</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still counts complete pairs in a fully static template", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. Just the evidence you need.</p>
        <p>{\`Start reviewing immediately. No account setup.\`}</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not manufacture a pair across conditional branches", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = ({ isReady }: { isReady: boolean }) => <main>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. Just the evidence you need.</p>
        {isReady ? <p>Start reviewing immediately.</p> : <p>No account setup.</p>}
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not manufacture a pair across a conditional rendering boundary", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = ({ isReady }: { isReady: boolean }) => <main>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. Just the evidence you need.</p>
        <p>Start reviewing immediately.</p>
        {isReady && <p>No account setup.</p>}
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine matches from mutually exclusive or conditional branches", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = ({ variant, enabled }: { variant: boolean; enabled: boolean }) => <main>
        {variant ? <>
          <p>Keep the release moving. No manual sorting.</p>
          <p>Share a focused result. Just the evidence you need.</p>
        </> : <p>Start reviewing immediately. No account setup.</p>}
        {enabled && <p>Understand every warning. Just the evidence you need.</p>}
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores page roots inside excluded copy renderers", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Examples = () => <>
        <Markdown><main><p>One. No setup.</p><p>Two. No sorting.</p><p>Three. Just results.</p></main></Markdown>
        <CodeBlock><article><p>One. No setup.</p><p>Two. No sorting.</p><p>Three. Just results.</p></article></CodeBlock>
        <Terminal><main><p>One. No setup.</p><p>Two. No sorting.</p><p>Three. Just results.</p></main></Terminal>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores statically non-rendered descendants and page ancestors", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const hiddenCopy = <><p>One. No setup.</p><p>Two. No sorting.</p><p>Three. Just results.</p></>;
      const Page = () => <>
        <main>
          <p>Visible one. No setup.</p>
          <p>Visible two. Just results.</p>
          <div hidden><p>Hidden third. No sorting.</p></div>
          <div aria-hidden="true"><p>Aria third. No sorting.</p></div>
          <div style={{ display: "none" }}><p>Display third. No sorting.</p></div>
          <div style={{ visibility: "hidden" }}><p>Visibility third. No sorting.</p></div>
          <div className="hidden"><p>Tailwind third. No sorting.</p></div>
        </main>
        <section hidden><main>{hiddenCopy}</main></section>
        <section aria-hidden="true"><article>{hiddenCopy}</article></section>
        <section style={{ display: "none" }}><main>{hiddenCopy}</main></section>
        <section style={{ visibility: "hidden" }}><article>{hiddenCopy}</article></section>
        <section className="hidden"><main>{hiddenCopy}</main></section>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "/repo/docs/landing.tsx",
    "/repo/blog/release.tsx",
    "/repo/content/marketing.tsx",
    "/repo/changelog/entry.tsx",
    "/repo/posts/launch.tsx",
  ])("skips conventional long-form content path %s", (filename) => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <article>
        <p>Start reviewing immediately. No account setup.</p>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. No wall of warnings.</p>
      </article>;`,
      { filename },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the configured project root to identify long-form content paths", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <main>
        <p>Start reviewing immediately. No account setup.</p>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. No wall of warnings.</p>
      </main>;`,
      {
        filename: "src/page.tsx",
        settings: { "react-doctor": { rootDirectory: "/repo/docs" } },
      },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still checks landing copy in an article-named product path", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <article>
        <p>Start reviewing immediately. No account setup.</p>
        <p>Keep the release moving. No manual sorting.</p>
        <p>Share a focused result. No wall of warnings.</p>
      </article>;`,
      { filename: "/repo/src/article/landing.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts direct explanatory prose", () => {
    const result = runRule(
      noManufacturedContrastCopy,
      `const Page = () => <article><p>The scan ranks findings by severity.</p><p>Each diagnostic links to a fix.</p><p>CI can block new warnings.</p></article>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
