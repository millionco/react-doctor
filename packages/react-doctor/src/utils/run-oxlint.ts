import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ERROR_PREVIEW_LENGTH_CHARS, JSX_FILE_PATTERN } from "../constants.js";
import { createOxlintConfig } from "../oxlint-config.js";
import type { CleanedDiagnostic, Diagnostic, Framework, OxlintOutput } from "../types.js";
import { neutralizeDisableDirectives } from "./neutralize-disable-directives.js";

const esmRequire = createRequire(import.meta.url);

const PLUGIN_CATEGORY_MAP: Record<string, string> = {
  react: "Correctness",
  "react-hooks": "Correctness",
  "react-hooks-js": "React Compiler",
  "react-perf": "Performance",
  "jsx-a11y": "Accessibility",
};

const RULE_CATEGORY_MAP: Record<string, string> = {
  "react-doctor/no-derived-state-effect": "State & Effects",
  "react-doctor/no-fetch-in-effect": "State & Effects",
  "react-doctor/no-cascading-set-state": "State & Effects",
  "react-doctor/no-effect-event-handler": "State & Effects",
  "react-doctor/no-derived-useState": "State & Effects",
  "react-doctor/prefer-useReducer": "State & Effects",
  "react-doctor/rerender-lazy-state-init": "Performance",
  "react-doctor/rerender-functional-setstate": "Performance",
  "react-doctor/rerender-dependencies": "State & Effects",

  "react-doctor/no-generic-handler-names": "Architecture",
  "react-doctor/no-giant-component": "Architecture",
  "react-doctor/no-render-in-render": "Architecture",
  "react-doctor/no-nested-component-definition": "Correctness",

  "react-doctor/no-usememo-simple-expression": "Performance",
  "react-doctor/no-layout-property-animation": "Performance",
  "react-doctor/rerender-memo-with-default-value": "Performance",
  "react-doctor/rendering-animate-svg-wrapper": "Performance",
  "react-doctor/rendering-usetransition-loading": "Performance",
  "react-doctor/rendering-hydration-no-flicker": "Performance",

  "react-doctor/no-transition-all": "Performance",
  "react-doctor/no-global-css-variable-animation": "Performance",
  "react-doctor/no-large-animated-blur": "Performance",
  "react-doctor/no-scale-from-zero": "Performance",
  "react-doctor/no-permanent-will-change": "Performance",

  "react-doctor/no-secrets-in-client-code": "Security",

  "react-doctor/no-barrel-import": "Bundle Size",
  "react-doctor/no-full-lodash-import": "Bundle Size",
  "react-doctor/no-moment": "Bundle Size",
  "react-doctor/prefer-dynamic-import": "Bundle Size",
  "react-doctor/use-lazy-motion": "Bundle Size",
  "react-doctor/no-undeferred-third-party": "Bundle Size",

  "react-doctor/no-array-index-as-key": "Correctness",
  "react-doctor/rendering-conditional-render": "Correctness",
  "react-doctor/no-prevent-default": "Correctness",
  "react-doctor/nextjs-no-img-element": "Next.js",
  "react-doctor/nextjs-async-client-component": "Next.js",
  "react-doctor/nextjs-no-a-element": "Next.js",
  "react-doctor/nextjs-no-use-search-params-without-suspense": "Next.js",
  "react-doctor/nextjs-no-client-fetch-for-server-data": "Next.js",
  "react-doctor/nextjs-missing-metadata": "Next.js",
  "react-doctor/nextjs-no-client-side-redirect": "Next.js",
  "react-doctor/nextjs-no-redirect-in-try-catch": "Next.js",
  "react-doctor/nextjs-image-missing-sizes": "Next.js",
  "react-doctor/nextjs-no-native-script": "Next.js",
  "react-doctor/nextjs-inline-script-missing-id": "Next.js",
  "react-doctor/nextjs-no-font-link": "Next.js",
  "react-doctor/nextjs-no-css-link": "Next.js",
  "react-doctor/nextjs-no-polyfill-script": "Next.js",
  "react-doctor/nextjs-no-head-import": "Next.js",
  "react-doctor/nextjs-no-side-effect-in-get-handler": "Security",

  "react-doctor/server-auth-actions": "Server",
  "react-doctor/server-after-nonblocking": "Server",

  "react-doctor/client-passive-event-listeners": "Performance",

  "react-doctor/async-parallel": "Performance",
};

