import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { remotionCalculateMetadataFetchSignal } from "./remotion-calculate-metadata-fetch-signal.js";
import { remotionDeterministicRandomness } from "./remotion-deterministic-randomness.js";
import { remotionNoCssAnimation } from "./remotion-no-css-animation.js";
import { remotionNoCssTransition } from "./remotion-no-css-transition.js";
import { remotionNoCssUrlAssets } from "./remotion-no-css-url-assets.js";
import { remotionNoModuleScopeDelayRender } from "./remotion-no-module-scope-delay-render.js";
import { remotionNoNativeMediaElements } from "./remotion-no-native-media-elements.js";
import { remotionNoNextImage } from "./remotion-no-next-image.js";
import { remotionStableDelayRenderHandle } from "./remotion-stable-delay-render-handle.js";

const expectDiagnosticCount = (
  rule: Rule,
  code: string,
  count: number,
  options?: RunRuleOptions,
): void => {
  const result = runRule(rule, code, options);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

const createRemotionProjectFixture = (files: Readonly<Record<string, string>>): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-remotion-"));
  for (const [relativePath, sourceText] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, sourceText);
  }
  return rootDirectory;
};

describe("remotion-no-css-animation", () => {
  it("flags CSS animation properties and Tailwind animation classes", () => {
    expectDiagnosticCount(
      remotionNoCssAnimation,
      `
        import {interpolate} from 'remotion';
        import {useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <div className="motion-safe:animate-spin" style={{animationName: 'spin', animation: 'fade 1s'}} />;
        };
      `,
      3,
    );
  });

  it("allows frame-driven animation and explicit animation disabling", () => {
    expectDiagnosticCount(
      remotionNoCssAnimation,
      `
        import {interpolate, useCurrentFrame} from 'remotion';
        export const Scene = () => {
          const frame = useCurrentFrame();
          return <div className="animate-none" style={{opacity: interpolate(frame, [0, 10], [0, 1])}} />;
        };
      `,
      0,
    );
  });

  it("ignores ordinary React files and non-inline style objects", () => {
    expectDiagnosticCount(
      remotionNoCssAnimation,
      `
        const style = {animation: 'fade 1s'};
        export const Scene = () => <div className="animate-spin" style={style} />;
      `,
      0,
    );
  });

  it("ignores ordinary UI that only imports a scoped Remotion utility", () => {
    expectDiagnosticCount(
      remotionNoCssAnimation,
      `import {makeRect} from '@remotion/shapes'; export const Spinner = () => <div style={{animation: 'spin 1s'}}/>;`,
      0,
    );
  });
});

describe("remotion-no-css-transition", () => {
  it("flags CSS transition properties and Tailwind transition classes", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `
        import {useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <div className="hover:transition-colors" style={{transition: 'all 1s', transitionProperty: 'opacity'}} />;
        };
      `,
      3,
    );
  });

  it("allows frame-driven styles and transition-none", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `
        import {useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <div className="transition-none" style={{opacity: 1}} />;
        };
      `,
      0,
    );
  });

  it("ignores transition syntax without a Remotion import", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `export const Button = () => <button className="transition-all" style={{transition: 'all 1s'}} />;`,
      0,
    );
  });

  it("does not treat a type-only Remotion import as runtime evidence", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `import type {CalculateMetadataFunction} from 'remotion'; export const Button = () => <button className="transition-all" />;`,
      0,
    );
  });

  it("ignores browser UI that only uses AbsoluteFill for layout", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `import {AbsoluteFill} from 'remotion'; export const DocsDemo = () => <AbsoluteFill style={{transition: 'opacity 1s'}}/>;`,
      0,
    );
  });

  it("treats @remotion/media components as render evidence", () => {
    expectDiagnosticCount(
      remotionNoCssTransition,
      `import {Video} from '@remotion/media'; export const Scene = () => <Video style={{transition: 'opacity 1s'}}/>;`,
      1,
    );
  });
});

