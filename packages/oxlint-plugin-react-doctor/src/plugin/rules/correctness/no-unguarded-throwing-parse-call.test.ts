import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedThrowingParseCall } from "./no-unguarded-throwing-parse-call.js";

describe("no-unguarded-throwing-parse-call", () => {
  it("flags decodeURIComponent of a useParams path in a component body", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function RawFileViewer(params) {
        const path = decodeURIComponent(params.path);
        return path;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags decodeURIComponent of a searchParams value", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function Page() {
        const target = decodeURIComponent(searchParams.get("redirect"));
        return target;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags readableColor of a runtime theme color in a hook", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function useGetContrastTextColor(actualColorForReadable) {
        const contrast = readableColor(actualColorForReadable);
        return contrast;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a single-argument new URL of a runtime value", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function open(userInput) {
        return new URL(userInput);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for new URL with a base-origin second argument", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function middleware(request, path) {
        return NextResponse.redirect(new URL(path, request.url));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of window.location.href", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function readParams() {
        return new URL(window.location.href);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a framework request.url", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function handler(request) {
        const { searchParams } = new URL(request.url);
        return searchParams;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for new URL of a page.url() accessor", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function origin(page) {
        return new URL(page.url()).origin;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags new URL of location.pathname (not an absolute URL, throws)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function readParams() {
        return new URL(location.pathname);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new URL of a deep request chain (user-controlled)", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function handler(request) {
        return new URL(request.body.url);
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for new URL of a module constant / env base", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const endpoint = new URL("/api/users", process.env.PUBLIC_URL);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the decode is inside a try/catch", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function decode(redirectTo) {
        try {
          return decodeURIComponent(redirectTo);
        } catch {
          return null;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when routed through a safe* helper", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function safeReadableColor(color) {
        return readableColor(color);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for color parse work in a scripts/ file", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function mix(paletteHex) {
        return chroma(paletteHex).mix("red");
      }`,
      { filename: "scripts/mixColorPalettes.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decodeURIComponent of a string literal", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `const value = decodeURIComponent("%20fixed%20");`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for decodeURIComponent of a non-URL local variable", () => {
    const result = runRule(
      noUnguardedThrowingParseCall,
      `function run(token) {
        return decodeURIComponent(token);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
