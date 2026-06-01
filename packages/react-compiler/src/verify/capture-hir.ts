/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ---
 *
 * Shared frontend for the verifier: compile a source string with the React
 * Compiler and hand back the analyzed `HIRFunction`s captured at a chosen
 * pipeline stage. Both `verifySource` (which runs checks) and `extractHIR`
 * (which exposes the control-flow graph) are built on top of this so they
 * always observe the exact same HIR.
 */

import {transformFromAstSync} from '@babel/core';
import {parse as parseBabel} from '@babel/parser';
import BabelPluginReactCompiler, {
  type CompilerPipelineValue,
  type Logger,
  type PluginOptions,
  Effect,
  ValueKind,
  ValueReason,
  parseConfigPragmaForTests,
  printFunctionWithOutlined,
  printReactiveFunctionWithOutlined,
} from '../index';
import type {HIRFunction, ReactiveFunction} from '../HIR';
import {makeSharedRuntimeTypeProvider} from '../__tests__/runner/shared-runtime-type-provider';
import {printControlFlow} from './print-cfg';

/**
 * The `moduleTypeProvider` the snapshot test harness installs for every fixture
 * (`__tests__/runner/harness.ts`). The corpus `.expect.md` oracle was generated
 * with this provider, so IR dumps must honor it too — otherwise imports like
 * `graphql`/`useFragment`/`useNoAlias` from `shared-runtime` resolve to the
 * untyped fallback and the captured IR diverges from the real compiled output.
 */
function sharedRuntimeModuleTypeProvider(): unknown {
  return makeSharedRuntimeTypeProvider({
    EffectEnum: Effect,
    ValueKindEnum: ValueKind,
    ValueReasonEnum: ValueReason,
  });
}

/**
 * The pipeline stage the verifier analyzes by default. `InferTypes` is the
 * earliest stage with full type info, and it is logged *before* the compiler's
 * own validation passes (which may throw, e.g. on a Rules-of-Hooks violation),
 * so the HIR is always captured even when compilation later bails.
 */
export const DEFAULT_STAGE = 'InferTypes';

/**
 * The fixture's first-line `@key:value` pragma string, exactly as the snapshot
 * test harness reads it (`input.substring(0, input.indexOf('\n'))`). Returning
 * this to `parseConfigPragmaForTests` makes the captured HIR/reactive IR honor
 * the same `EnvironmentConfig` the `.expect.md` oracle was generated with — e.g.
 * `@enablePreserveExistingMemoizationGuarantees:false`. Without this the capture
 * always used the default config, so IR dumps for pragma-bearing fixtures did
 * not reflect the actual compiled output.
 */
function firstLinePragma(code: string): string {
  const newline = code.indexOf('\n');
  return newline === -1 ? code : code.substring(0, newline);
}

/**
 * Compile `code` and invoke `visit` for every `HIRFunction` (component, hook,
 * and nested function) logged at `stage`. Compilation failures after capture
 * are swallowed — callers rely only on what was captured beforehand.
 */
