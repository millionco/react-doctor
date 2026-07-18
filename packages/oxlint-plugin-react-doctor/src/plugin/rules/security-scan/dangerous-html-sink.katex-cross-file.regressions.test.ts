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
});
