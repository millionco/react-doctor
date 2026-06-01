/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Compile-only port of facebook/react's `snap` fixture runner
 * (compiler/packages/snap/src/{compiler,reporter,fixture-utils}.ts).
 *
 * This reproduces the exact `.expect.md` snapshot bytes that `snap`
 * produces when run WITHOUT the evaluator (`includeEvaluator = false`):
 * the compiler output + logs + errors are regenerated, and the
 * `### Eval output` section (if any) is reused verbatim from the stored
 * snapshot — matching snap's behaviour at runner-worker.ts:219-221.
 */

import {transformFromAstSync, type PluginItem, type PluginObj} from '@babel/core';
import * as BabelParser from '@babel/parser';
import type * as t from '@babel/types';
import * as HermesParser from 'hermes-parser';
import invariant from 'invariant';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as prettier from 'prettier';
import {makeSharedRuntimeTypeProvider} from './shared-runtime-type-provider';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Load the built compiler (CJS) so behaviour matches how the snapshots
// were generated: the production bundle has `__DEV__` undefined.
const DIST_ENTRY = path.resolve(HERE, '..', '..', '..', 'dist', 'index.js');

interface CompilerModule {
  default: PluginObj;
  parseConfigPragmaForTests: (firstLine: string, defaults: {compilationMode: string}) => any;
  Effect: any;
  ValueKind: any;
  ValueReason: any;
}

let cachedCompiler: CompilerModule | null = null;
export const loadCompiler = (): CompilerModule => {
  if (cachedCompiler == null) {
    if (!fs.existsSync(DIST_ENTRY)) {
      throw new Error(
        `Built compiler not found at ${DIST_ENTRY}. Run \`pnpm --filter babel-plugin-react-compiler build\` first.`,
      );
    }
    cachedCompiler = require(DIST_ENTRY) as CompilerModule;
  }
  return cachedCompiler;
};

const INPUT_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts', '.jsx', '.tsx'];
const SNAPSHOT_EXTENSION = '.expect.md';
const SPROUT_SEPARATOR = '\n### Eval output\n';

export const FIXTURES_PATH = path.resolve(HERE, '..', 'fixtures', 'compiler');

const parseLanguage = (source: string): 'flow' | 'typescript' =>
  source.indexOf('@flow') !== -1 ? 'flow' : 'typescript';

const parseSourceType = (source: string): 'script' | 'module' =>
  source.indexOf('@script') !== -1 ? 'script' : 'module';

// Snapshots are authored with LF; on Windows the files are checked out with
// CRLF (core.autocrlf), but the compiler/prettier output always uses LF — so
// normalize on read to keep the comparison platform-independent.
const normalizeLineEndings = (contents: string): string => contents.replace(/\r\n/g, '\n');

// The fixture filename is a posix-style virtual path (`/foo.ts`). On Windows
// that is NOT absolute, so babel's `path.resolve` drive-qualifies it to
// `D:\foo.ts`, which then leaks into emitted instrumentation calls and error
// prefixes. Map the resolved path back to the virtual path so snapshots match
// on every platform. No-op on posix where `path.resolve` is identity here.
const normalizeResolvedFixturePath = (text: string, virtualFilepath: string): string => {
  const resolved = path.resolve(virtualFilepath);
  if (resolved === virtualFilepath) {
    return text;
  }
  return text
    .split(resolved.replace(/\\/g, '\\\\'))
    .join(virtualFilepath)
    .split(resolved)
    .join(virtualFilepath);
};

const stripExtension = (filename: string, extensions: Array<string>): string => {
  for (const ext of extensions) {
    if (filename.endsWith(ext)) {
      return filename.slice(0, -ext.length);
    }
  }
  return filename;
};

export const isExpectError = (basename: string): boolean =>
  basename.startsWith('error.') || basename.startsWith('todo.error');

const parseInput = (
  input: string,
  filename: string,
  language: 'flow' | 'typescript',
  sourceType: 'module' | 'script',
): t.File => {
  if (language === 'flow') {
    return HermesParser.parse(input, {
      babel: true,
      flow: 'all',
      sourceFilename: filename,
      sourceType,
      enableExperimentalComponentSyntax: true,
    }) as unknown as t.File;
  }
  return BabelParser.parse(input, {
    sourceFilename: filename,
    plugins: ['typescript', 'jsx'],
    sourceType,
  });
};

const format = (inputCode: string, language: 'typescript' | 'flow'): Promise<string> =>
  prettier.format(inputCode, {
    semi: true,
    parser: language === 'typescript' ? 'babel-ts' : 'flow',
  });

const FORGET_PLUGINS = (plugin: PluginObj, options: unknown): Array<PluginItem> => [
  [plugin, options],
  'babel-plugin-fbt',
  'babel-plugin-fbt-runtime',
  'babel-plugin-idx',
];

