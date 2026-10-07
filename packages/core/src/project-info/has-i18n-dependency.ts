import type { PackageJson } from "../types/index.js";
import { hasAnyDependency } from "./has-any-dependency.js";

// The mainstream React internationalization stacks. Declaring one is the
// package.json signal that the app is localized — and therefore that
// composed (IME) text entry is in scope for its users.
const I18N_PACKAGES = [
  "i18next",
  "react-i18next",
  "next-i18next",
  "react-intl",
  "next-intl",
  "use-intl",
  "@formatjs/intl",
  "@lingui/core",
  "@lingui/react",
  "typesafe-i18n",
  "@tolgee/react",
  "react-intl-universal",
];

export const hasI18nDependency = (packageJson: PackageJson): boolean => {
  return hasAnyDependency(packageJson, I18N_PACKAGES);
};