const RULE_HELP_MAP: Record<string, string> = {
  "no-derived-state-effect":
    "For derived state, compute inline: `const x = fn(dep)`. For state resets on prop change, use a key prop: `<Component key={prop} />`",
  "no-fetch-in-effect":
    "Use `useQuery()` from @tanstack/react-query, `useSWR()`, or fetch in a Server Component instead",
  "no-cascading-set-state":
    "Combine into useReducer: `const [state, dispatch] = useReducer(reducer, initialState)`",
  "no-effect-event-handler":
    "Move the conditional logic into onClick, onChange, or onSubmit handlers directly",
  "no-derived-useState":
    "Remove useState and compute the value inline: `const value = transform(propName)`",
  "prefer-useReducer":
    "Group related state: `const [state, dispatch] = useReducer(reducer, { field1, field2, ... })`",
  "rerender-lazy-state-init":
    "Wrap in an arrow function so it only runs once: `useState(() => expensiveComputation())`",
  "rerender-functional-setstate":
    "Use the callback form: `setState(prev => prev + 1)` to always read the latest value",
  "rerender-dependencies":
    "Extract to a useMemo, useRef, or module-level constant so the reference is stable",

  "no-generic-handler-names":
    "Rename to describe the action: e.g. `handleSubmit` → `saveUserProfile`, `handleClick` → `toggleSidebar`",
  "no-giant-component":
    "Extract logical sections into focused components: `<UserHeader />`, `<UserActions />`, etc.",
  "no-render-in-render":
    "Extract to a named component: `const ListItem = ({ item }) => <div>{item.name}</div>`",
  "no-nested-component-definition":
    "Move to a separate file or to module scope above the parent component",

  "no-usememo-simple-expression":
    "Remove useMemo — property access, math, and ternaries are already cheap without memoization",
  "no-layout-property-animation":
    "Use `transform: translateX()` or `scale()` instead — they run on the compositor and skip layout/paint",
  "rerender-memo-with-default-value":
    "Move to module scope: `const EMPTY_ITEMS: Item[] = []` then use as the default value",
  "rendering-animate-svg-wrapper":
    "Wrap the SVG: `<motion.div animate={...}><svg>...</svg></motion.div>`",
  "rendering-usetransition-loading":
    "Replace with `const [isPending, startTransition] = useTransition()` — avoids a re-render for the loading state",
  "rendering-hydration-no-flicker":
    "Use `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` or add `suppressHydrationWarning` to the element",

  "no-transition-all":
    'List specific properties: `transition: "opacity 200ms, transform 200ms"` — or in Tailwind use `transition-colors`, `transition-opacity`, or `transition-transform`',
  "no-global-css-variable-animation":
    "Set the variable on the nearest element instead of a parent, or use `@property` with `inherits: false` to prevent cascade. Better yet, use targeted `element.style.transform` updates",
  "no-large-animated-blur":
    "Keep blur radius under 10px, or apply blur to a smaller element. Large blurs multiply GPU memory usage with layer size",
  "no-scale-from-zero":
    "Use `initial={{ scale: 0.95, opacity: 0 }}` — elements should deflate like a balloon, not vanish into a point",
  "no-permanent-will-change":
    "Add will-change on animation start (`onMouseEnter`) and remove on end (`onAnimationEnd`). Permanent promotion wastes GPU memory and can degrade performance",

  "no-secrets-in-client-code":
    "Move to server-side `process.env.SECRET_NAME`. Only `NEXT_PUBLIC_*` vars are safe for the client (and should not contain secrets)",

  "no-barrel-import":
    "Import from the direct path: `import { Button } from './components/Button'` instead of `./components`",
  "no-full-lodash-import":
    "Import the specific function: `import debounce from 'lodash/debounce'` — saves ~70kb",
  "no-moment":
    "Replace with `import { format } from 'date-fns'` (tree-shakeable) or `import dayjs from 'dayjs'` (2kb)",
  "prefer-dynamic-import":
    "Use `const Component = dynamic(() => import('library'), { ssr: false })` from next/dynamic or React.lazy()",
  "use-lazy-motion":
    'Use `import { LazyMotion, m } from "framer-motion"` with `domAnimation` features — saves ~30kb',
  "no-undeferred-third-party":
    'Use `next/script` with `strategy="lazyOnload"` or add the `defer` attribute',

  "no-array-index-as-key":
    "Use a stable unique identifier: `key={item.id}` or `key={item.slug}` — index keys break on reorder/filter",
  "rendering-conditional-render":
    "Change to `{items.length > 0 && <List />}` or use a ternary: `{items.length ? <List /> : null}`",
  "no-prevent-default":
    "Use `<form action={serverAction}>` (works without JS) or `<button>` instead of `<a>` with preventDefault",

  "nextjs-no-img-element":
    "`import Image from 'next/image'` — provides automatic WebP/AVIF, lazy loading, and responsive srcset",
  "nextjs-async-client-component":
    "Fetch data in a parent Server Component and pass it as props, or use useQuery/useSWR in the client component",
  "nextjs-no-a-element":
    "`import Link from 'next/link'` — enables client-side navigation, prefetching, and preserves scroll position",
  "nextjs-no-use-search-params-without-suspense":
    "Wrap the component using useSearchParams: `<Suspense fallback={<Skeleton />}><SearchComponent /></Suspense>`",
  "nextjs-no-client-fetch-for-server-data":
    "Remove 'use client' and fetch directly in the Server Component — no API round-trip, secrets stay on server",
  "nextjs-missing-metadata":
    "Add `export const metadata = { title: '...', description: '...' }` or `export async function generateMetadata()`",
  "nextjs-no-client-side-redirect":
    "Use `redirect('/path')` from 'next/navigation' in a Server Component, or handle in middleware",
  "nextjs-no-redirect-in-try-catch":
    "Move the redirect/notFound call outside the try block, or add `unstable_rethrow(error)` in the catch",
  "nextjs-image-missing-sizes":
    'Add sizes for responsive behavior: `sizes="(max-width: 768px) 100vw, 50vw"` matching your layout breakpoints',
  "nextjs-no-native-script":
    '`import Script from "next/script"` — use `strategy="afterInteractive"` for analytics or `"lazyOnload"` for widgets',
  "nextjs-inline-script-missing-id":
    'Add `id="descriptive-name"` so Next.js can track, deduplicate, and re-execute the script correctly',
  "nextjs-no-font-link":
    '`import { Inter } from "next/font/google"` — self-hosted, zero layout shift, no render-blocking requests',
  "nextjs-no-css-link":
    "Import CSS directly: `import './styles.css'` or use CSS Modules: `import styles from './Button.module.css'`",
  "nextjs-no-polyfill-script":
    "Next.js includes polyfills for fetch, Promise, Object.assign, Array.from, and 50+ others automatically",
  "nextjs-no-head-import":
    "Use the Metadata API instead: `export const metadata = { title: '...' }` or `export async function generateMetadata()`",
  "nextjs-no-side-effect-in-get-handler":
    "Move the side effect to a POST handler and use a <form> or fetch with method POST — GET requests can be triggered by prefetching and are vulnerable to CSRF",

  "server-auth-actions":
    "Add `const session = await auth()` at the top and throw/redirect if unauthorized before any data access",
  "server-after-nonblocking":
    "`import { after } from 'next/server'` then wrap: `after(() => analytics.track(...))` — response isn't blocked",

  "client-passive-event-listeners":
    "Add `{ passive: true }` as the third argument: `addEventListener('scroll', handler, { passive: true })`",

  "async-parallel":
    "Use `const [a, b] = await Promise.all([fetchA(), fetchB()])` to run independent operations concurrently",
};

