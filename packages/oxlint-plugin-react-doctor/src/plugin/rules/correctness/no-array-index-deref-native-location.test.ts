import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexDerefWithoutBoundsOrEmptyGuard } from "./no-array-index-deref-without-bounds-or-empty-guard.js";

const cases = [
  {
    name: "native-search-question-fallback",
    code: 'export const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/native-search-question-fallback.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "empty-native-search-uncovered",
    code: 'export const readSection = () => window.location.search.split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/empty-native-search-uncovered.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "empty-fallback-stays-positive",
    code: 'export const readSection = () => (window.location.search || "").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/empty-fallback-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "wrong-delimiter-stays-positive",
    code: 'export const readSection = () => (window.location.search || "?").split("&")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/wrong-delimiter-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ordinal-two-stays-positive",
    code: 'export const readSection = () => (window.location.search || "?").split("?")[2].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/ordinal-two-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "split-limit-one-stays-positive",
    code: 'export const readSection = () => (window.location.search || "?").split("?", 1)[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/split-limit-one-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-window-parameter-stays-positive",
    code: 'export const readSection = (window: { location: { search: string } }) => (window.location.search || "?").split("?")[1].trim();\n',
    options: {
      filename:
        "/synthetic/uncovered-next/native-location/shadowed-window-parameter-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "local-window-object-stays-positive",
    code: 'const window = { location: { search: "plain" } };\nexport const readSection = () => (window.location.search || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/local-window-object-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "arbitrary-query-param-stays-positive",
    code: 'export const readSection = (query: string) => (query || "?").split("?")[1].trim();\n',
    options: {
      filename:
        "/synthetic/uncovered-next/native-location/arbitrary-query-param-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "hash-property-stays-positive",
    code: 'export const readSection = () => (window.location.hash || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/hash-property-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "pathname-property-stays-positive",
    code: 'export const readSection = () => (window.location.pathname || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/pathname-property-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "already-optional-deref-safe",
    code: 'export const readSection = () => (window.location.search || "?").split("?")[1]?.trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/already-optional-deref-safe.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "erased-window-provider-abstain",
    code: 'declare const window: { location: { search: string } };\nexport const readSection = () => (window.location.search || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/erased-window-provider-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "snapshot-alias-not-in-v1",
    code: 'const query = window.location.search;\nexport const readSection = () => (query || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/snapshot-alias-not-in-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "parentheses-around-native-search",
    code: 'export const readSection = () => ((window.location.search) || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/parentheses-around-native-search.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "different-fallback-literal-outside-v1",
    code: 'export const readSection = () => (window.location.search || "?more").split("?")[1].trim();\n',
    options: {
      filename:
        "/synthetic/uncovered-next/native-location/different-fallback-literal-outside-v1.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "location-object-param-stays-positive",
    code: 'export const readSection = (location: { search: string }) => (location.search || "?").split("?")[1].trim();\n',
    options: {
      filename:
        "/synthetic/uncovered-next/native-location/location-object-param-stays-positive.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "global-window-value-escape-abstain",
    code: 'import { observeHost } from "./observer";\nobserveHost(window);\nexport const readSection = () => (window.location.search || "?").split("?")[1].trim();\n',
    options: {
      filename: "/synthetic/uncovered-next/native-location/global-window-value-escape-abstain.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "visible-string-split-replacement",
    code: 'String.prototype.split=()=>[];\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename: "/synthetic/independent-native-location/visible-string-split-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-prototype-alias-split-replacement",
    code: 'const stringPrototype=String.prototype;\nstringPrototype.split=()=>[];\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename:
        "/synthetic/independent-native-location/readonly-prototype-alias-split-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "erased-string-mask-in-nested-replacement",
    code: 'const replaceSplit=()=>{interface String {} String.prototype.split=()=>[];};\nreplaceSplit();\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename:
        "/synthetic/independent-native-location/erased-string-mask-in-nested-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "native-window-aliased-opaque-transport",
    code: 'import { observeHost } from "./observer";\nconst host=window;\nobserveHost(host);\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename: "/synthetic/independent-native-location/native-window-aliased-opaque-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "custom-symbol-split-separator",
    code: 'const separator={ [Symbol.split](){return [];} };\nexport const readSection=()=>(window.location.search||"?").split(separator)[1].trim();\n',
    options: {
      filename: "/synthetic/independent-native-location/custom-symbol-split-separator.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "regexp-separator-is-outside-native-literal-proof",
    code: 'export const readSection=()=>(window.location.search||"?").split(/missing/)[1].trim();\n',
    options: {
      filename:
        "/synthetic/independent-native-location/regexp-separator-is-outside-native-literal-proof.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "separator-prototype-split-hook-profile-boundary",
    code: 'String.prototype[Symbol.split]=()=>[];\nexport const readSection = () => (window.location.search || "?").split("?")[1].split("&");\n',
    options: {
      filename:
        "/synthetic/independent-native-location/separator-prototype-split-hook-profile-boundary.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
  },
];

describe("native location question fallback", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(noArrayIndexDerefWithoutBoundsOrEmptyGuard, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
