import { resetParseSourceFileCache } from "../../utils/parse-source-file.js";
import { resetTsconfigAliasCaches } from "../../utils/resolve-tsconfig-alias.js";
import { resetModuleResolutionCaches } from "../../utils/resolve-relative-import-path.js";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { captureCrossFileProbes } from "../../utils/cross-file-probe-recorder.js";
import {
  NODE_PORT_PROCESS_SMALL_CALL_COUNT,
  NODE_PORT_PROCESS_LARGE_CALL_COUNT,
  NODE_PORT_PROCESS_MAXIMUM_LOOKUP_GROWTH_MULTIPLIER,
  NODE_PORT_PROCESS_MAXIMUM_PROVIDER_WALK_COUNT,
  NODE_PORT_PROCESS_SINGLE_VALUE_COUNT,
} from "../../constants/react.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { isImportedNodePortProcessUtility } from "../../utils/is-imported-node-port-process-utility.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import type { Rule } from "../../utils/rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const providerWork = vi.hoisted(() => ({ inspectedReferences: 0, programTraversals: 0 }));
vi.mock("../../utils/walk-ast.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../utils/walk-ast.js")>();
  const { isNodeOfType } = await import("../../utils/is-node-of-type.js");
  return {
    ...original,
    walkAst: (...arguments_: Parameters<typeof original.walkAst>): void => {
      const [program] = arguments_;
      const firstStatement = isNodeOfType(program, "Program") ? program.body[0] : undefined;
      if (
        isNodeOfType(firstStatement, "VariableDeclaration") &&
        firstStatement.declarations.some(
          (declaration) =>
            isNodeOfType(declaration.id, "Identifier") && declaration.id.name === "reservePort",
        )
      )
        providerWork.programTraversals += 1;
      original.walkAst(...arguments_);
    },
  };
});

vi.mock("../../utils/is-within-assignment-target.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../utils/is-within-assignment-target.js")>();
  return {
    ...original,
    isWithinAssignmentTarget: (
      expression: Parameters<typeof original.isWithinAssignmentTarget>[0],
    ): boolean => {
      providerWork.inspectedReferences += 1;
      return original.isWithinAssignmentTarget(expression);
    },
  };
});

interface NodeUtilityCase {
  readonly name: string;
  readonly consumer?: string;
  readonly provider?: string;
  readonly companions?: Readonly<Record<string, string>>;
  readonly certificate: boolean;
  readonly diagnostics?: number;
}

const consumer = `const useTerminal = require('./terminal');
const startTerminal = async (directory, command) => {
  const address = await useTerminal(directory, command, 7123);
  console.log(address);
};`;

const provider = `const reservePort = require('use-port');
const colors = require('chalk');
const spawn = require('execa');
const files = require('fs');
const openTerminal = async (directory, command, preferredPort = 7124) => {
  return new Promise(async (finish) => {
    if (!files.existsSync(directory)) {
      console.log(directory, 'Missing directory');
      return;
    }
    const selectedPort = await reservePort(preferredPort);
    if (typeof command === 'string') {
      command = command.split(' ').filter(part => part.trim());
    }
    const child = spawn('terminal-server', ['--port', selectedPort, ...command], {
      cwd: directory || process.cwd(),
    });
    child.on('error', function(error) {
      if (error.code === 'ENOENT') {
        console.log(colors.red(colors.yellow('Install the terminal server')));
      } else {
        console.log(error);
      }
    });
    child.stdout.on('data', function(chunk) {
      const line = chunk.toString().replace(/\\n$/, '');
      console.log(line);
    });
    finish(\`ws://localhost:\${selectedPort}/\`);
  });
};
module.exports = openTerminal;`;

const replaceProvider = (before: string, after: string): string => provider.replace(before, after);
const replaceConsumer = (before: string, after: string): string => consumer.replace(before, after);

