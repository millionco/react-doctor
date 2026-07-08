import type { FrameworkToken } from "oxlint-plugin-react-doctor";

// Aliased to the plugin's capability vocabulary: `buildCapabilities` emits
// `project.framework` as a capability token, so the two unions must be one.
export type Framework = FrameworkToken;

export interface ProjectInfo {
  rootDirectory: string;
  projectName: string;
  reactVersion: string | null;
  reactMajorVersion: number | null;
  tailwindVersion: string | null;
  zodVersion: string | null;
  /** Parsed major from `zodVersion`, or `null` when absent/unparseable. Mirrors `reactMajorVersion`. */
  zodMajorVersion: number | null;
  framework: Framework;
  hasTypeScript: boolean;
  hasReactCompiler: boolean;
  hasTanStackQuery: boolean;
  /**
   * The declared `preact` version spec, or `null` when Preact isn't a
   * dependency. Parallels `reactVersion` so a React-compatible runtime is
   * modeled the same way React is. Drives the `preact` capability in
   * `buildCapabilities` (which gates every `preact-*` rule) — keyed off
   * this rather than `framework` because the dominant Preact setup
   * (Preact-on-Vite) classifies as `framework: "vite"` but still needs
   * Preact rules to fire.
   */
  preactVersion: string | null;
  /** Parsed major from `preactVersion`, or `null` when absent/unparseable. Mirrors `reactMajorVersion`. */
  preactMajorVersion: number | null;
  /**
   * `true` when the project (or any of its workspace packages) declares
   * React Native or Expo as a dependency. Enables the `react-native`
   * capability — and therefore every `rn-*` rule — even on web-rooted
   * monorepos where the entry-point `package.json` is Next / Vite /
   * Remix but a sibling workspace (`apps/mobile`, `packages/native-ui`)
   * targets React Native. The file-level package-boundary check in
   * `oxlint-plugin-react-doctor` still keeps the rules silent on the
   * web workspaces.
   *
   * `false` collapses the gate to the legacy "framework is RN" behavior
   * — no `rn-*` rules load for the project at all.
   */
  hasReactNativeWorkspace: boolean;
  nextjsVersion: string | null;
  nextjsMajorVersion: number | null;
  /**
   * The declared `expo` package version spec (e.g. `"~51.0.0"`), looked up
   * in the project or any of its workspace packages, or `null` when `expo`
   * isn't a dependency. Doubles as react-doctor's "is this an Expo project?"
   * signal (`expoVersion !== null`) and its SDK-version source — the `expo`
   * major tracks the Expo SDK release one-to-one — paralleling how
   * `reactVersion` models the React runtime.
   *
   * Keyed off the dependency rather than `framework === "expo"` because
   * `detectFramework` returns the first matching package, so a project
   * declaring both `expo` and a web bundler (`vite` / `next`) classifies as
   * the web framework yet is still an Expo project. Drives the `expo`
   * capability in `buildCapabilities` (which gates every Expo-specific
   * rule) and the ported expo-doctor checks.
   */
  expoVersion: string | null;
  /**
   * The declared `@shopify/flash-list` package version spec, or `null` when
   * absent. FlashList v2 removed the need for `estimatedItemSize`, so this
   * lets the RN list sizing rule stay scoped to versions where the prop is
   * still useful.
   */
  shopifyFlashListVersion: string | null;
  /** Parsed major from `shopifyFlashListVersion`, or `null` when absent/unparseable. */
  shopifyFlashListMajorVersion: number | null;
  /**
   * `true` when the project (or any of its workspace packages) declares
   * `react-native-reanimated`. Lets diagnostics surface reanimated's
   * Compiler-compatible `.get()` / `.set()` accessors only where they
   * apply, instead of on every React Native project.
   */
  hasReanimated: boolean;
  /**
   * The declared `react-native-reanimated` version spec, or `null` when
   * absent. The Compiler-compatible `.get()` / `.set()` accessors only
   * exist from reanimated 3.15.0, so the shared-value hint must not
   * recommend them to projects pinned below that.
   */
  reanimatedVersion: string | null;
  /**
   * `true` when the project's `tsconfig.json` `compilerOptions.target` or
   * `compilerOptions.lib` indicates the output environment predates ES2023
   * (e.g. `target: "es2022"` or `lib: ["es2022"]`). Drives the `pre-es2023`
   * capability in `buildCapabilities` so rules recommending ES2023-only
   * methods (`toSorted`, `toReversed`, `toSpliced`, `with`, etc.) are
   * silenced on projects that would get a type error or runtime crash.
   * `false` when no tsconfig is found, when the target is ES2023+, or when
   * the config is unparseable — the safe default is to keep the rule active.
   */
  isPreES2023Target: boolean;
  /**
   * `true` when a Next.js project sets `output: "export"` in `next.config.*`
   * (static HTML export — no request-time server). Drives the
   * `nextjs:static-export` capability and excludes the project from
   * `server-actions`, so rules stop recommending server-only fixes (server
   * `redirect()`, middleware, Server Actions) that don't exist under a static
   * export. `false` for non-Next projects, when no config sets it, or when the
   * config is unparseable — the safe default keeps server-aware advice active.
   */
  isStaticExport: boolean;
  sourceFileCount: number;
}

export interface PackageJson {
  name?: string;
  version?: string;
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /**
   * npm's dependency-pin map. Keys are package names; values are version
   * strings or nested override objects, hence `unknown`. The Expo checks
   * only read the top-level keys to flag pins on SDK-critical packages.
   */
  overrides?: Record<string, unknown>;
  /** Yarn / pnpm equivalent of npm `overrides`. */
  resolutions?: Record<string, string>;
  /** pnpm's settings block; `pnpm.overrides` mirrors npm `overrides`. */
  pnpm?: { overrides?: Record<string, string> };
  workspaces?:
    | string[]
    | {
        packages?: string[];
        catalog?: Record<string, string>;
        catalogs?: Record<string, Record<string, string>>;
      };
  catalog?: unknown;
  catalogs?: unknown;
}

export interface DependencyInfo {
  reactVersion: string | null;
  tailwindVersion: string | null;
  zodVersion: string | null;
  framework: Framework;
}

export interface WorkspacePackage {
  name: string;
  directory: string;
}
