import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoImgElement } from "./nextjs-no-img-element.js";

let temporaryDirectory: string;
const PERFORMANCE_HELPER_COUNT = 80;
const PERFORMANCE_MODULE_COUNT = 200;
const PERFORMANCE_BUDGET_MS = 4_000;
const PERFORMANCE_TEST_TIMEOUT_MS = 10_000;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "nextjs-img-renderer-"));
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixtureFile = (relativePath: string, sourceText: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, sourceText, "utf8");
  return absolutePath;
};

const runHelperRule = (helperPath: string) =>
  runRule(nextjsNoImgElement, fs.readFileSync(helperPath, "utf8"), {
    filename: helperPath,
    settings: { "react-doctor": { rootDirectory: temporaryDirectory } },
  });

const writeFunctionHelper = (): string =>
  writeFixtureFile(
    "lib/card.tsx",
    `
      export const cardLayout = (source: string) => (
        <div><img src={source} alt="" width={10} height={10} /></div>
      );
    `,
  );

describe("nextjs-no-img-element — generated-image consumers", () => {
  it("does not prescribe next/image for a helper consumed only by ImageResponse", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";

        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );

    const result = runHelperRule(helperPath);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves renamed helper and ImageResponse imports", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse as OgResponse } from "next/og";
        import { cardLayout as buildCard } from "../../../lib/card";
        export const GET = () => new OgResponse(buildCard("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("resolves namespace helper and ImageResponse imports", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import * as NextOg from "next/og";
        import * as Card from "../../../lib/card";
        export const GET = () => new NextOg.ImageResponse(Card.cardLayout("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("recognizes an exclusive satori consumer", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "lib/render-card.tsx",
      `
        import satori from "satori";
        import { cardLayout } from "./card";
        export const renderCard = () => satori(cardLayout("/photo.png"), { width: 10, height: 10 });
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows renamed re-exports across two modules", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile("lib/card-index.ts", `export { cardLayout as layout } from "./card";`);
    writeFixtureFile("lib/index.ts", `export { layout as buildCard } from "./card-index";`);
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { buildCard } from "../../../lib";
        export const GET = () => new ImageResponse(buildCard("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows export-star barrels", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile("lib/index.ts", `export * from "./card";`);
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows default exports and local const aliases", () => {
    const helperPath = writeFixtureFile(
      "lib/card.tsx",
      `
        const cardLayout = (source: string) => <img src={source} alt="" />;
        export default cardLayout;
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import importedCardLayout from "../../../lib/card";
        const buildCard = importedCardLayout;
        export const GET = () => new ImageResponse(buildCard("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows exported forwarding helpers across two modules", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "lib/card-wrapper.tsx",
      `
        import { cardLayout } from "./card";
        export const wrappedCard = (source: string) => cardLayout(source);
      `,
    );
    writeFixtureFile(
      "lib/card-wrapper-two.tsx",
      `
        import { wrappedCard } from "./card-wrapper";
        export const wrappedCardAgain = (source: string) => {
          return wrappedCard(source);
        };
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { wrappedCardAgain } from "../../../lib/card-wrapper-two";
        export const GET = () => new ImageResponse(wrappedCardAgain("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows conditional forwarding and transparent TypeScript wrappers", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "lib/card-wrapper.tsx",
      `
        import { cardLayout } from "./card";
        export const wrappedCard = (source: string, enabled: boolean) =>
          enabled ? (cardLayout!)(source) : null;
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { wrappedCard } from "../../../lib/card-wrapper";
        export const GET = () => new (ImageResponse as typeof ImageResponse)(
          wrappedCard("/photo.png", true),
        );
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("recognizes an exported JSX component consumed only by ImageResponse", () => {
    const helperPath = writeFixtureFile(
      "lib/card.tsx",
      `export const Card = () => <img src="/photo.png" alt="" width={10} height={10} />;`,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { Card } from "../../../lib/card";
        export const GET = () => new ImageResponse(<Card />);
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("follows an exported JSX forwarding component", () => {
    const helperPath = writeFixtureFile(
      "lib/card.tsx",
      `export const Card = () => <img src="/photo.png" alt="" />;`,
    );
    writeFixtureFile(
      "lib/wrapped-card.tsx",
      `
        import { Card } from "./card";
        export const WrappedCard = () => <Card />;
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { WrappedCard } from "../../../lib/wrapped-card";
        export const GET = () => new ImageResponse(<WrappedCard />);
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("preserves the finding for an ordinary DOM consumer", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/page.tsx",
      `
        import { cardLayout } from "../lib/card";
        export default function Page() { return cardLayout("/photo.png"); }
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when the helper is shared by DOM and raster consumers", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    writeFixtureFile(
      "app/page.tsx",
      `
        import { cardLayout } from "../lib/card";
        export default function Page() { return cardLayout("/photo.png"); }
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding for a locally shadowed ImageResponse binding", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => {
          const ImageResponse = (value: unknown) => value;
          return ImageResponse(cardLayout("/photo.png"));
        };
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding for a static dynamic import of the helper module", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    writeFixtureFile("app/page.tsx", `export const loadCard = () => import("../lib/card");`);

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding for a CommonJS load of the helper module", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    writeFixtureFile("app/page.tsx", `const Card = require("../lib/card"); export default Card;`);

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when an invoked result escapes through an object", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        const renderers = { cardLayout };
        export const GET = () => new ImageResponse(renderers.cardLayout("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when an opaque transform is nested inside the renderer input", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        const transform = (value: unknown) => value;
        export const GET = () => new ImageResponse(transform(cardLayout("/photo.png")));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when an opaque declaration wrapper owns the function", () => {
    const helperPath = writeFixtureFile(
      "lib/card.tsx",
      `
        declare const registerRenderer: <Component>(component: Component) => Component;
        const Card = registerRenderer(() => <img src="/photo.png" alt="" />);
        export default Card;
      `,
    );
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import Card from "../../../lib/card";
        export const GET = () => new ImageResponse(<Card />);
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when a sequence discards the helper result", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse((cardLayout("/photo.png"), <div />));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("recognizes the final sequence operand as renderer input", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse((void 0, cardLayout("/photo.png")));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it("preserves the finding when an MDX production consumer may render the helper", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    writeFixtureFile(
      "app/page.mdx",
      `
        import { cardLayout } from "../lib/card";
        {cardLayout("/photo.png")}
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding for an unresolved workspace package consumer", () => {
    const helperPath = writeFixtureFile(
      "packages/ui/src/card.tsx",
      `export const Card = () => <img src="/photo.png" alt="" />;`,
    );
    writeFixtureFile(
      "packages/ui/package.json",
      JSON.stringify({ name: "@repo/ui", exports: "./src/card.tsx" }),
    );
    writeFixtureFile(
      "packages/ui/src/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { Card } from "./card";
        export const GET = () => new ImageResponse(<Card />);
      `,
    );
    writeFixtureFile(
      "apps/web/app/page.tsx",
      `
        import { Card } from "@repo/ui";
        export default function Page() { return <Card />; }
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding for a computed namespace access", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import * as Card from "../../../lib/card";
        const key = "cardLayout";
        export const GET = () => new ImageResponse(Card[key]("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toHaveLength(1);
  });

  it("preserves the finding when renderer ownership is unavailable", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    const result = runRule(nextjsNoImgElement, fs.readFileSync(helperPath, "utf8"), {
      filename: helperPath,
    });

    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores test-only consumers when proving production ownership", () => {
    const helperPath = writeFunctionHelper();
    writeFixtureFile(
      "app/api/card/route.tsx",
      `
        import { ImageResponse } from "next/og";
        import { cardLayout } from "../../../lib/card";
        export const GET = () => new ImageResponse(cardLayout("/photo.png"));
      `,
    );
    writeFixtureFile(
      "lib/card.test.tsx",
      `
        import { renderToStaticMarkup } from "react-dom/server";
        import { cardLayout } from "./card";
        export const markup = renderToStaticMarkup(cardLayout("/photo.png"));
      `,
    );

    expect(runHelperRule(helperPath).diagnostics).toEqual([]);
  });

  it(
    "keeps a project-scale ownership scan bounded across many exported helpers",
    { timeout: PERFORMANCE_TEST_TIMEOUT_MS },
    () => {
      const helperDeclarations = Array.from(
        { length: PERFORMANCE_HELPER_COUNT },
        (_unusedValue, helperIndex) =>
          `export const Card${helperIndex} = () => <img src="/photo-${helperIndex}.png" alt="" />;`,
      );
      const helperPath = writeFixtureFile("lib/cards.tsx", helperDeclarations.join("\n"));
      for (let moduleIndex = 0; moduleIndex < PERFORMANCE_MODULE_COUNT; moduleIndex += 1) {
        writeFixtureFile(
          `features/feature-${moduleIndex}.ts`,
          `export const feature${moduleIndex} = ${moduleIndex};`,
        );
      }
      const helperNames = Array.from(
        { length: PERFORMANCE_HELPER_COUNT },
        (_unusedValue, helperIndex) => `Card${helperIndex}`,
      );
      writeFixtureFile(
        "app/api/card/route.tsx",
        `
          import { ImageResponse } from "next/og";
          import { ${helperNames.join(", ")} } from "../../../lib/cards";
          export const GET = () => new ImageResponse(
            <div>${helperNames.map((helperName) => `<${helperName} />`).join("")}</div>,
          );
        `,
      );

      const startedAtMs = performance.now();
      const result = runHelperRule(helperPath);
      const durationMs = performance.now() - startedAtMs;

      expect(result.diagnostics).toEqual([]);
      expect(durationMs).toBeLessThan(PERFORMANCE_BUDGET_MS);
    },
  );
});