const cases: ReadonlyArray<NodeUtilityCase> = [
  { name: "closed allocator and child process roles", certificate: true, diagnostics: 0 },
  {
    name: "renamed local export and imports",
    provider: provider
      .replaceAll("openTerminal", "allocateSession")
      .replaceAll("selectedPort", "availablePort")
      .replaceAll("files", "filesystem"),
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "explicit JavaScript provider",
    consumer: replaceConsumer("'./terminal'", "'./terminal.js'"),
    companions: { "src/terminal.ts": "module.exports = () => useState(0);" },
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "ordinary JSON configuration loading",
    consumer: `const location = require('path');
const operatingSystem = require('os');
const configurationPath = location.join(operatingSystem.homedir(), 'terminal-settings.json');
const configuration = require(configurationPath);
${consumer}`,
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "dot-prefixed package name is not a relative require",
    consumer: replaceConsumer("'./terminal'", "'.terminal'"),
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{".terminal":["src/.terminal.js"]}}}',
      "src/.terminal.js": provider,
      "node_modules/.terminal/package.json": '{"main":"index.js"}',
      "node_modules/.terminal/index.js": "module.exports = () => useState(0);",
    },
    certificate: false,
  },
  {
    name: "missing local provider",
    consumer: replaceConsumer("'./terminal'", "'./missing'"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "shadowed require",
    consumer: "const require = getLoader();\n" + consumer,
    certificate: false,
  },
  {
    name: "reassigned loader",
    consumer: "require = getLoader();\n" + consumer,
    certificate: false,
  },
  {
    name: "require cache escape",
    consumer: consumer + "\npublish(require.cache);",
    certificate: false,
  },
  {
    name: "opaque dynamic module",
    consumer: "const plugin = require(pluginPath);\n" + consumer,
    certificate: false,
  },
  {
    name: "non JSON dynamic path",
    consumer: `const location = require('path');
const operatingSystem = require('os');
const configurationPath = location.join(operatingSystem.homedir(), 'terminal-settings.js');
const configuration = require(configurationPath);
${consumer}`,
    certificate: false,
  },
  {
    name: "custom require inside provider",
    provider: "const require = customLoader;\n" + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "shadowed CommonJS module",
    provider: "const module = {};\n" + provider,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "computed CommonJS export",
    provider: replaceProvider("module.exports", "module['exports']"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "second canonical consumer exposure",
    consumer: "const second = require('./terminal.js');\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "consumer callback escape",
    consumer: consumer + "\nregister(useTerminal);",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "consumer binding replacement",
    consumer:
      consumer.replace("const useTerminal", "let useTerminal") + "\nuseTerminal = customHook;",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "selected import alias",
    consumer:
      "const terminal = require('./terminal'); const useTerminal = terminal; async function start(){ await useTerminal('.', [], 7123); }",
    certificate: false,
  },
  {
    name: "spread call arguments",
    consumer: replaceConsumer("directory, command, 7123", "...parameters"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "nonliteral numeric input",
    consumer: replaceConsumer("7123", "configuration.port"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "genuine React hook provider",
    provider: "const React = require('react'); module.exports = () => React.useState(0);",
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "hook injected into error callback",
    provider: replaceProvider("console.log(error);", "useState(0);"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "hook injected into output callback",
    provider: replaceProvider("console.log(line);", "useState(0);"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "hook injected into normalization callback",
    provider: replaceProvider("part => part.trim()", "part => useState(part)"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unknown SDK import",
    provider: replaceProvider("require('use-port')", "require('use-custom')"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "nested relative module has unknown initialization effects",
    provider: replaceProvider("const selectedPort", "require('./side-effect'); const selectedPort"),
    companions: { "src/side-effect.js": "require('react').useState(0);" },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "nested package has unknown initialization effects",
    provider: replaceProvider("const selectedPort", "require('side-effect'); const selectedPort"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "allocator callback argument",
    provider: replaceProvider(
      "reservePort(preferredPort)",
      "reservePort(preferredPort, renderHook)",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "SDK binding escape",
    provider: replaceProvider("const selectedPort", "publish(reservePort); const selectedPort"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "extra callback factory",
    provider: replaceProvider(
      "const selectedPort",
      "const render = () => useState(0); const selectedPort",
    ),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unapproved Promise continuation",
    provider: replaceProvider("const selectedPort", "await unknownThenable; const selectedPort"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "source-visible SDK replacement",
    consumer: "const files = require('fs'); files.existsSync = customHook;\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "node-prefixed SDK replacement",
    consumer: "const files = require('node:fs'); files.existsSync = customHook;\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "inline SDK exposure",
    consumer: "require('fs').existsSync = customHook;\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "logger escape",
    consumer: "const logger = console; logger.log = customHook;\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "visible custom command iterator",
    consumer:
      "const injected = { [Symbol.iterator]: function*(){ useState(0); yield 'shell'; } };\n" +
      consumer.replace("directory, command, 7123", "directory, injected, 7123"),
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "visible input accessor",
    consumer: "const directoryValue = { get path(){ return useState(0); } };\n" + consumer,
    certificate: false,
    diagnostics: 2,
  },
  {
    name: "native prototype replacement",
    consumer: "String.prototype.split = customHook;\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "loader construction API",
    consumer: "const moduleApi = require('node:module');\n" + consumer,
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "mapped allocator",
    companions: {
      "tsconfig.json":
        '{"compilerOptions":{"baseUrl":".","paths":{"use-port":["src/local-port.js"]}}}',
      "src/local-port.js": "module.exports = () => useState(0);",
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "TypeScript-first module disagrees with CommonJS",
    companions: { "src/terminal.ts": "module.exports = () => useState(0);" },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "benign TypeScript cannot replace genuine JavaScript hook",
    provider: "const React = require('react'); module.exports = () => React.useState(0);",
    companions: { "src/terminal.ts": provider },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "extensionless exact file precedes JavaScript",
    companions: { "src/terminal": "module.exports = () => useState(0);" },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "unsupported package directory entry",
    consumer: replaceConsumer("'./terminal'", "'./service'"),
    companions: {
      "src/service/package.json": '{"main":"entry.js"}',
      "src/service/entry.js": provider,
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "ES module package role",
    companions: { "package.json": '{"type":"module","dependencies":{"use-port":"^1.0.3"}}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "renamed ordinary global timer handle",
    consumer:
      "clearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(async () => {}, 2000);\n" +
      consumer,
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "global native SDK provider is not a timer slot",
    consumer:
      "clearInterval(global.Promise);\nglobal.Promise = setInterval(() => {}, 2000);\n" + consumer,
    certificate: false,
  },
  {
    name: "sloppy receiver cannot replace native Promise",
    consumer:
      "function replacePromise() { this.Promise = function(executor) { return useInjected(0); }; }\nreplacePromise();\n" +
      consumer,
    certificate: false,
  },
  {
    name: "unpaired global assignment",
    consumer: "global.activeSessionTimer = 1;\n" + consumer,
    certificate: false,
  },
  {
    name: "replaced global timer producer",
    consumer:
      "setInterval = (callback) => callback();\nclearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(() => {}, 2000);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "replaced global timer clearer",
    consumer:
      "clearInterval = () => {};\nclearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(() => {}, 2000);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "timer callback alias declines",
    consumer:
      "const callback = () => {};\nclearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(callback, 2000);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "timer handle escape declines",
    consumer:
      "clearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(() => {}, 2000);\npublish(global.activeSessionTimer);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "computed global timer slot declines",
    consumer:
      "clearInterval(global['activeSessionTimer']);\nglobal['activeSessionTimer'] = setInterval(() => {}, 2000);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "timer delay transport declines",
    consumer:
      "const delay = 2000;\nclearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = setInterval(() => {}, delay);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "timer provider alias declines",
    consumer:
      "const schedule = setInterval;\nclearInterval(global.activeSessionTimer);\nglobal.activeSessionTimer = schedule(() => {}, 2000);\n" +
      consumer,
    certificate: false,
  },
  {
    name: "CommonJS wrapper cannot expose an alternate loader",
    consumer:
      "const load = arguments[1];\nconst root = load('node:vm').runInThisContext('globalThis');\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "const computed constructor cannot expose native globals",
    consumer:
      "const property = 'constructor';\nconst NativeFunction = (() => {})[property];\nconst root = NativeFunction('return this')();\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "concatenated constructor cannot expose native globals",
    consumer:
      "const NativeFunction = (() => {})['con' + 'structor'];\nconst root = NativeFunction('return this')();\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "destructured constructor cannot expose native globals",
    consumer:
      "const {constructor: NativeFunction} = (() => {});\nconst root = NativeFunction('return this')();\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "computed destructured constructor cannot expose native globals",
    consumer:
      "const property = 'constructor';\nconst {[property]: NativeFunction} = (() => {});\nconst root = NativeFunction('return this')();\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "ordinary numeric literal data access remains eligible",
    consumer: "const values = ['sample'];\nconsole.log(values[0]);\n" + consumer,
    certificate: true,
    diagnostics: 0,
  },
  {
    name: "sloppy function caller cannot expose CommonJS loader",
    consumer:
      "function captureLoader() { return captureLoader.caller.arguments[1]; }\nconst load = captureLoader();\nconst root = load('node:vm').runInThisContext('globalThis');\nconst {useState: useInjected} = require('react');\nroot.Promise = function() { return useInjected(0); };\n" +
      consumer,
    certificate: false,
  },
  {
    name: "unknown global stack provider declines",
    consumer: "Error.prepareStackTrace = (error, stack) => stack;\n" + consumer,
    certificate: false,
  },
  {
    name: "unclassified global factory declines",
    consumer: "const root = captureGlobal();\n" + consumer,
    certificate: false,
  },
  {
    name: "declared allocator npm alias declines",
    companions: {
      "package.json": '{"dependencies": {"use-port": "npm:react-hook-provider@1.0.0"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "declared allocator local source declines",
    companions: { "package.json": '{"dependencies": {"use-port": "file:./hook-provider"}}' },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "declared color provider alias declines",
    companions: {
      "package.json":
        '{"dependencies": {"use-port": "^1.0.3", "chalk": "npm:react-hook-provider@1.0.0"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "declared process provider workspace source declines",
    companions: {
      "package.json":
        '{"dependencies": {"use-port": "^1.0.3"}, "devDependencies": {"execa": "workspace:*"}}',
    },
    certificate: false,
    diagnostics: 1,
  },
  {
    name: "ordinary caret tilde and exact versions retain role",
    companions: {
      "package.json":
        '{"dependencies": {"use-port": "~1.0.3", "chalk": "3.0.0", "execa": "^3.4.0"}}',
    },
    certificate: true,
    diagnostics: 0,
  },
];

const certificateProbe: Rule = {
  id: "node-utility-certificate-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (isImportedNodePortProcessUtility(node, context))
        context.report({ node, message: "certified" });
    },
  }),
};
let temporaryDirectory = "";
const writeFile = (relativePath: string, source: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};
beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "node-port-process-"));
  writeFile("package.json", '{"dependencies":{"use-port":"^1.0.3"}}');
  resetFilesystemCaches();
});
afterEach(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

describe("finite CommonJS port and process utility", () => {
  it.each(cases)("$name", (fixture) => {
    writeFile("src/terminal.js", fixture.provider ?? provider);
    for (const [filename, source] of Object.entries(fixture.companions ?? {}))
      writeFile(filename, source);
    const source = fixture.consumer ?? consumer;
    const filename = writeFile("src/start.js", source);
    const certificate = runRule(certificateProbe, source, { filename });
    const result = runRule(rulesOfHooks, source, { filename });
    expect(certificate.parseErrors).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(certificate.diagnostics.length > 0).toBe(fixture.certificate);
    if (fixture.diagnostics !== undefined)
      expect(result.diagnostics).toHaveLength(fixture.diagnostics);
  });
});

describe("Node utility cross-file dependencies", () => {
  it("records provider, manifest and absent higher-priority extension candidates", () => {
    const filename = writeFile("src/start.js", consumer);
    const implementation = writeFile("src/terminal.js", provider);
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["rules-of-hooks"],
    });
    expect(trace?.contentPaths).toContain(implementation);
    expect(trace?.contentPaths).toContain(path.join(temporaryDirectory, "package.json"));
    expect(trace?.existencePaths).toContain(path.join(temporaryDirectory, "src/terminal.ts"));
  });

  it("replays provider edits with restored metadata at each scan epoch", () => {
    const filename = writeFile("src/start.js", consumer);
    const implementation = writeFile("src/terminal.js", provider);
    const originalStat = fs.statSync(implementation);
    const changed = provider.replace("'use-port'", "'bad-port'");
    expect(changed.length).toBe(provider.length);
    for (const phase of [
      { source: provider, count: 0 },
      { source: changed, count: 1 },
      { source: provider, count: 0 },
    ]) {
      fs.writeFileSync(implementation, phase.source);
      fs.utimesSync(implementation, originalStat.atime, originalStat.mtime);
      resetFilesystemCaches();
      const result = runRule(rulesOfHooks, consumer, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(phase.count);
    }
  });

  it("tracks a local SDK shadow appearing and disappearing", () => {
    const filename = writeFile("src/start.js", consumer);
    writeFile("src/terminal.js", provider);
    writeFile(
      "tsconfig.json",
      '{"compilerOptions":{"baseUrl":".","paths":{"use-port":["src/local-port.js"]}}}',
    );
    const trace = collectCrossFileDependencyProbes({
      absoluteFilePath: filename,
      sourceText: consumer,
      ruleIds: ["rules-of-hooks"],
    });
    const shadow = path.join(temporaryDirectory, "src/local-port.js");
    expect(trace?.existencePaths).toContain(shadow);
    for (const phase of [
      { present: false, count: 0 },
      { present: true, count: 1 },
      { present: false, count: 0 },
    ]) {
      if (phase.present) fs.writeFileSync(shadow, "module.exports = () => useState(0);");
      else fs.rmSync(shadow, { force: true });
      resetFilesystemCaches();
      const result = runRule(rulesOfHooks, consumer, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(phase.count);
    }
  });
});

describe("memoized Node utility proofs", () => {
  it.each([false, true])("bounds consumer work with distinct providers=$0", (distinctProviders) => {
    const measurements = [
      NODE_PORT_PROCESS_SMALL_CALL_COUNT,
      NODE_PORT_PROCESS_LARGE_CALL_COUNT,
    ].map((callCount) => {
      resetFilesystemCaches();
      const declarations = distinctProviders
        ? Array.from(
            { length: callCount },
            (_, index) => `const useTerminal${index} = require('./terminal-${index}');`,
          ).join("\n")
        : "const useTerminal = require('./terminal');";
      for (let index = 0; index < callCount; index += 1)
        writeFile(`src/terminal-${index}.js`, provider);
      writeFile("src/terminal.js", provider);
      const source =
        declarations +
        "\nconst start = async(directory, command) => {" +
        Array.from(
          { length: callCount },
          (_, index) =>
            `await useTerminal${distinctProviders ? index : ""}(directory, command, 7123);`,
        ).join("\n") +
        "};";
      let lookups = 0;
      const probe: Rule = {
        ...certificateProbe,
        create: (context) =>
          certificateProbe.create({
            ...context,
            scopes: {
              ...context.scopes,
              isGlobalReference: (identifier) => {
                lookups += 1;
                return context.scopes.isGlobalReference(identifier);
              },
              symbolFor: (identifier) => {
                lookups += 1;
                return context.scopes.symbolFor(identifier);
              },
              referenceFor: (identifier) => {
                lookups += 1;
                return context.scopes.referenceFor(identifier);
              },
            },
          }),
      };
      providerWork.inspectedReferences = 0;
      providerWork.programTraversals = 0;
      const result = runRule(probe, source, {
        filename: path.join(temporaryDirectory, "src/start.js"),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(callCount);
      expect(providerWork.programTraversals).toBeGreaterThan(0);
      expect(providerWork.programTraversals).toBeLessThanOrEqual(
        (distinctProviders ? callCount : NODE_PORT_PROCESS_SINGLE_VALUE_COUNT) *
          NODE_PORT_PROCESS_MAXIMUM_PROVIDER_WALK_COUNT,
      );
      return { lookups, inspectedReferences: providerWork.inspectedReferences };
    });
    expect(measurements[0].lookups).toBeGreaterThan(0);
    expect(measurements[0].inspectedReferences).toBeGreaterThan(0);
    expect(measurements[1].lookups).toBeLessThan(
      measurements[0].lookups * NODE_PORT_PROCESS_MAXIMUM_LOOKUP_GROWTH_MULTIPLIER,
    );
    expect(measurements[1].inspectedReferences).toBeLessThan(
      measurements[0].inspectedReferences * NODE_PORT_PROCESS_MAXIMUM_LOOKUP_GROWTH_MULTIPLIER,
    );
  });

  it("replays all warm probes and refreshes the same analysis after a filesystem epoch", () => {
    const filename = writeFile("src/start.js", consumer);
    const implementation = writeFile("src/terminal.js", provider);
    let exercised = false;
    const probe: Rule = {
      ...certificateProbe,
      create: (context) => ({
        CallExpression: (node) => {
          const cold = captureCrossFileProbes(() =>
            isImportedNodePortProcessUtility(node, context),
          );
          if (!cold.value) return;
          exercised = true;
          const warm = captureCrossFileProbes(() =>
            isImportedNodePortProcessUtility(node, context),
          );
          expect(warm.value).toBe(true);
          expect([...warm.trace.contentPaths].sort()).toEqual([...cold.trace.contentPaths].sort());
          expect([...warm.trace.existencePaths].sort()).toEqual(
            [...cold.trace.existencePaths].sort(),
          );
          expect(cold.trace.contentPaths.has(implementation)).toBe(true);
          expect(
            isImportedNodePortProcessUtility(node, {
              ...context,
              filename: path.join(temporaryDirectory, "elsewhere/start.js"),
            }),
          ).toBe(false);
          expect(isImportedNodePortProcessUtility(node, context)).toBe(true);
          for (const phase of [
            { manifest: '{"dependencies":{"use-port":"file:./hook-provider"}}', expected: false },
            { manifest: '{"dependencies":{"use-port":"^1.0.3"}}', expected: true },
          ]) {
            writeFile("package.json", phase.manifest);
            resetFilesystemCaches();
            expect(isImportedNodePortProcessUtility(node, context)).toBe(phase.expected);
          }
          fs.writeFileSync(implementation, provider.replace("'use-port'", "'bad-port'"));
          resetFilesystemCaches();
          expect(isImportedNodePortProcessUtility(node, context)).toBe(false);
        },
      }),
    };
    const result = runRule(probe, consumer, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(exercised).toBe(true);
  });

  for (const initiallyAccepted of [false, true]) {
    for (const recording of [false, true]) {
      it(`refreshes ${initiallyAccepted ? "accepted" : "refused"} origins after a parser-only reset with recording ${recording}`, () => {
        const filename = writeFile("src/start.js", consumer);
        const refusedProvider = provider.replace(
          "module.exports = openTerminal;",
          "module.exports = console.log;",
        );
        expect(refusedProvider).not.toBe(provider);
        const setProvider = (accepted: boolean): void => {
          writeFile("src/terminal.js", accepted ? provider : refusedProvider);
        };
        setProvider(initiallyAccepted);
        resetFilesystemCaches();
        const outcomes: boolean[] = [];
        const probe: Rule = {
          ...certificateProbe,
          create: (context) => ({
            CallExpression: (node) => {
              if (node.callee.type !== "Identifier" || node.callee.name !== "useTerminal") return;
              const inspect = (): void => {
                const evaluate = (): boolean => isImportedNodePortProcessUtility(node, context);
                outcomes.push(recording ? captureCrossFileProbes(evaluate).value : evaluate());
              };
              inspect();
              setProvider(!initiallyAccepted);
              resetParseSourceFileCache();
              inspect();
              setProvider(initiallyAccepted);
              resetParseSourceFileCache();
              inspect();
            },
          }),
        };
        const result = runRule(probe, consumer, { filename });
        expect(result.parseErrors).toEqual([]);
        expect(outcomes).toEqual([initiallyAccepted, !initiallyAccepted, initiallyAccepted]);
      });
    }
  }

  for (const resetKind of ["alias", "resolution"]) {
    for (const initiallyMapped of [false, true]) {
      it(`refreshes ${initiallyMapped ? "refused" : "accepted"} origins after a granular ${resetKind} reset`, () => {
        const filename = writeFile("src/start.js", consumer);
        writeFile("src/terminal.js", provider);
        const mappedFilename = path.join(temporaryDirectory, "src/mapped-files.js");
        const relocatedFilename = path.join(temporaryDirectory, "src/relocated-files.js");
        const setMapping = (enabled: boolean): void => {
          writeFile(
            "tsconfig.json",
            JSON.stringify({
              compilerOptions: {
                baseUrl: ".",
                paths: resetKind === "resolution" || enabled ? { fs: ["src/mapped-files.js"] } : {},
              },
            }),
          );
          if (resetKind === "alias" || enabled) {
            if (!fs.existsSync(mappedFilename))
              fs.writeFileSync(mappedFilename, "module.exports = {};\n");
          } else if (fs.existsSync(mappedFilename)) {
            fs.renameSync(mappedFilename, relocatedFilename);
          }
        };
        setMapping(initiallyMapped);
        resetFilesystemCaches();
        const outcomes: boolean[] = [];
        const probe: Rule = {
          ...certificateProbe,
          create: (context) => ({
            CallExpression: (node) => {
              if (node.callee.type !== "Identifier" || node.callee.name !== "useTerminal") return;
              outcomes.push(isImportedNodePortProcessUtility(node, context));
              setMapping(!initiallyMapped);
              if (resetKind === "alias") resetTsconfigAliasCaches();
              else resetModuleResolutionCaches();
              outcomes.push(isImportedNodePortProcessUtility(node, context));
              setMapping(initiallyMapped);
              if (resetKind === "alias") resetTsconfigAliasCaches();
              else resetModuleResolutionCaches();
              outcomes.push(isImportedNodePortProcessUtility(node, context));
            },
          }),
        };
        const result = runRule(probe, consumer, { filename });
        expect(result.parseErrors).toEqual([]);
        expect(outcomes).toEqual([!initiallyMapped, initiallyMapped, !initiallyMapped]);
      });
    }
  }

  it("does not resolve unrelated consumer modules after an ineligible manifest", () => {
    const filename = writeFile("src/start.js", consumer);
    writeFile("src/terminal.js", provider);
    writeFile("package.json", '{"dependencies":{"use-port":"file:./hook-provider"}}');
    const source = consumer + "const extra = require('./unrelated');";
    let exercised = false;
    const probe: Rule = {
      ...certificateProbe,
      create: (context) => ({
        CallExpression: (node) => {
          if (node.arguments.length !== 3) return;
          const captured = captureCrossFileProbes(() =>
            isImportedNodePortProcessUtility(node, context),
          );
          expect(captured.value).toBe(false);
          expect(
            captured.trace.contentPaths.has(path.join(temporaryDirectory, "package.json")),
          ).toBe(true);
          expect(
            [...captured.trace.existencePaths].some((candidate) => candidate.includes("unrelated")),
          ).toBe(false);
          exercised = true;
        },
      }),
    };
    const result = runRule(probe, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(exercised).toBe(true);
  });

  it("keeps finite argument and direct-call gates outside the symbol proof", () => {
    writeFile("src/terminal.js", provider);
    const source = consumer.replace(
      "console.log(address);",
      "await useTerminal(directory, command, '7123');await useTerminal(directory, command);await useTerminal(directory, command, 7123, 9);await useTerminal(directory, command, 7123);",
    );
    const result = runRule(certificateProbe, source, {
      filename: path.join(temporaryDirectory, "src/start.js"),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    const optional = runRule(certificateProbe, source + "useTerminal?.('.', [], 7123);", {
      filename: path.join(temporaryDirectory, "src/start.js"),
    });
    expect(optional.parseErrors).toEqual([]);
    expect(optional.diagnostics).toHaveLength(0);
  });
});
