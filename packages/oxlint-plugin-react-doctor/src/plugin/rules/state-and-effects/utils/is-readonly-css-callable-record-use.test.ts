import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../../utils/rule.js";
import { runRule } from "../../../../test-utils/run-rule.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resetFilesystemCaches } from "../../../utils/reset-filesystem-caches.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isReadonlyCssCallableRecordUse } from "./is-readonly-css-callable-record-use.js";

interface CssRecordFixture {
  readonly name: string;
  readonly entry: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expected: number;
}

const roots: string[] = [];
const probeRule: Rule = {
  id: "readonly-css-callable-record-probe",
  severity: "warn",
  create: (context) => ({
    Program: (program) => {
      if (!isNodeOfType(program, "Program")) return;
      const filename = context.filename;
      if (!filename) return;
      const index = buildSourceProjectIndex({
        rootDirectory: path.dirname(filename),
        currentFilePath: filename,
        currentProgramNode: program,
        currentScopes: context.scopes,
        includeApplicationDirectories: true,
      });
      const module = index?.modulesByFilePath.get(filename);
      if (!index || !module) return;
      walkAst(program, (node) => {
        if (
          !isNodeOfType(node, "VariableDeclarator") ||
          !isNodeOfType(node.id, "Identifier") ||
          node.id.name !== "selectedCss" ||
          !node.init
        )
          return;
        if (isReadonlyCssCallableRecordUse({ lookup: node.init, module, index }))
          context.report({ node: node.init, message: "Readonly CSS callable record" });
      });
    },
  }),
};