const FILEPATH_WITH_LOCATION_PATTERN = /\S+\.\w+:\d+:\d+[\s\S]*$/;

const REACT_COMPILER_MESSAGE = "React Compiler can't optimize this code";

const cleanDiagnosticMessage = (
  message: string,
  help: string,
  plugin: string,
  rule: string,
): CleanedDiagnostic => {
  if (plugin === "react-hooks-js") {
    const rawMessage = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
    return { message: REACT_COMPILER_MESSAGE, help: rawMessage || help };
  }
  const cleaned = message.replace(FILEPATH_WITH_LOCATION_PATTERN, "").trim();
  return { message: cleaned || message, help: help || RULE_HELP_MAP[rule] || "" };
};

const parseRuleCode = (code: string): { plugin: string; rule: string } => {
  const match = code.match(/^(.+)\((.+)\)$/);
  if (!match) return { plugin: "unknown", rule: code };
  return { plugin: match[1].replace(/^eslint-plugin-/, ""), rule: match[2] };
};

const resolveOxlintBinary = (): string => {
  const oxlintMainPath = esmRequire.resolve("oxlint");
  const oxlintPackageDirectory = path.resolve(path.dirname(oxlintMainPath), "..");
  return path.join(oxlintPackageDirectory, "bin", "oxlint");
};

