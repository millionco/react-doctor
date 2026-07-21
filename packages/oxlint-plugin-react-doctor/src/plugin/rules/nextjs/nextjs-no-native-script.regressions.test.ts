import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoNativeScript } from "./nextjs-no-native-script.js";

describe("nextjs/nextjs-no-native-script — regressions", () => {
  it("stays silent on an inline theme-bootstrap script (dangerouslySetInnerHTML, no src)", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const Layout = ({ children }) => (
        <html suppressHydrationWarning>
          <head>
            <script
              suppressHydrationWarning
              dangerouslySetInnerHTML={{
                __html: "(function(){try{var t=localStorage.getItem('theme');document.documentElement.classList.add(t)}catch(e){}})()",
              }}
            />
          </head>
          <body>{children}</body>
        </html>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an inline snapshot script referencing a helper", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const Layout = () => (
        <head>
          <script
            id="extension-detection-postmessage-snapshot"
            dangerouslySetInnerHTML={{ __html: getSnapshotInlineScript() }}
          />
        </head>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an external third-party script", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const Layout = () => (
        <head>
          <script src="https://widget.example.com/embed.js" />
        </head>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a bare script with neither src nor inline html", () => {
    const result = runRule(nextjsNoNativeScript, `const C = () => <script />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("ignores async, defer, and module scripts that never block rendering", () => {
    for (const scriptJsx of [
      `<script async src="https://widget.example.com/embed.js" />`,
      `<script defer src="https://widget.example.com/embed.js" />`,
      `<script type="module" src="https://widget.example.com/embed.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("still flags statically disabled or dynamic async and defer attributes", () => {
    for (const scriptJsx of [
      `<script async={false} src="https://widget.example.com/embed.js" />`,
      `<script defer={false} src="https://widget.example.com/embed.js" />`,
      `<script async={0} src="https://widget.example.com/embed.js" />`,
      `<script defer={0} src="https://widget.example.com/embed.js" />`,
      `<script async={shouldLoadAsync} src="https://widget.example.com/embed.js" />`,
      `<script defer={shouldDefer} src="https://widget.example.com/embed.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("ignores statically truthy async and defer expressions", () => {
    for (const scriptJsx of [
      `<script async={"false"} src="https://widget.example.com/embed.js" />`,
      `<script defer={"false"} src="https://widget.example.com/embed.js" />`,
      `<script async={1} src="https://widget.example.com/embed.js" />`,
      `<script defer={1} src="https://widget.example.com/embed.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("flags scripts that explicitly restore render blocking", () => {
    for (const scriptJsx of [
      `<script async blocking="render" src="https://widget.example.com/async.js" />`,
      `<script defer blocking="styles render" src="https://widget.example.com/defer.js" />`,
      `<script type="module" blocking={"RENDER"} src="https://widget.example.com/module.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => <head>${scriptJsx}</head>;`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("flags render-blocking scripts inside an imported next/head alias", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `import DocumentHead from "next/head";
      const C = () => (
        <DocumentHead>
          <script async blocking="render" src="https://widget.example.com/async.js" />
        </DocumentHead>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat shadowed or unbound Head components as next/head", () => {
    for (const code of [
      `import Head from "next/head";
      const C = () => {
        const Head = ({ children }) => <section>{children}</section>;
        return <Head><script async blocking="render" src="https://widget.example.com/async.js" /></Head>;
      };`,
      `const C = () => (
        <Head><script async blocking="render" src="https://widget.example.com/async.js" /></Head>
      );`,
    ]) {
      const result = runRule(nextjsNoNativeScript, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays quiet when a later spread can override the render-blocking proof", () => {
    for (const scriptJsx of [
      `<script async blocking="render" type="text/javascript" src="https://widget.example.com/async.js" {...scriptProps} />`,
      `<script async type="text/javascript" src="https://widget.example.com/async.js" {...scriptProps} blocking="render" />`,
      `<script async blocking="render" type="text/javascript" {...scriptProps} src="https://widget.example.com/async.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => <head>${scriptJsx}</head>;`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("flags when explicit attributes after a spread restore the complete blocking proof", () => {
    for (const scriptJsx of [
      `<script
        {...scriptProps}
        async
        blocking="render"
        type="text/javascript"
        src="https://widget.example.com/async.js"
      />`,
      `<script
        {...scriptProps}
        async={false}
        defer={false}
        type="text/javascript"
        src="https://widget.example.com/classic.js"
      />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => <head>${scriptJsx}</head>;`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("does not let irrelevant static object spreads erase blocking evidence", () => {
    for (const scriptJsx of [
      `<script src="https://widget.example.com/classic.js" {...{ id: "analytics" }} />`,
      `<script {...{ id: "analytics" }} src="https://widget.example.com/classic.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it("resolves execution attributes from ordered static object spreads", () => {
    const reportCases = [
      `<script async src="https://widget.example.com/async.js" {...{ async: false }} />`,
      `<script type="application/ld+json" {...{ type: "text/javascript" }} src="https://widget.example.com/classic.js" />`,
      `<script src="https://widget.example.com/removed.js" {...{ src: null }} src="https://widget.example.com/restored.js" />`,
    ];
    const passCases = [
      `<script {...{ async: false }} async src="https://widget.example.com/async.js" />`,
      `<script {...{ type: "text/javascript" }} type="application/ld+json" src="https://widget.example.com/data.js" />`,
      `<script src="https://widget.example.com/removed.js" {...{ src: null }} />`,
    ];
    for (const scriptJsx of reportCases) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
    for (const scriptJsx of passCases) {
      const result = runRule(nextjsNoNativeScript, `const C = () => ${scriptJsx};`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("ignores non-render and dynamic blocking modes on non-blocking scripts", () => {
    for (const scriptJsx of [
      `<script async blocking="future-mode" src="https://widget.example.com/async.js" />`,
      `<script defer blocking={blockingMode} src="https://widget.example.com/defer.js" />`,
      `<script type="module" blocking="" src="https://widget.example.com/module.js" />`,
    ]) {
      const result = runRule(nextjsNoNativeScript, `const C = () => <head>${scriptJsx}</head>;`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("ignores render-blocking tokens outside the document head", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const C = () => (
        <body>
          <script async blocking="render" src="https://widget.example.com/embed.js" />
        </body>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still ignores non-executable script types", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const C = () => (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("normalizes static script types from JSX expressions and HTML casing", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const Scripts = () => <><script type={"application/ld+json"}>data</script><script type="TEXT/JAVASCRIPT" src="https://widget.example.com/embed.js" /><script type={\` Module \`} src="https://widget.example.com/module.js" /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves dynamic and omitted type uncertainty across spreads", () => {
    const result = runRule(
      nextjsNoNativeScript,
      `const Scripts = ({ type, props }) => <><script type={type} src="https://widget.example.com/dynamic.js" /><script {...props} async={false} defer={false} type={null} src="https://widget.example.com/default.js" /><script type="application/ld+json" {...props} src="https://widget.example.com/unknown.js" /></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