interface CompileResult {
  forgetOutput: string;
  logs: string | null;
}

type CompileOutcome =
  | {kind: 'ok'; value: CompileResult}
  | {kind: 'err'; msg: string};

const transformFixtureInput = (input: string, basename: string): CompileOutcome => {
  const compiler = loadCompiler();
  const firstLine = input.substring(0, input.indexOf('\n'));
  const language = parseLanguage(firstLine);
  const sourceType = parseSourceType(firstLine);
  const filename = basename + (language === 'typescript' ? '.ts' : '');
  const inputAst = parseInput(input, filename, language, sourceType);
  const virtualFilepath = '/' + filename;

  const validatePreserveExistingMemoizationGuarantees = firstLine.includes(
    '@validatePreserveExistingMemoizationGuarantees',
  );
  const loggerTestOnly = firstLine.includes('@loggerTestOnly');
  const logs: Array<{filename: string | null; event: any}> = [];
  const logger = {
    logEvent: (logFilename: string | null, event: any) => {
      logs.push({filename: logFilename, event});
    },
    debugLogIRs: () => {},
  };

  const config = compiler.parseConfigPragmaForTests(firstLine, {compilationMode: 'all'});
  const options = {
    ...config,
    environment: {
      ...config.environment,
      moduleTypeProvider: makeSharedRuntimeTypeProvider({
        EffectEnum: compiler.Effect,
        ValueKindEnum: compiler.ValueKind,
        ValueReasonEnum: compiler.ValueReason,
      }),
      assertValidMutableRanges: true,
      validatePreserveExistingMemoizationGuarantees,
    },
    logger,
    enableReanimatedCheck: false,
    target: '19',
  };

  const forgetResult = transformFromAstSync(inputAst, input, {
    filename: virtualFilepath,
    highlightCode: false,
    retainLines: true,
    compact: true,
    plugins: FORGET_PLUGINS(compiler.default, options),
    sourceType: 'module',
    ast: false,
    cloneInputAst: true,
    configFile: false,
    babelrc: false,
  });
  invariant(
    forgetResult?.code != null,
    'Expected BabelPluginReactForget to codegen successfully.',
  );
  const forgetCode = forgetResult.code;

  let formattedLogs: string | null = null;
  if (loggerTestOnly && logs.length !== 0) {
    formattedLogs = logs
      .map(({event}) =>
        JSON.stringify(event, (key, value) => {
          if (key === 'detail' && value != null && typeof value.serialize === 'function') {
            return value.serialize();
          }
          return value;
        }),
      )
      .join('\n');
  }

  const expectNothingCompiled = firstLine.indexOf('@expectNothingCompiled') !== -1;
  const successFailures = logs.filter(
    log => log.event.kind === 'CompileSuccess' || log.event.kind === 'CompileError',
  );
  if (successFailures.length === 0 && !expectNothingCompiled) {
    return {
      kind: 'err',
      msg: 'No success/failure events, add `// @expectNothingCompiled` to the first line if this is expected',
    };
  } else if (successFailures.length !== 0 && expectNothingCompiled) {
    return {
      kind: 'err',
      msg: 'Expected nothing to be compiled (from `// @expectNothingCompiled`), but some functions compiled or errored',
    };
  }
  const unexpectedThrows = logs.filter(log => log.event.kind === 'CompileUnexpectedThrow');
  if (unexpectedThrows.length > 0) {
    return {
      kind: 'err',
      msg:
        `Compiler pass(es) threw instead of recording errors:\n` +
        unexpectedThrows.map(l => l.event.data).join('\n'),
    };
  }
  return {
    kind: 'ok',
    value: {forgetOutput: forgetCode, logs: formattedLogs},
  };
};

const wrapWithTripleBackticks = (s: string, ext: string | null = null): string =>
  `\`\`\`${ext ?? ''}
${s}
\`\`\``;

const writeOutputToString = (
  input: string,
  compilerOutput: string | null,
  evaluatorOutput: string | null,
  logs: string | null,
  errorMessage: string | null,
): string => {
  // leading newline intentional
  let result = `
## Input

${wrapWithTripleBackticks(input, 'javascript')}
`;

  if (compilerOutput != null) {
    result += `
## Code

${wrapWithTripleBackticks(compilerOutput, 'javascript')}
`;
  } else {
    result += '\n';
  }

  if (logs != null) {
    result += `
## Logs

${wrapWithTripleBackticks(logs, null)}
`;
  }

  if (errorMessage != null) {
    result += `
## Error

${wrapWithTripleBackticks(errorMessage.replace(/^\/.*?:\s/, ''))}
          \n`;
  }
  result += `      `;
  if (evaluatorOutput != null) {
    result += SPROUT_SEPARATOR + evaluatorOutput;
  }
  return result;
};

