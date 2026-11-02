import * as fs from "node:fs";
import filesystem from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  runRule,
  runRuleOnParsedFixture,
} from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { discoverProject } from "../src/project-info/discover-project.js";
import { runOxlint } from "../src/run-oxlint.js";
import { parseSourceText } from "../../oxlint-plugin-react-doctor/src/plugin/utils/parse-source-file.js";
import type { RuleContext } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule-context.js";
import type { EsTreeNode } from "../../oxlint-plugin-react-doctor/src/plugin/utils/es-tree-node.js";
import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { normalizeFilename } from "../../oxlint-plugin-react-doctor/src/plugin/utils/normalize-filename.js";
import { CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT } from "../../oxlint-plugin-react-doctor/src/plugin/utils/closed-json-snapshot/constants.js";
import { noArrayIndexAsKey } from "../../oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-array-index-as-key.js";

interface SnapshotFixtureMutation {
  readonly name: string;
  readonly filename: string;
  readonly before: string;
  readonly after: string;
}

const SNAPSHOT_MANIFEST = {
  name: "snapshot-reader",
  private: true,
  scripts: { build: "react-scripts build" },
  dependencies: {
    react: "^16.8.0",
    "react-dom": "^16.8.0",
    axios: "^0.21.0",
    "react-router-dom": "^5.1.0",
    "react-scripts": "^3.4.0",
  },
};

const SNAPSHOT_FILES: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify(SNAPSHOT_MANIFEST),
  "src/request.js": `
    import axios from "axios";
    export const load = () => new Promise((resolve, reject) => {
      axios({ url: "/settings", method: "get", responseType: "json" })
        .then(response => { resolve(response.data); })
        .catch(reject);
    });
  `,
  "src/owner.js": `
    import React, { useEffect, useState } from "react";
    import { BrowserRouter, Route } from "react-router-dom";
    import { load } from "./request";
    import Leaf from "./leaf";
    export default function Owner() {
      const [settings, setSettings] = useState({});
      useEffect(() => {
        load().then(envelope => {
          if (envelope.code === 0) setSettings(envelope.data);
        });
      }, []);
      if (Object.keys(settings).length === 0) return null;
      return <BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>;
    }
  `,
  "src/leaf.js": `
    import React from "react";
    export default function Leaf(props) {
      return <section>{props.paragraphs.map((text, index) => <p key={index}>{index + 1}. {text}</p>)}</section>;
    }
  `,
  "src/index.js": `
    import React from "react";
    import ReactDOM from "react-dom";
    import Owner from "./owner";
    ReactDOM.render(<Owner />, document.getElementById("root"));
  `,
};

const SNAPSHOT_BOUNDARY_SOURCE = `
  import React from "react";
  class Boundary extends React.Component {
    state = { hasError: false };
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(error, info) { console.error(error, info); }
    render() {
      if (this.state.hasError) return <p>Unable to load this view.</p>;
      return this.props.children;
    }
  }
  export default Boundary;
`;

let temporaryDirectory: string;
let lastNativeCacheHitCount = 0;

const writeSnapshotFile = (filename: string, sourceText: string): void => {
  const absolutePath = path.join(temporaryDirectory, filename);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, sourceText);
};

const replaceSnapshotSource = ({ filename, before, after }: SnapshotFixtureMutation): void => {
  const absolutePath = path.join(temporaryDirectory, filename);
  const sourceText = fs.readFileSync(absolutePath, "utf8");
  expect(sourceText).toContain(before);
  writeSnapshotFile(filename, sourceText.replace(before, after));
};

