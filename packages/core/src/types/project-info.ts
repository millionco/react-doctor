export type Framework =
  | "nextjs"
  | "vite"
  | "cra"
  | "remix"
  | "gatsby"
  | "expo"
  | "react-native"
  | "tanstack-start"
  | "preact"
  | "unknown";

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
  /**
   * `true` when the project (or any of its workspace packages) declares an
   * Expo-managed dependency (`expo`, `expo-router`, `@expo/cli`, …) — the
   * react-doctor equivalent of expo-doctor's "is this an Expo project?"
   * entry gate. Drives the `expo` capability in `buildCapabilities`, which
   * gates every Expo-specific rule.
   *
   * Keyed off the dependency rather than `framework === "expo"` because
   * `detectFramework` returns the first matching package, so a project
   * declaring both `expo` and a web bundler (`vite` / `next`) classifies as
   * the web framework yet is still an Expo project. Mirrors how
   * `hasReactNativeWorkspace` decouples the `react-native` capability from
   * the single-valued `framework` hint.
   */
  isExpoProject: boolean;
  /**
   * `true` when the project (or any of its workspace packages) declares
   * `react-native-reanimated`. Lets diagnostics surface reanimated's
   * Compiler-compatible `.get()` / `.set()` accessors only where they
   * apply, instead of on every React Native project.
   */
  hasReanimated: boolean;
  sourceFileCount: number;
}

export interface PackageJson {
  name?: string;
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
