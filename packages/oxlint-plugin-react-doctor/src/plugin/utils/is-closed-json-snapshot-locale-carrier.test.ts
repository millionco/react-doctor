import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { getClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";
import { isClosedJsonSnapshotLocaleCarrier } from "./is-closed-json-snapshot-locale-carrier.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import { walkAst } from "./walk-ast.js";
import {
  CLOSED_JSON_SNAPSHOT_LOCALE_MAX_NODES,
  CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES,
} from "./closed-json-snapshot-locale/constants.js";

const directories: string[] = [];
const carrierSource = `
import { LocaleProvider as Carrier } from 'antd';
import locale from 'antd/lib/locale-provider/en_US';
export const Shell = () => <Carrier locale={locale}><div /></Carrier>;
`;
const createProject = (sourceText: string, otherFiles: Record<string, string> = {}): string => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-locale-")));
  directories.push(directory);
  fs.writeFileSync(path.join(directory, "shell.js"), sourceText);
  for (const [filename, content] of Object.entries(otherFiles))
    fs.writeFileSync(path.join(directory, filename), content);
  return directory;
};
const checkDirectory = (directory: string, hasAntdLocaleProvider = true): boolean => {
  const project = getClosedJsonSnapshotProject({
    rootDirectory: directory,
    allowJsxInJs: true,
    sourceResolutionPolicy: {
      rootDirectory: directory,
      extensions: [".js", ".jsx", ".ts", ".tsx"],
      aliases: [],
    },
  });
  if (!project) return false;
  const module = project.modules.get(normalizeFilename(path.join(directory, "shell.js")));
  let opening: EsTreeNodeOfType<"JSXOpeningElement"> | null = null;
  if (module)
    walkAst(module.program, (node) => {
      if (
        isNodeOfType(node, "JSXOpeningElement") &&
        isNodeOfType(node.name, "JSXIdentifier") &&
        node.name.name === "Carrier"
      )
        opening = node;
    });
  expect(opening).not.toBeNull();
  return Boolean(
    project &&
    module &&
    opening &&
    isClosedJsonSnapshotLocaleCarrier({ opening, module, project, hasAntdLocaleProvider }),
  );
};
const checkCarrier = (
  sourceText: string,
  otherFiles: Record<string, string> = {},
  hasAntdLocaleProvider = true,
): boolean => checkDirectory(createProject(sourceText, otherFiles), hasAntdLocaleProvider);

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("closed imported SDK locale carrier", () => {
  it("admits genuine named root export with one child and fixed locale", () => {
    expect(checkCarrier(carrierSource)).toBe(true);
  });
  it.each(["antd/lib/locale-provider", "antd/es/locale-provider"])(
    "admits default provider export %s",
    (source) => {
      expect(
        checkCarrier(
          carrierSource.replace(
            "import { LocaleProvider as Carrier } from 'antd';",
            `import Carrier from '${source}';`,
          ),
        ),
      ).toBe(true);
    },
  );
  it.each([
    "antd/lib/locale-provider/en_US",
    "antd/lib/locale-provider/zh_CN",
    "antd/es/locale-provider/en_US",
    "antd/es/locale-provider/zh_CN",
  ])("admits finite fixed locale source %s", (source) => {
    expect(checkCarrier(carrierSource.replace("antd/lib/locale-provider/en_US", source))).toBe(
      true,
    );
  });
  it("retains harmless CSS and unused named SDK component imports", () => {
    expect(
      checkCarrier(`import 'antd/dist/antd.css'; import {Button} from 'antd'; ${carrierSource}`),
    ).toBe(true);
  });
  it("retains a closed Carousel fallback beside a fixed locale carrier", () => {
    expect(
      checkCarrier(carrierSource, {
        "gallery.js": "import { Carousel } from 'antd'; export const Gallery = () => <Carousel />;",
      }),
    ).toBe(true);
    expect(
      checkCarrier(carrierSource, {
        "gallery.js": "import { Carousel } from 'antd'; configure(Carousel);",
      }),
    ).toBe(false);
  });

  it("requires genuine compatible metadata", () => {
    expect(checkCarrier(carrierSource, {}, false)).toBe(false);
  });
  it.each([
    "ref={capture}",
    "onClick={handle}",
    "snapshot={snapshot}",
    "{...options}",
    '_ANT_MARK__="custom"',
    "children={renderChild}",
  ])("rejects target capability and opaque attributes %s", (attribute) => {
    expect(
      checkCarrier(carrierSource.replace("locale={locale}", `locale={locale} ${attribute}`)),
    ).toBe(false);
  });
  it.each(["{}", "snapshot", "getLocale()", "locale.Table", "alias"])(
    "rejects nonfixed locale value %s",
    (value) => {
      expect(
        checkCarrier(
          `const alias = locale; ${carrierSource.replace("locale={locale}", `locale={${value}}`)}`,
        ),
      ).toBe(false);
    },
  );
  it.each(["{renderChild}", "{() => <div/>}", "<div/><div/>", "", "text"])(
    "rejects opaque, multiple or non-element children %s",
    (children) => {
      expect(checkCarrier(carrierSource.replace("<div />", children))).toBe(false);
    },
  );
  it.each([
    "Carrier.defaultProps = {};",
    "Carrier.prototype.render = customRender;",
    "mutate(Carrier);",
    "const alias = Carrier;",
    "Carrier({});",
    "export {Carrier};",
    'locale.Table.emptyText = "changed";',
    "mutate(locale);",
    "const alias = locale;",
    "export {locale};",
  ])("rejects SDK or locale mutation and escapes %s", (extra) => {
    expect(checkCarrier(`${carrierSource}\n${extra}`)).toBe(false);
  });
  it.each([
    "import * as sdk from 'antd'; sdk.LocaleProvider.defaultProps = {};",
    "import sdk from 'antd'; sdk.LocaleProvider = replacement;",
    "export {LocaleProvider} from 'antd';",
    "export * from 'antd';",
    "import locale from 'antd/es/locale-provider/en_US'; locale.Table = {};",
    "import Provider from 'antd/lib/locale-provider'; export {Provider};",
    "import locale from 'antd/lib/locale/en_US'; mutate(locale);",
    "import sdk from 'antd/lib/index'; mutate(sdk);",
    "import('antd').then(mutate);",
    "const sdk = require('antd'); mutate(sdk);",
    "const loader = require; loader('antd').LocaleProvider.defaultProps = {};",
    "const loader = module.require; loader('antd').LocaleProvider.defaultProps = {};",
    "import {ConfigProvider} from 'antd'; const value = new ConfigProvider({}); mutate(value.render().type);",
  ])("rejects current incoming SDK importers and writers", (source) => {
    expect(checkCarrier(carrierSource, { "writer.js": source })).toBe(false);
  });
  it("declines TypeScript SDK import-equals namespace access", () => {
    expect(
      checkCarrier(carrierSource, { "writer.ts": "import SDK = require('antd'); mutate(SDK);" }),
    ).toBe(false);
  });
  it("does not accept a shadowed locale data spelling", () => {
    expect(
      checkCarrier(
        carrierSource.replace("export const Shell = () =>", "export const Shell = locale =>"),
      ),
    ).toBe(false);
  });
  it("permits other closed SDK carriers in the project", () => {
    expect(checkCarrier(carrierSource, { "other.js": carrierSource })).toBe(true);
  });
  it("uses binding identity rather than a shadowed component spelling", () => {
    expect(
      checkCarrier(
        carrierSource.replace("export const Shell = () =>", "export const Shell = Carrier =>"),
      ),
    ).toBe(false);
  });
  it.each([
    "module.hot",
    "process.env.NODE_ENV !== 'production'",
    "process.env.NODE_ENV === 'development'",
  ])(
    "retains possible source loader and SDK writes in deployment-dependent branch %s",
    (condition) => {
      expect(
        checkCarrier(
          `${carrierSource} if (${condition}) { require('./entry'); Carrier.defaultProps = {}; mutate(locale); }`,
        ),
      ).toBe(false);
    },
  );
  it("ignores loader and SDK writes in a literal inactive branch", () => {
    expect(
      checkCarrier(`${carrierSource} if (false) { Carrier.defaultProps = {}; mutate(locale); }`),
    ).toBe(true);
  });
  it.each(["ready", "!module.hot", "process.env.NODE_ENV === 'production'"])(
    "keeps unknown or active loader branches closed %s",
    (condition) => {
      expect(
        checkCarrier(
          `${carrierSource} if (${condition}) { require('./entry'); Carrier.defaultProps = {}; }`,
        ),
      ).toBe(false);
    },
  );
  it("does not treat a shadowed module hot property as production inactive", () => {
    expect(
      checkCarrier(
        `${carrierSource} const replay = module => { if (module.hot) mutate(Carrier); };`,
      ),
    ).toBe(false);
  });
  it("audits lexical binding ambiguity before skipping a dead block", () => {
    expect(
      checkCarrier(`${carrierSource} if (false) { function JSON() {} } JSON.parse = decode;`),
    ).toBe(false);
  });
  it("keeps static SDK imports live even when their uses occur only in dead code", () => {
    expect(
      checkCarrier(`${carrierSource} import * as sdk from 'antd'; if (module.hot) mutate(sdk);`),
    ).toBe(false);
  });
  it("admits resolved standalone local side-effect require with source closure", () => {
    const source = `${carrierSource} require('./writer');`;
    expect(checkCarrier(source, { "writer.js": "export const harmless = true;" })).toBe(true);
    expect(
      checkCarrier(
        source,
        { "writer.js": "import {LocaleProvider} from 'antd'; mutate(LocaleProvider);" },
        true,
      ),
    ).toBe(false);
  });
  it.each([
    "const namespace = require('./writer');",
    "require('antd');",
    "require(packageName);",
    "require('./missing');",
    "const loader = require; loader('./writer');",
  ])("rejects unclosed module loader capability %s", (loader) => {
    expect(
      checkCarrier(
        `${carrierSource} ${loader}`,
        { "writer.js": "export const harmless = true;" },
        true,
      ),
    ).toBe(false);
  });
  it("declines exhausted SDK reference closure instead of accepting a prefix", () => {
    const source = carrierSource.replace(
      "<Carrier locale={locale}><div /></Carrier>",
      `<>${"<Carrier locale={locale}><div /></Carrier>".repeat(CLOSED_JSON_SNAPSHOT_LOCALE_MAX_REFERENCES + 1)}</>`,
    );
    expect(checkCarrier(source)).toBe(false);
  });
  it("declines exhausted project syntax traversal", () => {
    expect(
      checkCarrier(carrierSource, {
        "large.js": "0;".repeat(CLOSED_JSON_SNAPSHOT_LOCALE_MAX_NODES),
      }),
    ).toBe(false);
  });
  it("reads newly added and changed incoming SDK writers without resetting caches", () => {
    const directory = createProject(carrierSource);
    expect(checkDirectory(directory)).toBe(true);
    const writerPath = path.join(directory, "writer.js");
    fs.writeFileSync(
      writerPath,
      "import {LocaleProvider} from 'antd'; LocaleProvider.defaultProps = {};",
    );
    expect(checkDirectory(directory)).toBe(false);
    fs.writeFileSync(writerPath, "export const independent = true;");
    expect(checkDirectory(directory)).toBe(true);
  });
});
