---
"oxlint-plugin-react-doctor": patch
---

Fixed false positives in `dangerous-html-sink` (the highest-volume new rule) reported by RDE evals on `repos.json` (200 rootDir scans / 19 distinct repos / 51 total new security diagnostics).

- Email HTML components (RawHtml, \*Email templates in cal.com `packages/emails`, dub `packages/email`, etc.) were reported even though the rule intends to exempt them (mail clients strip scripts; browser XSS model does not apply). The `EMAIL_TEMPLATE_PATH_PATTERN` skip only looked at the scan-relative path and missed cases where `rootDir` was already the emails package (relativePath = `src/components/RawHtml.tsx`).
- Trusted rich-text renderers (tldraw `renderHtmlFromRichText(editor, richText)` result assigned to bare `html` then used at a sink in labels) were not recognized, unlike the existing katex / renderToStaticMarkup / hast-util cases in `ESCAPING_SERIALIZER_LIBRARY_PATTERN`. Same shape as the "KaTeX-rendered html identifiers" regression that already passes.

Updated `EMAIL_TEMPLATE_PATH_PATTERN` (now also matches RawHtml and \*Email filenames) and `ESCAPING_SERIALIZER_LIBRARY_PATTERN` (added `renderHtmlFromRichText`). Added two regression tests using the exact hit shapes from the 51-eval corpus.

