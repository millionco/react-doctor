import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";
import { normalizeFilename } from "./normalize-filename.js";
import { isClosedJsonSnapshotProvider } from "./is-closed-json-snapshot-provider.js";

const directories: string[] = [];
const providerSource = `
import axios from 'axios';
import React from 'react';
const transport = process.env.NODE_ENV === 'production'
  ? { baseURL: 'https://example.test', timeout: 1500 }
  : { baseURL: 'http://localhost:3030', timeout: 2500 };
export const load = () => new Promise((resolve, reject) => {
  axios({ ...transport, url: '/settings', method: 'get', responseType: 'json' })
    .then(response => { resolve(response.data); }).catch(reject);
});
`;

const checkProvider = (
  sourceText: string,
  otherFiles: Record<string, string> = {},
  knownPublicEntryTargets: ReadonlyArray<string> = [],
): boolean => {
  const rootDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "json-provider-")));
  directories.push(rootDirectory);
  const filename = path.join(rootDirectory, "provider.js");
  fs.writeFileSync(filename, sourceText);
  for (const [filePath, content] of Object.entries(otherFiles)) {
    fs.writeFileSync(path.join(rootDirectory, filePath), content);
  }
  const project = getClosedJsonSnapshotProject({
    rootDirectory,
    allowJsxInJs: true,
    knownPublicEntryTargets,
    sourceResolutionPolicy: {
      rootDirectory,
      extensions: [".js", ".jsx", ".mjs"],
      aliases: [],
    },
  });
  const module = project?.modules.get(normalizeFilename(filename));
  const helperFunction = module?.scopes.rootScope.symbols.find(
    (symbol) => symbol.name === "load",
  )?.initializer;
  if (!project) return false;
  expect(helperFunction).toBeDefined();
  return Boolean(
    project &&
    module &&
    helperFunction &&
    isClosedJsonSnapshotProvider({
      project,
      module,
      helperFunction,
      decoderRole: "browser-native-json",
    }),
  );
};

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("isClosedJsonSnapshotProvider", () => {
  it("keeps ordinary above-owner class and render usage outside the source ownership proof", () => {
    expect(
      checkProvider(providerSource, {
        "shell.js": `import React from 'react'; import ReactDOM from 'react-dom';
            class Shell extends React.Component { render() { return React.Children.only(this.props.children); } }
            const mounted = ReactDOM.render(<React.StrictMode><Shell><div /></Shell></React.StrictMode>, document.getElementById('root'));
            retain(mounted);
            const values = { first: 1 }; const selected = values[selection];
            const handler = event => event.target.value;`,
      }),
    ).toBe(true);
  });

  it.each([
    "if (process.env.NODE_ENV !== 'production') JSON.parse = foreignDecoder;",
    "if (module.hot) JSON.parse = foreignDecoder;",
    "React.__defineGetter__('useState', () => foreignHook);",
    "parent['Sym' + 'bol'] = foreignSymbol;",
    "const onMessage = event => { event.source.JSON.parse = foreignDecoder; };",
    "const holder = document.getElementById('root'); holder.innerHTML = '<img onerror=malicious()>';",
    "import React from 'react'; React.createElement('iframe', { src: '/decoder.html' });",
    "const Frame = 'iframe'; const View = () => <Frame src='/decoder.html' />;",
    "const onMessage = event => { const browser = event.source; browser[selector] = foreignSymbol; };",
    "const onLoad = event => { event.currentTarget.JSON.parse = foreignDecoder; };",
    "const onLoad = event => { const { target } = event; target.JSON.parse = foreignDecoder; };",
  ])(
    "preserves source-visible native contradictions without production assumptions: %s",
    (source) => {
      expect(checkProvider(`${source}\n${providerSource}`, {})).toBe(false);
    },
  );

  it("retains constant-false folding without compiler environment facts", () => {
    expect(checkProvider(`if (false) JSON.parse = foreignDecoder;\n${providerSource}`, {})).toBe(
      true,
    );
  });

  it("accepts ordinary hot accept callbacks without hiding their native writes", () => {
    expect(checkProvider(`${providerSource}\nif (module.hot) module.hot.accept();`, {})).toBe(true);
    expect(
      checkProvider(
        `${providerSource}\nif (module.hot) module.hot.accept('./reader', () => { JSON.parse = foreignDecoder; });`,
        {},
      ),
    ).toBe(false);
  });

  it.each([
    "class Carrier {}; const memberName = 'constructor'; const decoder = Carrier[memberName]('return JSON')(); decoder.parse = foreignDecoder;",
    "class Carrier {}; const decoder = Carrier['con' + 'structor']('return JSON')(); decoder.parse = foreignDecoder;",
    "class Carrier {}; const chooseName = () => 'constructor'; const decoder = Carrier[chooseName()]('return JSON')(); decoder.parse = foreignDecoder;",
    "class Carrier {}; const chooseName = () => 'constructor'; const buildFunction = Carrier[chooseName()]; const decoder = buildFunction('return JSON')(); decoder.parse = foreignDecoder;",
    "import React from 'react'; let Frame = 'iframe'; const View = () => <Frame src='/decoder.html'/>;",
    "import React from 'react'; var Frame = 'iframe'; const View = () => <Frame src='/decoder.html'/>;",
    "import React from 'react'; const SafeComponent = () => <div/>; let Frame = 'iframe'; if (condition) Frame = SafeComponent; const View = () => <Frame src='/decoder.html'/>;",
    "import React from 'react'; const getFrame = () => 'iframe'; const Frame = getFrame(); const View = () => <Frame src='/decoder.html'/>;",
    "import React from 'react'; let Frame = 'ifr'; Frame += 'ame'; const View = () => <Frame src='/decoder.html'/>;",
  ])("declines computed native gateways and mutable tag declarations: %s", (source) => {
    expect(checkProvider(providerSource, { "gateway.js": source })).toBe(false);
  });

  it("retains passive computed captions through readonly local aliases", () => {
    expect(
      checkProvider(providerSource, {
        "caption.js":
          "import React from 'react'; const labels = { notice: 'Ready' }; const selected = labels[choice]; const caption = selected; export const Caption = () => <p>{caption}</p>;",
      }),
    ).toBe(true);
  });

  it("keeps genuine Carousel bindings as JSX-only component capabilities", () => {
    expect(
      checkProvider(providerSource, {
        "gallery.js":
          "import React from 'react'; import { Carousel } from 'antd'; export const Gallery = () => <Carousel />;",
      }),
    ).toBe(true);
  });

  it.each([
    "import { Carousel } from 'antd'; configure(Carousel);",
    "import { Carousel } from 'antd'; Carousel.defaultProps = altered;",
    "import widgets from 'antd'; configure(widgets);",
    "import * as widgets from 'antd'; widgets.Carousel = 'section';",
    "import Carousel from 'antd/lib/carousel'; configure(Carousel);",
    "import widgets from 'antd/lib'; configure(widgets);",
  ])("declines shared Carousel API publication: %s", (source) => {
    expect(checkProvider(providerSource, { "gallery.js": source })).toBe(false);
  });

  it("keeps a public fresh provider function separate from mutable HTTP capabilities", () => {
    expect(checkProvider(providerSource, {}, ["./provider.js"])).toBe(true);
  });

  it.each([
    `${providerSource} export { axios };`,
    providerSource
      .replace("export const load", "export const client = axios.create(); export const load")
      .replace("axios({", "client({"),
  ])("declines a mutable HTTP capability exported from a known package entry", (source) => {
    expect(checkProvider(source, {}, ["./provider.js"])).toBe(false);
  });

  it("keeps an internal shared client behind a disjoint package entry", () => {
    const source = providerSource
      .replace("export const load", "export const client = axios.create(); export const load")
      .replace("axios({", "client({");
    expect(
      checkProvider(source, { "public.js": "export const label = 'Published';" }, ["./public.js"]),
    ).toBe(true);
  });

  it("proves fixed JSON options and a closed branch-selected transport spread", () => {
    expect(checkProvider(providerSource)).toBe(true);
  });

  it.each([
    "babel-polyfill",
    "core-js/shim",
    "regenerator-runtime/runtime",
    "console-polyfill",
    "raf/polyfill",
    "performance-now",
    "babel-runtime/core-js/promise",
  ])("leaves bootstrap installation attestation outside the source proof: %s", (source) => {
    expect(checkProvider(`import '${source}';\n${providerSource}`)).toBe(true);
  });

  it.each([
    "const loader = arguments['2']; publish(loader.c);",
    "function obtain() { return obtain.caller.arguments['2']; } publish(obtain());",
    "define(['require'], function(loader) { publish(loader.c); });",
    "__webpack_exports__.load = foreignLoader;",
    "function __webpack_require__() { return foreignLoader; }",
  ])("declines module-wrapper capabilities outside the selected helper: %s", (source) => {
    expect(checkProvider(providerSource, { "bootstrap.js": source })).toBe(false);
  });

  it("proves a local shared client with fixed harmless defaults", () => {
    const source = providerSource
      .replace("import axios from 'axios';", "import { client } from './client';")
      .replace("axios({", "client({");
    expect(
      checkProvider(source, {
        "client.js":
          "import axios from 'axios'; export const client = axios.create({ timeout: 1500 });",
      }),
    ).toBe(true);
  });

  it("proves a closed primitive branch selector", () => {
    expect(
      checkProvider(
        providerSource.replace(
          "const transport = process.env.NODE_ENV === 'production'",
          "const production = true; const transport = production",
        ),
      ),
    ).toBe(true);
  });

  it("proves inline fixed nested request values without alias publication", () => {
    expect(
      checkProvider(
        providerSource.replace(
          "method: 'get'",
          "method: 'get', headers: { Accept: 'application/json' }, data: ['value']",
        ),
      ),
    ).toBe(true);
  });

  it("declines mutable headers published through an enclosing record", () => {
    const source = providerSource
      .replace(
        "export const load",
        "const headers = { Accept: 'application/json' }; const box = { headers }; publish(box); export const load",
      )
      .replace("method: 'get'", "method: 'get', headers");
    expect(checkProvider(source)).toBe(false);
  });

  it("declines mutable data published through an enclosing array", () => {
    const source = providerSource
      .replace(
        "export const load",
        "const data = ['value']; const box = [data]; publish(box); export const load",
      )
      .replace("method: 'get'", "method: 'get', data");
    expect(checkProvider(source)).toBe(false);
  });

  it("declines request-option records exported to an incoming writer", () => {
    const source = providerSource.replace("const transport", "export const transport");
    expect(
      checkProvider(source, {
        "writer.js": "import { transport } from './provider'; transport.adapter = custom;",
      }),
    ).toBe(false);
  });

  it("declines mutable nested headers shared through an escaping transport spread", () => {
    const source = `import axios from 'axios';
      const transport = { headers: { Accept: 'application/json' } };
      const box = { ...transport }; publish(box);
      export const load = () => new Promise((resolve, reject) => {
        axios({ ...transport, url: '/settings', responseType: 'json' })
          .then(response => { resolve(response.data); }).catch(reject);
      });`;
    expect(checkProvider(source)).toBe(false);
  });

  it("declines mutable nested headers shared through an escaping request-options spread", () => {
    const source = `import axios from 'axios';
      const options = { url: '/settings', responseType: 'json', headers: {} };
      const box = { ...options }; publish(box);
      export const load = () => new Promise((resolve, reject) => {
        axios(options).then(response => { resolve(response.data); }).catch(reject);
      });`;
    expect(checkProvider(source)).toBe(false);
  });

  it("allows finite native DOM lookups and genuine React namespace calls", () => {
    expect(
      checkProvider(providerSource, {
        "browser.js":
          "import React from 'react'; import ReactDOM from 'react-dom'; ReactDOM.render(<div />, document.getElementById('root')); window.addEventListener('resize', resize);",
      }),
    ).toBe(true);
  });

  it.each([
    `if (module.hot) { require("react-hot-loader"); axios.defaults.transformResponse = [customDecoder]; }`,
    `module.hot && require("react-hot-loader");`,
    `module.hot && import("react-hot-loader");`,
    `if (process.env.NODE_ENV !== "production") { axios.interceptors.response.use(customDecoder); }`,
    `if (!module.hot) {} else { publish(axios); }`,
  ])("keeps environment-dependent client and loader effects live: %s", (inactiveSource) => {
    expect(checkProvider(`${providerSource} ${inactiveSource}`)).toBe(false);
  });

  it.each([
    `if (!module.hot) { axios.defaults.transformResponse = [customDecoder]; }`,
    `if (unknown) { axios.defaults.transformResponse = [customDecoder]; }`,
    `function setup(module) { if (module.hot) axios.defaults.transformResponse = [customDecoder]; }`,
    `module.hot = true; if (module.hot) require("react-hot-loader");`,
    `if (!module.hot) module.hot = true;`,
    `publish(module);`,
    `const hot = module.hot;`,
    `if (module.hot) { function JSON() {} } JSON.parse = customDecoder;`,
  ])("retains active/unknown effects or ambiguous binding evidence: %s", (activeSource) => {
    expect(checkProvider(`${providerSource} ${activeSource}`)).toBe(false);
  });

  it.each([
    `const View = () => <p/>;`,
    `const React = factory; const View = () => <p/>;`,
    `import React from "react"; const View = (React) => <p/>;`,
    `import React from "react"; const Object = helper; const View = () => <p {...props}/>;`,
  ])("declines unresolved implicit transform bindings: %s", (source) => {
    expect(checkProvider(providerSource, { "view.js": source })).toBe(false);
  });

  it("allows a complete local error-boundary class carrier", () => {
    expect(
      checkProvider(providerSource, {
        "boundary.js": `import React from "react";
        class Boundary extends React.Component {
          state = { hasError: false };
          static getDerivedStateFromError() { return { hasError: true }; }
          componentDidCatch(error, info) { console.error(error, info); }
          render() { if (this.state.hasError) return <p>Unavailable</p>; return this.props.children; }
        }
        export default Boundary;`,
        "root.js": `import React from "react"; import Boundary from "./boundary"; const Root = () => <Boundary><p>Content</p></Boundary>;`,
      }),
    ).toBe(true);
  });

  it("allows a named Component class carrier export alias", () => {
    expect(
      checkProvider(providerSource, {
        "boundary.js": `import { Component as Base } from "react";
        class Boundary extends Base { render() { return this.props.children; } }
        export { Boundary as Carrier };`,
        "root.js": `import React from "react"; import { Carrier } from "./boundary"; const Root = () => <Carrier><p>Content</p></Carrier>;`,
      }),
    ).toBe(true);
  });

  it("does not attest unrelated above-owner class reset behavior", () => {
    expect(
      checkProvider(providerSource, {
        "boundary.js": `import React from "react";
        class Boundary extends React.Component {
          state = { hasError: false };
          static getDerivedStateFromError() { return { hasError: true }; }
          componentDidCatch(error, info) { this.setState({ hasError: false }); }
          render() { if (this.state.hasError) return <p>Unavailable</p>; return this.props.children; }
        }
        export default Boundary;`,
        "root.js": `import React from "react"; import Boundary from "./boundary"; const Root = () => <Boundary><p>Content</p></Boundary>;`,
      }),
    ).toBe(true);
  });

  it("declines an unknown replacement of a mounted component type", () => {
    expect(
      checkProvider(providerSource, {
        "boundary.js": `import React from "react";
        class Boundary extends React.Component { render() { return this.props.children; } }
        Boundary = opaque; export default Boundary;`,
        "root.js": `import React from "react"; import Boundary from "./boundary"; const Root = () => <Boundary><p>Content</p></Boundary>;`,
      }),
    ).toBe(false);
  });

  it("declines a React Component API escape outside a certified superclass", () => {
    expect(
      checkProvider(providerSource, {
        "boundary.js": `import React from "react"; publish(React.Component);`,
      }),
    ).toBe(false);
  });

  it("allows direct native timers with inline callbacks", () => {
    expect(
      checkProvider(providerSource, {
        "timer.js":
          "setTimeout(() => {}, 0); window.setTimeout(() => {}, 0); setInterval(() => {}, 10); window.setInterval(() => {}, 10);",
      }),
    ).toBe(true);
  });

  it("allows local functions and finite inert native JSX tag aliases", () => {
    expect(
      checkProvider(providerSource, {
        "view.js":
          "import React from 'react'; const Paragraph = 'p'; const cond = true; const Container = cond ? 'section' : 'div'; export const View = () => <Container><Paragraph>Text</Paragraph></Container>;",
      }),
    ).toBe(true);
  });

  it.each([
    "export default () => <div />;",
    "export default function View() { return <div />; }",
    "const View = () => <div />; export { View as default };",
  ])("allows relative direct function component imports: %s", (source) => {
    expect(
      checkProvider(providerSource, {
        "component.js": `import React from "react"; ${source}`,
        "view.js":
          "import React from 'react'; import View from './component'; export const Page = () => <View />;",
      }),
    ).toBe(true);
  });

  it.each([
    [
      "export default 'iframe';",
      "import Frame from './component'; export const View = () => <Frame src='/decoder.html' />;",
    ],
    [
      "export const Frame = 'iframe';",
      "import { Frame } from './component'; export const View = () => <Frame src='/decoder.html' />;",
    ],
    [
      "export const Frame = 'iframe';",
      "import * as Tags from './component'; export const View = () => <Tags.Frame src='/decoder.html' />;",
    ],
    [
      "const Frame = 'iframe'; const Wrapper = () => { const Frame = () => <div />; return Frame; }; export { Frame };",
      "import { Frame } from './component'; export const View = () => <Frame src='/decoder.html' />;",
    ],
    [
      "export default function Frame() { Frame = 'iframe'; return <div />; }",
      "import Frame from './component'; export const View = () => <Frame src='/decoder.html' />;",
    ],
  ])("declines relative scalar or namespace JSX tag aliases: %s", (source, importer) => {
    expect(
      checkProvider(providerSource, {
        "component.js": `import React from "react"; ${source}`,
        "view.js": `import React from "react"; ${importer}`,
      }),
    ).toBe(false);
  });

  it.each([
    "@jsx customFactory",
    "@jsxFrag CustomFragment",
    "@jsxImportSource custom-runtime",
    "@jsxRuntime automatic",
  ])("declines a per-file JSX transform override %s", (pragma) => {
    expect(checkProvider(`/** ${pragma} */\n${providerSource}`)).toBe(false);
  });

  it("declines mixed TypeScript import-equals client writers", () => {
    expect(
      checkProvider(providerSource, {
        "writer.ts": "import axios = require('axios'); axios.defaults.adapter = custom;",
      }),
    ).toBe(false);
  });

  it("declines runtime TypeScript type/value namespace ambiguity", () => {
    expect(
      checkProvider(providerSource, {
        "writer.ts": "type JSON = {}; JSON.parse = customDecoder;",
      }),
    ).toBe(false);
  });

  it.each(["module.ts", "module.tsx", "module.mts", "module.cts"])(
    "declines runtime TypeScript modules outside the JavaScript role: %s",
    (filename) => {
      expect(
        checkProvider(providerSource, {
          [filename]: "export const readiness = true;",
        }),
      ).toBe(false);
    },
  );

  it("keeps declarations outside the runtime source inventory", () => {
    expect(
      checkProvider(providerSource, {
        "types.d.ts": "declare const JSON: { parse: unknown };",
      }),
    ).toBe(true);
  });

  it.each(["./theme.css", "./sample.json", "./mark.png"])(
    "allows inert resource import %s",
    (source) => {
      expect(
        checkProvider(providerSource, {
          "resource.js": `import asset from '${source}'; display(asset);`,
        }),
      ).toBe(true);
    },
  );

  it.each([
    ["custom adapter", "responseType: 'json'", "responseType: 'json', adapter: decode"],
    [
      "custom response transform",
      "responseType: 'json'",
      "responseType: 'json', transformResponse: decode",
    ],
    ["opaque spread", "...transport", "...externalOptions"],
    [
      "response mutation",
      "resolve(response.data);",
      "response.data.items.reverse(); resolve(response.data);",
    ],
    ["rebuilt response", "resolve(response.data);", "resolve({ ...response.data });"],
    ["reviver decode", "resolve(response.data);", "resolve(JSON.parse(response.data, revive));"],
    ["custom promise", "import axios", "const Promise = FakePromise; import axios"],
    ["non-JSON response", "responseType: 'json'", "responseType: 'blob'"],
    ["custom transport branch", "timeout: 2500", "transformResponse: decode"],
    [
      "transport mutation",
      "export const load",
      "transport.responseType = 'blob'; export const load",
    ],
    [
      "shared interceptors",
      "export const load",
      "axios.interceptors.response.use(decode); export const load",
    ],
    [
      "shared transform default",
      "export const load",
      "axios.defaults.transformResponse = decode; export const load",
    ],
    ["unresolved selector", "process.env.NODE_ENV === 'production'", "production"],
    [
      "external selector getter",
      "process.env.NODE_ENV === 'production'",
      "externalTransport.enabled",
    ],
    [
      "computed selector getter",
      "process.env.NODE_ENV === 'production'",
      "externalTransport[selector]",
    ],
    [
      "mutated process environment",
      "export const load",
      "process.env = customEnvironment; export const load",
    ],
  ])("declines %s", (_description, before, after) => {
    expect(checkProvider(providerSource.replace(before, after))).toBe(false);
  });

  it("declines added importers that write shared defaults", () => {
    expect(
      checkProvider(providerSource, {
        "writer.js": "import axios from 'axios'; axios.defaults.adapter = custom;",
      }),
    ).toBe(false);
  });

  it("declines an added importer that escapes an exported client", () => {
    const source = providerSource
      .replace("import axios from 'axios';", "import { client } from './client';")
      .replace("axios({", "client({");
    expect(
      checkProvider(source, {
        "client.js":
          "import axios from 'axios'; export const client = axios.create({ timeout: 1500 });",
        "writer.js": "import { client } from './client'; configure(client);",
      }),
    ).toBe(false);
  });

  it.each([
    "const root = document.getElementById('root'); publish(root);",
    "publish(document.querySelector('#root'));",
    "import ReactDOM from 'react-dom'; const root = document.getElementById('root'); ReactDOM.render(App, root);",
    "import ReactDOM from 'react-dom'; ReactDOM.render(App, document.querySelector(selector));",
    "const ReactDOM = externalRenderer; ReactDOM.render(App, document.getElementById('root'));",
    "import React from 'react'; React.cloneElement(element);",
  ])(
    "leaves unrelated rendering and data operations outside the source ownership proof: %s",
    (source) => {
      expect(checkProvider(providerSource, { "writer.js": source })).toBe(true);
    },
  );

  it.each([
    "const sibling = {}; sibling[dynamicProperty] = custom;",
    "const { [dynamicProperty]: value } = []; configure(value);",
    "JSON.parse = custom;",
    "{ function JSON() {} } JSON.parse = custom;",
    "import axios from 'axios'; { function axios() {} } axios.defaults.adapter = custom;",
    "JSON.__defineGetter__('parse', custom);",
    "Promise.__defineGetter__('resolve', custom);",
    "Symbol.__defineGetter__('for', custom);",
    "XMLHttpRequest.__defineGetter__('send', custom);",
    "const parser = JSON; configure(parser);",
    "Promise.prototype.then = custom;",
    "Object.keys = custom;",
    "const objectApi = Object; objectApi.keys = custom;",
    "Array.prototype.map = custom;",
    "const sibling = {}; const shared = sibling.constructor.prototype; shared.map = custom;",
    "const sibling = {}; Reflect.getPrototypeOf(sibling).map = custom;",
    "const getPrototype = [].__lookupGetter__('__proto__'); const arrayPrototype = getPrototype.call([]); arrayPrototype.map = custom;",
    "const { __lookupGetter__: getPropertyGetter } = []; const getPrototype = getPropertyGetter.call([], '__proto__'); configure(getPrototype);",
    "const { __lookupSetter__: getPropertySetter } = []; configure(getPropertySetter);",
    "const { __defineGetter__: definePropertyGetter } = []; configure(definePropertyGetter);",
    "const { __defineSetter__: definePropertySetter } = []; configure(definePropertySetter);",
    "const arrayApi = Array; configure(arrayApi);",
    "const root = window; root.JSON = custom;",
    "import React from 'react'; React.useState = custom;",
    "import React from 'react'; React.__defineGetter__('useState', custom);",
    "import ReactDOM from 'react-dom'; ReactDOM.__defineGetter__('render', custom);",
    "import React from 'react'; configure(React);",
    "import { useState } from 'react'; configure(useState);",
    "import ReactDOM from 'react-dom'; ReactDOM.render = custom;",
    "import { Route } from 'react-router-dom'; Route.prototype.render = custom;",
    "import { Route } from 'react-router-dom'; configure(Route);",
    "import isEmpty from 'lodash/isEmpty'; configure(isEmpty);",
    "import lodash from 'lodash'; lodash.isEmpty = custom;",
    "import { set } from 'lodash'; set({}, 'constructor.prototype.map', custom);",
    "import { merge } from 'lodash'; merge({}, foreign);",
    "import defaults from 'axios/lib/defaults'; defaults.adapter = custom;",
    "require('axios').defaults.adapter = custom;",
    "import('axios').then(configure);",
    "parent.JSON.parse = custom;",
    "top.JSON.parse = custom;",
    "opener.JSON.parse = custom;",
    "frames[0].JSON.parse = custom;",
    "global.JSON.parse = custom;",
    "document.defaultView.JSON.parse = custom;",
    "const element = document.getElementById('root'); element.ownerDocument.defaultView.JSON.parse = custom;",
    "const frame = document.getElementById('frame'); frame.contentWindow.JSON.parse = custom;",
    "const browser = window.window; browser.JSON.parse = custom;",
    "const browser = self.window; browser.JSON.parse = custom;",
    "const browser = globalThis.globalThis; browser.JSON.parse = custom;",
    "window.__defineGetter__('JSON', custom);",
    "document.createElement('script').textContent = 'JSON.parse = custom';",
    "document.querySelector('#root').innerHTML = '<img src=x onerror=malicious()>';",
    "import ReactDOM from 'react-dom'; ReactDOM.render(App, document.querySelectorAll('#root'));",
    "const html = '<img src=x onerror=\"JSON.parse=customDecoder\">'; const View = () => <div dangerouslySetInnerHTML={{ __html: html }} />;",
    "const View = () => <iframe srcDoc={'<script>parent.JSON.parse=customDecoder</script>'} />;",
    "const View = () => <script src='https://example.test/decoder.js' />;",
    "const View = () => <object data='https://example.test/decoder.html' />;",
    "const View = () => <embed src='https://example.test/decoder.html' />;",
    "const View = () => <frame src='https://example.test/decoder.html' />;",
    "const Frame = 'iframe'; const View = () => <Frame src='/decoder.html' />;",
    "const NativeTag = 'iframe'; const Frame = NativeTag; const View = () => <Frame src='/decoder.html' />;",
    "const Frame = choose ? 'div' : 'iframe'; const View = () => <Frame src='/decoder.html' />;",
    "const Frame = getTag(); const View = () => <Frame src='/decoder.html' />;",
    "const Frame = 'IFRAME'; const View = () => <Frame src='/decoder.html' />;",
    "const View = () => <iFrAmE src='/decoder.html' />;",
    "import React from 'react'; React.createElement('iframe', { src: '/decoder.html' });",
    "import React from 'react'; React.createFactory('iframe');",
    "const sibling = {}; sibling['con' + 'structor'].prototype.map = custom;",
    "const { constructor: arrayConstructor } = []; const { prototype: arrayPrototype } = arrayConstructor; arrayPrototype.map = custom;",
    "import configure from './missing-writer'; configure();",
    "import View from './screen.vue'; configure(View);",
    "import View from './screen.svelte'; configure(View);",
    "import 'react-hot-loader';",
    "import { hot } from 'react-hot-loader/root'; hot(App);",
    "import 'react-refresh/runtime';",
    "import root from 'lodash/_root'; root.JSON.parse = custom;",
    "window.addEventListener('load', function () { this.JSON.parse = custom; });",
    "window.addEventListener('load', event => { event.target.JSON.parse = custom; });",
    "window.addEventListener('message', event => { event.source.JSON.parse = custom; });",
    "window.addEventListener('load', event => { event.view.JSON.parse = custom; });",
    "window.addEventListener('load', event => { event.currentTarget.JSON.parse = custom; });",
    "addEventListener('load', configure);",
    "event.JSON.parse = custom;",
    "module.require('axios').defaults.adapter = custom;",
    "setTimeout('JSON.parse = customDecoder', 0);",
    "setInterval('JSON.parse = customDecoder', 0);",
    "window.setTimeout('JSON.parse = customDecoder', 0);",
    "window.setInterval('JSON.parse = customDecoder', 0);",
    "const schedule = setTimeout; schedule('JSON.parse = customDecoder', 0);",
    "const schedule = window.setTimeout; schedule('JSON.parse = customDecoder', 0);",
    "setTimeout(configure, 0);",
    "import configure from '/absolute/project/writer.js'; configure();",
    "import configure from 'https://example.test/writer.js'; configure();",
    "import configure from 'loader!./writer.js'; configure();",
    "import configure from './writer.js?raw'; configure();",
    "import configure from '#writer'; configure();",
  ])("declines native or library escape: %s", (source) => {
    expect(checkProvider(providerSource, { "writer.js": source })).toBe(false);
  });
});