const resolvePluginPath = (): string => {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const pluginPath = path.join(currentDirectory, "react-doctor-plugin.js");
  if (fs.existsSync(pluginPath)) return pluginPath;

  const distPluginPath = path.resolve(currentDirectory, "../../dist/react-doctor-plugin.js");
  if (fs.existsSync(distPluginPath)) return distPluginPath;

  return pluginPath;
};

const resolveDiagnosticCategory = (plugin: string, rule: string): string => {
  const ruleKey = `${plugin}/${rule}`;
  return RULE_CATEGORY_MAP[ruleKey] ?? PLUGIN_CATEGORY_MAP[plugin] ?? "Other";
};

export const runOxlint = async (
  rootDirectory: string,
  hasTypeScript: boolean,
  framework: Framework,
  hasReactCompiler: boolean,
  includePaths?: string[],
): Promise<Diagnostic[]> => {
  if (includePaths !== undefined && includePaths.length === 0) {
    return [];
  }

  const configPath = path.join(os.tmpdir(), `react-doctor-oxlintrc-${process.pid}.json`);
  const pluginPath = resolvePluginPath();
  const config = createOxlintConfig({ pluginPath, framework, hasReactCompiler });
  const restoreDisableDirectives = neutralizeDisableDirectives(rootDirectory);

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    const oxlintBinary = resolveOxlintBinary();
    const args = [oxlintBinary, "-c", configPath, "--format", "json"];

    if (hasTypeScript) {
      args.push("--tsconfig", "./tsconfig.json");
    }

    if (includePaths !== undefined) {
      args.push(...includePaths);
    } else {
      args.push(".");
    }

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: rootDirectory,
      });

      const stdoutBuffers: Buffer[] = [];
      const stderrBuffers: Buffer[] = [];

      child.stdout.on("data", (buffer: Buffer) => stdoutBuffers.push(buffer));
      child.stderr.on("data", (buffer: Buffer) => stderrBuffers.push(buffer));

      child.on("error", (error) => reject(new Error(`Failed to run oxlint: ${error.message}`)));
      child.on("close", () => {
        const output = Buffer.concat(stdoutBuffers).toString("utf-8").trim();
        if (!output) {
          const stderrOutput = Buffer.concat(stderrBuffers).toString("utf-8").trim();
          if (stderrOutput) {
            reject(new Error(`Failed to run oxlint: ${stderrOutput}`));
            return;
          }
        }
        resolve(output);
      });
    });

    if (!stdout) {
      return [];
    }

    let output: OxlintOutput;
    try {
      output = JSON.parse(stdout) as OxlintOutput;
    } catch {
      throw new Error(
        `Failed to parse oxlint output: ${stdout.slice(0, ERROR_PREVIEW_LENGTH_CHARS)}`,
      );
    }

    return output.diagnostics
      .filter((diagnostic) => diagnostic.code && JSX_FILE_PATTERN.test(diagnostic.filename))
      .map((diagnostic) => {
        const { plugin, rule } = parseRuleCode(diagnostic.code);
        const primaryLabel = diagnostic.labels[0];

        const cleaned = cleanDiagnosticMessage(diagnostic.message, diagnostic.help, plugin, rule);

        return {
          filePath: diagnostic.filename,
          plugin,
          rule,
          severity: diagnostic.severity,
          message: cleaned.message,
          help: cleaned.help,
          line: primaryLabel?.span.line ?? 0,
          column: primaryLabel?.span.column ?? 0,
          category: resolveDiagnosticCategory(plugin, rule),
        };
      });
  } finally {
    restoreDisableDirectives();
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  }
};
