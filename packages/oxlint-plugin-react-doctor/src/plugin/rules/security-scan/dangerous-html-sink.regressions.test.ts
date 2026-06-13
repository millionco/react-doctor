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

  it("stays silent on RawHtml email component even under monorepo packages/emails rootDir scan (cal.com shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/RawHtml.tsx",
      content: `const RawHtml = ({ html = "" }) => (\n  <div dangerouslySetInnerHTML={{ __html: html }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on result of internal rich-text renderer (tldraw renderHtmlFromRichText shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx",
      content: `const html = renderHtmlFromRichText(editor, richText);\nreturn <div dangerouslySetInnerHTML={{ __html: html }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on an empty-string clear with a trailing comment (posthog NotebookNodeLatex shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/scenes/notebooks/Nodes/NotebookNodeLatex.tsx",
      content: `mathJaxDisplayDiv.innerHTML = '' // Clear before rendering\nconst math = mjxDocument.convert(content, { display: true })\nmathJaxDisplayDiv.appendChild(math)\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on createHTMLDocument parse-to-text (tldraw stripHtml shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/lib/ui/hooks/use-clipboard-events.ts",
      content: `function stripHtml(html: string) {\n  const doc = document.implementation.createHTMLDocument('')\n  doc.documentElement.innerHTML = html.trim()\n  return doc.body.textContent || ''\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a detached scratch node queried and returned as a string (plane paste-asset shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/core/helpers/paste-asset.ts",
      content: `export const processAssets = (htmlContent: string) => {\n  const tempDiv = document.createElement("div");\n  tempDiv.innerHTML = htmlContent;\n  let processedHtml = htmlContent;\n  const nodes = tempDiv.querySelectorAll("img");\n  return { processedHtml };\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a scratch node reused across a loop (second write far from createElement)", () => {
    const content = [
      "export const processAll = (rawHtml: string) => {",
      '  const tempDiv = document.createElement("div");',
      "  tempDiv.innerHTML = rawHtml;",
      "  let result = rawHtml;",
      "  for (const name of handlers) {",
      "    const matched = tempDiv.querySelectorAll(name);",
      "    if (matched.length) {",
      "      result = transform(result);",
      "      tempDiv.innerHTML = result;",
      "    }",
      "  }",
      "  return { result };",
      "};",
    ].join("\n");
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/core/helpers/process-all.ts",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on in-house render*HTML serializers (pierre renderPartialHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/file-diff.ts",
      content: `this.code.innerHTML = this.fileRenderer.renderPartialHTML(\n  this.fileRenderer.renderCodeAST(result)\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on highlighter output assigned from a serializer (shiki codeToHtml shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/sections/code-block-section.tsx",
      content: `const highlighted = { dark: await codeToHtml(code, { theme: "dark" }) };\nreturn <div dangerouslySetInnerHTML={{ __html: highlighted.dark }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags an unrelated member-access sink when the file only imports a highlighter", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/profile.tsx",
      content: `import { codeToHtml } from "shiki";\nexport const Profile = ({ user }: Props) => (\n  <div dangerouslySetInnerHTML={{ __html: user.profileHtml }} />\n);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags object-stored html when no serializer library is present", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/chat.ts",
      content: `bubble.innerHTML = payload.data.messageHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a scratch node whose parsed HTML is appended to the live tree", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/mount.ts",
      content: `const scratch = document.createElement("div");\nscratch.innerHTML = props.content;\nconst found = scratch.querySelectorAll("a");\ndocument.body.appendChild(scratch);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on generated/minified bundles (iconfont.js shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "assets/fonts/iconfont.js",
      content: `!function(i){var z='<svg></svg>';document.body.innerHTML=i.data.html}(window);\n`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a value sanitized at its definition site (bruno DOMPurify shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/MarkDown/index.jsx",
      content: `const cleanHTML = DOMPurify.sanitize(md.render(content || ""));\nreturn <div className="markdown-body" dangerouslySetInnerHTML={{ __html: cleanHTML }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on HTML encoder output (notesnook encodeNonAsciiHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/extensions/clipboard/clipboard-dom-parser.ts",
      content: `const code = document.createElement("code");\ncode.innerHTML = encodeNonAsciiHTML(codeAsText || "");\npre.replaceChildren(code);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a bare identifier not sanitized anywhere in the file", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/preview.tsx",
      content: `const previewHtml = props.body;\nreturn <div dangerouslySetInnerHTML={{ __html: previewHtml }} />;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a DOM-to-DOM innerHTML copy (openreplay ElementView shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/element-view.tsx",
      content: `const rElem = context.document.createElement(newTag);\nrElem.innerHTML = element.innerHTML;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a self-transform of a node's own innerHTML", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/extensions/clipboard/parser.ts",
      content: `for (const div of dom.querySelectorAll(".w3-code")) {\n  div.innerHTML = div.innerHTML?.replaceAll(/<br.*?>/g, "\\n");\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags DOM content concatenated with fresh input", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/append.ts",
      content: `target.innerHTML = base.innerHTML + props.untrustedHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on a camelCase sanitized identifier (thorium htmlSanitized shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/library-header.tsx",
      content: `return htmlSanitized ? <div dangerouslySetInnerHTML={{ __html: htmlSanitized }} /> : null;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on hljs-highlighted output via member access (planka ContentViewer shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/content-viewer.jsx",
      content: `const hljsResult = hljs.highlightAuto(code);\nreturn <code dangerouslySetInnerHTML={{ __html: hljsResult.value }} className="hljs" />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a commented-out sink (thorium highlight.ts shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/webview/highlight.ts",
      content: `// floatingText.innerHTML = text;\nfloatingText.textContent = text;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on innerHTML of a created <style> element (builder.io shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/builder-component.tsx",
      content: `const style = document.createElement('style');\nstyle.innerHTML = html;\ndocument.head.appendChild(style);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a real sink even when a URL with // precedes it on the line", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/banner.ts",
      content: `fetch("https://api.example.com"); el.innerHTML = props.untrustedHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a real sink after a protocol-relative URL string on the same line", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/cdn.ts",
      content: `const src = base || "//cdn.example.com"; el.innerHTML = props.untrustedHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a live element sharing a name with a scratch parse node", () => {
    const content = [
      "function parseScratch(raw) {",
      '  const el = document.createElement("div");',
      "  el.innerHTML = raw;",
      "  return el.textContent;",
      "}",
      "function mount(userHtml) {",
      '  const el = document.getElementById("app");',
      "  el.innerHTML = userHtml;",
      "}",
    ].join("\n");
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/mount.ts",
      content,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags DOM content transformed with a tainted argument", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/render/transform.ts",
      content: `node.innerHTML = node.innerHTML.replace(placeholder, props.userHtml);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a non-HTML encoder that does not escape markup", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/display.ts",
      content: `el.innerHTML = encodeForDisplay(data.body);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on highlighter output routed through React state (shiki useState shape)", () => {
    const content = [
      'import { codeToHtml } from "shiki";',
      "export const CodeBlock = ({ code, language }: Props) => {",
      "  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);",
      "  useEffect(() => {",
      "    codeToHtml(code, { lang: language }).then(setHighlightedHtml);",
      "  }, [code, language]);",
      "  return highlightedHtml ? <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} /> : null;",
      "};",
    ].join("\n");
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/code-block.tsx",
      content,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a highlight*() call value", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/report.tsx",
      content: `return <span dangerouslySetInnerHTML={{ __html: highlightJson(content) }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on a highlighted-named value passed as a prop (pre-highlighted leaf component)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/highlighted-text.tsx",
      content: `export const HighlightedText = ({ highlightedHtml }: Props) => (\n  <span dangerouslySetInnerHTML={{ __html: highlightedHtml }} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a non-highlighter rendered value (renderedHtml without a highlighter)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/preview.tsx",
      content: `const renderedHtml = props.body;\nreturn <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("still flags a present-tense highlight value when no highlighter library is present", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/banner.tsx",
      content: `const highlightBody = props.body;\nreturn <div dangerouslySetInnerHTML={{ __html: highlightBody }} />;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags innerHTML assigned from location.hash (DOM-XSS source)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/router/render.ts",
      content: `target.innerHTML = location.hash.slice(1);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags innerHTML assigned from document.cookie", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/debug.ts",
      content: `panel.innerHTML = document.cookie;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags an outerHTML assignment sink from props", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/swap.tsx",
      content: `host.outerHTML = props.userHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags insertAdjacentHTML with a dynamic value", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/feed.ts",
      content: `list.insertAdjacentHTML("beforeend", item.contentHtml);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags document.write with an untrusted URL value", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/legacy/boot.ts",
      content: `document.write(location.search);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags Range.createContextualFragment with a dynamic value", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/dom/fragment.ts",
      content: `const frag = range.createContextualFragment(props.userHtml);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags the explicitly-unsafe setHTMLUnsafe sink", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/dom/unsafe.ts",
      content: `container.setHTMLUnsafe(response.data.body);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on insertAdjacentHTML with a static string literal", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/widgets/spacer.ts",
      content: `node.insertAdjacentHTML("beforeend", "<div class='spacer'></div>");\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on an outerHTML-to-outerHTML DOM serialization", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/hooks/clone.ts",
      content: `placeholder.outerHTML = svg.outerHTML;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on capture-and-restore of a node's own innerHTML (twenty-companion shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/renderer.js",
      content: `const originalHTML = generateButton.innerHTML;\nawait generate();\ngenerateButton.innerHTML = originalHTML;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a captured value concatenated with fresh input", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/renderer.js",
      content: `const mergedHtml = base.innerHTML + props.userHtml;\ntarget.innerHTML = mergedHtml;\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on mermaid-rendered SVG assigned from mermaid.render (tldraw shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/createMermaidDiagram.ts",
      content: `const svgHtml = (await mermaid.render("id", text, offscreen)).svg;\noffscreen.innerHTML = svgHtml;\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on the textarea entity-decode idiom (woocommerce decodeHtmlEntities shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/utils/decode.ts",
      content: `export function decodeHtmlEntities(text: string) {\n  const textArea = document.createElement("textarea");\n  textArea.innerHTML = text;\n  return textArea.value;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on optional-chained DOM serialization (Svg?.outerHTML shape)", () => {
    const findings = runScanRule(dangerousHtmlSink, {
      relativePath: "src/components/excalidraw-node.tsx",
      content: `return <div dangerouslySetInnerHTML={{ __html: Svg?.outerHTML ?? '' }} />;\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