export interface FixtureRun {
  basename: string;
  actual: string;
  expected: string | null;
  unexpectedError: string | null;
}

const compileFixture = (
  input: string,
  basename: string,
): {error: string | null; compileResult: CompileResult | null} => {
  const seenConsoleErrors: Array<string> = [];
  const originalConsoleError = console.error;
  console.error = (...messages: Array<string>) => {
    seenConsoleErrors.push(...messages);
  };
  let compileResult: CompileResult | null = null;
  let error: string | null = null;
  try {
    const result = transformFixtureInput(input, basename);
    if (result.kind === 'err') {
      error = result.msg;
    } else {
      compileResult = result.value;
    }
  } catch (e: any) {
    error = String(e?.message ?? e).replace(/\u001b[^m]*m/g, '');
  }
  for (const consoleError of seenConsoleErrors) {
    error = error != null ? `${error}\n\n${consoleError}` : `ConsoleError: ${consoleError}`;
  }
  console.error = originalConsoleError;
  return {error, compileResult};
};

/**
 * Run a single fixture and produce the actual `.expect.md` contents,
 * reusing the stored snapshot's `### Eval output` section verbatim.
 */
export const runFixture = async (
  basename: string,
  input: string,
  expected: string | null,
): Promise<FixtureRun> => {
  const expectError = isExpectError(basename);
  const language = parseLanguage(input.substring(0, input.indexOf('\n')));
  const virtualFilepath = '/' + basename + (language === 'typescript' ? '.ts' : '');
  const {compileResult, error: rawError} = compileFixture(input, basename);
  const error =
    rawError != null ? normalizeResolvedFixturePath(rawError, virtualFilepath) : null;

  let unexpectedError: string | null = null;
  if (expectError) {
    if (error === null) {
      unexpectedError = `Expected an error to be thrown for fixture: \`${basename}\`, remove the 'error.' prefix if an error is not expected.`;
    }
  } else if (error !== null) {
    unexpectedError = `Expected fixture \`${basename}\` to succeed but it failed with error:\n\n${error}`;
  } else if (compileResult == null) {
    unexpectedError = `Expected output for fixture \`${basename}\`.`;
  }

  let snapOutput: string | null = null;
  if (compileResult?.forgetOutput != null) {
    try {
      snapOutput = await format(compileResult.forgetOutput, language);
    } catch (e: any) {
      unexpectedError ??= '';
      unexpectedError += `\n\nprettier failed to format compiler output: ${e?.message ?? e}`;
      snapOutput = compileResult.forgetOutput;
    }
    snapOutput = normalizeResolvedFixturePath(snapOutput, virtualFilepath);
  }

  // includeEvaluator = false: reuse the stored eval output, if any.
  const sproutOutput =
    expected != null ? (expected.split(SPROUT_SEPARATOR)[1] ?? null) : null;

  const actual = writeOutputToString(
    input,
    snapOutput,
    sproutOutput,
    compileResult?.logs ?? null,
    error,
  );

  return {basename, actual, expected, unexpectedError};
};

export interface Fixture {
  basename: string;
  inputPath: string;
  input: string;
  snapshotPath: string;
  expected: string | null;
}

const walk = (dir: string, out: Array<string>): void => {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
};

/**
 * Discover all fixtures, keyed by their path relative to FIXTURES_PATH
 * with the extension stripped (matching snap's fixture identity).
 */
export const getFixtures = (): Array<Fixture> => {
  const allFiles: Array<string> = [];
  walk(FIXTURES_PATH, allFiles);

  const inputs = new Map<string, string>();
  const snapshots = new Map<string, string>();
  for (const absPath of allFiles) {
    const rel = path.relative(FIXTURES_PATH, absPath);
    if (rel.endsWith(SNAPSHOT_EXTENSION)) {
      snapshots.set(stripExtension(rel, [SNAPSHOT_EXTENSION]), absPath);
    } else if (INPUT_EXTENSIONS.some(ext => rel.endsWith(ext))) {
      inputs.set(stripExtension(rel, INPUT_EXTENSIONS), absPath);
    }
  }

  const fixtures: Array<Fixture> = [];
  for (const [key, inputPath] of inputs) {
    const snapshotPath = snapshots.get(key) ?? path.join(FIXTURES_PATH, key + SNAPSHOT_EXTENSION);
    fixtures.push({
      basename: path.basename(key),
      inputPath,
      input: normalizeLineEndings(fs.readFileSync(inputPath, 'utf8')),
      snapshotPath,
      expected: snapshots.has(key)
        ? normalizeLineEndings(fs.readFileSync(snapshots.get(key)!, 'utf8'))
        : null,
    });
  }
  fixtures.sort((a, b) => a.inputPath.localeCompare(b.inputPath));
  return fixtures;
};