const cases: ReadonlyArray<CssRecordFixture> = [
  {
    name: "fresh reduced CSS record with tag alias",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "fresh reduced CSS record direct tag",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const other = makeRules(screens)[otherKey]`height: 4px;`; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "fresh literal style record zero argument call",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } }) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: () => `display: block;` });\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss();\n",
    files: {},
    expected: 1,
  },
  {
    name: "fresh literal record readonly result alias",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } }) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: () => `display: block;` });\nconst record = makeRules(screens); const selectedCss = record[key]; const output = selectedCss();\n",
    files: {},
    expected: 1,
  },
  {
    name: "own readonly CSS function record",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 1,
  },
  {
    name: "own readonly style record value alias",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const alias = selectedCss; const output = alias({ theme });\n',
    files: {},
    expected: 1,
  },
  {
    name: "plain own CSS call data",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme, error: false, count: 2 });\n',
    files: {},
    expected: 1,
  },
  {
    name: "relative named barrel resolves real factory",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
    },
    expected: 1,
  },
  {
    name: "relative named style function record",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { baseStyle } from "./styles"; const rules = { plain: baseStyle }; const selectedCss = rules[skin]; const output = selectedCss({ theme });',
    files: {
      "styles.js":
        'import { css } from "styled-components";\nexport const baseStyle = ({ theme }) => css`color: ${theme.foreground};`;',
    },
    expected: 1,
  },
  {
    name: "factory replacement refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\nmakeRules = foreign;',
    files: {},
    expected: 0,
  },
  {
    name: "factory method mutation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\nmakeRules.extra = foreign;',
    files: {},
    expected: 0,
  },
  {
    name: "fresh record mutation refuses",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } }) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: () => `display: block;` });\nconst record = makeRules(screens); record.compact = foreign; const selectedCss = record[key]; const output = selectedCss();\n",
    files: {},
    expected: 0,
  },
  {
    name: "record function mutation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nbaseStyle.extra = foreign;',
    files: {},
    expected: 0,
  },
  {
    name: "record property mutation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nrules.plain = foreign;',
    files: {},
    expected: 0,
  },
  {
    name: "record getter refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { get plain() { return baseStyle; }, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "record spread refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { ...foreign, plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "record prototype property refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { __proto__: foreign, plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "function-producing record value refuses",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } }) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: () => () => foreign() });\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss();\n",
    files: {},
    expected: 0,
  },
  {
    name: "foreign executable record value refuses",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } }) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: foreign });\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss();\n",
    files: {},
    expected: 0,
  },
  {
    name: "noncanonical CSS tag refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "foreign-style";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "CSS provider alias escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nconsume(css);',
    files: {},
    expected: 0,
  },
  {
    name: "lookup callable return escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nconst read = () => selectedCss;',
    files: {},
    expected: 0,
  },
  {
    name: "lookup callable argument escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nconsume(selectedCss);',
    files: {},
    expected: 0,
  },
  {
    name: "lookup callable member transport refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\nselectedCss.call(null, { theme });',
    files: {},
    expected: 0,
  },
  {
    name: "one opaque argument refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss(theme);\n',
    files: {},
    expected: 0,
  },
  {
    name: "two style arguments refuse",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme }, foreign);\n',
    files: {},
    expected: 0,
  },
  {
    name: "callable own object argument refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme, callback: () => foreign() });\n',
    files: {},
    expected: 0,
  },
  {
    name: "optional style invocation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss?.({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "function body effect statement refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { foreign(); const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "fresh factory alias escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\nconsume(makeRules);',
    files: {},
    expected: 0,
  },
  {
    name: "reducer accumulator escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; consume(record); return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "reducer CSS rest escape refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${foreign(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "protected record key refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { constructor: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "native literal method constructor is not CSS record",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst selectedCss = ([].map)[opaqueKey]; const output = selectedCss({ theme });",
    files: {},
    expected: 0,
  },
  {
    name: "inline callable tag interpolation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${() => foreign()};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "own callable tag interpolation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst callback = () => foreign();\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${callback};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "native callable tag interpolation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst callback = [].map;\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${callback};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "namespace callable tag interpolation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${Math.abs};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "known concatenated reserved lookup key refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst key = "con" + "structor";\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "known literal reserved lookup key refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)["__defineGetter__"]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "plain own data call avoids callable record prototype names",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme, prototype: prototypeValue }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme, prototype: prototypeValue }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme, prototype: 1 });\n',
    files: {},
    expected: 0,
  },
  {
    name: "own string producing interpolation is CSS data",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst getWidth = () => "5px";\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${getWidth()};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "style parameter initializer refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme = foreign() }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "factory parameter initializer refuses",
    entry:
      "const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst makeRules = ({ compact: { width } } = foreign()) => ({ compact: () => `@media (max-width: ${width}px) { display: none; }`, wide: () => `display: block;` });\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss();\n",
    files: {},
    expected: 0,
  },
  {
    name: "returned CSS template callable interpolation refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${() => foreign()};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "own readonly callback alias in style call data refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst ownCallback = () => foreign();\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme, callback: ownCallback });\n',
    files: {},
    expected: 0,
  },
  {
    name: "returned CSS array carries visible callable interpolation",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${[() => foreign()]};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "nested own style data carries readonly callable alias",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst ownCallback = () => foreign();\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${foreground};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme: { callback: ownCallback } });\n',
    files: {},
    expected: 0,
  },
  {
    name: "mutable visible callback binding refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nlet callback = () => foreign(); if (flag) callback = () => foreign2();\nimport { css } from "styled-components";\nconst baseStyle = ({ theme }) => { const foreground = theme.foreground; return css`color: ${callback};`; };\nconst rules = { plain: baseStyle, quiet: ({ theme }) => css`color: ${theme.muted};` };\nconst selectedCss = rules[skin]; const output = selectedCss({ theme });\n',
    files: {},
    expected: 0,
  },
  {
    name: "readonly bound scalar interpolation remains data",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nconst width = 12;\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "unbound same-name caller data retains strict completeness refusal",
    entry:
      'import { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${width};`;\n',
    files: {},
    expected: 0,
  },
  {
    name: "owned theme string callback is closed CSS interpolation",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${({ theme: { baseSize } }) => `${baseSize}px`};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "readonly owned style callback alias is closed CSS interpolation",
    entry:
      'const fontStyle = ({ theme: { baseSize } }) => `${baseSize}px`;\nconst screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { css } from "styled-components";\nconst makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\nconst selectedCss = makeRules(screens)[key]; const output = selectedCss`width: ${fontStyle};`;\n',
    files: {},
    expected: 1,
  },
  {
    name: "sibling fresh factory result admits owned CSS callback",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
      "side.tsx":
        'import { makeRules } from "./barrel"; const rules = makeRules({ compact: { width: 600 }, wide: { width: 900 } }); const responsive = rules.wide; const output = responsive`font-size: ${({ theme: { baseSize } }) => `${baseSize}px`};`;',
    },
    expected: 1,
  },
  {
    name: "sibling factory callback with opaque effect call refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
      "side.tsx":
        'import { makeRules } from "./barrel"; const rules = makeRules({ compact: { width: 600 }, wide: { width: 900 } }); const responsive = rules.wide; const output = responsive`font-size: ${() => foreign()};`;',
    },
    expected: 0,
  },
  {
    name: "sibling factory callback producing function refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
      "side.tsx":
        'import { makeRules } from "./barrel"; const rules = makeRules({ compact: { width: 600 }, wide: { width: 900 } }); const responsive = rules.wide; const output = responsive`font-size: ${() => () => foreign()};`;',
    },
    expected: 0,
  },
  {
    name: "sibling factory imported callback refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
      "side.tsx":
        'import outsideCallback from "foreign-callback";\nimport { makeRules } from "./barrel"; const rules = makeRules({ compact: { width: 600 }, wide: { width: 900 } }); const responsive = rules.wide; const output = responsive`font-size: ${outsideCallback};`;',
    },
    expected: 0,
  },
  {
    name: "sibling factory native method callback refuses",
    entry:
      'const screens = { compact: { width: 600 }, wide: { width: 900 } };\nimport { makeRules } from "./barrel"; const selectedCss = makeRules(screens)[key]; const output = selectedCss`width: 4px;`;',
    files: {
      "barrel.js": 'export { makeRules } from "./factory";',
      "factory.js":
        'import { css } from "styled-components";\nexport const makeRules = (screens) => Object.keys(screens).reduce((record, name) => { record[name] = (...parts) => css`@media (min-width: ${screens[name].width || 0}px) { ${css(...parts)} }`; return record; }, {});\n',
      "side.tsx":
        'import { makeRules } from "./barrel"; const rules = makeRules({ compact: { width: 600 }, wide: { width: 900 } }); const responsive = rules.wide; const output = responsive`font-size: ${[].map};`;',
    },
    expected: 0,
  },
];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("isReadonlyCssCallableRecordUse", () => {
  it.each(cases)("$name", (fixture) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "readonly-css-record-"));
    roots.push(root);
    const filename = path.join(root, "entry.tsx");
    for (const [relativePath, body] of Object.entries({
      "package.json": JSON.stringify({
        dependencies: { react: "^18.2.0", "styled-components": "5.3.11" },
      }),
      ...fixture.files,
      "entry.tsx": fixture.entry,
    })) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body);
    }
    resetFilesystemCaches();
    const result = runRule(probeRule, fixture.entry, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(fixture.expected);
  });
});
