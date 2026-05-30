---
"react-doctor": patch
---

Port expo-doctor's project-level checks as Expo-gated diagnostics. When an Expo project is detected (`expoVersion !== null`), react-doctor now runs the statically-determinable subset of expo-doctor's check suite during the environment-checks phase (skipped in diff/staged mode):

- `expo-no-unimodules-packages` — legacy `@unimodules/*` / `react-native-unimodules` packages (IllegalPackageCheck).
- `expo-no-cli-dependencies` — `expo-cli` / `eas-cli` listed as project dependencies (GlobalPackageInstalledLocallyCheck).
- `expo-no-redundant-dependency` — packages Expo installs transitively or that were removed/deprecated (`expo-modules-core`, `@expo/metro-config`, `@types/react-native`, `expo-permissions`, the `expo-firebase-*` family, …), each SDK-version gated (DirectPackageInstallCheck).
- `expo-no-conflicting-dependency-override` — `overrides`/`resolutions`/`pnpm.overrides` that pin SDK-critical packages like `@expo/cli` or `metro*` (DependencyVersionOverrideCheck).
- `expo-router-no-react-navigation` — direct `@react-navigation/*` alongside `expo-router` on the SDK 56 line only (`>=56 <57`, matching expo-doctor's range) (ExpoRouterReactNavigationCheck).
- `expo-vector-icons-conflict` — scoped icon packages mixed with `@expo/vector-icons` / `react-native-vector-icons` (VectorIconsCheck).
- `expo-package-json-conflict` — `expo`/`react-native` scripts shadowing node_modules bins, and a package name colliding with a dependency (PackageJsonCheck).
- `expo-lockfile` — missing or multiple lock files at the workspace root (LockfileCheck).
- `expo-gitignore` — a committed `.expo/` directory, or local module native dirs that are gitignored (ProjectSetupCheck).
- `expo-env-local-not-gitignored` — committed `.env*.local` files (EnvLocalFilesCheck).
- `expo-metro-config` — a metro config that doesn't extend `expo/metro-config`, while tolerating known wrappers that extend it internally such as Sentry's `getSentryExpoConfig` (MetroConfigCheck).

The remaining expo-doctor checks require running the Expo CLI, querying the Expo API, or inspecting native iOS/Android projects — none of which fit react-doctor's offline, static model — so they're intentionally out of scope.