A second eval pass (replaying the rule against every corpus hit's real source) surfaced four more false-positive classes, now fixed:

- **Empty / literal clears with a trailing comment** — `el.innerHTML = '' // clear` was flagged because the trailing line comment defeated `STRING_LITERAL_VALUE_PATTERN`, after which the value scan bled into the next statement and tainted on an unrelated token there (PostHog `NotebookNodeLatex` reading `content` on the following line). The literal/constant exemptions now tolerate a trailing line comment.
- **`createHTMLDocument()` parse-to-text** — a disconnected document (no browsing context, scripts never run) used to strip tags to text (tldraw `stripHtml`) is now treated as inert.
- **Detached `createElement` scratch nodes** — a node that is parsed, then queried / read back, and never attached to a live tree nor returned as a node (Plane `paste-asset`) is now inert; the existing "parsed HTML reaches the document" guard still fires when the node is appended.
- **In-house serializers + highlighter output via member access** — `render*HTML(...)` serializers (pierre `renderPartialHTML`) and highlighter output stored on an object (`highlightedFiles[0].darkHtml`, shiki) are exempt when a serializer library is present in the file, matching the existing bare-identifier handling.

Added seven regression tests (including a still-fires guard for object-stored HTML with no serializer library and for scratch nodes appended to the live tree) using the exact hit shapes from the corpus.

A full-corpus replay (8k+ rootDir scans) surfaced three more false-positive classes, now fixed:

- **Generated / minified bundles** — `dangerous-html-sink` now skips files the walker flagged as generated bundles (e.g. a minified `iconfont.js` whose inline SVG string tripped the line heuristics). XSS-sink review is for human-authored source, not build output.
- **Sanitized at the definition site** — `const clean = DOMPurify.sanitize(md.render(x))` then `__html: clean` is now exempt: a bare-identifier value is traced to a `DOMPurify` / `sanitize(...)` / `purify(...)` assignment in the file (the sink only sees the identifier).
- **HTML encoder output** — `encode*` entity encoders (`encodeNonAsciiHTML`) join the existing `escape*` recognition as escaped, non-live output.

Added four more regression tests (including a still-fires guard for a bare identifier that is never sanitized in the file).

A wider corpus pass added three further false-positive classes:

- **DOM-to-DOM content copies** — `target.innerHTML = other.innerHTML` / `= other.outerHTML` (optionally with a `.replace`/`.trim` transform) re-serializes content already in the document, so it is no injection boundary (a `+` concatenation is still judged, to catch spliced-in input).
- **camelCase sanitized identifiers** — `__html: htmlSanitized` is now recognized (the `sanitize` convention previously required a word boundary the camelCase name lacked).
- **hljs / Prism highlighters** — joined the serializer-library allow-list so highlighter output read via member access (`hljsResult.value`) is exempt.

Added five more regression tests (including a still-fires guard for DOM content concatenated with fresh input).

Two final classes from the corpus tail:

- **Commented-out sinks** — a sink that sits inside a `//` line comment or a block-comment line is no longer flagged (commented-out code never runs); a `://` in a URL on the same line does not trip the guard.
- **`<style>` element innerHTML** — `createElement('style')` then `el.innerHTML = css` injects CSS text, not executable markup (the DOM-API counterpart of the existing `<style dangerouslySetInnerHTML>` exemption).

Added three more regression tests.

A `/thermos` review pass hardened the exemptions against false negatives (a security rule must not hide a real sink), tightening the looser ones this changeset added:

- The serializer-library exemption no longer keys off a bare file-wide keyword (which would exempt any sink in a file that merely imports a highlighter). It now requires a **data-flow link** — the value identifier must be assigned from a serializer (`const html = katex.renderToString(...)`) — sharing one assignment-check path with the sanitizer exemption.
- `isInertParseTarget` forces **non-inert** when the target name is ever bound to a live DOM node (`getElementById`/`querySelector`/`.current`/`document.body`), closing same-name collisions across functions.
- The DOM-content-source exemption now bails when a **taint token follows the read** (`a.innerHTML.replace(x, props.userHtml)`), not only on `+` concatenation.
- The `escape`/`encode` sanitizer arm is scoped to HTML encoders (so `encodeURIComponent`/`escapeRegExp`/`encodeForDisplay` no longer exempt).
- The commented-out-sink skip strips string literals first, so a protocol-relative URL (`"//cdn"`) before a real sink is not mistaken for a `//` comment.

Added FN-guard regression tests for each (49 tests total).

A second full-corpus pass found the largest remaining false-positive class — **syntax-highlighter output** — and two smaller ones:

- Highlighter output (`highlightedHtml`, `file.highlightedContent`, `highlight*()` calls) is escaped, token-wrapped markup. It is usually routed through React state (`const [highlightedHtml, setHighlightedHtml] = useState(); setHighlightedHtml(await codeToHtml(code))`) or passed as a prop, so the data-flow assignment check never sees it. Now exempt: `highlight*()` calls (escaping serializers), `highlighted*` values (escaped-output naming convention), and present-tense `highlight*` values when the file uses a highlighter library (Shiki/Prism/highlight.js/…).
- Optional chaining in the DOM-serialization exemption (`Svg?.outerHTML`).
- The `<textarea>` HTML-entity decode idiom (`textArea.innerHTML = x; return textArea.value`) — textarea content is RCDATA, so scripts never execute — joins the `<style>` inert-element exemption.

Added six FN-guard regression tests (incl. a non-highlighter `renderedHtml` and a present-tense `highlight*` with no library still firing). 56 tests total.

### Detection coverage (recall)

Beyond precision, `dangerous-html-sink` was missing real DOM-XSS — a security rule must catch the dangerous cases, not just stay quiet. Added:

- **More sinks** — alongside `dangerouslySetInnerHTML` and `innerHTML =`, the rule now flags `outerHTML =` assignments, `el.insertAdjacentHTML(position, html)` (the value is the second argument), `document.write(ln)(html)`, `Range.createContextualFragment(html)`, and the explicitly-unsafe `Element.setHTMLUnsafe(html)` (the sanitizing `setHTML` is intentionally not a sink).
- **More taint sources** — the value-taint gate now recognizes the classic OWASP DOM-XSS sources it previously ignored: `location.hash`/`.search`/`.href`, `document.cookie`, `document.referrer`, `window.name`, `localStorage`/`sessionStorage`, and `URLSearchParams` (matched at word boundaries / on the source expression so identifier names like `themeLocalStorageKey` do not false-match).

Verified against the cached corpus: the new sinks surface previously-missed real injections (e.g. `el.insertAdjacentHTML(pos, content)`, `node.outerHTML = html`, `document.write(editor.getContent())`) while the exemption pipeline and the `isGeneratedBundle` skip keep minified-vendor noise out. Added 7 detection tests (5 must-fire DOM-XSS cases + 2 still-silent guards for static `insertAdjacentHTML` and `outerHTML`-to-`outerHTML` serialization).

A RDE parity pass against `main` surfaced three more false positives, now fixed:

- **`mcp-tool-capability-risk`** keyed its surface on every MCP entry point, so it flagged `new McpServer({...})` construction and static `registerPrompt(...)` calls whenever the file mentioned any capability. It now only matches actual TOOL handlers (`server.tool(`, `registerTool(`, `setRequestHandler(CallToolRequestSchema)`) — model-controlled action surfaces — not construction, tool listing, prompts (message templates), or resources (read-only). Added a regressions test (FP guards for construction/prompt + true-positive tool handlers).
- **`dangerous-html-sink`** now exempts capture-and-restore of a node's own serialized content (`const original = el.innerHTML; … el.innerHTML = original`) — restored markup never left the document — while still flagging a captured value concatenated with fresh input. It also recognizes Mermaid diagram output (`const svg = (await mermaid.render(...)).svg`) as escaping-serializer output, alongside KaTeX/Shiki/Prism.

This hardens the 6 new security-scan rules (`dangerous-html-sink`, `clickjacking-redirect-risk`, `insecure-crypto-risk`, `mcp-tool-capability-risk`, `raw-sql-injection-risk`, `url-prefilled-privileged-action`) that landed in the posture scanner.