const runSnapshotLeaf = () => {
  for (const sourceFilename of fs.readdirSync(path.join(temporaryDirectory, "src"))) {
    const absoluteSourcePath = path.join(temporaryDirectory, "src", sourceFilename);
    expect(
      parseSourceText({
        filename: absoluteSourcePath,
        sourceText: fs.readFileSync(absoluteSourcePath, "utf8"),
        language: sourceFilename.endsWith(".js") ? "jsx" : undefined,
      }),
      sourceFilename,
    ).not.toBeNull();
  }
  const filename = path.join(temporaryDirectory, "src/leaf.js");
  const result = runRule(noArrayIndexAsKey, fs.readFileSync(filename, "utf8"), {
    filename,
    forceJsx: true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

const runNativeSnapshotLeaf = async (
  cacheEnabled = false,
  hasPreparedHtml = false,
  includePaths?: string[],
) => {
  const partialFailures: string[] = [];
  let didReportCacheStats = false;
  const diagnostics = await runOxlint({
    rootDirectory: temporaryDirectory,
    project: discoverProject(temporaryDirectory),
    includePaths,
    customRulesOnly: true,
    userConfig: { rules: { "react-doctor/no-array-index-as-key": "warn" } },
    perFileLintCacheEnabled: cacheEnabled,
    sidecarLintCacheEnabled: cacheEnabled,
    onPartialFailure: (reason) => partialFailures.push(reason),
    onCacheStats: (cacheHitFileCount) => {
      didReportCacheStats = true;
      lastNativeCacheHitCount = cacheHitFileCount;
    },
  });
  expect(partialFailures).toEqual([]);
  if (cacheEnabled) expect(didReportCacheStats).toBe(!hasPreparedHtml);
  return diagnostics.filter((diagnostic) => diagnostic.rule === "no-array-index-as-key");
};

beforeEach(() => {
  lastNativeCacheHitCount = 0;
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-json-snapshot-"));
  for (const [filename, sourceText] of Object.entries(SNAPSHOT_FILES)) {
    writeSnapshotFile(filename, sourceText);
  }
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const SNAPSHOT_REFUSALS: ReadonlyArray<SnapshotFixtureMutation> = [
  {
    name: "an opaque custom root ancestor",
    filename: "src/index.js",
    before: "<Owner />",
    after: "<Opaque><Owner /></Opaque>",
  },
  {
    name: "a retained runtime that can recreate mount effects",
    filename: "package.json",
    before: '"react":"^16.8.0"',
    after: '"react":"^18.0.0"',
  },
  {
    name: "a renderer outside the supported interval",
    filename: "package.json",
    before: '"react-dom":"^16.8.0"',
    after: '"react-dom":"^17.0.0"',
  },
  {
    name: "a decoder outside the supported interval",
    filename: "package.json",
    before: '"axios":"^0.21.0"',
    after: '"axios":"^1.0.0"',
  },
  {
    name: "an unsupported route callback API",
    filename: "package.json",
    before: '"react-router-dom":"^5.1.0"',
    after: '"react-router-dom":"^6.0.0"',
  },
  {
    name: "a response transform",
    filename: "src/request.js",
    before: 'responseType: "json"',
    after: 'responseType: "json", transformResponse: [JSON.parse]',
  },
  {
    name: "a custom request adapter",
    filename: "src/request.js",
    before: 'responseType: "json"',
    after: 'responseType: "json", adapter: customAdapter',
  },
  {
    name: "a reconstructed successful payload",
    filename: "src/request.js",
    before: "resolve(response.data)",
    after: "resolve({ ...response.data })",
  },
  {
    name: "a shadowed Promise constructor",
    filename: "src/request.js",
    before: "export const load",
    after: "const Promise = customPromise; export const load",
  },
  {
    name: "an interceptor writer",
    filename: "src/request.js",
    before: "export const load",
    after: "axios.interceptors.response.use(customDecoder); export const load",
  },
  {
    name: "a nonempty initial record",
    filename: "src/owner.js",
    before: "useState({})",
    after: "useState({ paragraphs: [] })",
  },
  {
    name: "an effect without bounded mount dependencies",
    filename: "src/owner.js",
    before: "}, []);",
    after: "});",
  },
  {
    name: "a second successful population",
    filename: "src/owner.js",
    before: "setSettings(envelope.data);",
    after: "{ setSettings(envelope.data); setSettings(envelope.data); }",
  },
  {
    name: "a setter published to an opaque writer",
    filename: "src/owner.js",
    before: "if (Object.keys(settings)",
    after: "publish(setSettings); if (Object.keys(settings)",
  },
  {
    name: "a missing application-success branch",
    filename: "src/owner.js",
    before: "if (envelope.code === 0) ",
    after: "",
  },
  {
    name: "a missing empty-record gate",
    filename: "src/owner.js",
    before: "if (Object.keys(settings).length === 0) return null;",
    after: "",
  },
  {
    name: "a shadowed emptiness checker",
    filename: "src/owner.js",
    before: "if (Object.keys(settings)",
    after: "const Object = fakeObject; if (Object.keys(settings)",
  },
  {
    name: "a route spread after snapshot props",
    filename: "src/owner.js",
    before: "<Leaf {...routeProps} {...settings}",
    after: "<Leaf {...settings} {...routeProps}",
  },
  {
    name: "a local route component",
    filename: "src/owner.js",
    before: 'import { BrowserRouter, Route } from "react-router-dom";',
    after: 'import { BrowserRouter } from "react-router-dom"; const Route = CustomRoute;',
  },
  {
    name: "a target mutation in the owner",
    filename: "src/owner.js",
    before: "return <BrowserRouter>",
    after: "settings.paragraphs.sort(); return <BrowserRouter>",
  },
  {
    name: "a whole-record opaque consumer",
    filename: "src/owner.js",
    before: "return <BrowserRouter>",
    after: "publish(settings); return <BrowserRouter>",
  },
  {
    name: "an opaque row attribute",
    filename: "src/leaf.js",
    before: "<p key={index}>",
    after: "<p key={index} {...rowAttributes}>",
  },
  {
    name: "a custom child",
    filename: "src/leaf.js",
    before: "{text}</p>",
    after: "<Preview value={text} /></p>",
  },
  {
    name: "a target-containing prop escape",
    filename: "src/leaf.js",
    before: "return <section>",
    after: "publish(props); return <section>",
  },
  {
    name: "a target alias escape",
    filename: "src/leaf.js",
    before: "return <section>",
    after: "const retained = props.paragraphs; publish(retained); return <section>",
  },
  {
    name: "a target filter before mapping",
    filename: "src/leaf.js",
    before: "props.paragraphs.map",
    after: "props.paragraphs.filter(Boolean).map",
  },
  {
    name: "a shared native JSON decoder replacement",
    filename: "src/request.js",
    before: "export const load",
    after: "JSON.parse = customDecoder; export const load",
  },
  {
    name: "a native Symbol replacement",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "globalThis.Symbol = customSymbol; ReactDOM.render(",
  },
  {
    name: "a Promise chaining replacement",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "Promise.prototype.then = customThen; ReactDOM.render(",
  },
  {
    name: "a payload mutation before population",
    filename: "src/owner.js",
    before: "if (envelope.code === 0) setSettings(envelope.data);",
    after:
      "if (envelope.code === 0) { envelope.data.paragraphs.reverse(); setSettings(envelope.data); }",
  },
  {
    name: "a nested target mutation in the leaf",
    filename: "src/leaf.js",
    before: "return <section>",
    after: "props.paragraphs.reverse(); return <section>",
  },
  {
    name: "an unoverridden route location target",
    filename: "src/leaf.js",
    before: "props.paragraphs.map",
    after: "props.location.state.paragraphs.map",
  },
  {
    name: "a target publication inside an emptiness branch",
    filename: "src/owner.js",
    before: "if (Object.keys(settings).length === 0) return null;",
    after:
      "if (Object.keys(settings).length === 0) publish(settings); if (Object.keys(settings).length === 0) return null;",
  },
  {
    name: "an owner dynamic sibling access",
    filename: "src/owner.js",
    before: "return <BrowserRouter>",
    after: "publish(settings.heading[selection]); return <BrowserRouter>",
  },
  {
    name: "a leaf dynamic sibling access",
    filename: "src/leaf.js",
    before: "return <section>",
    after: "publish(props.heading[selection]); return <section>",
  },
  {
    name: "an Object.keys writer",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "Object.keys = customKeys; ReactDOM.render(",
  },
  {
    name: "a shared React useEffect writer",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "React.useEffect = customEffect; ReactDOM.render(",
  },
  {
    name: "a sibling alias prototype mutation",
    filename: "src/leaf.js",
    before: "return <section>",
    after:
      "const sibling = props.heading; sibling.constructor.prototype.paragraphs = []; return <section>",
  },
  {
    name: "a package explicit export surface",
    filename: "package.json",
    before: '"private":true',
    after: '"private":true,"exports":"./src/leaf.js"',
  },
  {
    name: "a package export with different source casing",
    filename: "package.json",
    before: '"private":true',
    after: '"private":true,"exports":"./src/LEAF.js"',
  },
  {
    name: "a package wildcard export with different source casing",
    filename: "package.json",
    before: '"private":true',
    after: '"private":true,"exports":{"./*":"./SRC/*.JS"}',
  },
  {
    name: "a window alias JSON decoder mutation",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "const browser = window; browser.JSON.parse = customDecoder; ReactDOM.render(",
  },
  {
    name: "a parent-window decoder mutation",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "parent.JSON.parse = customDecoder; ReactDOM.render(",
  },
  {
    name: "a React hook getter replacement",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: 'React.__defineGetter__("useEffect", customEffect); ReactDOM.render(',
  },
  {
    name: "a shared prototype mutation through destructured aliases",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after:
      "const { constructor: ArrayCtor } = []; const { prototype: arrayPrototype } = ArrayCtor; arrayPrototype.map = replacement; ReactDOM.render(",
  },
  {
    name: "a self-returning window alias decoder mutation",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "const browser = window.window; browser.JSON.parse = customDecoder; ReactDOM.render(",
  },
  {
    name: "a document defaultView transport mutation",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: "document.defaultView.XMLHttpRequest = customRequest; ReactDOM.render(",
  },
  {
    name: "an unproved react-refresh runtime import",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: 'import RefreshRuntime from "react-refresh/runtime"; ReactDOM.render(',
  },
  {
    name: "an unproved hot-loader runtime import",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: 'import { hot } from "react-hot-loader/root"; ReactDOM.render(',
  },
  {
    name: "an opaque custom route ancestor",
    filename: "src/owner.js",
    before:
      'return <BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>;',
    after:
      'return <BrowserRouter><Opaque><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></Opaque></BrowserRouter>;',
  },
  {
    name: "a native JSON decoder getter replacement",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: 'JSON.__defineGetter__("parse", customDecoder); ReactDOM.render(',
  },
  {
    name: "a browser event receiver decoder replacement",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after:
      'window.addEventListener("click", function () { this.JSON.parse = customDecoder; }); ReactDOM.render(',
  },
  {
    name: "a native array prototype reached through a legacy intrinsic getter",
    filename: "src/request.js",
    before: "export const load",
    after:
      'const getPrototype = [].__lookupGetter__("__proto__"); const arrayPrototype = getPrototype.call([]); arrayPrototype.map = customMap; export const load',
  },
  {
    name: "native timer string source evaluation",
    filename: "src/request.js",
    before: "export const load",
    after: 'setTimeout("JSON.parse = customDecoder", 0); export const load',
  },
  {
    name: "a DOM lookup result used to install executable event markup",
    filename: "src/index.js",
    before: "ReactDOM.render(",
    after: `const holder = document.getElementById("root"); holder.innerHTML = '<img src="missing" onerror="JSON.parse=customDecoder">'; ReactDOM.render(`,
  },
  {
    name: "native JSX markup that can replace the JSON decoder",
    filename: "src/index.js",
    before: "<Owner />",
    after: `<main><div dangerouslySetInnerHTML={{ __html: '<img src="missing" onerror="JSON.parse=customDecoder">' }} /><Owner /></main>`,
  },
  {
    name: "a per-file custom JSX factory pragma",
    filename: "src/leaf.js",
    before: 'import React from "react";',
    after: '/** @jsx customFactory */ import React from "react";',
  },
  {
    name: "an executable native element created through an explicit React factory",
    filename: "src/index.js",
    before: "<Owner />",
    after: '<main>{React.createElement("iframe", { src: "/decoder.html" })}<Owner /></main>',
  },
  {
    name: "a lexical block declaration hiding a native JSON decoder write",
    filename: "src/request.js",
    before: "export const load",
    after: "{ function JSON() {} } JSON.parse = customDecoder; export const load",
  },
  {
    name: "a row omission",
    filename: "src/leaf.js",
    before: "<p key={index}>{index + 1}. {text}</p>",
    after: "text && <p key={index}>{index + 1}. {text}</p>",
  },
  {
    name: "a package entry export surface",
    filename: "package.json",
    before: '"private":true',
    after: '"private":true,"main":"src/leaf.js"',
  },
];

const SNAPSHOT_PRESENTATION_PROJECTION_CASES: ReadonlyArray<SnapshotFixtureMutation> = [
  {
    name: "an unknown source transform",
    filename: "package.json",
    before: '"react-scripts build"',
    after: '"custom-build"',
  },
  {
    name: "an interactive mapped row",
    filename: "src/leaf.js",
    before: "<p key={index}>",
    after: "<p key={index} onClick={select}>",
  },
  {
    name: "a mapped row ref",
    filename: "src/leaf.js",
    before: "<p key={index}>",
    after: "<p key={index} ref={retain}>",
  },
  {
    name: "an editable mapped row",
    filename: "src/leaf.js",
    before: "<p key={index}>",
    after: "<p key={index} contentEditable>",
  },
  {
    name: "a root mount with an opaque prop source",
    filename: "src/index.js",
    before: "<Owner />",
    after: "<Owner {...unknownProps} />",
  },
  {
    name: "an owner escaped through a root callback",
    filename: "src/index.js",
    before: 'ReactDOM.render(<Owner />, document.getElementById("root"));',
    after: 'replay(() => ReactDOM.render(<Owner />, document.getElementById("root")));',
  },
  {
    name: "an editable native route ancestor",
    filename: "src/owner.js",
    before:
      'return <BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>;',
    after:
      'return <main contentEditable><BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter></main>;',
  },
  {
    name: "an editable native root ancestor",
    filename: "src/index.js",
    before: "<Owner />",
    after: "<main contentEditable><Owner /></main>",
  },
  {
    name: "an opaque external native mount target",
    filename: "src/index.js",
    before: 'document.getElementById("root")',
    after: "externalRoot",
  },
  {
    name: "a root component ref attribute",
    filename: "src/index.js",
    before: "<Owner />",
    after: "<Owner ref={retain} />",
  },
];

const writeSnapshotYarnLock = (reactVersion = "16.14.0"): void => {
  const declarations = [
    ["react", "^16.0.0"],
    ["react-dom", "^16.0.0"],
  ];
  const lockEntries = declarations
    .map(
      ([packageName, declaration]) =>
        `"${packageName}@${declaration}":\n  version "${reactVersion}"\n  resolved "https://registry.yarnpkg.com/${packageName}/-/${packageName}-${reactVersion}.tgz#0123456789abcdef0123456789abcdef01234567"`,
    )
    .join("\n\n");
  writeSnapshotFile("yarn.lock", `# yarn lockfile v1\n\n${lockEntries}\n`);
};

const broadenSnapshotReactDeclarations = (): void => {
  const manifest = {
    ...SNAPSHOT_MANIFEST,
    dependencies: { ...SNAPSHOT_MANIFEST.dependencies, react: "^16.0.0", "react-dom": "^16.0.0" },
  };
  writeSnapshotFile("package.json", JSON.stringify(manifest));
};

const prepareSnapshotPresentationRoot = (): void => {
  writeSnapshotFile(
    "package.json",
    JSON.stringify({
      ...SNAPSHOT_MANIFEST,
      dependencies: { ...SNAPSHOT_MANIFEST.dependencies, antd: "^3.26.0" },
    }),
  );
  writeSnapshotFile("src/boundary.js", SNAPSHOT_BOUNDARY_SOURCE);
  writeSnapshotFile(
    "src/index.js",
    `import { LocaleProvider } from "antd"; import enUS from "antd/lib/locale-provider/en_US"; import Boundary from "./boundary"; ${SNAPSHOT_FILES["src/index.js"]}`.replace(
      "<Owner />",
      "<LocaleProvider locale={enUS}><Boundary><Owner /></Boundary></LocaleProvider>",
    ),
  );
};

const prepareSnapshotLodashGate = (declaration: string | null): void => {
  writeSnapshotFile(
    "package.json",
    JSON.stringify({
      ...SNAPSHOT_MANIFEST,
      dependencies: {
        ...SNAPSHOT_MANIFEST.dependencies,
        ...(declaration ? { lodash: declaration } : {}),
      },
    }),
  );
  const ownerSource = SNAPSHOT_FILES["src/owner.js"];
  expect(ownerSource).toBeDefined();
  writeSnapshotFile(
    "src/owner.js",
    `import isEmpty from "lodash/isEmpty";\n${ownerSource}`
      .replace("if (Object.keys(settings).length === 0) return null;", "")
      .replace("return <BrowserRouter>", "return !isEmpty(settings) && <BrowserRouter>"),
  );
};

describe("closed imported JSON snapshot ordinal keys", () => {
  it("equates a certified local const URL with the inline whole-rule request and refuses module URL cells", () => {
    for (const url of ["url", "'/catalog'"]) {
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => {
        const url = '/catalog';
        return new Promise((resolve, reject) => { axios.get(${url}, { responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });
      };`,
      );
      expect(runSnapshotLeaf()).toEqual([]);
    }
    writeSnapshotFile(
      "src/request.js",
      "import axios from 'axios'; const url = '/catalog'; export const load = () => new Promise((resolve, reject) => { axios.get(url, { responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });",
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ["let unused = '/catalog';", "const requestOptions = { responseType: 'json' };"],
    ["let timeout = 100;", "let requestOptions = { timeout, responseType: 'json' };"],
    ["let baseOptions = { responseType: 'json' };", "const requestOptions = { ...baseOptions };"],
    ["const baseOptions = { responseType: 'json' };", "let requestOptions = { ...baseOptions };"],
    [
      "let count = 100; let timeout = +count;",
      "let requestOptions = { timeout, responseType: 'json' };",
    ],
  ])(
    "certifies ordered read-only local let prefixes through the ordinal rule: %s / %s",
    (helperPrelude, executorPrelude) => {
      for (const kind of ["let", "const"]) {
        writeSnapshotFile(
          "src/request.js",
          `import axios from 'axios'; export const load = () => {
        ${helperPrelude.replaceAll("let ", `${kind} `)}
        return new Promise((resolve, reject) => {
          ${executorPrelude.replaceAll("let ", `${kind} `)}
          const onFailure = error => reject(error);
          axios(requestOptions).then(response => resolve(response.data)).catch(onFailure);
        });
      };`,
        );
        expect(runSnapshotLeaf()).toEqual([]);
      }
    },
  );

  it("retains private-argument and exact default-response boundaries with let prefixes", () => {
    const manifest = {
      ...SNAPSHOT_MANIFEST,
      dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
    };
    writeSnapshotFile("package.json", JSON.stringify(manifest));
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      let timeout = options.timeout;
      let requestOptions = { ...options, timeout };
      return new Promise((resolve, reject) => {
        let unused = null;
        axios(requestOptions).then(response => { if (response.status === 200) resolve(response.data); else reject(); }).catch(reject);
      });
    };`,
    );
    replaceSnapshotSource({
      name: "readonly let caller",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ timeout: 100, responseType: 'text' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile("package.json", JSON.stringify(SNAPSHOT_MANIFEST));
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile("package.json", JSON.stringify({ ...manifest, main: "src/request.js" }));
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "var requestOptions = { responseType: 'json' };",
    "let requestOptions;",
    "let requestOptions = { responseType: 'json' }, other = null;",
    "let unused = /(?i:a)/; let requestOptions = { responseType: 'json' };",
    "let requestOptions = unknown;",
    "let requestOptions = makeOptions();",
    "let requestOptions = { get responseType() { return 'json'; } };",
    "let requestOptions = { ...later }; let later = { responseType: 'json' };",
    "let count = +count; let requestOptions = { responseType: 'json' };",
    "let baseOptions = { responseType: 'json' }; let requestOptions = baseOptions;",
    "let mode = 'json'; let requestOptions = { responseType: mode };",
    "let requestOptions = { responseType: 'json' }; const capture = () => requestOptions;",
    "let requestOptions = { responseType: 'json' }; requestOptions.responseType = 'text';",
    "let requestOptions = { responseType: 'json' }; observe(requestOptions);",
    "let requestOptions = { responseType: 'json' }; const unused = arguments;",
    "if (true) { let requestOptions = { responseType: 'json' }; }",
  ])("retains ordinal warnings for unproved let initialization or escape: %s", (prelude) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${prelude} axios(requestOptions).then(response => resolve(response.data)).catch(reject);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("does not publish let capabilities to other modules or let forwarding functions", () => {
    const source = `import axios from 'axios'; export const load = () => {
      let requestOptions = { responseType: 'json' };
      return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`;
    writeSnapshotFile("src/request.js", source);
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/other.js",
      "import axios from 'axios'; let requestOptions = { responseType: 'json' }; axios(requestOptions);",
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile(
      "src/other.js",
      "import axios from 'axios'; const requestOptions = { responseType: 'json' }; axios(requestOptions);",
    );
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/request.js",
      source
        .replace(
          "return new Promise((resolve, reject) => {",
          "return new Promise((resolve, reject) => { let onFailure = error => reject(error);",
        )
        .replace(".catch(reject)", ".catch(onFailure)"),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("counts let cells and the selected const handler in the combined prelude limit", () => {
    const declarations = Array.from(
      { length: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT - 1 },
      (_, index) => `let unused${index} = null;`,
    ).join(" ");
    const source = `import axios from 'axios'; export const load = () => {
      ${declarations}
      return new Promise((resolve, reject) => {
        const onFailure = error => reject(error);
        axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
      });
    };`;
    writeSnapshotFile("src/request.js", source);
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/request.js",
      source.replace("const onFailure", "let extra = null; const onFailure"),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "error => reject(error)",
    "error => { reject(error); }",
    "error => { return reject(error); }",
    "resolve => reject(resolve)",
  ])(
    "certifies executor-local const rejection forwarding through the ordinal rule: %s",
    (handler) => {
      for (const success of [
        "response => resolve(response.data)",
        "response => { if (response.status === 200) resolve(response.data); else reject(response.status); }",
      ]) {
        writeSnapshotFile(
          "src/request.js",
          `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        const onFailure = ${handler};
        axios({ responseType: 'json' }).then(${success}).catch(onFailure);
      });`,
        );
        expect(runSnapshotLeaf()).toEqual([]);
      }
    },
  );

  it("preserves private caller and exact default-response roles with local forwarding and inert prefixes", () => {
    const manifest = {
      ...SNAPSHOT_MANIFEST,
      dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
    };
    writeSnapshotFile("package.json", JSON.stringify(manifest));
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options };
      return new Promise((complete, fail) => {
        const onProblem = reason => { return fail(reason); };
        const unused = null;
        axios(requestOptions).then(reply => complete(reply.data)).catch(onProblem);
      });
    };`,
    );
    replaceSnapshotSource({
      name: "local forwarding caller",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ responseType: 'text' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile("package.json", JSON.stringify(SNAPSHOT_MANIFEST));
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile("package.json", JSON.stringify({ ...manifest, main: "src/request.js" }));
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "error => reject(other)",
    "reject => reject(reject)",
    "error => resolve(error)",
    "error => reject(error.message)",
    "error => reject?.(error)",
    "async error => reject(error)",
    "function(error) { reject(error); }",
    "(error = other) => reject(error)",
    "(...errors) => reject(errors)",
    "({ error }) => reject(error)",
    "error => { ; reject(error); }",
    "error => { 'use strict'; reject(error); }",
    "error => { console.log(error); reject(error); }",
    "error => { const reason = error; reject(reason); }",
    "error => onFailure(error)",
    "makeForwarder(reject)",
  ])("retains ordinal warnings for unproved local rejection functions: %s", (handler) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      const onFailure = ${handler};
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "let onFailure = error => reject(error);",
    "var onFailure = error => reject(error);",
    "const onFailure = error => reject(error), unused = null;",
    "const onFailure = error => reject(error); const alias = onFailure;",
    "const onFailure = error => reject(error); const unused = reject;",
    "const onFailure = error => reject(error); const unused = () => null;",
    "const onFailure = error => reject(error); onFailure(other);",
    "{ const onFailure = error => reject(error); }",
  ])("retains exact local declaration and use closure in the ordinal rule: %s", (declarations) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${declarations}
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("keeps module-level and late rejection declarations outside the local proof", () => {
    for (const source of [
      "import axios from 'axios'; const onFailure = error => reject(error); export const load = () => new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); });",
      "import axios from 'axios'; export const load = () => new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); const onFailure = error => reject(error); });",
    ]) {
      writeSnapshotFile("src/request.js", source);
      expect(runSnapshotLeaf()).toHaveLength(1);
    }
  });

  it("counts the selected local handler inside the combined twelve-declaration limit", () => {
    const inert = Array.from(
      { length: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT - 1 },
      (_, index) => `const unused${index} = null;`,
    ).join(" ");
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${inert} const onFailure = error => reject(error);
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    writeSnapshotFile("src/request.js", source);
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/request.js",
      source.replace("const onFailure", "const extra = null; const onFailure"),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "axios.interceptors.response.use(decode);",
    "axios.defaults.transformResponse = decode;",
    "JSON.parse = decode;",
    "XMLHttpRequest = ForeignRequest;",
  ])("retains native/client/source guards with a local handler: %s", (prefix) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; ${prefix} export const load = () => new Promise((resolve, reject) => {
      const onFailure = error => reject(error);
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ["0.17.1", "url: '/catalog'", 0],
    ["0.17.1", "responseType: 'text'", 0],
    ["0.17.1", "responseType: 'json'", 0],
    ["0.18.0", "url: '/catalog'", 0],
    ["0.18.0", "responseType: 'text'", 0],
    ["0.18.0", "responseType: 'json'", 0],
    ["0.21.1", "url: '/catalog'", 0],
    ["0.21.1", "responseType: 'text'", 0],
    ["0.21.1", "responseType: 'json'", 0],
    ["0.17.0", "responseType: 'text'", 1],
    ["0.18.1", "url: '/catalog'", 1],
    ["0.21.0", "responseType: 'text'", 1],
    ["0.21.2", "url: '/catalog'", 1],
    ["^0.21.0", "responseType: 'text'", 1],
    ["0.17.1 || 0.18.0", "url: '/catalog'", 1],
    ["0.21.0", "responseType: 'json'", 0],
    ["^0.21.0", "responseType: 'json'", 0],
    ["0.21.1", "responseType: 'arraybuffer'", 1],
    ["0.21.1", "responseType: 'blob'", 1],
    ["0.21.1", "responseType: ''", 1],
    ["0.21.1", "responseType: null", 1],
    ["0.21.1", "responseType: undefined", 1],
    ["0.21.1", "responseType: false", 1],
    ["0.21.1", "responseType: 'text', ...{ responseType: 'arraybuffer' }", 1],
    ["0.21.1", "responseType: 'arraybuffer', ...{ responseType: 'text' }", 0],
    ["0.21.1", "responseType: 'text', ...{ responseType: 'json' }", 0],
  ])(
    "gates default-response ordinal proofs on exact source evidence: %s / %s",
    (version, options, count) => {
      writeSnapshotFile(
        "package.json",
        JSON.stringify({
          ...SNAPSHOT_MANIFEST,
          dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: version },
        }),
      );
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ ${options} }).then(response => resolve(response.data)).catch(error => reject(error));
    });`,
      );
      expect(runSnapshotLeaf()).toHaveLength(count);
    },
  );

  it.each([
    ["axios.request({})", 0],
    ["axios.get('/catalog', { responseType: 'text' })", 0],
    ["axios.get('/catalog')", 1],
    ["axios(process.env.NODE_ENV === 'production' ? {} : { responseType: 'text' })", 0],
    ["axios(process.env.NODE_ENV === 'production' ? {} : { responseType: 'arraybuffer' })", 1],
  ])("keeps target request arity and every final record closed: %s", (request, count) => {
    writeSnapshotFile(
      "package.json",
      JSON.stringify({
        ...SNAPSHOT_MANIFEST,
        dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
      }),
    );
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(reject);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(count);
  });

  it.each([
    { resolutions: { axios: "0.17.1" } },
    { overrides: { axios: "0.21.0" } },
    { overrides: { tooling: { axios: "0.21.1" } } },
  ])(
    "disables default/text on relevant replacements while preserving explicit JSON: %j",
    (replacement) => {
      writeSnapshotFile(
        "package.json",
        JSON.stringify({
          ...SNAPSHOT_MANIFEST,
          ...replacement,
          dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.17.1" },
        }),
      );
      for (const responseType of ["text", "json"]) {
        writeSnapshotFile(
          "src/request.js",
          `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios({ responseType: '${responseType}' }).then(response => resolve(response.data)).catch(reject);
      });`,
        );
        expect(runSnapshotLeaf()).toHaveLength(responseType === "json" ? 0 : 1);
      }
    },
  );

  it.each([
    [{ pnpm: { overrides: { axios: "npm:foreign-client@1.0.0" } } }, false],
    [{ pnpm: { patchedDependencies: { "axios@0.21.1": "patches/axios.patch" } } }, false],
    [{ pnpm: "opaque" }, false],
    [{ pnpm: {} }, false],
    [{ patchedDependencies: {} }, false],
    [{ packageExtensions: {} }, false],
    [{ packageManager: "pnpm@9.15.9" }, false],
    [{ packageManager: "bun@1.3.0" }, false],
    [{ packageManager: null }, false],
    [{ packageManager: "npm@latest" }, false],
    [{ packageManager: "npm@10.9.0" }, true],
    [{ packageManager: "yarn@1.22.22" }, true],
    [{ overrides: { tooling: "99.0.0" } }, true],
  ])(
    "applies the conservative upstream manifest profile only to default/text: %j",
    (metadata, allowsDefault) => {
      writeSnapshotFile(
        "package.json",
        JSON.stringify({
          ...SNAPSHOT_MANIFEST,
          ...metadata,
          dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
        }),
      );
      for (const options of ["{}", "{ responseType: 'text' }", "{ responseType: 'json' }"]) {
        writeSnapshotFile(
          "src/request.js",
          `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios(${options}).then(response => resolve(response.data)).catch(reject);
      });`,
        );
        expect(runSnapshotLeaf()).toHaveLength(allowsDefault || options.includes("'json'") ? 0 : 1);
      }
    },
  );

  it("uses only selected lock evidence for default-response ownership", () => {
    for (const declaration of ["^0.17.0", "^0.21.0"]) {
      const version = declaration === "^0.17.0" ? "0.17.1" : "0.21.1";
      writeSnapshotFile(
        "package.json",
        JSON.stringify({
          ...SNAPSHOT_MANIFEST,
          dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: declaration },
        }),
      );
      writeSnapshotFile(
        "yarn.lock",
        `# yarn lockfile v1\n\n"axios@${declaration}":\n  version "${version}"\n  resolved "https://registry.yarnpkg.com/axios/-/axios-${version}.tgz#${"a".repeat(40)}"\n`,
      );
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios({}).then(response => resolve(response.data)).catch(reject);
      });`,
      );
      expect(runSnapshotLeaf()).toHaveLength(declaration === "^0.17.0" ? 0 : 1);
    }
  });

  it.each([
    "axios({});",
    "axios.request({ responseType: 'text' });",
    "axios.defaults.responseType = 'text';",
    "axios.defaults.transformResponse = decode;",
    "axios.interceptors.response.use(decode);",
    "const alias = axios;",
    "JSON.parse = decode;",
    "XMLHttpRequest = ForeignRequest;",
  ])("retains client/global closure with eligible default-response evidence: %s", (prefix) => {
    writeSnapshotFile(
      "package.json",
      JSON.stringify({
        ...SNAPSHOT_MANIFEST,
        dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
      }),
    );
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; ${prefix}
      export const load = () => new Promise((resolve, reject) => {
        axios({}).then(response => resolve(response.data)).catch(reject);
      });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("keeps default-response approval bound to the exact module and target call", () => {
    writeSnapshotFile(
      "package.json",
      JSON.stringify({
        ...SNAPSHOT_MANIFEST,
        dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
      }),
    );
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({}).then(response => resolve(response.data)).catch(reject);
    });`,
    );
    writeSnapshotFile("src/other.js", "import axios from 'axios'; axios({});");
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile(
      "src/other.js",
      "import axios from 'axios'; axios({ responseType: 'json' });",
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("bounds new default-response alternatives without changing the legacy JSON ordinal proof", () => {
    writeSnapshotFile(
      "package.json",
      JSON.stringify({
        ...SNAPSHOT_MANIFEST,
        dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
      }),
    );
    for (const options of ["{}", "{ responseType: 'text' }", "{ responseType: 'json' }"]) {
      let alternatives = options;
      for (let depth = 0; depth < 4; depth++)
        alternatives = `true ? (${alternatives}) : (${alternatives})`;
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios(${alternatives}).then(response => resolve(response.data)).catch(reject);
      });`,
      );
      expect(runSnapshotLeaf()).toHaveLength(options.includes("'json'") ? 0 : 1);
    }
  });

  it("preserves private caller and sole-population boundaries for default-response preludes", () => {
    const manifest = {
      ...SNAPSHOT_MANIFEST,
      dependencies: { ...SNAPSHOT_MANIFEST.dependencies, axios: "0.21.1" },
    };
    writeSnapshotFile("package.json", JSON.stringify(manifest));
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options };
      return new Promise((resolve, reject) => {
        axios(requestOptions).then(response => { if (200 === response.status) resolve(response.data); else reject(response.status); }).catch(reject);
      });
    };`,
    );
    replaceSnapshotSource({
      name: "default-response private caller",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ responseType: 'text' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile("package.json", JSON.stringify({ ...manifest, main: "src/request.js" }));
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile("package.json", JSON.stringify(manifest));
    replaceSnapshotSource({
      name: "second population",
      filename: "src/owner.js",
      before: "if (envelope.code === 0) setSettings(envelope.data);",
      after: "if (envelope.code === 0) setSettings(envelope.data); setSettings(envelope.data);",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "error => reject(error)",
    "error => { reject(error); }",
    "error => { return reject(error); }",
    "response => reject(response)",
  ])("certifies exact inline rejection forwarding through the ordinal rule: %s", (handler) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => {
      const requestOptions = { url: '/catalog', responseType: 'json' };
      return new Promise((resolve, reject) => {
        axios(requestOptions).then(response => { if (200 === response.status) resolve(response.data); else reject(response.status); }).catch(${handler});
      });
    };`,
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("retains the private-argument boundary with inline rejection forwarding", () => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options, responseType: 'json' };
      return new Promise((complete, fail) => {
        axios(requestOptions).then(reply => complete(reply.data)).catch(problem => fail(problem));
      });
    };`,
    );
    replaceSnapshotSource({
      name: "inline rejection caller",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "package.json",
      JSON.stringify({ ...SNAPSHOT_MANIFEST, main: "src/request.js" }),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "error => reject(other)",
    "reject => reject(reject)",
    "error => resolve(error)",
    "error => reject(error.message)",
    "async error => reject(error)",
    "error => { const unused = null; reject(error); }",
    "error => { console.log(error); reject(error); }",
    "error => { ; reject(error); }",
  ])("retains ordinal warnings for unproved inline rejection handling: %s", (handler) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(${handler});
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ["null", 0],
    ["/(?i:a)/", 1],
    ["1n", 1],
    ["1e999", 0],
  ])(
    "keeps request and prelude primitive syntax closed in the ordinal rule: %s",
    (value, warningCount) => {
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => {
      const unused = ${value};
      return new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });
    };`,
      );
      expect(runSnapshotLeaf()).toHaveLength(warningCount);
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ data: ${value}, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`,
      );
      expect(runSnapshotLeaf()).toHaveLength(warningCount);
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`,
      );
      replaceSnapshotSource({
        name: "primitive caller",
        filename: "src/owner.js",
        before: "load().then",
        after: `load({ data: ${value} }).then`,
      });
      expect(runSnapshotLeaf()).toHaveLength(warningCount);
    },
  );

  it.each([
    ["null", 0],
    ["/(?i:a)/", 1],
    ["1n", 1],
  ])(
    "keeps special literal rejection syntax outside ordinal certification: %s",
    (reason, warningCount) => {
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => {
        if (response.status === 200) resolve(response.data); else reject(${reason});
      }).catch(reject);
    });`,
      );
      expect(runSnapshotLeaf()).toHaveLength(warningCount);
    },
  );

  it.each([
    ["response.status === 200", ""],
    ["200 === response.status", "'failed'"],
    ["response.status === 200", "false"],
    ["200 === response.status", "null"],
    ["response.status === 200", "0"],
    ["200.5 === response.status", "response.status"],
  ])("certifies exact exhaustive HTTP-status forwarding: %s / %s", (condition, reason) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => {
      const requestOptions = { url: '/catalog', responseType: 'json' };
      return new Promise((resolve, reject) => {
        axios(requestOptions).then(response => {
          if (${condition}) { return resolve(response['data']); } else { return reject(${reason}); }
        }).catch(reject);
      });
    };`,
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("preserves fresh argument and public-entry boundaries for status forwarding", () => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options, responseType: 'json' };
      return new Promise((complete, fail) => {
        axios(requestOptions).then(reply => { if (200 === reply.status) complete(reply.data); else fail(reply.status); }).catch(fail);
      });
    };`,
    );
    replaceSnapshotSource({
      name: "guarded caller",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "package.json",
      JSON.stringify({ ...SNAPSHOT_MANIFEST, main: "src/request.js" }),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "if (foreign.status === 200) resolve(response.data); else reject(response.status);",
    "if (response.status === 200) resolve(foreign.data); else reject(response.status);",
    "if (response.status === 200) resolve(response.data); else reject(foreign.status);",
    "if (response.status == 200) resolve(response.data); else reject();",
    "if (response['status'] === 200) resolve(response.data); else reject();",
    "if (response.status === 200) resolve(response.data);",
    "if (response.status === 200) resolve(response.data); else resolve(response.data);",
    "if (response.status === 200) resolve(response.data); else reject(response.data);",
    "if (response.status === 200) resolve(response.data); else reject(new Error('failed'));",
    "if (response.status === 200) { resolve(response.data); console.log(response); } else reject();",
    "if (response.status === 200) return resolve(response.data); return reject();",
  ])("retains the ordinal warning for an unproved status callback: %s", (body) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => { ${body} }).catch(reject);
    });`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ["const requestOptions = { url: '/catalog', responseType: 'json' };", "", "requestOptions"],
    ["", "const requestOptions = { url: '/catalog', responseType: 'json' };", "requestOptions"],
    [
      "const url = '/catalog'; const transport = { url };",
      "const requestOptions = { ...transport, responseType: 'json' };",
      "requestOptions",
    ],
  ])(
    "certifies closed provider const preludes through the ordinal rule: %s %s",
    (helperPrelude, executorPrelude, requestOptions) => {
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios'; export const load = () => {
      ${helperPrelude}
      return new Promise((resolve, reject) => { ${executorPrelude} axios(${requestOptions}).then(response => resolve(response.data)).catch(reject); });
    };`,
      );
      expect(runSnapshotLeaf()).toEqual([]);
    },
  );

  it("retains private fresh-argument and public zero-argument boundaries with provider preludes", () => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = options => {
      const url = options.url;
      return new Promise((resolve, reject) => { const requestOptions = { url, responseType: 'json' }; axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`,
    );
    replaceSnapshotSource({
      name: "prelude argument",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "package.json",
      JSON.stringify({ ...SNAPSHOT_MANIFEST, main: "src/request.js" }),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => {
      const requestOptions = { url: '/catalog', responseType: 'json' };
      return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`,
    );
    writeSnapshotFile("src/owner.js", SNAPSHOT_FILES["src/owner.js"]);
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it.each([
    "const unused = sideEffect();",
    "const unused = { get url() { return '/catalog'; } };",
    "const unused = { ...unknown };",
    "const first = { url: later }; const later = '/catalog';",
    "const unused = () => foreign;",
    "const unused = { headers: {} };",
    "const unused = true ? { url: '/catalog' } : { url: '/other' };",
    "let unused = '/catalog'; unused = '/other';",
    "const unused = '/catalog'; publish(unused);",
    "const unused = { url: '/catalog' }; unused.url = '/other';",
    "if (true) { const unused = '/catalog'; }",
  ])("retains the ordinal warning for unsupported provider preludes: %s", (prelude) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios'; export const load = () => {
      ${prelude}
      return new Promise((resolve, reject) => { axios({ url: '/catalog', responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });
    };`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ['import React from "react";', "React.Fragment"],
    ['import * as Runtime from "react";', "Runtime.Fragment"],
    ['import { Fragment as Group } from "react";', "Group"],
  ])("certifies imported fragment leaf and owner ancestors: %s", (declaration, tagName) => {
    for (const filename of ["src/leaf.js", "src/owner.js"]) {
      const original = SNAPSHOT_FILES[filename];
      const wrapped = original
        .replace(
          'import React from "react";',
          tagName === "React.Fragment" ? declaration : `import React from "react"; ${declaration}`,
        )
        .replace(
          'import React, { useEffect, useState } from "react";',
          tagName === "React.Fragment"
            ? 'import React, { useEffect, useState } from "react";'
            : `import React, { useEffect, useState } from "react"; ${declaration}`,
        )
        .replace("return <", `return <${tagName}><`)
        .replace("</section>;", `</section></${tagName}>;`)
        .replace("</BrowserRouter>;", `</BrowserRouter></${tagName}>;`);
      replaceSnapshotSource({
        name: "imported fragment",
        filename,
        before: original,
        after: wrapped,
      });
    }
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it.each([
    "return Object.keys(settings).length ? ROUTER : null;",
    "return Object.keys(settings).length ? ROUTER : false;",
    "if (Object.keys(settings).length) return ROUTER; return null;",
    "if (Object.keys(settings).length) { return ROUTER; } else { return false; }",
  ])("certifies a native state-key-count truthiness gate: %s", (statement) => {
    const router =
      '<BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>';
    replaceSnapshotSource({
      name: "native count gate",
      filename: "src/owner.js",
      before: `if (Object.keys(settings).length === 0) return null;\n      return ${router};`,
      after: statement.replace("ROUTER", router),
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it.each([
    "Object.keys(settings).length && ROUTER",
    "Object.keys(settings).length ? null : ROUTER",
    "Object.keys(settings).length ? ROUTER : <aside>other</aside>",
    "Object.keys(settings).length ? ROUTER : ROUTER",
    "Object.keys(settings.heading).length ? ROUTER : null",
    "Object.keys(other).length ? ROUTER : null",
    "settings.length ? ROUTER : null",
    "Object.keys(settings, other).length ? ROUTER : null",
    "Object.keys?.(settings).length ? ROUTER : null",
    "Object?.keys(settings).length ? ROUTER : null",
    "Object.keys(settings)?.length ? ROUTER : null",
  ])("retains warnings for an unproved count gate: %s", (expression) => {
    const router =
      '<BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>';
    replaceSnapshotSource({
      name: "unproved count gate",
      filename: "src/owner.js",
      before: `if (Object.keys(settings).length === 0) return null;\n      return ${router};`,
      after: `return ${expression.replaceAll("ROUTER", router)};`,
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "Object.keys?.(settings).length",
    "Object?.keys(settings).length",
    "Object.keys(settings)?.length",
  ])("preserves refusal for an optional-chain comparator gate: %s", (count) => {
    replaceSnapshotSource({
      name: "optional comparator",
      filename: "src/owner.js",
      before: "Object.keys(settings).length === 0",
      after: `${count} === 0`,
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    ["function Owner()", "function Owner(Object)"],
    ["return Object.keys", "Object.keys = foreign; return Object.keys"],
    ["return Object.keys", "setSettings({}); return Object.keys"],
    ["return Object.keys", "settings.paragraphs.sort(); return Object.keys"],
  ])("retains count-gate binding and ownership controls: %s", (before, after) => {
    const router =
      '<BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>';
    const original = SNAPSHOT_FILES["src/owner.js"];
    const source = original.replace(
      `if (Object.keys(settings).length === 0) return null;\n      return ${router};`,
      `return Object.keys(settings).length ? ${router} : null;`,
    );
    expect(source).toContain(before);
    writeSnapshotFile("src/owner.js", source.replace(before, after));
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies a genuinely aliased BrowserRouter with a fixed basename", () => {
    const original = SNAPSHOT_FILES["src/owner.js"];
    writeSnapshotFile(
      "src/owner.js",
      original
        .replace("{ BrowserRouter, Route }", "{ BrowserRouter as Shell, Route }")
        .replace("<BrowserRouter>", '<Shell basename="/docs">')
        .replace("</BrowserRouter>", "</Shell>"),
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it.each(['""', '"/docs"', '{"/docs"}'])(
    "certifies a sole fixed string BrowserRouter basename: %s",
    (basename) => {
      replaceSnapshotSource({
        name: "fixed basename",
        filename: "src/owner.js",
        before: "<BrowserRouter>",
        after: `<BrowserRouter basename=${basename}>`,
      });
      expect(runSnapshotLeaf()).toEqual([]);
    },
  );

  it.each([
    "basename={base}",
    "basename={`/${base}`}",
    "basename={getBase()}",
    "basename",
    "basename={false}",
    "basename={null}",
    'basename={{ path: "/" }}',
    'basename="/" basename="/other"',
    'basename="/" {...attributes}',
    'basename="/" key="fixed"',
    'basename="/" ref={capture}',
    'basename="/" children={foreign}',
    'basename="/" getUserConfirmation={confirm}',
    'basename="/" forceRefresh={false}',
  ])("retains warnings for an opaque or extra BrowserRouter attribute: %s", (attributes) => {
    replaceSnapshotSource({
      name: "opaque basename",
      filename: "src/owner.js",
      before: "<BrowserRouter>",
      after: `<BrowserRouter ${attributes}>`,
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reads the project once for multiple eligible maps in one file", () => {
    writeSnapshotFile(
      "package.json",
      JSON.stringify({ ...SNAPSHOT_MANIFEST, main: "src/leaf.js" }),
    );
    const sourceText = `import React from "react";
      export const First = props => <section>{props.paragraphs.map((text, index) => <p key={index}>{index + 1}. {text}</p>)}</section>;
      export const Second = props => <section>{props.paragraphs.map((text, index) => <p key={index}>{index + 1}. {text}</p>)}</section>;`;
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const incomingFilename = normalizeFilename(path.join(temporaryDirectory, "src/index.js"));
    writeSnapshotFile("src/leaf.js", sourceText);
    const readFile = vi.spyOn(filesystem, "readFileSync");
    syncBuiltinESMExports();
    try {
      const result = runRule(noArrayIndexAsKey, sourceText, { filename, forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
      expect(
        readFile.mock.calls.filter(([filePath]) => filePath === incomingFilename),
      ).toHaveLength(1);
    } finally {
      readFile.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it("reuses a refused project only within the current file analysis", () => {
    const sourceText = `import React from "react";
      export const First = props => <section>{props.paragraphs.map((text, index) => <p key={index}>{index + 1}. {text}</p>)}</section>;
      export const Second = props => <section>{props.paragraphs.map((text, index) => <p key={index}>{index + 1}. {text}</p>)}</section>;`;
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const incomingFilename = normalizeFilename(path.join(temporaryDirectory, "src/index.js"));
    writeSnapshotFile("src/leaf.js", sourceText);
    writeSnapshotFile(
      "src/unresolved.js",
      'import missing from "./missing"; export default missing;',
    );
    const readFile = vi.spyOn(filesystem, "readFileSync");
    syncBuiltinESMExports();
    try {
      const result = runRule(noArrayIndexAsKey, sourceText, { filename, forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
      expect(
        readFile.mock.calls.filter(([filePath]) => filePath === incomingFilename),
      ).toHaveLength(1);
    } finally {
      readFile.mockRestore();
      syncBuiltinESMExports();
    }
  });

  it("refreshes the project when the same visitors enter the same Program again", () => {
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const sourceText = SNAPSHOT_FILES["src/leaf.js"];
    const repeatedProgramRule = {
      ...noArrayIndexAsKey,
      create: (context: RuleContext) => {
        const visitors = noArrayIndexAsKey.create(context);
        let keyAttribute: EsTreeNode | undefined;
        return {
          ...visitors,
          JSXAttribute(node: EsTreeNode) {
            keyAttribute = node;
            visitors.JSXAttribute?.(node);
          },
          "Program:exit"(node: EsTreeNode) {
            writeSnapshotFile(
              "src/new-consumer.js",
              'import Leaf from "./leaf"; export const extra = <Leaf paragraphs={["new"]} />;',
            );
            visitors.Program?.(node);
            expect(keyAttribute).toBeDefined();
            if (keyAttribute) visitors.JSXAttribute?.(keyAttribute);
          },
        };
      },
    };
    const result = runRule(repeatedProgramRule, sourceText, { filename, forceJsx: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("refreshes incoming consumers on a new scan of the identical parsed AST", () => {
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const sourceText = SNAPSHOT_FILES["src/leaf.js"];
    const parsed = parseFixture(sourceText, { filename, forceJsx: true });
    expect(
      runRuleOnParsedFixture(noArrayIndexAsKey, sourceText, parsed, { filename }).diagnostics,
    ).toEqual([]);
    writeSnapshotFile(
      "src/new-consumer.js",
      'import Leaf from "./leaf"; export const extra = <Leaf paragraphs={["new"]} />;',
    );
    const result = runRuleOnParsedFixture(noArrayIndexAsKey, sourceText, parsed, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("certifies a complete imported provider, gated owner, route callback and native leaf", () => {
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it.each([
    ["{ ...options, responseType: 'json' }", "{ url: '/catalog', method: 'get' }"],
    [
      "{ url: options.url, method: options.method, responseType: 'json' }",
      "{ url: '/catalog', method: 'get' }",
    ],
    ["{ responseType: 'json', ...options }", "{ url: '/catalog' }"],
    ["{ responseType: 'json', ...options }", "{ url: '/catalog', responseType: 'json' }"],
  ])(
    "certifies the sole imported helper with fresh primitive options: %s",
    (requestOptions, argumentSource) => {
      writeSnapshotFile(
        "src/request.js",
        `import axios from 'axios';
      export const load = options => new Promise((resolve, reject) => {
        axios(${requestOptions}).then(response => resolve(response.data)).catch(reject);
      });`,
      );
      replaceSnapshotSource({
        name: "fresh request options",
        filename: "src/owner.js",
        before: "load().then",
        after: `load(${argumentSource}).then`,
      });
      expect(runSnapshotLeaf()).toEqual([]);
    },
  );

  it.each([
    ["an unknown argument", "", "unknown"],
    ["a caller alias", "const options = { url: '/catalog' };", "options"],
    [
      "a published caller alias",
      "const options = { url: '/catalog' }; publish(options);",
      "options",
    ],
    ["a caller spread", "", "{ ...unknown }"],
    ["an argument getter", "", "{ get url() { return '/catalog'; } }"],
    ["an effectful argument", "", "{ url: compute() }"],
    ["a nested caller record", "", "{ url: '/catalog', headers: {} }"],
    ["an adapter field", "", "{ url: '/catalog', adapter: custom }"],
  ])("keeps the ordinal warning for %s", (_description, prefix, argumentSource) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios';
      export const load = options => new Promise((resolve, reject) => {
        axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
      });`,
    );
    writeSnapshotFile(
      "src/owner.js",
      `${prefix}
${SNAPSHOT_FILES["src/owner.js"].replace("load().then", `load(${argumentSource}).then`)}`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it.each([
    "{ responseType: 'json', ...options }",
    "{ url: options.missing, responseType: 'json' }",
    "{ url: options['url'], responseType: 'json' }",
    "{ ...options, responseType: 'json', transformResponse: [JSON.parse] }",
    "unknown ? { ...options, responseType: 'json' } : externalOptions",
  ])("keeps the warning for unproved request provenance: %s", (requestOptions) => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios';
      export const load = options => new Promise((resolve, reject) => {
        axios(${requestOptions}).then(response => resolve(response.data)).catch(reject);
      });`,
    );
    replaceSnapshotSource({
      name: "caller override control",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog', responseType: 'text' }).then",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("refuses public options helpers while preserving public zero-argument provider behavior", () => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios';
      export const load = options => new Promise((resolve, reject) => {
        axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
      });`,
    );
    replaceSnapshotSource({
      name: "fresh request options",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "package.json",
      JSON.stringify({ ...SNAPSHOT_MANIFEST, main: "src/request.js" }),
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
    writeSnapshotFile("src/request.js", SNAPSHOT_FILES["src/request.js"]);
    writeSnapshotFile("src/owner.js", SNAPSHOT_FILES["src/owner.js"]);
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("keeps the warning when a fresh-options helper has another active caller", () => {
    writeSnapshotFile(
      "src/request.js",
      `import axios from 'axios';
      export const load = options => new Promise((resolve, reject) => {
        axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
      });`,
    );
    replaceSnapshotSource({
      name: "fresh request options",
      filename: "src/owner.js",
      before: "load().then",
      after: "load({ url: '/catalog' }).then",
    });
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile("src/extra-consumer.js", "import { load } from './request'; load(unknown);");
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies a genuine fixed-locale SDK provider and complete local error boundary root", () => {
    prepareSnapshotPresentationRoot();
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("certifies the fixed-locale SDK provider and local error boundary in the actual engine", async () => {
    prepareSnapshotPresentationRoot();
    expect(await runNativeSnapshotLeaf()).toEqual([]);
  });

  it("holds opaque conditional receiver transport without a production assumption", () => {
    prepareSnapshotPresentationRoot();
    const entrySource = fs.readFileSync(path.join(temporaryDirectory, "src/index.js"), "utf8");
    writeSnapshotFile(
      "src/index.js",
      `${entrySource}\nif (module.hot) { const Fresh = require("./owner").default; ReactDOM.render(<Fresh />, document.getElementById("root")); }`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("refuses the presentation root when source activates opaque hot replay", () => {
    prepareSnapshotPresentationRoot();
    const entrySource = fs.readFileSync(path.join(temporaryDirectory, "src/index.js"), "utf8");
    writeSnapshotFile(
      "src/index.js",
      `${entrySource}\nmodule.hot = true; if (module.hot) { const Fresh = require("./owner").default; ReactDOM.render(<Fresh />, document.getElementById("root")); }`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("does not attest a retry boundary above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "boundary retry",
      filename: "src/boundary.js",
      before: "render() {",
      after: "retry() { this.setState({ hasError: false }); } render() {",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not attest a reset lifecycle above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "boundary reset lifecycle",
      filename: "src/boundary.js",
      before: "render() {",
      after: "componentDidUpdate() { this.setState({ hasError: false }); } render() {",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not attest a wrapper above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "opaque boundary render",
      filename: "src/boundary.js",
      before: "return this.props.children;",
      after: "return decorate(this.props.children);",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("allows unrelated locale data above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "runtime locale",
      filename: "src/index.js",
      before: "locale={enUS}",
      after: "locale={runtimeLocale}",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("keeps unrelated locale-object writes outside the selected receiver proof", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "locale writer",
      filename: "src/index.js",
      before: "ReactDOM.render(",
      after: 'enUS.locale = "changed"; ReactDOM.render(',
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("allows ordinary props above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "unknown SDK prop",
      filename: "src/index.js",
      before: "<LocaleProvider locale={enUS}>",
      after: "<LocaleProvider locale={enUS} onChange={refresh}>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("allows ordinary class props above the owning cell", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "unknown boundary prop",
      filename: "src/index.js",
      before: "<Boundary>",
      after: "<Boundary mode={runtimeMode}>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not require a deployment role for an unrelated root provider", () => {
    prepareSnapshotPresentationRoot();
    writeSnapshotFile("package.json", JSON.stringify(SNAPSHOT_MANIFEST));
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not attest unrelated root provider versions", () => {
    prepareSnapshotPresentationRoot();
    replaceSnapshotSource({
      name: "unsupported SDK version",
      filename: "package.json",
      before: '"antd":"^3.26.0"',
      after: '"antd":"^4.0.0"',
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not attest unrelated root locale module provenance", () => {
    prepareSnapshotPresentationRoot();
    writeSnapshotFile("src/locale.js", 'export default { locale: "en-us" };');
    replaceSnapshotSource({
      name: "local locale lookalike",
      filename: "src/index.js",
      before: '"antd/lib/locale-provider/en_US"',
      after: '"./locale"',
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("uses authoritative host JSX pragma text when the on-disk leaf remains clean", () => {
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const diskSource = fs.readFileSync(filename, "utf8");
    const result = runRule(noArrayIndexAsKey, `/** @jsx customFactory */\n${diskSource}`, {
      filename,
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(fs.readFileSync(filename, "utf8")).toBe(diskSource);
  });

  it("certifies native and canonical host filenames without hiding authoritative pragmas", () => {
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const sourceText = fs.readFileSync(filename, "utf8");
    for (const hostFilename of [filename, normalizeFilename(filename)]) {
      const snapshotResult = runRule(noArrayIndexAsKey, sourceText, {
        filename: hostFilename,
        forceJsx: true,
      });
      expect(snapshotResult.parseErrors).toEqual([]);
      expect(snapshotResult.diagnostics).toEqual([]);
      const customPragmaResult = runRule(
        noArrayIndexAsKey,
        `/** @jsx customFactory */\n${sourceText}`,
        {
          filename: hostFilename,
          forceJsx: true,
        },
      );
      expect(customPragmaResult.parseErrors).toEqual([]);
      expect(customPragmaResult.diagnostics).toHaveLength(1);
    }
  });

  it("certifies the same complete topology in the actual engine", async () => {
    expect(await runNativeSnapshotLeaf()).toEqual([]);
  });

  it("keeps the native-engine warning for ambiguous supported source extensions", async () => {
    expect(await runNativeSnapshotLeaf(true)).toEqual([]);
    writeSnapshotFile("src/leaf.jsx", "export default () => null;");
    expect(runSnapshotLeaf()).toHaveLength(1);
    expect(await runNativeSnapshotLeaf(true)).toHaveLength(1);
  });

  it("keeps the warning for ambiguous supported source index extensions", () => {
    const requestSource = SNAPSHOT_FILES["src/request.js"];
    expect(requestSource).toBeDefined();
    fs.unlinkSync(path.join(temporaryDirectory, "src/request.js"));
    writeSnapshotFile("src/request/index.js", requestSource);
    writeSnapshotFile("src/request/index.jsx", "export const load = () => Promise.resolve({});");
    for (const sourceFilename of ["src/request/index.js", "src/request/index.jsx"]) {
      const sourcePath = path.join(temporaryDirectory, sourceFilename);
      expect(
        parseSourceText({
          filename: sourcePath,
          sourceText: fs.readFileSync(sourcePath, "utf8"),
          language: "jsx",
        }),
      ).not.toBeNull();
    }
    const filename = path.join(temporaryDirectory, "src/leaf.js");
    const result = runRule(noArrayIndexAsKey, fs.readFileSync(filename, "utf8"), {
      filename,
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(SNAPSHOT_PRESENTATION_PROJECTION_CASES)(
    "keeps the source fixed slot for $name",
    (mutation) => {
      replaceSnapshotSource(mutation);
      expect(runSnapshotLeaf()).toEqual([]);
    },
  );

  it.each(SNAPSHOT_REFUSALS)("keeps the warning for $name", (mutation) => {
    replaceSnapshotSource(mutation);
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects an executable native tag hidden behind a local JSX alias", () => {
    replaceSnapshotSource({
      name: "executable JSX tag alias",
      filename: "src/index.js",
      before: 'import React from "react";',
      after: 'import React from "react"; const Frame = "iframe";',
    });
    replaceSnapshotSource({
      name: "mounted executable JSX alias",
      filename: "src/index.js",
      before: "<Owner />",
      after: '<main><Frame src="/decoder.html" /><Owner /></main>',
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("refuses a runtime TypeScript module whose type namespace hides a global writer", () => {
    writeSnapshotFile("src/typed-writer.ts", "export type JSON = {}; JSON.parse = customDecoder;");
    replaceSnapshotSource({
      name: "runtime typed writer import",
      filename: "src/index.js",
      before: 'import React from "react";',
      after: 'import React from "react"; import "./typed-writer";',
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects an executable native tag hidden behind a relative imported alias", () => {
    writeSnapshotFile("src/frame.js", 'export default "iframe";');
    replaceSnapshotSource({
      name: "imported executable JSX alias",
      filename: "src/index.js",
      before: 'import React from "react";',
      after: 'import React from "react"; import Frame from "./frame";',
    });
    replaceSnapshotSource({
      name: "mounted relative executable JSX alias",
      filename: "src/index.js",
      before: "<Owner />",
      after: '<main><Frame src="/decoder.html" /><Owner /></main>',
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies a direct literal querySelector mount target", () => {
    replaceSnapshotSource({
      name: "literal native selector",
      filename: "src/index.js",
      before: 'document.getElementById("root")',
      after: 'document.querySelector("#root")',
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("does not interpret HTML ancestors outside source projection", () => {
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><button><div id="root"></div></button></body></html>',
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("certifies an inert CRA HTML template", () => {
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("keeps HTML script changes outside the source invariant", () => {
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><script>JSON.parse = customDecoder;</script><div id="root"></div></body></html>',
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("keeps prepared HTML outside source verdicts without a warm-cache claim", async () => {
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><div id="root"></div></body></html>',
    );
    expect(await runNativeSnapshotLeaf(true, true)).toEqual([]);
    expect(await runNativeSnapshotLeaf(true, true)).toEqual([]);
    writeSnapshotFile(
      "public/index.html",
      '<!doctype html><html><body><script>JSON.parse = customDecoder;</script><div id="root"></div></body></html>',
    );
    expect(await runNativeSnapshotLeaf(true, true)).toEqual([]);
  });

  it("certifies closed branch-selected transport defaults spread into the native JSON request", () => {
    replaceSnapshotSource({
      name: "closed transport branches",
      filename: "src/request.js",
      before: "export const load",
      after:
        'const production = true; const transport = production ? { baseURL: "/one", timeout: 5000 } : { baseURL: "/two", timeout: 5000 }; export const load',
    });
    replaceSnapshotSource({
      name: "closed transport spread",
      filename: "src/request.js",
      before: "axios({ url:",
      after: "axios({ ...transport, url:",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("rejects a decoder override in either closed transport branch", () => {
    replaceSnapshotSource({
      name: "unsafe transport branch",
      filename: "src/request.js",
      before: "export const load",
      after:
        'const production = false; const transport = production ? { baseURL: "/one", timeout: 5000 } : { baseURL: "/two", transformResponse: [customDecoder] }; export const load',
    });
    replaceSnapshotSource({
      name: "unsafe transport spread",
      filename: "src/request.js",
      before: "axios({ url:",
      after: "axios({ ...transport, url:",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects nested request headers shared through a published transport spread", () => {
    replaceSnapshotSource({
      name: "published transport box",
      filename: "src/request.js",
      before: "export const load",
      after:
        'const transport = { headers: { Accept: "application/json" } }; const requestBox = { ...transport }; publish(requestBox); export const load',
    });
    replaceSnapshotSource({
      name: "shared transport spread",
      filename: "src/request.js",
      before: "axios({ url:",
      after: "axios({ ...transport, url:",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a block-scoped declaration shadow that shares the exported provider name", () => {
    const nativeHelper = SNAPSHOT_FILES["src/request.js"]
      ?.replace('import axios from "axios";', "")
      .replace("export const load = () =>", "function load() { return");
    expect(nativeHelper).toBeDefined();
    writeSnapshotFile(
      "src/request.js",
      `import axios from "axios"; const load = () => opaqueProvider(); { ${nativeHelper} } } export { load };`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a nested helper shadow that shares the exported provider name", () => {
    const nativeHelper = SNAPSHOT_FILES["src/request.js"]
      ?.replace('import axios from "axios";', "")
      .replace("export const load", "const load");
    expect(nativeHelper).toBeDefined();
    writeSnapshotFile(
      "src/request.js",
      `import axios from "axios"; const load = () => opaqueProvider(); const hidden = () => { ${nativeHelper} }; export { load };`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a request header object published through a containing array before use", () => {
    replaceSnapshotSource({
      name: "published request header array",
      filename: "src/request.js",
      before: "export const load",
      after:
        "const headers = {}; const requestList = [headers]; publish(requestList); export const load",
    });
    replaceSnapshotSource({
      name: "array-escaped headers option",
      filename: "src/request.js",
      before: 'responseType: "json"',
      after: 'responseType: "json", headers',
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a request header object published through a containing record before use", () => {
    replaceSnapshotSource({
      name: "published request headers",
      filename: "src/request.js",
      before: "export const load",
      after:
        "const headers = {}; const requestBox = { headers }; publish(requestBox); export const load",
    });
    replaceSnapshotSource({
      name: "escaped headers option",
      filename: "src/request.js",
      before: 'responseType: "json"',
      after: 'responseType: "json", headers',
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies an explicitly overridden location prop with a selected nested snapshot branch", () => {
    replaceSnapshotSource({
      name: "nested selected branch",
      filename: "src/leaf.js",
      before: "props.paragraphs.map",
      after: "props.location.state.paragraphs.map",
    });
    replaceSnapshotSource({
      name: "explicit location",
      filename: "src/owner.js",
      before: "<Leaf {...routeProps} {...settings}",
      after: "<Leaf {...routeProps} location={settings}",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("certifies a genuine lodash nonempty JSX conjunction gate", () => {
    prepareSnapshotLodashGate("4.17.21");
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("certifies a genuine lodash nonempty gate in the actual engine", async () => {
    prepareSnapshotLodashGate("4.17.21");
    expect(await runNativeSnapshotLeaf()).toEqual([]);
  });

  it("requires metadata for an imported lodash emptiness gate", () => {
    prepareSnapshotLodashGate(null);
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects aliased metadata for an imported lodash emptiness gate", () => {
    prepareSnapshotLodashGate("npm:custom-empty@4.17.21");
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("accepts a scalar owner read disjoint from the selected target", () => {
    replaceSnapshotSource({
      name: "disjoint owner consumer",
      filename: "src/owner.js",
      before: "return <BrowserRouter>",
      after: "void settings.heading; return <BrowserRouter>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("accepts a nested scalar sibling read disjoint from the selected target", () => {
    replaceSnapshotSource({
      name: "nested target",
      filename: "src/leaf.js",
      before: "props.paragraphs.map",
      after: "props.content.paragraphs.map",
    });
    replaceSnapshotSource({
      name: "nested disjoint owner consumer",
      filename: "src/owner.js",
      before: "return <BrowserRouter>",
      after: "void settings.content.heading; return <BrowserRouter>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("rejects a nested prefix consumer containing the selected target", () => {
    replaceSnapshotSource({
      name: "nested target",
      filename: "src/leaf.js",
      before: "props.paragraphs.map",
      after: "props.content.paragraphs.map",
    });
    replaceSnapshotSource({
      name: "nested target-containing owner consumer",
      filename: "src/owner.js",
      before: "return <BrowserRouter>",
      after: "publish(settings.content); return <BrowserRouter>",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies a static native route-owner ancestor", () => {
    replaceSnapshotSource({
      name: "static native owner wrapper",
      filename: "src/owner.js",
      before:
        'return <BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter>;',
      after:
        'return <main><BrowserRouter><Route path="/" render={routeProps => <Leaf {...routeProps} {...settings} />} /></BrowserRouter></main>;',
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("certifies a static native root ancestor", () => {
    replaceSnapshotSource({
      name: "static native root wrapper",
      filename: "src/index.js",
      before: "<Owner />",
      after: "<main><Owner /></main>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("accepts unchanged disjoint sibling text reads", () => {
    replaceSnapshotSource({
      name: "sibling heading",
      filename: "src/leaf.js",
      before: "<section>",
      after: "<section><h2>{props.heading}</h2>",
    });
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("accepts production-inactive hot-reload syntax", () => {
    writeSnapshotFile(
      "src/index.js",
      `${SNAPSHOT_FILES["src/index.js"]}\nif (module.hot) { module.hot.accept(); }`,
    );
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("accepts a uniquely applicable stable Yarn resolution for a broad declaration", () => {
    broadenSnapshotReactDeclarations();
    writeSnapshotYarnLock();
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("requires the broad declaration to have applicable resolution evidence", () => {
    broadenSnapshotReactDeclarations();
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders lock changes without changing source or manifest", () => {
    broadenSnapshotReactDeclarations();
    writeSnapshotYarnLock();
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotYarnLock("16.7.0");
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a transitive-only selector with no declaration match", () => {
    broadenSnapshotReactDeclarations();
    writeSnapshotYarnLock();
    const lock = fs.readFileSync(path.join(temporaryDirectory, "yarn.lock"), "utf8");
    writeSnapshotFile("yarn.lock", lock.replaceAll("@^16.0.0", "@^16.8.0"));
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects an aliased lock tarball identity", () => {
    broadenSnapshotReactDeclarations();
    writeSnapshotYarnLock();
    const lock = fs.readFileSync(path.join(temporaryDirectory, "yarn.lock"), "utf8");
    writeSnapshotFile("yarn.lock", lock.replace("/react/-/react-", "/preact/-/preact-"));
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("keeps a disjoint rich-link sibling diagnostic", () => {
    replaceSnapshotSource({
      name: "rich sibling",
      filename: "src/leaf.js",
      before: "</section>",
      after:
        "{props.links.map((link, index) => <a key={index} href={link.href}>{link.title}</a>)}</section>",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("keeps a parsed actual-engine refusal for an unproved refresh runtime", async () => {
    replaceSnapshotSource(
      SNAPSHOT_REFUSALS.find(
        (mutation) => mutation.name === "an unproved react-refresh runtime import",
      )!,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
    expect(await runNativeSnapshotLeaf()).toHaveLength(1);
  });

  it("keeps a parsed actual-engine refusal for a late route spread", async () => {
    replaceSnapshotSource(
      SNAPSHOT_REFUSALS.find(
        (mutation) => mutation.name === "a route spread after snapshot props",
      )!,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
    expect(await runNativeSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects a same-file alternate caller of the exported leaf", () => {
    writeSnapshotFile(
      "src/leaf.js",
      `${SNAPSHOT_FILES["src/leaf.js"]}\nexport const Alternate = () => <Leaf paragraphs={mutableData} />;`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("certifies a module-bound named function expression leaf", () => {
    const leafSource = SNAPSHOT_FILES["src/leaf.js"]?.replace(
      "export default function Leaf(props)",
      "const Leaf = function NamedLeaf(props)",
    );
    expect(leafSource).toBeDefined();
    writeSnapshotFile("src/leaf.js", `${leafSource}; export default Leaf;`);
    expect(runSnapshotLeaf()).toEqual([]);
  });

  it("rejects a named function expression recursive leaf caller", () => {
    const leafSource = SNAPSHOT_FILES["src/leaf.js"]
      ?.replace("export default function Leaf(props)", "const Leaf = function NamedLeaf(props)")
      .replace("</section>", "<NamedLeaf paragraphs={mutableData} /></section>");
    expect(leafSource).toBeDefined();
    writeSnapshotFile("src/leaf.js", `${leafSource}; export default Leaf;`);
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects an unresolved recursive leaf caller", () => {
    replaceSnapshotSource({
      name: "recursive leaf caller",
      filename: "src/leaf.js",
      before: "</section>",
      after: "<Leaf paragraphs={mutableData} /></section>",
    });
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders an added target-containing importer without changing the leaf", () => {
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/other.js",
      'import React from "react"; import Leaf from "./leaf"; export const Other = props => <Leaf {...props} />;',
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders an added extensionless caller beside an explicit safe import", () => {
    replaceSnapshotSource({
      name: "explicit leaf path",
      filename: "src/owner.js",
      before: 'import Leaf from "./leaf";',
      after: 'import Leaf from "./leaf.js";',
    });
    writeSnapshotFile("src/leaf.jsx", "export const unrelated = true;");
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/other.js",
      'import React from "react"; import Leaf from "./leaf"; export const Other = runtimeConfig => <Leaf {...runtimeConfig} />;',
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders a newly added absolute leaf caller without changing the safe relative caller", () => {
    expect(runSnapshotLeaf()).toEqual([]);
    const leafPathLiteral = JSON.stringify(path.join(temporaryDirectory, "src/leaf.js"));
    writeSnapshotFile(
      "src/alternate.js",
      `import React from "react"; import Leaf from ${leafPathLiteral}; export const Alternate = () => <Leaf paragraphs={mutableData} />;`,
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("rejects an unresolved re-exporting consumer", () => {
    writeSnapshotFile("src/reexport.js", 'export { default as Reader } from "./leaf";');
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders a changed importer without changing the leaf", () => {
    writeSnapshotFile(
      "src/other.js",
      'import React from "react"; export const Other = () => <p>ready</p>;',
    );
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/other.js",
      'import React from "react"; import Leaf from "./leaf"; export const Other = props => <Leaf {...props} />;',
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders an added shared-client writer without changing provider or leaf", () => {
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/client-writer.js",
      'import axios from "axios"; axios.defaults.transformResponse = [customDecoder];',
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders a changed shared-client writer without changing provider or leaf", () => {
    writeSnapshotFile("src/client-writer.js", 'export const status = "ready";');
    expect(runSnapshotLeaf()).toEqual([]);
    writeSnapshotFile(
      "src/client-writer.js",
      'import axios from "axios"; axios.interceptors.response.use(customDecoder);',
    );
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("reconsiders a changed manifest without changing any source", () => {
    expect(runSnapshotLeaf()).toEqual([]);
    replaceSnapshotSource(SNAPSHOT_REFUSALS[0]!);
    expect(runSnapshotLeaf()).toHaveLength(1);
  });

  it("bypasses both lint cache layers after a shared-client writer", async () => {
    expect(await runNativeSnapshotLeaf(true)).toEqual([]);
    writeSnapshotFile(
      "src/client-writer.js",
      'import axios from "axios"; axios.defaults.adapter = customAdapter;',
    );
    expect(await runNativeSnapshotLeaf(true)).toHaveLength(1);
  });

  it("bypasses both lint cache layers after a manifest change", async () => {
    expect(await runNativeSnapshotLeaf(true)).toEqual([]);
    replaceSnapshotSource(SNAPSHOT_REFUSALS[0]!);
    expect(await runNativeSnapshotLeaf(true)).toHaveLength(1);
  });

  it("bypasses both lint cache layers after a lock change", async () => {
    broadenSnapshotReactDeclarations();
    writeSnapshotYarnLock();
    expect(await runNativeSnapshotLeaf(true)).toEqual([]);
    writeSnapshotYarnLock("16.7.0");
    expect(await runNativeSnapshotLeaf(true)).toHaveLength(1);
  });

  it("bypasses both lint cache layers after a new incoming consumer", async () => {
    writeSnapshotFile("src/cache-control.js", "export const stable = true;");
    const includePaths = ["src/leaf.js", "src/cache-control.js"];
    expect(await runNativeSnapshotLeaf(true, false, includePaths)).toEqual([]);
    expect(await runNativeSnapshotLeaf(true, false, includePaths)).toEqual([]);
    expect(lastNativeCacheHitCount).toBeGreaterThan(0);
    writeSnapshotFile(
      "src/other.js",
      'import React from "react"; import Leaf from "./leaf"; export const Other = props => <Leaf {...props} />;',
    );
    expect(await runNativeSnapshotLeaf(true, false, includePaths)).toHaveLength(1);
  });
});
