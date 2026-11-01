import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { walkAst } from "./walk-ast.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { normalizeFilename } from "./normalize-filename.js";
import type { ClosedJsonSnapshotModule } from "./get-closed-json-snapshot-project.js";
import { getClosedJsonSnapshotProject } from "./get-closed-json-snapshot-project.js";
import { isClosedJsonSnapshotProvider } from "./is-closed-json-snapshot-provider.js";
import {
  CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH,
  CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT,
} from "./closed-json-snapshot/constants.js";

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
  invocationSource?: string,
  simulateRegExpNull = false,
  allowsAxiosDefaultResponseSnapshot = false,
  mutateScope?: (module: ClosedJsonSnapshotModule, helperFunction: EsTreeNode) => void,
): boolean => {
  const rootDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "json-provider-")));
  directories.push(rootDirectory);
  const filename = path.join(rootDirectory, "provider.js");
  fs.writeFileSync(filename, sourceText);
  if (invocationSource !== undefined)
    fs.writeFileSync(path.join(rootDirectory, "consumer.js"), invocationSource);
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
  if (simulateRegExpNull) expect(project).toBeDefined();
  if (!project) return false;
  if (simulateRegExpNull) {
    let didFindRegExp = false;
    for (const currentModule of project.modules.values())
      walkAst(currentModule.program, (node) => {
        if (node.type === "Literal" && "regex" in node) {
          node.value = null;
          didFindRegExp = true;
        }
      });
    expect(didFindRegExp).toBe(true);
  }
  expect(helperFunction).toBeDefined();
  if (mutateScope && module && helperFunction) mutateScope(module, helperFunction);
  const consumer = project.modules.get(normalizeFilename(path.join(rootDirectory, "consumer.js")));
  let invocationCall: EsTreeNode | undefined;
  if (consumer)
    walkAst(consumer.program, (node) => {
      if (
        node.type === "CallExpression" &&
        node.callee.type === "Identifier" &&
        node.callee.name === "load"
      )
        invocationCall = node;
    });
  return Boolean(
    project &&
    module &&
    helperFunction &&
    isClosedJsonSnapshotProvider({
      project,
      module,
      helperFunction,
      decoderRole: "browser-native-json",
      allowsAxiosDefaultResponseSnapshot,
      invocation:
        consumer && invocationCall ? { module: consumer, call: invocationCall } : undefined,
    }),
  );
};

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("isClosedJsonSnapshotProvider", () => {
  it.each([
    [
      "let timeout = 100;",
      "let requestOptions = { timeout, responseType: 'json' };",
      "axios(requestOptions)",
    ],
    [
      "let baseOptions = { responseType: 'json' };",
      "const requestOptions = { ...baseOptions };",
      "axios(requestOptions)",
    ],
    [
      "const baseOptions = { responseType: 'json' };",
      "let requestOptions = { ...baseOptions };",
      "axios.request(requestOptions)",
    ],
    [
      "let count = 100; let timeout = +count;",
      "let requestOptions = { timeout, responseType: 'json' };",
      "axios(requestOptions)",
    ],
    [
      "",
      "let unused = '/catalog'; let requestOptions = { responseType: 'json' };",
      "axios.get('/catalog', requestOptions)",
    ],
    [
      "let choose = true;",
      "let requestOptions = { responseType: 'json' };",
      "axios(choose ? requestOptions : { responseType: 'json' })",
    ],
  ])(
    "certifies only ordered local inert let declarations: %s / %s",
    (helperPrelude, executorPrelude, request) => {
      for (const kind of ["let", "const"]) {
        const source = `import axios from 'axios'; export const load = () => {
        ${helperPrelude.replaceAll("let ", `${kind} `)}
        return new Promise((resolve, reject) => {
          ${executorPrelude.replaceAll("let ", `${kind} `)}
          const onFailure = error => reject(error);
          ${request}.then(response => resolve(response.data)).catch(onFailure);
        });
      };`;
        expect(checkProvider(source)).toBe(true);
      }
    },
  );

  it("certifies unused inert let cells while refusing special literal syntax", () => {
    const source = `import axios from 'axios'; export const load = () => {
      let unused = null;
      return new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });
    };`;
    expect(checkProvider(source)).toBe(true);
    expect(checkProvider(source.replace("null", "/(?i:a)/"), {}, [], undefined, true)).toBe(false);
    expect(checkProvider(source.replace("null", "1n"))).toBe(false);
    expect(
      checkProvider(
        source
          .replace("let unused = null;", "let unused = outside;")
          .replace("export const load", "const outside = null; export const load"),
      ),
    ).toBe(false);
  });

  it("keeps exact private caller provenance and default response roles with let records", () => {
    const source = `import axios from 'axios'; export const load = options => {
      let timeout = options.timeout;
      let requestOptions = { ...options, timeout };
      return new Promise((resolve, reject) => {
        let unused = null;
        axios(requestOptions).then(response => { if (response.status === 200) resolve(response.data); else reject(); }).catch(reject);
      });
    };`;
    const caller =
      "import { load } from './provider'; load({ timeout: 100, responseType: 'text' });";
    expect(checkProvider(source, {}, [], caller, false, true)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], caller, false, true)).toBe(false);
    expect(checkProvider(source, {}, [], caller)).toBe(false);
    expect(
      checkProvider(source, {}, [], caller.replace("'text'", "'arraybuffer'"), false, true),
    ).toBe(false);
  });

  it.each([
    "var requestOptions = { responseType: 'json' };",
    "let requestOptions;",
    "let requestOptions = { responseType: 'json' }, other = null;",
    "let requestOptions = unknown;",
    "let requestOptions = makeOptions();",
    "let requestOptions = { get responseType() { return 'json'; } };",
    "let requestOptions = true ? { responseType: 'json' } : { responseType: 'json' };",
    "let requestOptions = { ...later }; let later = { responseType: 'json' };",
    "let count = +count; let requestOptions = { responseType: 'json' };",
    "let baseOptions = { responseType: 'json' }; let requestOptions = baseOptions;",
    "let mode = 'json'; let requestOptions = { responseType: mode };",
    "let requestOptions = { responseType: 'json' }; const alias = requestOptions;",
    "let requestOptions = { responseType: 'json' }; const capture = () => requestOptions;",
    "let requestOptions = { responseType: 'json' }; requestOptions.responseType = 'text';",
    "let requestOptions = { responseType: 'json' }; delete requestOptions.responseType;",
    "let requestOptions = { responseType: 'json' }; Object.defineProperty(requestOptions, 'responseType', { value: 'json' });",
    "let requestOptions = { responseType: 'json' }; observe(requestOptions);",
    "let requestOptions = { responseType: 'json' }; requestOptions = { responseType: 'json' };",
    "if (true) { let requestOptions = { responseType: 'json' }; }",
    "let requestOptions = { responseType: 'json' }; const unused = eval('other');",
  ])("refuses let forms outside exact initialization and read closure: %s", (prelude) => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${prelude} axios(requestOptions).then(response => resolve(response.data)).catch(reject);
    });`;
    expect(checkProvider(source)).toBe(false);
  });

  it("does not make let capabilities available to module bindings, other client calls or defaults", () => {
    const source = `import axios from 'axios'; export const load = () => {
      let requestOptions = { responseType: 'json' };
      return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`;
    expect(checkProvider(source)).toBe(true);
    for (const kind of ["const", "let"]) {
      const other = `import axios from 'axios'; ${kind} requestOptions = { responseType: 'json' }; axios(requestOptions);`;
      expect(checkProvider(source, { "other.js": other })).toBe(kind === "const");
      const defaults = `import axios from 'axios'; ${kind} timeout = 100; axios.defaults.timeout = timeout;`;
      expect(checkProvider(source, { "other.js": defaults })).toBe(false);
    }
    expect(
      checkProvider(source, {
        "other.js": "import axios from 'axios'; axios.defaults.timeout = 100;",
      }),
    ).toBe(true);
    expect(
      checkProvider(
        "import axios from 'axios'; let requestOptions = { responseType: 'json' }; export const load = () => new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });",
      ),
    ).toBe(false);
    expect(
      checkProvider(
        source
          .replace(
            "let requestOptions = { responseType: 'json' };",
            "let url = '/catalog'; let requestOptions = { responseType: 'json' };",
          )
          .replace("axios(requestOptions)", "axios.get(url, requestOptions)"),
      ),
    ).toBe(false);
  });

  it.each(["duplicate", "wrong-index", "missing-list"])(
    "requires authoritative unique let scope evidence: %s",
    (mutation) => {
      const source = `import axios from 'axios'; export const load = () => {
      let requestOptions = { responseType: 'json' };
      return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`;
      expect(checkProvider(source)).toBe(true);
      expect(
        checkProvider(source, {}, [], undefined, false, false, (module, helperFunction) => {
          const scope = module.scopes.ownScopeFor(helperFunction);
          const symbol = scope?.symbols.find((candidate) => candidate.name === "requestOptions");
          expect(scope).toBeDefined();
          expect(symbol).toBeDefined();
          if (!scope || !symbol) return;
          if (mutation === "duplicate") scope.symbols.push({ ...symbol, kind: "parameter" });
          if (mutation === "wrong-index")
            scope.symbolsByName.set(symbol.name, { ...symbol, kind: "parameter" });
          if (mutation === "missing-list") scope.symbols.splice(scope.symbols.indexOf(symbol), 1);
        }),
      ).toBe(false);
    },
  );

  it("holds non-simple containing parameters and leaves let catch functions unsupported", () => {
    for (const parameter of ["unused = null", "...unused", "{} = {}"]) {
      const source = `import axios from 'axios'; export const load = (${parameter}) => {
        const requestOptions = { responseType: 'json' };
        return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); });
      };`;
      expect(checkProvider(source)).toBe(true);
      expect(checkProvider(source.replace("const requestOptions", "let requestOptions"))).toBe(
        false,
      );
    }
    const callback = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      let onFailure = error => reject(error);
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    expect(checkProvider(callback)).toBe(false);
    expect(checkProvider(callback.replace("let onFailure", "const onFailure"))).toBe(true);
  });

  it("counts let declarations and the const forwarding handler in the existing combined cap", () => {
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
    expect(checkProvider(source)).toBe(true);
    expect(
      checkProvider(source.replace("const onFailure", "let extra = null; const onFailure")),
    ).toBe(false);
  });

  it.each([
    "error => reject(error)",
    "error => { reject(error); }",
    "error => { return reject(error); }",
    "response => reject(response)",
    "resolve => reject(resolve)",
  ])("certifies an exact executor-local const rejection callback: %s", (handler) => {
    for (const success of [
      "response => resolve(response.data)",
      "response => { if (200 === response.status) resolve(response.data); else reject(response.status); }",
    ]) {
      const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        const onFailure = ${handler};
        axios({ responseType: 'json' }).then(${success}).catch(onFailure);
      });`;
      expect(checkProvider(source)).toBe(true);
      expect(checkProvider(source, {}, ["./provider.js"])).toBe(true);
    }
  });

  it("retains renamed native roles, inert prefixes and private arguments with local forwarding", () => {
    const source = `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options, responseType: 'json' };
      return new Promise((complete, fail) => {
        const onProblem = reason => { return fail(reason); };
        const unused = null;
        axios(requestOptions).then(reply => complete(reply.data)).catch(onProblem);
      });
    };`;
    const caller = "import { load } from './provider'; load({ url: '/catalog' });";
    expect(checkProvider(source, {}, [], caller)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], caller)).toBe(false);
    expect(checkProvider(source)).toBe(false);
  });

  it.each(["{}", "{ responseType: 'text' }", "{ responseType: 'json' }"])(
    "preserves exact default-response capability with local forwarding: %s",
    (options) => {
      const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        const onFailure = error => reject(error);
        axios(${options}).then(response => resolve(response.data)).catch(onFailure);
      });`;
      expect(checkProvider(source, {}, [], undefined, false, true)).toBe(true);
      expect(checkProvider(source)).toBe(options.includes("'json'"));
      expect(
        checkProvider(
          source.replace(options, "{ responseType: 'arraybuffer' }"),
          {},
          [],
          undefined,
          false,
          true,
        ),
      ).toBe(false);
    },
  );

  it.each([
    "error => reject(other)",
    "error => other(error)",
    "reject => reject(reject)",
    "error => resolve(error)",
    "error => reject()",
    "error => reject(error, other)",
    "error => reject(...[error])",
    "error => reject(error.message)",
    "error => reject?.(error)",
    "error => reject.call(null, error)",
    "async error => reject(error)",
    "function(error) { reject(error); }",
    "(error, extra) => reject(error)",
    "(error = other) => reject(error)",
    "(...errors) => reject(errors)",
    "({ error }) => reject(error)",
    "error => { const reason = error; reject(reason); }",
    "error => { console.log(error); reject(error); }",
    "error => { reject(error); console.log(error); }",
    "error => { reject(error); throw error; }",
    "error => { if (error) reject(error); }",
    "error => { ; reject(error); }",
    "error => { 'use strict'; reject(error); }",
    "error => { reject(error); return; }",
    "error => (reject(error), error)",
    "error => { error = other; reject(error); }",
    "error => onFailure(error)",
    "true ? (error => reject(error)) : (error => reject(error))",
    "makeForwarder(reject)",
    "anotherHandler",
  ])("refuses executor-local callbacks outside exact forwarding: %s", (handler) => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      const onFailure = ${handler};
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "const onFailure = error => reject(error), unused = null;",
    "let onFailure = error => reject(error);",
    "var onFailure = error => reject(error);",
    "function onFailure(error) { reject(error); }",
    "{ const onFailure = error => reject(error); }",
    "const onFailure = error => reject(error); const alias = onFailure;",
    "const onFailure = error => reject(error); const unused = reject;",
    "const onFailure = error => reject(error); const unused = error => reject(error);",
    "const onFailure = error => reject(error); const unused = () => null;",
    "const onFailure = error => reject(error); onFailure = other;",
    "const onFailure = error => reject(error); onFailure(other);",
    "const onFailure = error => reject(error); observe(onFailure);",
    "const onFailure = error => reject(error); onFailure.extra = other;",
  ])("keeps local declaration ownership and exact helper/native references: %s", (declarations) => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${declarations}
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "import axios from 'axios'; const onFailure = error => reject(error); export const load = () => new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); });",
    "import axios from 'axios'; export const load = () => { const onFailure = error => reject(error); return new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); }); };",
    "import axios from 'axios'; export const load = () => new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); const onFailure = error => reject(error); });",
    "import axios from 'axios'; export const load = () => new Promise((resolve, reject) => { const onFailure = error => reject(error); axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure).catch(onFailure); });",
    "import axios from 'axios'; const onFailure = error => other(error); export const load = () => new Promise((resolve, reject) => { const unused = new Promise((done, fail) => { const onFailure = error => fail(error); }); axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure); });",
  ])("refuses outer, late, sibling-executor and multiply consumed handlers", (source) => {
    expect(checkProvider(source)).toBe(false);
  });

  it("counts the selected forwarding declaration in the existing combined prelude cap", () => {
    const inert = Array.from(
      { length: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT - 1 },
      (_, index) => `const unused${index} = null;`,
    ).join(" ");
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${inert} const onFailure = error => reject(error);
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    expect(checkProvider(source)).toBe(true);
    expect(
      checkProvider(source.replace("const onFailure", "const extra = null; const onFailure")),
    ).toBe(false);
  });

  it.each([
    "axios.interceptors.response.use(decode);",
    "axios.defaults.transformResponse = decode;",
    "JSON.parse = decode;",
    "const Promise = FakePromise;",
    "XMLHttpRequest = ForeignRequest;",
  ])("retains source/native/client closure with an executor-local handler: %s", (prefix) => {
    const source = `import axios from 'axios'; ${prefix} export const load = () => new Promise((resolve, reject) => {
      const onFailure = error => reject(error);
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(onFailure);
    });`;
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "axios({})",
    "axios({ responseType: 'text' })",
    "axios.request({ url: '/catalog' })",
    "axios.get('/catalog', {})",
    "axios({ ...{ responseType: 'arraybuffer' }, responseType: 'text' })",
    "axios({ responseType: 'text', ...{ responseType: 'json' } })",
    "axios(process.env.NODE_ENV === 'production' ? {} : { responseType: 'text' })",
  ])("uses the exact capability only for the target final request records: %s", (request) => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(error => reject(error));
    });`;
    expect(checkProvider(source, {}, [], undefined, false, true)).toBe(true);
    if (!request.includes("...{ responseType: 'json' }")) expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "axios()",
    "axios.get('/catalog')",
    "axios({}, {})",
    "axios.request()",
    "axios({ responseType: null })",
    "axios({ responseType: undefined })",
    "axios({ responseType: false })",
    "axios({ responseType: '' })",
    "axios({ responseType: 'arraybuffer' })",
    "axios({ responseType: 'blob' })",
    "axios({ responseType: 'document' })",
    "axios({ responseType: 'stream' })",
    "axios({ responseType: 'text', ...{ responseType: 'arraybuffer' } })",
    "axios(process.env.NODE_ENV === 'production' ? {} : { responseType: 'arraybuffer' })",
    "axios({ get responseType() { return 'text'; } })",
    "axios({ responseType: 'text', transformResponse: [JSON.parse] })",
    "axios({ adapter: customAdapter })",
    "axios({ responseEncoding: 'utf8' })",
  ])(
    "refuses modes and call shapes outside the exact default-response capability: %s",
    (request) => {
      const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(reject);
    });`;
      expect(checkProvider(source, {}, [], undefined, false, true)).toBe(false);
    },
  );

  it.each([
    "axios({});",
    "axios.request({ responseType: 'text' });",
    "axios.defaults.responseType = 'text';",
    "axios.defaults.transformResponse = decode;",
    "axios.interceptors.response.use(decode);",
    "const alias = axios;",
    "const client = axios.create({ responseType: 'text' });",
    "JSON.parse = decode;",
    "XMLHttpRequest = ForeignRequest;",
  ])("retains closed client and global references with the capability: %s", (prefix) => {
    const source = `import axios from 'axios'; ${prefix}
      export const load = () => new Promise((resolve, reject) => {
        axios({}).then(response => resolve(response.data)).catch(reject);
      });`;
    expect(checkProvider(source, {}, [], undefined, false, true)).toBe(false);
  });

  it("does not approve an identical-looking default request in a different module", () => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({}).then(response => resolve(response.data)).catch(reject);
    });`;
    expect(
      checkProvider(
        source,
        { "other.js": "import axios from 'axios'; axios({});" },
        [],
        undefined,
        false,
        true,
      ),
    ).toBe(false);
    expect(
      checkProvider(
        source,
        { "other.js": "import axios from 'axios'; axios({ responseType: 'json' });" },
        [],
        undefined,
        false,
        true,
      ),
    ).toBe(true);
  });

  it("bounds only the new default-response alternatives while preserving legacy JSON", () => {
    for (const options of ["{}", "{ responseType: 'text' }", "{ responseType: 'json' }"]) {
      let alternatives = options;
      let alternativeCount = 1;
      while (alternativeCount <= CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_DEPTH) {
        alternatives = `true ? (${alternatives}) : (${alternatives})`;
        alternativeCount *= 2;
      }
      const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios(${alternatives}).then(response => resolve(response.data)).catch(reject);
      });`;
      expect(checkProvider(source, {}, [], undefined, false, true)).toBe(
        options.includes("'json'"),
      );
    }
  });

  it("retains private argument and prelude closure for default-response records", () => {
    const source = `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options };
      return new Promise((resolve, reject) => {
        axios(requestOptions).then(response => { if (response.status === 200) resolve(response.data); else reject(); }).catch(reject);
      });
    };`;
    const caller =
      "import { load } from './provider'; load({ url: '/catalog', responseType: 'text' });";
    expect(checkProvider(source, {}, [], caller, false, true)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], caller, false, true)).toBe(false);
    expect(checkProvider(source, {}, [], caller)).toBe(false);
    expect(
      checkProvider(source, {}, [], caller.replace("'text'", "'arraybuffer'"), false, true),
    ).toBe(false);
  });

  it.each([
    "error => reject(error)",
    "error => { reject(error); }",
    "error => { return reject(error); }",
    "response => reject(response)",
    "resolve => reject(resolve)",
  ])("certifies exact inline rejection forwarding: %s", (handler) => {
    for (const success of [
      "response => resolve(response.data)",
      "response => { if (200 === response.status) resolve(response.data); else reject(response.status); }",
    ]) {
      const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios({ responseType: 'json' }).then(${success}).catch(${handler});
      });`;
      expect(checkProvider(source)).toBe(true);
      expect(checkProvider(source, {}, ["./provider.js"])).toBe(true);
    }
  });

  it("retains exact renamed rejection roles with private arguments and const preludes", () => {
    const source = `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options, responseType: 'json' };
      return new Promise((complete, fail) => {
        const unused = null;
        axios(requestOptions).then(reply => complete(reply.data)).catch(problem => { return fail(problem); });
      });
    };`;
    const consumer = "import { load } from './provider'; load({ url: '/catalog' });";
    expect(checkProvider(source, {}, [], consumer)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], consumer)).toBe(false);
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "error => reject(other)",
    "error => other(error)",
    "reject => reject(reject)",
    "error => resolve(error)",
    "error => reject()",
    "error => reject(error, other)",
    "error => reject(...[error])",
    "error => reject(error.message)",
    "error => reject?.(error)",
    "error => reject.call(null, error)",
    "async error => reject(error)",
    "function (error) { reject(error); }",
    "(error, extra) => reject(error)",
    "(error = other) => reject(error)",
    "(...errors) => reject(errors)",
    "({ error }) => reject(error)",
    "error => { const unused = null; reject(error); }",
    "error => { console.log(error); reject(error); }",
    "error => { reject(error); console.log(error); }",
    "error => { reject(error); throw error; }",
    "error => { if (error) reject(error); }",
    "error => { ; reject(error); }",
    "error => { 'use strict'; reject(error); }",
    "error => { reject(error); return; }",
    "error => { return (reject(error), error); }",
  ])("refuses inline rejection handling outside the closed grammar: %s", (handler) => {
    for (const success of [
      "response => resolve(response.data)",
      "response => { if (response.status === 200) resolve(response.data); else reject(); }",
    ])
      expect(
        checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios({ responseType: 'json' }).then(${success}).catch(${handler});
      });`),
      ).toBe(false);
  });

  it.each([
    "axios({ responseType: 'text' })",
    "axios({ responseType: 'json', adapter: custom })",
    "axios({ responseType: 'json', transformResponse: custom })",
    "unknown({ responseType: 'json' })",
  ])("keeps native JSON provenance before inline rejection forwarding: %s", (request) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(error => reject(error));
    });`),
    ).toBe(false);
  });

  it("keeps existing direct rejection and no-catch behavior", () => {
    expect(checkProvider(providerSource)).toBe(true);
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise(resolve => {
      axios({ responseType: 'json' }).then(response => resolve(response.data));
    });`),
    ).toBe(true);
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise(resolve => {
      axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(error => reject(error));
    });`),
    ).toBe(false);
  });

  it.each([
    ["null", true],
    ["/(?i:a)/", false],
    ["1n", false],
    ["1e999", true],
  ])(
    "keeps provider primitive admissions syntax-aware without tightening legacy numbers: %s",
    (value, isCertified) => {
      const simulateRegExpNull = value === "/(?i:a)/";
      expect(
        checkProvider(
          `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ data: ${value}, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`,
          {},
          [],
          undefined,
          simulateRegExpNull,
        ),
      ).toBe(isCertified);
      expect(
        checkProvider(
          `import axios from 'axios'; export const load = () => {
      const unused = ${value};
      return new Promise((resolve, reject) => { axios({ responseType: 'json' }).then(response => resolve(response.data)).catch(reject); });
    };`,
          {},
          [],
          undefined,
          simulateRegExpNull,
        ),
      ).toBe(isCertified);
      expect(
        checkProvider(
          `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`,
          {},
          [],
          `import { load } from './provider'; load({ data: ${value} });`,
          simulateRegExpNull,
        ),
      ).toBe(isCertified);
    },
  );

  it.each([
    ["null", true],
    ["/(?i:a)/", false],
    ["1n", false],
  ])("distinguishes primitive null from special literal syntax: %s", (reason, isCertified) => {
    expect(
      checkProvider(
        `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => {
        if (response.status === 200) resolve(response.data); else reject(${reason});
      }).catch(reject);
    });`,
        {},
        [],
        undefined,
        reason === "/(?i:a)/",
      ),
    ).toBe(isCertified);
  });

  it.each([
    "response.status === 200",
    "200 === response.status",
    "response.status === 0",
    "200.5 === response.status",
    "response.status === 0xC8",
    "2e2 === response.status",
  ])("certifies an exact numeric status comparison: %s", (condition) => {
    const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => {
        if (${condition}) resolve(response.data); else reject();
      }).catch(reject);
    });`;
    expect(checkProvider(source)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"])).toBe(true);
  });

  it.each(["", "'failed'", "false", "null", "0", "200.5", "response.status"])(
    "certifies a closed rejection payload: %s",
    (reason) => {
      for (const catchClause of ["", ".catch(reject)"]) {
        const source = `import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
          axios({ responseType: 'json' }).then(response => {
            if (response.status === 200) { return resolve(response['data']); }
            else { return reject(${reason}); }
          })${catchClause};
        });`;
        expect(checkProvider(source)).toBe(true);
      }
    },
  );

  it("tracks renamed native settlement and response bindings through const preludes", () => {
    const source = `import axios from 'axios'; export const load = options => {
      const requestOptions = { ...options, responseType: 'json' };
      return new Promise((complete, fail) => {
        const unused = null;
        axios(requestOptions).then(function accept(reply) {
          if (200 === reply.status) return complete(reply.data); else { fail(reply.status); }
        }).catch(fail);
      });
    };`;
    const consumer = "import { load } from './provider'; load({ url: '/catalog' });";
    expect(checkProvider(source, {}, [], consumer)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], consumer)).toBe(false);
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    "if (foreign.status === 200) resolve(response.data); else reject(response.status);",
    "if (response.status === 200) resolve(foreign.data); else reject(response.status);",
    "if (response.status === 200) resolve(response.data); else reject(foreign.status);",
    "if (response.status == 200) resolve(response.data); else reject();",
    "if (response.status !== 200) resolve(response.data); else reject();",
    "if (response.status >= 200) resolve(response.data); else reject();",
    "if (response.status === code) resolve(response.data); else reject();",
    "if (response.status === '200') resolve(response.data); else reject();",
    "if (response.status === 1e999) resolve(response.data); else reject();",
    "if (response['status'] === 200) resolve(response.data); else reject();",
    "if (response?.status === 200) resolve(response.data); else reject();",
    "if ((response.status = 200)) resolve(response.data); else reject();",
    "if (matches(response.status)) resolve(response.data); else reject();",
    "if (response.status === 200) resolve(response.data);",
    "if (response.status === 200) resolve(response.data); else if (true) reject();",
    "if (response.status === 200) resolve(response.data); else resolve(response.data);",
    "if (response.status === 200) other(response.data); else reject();",
    "if (response.status === 200) resolve(response.data); else other();",
    "if (response.status === 200) { resolve(response.data); throw failure; } else reject();",
    "if (response.status === 200) { resolve(response.data); console.log(response); } else reject();",
    "if (response.status === 200) resolve(response.data); else { reject(); console.log('failed'); }",
    "if (response.status === 200) { const body = response.data; resolve(body); } else reject();",
    "if (response.status === 200) return resolve(response.data); return reject();",
    "return response.status === 200 ? resolve(response.data) : reject();",
    "const status = response.status; if (status === 200) resolve(response.data); else reject();",
    "if (response.status === 200) resolve(response.data); else reject(); ;",
    "'use strict'; if (response.status === 200) resolve(response.data); else reject();",
    "if (response.status === 200) resolve(response.data); else { ; reject(); }",
    "if (response.status === 200) resolve(response.data); else throw failure;",
  ])("refuses a status callback outside the exhaustive source grammar: %s", (body) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => { ${body} }).catch(reject);
    });`),
    ).toBe(false);
  });

  it.each([
    "undefined",
    "`failed`",
    "-1",
    "+1",
    "1n",
    "/failed/",
    "{}",
    "[]",
    "new Error('failed')",
    "createFailure()",
    "response",
    "response.data",
    "response.statusText",
    "foreign.status",
    "response['status']",
    "response?.status",
    "'failed', 0",
    "1e999",
  ])("refuses an unproved status rejection payload: %s", (reason) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(response => {
        if (response.status === 200) resolve(response.data); else reject(${reason});
      }).catch(reject);
    });`),
    ).toBe(false);
  });

  it.each([
    "async response => { if (response.status === 200) resolve(response.data); else reject(); }",
    "function* (response) { if (response.status === 200) resolve(response.data); else reject(); }",
    "response => { if (response.status === 200) resolve?.(response.data); else reject(); }",
    "response => { if (response.status === 200) resolve(response.data); else reject?.(); }",
    "(response, extra) => { if (response.status === 200) resolve(response.data); else reject(); }",
  ])("refuses unsupported guarded callbacks: %s", (callback) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      axios({ responseType: 'json' }).then(${callback}).catch(reject);
    });`),
    ).toBe(false);
  });

  it.each([
    ".catch(resolve)",
    ".catch(error => reject(error.message))",
    ".catch(() => null).then(resolve)",
  ])("retains exact native rejection handling: %s", (catchClause) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
        axios({ responseType: 'json' }).then(response => {
          if (response.status === 200) resolve(response.data); else reject(response.status);
        })${catchClause};
      });`),
    ).toBe(false);
  });

  it.each([
    "axios({ responseType: 'text' })",
    "axios({ responseType: 'json', adapter: custom })",
    "axios({ responseType: 'json', transformResponse: custom })",
    "unknown({ responseType: 'json' })",
  ])("keeps the native JSON request proof before the status gate: %s", (request) => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise((resolve, reject) => {
      ${request}.then(response => { if (response.status === 200) resolve(response.data); else reject(); }).catch(reject);
    });`),
    ).toBe(false);
  });

  it("preserves legacy direct forwarding without a reject parameter or catch", () => {
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise(resolve => {
      axios({ responseType: 'json' }).then(response => resolve(response.data));
    });`),
    ).toBe(true);
    expect(
      checkProvider(`import axios from 'axios'; export const load = () => new Promise(resolve => {
      axios({ responseType: 'json' }).then(response => {
        if (response.status === 200) resolve(response.data); else reject();
      });
    });`),
    ).toBe(false);
  });

  it.each([
    [
      "const requestOptions = { url: '/catalog', responseType: 'json' };",
      "",
      "axios(requestOptions)",
    ],
    [
      "",
      "const requestOptions = { url: '/catalog', responseType: 'json' };",
      "axios.request(requestOptions)",
    ],
    [
      "const url = '/catalog'; const transport = { url };",
      "const requestOptions = { ...transport, responseType: 'json' };",
      "axios(requestOptions)",
    ],
    [
      "const unused = null; const record = { method: 'get' };",
      "const requestOptions = { url: '/catalog', responseType: 'json' };",
      "axios(requestOptions)",
    ],
    ["const url = `/catalog`; const unused = !false;", "", "axios({ url, responseType: 'json' })"],
  ])(
    "certifies closed ordered const preludes: %s %s",
    (helperPrelude, executorPrelude, request) => {
      const source = `import axios from 'axios'; export const load = () => {
      ${helperPrelude}
      return new Promise((resolve, reject) => {
        ${executorPrelude}
        ${request}.then(response => resolve(response.data)).catch(reject);
      });
    };`;
      expect(checkProvider(source)).toBe(true);
      expect(checkProvider(source, {}, ["./provider.js"])).toBe(true);
    },
  );

  it.each([
    ["const url = options.url;", "const requestOptions = { url, responseType: 'json' };"],
    ["const requestOptions = { ...options, responseType: 'json' };", ""],
    [
      "const unused = options.method;",
      "const requestOptions = { ...options, responseType: 'json' };",
    ],
  ])(
    "retains exact caller provenance through const preludes: %s %s",
    (helperPrelude, executorPrelude) => {
      const source = `import axios from 'axios'; export const load = options => {
      ${helperPrelude}
      return new Promise((resolve, reject) => {
        ${executorPrelude}
        axios(requestOptions).then(response => resolve(response.data)).catch(reject);
      });
    };`;
      const consumer =
        "import { load } from './provider'; load({ url: '/catalog', method: 'get' });";
      expect(checkProvider(source, {}, [], consumer)).toBe(true);
      expect(checkProvider(source, {}, ["./provider.js"], consumer)).toBe(false);
      expect(checkProvider(source)).toBe(false);
    },
  );

  it.each([
    "const unused = sideEffect();",
    "const unused = { get url() { return '/other'; } };",
    "const unused = () => options;",
    "const alias = options;",
    "const unused = { ...foreign };",
    "const unused = { url: foreign };",
    "const before = { url: after }; const after = '/catalog';",
    "const before = { ...after }; const after = { url: '/catalog' };",
    "const before = { url: before };",
    "const before = { ...before };",
    "const first = '/catalog'; const alias = first;",
    "const unused = true ? { url: '/catalog' } : { url: '/other' };",
    "const unused = { url: options.missing };",
    "const unused = options['url'];",
    "const unused = { headers: {} };",
    "const unused = { ['url']: '/catalog' };",
    "const unused = { adapter: 'custom' };",
    "const unused = new Promise(() => {});",
    "const { url } = options;",
    "const first = '/catalog', second = '/other';",
    "let unused = '/catalog'; unused = '/other';",
    "var unused = '/catalog';",
    "const unused = '/catalog'; unused = '/other';",
    "const unused = { url: '/catalog' }; unused.url = '/other';",
    "const unused = '/catalog'; publish(unused);",
    "const unused = { url: '/catalog' }; publish(unused);",
    "const unused = '/catalog'; void unused;",
    "const unused = '/catalog'; ;",
    "if (true) { const unused = '/catalog'; }",
    "for (;;) {}",
    "'use strict';",
  ])("refuses unsupported helper and executor preludes: %s", (prelude) => {
    for (const placement of ["helper", "executor"]) {
      const source = `import axios from 'axios'; export const load = options => {
        ${placement === "helper" ? prelude : ""}
        return new Promise((resolve, reject) => {
          ${placement === "executor" ? prelude : ""}
          axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
        });
      };`;
      expect(
        checkProvider(
          source,
          {},
          [],
          "import { load } from './provider'; load({ url: '/catalog' });",
        ),
      ).toBe(false);
    }
  });

  it.each([
    "const outside = '/catalog'; export const load = () => { const url = outside; return new Promise((resolve, reject) => { axios({ url, responseType: 'json' }).then(response => resolve(response.data)).catch(reject); }); };",
    "const outside = { url: '/catalog' }; export const load = () => { const requestOptions = { ...outside, responseType: 'json' }; return new Promise((resolve, reject) => { axios(requestOptions).then(response => resolve(response.data)).catch(reject); }); };",
    "export const load = () => { const url = '/catalog'; return new Promise((resolve, reject) => { axios.get(url, { responseType: 'json' }).then(response => resolve(response.data)).catch(reject); }); };",
  ])(
    "keeps module inputs and unsupported local URL aliases outside the prelude proof: %s",
    (declaration) => {
      expect(checkProvider(`import axios from 'axios'; ${declaration}`)).toBe(false);
    },
  );

  it("retains the local-record refusal for a cross-module imported client", () => {
    expect(
      checkProvider(
        `import client from './client'; export const load = () => {
      const requestOptions = { url: '/catalog', responseType: 'json' };
      return new Promise((resolve, reject) => { client(requestOptions).then(response => resolve(response.data)).catch(reject); });
    };`,
        {
          "client.js":
            "import axios from 'axios'; const client = axios.create(); export default client;",
        },
      ),
    ).toBe(false);
  });

  it("bounds declarations across both prefixes and option alternatives without changing the no-prefix path", () => {
    const declarations = Array.from(
      { length: CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT },
      (_, index) => `const unused${index} = null;`,
    );
    const createSource = (
      helperPrelude: string,
      executorPrelude: string,
      requestOptions = "{ url: '/catalog', responseType: 'json' }",
    ) => `import axios from 'axios'; export const load = () => {
      ${helperPrelude}
      return new Promise((resolve, reject) => { ${executorPrelude} axios(${requestOptions}).then(response => resolve(response.data)).catch(reject); });
    };`;
    expect(
      checkProvider(createSource(declarations.slice(0, -1).join(" "), declarations.at(-1) ?? "")),
    ).toBe(true);
    expect(checkProvider(createSource(declarations.join(" "), "const extra = null;"))).toBe(false);
    let alternatives = "{ responseType: 'json' }";
    let alternativeCount = 1;
    while (alternativeCount <= CLOSED_JSON_SNAPSHOT_PROVIDER_MAX_PRELUDE_DECLARATION_COUNT) {
      alternatives = `true ? (${alternatives}) : (${alternatives})`;
      alternativeCount *= 2;
    }
    expect(checkProvider(createSource("", "", alternatives))).toBe(true);
    expect(checkProvider(createSource("const unused = null;", "", alternatives))).toBe(false);
  });

  it.each([
    "axios({ ...options, responseType: 'json' })",
    "axios({ url: options.url, method: options.method, responseType: 'json' })",
    "axios.request({ ...options, responseType: 'json' })",
    "axios.get(options.url, { responseType: 'json' })",
  ])("proves one fresh caller literal through the exact parameter: %s", (request) => {
    const source = `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(reject);
    });`;
    expect(
      checkProvider(
        source,
        {},
        [],
        "import { load } from './provider'; load({ url: '/catalog', method: 'get' });",
      ),
    ).toBe(true);
    expect(checkProvider(source)).toBe(false);
  });

  it.each([
    ["{ url: '/catalog' }", true],
    ["{ url: '/catalog', responseType: 'json' }", true],
    ["{ url: '/catalog', responseType: 'text' }", false],
  ])("normalizes JSON mode before the caller spread: %s", (argumentSource, isCertified) => {
    const source = `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      axios({ responseType: 'json', ...options }).then(response => resolve(response.data)).catch(reject);
    });`;
    expect(
      checkProvider(source, {}, [], `import { load } from './provider'; load(${argumentSource});`),
    ).toBe(isCertified);
  });

  it.each([
    "const unused = sideEffect();",
    "const unused = { get url() { return '/other'; } };",
    "const unused = () => options;",
    "const unused = options;",
    "const before = after; const after = '/other';",
    "var transport = { responseType: 'json' };",
    "options.url = '/other';",
    "publish(options);",
  ])("refuses an unproved local prelude: %s", (prelude) => {
    const source = `import axios from 'axios'; export const load = options => {
      ${prelude}
      return new Promise((resolve, reject) => {
        axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
      });
    };`;
    expect(
      checkProvider(
        source,
        {},
        [],
        "import { load } from './provider'; load({ url: '/catalog' });",
      ),
    ).toBe(false);
  });

  it.each([
    "load(unknown)",
    "const options = { url: '/catalog' }; load(options)",
    "const options = { url: '/catalog' }; publish(options); load(options)",
    "load({ ...unknown })",
    "load({ url: compute() })",
    "load({ url: '/catalog', headers: {} })",
    "load({ get url() { return '/catalog'; } })",
    "load({ url: '/catalog', url: '/other' })",
    "load({ ['url']: '/catalog' })",
    "load({ url: '/catalog', adapter: 'custom' })",
    "load({ url: '/catalog' }, {})",
    "load(...[{ url: '/catalog' }])",
  ])("refuses caller values outside the fresh primitive-literal contract: %s", (consumerSource) => {
    const source = `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`;
    expect(
      checkProvider(source, {}, [], `import { load } from './provider'; ${consumerSource};`),
    ).toBe(false);
  });

  it.each([
    "axios({ responseType: 'json', ...options })",
    "axios({ url: options.missing, responseType: 'json' })",
    "axios({ url: options['url'], responseType: 'json' })",
    "axios(opaque ? { ...options, responseType: 'json' } : unknown)",
    "axios({ ...options, responseType: 'json', transformResponse: [JSON.parse] })",
    "axios({ ...options, responseType: 'json' }).then(() => options)",
  ])("refuses unknown fields, overrides, paths, or consumers: %s", (request) => {
    const source = `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      ${request}.then(response => resolve(response.data)).catch(reject);
    });`;
    expect(
      checkProvider(
        source,
        {},
        [],
        "import { load } from './provider'; load({ url: '/catalog', responseType: 'text' });",
      ),
    ).toBe(false);
  });

  it("keeps fresh argument provenance private while preserving public zero-argument providers", () => {
    const source = `import axios from 'axios'; export const load = options => new Promise((resolve, reject) => {
      axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
    });`;
    const consumer = "import { load } from './provider'; load({ url: '/catalog' });";
    expect(checkProvider(source, {}, [], consumer)).toBe(true);
    expect(checkProvider(source, {}, ["./provider.js"], consumer)).toBe(false);
    expect(checkProvider(providerSource, {}, ["./provider.js"])).toBe(true);
  });

  it("does not approve another client request from the candidate argument context", () => {
    const source = `import axios from 'axios';
      const other = options => axios(options);
      export const load = options => new Promise((resolve, reject) => {
        axios({ ...options, responseType: 'json' }).then(response => resolve(response.data)).catch(reject);
      });`;
    expect(
      checkProvider(
        source,
        {},
        [],
        "import { load } from './provider'; load({ url: '/catalog' });",
      ),
    ).toBe(false);
  });

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
