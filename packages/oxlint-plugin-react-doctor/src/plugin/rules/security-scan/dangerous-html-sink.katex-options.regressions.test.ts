import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { dangerousHtmlSink } from "./dangerous-html-sink.js";

const scan = (content: string) =>
  runScanRule(dangerousHtmlSink, {
    relativePath: "src/components/chat/message/katex-renderer.tsx",
    content,
  });

describe("security-scan/dangerous-html-sink — KaTeX options", () => {
  it.each([
    "katex.renderToString(value, { trust: true })",
    "katex.renderToString(value, { trust: allowTrustedCommand })",
    "katex.renderToString(value, options)",
    "katex.renderToString(value, getOptions())",
    "katex.renderToString(value, { ...options })",
    "katex.renderToString(value, { trust: false, ...options })",
  ])("reports unsafe or unknown KaTeX options: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value }: { value: string }) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it.each([
    "false && katex.renderToString(value, options)",
    "true || katex.renderToString(value, options)",
    'false ? katex.renderToString(value, options) : ""',
    'true ? "" : katex.renderToString(value, options)',
    '0 ? katex.renderToString(value, options) : ""',
    '1 ? "" : katex.renderToString(value, options)',
    'null ? katex.renderToString(value, options) : ""',
    '"" ? katex.renderToString(value, options) : ""',
    '"ready" ? "" : katex.renderToString(value, options)',
    '(true ? "ready" : katex.renderToString(value, options)) || ""',
    '(false ? katex.renderToString(value, options) : "ready") || ""',
    '(true ? "ready" : katex.renderToString(value, options)) ?? ""',
    '(false ? katex.renderToString(value, options) : "ready") ?? ""',
  ])("ignores unknown KaTeX options in a statically unreachable branch: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, options }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "true && katex.renderToString(value, options)",
    "false || katex.renderToString(value, options)",
    'true ? katex.renderToString(value, options) : ""',
    'false ? "" : katex.renderToString(value, options)',
    '1 ? katex.renderToString(value, options) : ""',
    '0 ? "" : katex.renderToString(value, options)',
    '"ready" ? katex.renderToString(value, options) : ""',
    '"" ? "" : katex.renderToString(value, options)',
    '(true ? katex.renderToString(value, options) : "") || ""',
    '(false ? "" : katex.renderToString(value, options)) ?? ""',
  ])("reports unknown KaTeX options in a statically reachable branch: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, options }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it.each([
    "renderMath(value, { trust: false })",
    "renderMath(value, { throwOnError: false })",
    "renderMath(value, undefined)",
    "renderMath(value)",
  ])("accepts safe options forwarded through a local helper: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      const renderMath = (value: string, options?: object) =>
        katex.renderToString(value, options);
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "const renderMath = (value: string, options = { trust: false }) => katex.renderToString(value, options);",
    "const renderMath = (value: string, options = { throwOnError: false }) => katex.renderToString(value, options);",
  ])("accepts safe local helper options defaults: %s", (helperSource) => {
    const findings = scan(`
      import katex from "katex";
      ${helperSource}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it("accepts safe caller options that override an unsafe local helper default", () => {
    const findings = scan(`
      import katex from "katex";
      const renderMath = (value: string, options = { trust: true }) =>
        katex.renderToString(value, options);
      export const MathNode = ({ value }: Props) => (
        <span
          dangerouslySetInnerHTML={{
            __html: renderMath(value, { trust: false }),
          }}
        />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "renderMath(value, { trust: false })",
    "renderMath(value, { trust: false }, undefined)",
    "renderMath(value, { trust: false }, void 0)",
  ])("accepts a safe earlier parameter used by a later options default: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      const renderMath = (
        value: string,
        baseOptions: object,
        options: object = baseOptions,
      ) => katex.renderToString(value, options);
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each(["renderMath(value, { trust: true })", "renderMath(value, options)"])(
    "rejects an unsafe earlier parameter used by a later options default: %s",
    (expression) => {
      const findings = scan(`
      import katex from "katex";
      const renderMath = (
        value: string,
        baseOptions: object,
        options: object = baseOptions,
      ) => katex.renderToString(value, options);
      export const MathNode = ({ value, options }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

      expect(findings).toHaveLength(1);
    },
  );

  it("preserves nested parameter proofs through a dependent options default", () => {
    const findings = scan(`
      import katex from "katex";
      const renderInner = (value: string, options: object) =>
        katex.renderToString(value, options);
      const renderOuter = (
        value: string,
        baseOptions: object,
        options: object = baseOptions,
      ) => renderInner(value, options);
      export const MathNode = ({ value }: Props) => (
        <span
          dangerouslySetInnerHTML={{
            __html: renderOuter(value, { trust: false }),
          }}
        />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "renderMath(value, {})",
    "renderMath(value, { options: undefined })",
    "renderMath(value, { options: void 0 })",
    "renderMath(value, { options: { trust: false } })",
    "renderMath(value)",
  ])("accepts safe destructured options defaults and overrides: %s", (expression) => {
    const findings = scan(`
      import katex from "katex";
      const renderMath = (
        value: string,
        { options = { trust: false } }: RenderOptions = {},
      ) => katex.renderToString(value, options);
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each(["renderMath(value, { options: { trust: true } })", "renderMath(value, { options })"])(
    "rejects unsafe destructured options overrides: %s",
    (expression) => {
      const findings = scan(`
      import katex from "katex";
      const renderMath = (
        value: string,
        { options = { trust: false } }: RenderOptions = {},
      ) => katex.renderToString(value, options);
      export const MathNode = ({ value, options }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
      );
    `);

      expect(findings).toHaveLength(1);
    },
  );

  it.each([
    ["{ trust: false }", 0],
    ["{ trust: true }", 1],
    ["options", 1],
  ])(
    "resolves a destructured options default from an earlier parameter: %s",
    (baseOptions, expectedFindingCount) => {
      const findings = scan(`
        import katex from "katex";
        const renderMath = (
          value: string,
          baseOptions: object,
          { options = baseOptions }: RenderOptions = {},
        ) => katex.renderToString(value, options);
        export const MathNode = ({ value, options }: Props) => (
          <span
            dangerouslySetInnerHTML={{
              __html: renderMath(value, ${baseOptions}),
            }}
          />
        );
      `);

      expect(findings).toHaveLength(expectedFindingCount);
    },
  );

  it.each([
    ["renderMath(value, { trust: true })", "{ trust: false }"],
    ["renderMath(value, options)", "{ trust: false }"],
    ["renderMath(value, getOptions())", "{ trust: false }"],
    ["renderMath(value, undefined)", "{ trust: true }"],
    ["renderMath(value)", "{ trust: true }"],
    ["renderMath(value)", "getOptions()"],
  ])(
    "reports unsafe or unknown options forwarded through a local helper: %s",
    (expression, defaultOptions) => {
      const findings = scan(`
        import katex from "katex";
        const renderMath = (value: string, localOptions = ${defaultOptions}) =>
          katex.renderToString(value, localOptions);
        export const MathNode = ({ value, options }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: ${expression} }} />
        );
      `);

      expect(findings).toHaveLength(1);
    },
  );

  it("accepts an unknown options spread overridden by trust false", () => {
    const findings = scan(`
      import katex from "katex";
      export const MathNode = ({ value, options }: Props) => (
        <span
          dangerouslySetInnerHTML={{
            __html: katex.renderToString(value, { ...options, trust: false }),
          }}
        />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "options.trust = true",
    "alias.trust = true",
    "Object.assign(options, { trust: true })",
    "options[dynamicKey] = true",
  ])("rejects a mutated KaTeX options trust boundary: %s", (mutation) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false, displayMode: true };
      const alias = options;
      ${mutation};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    "options.displayMode = false",
    "options.throwOnError = false",
    "delete options.displayMode",
    "Object.assign(options, { displayMode: false })",
    "Object.defineProperties(options, { displayMode: { value: false } })",
  ])("keeps unrelated options mutations safe: %s", (mutation) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false, displayMode: true };
      ${mutation};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it.each([
    "options.trust = false",
    "options.trust = undefined",
    "options.trust = null",
    "options.trust = 0",
    "delete options.trust",
    "Object.assign(options, { trust: false })",
    "Object.defineProperty(options, 'trust', { value: false })",
    "Object.defineProperties(options, { trust: { value: false } })",
    "Reflect.defineProperty(options, 'trust', { value: false })",
    "Reflect.set(options, 'trust', false)",
  ])("accepts a final statically untrusted options write: %s", (finalWrite) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: true, ...unknownOptions };
      ${finalWrite};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it.each([
    "options.trust = true",
    "options.trust = dynamicTrust",
    "options[dynamicKey] = false",
    "Object.assign(options, { trust: true })",
    "Object.defineProperty(options, 'trust', { value: true })",
    "Object.defineProperty(options, 'trust', { get: () => dynamicTrust })",
    "Object.defineProperties(options, { trust: { value: true } })",
    "Object.defineProperties(options, { trust: { get: () => dynamicTrust } })",
    "Object.defineProperties(options, descriptors)",
    "Reflect.defineProperty(options, 'trust', { value: true })",
    "Reflect.defineProperty(options, 'trust', { get: () => dynamicTrust })",
  ])("rejects a final trusted or unknown options write: %s", (finalWrite) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false };
      ${finalWrite};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    "Object.defineProperty(options, 'trust', { configurable: true })",
    "Object.defineProperties(options, { trust: { configurable: true } })",
    "Reflect.defineProperty(options, 'trust', { configurable: true })",
  ])("preserves a safe trust value across an attribute-only descriptor: %s", (write) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false };
      ${write};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });

  it.each([
    "Object.defineProperty(options, 'trust', { configurable: true })",
    "Object.defineProperties(options, { trust: { configurable: true } })",
    "Reflect.defineProperty(options, 'trust', { configurable: true })",
  ])("preserves an unsafe trust value across an attribute-only descriptor: %s", (write) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: true };
      ${write};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it("resolves ordered const spreads and explicit falsy trust values", () => {
    expect(
      scan(`
        import katex from "katex";
        const base = { trust: false };
        const options = { ...base };
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
        );
      `),
    ).toHaveLength(0);
    expect(
      scan(`
        import katex from "katex";
        const options = { trust: undefined, ...unknownOptions };
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
        );
      `),
    ).toHaveLength(1);
  });

  it.each(["const options = { ...source }", "const options = {}; Object.assign(options, source)"])(
    "preserves unsafe trust copied before a safe source mutation: %s",
    (copyStatement) => {
      const findings = scan(`
      import katex from "katex";
      const source = { trust: true };
      ${copyStatement};
      source.trust = false;
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

      expect(findings).toHaveLength(1);
    },
  );

  it.each(["const options = { ...source }", "const options = {}; Object.assign(options, source)"])(
    "preserves safe trust copied before an unsafe source mutation: %s",
    (copyStatement) => {
      const findings = scan(`
      import katex from "katex";
      const source = { trust: false };
      ${copyStatement};
      source.trust = true;
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

      expect(findings).toHaveLength(0);
    },
  );

  it("distinguishes called, uncalled, and unreachable options mutators", () => {
    expect(
      scan(`
        import katex from "katex";
        const options = { trust: false };
        const mutateLater = () => { options.trust = true; };
        if (false) options.trust = true;
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
        );
      `),
    ).toHaveLength(0);
    expect(
      scan(`
        import katex from "katex";
        const options = { trust: false };
        mutate();
        export const MathNode = ({ value }: Props) => (
          <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
        );
        function mutate() { options.trust = true; }
      `),
    ).toHaveLength(1);
  });

  it("rejects trusted KaTeX options mutated before use in the same function", () => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false };
      export const MathNode = ({ value }: Props) => {
        options.trust = true;
        return <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />;
      };
    `);

    expect(findings).toHaveLength(1);
  });

  it("rejects trusted KaTeX options mutated in a single-iteration do-while loop", () => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: false };
      do {
        options.trust = true;
      } while (false);
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it("does not trust a safe options mutation after a potentially throwing statement", () => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: true };
      try {
        mightThrow();
        options.trust = false;
      } catch {}
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

    expect(findings).toHaveLength(1);
  });

  it("accepts a final statically safe options write in a finally block", () => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: true };
      try {
        mightThrow();
      } catch {} finally {
        options.trust = false;
      }
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "if (condition) options.trust = false",
    "condition && (options.trust = false)",
    "for (const item of items) options.trust = false",
    "if (condition) makeSafe()",
  ])("rejects potentially trusted options after conditional trust refinement: %s", (refinement) => {
    const findings = scan(`
      import katex from "katex";
      const options = { trust: true };
      const makeSafe = () => { options.trust = false; };
      ${refinement};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it("accepts options that remain safe across a conditional trust refinement", () => {
    const findings = scan(`
      import katex from "katex";
      const options = { displayMode: true };
      if (condition) options.trust = false;
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value, options) }} />
      );
    `);

    expect(findings).toHaveLength(0);
  });

  it.each([
    "katex.renderToString = (value: string) => value",
    "alias.renderToString = (value: string) => value",
    "Object.assign(katex, { renderToString: (value: string) => value })",
    "Object.defineProperties(katex, { renderToString: { value: (value: string) => value } })",
    "Object.defineProperties(katex, { version: { value: '1' }, renderToString: { value: (value: string) => value } })",
    "Object.defineProperties(katex, namespaceDescriptors)",
  ])("rejects a mutated KaTeX renderer: %s", (mutation) => {
    const findings = scan(`
      import katex from "katex";
      const alias = katex;
      ${mutation};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);
    expect(findings).toHaveLength(1);
  });

  it.each([
    'katex.version = "1"',
    "katex.render = () => null",
    'Object.assign(katex, { version: "1" })',
    'Object.defineProperties(katex, { version: { value: "1" } })',
    'Object.defineProperties(katex, { version: { value: "1" }, render: { value: () => null } })',
  ])("keeps unrelated KaTeX namespace mutations safe: %s", (mutation) => {
    const findings = scan(`
      import katex from "katex";
      ${mutation};
      export const MathNode = ({ value }: Props) => (
        <span dangerouslySetInnerHTML={{ __html: katex.renderToString(value) }} />
      );
    `);
    expect(findings).toHaveLength(0);
  });
});
