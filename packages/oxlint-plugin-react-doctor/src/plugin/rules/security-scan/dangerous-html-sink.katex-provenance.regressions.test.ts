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

  it("accepts a safe local helper whose name contains KaTeX", () => {
    const findings = scan(`
      import katex from "katex";

      function renderKaTeX(value: string): string | null {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          return null;
        }
      }

      export const MathNode = ({ value }: { value: string }) => {
        const html = renderKaTeX(value);
        return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <code>{value}</code>;
      };
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "if (false) return value; return katex.renderToString(value);",
    `try { return katex.renderToString(value); }
     catch { return null; }
     return value;`,
    `do { return katex.renderToString(value); }
     while (shouldRetry());
     return value;`,
  ])("ignores a statically unreachable raw helper return: %s", (helperBody) => {
    const findings = scan(`
      import katex from "katex";

      const renderMath = (value: string) => {
        ${helperBody}
      };

      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it("accepts a void fallback from a KaTeX helper", () => {
    const findings = scan(`
      import katex from "katex";

      const renderMath = (value: string) => {
        try {
          return katex.renderToString(value);
        } catch {
          return void 0;
        }
      };

      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it("keeps a reachable raw helper return unsafe", () => {
    const findings = scan(`
      import katex from "katex";

      const renderMath = (value: string, useKatex: boolean) => {
        if (useKatex) return katex.renderToString(value);
        return value;
      };

      export const MathNode = ({ value, useKatex }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value, useKatex) }} />
      );
    `);

    expect(findings).toHaveLength(1);
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

  it("accepts the authentic chained escapeHtml fallback", () => {
    const findings = scan(`
      import katex from "katex";

      const escapeHtml = (value: string) =>
        value
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");

      const renderMath = (value: string) => {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          const escaped = escapeHtml(value);
          return \`<span class="fallback">\${escaped}</span>\`;
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

  it("does not let a sanitizer-shaped value name hide an unsafe KaTeX proof", () => {
    const findings = scan(`
      import katex from "katex";

      const renderMathHtml = (value: string) => {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          return value;
        }
      };

      export const MathNode = ({ value }: { value: string }) => {
        const safeKatexHtml = renderMathHtml(value);
        return <span dangerouslySetInnerHTML={{ __html: safeKatexHtml }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it("does not let sanitizer-shaped assignment provenance hide an unsafe KaTeX proof", () => {
    const findings = scan(`
      import katex from "katex";

      const sanitizeMathHtml = (value: string) => {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          return value;
        }
      };

      export const MathNode = ({ value }: { value: string }) => {
        const html = sanitizeMathHtml(value);
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it("does not let highlighter-shaped assignment provenance hide an unsafe KaTeX proof", () => {
    const findings = scan(`
      import katex from "katex";

      const renderHighlightedHtml = (value: string) => {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          return value;
        }
      };

      export const MathNode = ({ value }: { value: string }) => {
        const highlightedHtml = renderHighlightedHtml(value);
        return <span dangerouslySetInnerHTML={{ __html: highlightedHtml }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it("accepts a safe KaTeX value behind an unknown logical condition", () => {
    const findings = scan(`
      import katex from "katex";

      const renderMathHtml = (value: string): string | null => {
        try {
          return katex.renderToString(value, { throwOnError: true });
        } catch {
          return null;
        }
      };

      export const MathNode = ({ enabled, value }: { enabled: boolean; value: string }) => {
        const safeKatexHtml = renderMathHtml(value);
        const html = enabled && safeKatexHtml;
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);

    expect(findings).toHaveLength(0);
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

  it("reports an imported KaTeX lookalike", () => {
    const findings = scan(`
      import katex from "fake-katex";
      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it("reports a shadow over a real KaTeX import", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value }: { value: string }) => {
        const katex = { renderToString: (input: string) => input };
        return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it.each([
    `export const MathNode = ({ value, katex }: Props) => (
       <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
     );`,
    `let katex = { renderToString: (value: string) => value };
     export const MathNode = ({ value }: Props) => (
       <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
     );`,
    `var katex = { renderToString: (value: string) => value };
     export const MathNode = ({ value }: Props) => (
       <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
     );`,
    `import realKatex from "katex";
     let katex = realKatex;
     katex = { renderToString: (value: string) => value };
     export const MathNode = ({ value }: Props) => (
       <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
     );`,
  ])("reports a mutable or parameter KaTeX lookalike", (source) => {
    expect(scan(source)).toHaveLength(1);
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

  it("reports raw HTML injected by a post-serializer replacement", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, rawHtml }: Props) => (
        <span
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(value).replace("placeholder", rawHtml),
          }}
        />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it.each(["renderMathToHtml", "renderMathHtml"])(
    "reports a raw fallback hidden behind helper name %s",
    (helperName) => {
      const findings = scan(`
        import katex from "katex";

        const ${helperName} = (value: string) => {
          try {
            return katex.renderToString(value, { throwOnError: false });
          } catch {
            return value;
          }
        };

        export const MathNode = ({ value }: { value: string }) => (
          <span dangerouslySetInnerHTML={{ __html: ${helperName}(value) }} />
        );
      `);

      expect(findings).toHaveLength(1);
    },
  );

  it("accepts transparent TypeScript wrappers around a safe KaTeX result", () => {
    const findings = scan(`
      import { renderToString as renderKatex } from "katex";
      export const MathNode = ({ value }: { value: string }) => {
        const html = (renderKatex(value, { trust: false }) satisfies string)!;
        return <span dangerouslySetInnerHTML={{ __html: html as string }} />;
      };
    `);

    expect(findings).toHaveLength(0);
  });

  it.each(["$&", "$`", "$'"])(
    "rejects a replacement token that preserves raw markup: %s",
    (token) => {
      const findings = scan(`
      import katex from "katex";
      const escapeHtml = (value: string) => value.replace(/</g, ${JSON.stringify(token)});
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return \`<span>\${escapeHtml(value)}</span>\`; }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
      expect(findings).toHaveLength(1);
    },
  );

  it("does not reuse a text-only escaper inside an attribute interpolation", () => {
    const findings = scan(`
      import katex from "katex";
      const escapeHtml = (value: string) => value.replaceAll("<", "&lt;");
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return \`<span title="\${escapeHtml(value)}">fallback</span>\`; }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it("distinguishes called, uncalled, and unreachable renderer mutators", () => {
    expect(
      scan(`
        import katex from "katex";
        const mutateLater = () => { katex.renderToString = (value: string) => value; };
        if (false) katex.renderToString = (value: string) => value;
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
        );
      `),
    ).toHaveLength(0);
    expect(
      scan(`
        import katex from "katex";
        mutate();
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
        );
        function mutate() { katex.renderToString = (value: string) => value; }
      `),
    ).toHaveLength(1);
  });

  it("rejects a KaTeX renderer mutated before use in the same function", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value }: Props) => {
        katex.renderToString = (rawValue: string) => rawValue;
        return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it.each([
    "katex.renderToString(value).trim()",
    'katex.renderToString(value).replaceAll("&nbsp;", " ")',
  ])("accepts a markup-preserving post-transform: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it("rejects a dynamic post-transform replacement", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, rawHtml }: Props) => (
        <span dangerouslySetInnerHTML={{
          __html: katex.renderToString(value).replaceAll("&nbsp;", rawHtml),
        }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    ['import DOMPurify from "dompurify";', "DOMPurify.sanitize(value)"],
    ['import { escape } from "html-escaper";', "escape(value)"],
  ])("accepts an exact imported sanitizer fallback", (importSource, fallback) => {
    const findings = scan(`
      import katex from "katex";
      ${importSource}
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return ${fallback}; }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it.each([
    [
      'import DOMPurify from "dompurify";',
      "DOMPurify.sanitize = (value: string) => value;",
      "DOMPurify.sanitize(value)",
    ],
    [
      'const DOMPurify = require("dompurify");',
      "Object.assign(DOMPurify, { sanitize: (value: string) => value });",
      "DOMPurify.sanitize(value)",
    ],
    [
      'import DOMPurify from "isomorphic-dompurify";',
      'Object.defineProperty(DOMPurify, "sanitize", { value: (value: string) => value });',
      "DOMPurify.sanitize(value)",
    ],
    [
      'const htmlEscaper = require("html-escaper");',
      'Reflect.set(htmlEscaper, "escape", (value: string) => value);',
      "htmlEscaper.escape(value)",
    ],
    [
      'const htmlEscaper = require("html-escaper");',
      "Object.defineProperties(htmlEscaper, { escape: { value: (value: string) => value } });",
      "htmlEscaper.escape(value)",
    ],
    [
      'import DOMPurify from "dompurify";',
      "const purifierAlias = DOMPurify; purifierAlias.sanitize = (value: string) => value;",
      "DOMPurify.sanitize(value)",
    ],
    [
      'import DOMPurify from "dompurify";',
      'const methodName = "sanitize"; DOMPurify[methodName] = (value: string) => value;',
      "DOMPurify.sanitize(value)",
    ],
    [
      'import DOMPurify from "dompurify";',
      "if (shouldReplaceSanitizer) DOMPurify.sanitize = (value: string) => value;",
      "DOMPurify.sanitize(value)",
    ],
  ])("rejects a mutated exact sanitizer fallback: %s", (importSource, mutation, fallback) => {
    const findings = scan(`
      import katex from "katex";
      ${importSource}
      ${mutation}
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return ${fallback}; }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    [
      'import DOMPurify from "dompurify";',
      "DOMPurify.renderToString = (value: string) => value;",
      "DOMPurify.sanitize(value)",
    ],
    [
      'const htmlEscaper = require("html-escaper");',
      'Reflect.set(htmlEscaper, "version", "1");',
      "htmlEscaper.escape(value)",
    ],
  ])(
    "accepts an exact sanitizer after an unrelated namespace mutation: %s",
    (importSource, mutation, fallback) => {
      const findings = scan(`
      import katex from "katex";
      ${importSource}
      ${mutation}
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return ${fallback}; }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
      expect(findings).toHaveLength(0);
    },
  );

  it.each([
    ["replaceSanitizer();", 1],
    ["", 0],
    ["if (false) replaceSanitizer();", 0],
  ])("tracks sanitizer mutations through reachable local calls: %s", (invocation, count) => {
    const findings = scan(`
      import katex from "katex";
      import DOMPurify from "dompurify";
      const replaceSanitizer = () => {
        DOMPurify.sanitize = (value: string) => value;
      };
      ${invocation}
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return DOMPurify.sanitize(value); }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(count);
  });

  it.each(["replaceSanitizer();", "invokeSanitizerReplacement();"])(
    "rejects a sibling sanitizer mutation before the render helper: %s",
    (invocation) => {
      const findings = scan(`
        import katex from "katex";
        import DOMPurify from "dompurify";
        const replaceSanitizer = () => {
          DOMPurify.sanitize = (value: string) => value;
        };
        const invokeSanitizerReplacement = () => replaceSanitizer();
        const renderMath = (value: string) => {
          try { return katex.renderToString(value); }
          catch { return DOMPurify.sanitize(value); }
        };
        export const MathNode = ({ value }: Props) => {
          ${invocation}
          return <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />;
        };
      `);
      expect(findings).toHaveLength(1);
    },
  );

  it("rejects a sibling sanitizer mutation after the render helper can persist", () => {
    const findings = scan(`
      import katex from "katex";
      import DOMPurify from "dompurify";
      const replaceSanitizer = () => {
        DOMPurify.sanitize = (value: string) => value;
      };
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return DOMPurify.sanitize(value); }
      };
      export const MathNode = ({ value }: Props) => {
        const html = renderMath(value);
        replaceSanitizer();
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);
    expect(findings).toHaveLength(1);
  });

  it("rejects a same-helper sanitizer mutation that persists into later calls", () => {
    const findings = scan(`
      import katex from "katex";
      import DOMPurify from "dompurify";
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch {
          const html = DOMPurify.sanitize(value);
          DOMPurify.sanitize = (nextValue: string) => nextValue;
          return html;
        }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    `
      const node = <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />;
      return node;
      replaceSanitizer();
    `,
    `
      if (shouldAbort) {
        throw new Error();
        replaceSanitizer();
      }
      return <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />;
    `,
  ])("accepts a statically unreachable sibling sanitizer mutation", (componentBody) => {
    const findings = scan(`
      import katex from "katex";
      import DOMPurify from "dompurify";
      const replaceSanitizer = () => {
        DOMPurify.sanitize = (value: string) => value;
      };
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return DOMPurify.sanitize(value); }
      };
      export const MathNode = ({ value }: Props) => {
        ${componentBody}
      };
    `);
    expect(findings).toHaveLength(0);
  });

  it.each(["return", "throw new Error()", "break", "continue"])(
    "accepts a sibling sanitizer mutation after a nested terminal: %s",
    (terminalStatement) => {
      const findings = scan(`
        import katex from "katex";
        import DOMPurify from "dompurify";
        const replaceSanitizer = () => {
          DOMPurify.sanitize = (value: string) => value;
        };
        const renderMath = (value: string) => {
          try { return katex.renderToString(value); }
          catch { return DOMPurify.sanitize(value); }
        };
        export const MathNode = ({ value }: Props) => {
          for (const item of [value]) {
            consume(<span dangerouslySetInnerHTML={{ __html: renderMath(item) }} />);
            { ${terminalStatement}; }
            replaceSanitizer();
          }
          return null;
        };
      `);
      expect(findings).toHaveLength(0);
    },
  );

  it("accepts a sanitizer mutation after a one-shot program evaluation", () => {
    const findings = scan(`
      import katex from "katex";
      import DOMPurify from "dompurify";
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return DOMPurify.sanitize(value); }
      };
      const html = renderMath(window.location.hash);
      DOMPurify.sanitize = (value: string) => value;
      export const MathNode = () => <span dangerouslySetInnerHTML={{ __html: html }} />;
    `);
    expect(findings).toHaveLength(0);
  });

  it.each(["replaceSanitizer();", "DOMPurify.sanitize = (nextValue: string) => nextValue;"])(
    "rejects a sanitizer mutation that persists across top-level loop iterations: %s",
    (mutation) => {
      const findings = scan(`
        import katex from "katex";
        import DOMPurify from "dompurify";
        const replaceSanitizer = () => {
          DOMPurify.sanitize = (value: string) => value;
        };
        const renderMath = (value: string) => {
          try { return katex.renderToString(value); }
          catch { return DOMPurify.sanitize(value); }
        };
        for (const value of values) {
          consume(<span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />);
          ${mutation}
        }
      `);
      expect(findings).toHaveLength(1);
    },
  );

  it.each([
    [
      "while false",
      `while (false) {
      consume(<span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />);
      DOMPurify.sanitize = (nextValue: string) => nextValue;
    }`,
    ],
    [
      "for false",
      `for (; false; ) {
      consume(<span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />);
      DOMPurify.sanitize = (nextValue: string) => nextValue;
    }`,
    ],
    [
      "do while false",
      `do {
      consume(<span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />);
      DOMPurify.sanitize = (nextValue: string) => nextValue;
    } while (false);`,
    ],
    [
      "trailing break",
      `for (const nextValue of values) {
      consume(<span dangerouslySetInnerHTML={{ __html: renderMath(nextValue) }} />);
      DOMPurify.sanitize = (value: string) => value;
      break;
    }`,
    ],
  ])(
    "accepts a sanitizer mutation in a statically zero-or-one-iteration loop: %s",
    (_label, loop) => {
      const findings = scan(`
        import katex from "katex";
        import DOMPurify from "dompurify";
        const renderMath = (value: string) => {
          try { return katex.renderToString(value); }
          catch { return DOMPurify.sanitize(value); }
        };
        ${loop}
      `);
      expect(findings).toHaveLength(0);
    },
  );

  it("rejects a sanitizer lookalike fallback", () => {
    const findings = scan(`
      import katex from "katex";
      const DOMPurify = { sanitize: (value: string) => value };
      const renderMath = (value: string) => {
        try { return katex.renderToString(value); }
        catch { return DOMPurify.sanitize(value); }
      };
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    'const katex = require("katex");',
    'import katex = require("katex");',
    'const katex = await import("katex");',
    'const katex = (await import("katex")).default;',
    'import katex from "katex/dist/katex.mjs";',
  ])("accepts a real KaTeX module form: %s", (moduleSource) => {
    const findings = scan(`
      ${moduleSource}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it("reports unsafe options through an awaited default import", () => {
    const findings = scan(`
      const katex = (await import("katex")).default;
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{
          __html: katex.renderToString(value, { trust: true }),
        }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    'const katex = require("fake-katex");',
    'const katex = await import("fake-katex");',
    'import katex from "fake-katex/dist/katex.mjs";',
  ])("rejects a lookalike KaTeX module form: %s", (moduleSource) => {
    const findings = scan(`
      ${moduleSource}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    "const serialize = katex.renderToString;",
    "const { renderToString: serialize } = katex;",
    'const { renderToString: serialize } = require("katex");',
  ])("accepts an exact KaTeX renderer alias: %s", (aliasSource) => {
    const findings = scan(`
      import katex from "katex";
      ${aliasSource}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: serialize(value, { trust: false }) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it.each([
    "const serialize = katex.renderToString;",
    "const { renderToString: serialize } = katex;",
    'const { renderToString: serialize } = require("katex");',
  ])("keeps unsafe options positive through a renderer alias: %s", (aliasSource) => {
    const findings = scan(`
      import katex from "katex";
      ${aliasSource}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: serialize(value, { trust: true }) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it("resolves a local useMemo callback and const alias", () => {
    expect(
      scan(`
        import katex from "katex";
        import { useMemo } from "react";
        const renderMath = (value: string) => katex.renderToString(value);
        const renderAlias = renderMath;
        export const MathNode = ({ value }: Props) => {
          const html = useMemo(() => renderAlias(value), [value]);
          return <span dangerouslySetInnerHTML={{ __html: html }} />;
        };
      `),
    ).toHaveLength(0);
    expect(
      scan(`
        import katex from "katex";
        import { useMemo } from "react";
        const renderMath = (value: string) => {
          try { return katex.renderToString(value); }
          catch { return value; }
        };
        export const MathNode = ({ value }: Props) => {
          const html = useMemo(renderMath, [value]);
          return <span dangerouslySetInnerHTML={{ __html: html }} />;
        };
      `),
    ).toHaveLength(1);
  });

  it("does not launder KaTeX output through a userland useMemo lookalike", () => {
    const findings = scan(`
      import katex from "katex";
      const useMemo = (callback: () => string) => rawHtml;
      export const MathNode = ({ value }: Props) => {
        const html = useMemo(() => katex.renderToString(value));
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);
    expect(findings).toHaveLength(1);
  });

  it("substitutes local helper arguments into identity and static wrapper proofs", () => {
    expect(
      scan(`
        import katex from "katex";
        const identity = (html: string) => html;
        const wrap = (html: string, compact: boolean) =>
          compact ? \`<span>\${html}</span>\` : \`<div>\${html}</div>\`;
        export const MathNode = ({ value, compact }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: wrap(identity(katex.renderToString(value)), compact) }} />
        );
      `),
    ).toHaveLength(0);
    expect(
      scan(`
        import katex from "katex";
        const identity = (html: string) => html;
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{
            __html: identity(katex.renderToString(value, { trust: true })),
          }} />
        );
      `),
    ).toHaveLength(1);
  });

  it("rejects a local helper that adds an unknown interpolation", () => {
    const findings = scan(`
      import katex from "katex";
      const wrap = (html: string, label: string) => \`<div>\${html}\${label}</div>\`;
      export const MathNode = ({ value, label }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: wrap(katex.renderToString(value), label) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each(["html = raw", "html += raw", "if (condition) html = raw"])(
    "does not prove a written helper parameter safe: %s",
    (write) => {
      const findings = scan(`
      import katex from "katex";
      const transform = (html: string, raw: string, condition: boolean) => {
        ${write};
        return html;
      };
      export const MathNode = ({ value, raw, condition }: Props) => (
        <span dangerouslySetInnerHTML={{
          __html: transform(katex.renderToString(value), raw, condition),
        }} />
      );
    `);
      expect(findings).toHaveLength(0);
    },
  );

  it("preserves a dynamically imported KaTeX instance stored in state", () => {
    const findings = scan(`
      import { useEffect, useState } from "react";
      const options = { throwOnError: false };
      export const MathNode = ({ value }: Props) => {
        const [katex, setKatex] = useState<any>();
        useEffect(() => { void import("katex").then((module) => setKatex(module.default)); }, []);
        if (!katex) return null;
        const html = katex.renderToString(value, options);
        return <span dangerouslySetInnerHTML={{ __html: html }} />;
      };
    `);
    expect(findings).toHaveLength(0);
  });
});
