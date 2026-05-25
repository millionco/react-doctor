// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { asyncAwaitInLoop } from "./../rules/js-performance/async-await-in-loop.js";
import { asyncParallel } from "./../rules/js-performance/async-parallel.js";
import { jsBatchDomCss } from "./../rules/js-performance/js-batch-dom-css.js";
import { jsCachePropertyAccess } from "./../rules/js-performance/js-cache-property-access.js";
import { jsCacheStorage } from "./../rules/js-performance/js-cache-storage.js";
import { jsCombineIterations } from "./../rules/js-performance/js-combine-iterations.js";
import { jsEarlyExit } from "./../rules/js-performance/js-early-exit.js";
import { jsFlatmapFilter } from "./../rules/js-performance/js-flatmap-filter.js";
import { jsHoistIntl } from "./../rules/js-performance/js-hoist-intl.js";
import { jsHoistRegexp } from "./../rules/js-performance/js-hoist-regexp.js";
import { jsIndexMaps } from "./../rules/js-performance/js-index-maps.js";
import { jsLengthCheckFirst } from "./../rules/js-performance/js-length-check-first.js";
import { jsMinMaxLoop } from "./../rules/js-performance/js-min-max-loop.js";
import { jsSetMapLookups } from "./../rules/js-performance/js-set-map-lookups.js";
import { jsTosortedImmutable } from "./../rules/js-performance/js-tosorted-immutable.js";

export const JsPerformanceRuleEntries = [
  {
    key: "react-doctor/async-await-in-loop",
    id: "async-await-in-loop",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...asyncAwaitInLoop,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/async-parallel",
    id: "async-parallel",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...asyncParallel,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-batch-dom-css",
    id: "js-batch-dom-css",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsBatchDomCss,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-cache-property-access",
    id: "js-cache-property-access",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCachePropertyAccess,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-cache-storage",
    id: "js-cache-storage",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCacheStorage,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-combine-iterations",
    id: "js-combine-iterations",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsCombineIterations,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-early-exit",
    id: "js-early-exit",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsEarlyExit,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-flatmap-filter",
    id: "js-flatmap-filter",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsFlatmapFilter,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-hoist-intl",
    id: "js-hoist-intl",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsHoistIntl,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-hoist-regexp",
    id: "js-hoist-regexp",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsHoistRegexp,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-index-maps",
    id: "js-index-maps",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsIndexMaps,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-length-check-first",
    id: "js-length-check-first",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsLengthCheckFirst,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-min-max-loop",
    id: "js-min-max-loop",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsMinMaxLoop,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-set-map-lookups",
    id: "js-set-map-lookups",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsSetMapLookups,
      framework: "global",
      category: "Performance",
    },
  },
  {
    key: "react-doctor/js-tosorted-immutable",
    id: "js-tosorted-immutable",
    source: "react-doctor",
    originallyExternal: false,
    framework: "global",
    category: "Performance",
    severity: "warn",
    rule: {
      ...jsTosortedImmutable,
      framework: "global",
      category: "Performance",
    },
  },
] as const;
