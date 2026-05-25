// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { noBarrelImport } from "./../rules/bundle-size/no-barrel-import.js";
import { noDynamicImportPath } from "./../rules/bundle-size/no-dynamic-import-path.js";
import { noFullLodashImport } from "./../rules/bundle-size/no-full-lodash-import.js";
import { noMoment } from "./../rules/bundle-size/no-moment.js";
import { noUndeferredThirdParty } from "./../rules/bundle-size/no-undeferred-third-party.js";
import { preferDynamicImport } from "./../rules/bundle-size/prefer-dynamic-import.js";
import { useLazyMotion } from "./../rules/bundle-size/use-lazy-motion.js";

export const BundleSizeRuleEntries = [
  {
    key: "react-doctor/no-barrel-import",
    id: "no-barrel-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noBarrelImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-dynamic-import-path",
    id: "no-dynamic-import-path",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noDynamicImportPath,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-full-lodash-import",
    id: "no-full-lodash-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noFullLodashImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-moment",
    id: "no-moment",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noMoment,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/no-undeferred-third-party",
    id: "no-undeferred-third-party",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...noUndeferredThirdParty,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/prefer-dynamic-import",
    id: "prefer-dynamic-import",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...preferDynamicImport,
      framework: "global",
      category: "Bundle Size",
    },
  },
  {
    key: "react-doctor/use-lazy-motion",
    id: "use-lazy-motion",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Bundle Size",
    severity: "warn",
    rule: {
      ...useLazyMotion,
      framework: "global",
      category: "Bundle Size",
    },
  },
] as const;
