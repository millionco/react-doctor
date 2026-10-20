import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImgWithoutDimensions } from "./no-img-without-dimensions.js";

const mediaSource =
  "import { css } from 'styled-components';\n" +
  "export default { small: (...parts) => css`@media screen and (max-width: 639px) { ${css(...parts)} }`, " +
  "medium: (...parts) => css`@media screen and (min-width: 400px) { ${css(...parts)} }`, " +
  "large: (...parts) => css`@media screen and (min-width: 960px) { ${css(...parts)} }` };";
const componentSource =
  "import styled from 'styled-components'; import sizes from './sizes';\n" +
  "const PictureFrame = styled.div`flex-shrink: 0; " +
  "${sizes.small`display: none;`} " +
  "${sizes.medium`display: block; width: 88px; height: 88px;`} " +
  "${sizes.large`display: block; width: 144px; height: 144px;`} " +
  "& img { max-width: 100%; max-height: 100%; }`;\n" +
  "export const Picture = ({ url }) => <PictureFrame><img src={url} alt='' /></PictureFrame>;";

const inspectStyledParent = (source = componentSource, provider = mediaSource) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-styled-img-"));
  const filename = path.join(directory, "picture.tsx");
  fs.writeFileSync(filename, source);
  fs.writeFileSync(path.join(directory, "sizes.ts"), provider);
  try {
    return runRule(noImgWithoutDimensions, source, { filename, includeLocations: true });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe("no-img-without-dimensions styled parent", () => {
  it("accepts overlapping hidden or fixed screen boxes", () => {
    expect(inspectStyledParent()).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("accepts unqualified width queries", () => {
    expect(inspectStyledParent(componentSource, mediaSource.replaceAll("screen and ", ""))).toEqual(
      { diagnostics: [], parseErrors: [] },
    );
  });
  it("accepts positive base dimensions and named runtime css aliases", () => {
    const source = componentSource.replace(
      "flex-shrink: 0;",
      "width: 72px; height: 72px; flex-shrink: 0;",
    );
    const provider = mediaSource
      .replace("{ css }", "{ css as mixin }")
      .replaceAll("css`", "mixin`")
      .replaceAll("css(...parts)", "mixin(...parts)");
    expect(inspectStyledParent(source, provider)).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("checks direct styled ancestors while allowing ordinary theme border values", () => {
    const source = componentSource
      .replace(
        "export const Picture",
        "const Outer = styled.div`display: flex; ${sizes.small`border-top: 1px solid ${props => props.theme.border}; &:first-child { border-top: 0; }`}`; export const Picture",
      )
      .replace("=> <PictureFrame>", "=> <Outer><PictureFrame>")
      .replace("</PictureFrame>;", "</PictureFrame></Outer>;");
    expect(inspectStyledParent(source)).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("accepts unrelated literal non-sizing styled templates", () => {
    expect(
      inspectStyledParent(
        'import styled from "styled-components";const Other=styled.div`display:block;`;const Frame=styled.div`width:88px;height:88px;flex-shrink:0;& img{max-width:100%;max-height:100%;}`;export const View=()=> <section><Other/><Frame><img src="/a.png" alt=""/></Frame></section>;',
      ),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });
  const controls = [
    [
      "global-at-import-unknown-stylesheet",
      'import styled from "styled-components";const Other=styled.div`@import url("/sizing.css");`;const Frame=styled.div`width:88px;height:88px;flex-shrink:0;& img{max-width:100%;max-height:100%;}`;export const View=()=> <section><Other/><Frame><img src="/a.png" alt=""/></Frame></section>;',
      mediaSource,
    ],
    [
      "ancestor-global-at-import",
      'import styled from "styled-components";const Outer=styled.div`@import url("/sizing.css");`;const Frame=styled.div`width:88px;height:88px;flex-shrink:0;& img{max-width:100%;max-height:100%;}`;export const View=()=> <Outer><Frame><img src="/a.png" alt=""/></Frame></Outer>;',
      mediaSource,
    ],
    [
      "sibling selector removes parent reservation",
      componentSource
        .replace(
          "export const Picture",
          "const Other = styled.div`& + div { height: auto !important; }`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <section><Other /><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></section>;"),
      mediaSource,
    ],
    [
      "sibling selector removes image bounds",
      componentSource
        .replace(
          "export const Picture",
          "const Other = styled.div`& + div img { max-width: none !important; max-height: none !important; }`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <section><Other /><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></section>;"),
      mediaSource,
    ],
    [
      "sibling interpolation injects sizing override",
      componentSource
        .replace(
          "export const Picture",
          'const Other = styled.div`${"& + div { height: auto !important; }"}`; export const Picture',
        )
        .replace("=> <PictureFrame>", "=> <section><Other /><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></section>;"),
      mediaSource,
    ],
    [
      "root declaration after media",
      "import styled from 'styled-components'; import sizes from './sizes'; const PictureFrame = styled.div`${sizes.small`display: block;`} display: none; flex-shrink: 0; & img { max-width: 100%; max-height: 100%; }`; export const Picture = ({ url }) => <PictureFrame><img src={url} /></PictureFrame>;",
      mediaSource,
    ],
    [
      "ancestor logical sizing override",
      componentSource
        .replace(
          "export const Picture",
          "const Outer = styled.div`& > :first-child { block-size: auto !important; }`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <Outer><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></Outer>;"),
      mediaSource,
    ],
    [
      "polymorphic styled ancestor",
      componentSource
        .replace(
          "export const Picture",
          "const Outer = styled.div`display: block;`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <Outer as='span'><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></Outer>;"),
      mediaSource,
    ],
    [
      "HTML style injection",
      componentSource +
        "const Injected = <div dangerouslySetInnerHTML={{ __html: '<style>div { height:auto!important }</style>' }} />;",
      mediaSource,
    ],
    [
      "stylesheet link",
      componentSource + "const Linked = <link rel='stylesheet' href='/overrides.css' />;",
      mediaSource,
    ],
    ["opaque style writer call", componentSource + "installStyles();", mediaSource],
    [
      "opaque style writer tag",
      componentSource + "injectStyles`div { height:auto!important; }`;",
      mediaSource,
    ],
    [
      "erased declaration cannot mask DOM style writer",
      "interface document {}\n" +
        componentSource +
        "document.querySelectorAll('div').forEach(node => { node.style.height = 'auto'; });",
      mediaSource,
    ],
    [
      "ancestor CSS fragment interpolation",
      componentSource
        .replace(
          "export const Picture",
          "const Outer = styled.div`& > :first-child { ${'height:auto !important;'} }`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <Outer><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></Outer>;"),
      mediaSource,
    ],
    [
      "custom wrapper ancestor",
      componentSource
        .replace(
          "export const Picture",
          "const Outer = ({ children }) => <section>{children}</section>; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <Outer><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></Outer>;"),
      mediaSource,
    ],
    [
      "local DOM style writer",
      componentSource +
        "document.querySelectorAll('div').forEach(node => { node.style.height = 'auto'; });",
      mediaSource,
    ],
    ["dynamic stylesheet import", componentSource + "import('./override.css');", mediaSource],
    [
      "type-only styled import",
      componentSource.replace("import styled", "import type styled"),
      mediaSource,
    ],
    ["imported competing CSS", "import './overrides.css';" + componentSource, mediaSource],
    [
      "global style provider",
      "import { createGlobalStyle } from 'styled-components';" + componentSource,
      mediaSource,
    ],
    [
      "inline stylesheet",
      componentSource.replace(
        "<PictureFrame>",
        "<PictureFrame><style>{'div { height:auto !important; }'}</style>",
      ),
      mediaSource,
    ],
    [
      "ancestor descendant sizing",
      componentSource
        .replace(
          "export const Picture",
          "const Outer = styled.div`& > :first-child { height: auto !important; }`; export const Picture",
        )
        .replace("=> <PictureFrame>", "=> <Outer><PictureFrame>")
        .replace("</PictureFrame>;", "</PictureFrame></Outer>;"),
      mediaSource,
    ],
    ["extra provider import", componentSource, "import './overrides.css';" + mediaSource],
    [
      "fractional viewport gap",
      componentSource,
      mediaSource.replace("max-width: 639px", "max-width: 399px"),
    ],
    ["print-only rules", componentSource, mediaSource.replaceAll("screen and", "print and")],
    [
      "orientation query",
      componentSource,
      mediaSource.replace("min-width: 400px", "orientation: landscape"),
    ],
    ["dynamic predicate", componentSource, mediaSource.replace("400px", "${400}px")],
    [
      "fake css helper",
      componentSource,
      mediaSource.replace("import { css } from 'styled-components';", "const css = () => '';"),
    ],
    [
      "rest parameter shadows css import",
      componentSource,
      mediaSource.replaceAll("...parts", "...css"),
    ],
    [
      "unrelated helper argument",
      componentSource,
      mediaSource.replace("css(...parts)", "css(...other)"),
    ],
    [
      "side effect in another helper",
      componentSource,
      mediaSource
        .replace("large: (...parts) => css", "large: (globalThis.changed = true, (...parts) => css")
        .replace(" };", ") };"),
    ],
    [
      "non CSS whitespace",
      componentSource.replace("display: none;", "display:\u00a0none;"),
      mediaSource,
    ],
    [
      "non CSS media whitespace",
      componentSource,
      mediaSource.replaceAll("screen and", "screen\u00a0and"),
    ],
    [
      "unknown interpolation",
      componentSource.replace("flex-shrink: 0;", "flex-shrink: 0; ${props => props.css}"),
      mediaSource,
    ],
    ["percentage geometry", componentSource.replace("width: 88px", "width: 100%"), mediaSource],
    ["auto geometry", componentSource.replace("height: 88px", "height: auto"), mediaSource],
    ["zero geometry", componentSource.replace("height: 88px", "height: 0px"), mediaSource],
    [
      "important reset",
      componentSource.replace("& img", "height: auto !important; & img"),
      mediaSource,
    ],
    ["all reset", componentSource.replace("& img", "all: unset; & img"), mediaSource],
    [
      "visibility instead of display",
      componentSource.replace("display: none", "visibility: hidden"),
      mediaSource,
    ],
    ["missing child bound", componentSource.replace("max-height: 100%;", ""), mediaSource],
    ["shrinking parent", componentSource.replace("flex-shrink: 0", "flex-shrink: 1"), mediaSource],
    [
      "CSS comments",
      componentSource.replace("flex-shrink: 0", "/* unknown */ flex-shrink: 0"),
      mediaSource,
    ],
    [
      "unterminated declaration before child",
      componentSource.replace("height: 144px;", "height: 144px"),
      mediaSource,
    ],
    [
      "parent style override",
      componentSource.replace("<PictureFrame>", "<PictureFrame style={{ height: 'auto' }}>"),
      mediaSource,
    ],
    [
      "parent polymorphism",
      componentSource.replace("<PictureFrame>", "<PictureFrame as='span'>"),
      mediaSource,
    ],
    [
      "parent default props",
      componentSource + "PictureFrame.defaultProps = { style: { height: 'auto' } };",
      mediaSource,
    ],
    ["parent escape", componentSource + "change(PictureFrame);", mediaSource],
    [
      "parent export",
      componentSource.replace("const PictureFrame", "export const PictureFrame"),
      mediaSource,
    ],
    [
      "fake styled factory",
      componentSource.replace(
        "import styled from 'styled-components';",
        "const styled = { div: () => 'div' };",
      ),
      mediaSource,
    ],
    [
      "factory replacement",
      componentSource.replace(
        "const PictureFrame",
        "Object.defineProperty(styled, 'div', { value: () => 'span' }); const PictureFrame",
      ),
      mediaSource,
    ],
    [
      "helper replacement",
      componentSource.replace("const PictureFrame", "sizes.medium = () => ''; const PictureFrame"),
      mediaSource,
    ],
    [
      "child style override",
      componentSource.replace("<img src", "<img style={{ maxHeight: 'none' }} src"),
      mediaSource,
    ],
  ];
  it.each(controls)("keeps reporting %s", (_name, source, provider) => {
    const result = inspectStyledParent(source, provider);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
