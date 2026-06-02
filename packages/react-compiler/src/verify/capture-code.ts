/**
 * Dev helper: print the React Compiler's raw `result.code` for a fixture, using
 * the SAME config + module-type provider as the snapshot test harness
 * (`__tests__/runner/harness.ts`) and `capture-hir.ts`. This is the exact
 * `result.code` byte stream the `tests/fixtures/hir/<name>.code` parity refs
 * store (babel-generator output, pre-prettier).
 *
 * Usage: npx --no-install tsx src/verify/capture-code.ts <file>
 */

import {transformFromAstSync} from '@babel/core';
import {parse as parseBabel} from '@babel/parser';
import * as HermesParser from 'hermes-parser';
import type * as t from '@babel/types';
import * as fs from 'fs';
import BabelPluginReactCompiler, {
  type PluginOptions,
  Effect,
  ValueKind,
  ValueReason,
  parseConfigPragmaForTests,
} from '../index';
import {makeSharedRuntimeTypeProvider} from '../__tests__/runner/shared-runtime-type-provider';

function firstLinePragma(code: string): string {
  const newline = code.indexOf('\n');
  return newline === -1 ? code : code.substring(0, newline);
}

// Mirror the snapshot harness's parser selection EXACTLY
// (`__tests__/runner/harness.ts:65-69,105-125`) so this compiler-only oracle is
// faithful: a `@flow` file (the pragma anywhere in source) is parsed with
// HermesParser (which, like the harness, does NOT retain comments — so a leading
// `// @flow` / interior docblock is dropped, just as the React Compiler's real
// flow-file output is), and a `@script` file uses `sourceType: 'script'`. Without
// this, `@flow` fixtures kept their comments only because `@babel/parser` retains
// them — a capture-tool artifact, not a compiler difference.
const parseLanguage = (source: string): 'flow' | 'typescript' =>
  source.indexOf('@flow') !== -1 ? 'flow' : 'typescript';

const parseSourceType = (source: string): 'script' | 'module' =>
  source.indexOf('@script') !== -1 ? 'script' : 'module';

function parseInput(
  input: string,
  filename: string,
  language: 'flow' | 'typescript',
  sourceType: 'module' | 'script',
): t.File {
  if (language === 'flow') {
    return HermesParser.parse(input, {
      babel: true,
      flow: 'all',
      sourceFilename: filename,
      sourceType,
      enableExperimentalComponentSyntax: true,
    }) as unknown as t.File;
  }
  return parseBabel(input, {
    sourceFilename: filename,
    plugins: ['typescript', 'jsx'],
    sourceType,
  }) as unknown as t.File;
}

function main(): void {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: capture-code.ts <file>\n');
    process.exit(1);
  }
  const code = fs.readFileSync(file, 'utf8');
  const filename = file.split('/').pop() ?? 'Component.tsx';

  const language = parseLanguage(code);
  const sourceType = parseSourceType(code);
  const ast = parseInput(code, filename, language, sourceType);

  const firstLine = firstLinePragma(code);
  const config = parseConfigPragmaForTests(firstLine, {
    compilationMode: 'all',
  });
  // Mirror the snapshot harness's plugin-option construction exactly
  // (`__tests__/runner/harness.ts:158-186`) so this is a faithful COMPILER-ONLY
  // oracle (the same React Compiler config the `.expect.md` was produced under,
  // just without the chained babel-plugin-fbt/idx and without prettier). Most
  // notably `validatePreserveExistingMemoizationGuarantees` is derived from the
  // first-line pragma (the schema default is `true`, which would spuriously throw
  // on fixtures whose `.expect.md` compiled with it disabled, e.g.
  // `existing-variables-with-c-name`).
  const validatePreserveExistingMemoizationGuarantees = firstLine.includes(
    '@validatePreserveExistingMemoizationGuarantees',
  );
  const pluginOptions: PluginOptions = {
    ...config,
    environment: {
      ...config.environment,
      moduleTypeProvider: makeSharedRuntimeTypeProvider({
        EffectEnum: Effect,
        ValueKindEnum: ValueKind,
        ValueReasonEnum: ValueReason,
      }) as never,
      assertValidMutableRanges: true,
      validatePreserveExistingMemoizationGuarantees,
    },
    logger: {logEvent: () => {}, debugLogIRs: () => {}},
    enableReanimatedCheck: false,
    target: '19',
  } as never;

  const result = transformFromAstSync(ast, code, {
    filename: `/${filename}`,
    plugins: [[BabelPluginReactCompiler, pluginOptions]],
    sourceType: 'module',
    configFile: false,
    babelrc: false,
    ast: false,
  });

  process.stdout.write(result?.code ?? '');
  process.stdout.write('\n');
}

main();
