import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { dangerousHtmlSink } from "./dangerous-html-sink.js";

const scan = (content: string) =>
  runScanRule(dangerousHtmlSink, {
    relativePath: "src/components/chat/message/katex-renderer.tsx",
    content,
  });

describe("security-scan/dangerous-html-sink — KaTeX provenance", () => {
  it("accepts a real KaTeX result with a null fallback", () => {
    const findings = scan(`
      import katex from "katex";
      import { useMemo } from "react";

      export const MathNode = ({ value }: { value: string }) => {
        const html = useMemo(() => {
          try {
            return katex.renderToString(value, { throwOnError: false });
          } catch {
            return null;
          }
        }, [value]);

        if (html === null) return <span>{value}</span>;
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);

    expect(findings).toHaveLength(0);
  });

  it("accepts a real KaTeX helper that returns null on failure", () => {
    const findings = scan(`
      import * as katexNamespace from "katex";

      const renderMath = (value: string): string | null => {
        try {
          return katexNamespace.renderToString(value, { throwOnError: true });
        } catch {
          return null;
        }
      };

      export const MathNode = ({ value }: { value: string }) => {
        const html = renderMath(value);
        return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{value}</code>;
      };
    `);

    expect(findings).toHaveLength(0);
  });

  it("accepts an escaped fallback from a named KaTeX import", () => {
    const findings = scan(`
      import { renderToString as renderKatex } from "katex";

      const escapeHtml = (value: string) => value.replaceAll("<", "&lt;");
      const renderMath = (value: string) => {
        try {
          return renderKatex(value, { throwOnError: true });
        } catch {
          return \`<span class="fallback">\${escapeHtml(value)}</span>\`;
        }
      };

      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it("reports when a KaTeX failure falls back to the raw expression", () => {
    const findings = scan(`
      import katex from "katex";
      import { useMemo } from "react";

      export const MathNode = ({ value }: { value: string }) => {
        const html = useMemo(() => {
          try {
            return katex.renderToString(value, { throwOnError: false });
          } catch {
            return value;
          }
        }, [value]);

        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it.each([
    "katex.renderToString(value, { trust: true })",
    "katex.renderToString(value, { trust: allowTrustedCommand })",
    "katex.renderToString(value, { ...options })",
  ])("reports unsafe or unknown KaTeX options: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it("reports a local KaTeX lookalike", () => {
    const findings = scan(`
      const katex = {
        renderToString: (value: string) => value,
      };

      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it("reports raw HTML appended after safe KaTeX output", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, rawHtml }: { value: string; rawHtml: string }) => (
        <span
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(value, { trust: false }) + rawHtml,
          }}
        />
      );
    `);

    expect(findings).toHaveLength(1);
  });
});
