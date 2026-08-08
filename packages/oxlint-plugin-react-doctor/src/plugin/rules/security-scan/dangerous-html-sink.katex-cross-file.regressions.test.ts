import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { dangerousHtmlSink } from "./dangerous-html-sink.js";

describe("security-scan/dangerous-html-sink — cross-file KaTeX provenance", () => {
  it("distinguishes safe and raw cross-file KaTeX helper fallbacks", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-"));
    try {
      const safeHelperPath = join(directory, "safe-helper.ts");
      const rawHelperPath = join(directory, "raw-helper.ts");
      writeFileSync(
        safeHelperPath,
        `import katex from "katex";
         const escapeHtml = (value: string) => value.replaceAll("<", "&lt;");
         export const renderKaTeX = (value: string) => {
           try { return katex.renderToString(value); }
           catch { return \`<span>\${escapeHtml(value)}</span>\`; }
         };`,
      );
      writeFileSync(
        rawHelperPath,
        `import katex from "katex";
         export const renderMathToHtml = (value: string) => {
           try { return katex.renderToString(value); }
           catch { return value; }
         };`,
      );
      const runCrossFileScan = (filename: string, source: string) =>
        dangerousHtmlSink.scan?.({
          absolutePath: filename,
          relativePath: "src/math.tsx",
          content: source,
          isGeneratedBundle: false,
        }) ?? [];
      expect(
        runCrossFileScan(
          join(directory, "safe.tsx"),
          `import { renderKaTeX } from "./safe-helper";
           const html = renderKaTeX(props.value);
           export const Math = () => <div dangerouslySetInnerHTML={{ __html: html }} />;`,
        ),
      ).toHaveLength(0);
      expect(
        runCrossFileScan(
          join(directory, "raw.tsx"),
          `import { renderMathToHtml } from "./raw-helper";
           export const Math = () => (
             <div dangerouslySetInnerHTML={{ __html: renderMathToHtml(props.value) }} />
           );`,
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves a workspace alias and destructured options argument", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-workspace-"));
    try {
      const componentPath = join(directory, "apps/www/equation.tsx");
      const packageDirectory = join(directory, "packages/math/src");
      mkdirSync(join(directory, "apps/www"), { recursive: true });
      mkdirSync(packageDirectory, { recursive: true });
      writeFileSync(
        join(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            paths: { "@platejs/math": ["packages/math/src/index.ts"] },
          },
        }),
      );
      writeFileSync(
        join(packageDirectory, "index.ts"),
        'export { getEquationHtml } from "./get-equation-html";',
      );
      writeFileSync(
        join(packageDirectory, "get-equation-html.ts"),
        `import katex from "katex";
         export const getEquationHtml = ({ element, options }: Props) =>
           katex.renderToString(element.texExpression, options);`,
      );
      const runWorkspaceScan = (argumentProperties: string) =>
        dangerousHtmlSink.scan?.({
          absolutePath: componentPath,
          relativePath: "apps/www/equation.tsx",
          content: `import { getEquationHtml } from "@platejs/math";
            export const Equation = ({ element, dynamicProperties, dynamicTrust }: Props) => {
              const html = getEquationHtml({
                element,
                ${argumentProperties}
              });
              return <span dangerouslySetInnerHTML={{ __html: html }} />;
            };`,
          isGeneratedBundle: false,
        }) ?? [];
      expect(runWorkspaceScan("options: { throwOnError: false, trust: false },")).toHaveLength(0);
      expect(runWorkspaceScan("options: { trust: true },")).toHaveLength(1);
      expect(runWorkspaceScan("options: { trust: dynamicTrust },")).toHaveLength(1);
      expect(runWorkspaceScan("")).toHaveLength(0);
      expect(runWorkspaceScan("...dynamicProperties,")).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("propagates positional options through a cross-file KaTeX helper", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-options-"));
    try {
      writeFileSync(
        join(directory, "render-math.ts"),
        `import katex from "katex";
         export const renderMath = (value: string, options?: object) =>
           katex.renderToString(value, options);`,
      );
      const runCrossFileScan = (options: string) =>
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "math.tsx"),
          relativePath: "src/math.tsx",
          content: `import { renderMath } from "./render-math";
            export const Math = ({ value, options }: Props) => (
              <span dangerouslySetInnerHTML={{ __html: renderMath(value, ${options}) }} />
            );`,
          isGeneratedBundle: false,
        }) ?? [];

      expect(runCrossFileScan("{ trust: false }")).toHaveLength(0);
      expect(runCrossFileScan("{ throwOnError: false }")).toHaveLength(0);
      expect(runCrossFileScan("{ trust: true }")).toHaveLength(1);
      expect(runCrossFileScan("options")).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("follows a safe KaTeX HTML field returned across a helper boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-result-"));
    try {
      writeFileSync(
        join(directory, "render-math.ts"),
        `import katex from "katex";
         export const renderMath = (value: string, displayMode: boolean) => ({
           displayMode,
           html: katex.renderToString(value, { displayMode, throwOnError: false }),
         });`,
      );
      writeFileSync(
        join(directory, "render-unsafe-math.ts"),
        `import katex from "katex";
         export const renderMath = (value: string) => ({
           html: katex.renderToString(value, { trust: true }),
         });`,
      );
      const safeFindings =
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "math.tsx"),
          relativePath: "src/math.tsx",
          content: `import { renderMath } from "./render-math";
            export const Math = ({ value, displayMode }: Props) => {
              const renderedMath = renderMath(value, displayMode);
              return <span dangerouslySetInnerHTML={{ __html: renderedMath.html }} />;
            };`,
          isGeneratedBundle: false,
        }) ?? [];
      const unsafeFindings =
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "unsafe-math.tsx"),
          relativePath: "src/unsafe-math.tsx",
          content: `import { renderMath } from "./render-unsafe-math";
            export const Math = ({ value }: Props) => {
              const renderedMath = renderMath(value);
              return <span dangerouslySetInnerHTML={{ __html: renderedMath.html }} />;
            };`,
          isGeneratedBundle: false,
        }) ?? [];
      expect(safeFindings).toHaveLength(0);
      expect(unsafeFindings).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves dependent and destructured defaults across a KaTeX helper boundary", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-defaults-"));
    try {
      writeFileSync(
        join(directory, "render-math.ts"),
        `import katex from "katex";
         export const renderWithDependentDefault = (
           value: string,
           baseOptions: object,
           options: object = baseOptions,
         ) => katex.renderToString(value, options);
         export const renderWithDestructuredDefault = (
           value: string,
           { options = { trust: false } }: { options?: object } = {},
         ) => katex.renderToString(value, options);`,
      );
      const runCrossFileScan = (importedName: string, argumentsSource: string) =>
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "math.tsx"),
          relativePath: "src/math.tsx",
          content: `import { ${importedName} } from "./render-math";
            export const Math = ({ value, options }: Props) => (
              <span
                dangerouslySetInnerHTML={{
                  __html: ${importedName}(value${argumentsSource}),
                }}
              />
            );`,
          isGeneratedBundle: false,
        }) ?? [];

      expect(runCrossFileScan("renderWithDependentDefault", ", { trust: false }")).toHaveLength(0);
      expect(runCrossFileScan("renderWithDependentDefault", ", { trust: true }")).toHaveLength(1);
      expect(runCrossFileScan("renderWithDependentDefault", ", options")).toHaveLength(1);
      expect(runCrossFileScan("renderWithDestructuredDefault", "")).toHaveLength(0);
      expect(runCrossFileScan("renderWithDestructuredDefault", ", {}")).toHaveLength(0);
      expect(
        runCrossFileScan("renderWithDestructuredDefault", ", { options: { trust: false } }"),
      ).toHaveLength(0);
      expect(
        runCrossFileScan("renderWithDestructuredDefault", ", { options: { trust: true } }"),
      ).toHaveLength(1);
      expect(runCrossFileScan("renderWithDestructuredDefault", ", { options }")).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("proves bounded KaTeX caches with safe exclusive writes", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-cache-"));
    try {
      writeFileSync(
        join(directory, "render-math.ts"),
        `import katex from "katex";
         const cache = new Map<string, string>();
         export const renderMath = (value: string) => {
           const cached = cache.get(value);
           if (cached !== undefined) return cached;
           const html = katex.renderToString(value, { throwOnError: false });
           const oldestKey = cache.keys().next().value;
           if (oldestKey !== undefined) cache.delete(oldestKey);
           cache.set(value, html);
           return html;
         };`,
      );
      writeFileSync(
        join(directory, "render-unsafe-math.ts"),
        `import katex from "katex";
         const cache = new Map<string, string>();
         export const renderMath = (value: string, rawHtml: string) => {
           cache.set(value, rawHtml);
           return cache.get(value) ?? katex.renderToString(value);
         };`,
      );
      const runCacheScan = (helperName: string, argumentsSource: string) =>
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "math.tsx"),
          relativePath: "src/math.tsx",
          content: `import { useMemo } from "react";
            import { renderMath } from "./${helperName}";
            export const Math = ({ value, rawHtml }: Props) => {
              const html = useMemo(() => renderMath(value${argumentsSource}), [value, rawHtml]);
              return <span dangerouslySetInnerHTML={{ __html: html }} />;
            };`,
          isGeneratedBundle: false,
        }) ?? [];

      expect(runCacheScan("render-math", "")).toHaveLength(0);
      expect(runCacheScan("render-unsafe-math", ", rawHtml")).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("proves KaTeX assigned through a local with a static fallback", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-local-"));
    try {
      const runMutableLocalScan = (fallback: string) => {
        writeFileSync(
          join(directory, "render-math.ts"),
          `import katex from "katex";
           export const renderMath = (value: string, rawHtml: string) => {
             let html = "";
             try { html = katex.renderToString(value, { trust: false }); }
             catch { html = ${fallback}; }
             return html;
           };`,
        );
        return (
          dangerousHtmlSink.scan?.({
            absolutePath: join(directory, "math.tsx"),
            relativePath: "src/math.tsx",
            content: `import { renderMath } from "./render-math";
              export const Math = ({ value, rawHtml }: Props) => (
                <span dangerouslySetInnerHTML={{ __html: renderMath(value, rawHtml) }} />
              );`,
            isGeneratedBundle: false,
          }) ?? []
        );
      };

      expect(runMutableLocalScan('""')).toHaveLength(0);
      expect(runMutableLocalScan("rawHtml")).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("follows a cross-file KaTeX property through useMemo", () => {
    const directory = mkdtempSync(join(tmpdir(), "react-doctor-katex-memo-property-"));
    try {
      writeFileSync(
        join(directory, "render-math.ts"),
        `import katex from "katex";
         export const renderMath = (value: string) => ({
           html: katex.renderToString(value, { throwOnError: false }),
           displayMode: false,
         });`,
      );
      const findings =
        dangerousHtmlSink.scan?.({
          absolutePath: join(directory, "math.tsx"),
          relativePath: "src/math.tsx",
          content: `import { useMemo } from "react";
            import { renderMath } from "./render-math";
            export const Math = ({ value }: Props) => {
              const result = useMemo(() => renderMath(value), [value]);
              return <span dangerouslySetInnerHTML={{ __html: result.html }} />;
            };`,
          isGeneratedBundle: false,
        }) ?? [];
      expect(findings).toHaveLength(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