export function forEachAnalyzedFunction(
  code: string,
  filename: string,
  visit: (fn: HIRFunction) => void,
  stage: string = DEFAULT_STAGE,
): void {
  const ast = parseBabel(code, {
    sourceFilename: filename,
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const config = parseConfigPragmaForTests(firstLinePragma(code), {
    compilationMode: 'all',
  });
  const logger: Logger = {
    logEvent: () => {},
    debugLogIRs: (value: CompilerPipelineValue) => {
      if (value.kind === 'hir' && value.name === stage) {
        visit(value.value);
      }
    },
  };
  const pluginOptions: PluginOptions = {
    ...config,
    environment: {
      ...config.environment,
      moduleTypeProvider: sharedRuntimeModuleTypeProvider() as never,
    },
    logger,
  };

  try {
    transformFromAstSync(ast, code, {
      filename: `/${filename}`,
      plugins: [[BabelPluginReactCompiler, pluginOptions]],
      sourceType: 'module',
      configFile: false,
      babelrc: false,
      ast: false,
    });
  } catch {
    // See the stage doc above: the compiler may bail after the HIR is captured.
  }
}

/**
 * Like {@link forEachAnalyzedFunction} but for the *reactive* IR: invokes `visit`
 * for every `ReactiveFunction` logged at `stage` (a post-`BuildReactiveFunction`
 * stage name). Used to dump the byte-for-byte `.rfn` parity references the Rust
 * port's reactive-stage harness compares against.
 */
export function forEachAnalyzedReactiveFunction(
  code: string,
  filename: string,
  visit: (fn: ReactiveFunction) => void,
  stage: string,
): void {
  const ast = parseBabel(code, {
    sourceFilename: filename,
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });

  const config = parseConfigPragmaForTests(firstLinePragma(code), {
    compilationMode: 'all',
  });
  const logger: Logger = {
    logEvent: () => {},
    debugLogIRs: (value: CompilerPipelineValue) => {
      if (value.kind === 'reactive' && value.name === stage) {
        visit(value.value);
      }
    },
  };
  const pluginOptions: PluginOptions = {
    ...config,
    environment: {
      ...config.environment,
      moduleTypeProvider: sharedRuntimeModuleTypeProvider() as never,
    },
    logger,
  };

  try {
    transformFromAstSync(ast, code, {
      filename: `/${filename}`,
      plugins: [[BabelPluginReactCompiler, pluginOptions]],
      sourceType: 'module',
      configFile: false,
      babelrc: false,
      ast: false,
    });
  } catch {
    // The compiler may bail after the reactive IR is captured.
  }
}

export interface ExtractedFunction {
  /** The function's name, or null for anonymous functions. */
  name: string | null;
  /** Agent-friendly control-flow graph: blocks, labelled edges, source lines. */
  cfg: string;
  /** Human-readable HIR dump (blocks, instructions, terminals + outlined fns). */
  printed: string;
}

export interface ExtractHIROptions {
  filename?: string;
  /** Pipeline stage to capture at (defaults to `InferTypes`). */
  stage?: string;
}

/**
 * Extract the analyzed control-flow graph(s) from a React source string — the
 * same HIR the verifier checks run against. Returns one entry per compiled
 * function (component, hook, or nested function).
 *
 * The renderings are captured *at the chosen stage* (inside the pipeline
 * callback) because the compiler mutates the HIR in place on later passes — a
 * reference held until after compilation would no longer reflect `stage`.
 */
export function extractHIR(
  code: string,
  options: ExtractHIROptions = {},
): Array<ExtractedFunction> {
  const functions: Array<ExtractedFunction> = [];
  forEachAnalyzedFunction(
    code,
    options.filename ?? 'Component.tsx',
    (hir) => {
      functions.push({
        name: hir.id,
        cfg: printControlFlow(hir, code),
        printed: printFunctionWithOutlined(hir),
      });
    },
    options.stage ?? DEFAULT_STAGE,
  );
  return functions;
}

/** A reactive function captured at a reactive pipeline stage. */
export interface ExtractedReactiveFunction {
  /** The function's name, or null for anonymous functions. */
  name: string | null;
  /** `printReactiveFunctionWithOutlined` dump (the `.rfn` reference format). */
  printed: string;
}

/**
 * Extract the analyzed reactive function(s) from a React source string at a
 * reactive pipeline `stage`, rendered with `printReactiveFunctionWithOutlined`
 * (the exact `.rfn` reference format).
 */
export function extractReactive(
  code: string,
  stage: string,
  options: ExtractHIROptions = {},
): Array<ExtractedReactiveFunction> {
  const functions: Array<ExtractedReactiveFunction> = [];
  forEachAnalyzedReactiveFunction(
    code,
    options.filename ?? 'Component.tsx',
    (fn) => {
      functions.push({
        name: fn.id,
        printed: printReactiveFunctionWithOutlined(fn),
      });
    },
    stage,
  );
  return functions;
}
