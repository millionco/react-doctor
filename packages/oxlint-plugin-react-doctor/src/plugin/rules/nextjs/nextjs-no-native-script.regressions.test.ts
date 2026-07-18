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
});
