import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { dangerousHtmlSink } from "./dangerous-html-sink.js";

describe("security-scan/dangerous-html-sink — regressions", () => {
  it("stays silent on an empty-string innerHTML clear", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/tooltip.ts",
      content: `const resetTooltip = () => {\n  tooltipElement.innerHTML = "";\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when the value is sanitized at the sink", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/rich-text.tsx",
      content: `export const RichText = ({ html }: { html: string }) => (\n  <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on i18n-sourced HTML", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/terms.tsx",
      content: `export const Terms = () => (\n  <p dangerouslySetInnerHTML={{ __html: t("terms.content_html") }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a module-constant HTML value", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/logo.tsx",
      content: `export const Logo = () => (\n  <span dangerouslySetInnerHTML={{ __html: LOGO_SVG_MARKUP }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when only the surrounding window looks dynamic", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/divider.tsx",
      content: `const description = props.text;\nconst Divider = () => (\n  <hr data-content={description} dangerouslySetInnerHTML={{ __html: NBSP_MARKUP }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on DOM-to-DOM serialization (excalidraw svg.outerHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/hooks/use-library-item-svg.ts",
      content: `if (svg) {\n  node.innerHTML = svg.outerHTML;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on sanitized-by-convention names (cal.com markdownToSafeHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/event-description.tsx",
      content: `export const EventDescription = ({ description }: Props) => (\n  <div dangerouslySetInnerHTML={{ __html: markdownToSafeHTML(description) }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on deploy-time env config snippets", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/gtm.tsx",
      content: `export const GtmNoscript = () => (\n  <noscript dangerouslySetInnerHTML={{ __html: \`<iframe src="https://www.googletagmanager.com/ns.html?id=\${process.env.NEXT_PUBLIC_GTM_ID}"></iframe>\` }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags unsanitized values even when named unsafeHtml", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/raw.tsx",
      content: `export const Raw = ({ unsafeHtml }: Props) => (\n  <div dangerouslySetInnerHTML={{ __html: unsafeHtml }} />\n);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags HTML injected from props", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/preview.tsx",
      content: `export const Preview = (props: { content: string }) => (\n  <div dangerouslySetInnerHTML={{ __html: props.content }} />\n);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags innerHTML assigned from fetched data", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/banner.ts",
      content: `const response = await fetch(bannerUrl);\nconst payload = await response.json();\nbannerElement.innerHTML = payload.data.bannerHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on innerHTML assigned from an escaping serializer call", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/managers/interaction-manager.ts",
      content: `const temporaryContainer = document.createElement("div");\ntemporaryContainer.innerHTML = toHtml(createGutterUtilityElement());\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on KaTeX-rendered html identifiers", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/katex/katex-block.tsx",
      content: `const html = useMemo(() => katex.renderToString(code, { displayMode: true }), [code]);\nreturn <div role="math" dangerouslySetInnerHTML={{ __html: html }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on style tags injecting generated CSS text", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/file-tree-view.tsx",
      content: `return (\n  <style\n    data-file-tree-guide-style="true"\n    dangerouslySetInnerHTML={{ __html: guideStyleText }}\n  />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on long static template scripts without interpolation", () => {
    const themeScriptLines = [
      "return (",
      "  <script",
      "    dangerouslySetInnerHTML={{",
      "      __html: `",
      "        try {",
      "          if (localStorage.theme === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches) {",
      "            document.querySelector('meta[name=theme-color]').setAttribute('content', '#000');",
      "          }",
      "        } catch (_) {}",
      "      `,",
      "    }}",
      "  />",
      ");",
    ];
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "app/layout.tsx",
      content: themeScriptLines.join("\n"),
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags script tags interpolating dynamic values", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "app/layout.tsx",
      content:
        "return <script dangerouslySetInnerHTML={{ __html: `window.config = ${serializedRequestConfig};` }} />;\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("judges template taint on interpolations, not static script text (payload InitTheme shape)", () => {
    const themeScriptLines = [
      "return (",
      "  <Script",
      "    dangerouslySetInnerHTML={{",
      "      __html: `",
      "        var mediaQuery = '(prefers-color-scheme: dark)'",
      "        var preference = window.localStorage.getItem('${themeLocalStorageKey}')",
      "        document.documentElement.setAttribute('data-theme', '${defaultTheme}')",
      "      `,",
      "    }}",
      "  />",
      ");",
    ];
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/providers/Theme/InitTheme/index.tsx",
      content: themeScriptLines.join("\n"),
    });
    expect(findings).toHaveLength(0);
  });

  it("flags templates whose interpolations carry tainted values", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/meeting-card.ts",
      content:
        'card.innerHTML = `\n  <div class="meeting-title">${meeting.title}</div>\n  ${subtitleHtml}\n`;\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on inert template-element parsing (mastodon hashtag_bar shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/hashtag-bar.tsx",
      content: `const template = document.createElement('template');\ntemplate.innerHTML = statusContent.trim();\nconst lastChild = template.content.lastChild;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on the detached parse-to-text idiom (mastodon unescapeHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/utils/html.ts",
      content: `export const unescapeHTML = (html: string) => {\n  const wrapper = document.createElement('div');\n  wrapper.innerHTML = html.replace(/<[^>]*>/g, '');\n  return wrapper.textContent;\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags detached wrappers whose parsed HTML reaches the document", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/slot-host.ts",
      content: `const nextContent = document.createElement('div');\nnextContent.innerHTML = props.normalizedHtml;\ndocument.body.appendChild(nextContent);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on HTML email templates (outline comment-email shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "server/emails/templates/CommentCreatedEmail.tsx",
      content: `export const CommentBody = ({ body }: Props) => (\n  <div dangerouslySetInnerHTML={{ __html: body }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
