import type { PackageJson } from "../types/index.js";
import { someWorkspacePackageJson } from "./some-workspace-package-json.js";
import { isPackageJsonExpoAware } from "./utils/is-package-json-expo-aware.js";

// True when the root manifest or any workspace package inside
// `rootDirectory` declares an Expo-managed dependency — react-doctor's
// equivalent of expo-doctor's "is this an Expo project?" entry gate, which
// only runs once `expo` is present in the project's dependency graph.
//
// Walks workspaces with the same short-circuiting resolver used by the
// React Native and Reanimated gates (`someWorkspacePackageJson`), so a
// web-rooted monorepo (`next` / `vite` at the entry point) whose
// `apps/mobile` workspace targets Expo still classifies as an Expo
// project. The file-level package boundary in `oxlint-plugin-react-doctor`
// keeps Expo-only rules silent on the web workspaces — this just decides
// whether the project-level `expo` capability loads at all.
//
// Detection is keyed off the `expo` dependency rather than
// `framework === "expo"` because `detectFramework` returns the first
// matching package, so a project declaring both `expo` and a web bundler
// (`vite` / `next`) classifies as the web framework and would otherwise
// never surface as Expo.
export const isExpoProject = (rootDirectory: string, rootPackageJson: PackageJson): boolean =>
  someWorkspacePackageJson(rootDirectory, rootPackageJson, isPackageJsonExpoAware);