describe("remotion-deterministic-randomness", () => {
  it("flags Math.random in component render and render-preserving callbacks", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `
        import {useCurrentFrame} from 'remotion';
        import {useMemo, useState} from 'react';
        export const Scene = () => {
          useCurrentFrame();
          const first = Math.random();
          const second = useMemo(() => Math.random(), []);
          const [third] = useState(() => Math.random());
          return <div>{first + second + third}</div>;
        };
      `,
      3,
    );
  });

  it("flags Math.random in a custom hook", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `
        import {useCurrentFrame} from 'remotion';
        export const useParticle = () => {
          useCurrentFrame();
          return Math.random();
        };
      `,
      1,
    );
  });

  it("flags computed and globalThis Math.random spellings during render", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `
        import {useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <div>{Math['random']() + globalThis.Math.random()}</div>;
        };
      `,
      2,
    );
  });

  it("allows seeded random, effects, event handlers, and a shadowed Math", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `
        import {random} from 'remotion';
        import {useEffect} from 'react';
        export const Scene = () => {
          const Math = {random: () => 0.5};
          useEffect(() => globalThis.Math.random(), []);
          return <button onClick={() => globalThis.Math.random()}>{random('seed') + Math.random()}</button>;
        };
      `,
      0,
    );
  });

  it("ignores Math.random outside render and without Remotion imports", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `
        const value = Math.random();
        export const Scene = () => <div>{Math.random()}</div>;
      `,
      0,
    );
  });

  it("ignores Math.random in UI backed only by a scoped Remotion utility", () => {
    expectDiagnosticCount(
      remotionDeterministicRandomness,
      `import {threeDIntoSvgPath} from '@remotion/svg-3d-engine'; export const Face = () => <path id={String(Math.random())}/>;`,
      0,
    );
  });

  it("flags an anonymous imported composition", () => {
    const sceneSource = `export default () => <div>{Math.random()}</div>;`;
    const rootDirectory = createRemotionProjectFixture({
      "scene.tsx": sceneSource,
      "root.tsx": `import {Composition} from 'remotion'; import Scene from './scene'; export const Root = () => <Composition component={Scene}/>;`,
    });
    try {
      expectDiagnosticCount(remotionDeterministicRandomness, sceneSource, 1, {
        filename: path.join(rootDirectory, "scene.tsx"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

describe("remotion-no-native-media-elements", () => {
  it("flags native image, video, audio, and iframe elements", () => {
    expectDiagnosticCount(
      remotionNoNativeMediaElements,
      `
        import {AbsoluteFill, useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <AbsoluteFill><img src="a.png"/><video/><audio/><iframe/></AbsoluteFill>;
        };
      `,
      4,
    );
  });

  it("allows Remotion media components and similarly named custom components", () => {
    expectDiagnosticCount(
      remotionNoNativeMediaElements,
      `
        import {AbsoluteFill, Img, IFrame} from 'remotion';
        import {Audio, Video} from '@remotion/media';
        export const Scene = () => <AbsoluteFill><Img/><IFrame/><Audio/><Video/><Image/></AbsoluteFill>;
      `,
      0,
    );
  });

  it("ignores native media in files unrelated to Remotion", () => {
    expectDiagnosticCount(remotionNoNativeMediaElements, `export const Page = () => <img />;`, 0);
  });

  it("ignores native previews in Remotion tooling UI", () => {
    expectDiagnosticCount(
      remotionNoNativeMediaElements,
      `import {formatBytes} from '@remotion/studio-shared'; export const FilePreview = () => <video controls/>;`,
      0,
    );
  });

  it("detects native media in a directly registered composition", () => {
    expectDiagnosticCount(
      remotionNoNativeMediaElements,
      `
        import {Composition} from 'remotion';
        const Scene = () => <img src="a.png"/>;
        export const Root = () => <Composition component={Scene}/>;
      `,
      1,
    );
  });

  it("detects native media in an imported registered composition", () => {
    const sceneSource = `export const Scene = () => <img src="a.png"/>;`;
    const rootDirectory = createRemotionProjectFixture({
      "scene.tsx": sceneSource,
      "root.tsx": `import {Composition} from 'remotion'; import {Scene} from './scene'; export const Root = () => <Composition component={Scene}/>;`,
    });
    try {
      expectDiagnosticCount(remotionNoNativeMediaElements, sceneSource, 1, {
        filename: path.join(rootDirectory, "scene.tsx"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("retries composition ownership after an earlier file cannot build the index", () => {
    const sceneSource = `export const Scene = () => <img src="a.png"/>;`;
    const rootDirectory = createRemotionProjectFixture({
      "scene.tsx": sceneSource,
      "root.tsx": `import {Composition} from 'remotion'; import {Scene} from './scene'; export const Root = () => <Composition component={Scene}/>;`,
    });
    const settings = { "react-doctor": { rootDirectory } };
    try {
      expectDiagnosticCount(remotionNoNativeMediaElements, sceneSource, 0, {
        filename: path.join(rootDirectory, "..", "outside-scene.tsx"),
        settings,
      });
      expectDiagnosticCount(remotionNoNativeMediaElements, sceneSource, 1, {
        filename: path.join(rootDirectory, "scene.tsx"),
        settings,
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("does not treat an ordinary imported component as a composition", () => {
    const sceneSource = `export const Scene = () => <img src="a.png"/>;`;
    const rootDirectory = createRemotionProjectFixture({
      "scene.tsx": sceneSource,
      "root.tsx": `import {Composition} from 'remotion'; import {Scene} from './scene'; const Other = () => null; export const Root = () => <><Scene/><Composition component={Other}/></>;`,
    });
    try {
      expectDiagnosticCount(remotionNoNativeMediaElements, sceneSource, 0, {
        filename: path.join(rootDirectory, "scene.tsx"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

describe("remotion-no-next-image", () => {
  it("flags aliased default imports from next/image", () => {
    expectDiagnosticCount(
      remotionNoNextImage,
      `
        import {Composition} from 'remotion';
        import NextPicture from 'next/image';
        const Scene = () => <NextPicture src="a.png" alt="" />;
        export const Root = () => <Composition component={Scene}/>;
      `,
      1,
    );
  });

  it("allows Remotion Img and local Image components", () => {
    expectDiagnosticCount(
      remotionNoNextImage,
      `
        import {AbsoluteFill, Img} from 'remotion';
        const Image = () => null;
        export const Scene = () => <AbsoluteFill><Img src="a.png"/><Image/></AbsoluteFill>;
      `,
      0,
    );
  });

  it("ignores next/image outside a Remotion source file", () => {
    expectDiagnosticCount(
      remotionNoNextImage,
      `import Image from 'next/image'; export const Page = () => <Image src="a.png" alt="" />;`,
      0,
    );
  });

  it("follows a barrel export to an imported registered composition", () => {
    const sceneSource = `import Image from 'next/image'; export const Scene = () => <Image src="a.png" alt=""/>;`;
    const rootDirectory = createRemotionProjectFixture({
      "scene.tsx": sceneSource,
      "scenes.ts": `export {Scene} from './scene';`,
      "root.tsx": `import {Composition} from 'remotion'; import {Scene} from './scenes'; export const Root = () => <Composition component={Scene}/>;`,
    });
    try {
      expectDiagnosticCount(remotionNoNextImage, sceneSource, 1, {
        filename: path.join(rootDirectory, "scene.tsx"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });
});

describe("remotion-no-css-url-assets", () => {
  it("flags static CSS image and mask URLs", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <AbsoluteFill style={{backgroundImage: 'url("/background.png")', maskImage: 'url(/mask.svg)'}} />;
        };
      `,
      2,
    );
  });

  it("allows a CSS URL preloaded by a same-source Remotion Img", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, Img} from 'remotion';
        export const Scene = () => (
          <AbsoluteFill style={{backgroundImage: 'url("/background.png")'}}>
            <Img src="/background.png" style={{display: 'none'}} />
          </AbsoluteFill>
        );
      `,
      0,
    );
  });

  it("allows a same-source Remotion Img returned from useMemo", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, Img} from 'remotion';
        import {useMemo} from 'react';
        export const Scene = () => {
          const preload = useMemo(() => <Img src="/mask.png" style={{display: 'none'}} />, []);
          return <AbsoluteFill style={{maskImage: 'url(/mask.png)'}}>{preload}</AbsoluteFill>;
        };
      `,
      0,
    );
  });

  it("does not accept a same-source Img inside an event callback", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, Img} from 'remotion';
        export const Scene = () => {
          const handleClick = () => <Img src="/mask.png" />;
          return <AbsoluteFill onClick={handleClick} style={{maskImage: 'url(/mask.png)'}} />;
        };
      `,
      1,
    );
  });

  it("does not accept an unrelated preload", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, Img} from 'remotion';
        export const Scene = () => (
          <AbsoluteFill style={{WebkitMaskImage: 'url("/mask.svg")'}}><Img src="/other.svg" /></AbsoluteFill>
        );
      `,
      1,
    );
  });

  it("ignores dynamic CSS values and CSS without URLs", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill} from 'remotion';
        import {useCurrentFrame} from 'remotion';
        export const Scene = ({src}) => {
          useCurrentFrame();
          return <AbsoluteFill style={{backgroundImage: 'url(' + src + ')', maskImage: 'linear-gradient(black, transparent)'}} />;
        };
      `,
      0,
    );
  });

  it("allows embedded data URLs and inline SVG fragment references", () => {
    expectDiagnosticCount(
      remotionNoCssUrlAssets,
      `
        import {AbsoluteFill, useCurrentFrame} from 'remotion';
        export const Scene = () => {
          useCurrentFrame();
          return <AbsoluteFill style={{backgroundImage: 'url(data:image/png;base64,abc)', maskImage: 'url(#mask)'}} />;
        };
      `,
      0,
    );
  });
});

describe("remotion-no-module-scope-delay-render", () => {
  it("provides remediation compatible with Remotion versions before useDelayRender", () => {
    expect(remotionNoModuleScopeDelayRender.recommendation).toContain("4.0.342");
    expect(remotionNoModuleScopeDelayRender.recommendation).toContain(
      "useState(() => delayRender())",
    );
    const result = runRule(
      remotionNoModuleScopeDelayRender,
      `import {delayRender} from 'remotion'; delayRender();`,
    );
    expect(result.diagnostics[0]?.message).toContain("lazy `useState`");
  });

  it("flags direct, aliased, and namespace module-scope calls", () => {
    expectDiagnosticCount(
      remotionNoModuleScopeDelayRender,
      `
        import {delayRender, delayRender as hold} from 'remotion';
        import * as Remotion from 'remotion';
        const first = delayRender();
        const second = hold();
        const third = Remotion.delayRender();
      `,
      3,
    );
  });

  it("allows calls inside functions", () => {
    expectDiagnosticCount(
      remotionNoModuleScopeDelayRender,
      `import {delayRender} from 'remotion'; export const createHandle = () => delayRender();`,
      0,
    );
  });

  it("ignores shadowed and unrelated delayRender calls", () => {
    expectDiagnosticCount(
      remotionNoModuleScopeDelayRender,
      `
        import {AbsoluteFill} from 'remotion';
        const delayRender = () => 1;
        const handle = delayRender();
      `,
      0,
    );
  });
});

describe("remotion-stable-delay-render-handle", () => {
  it("flags delayRender in component render and useMemo", () => {
    expectDiagnosticCount(
      remotionStableDelayRenderHandle,
      `
        import {delayRender} from 'remotion';
        import {useMemo} from 'react';
        export const Scene = () => {
          const first = delayRender();
          const second = useMemo(() => delayRender(), []);
          return <div>{first + second}</div>;
        };
      `,
      2,
    );
  });

  it("allows a lazy useState initializer", () => {
    expectDiagnosticCount(
      remotionStableDelayRenderHandle,
      `
        import {delayRender} from 'remotion';
        import {useState as useStableState} from 'react';
        export const Scene = () => {
          const [handle] = useStableState(() => delayRender());
          return <div>{handle}</div>;
        };
      `,
      0,
    );
  });

  it("allows calls in effects, handlers, helpers, and module scope", () => {
    expectDiagnosticCount(
      remotionStableDelayRenderHandle,
      `
        import {delayRender} from 'remotion';
        import {useEffect} from 'react';
        const moduleHandle = delayRender();
        const helper = () => delayRender();
        export const Scene = () => {
          useEffect(() => delayRender(), []);
          return <button onClick={() => delayRender()}>{moduleHandle + helper()}</button>;
        };
      `,
      0,
    );
  });
});

describe("remotion-calculate-metadata-fetch-signal", () => {
  it("flags direct fetches in inline and referenced calculateMetadata functions", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import {Composition} from 'remotion';
        const loadMetadata = async ({props}) => {
          const first = await fetch('/first');
          const second = await fetch('/second', {method: 'POST'});
          return {props};
        };
        export const Root = () => <>
          <Composition id="a" component={() => null} durationInFrames={30} fps={30} width={100} height={100} calculateMetadata={loadMetadata}/>
          <Composition id="b" component={() => null} durationInFrames={30} fps={30} width={100} height={100} calculateMetadata={async ({props}) => ({props: await fetch('/third')})}/>
        </>;
      `,
      3,
    );
  });

  it("flags a typed CalculateMetadataFunction even before Composition wiring", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import type {CalculateMetadataFunction as MetadataLoader} from 'remotion';
        export const loadMetadata: MetadataLoader<Record<string, unknown>> = async () => ({props: await fetch('/data')});
      `,
      1,
    );
  });

  it("flags an imported calculateMetadata function in its source file", () => {
    const metadataSource = `export const loadMetadata = async () => ({props: await fetch('/data')});`;
    const rootDirectory = createRemotionProjectFixture({
      "load-metadata.ts": metadataSource,
      "root.tsx": `import {Composition} from 'remotion'; import {loadMetadata} from './load-metadata'; export const Root = () => <Composition calculateMetadata={loadMetadata}/>;`,
    });
    try {
      expectDiagnosticCount(remotionCalculateMetadataFetchSignal, metadataSource, 1, {
        filename: path.join(rootDirectory, "load-metadata.ts"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("ignores an imported function not used as calculateMetadata", () => {
    const metadataSource = `export const loadMetadata = async () => ({props: await fetch('/data')});`;
    const rootDirectory = createRemotionProjectFixture({
      "load-metadata.ts": metadataSource,
      "root.tsx": `import {loadMetadata} from './load-metadata'; export const Root = () => <button onClick={loadMetadata}/>;`,
    });
    try {
      expectDiagnosticCount(remotionCalculateMetadataFetchSignal, metadataSource, 0, {
        filename: path.join(rootDirectory, "load-metadata.ts"),
        settings: { "react-doctor": { rootDirectory } },
      });
    } finally {
      fs.rmSync(rootDirectory, { recursive: true, force: true });
    }
  });

  it("accepts destructured and parameter-member abort signals", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import {Composition} from 'remotion';
        const first = async ({abortSignal: signal}) => ({props: await fetch('/first', {signal})});
        const second = async (metadata) => ({props: await fetch('/second', {signal: metadata.abortSignal})});
        export const Root = () => <>
          <Composition calculateMetadata={first}/>
          <Composition calculateMetadata={second}/>
        </>;
      `,
      0,
    );
  });

  it("accepts defaulted bindings, optional access, and the last signal property", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import {Composition} from 'remotion';
        const first = async ({abortSignal: signal = undefined}) => ({props: await fetch('/first', {signal})});
        const second = async (metadata = {}) => ({props: await fetch('/second', {signal: metadata?.abortSignal})});
        const third = async ({abortSignal}) => ({props: await fetch('/third', {signal: other, signal: abortSignal})});
        export const Root = () => <>
          <Composition calculateMetadata={first}/>
          <Composition calculateMetadata={second}/>
          <Composition calculateMetadata={third}/>
        </>;
      `,
      0,
    );
  });

  it("skips unknown options, helper-owned fetches, nested callbacks, and shadowed fetch", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import {Composition} from 'remotion';
        const request = () => fetch('/helper');
        const loadMetadata = async ({abortSignal}, options) => {
          const fetch = () => null;
          fetch('/shadowed');
          request();
          Promise.resolve().then(() => globalThis.fetch('/nested'));
          return {props: await globalThis.fetch('/unknown', options)};
        };
        export const Root = () => <Composition calculateMetadata={loadMetadata}/>;
      `,
      0,
    );
  });

  it("ignores custom Composition components and unrelated function types", () => {
    expectDiagnosticCount(
      remotionCalculateMetadataFetchSignal,
      `
        import {AbsoluteFill} from 'remotion';
        interface Loader {(): Promise<unknown>}
        const loadMetadata: Loader = async () => fetch('/data');
        const Composition = () => <AbsoluteFill/>;
        export const Root = () => <Composition calculateMetadata={loadMetadata}/>;
      `,
      0,
    );
  });
});
