import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnescapedDynamicStringInRegexp } from "./no-unescaped-dynamic-string-in-regexp.js";

const cases = [
  {
    name: "closed-class-guarded-string-data-field",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/closed-class-guarded-string-data-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "closed-class-lexical-arrow-literal-filter",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return value.filter((entry) => {\n      const matcher = new RegExp(this.needleText, "i");\n      return entry.title.match(matcher) || entry.body.match(matcher);\n    });\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/closed-class-lexical-arrow-literal-filter.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "opaque-exported-store-with-mobx-selected-route",
    code: 'import { decorate, observable } from "mobx";\nclass TextStore {\n  needleText = "";\n  setText(value) { this.needleText = value; }\n  matches(value) { return new RegExp(this.needleText, "i").test(value); }\n}\ndecorate(TextStore, { needleText: observable });\nexport default new TextStore();\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/opaque-exported-store-with-mobx-selected-route.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "same-name-field-on-unrelated-owner",
    code: 'const matcher = { needleText: /fixed/ };\nexport const build = () => new RegExp(matcher.needleText, "i");\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/same-name-field-on-unrelated-owner.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "regex-object-field",
    code: 'class TextMatcher {\n  needleText = /fixed/;\n  setText(value) {\n    if (!(value instanceof RegExp)) return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/regex-object-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "fully-literal-class-field",
    code: 'class FixedMatcher {\n  needleText = "fixed";\n  matches(value) { return new RegExp(this.needleText, "i").test(value); }\n}\nexport const matches = (value) => new FixedMatcher().matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/fully-literal-class-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "inline-native-escape",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(RegExp.escape(this.needleText), "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/inline-native-escape.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "writer-native-escape",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = RegExp.escape(value);\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/writer-native-escape.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "getter-instead-of-own-data-field",
    code: 'class TextMatcher {\n  get needleText() { return /fixed/; }\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/getter-instead-of-own-data-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "inherited-data-field",
    code: 'class BaseMatcher { needleText = ""; }\nclass TextMatcher extends BaseMatcher {\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/inherited-data-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "nested-ordinary-function-this",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return function detached() { return new RegExp(this.needleText, "i").test(value); };\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/nested-ordinary-function-this.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "visible-regex-overwrite",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nmatcher.needleText = /fixed/;\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/visible-regex-overwrite.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "receiver-alias-member-overwrite",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nconst sameMatcher = matcher;\nsameMatcher.needleText = /fixed/;\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/receiver-alias-member-overwrite.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "detached-selected-reader",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const detached = matcher.matches;\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/detached-selected-reader.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "explicit-call-other-receiver",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const other = (value) => matcher.matches.call({ needleText: /fixed/ }, value);\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/explicit-call-other-receiver.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "prototype-accessor-replacement",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nObject.defineProperty(TextMatcher.prototype, "needleText", { get: () => /fixed/ });\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/prototype-accessor-replacement.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unknown-computed-store-write",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const replace = (key, value) => { matcher[key] = value; };\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/unknown-computed-store-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "local-regexp-provider",
    code: 'const RegExp = (source) => source;\nclass TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/local-regexp-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "global-eval-channel",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nglobalThis.eval("void 0");\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/global-eval-channel.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "raw-selected-value-validated-as-pattern",
    code: 'import { isValidRegexp } from "lib/utils/regexp";\nclass TextMatcher {\n  needleText = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.needleText = value;\n  }\n  matches(value) {\n    if (!isValidRegexp(this.needleText)) return false;\n    return new RegExp(this.needleText, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/raw-selected-value-validated-as-pattern.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "property-name-filter-only",
    code: 'class FilterNamedOnly {\n  filter = /fixed/;\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new FilterNamedOnly();\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/property-name-filter-only.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "custom-match-provider",
    code: 'class TextMatcher {\n  needleText = "";\n  setText(value) { if (typeof value !== "string") return; this.needleText = value; }\n  matches(value) { return value.match(new RegExp(this.needleText, "i")); }\n}\nconst matcher = new TextMatcher();\nexport const match = (input, value) => { matcher.setText(input); return matcher.matches(value); };\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/custom-match-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "same-search-name-filter-guarded-string-own-field",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 1,
    filename:
      "/synthetic/raw-member-literal-filter/same-search-name-filter-guarded-string-own-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "same-search-name-filter-lexical-arrow-own-field",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return value.filter((entry) => {\n      const matcher = new RegExp(this.filter, "i");\n      return entry.title.match(matcher) || entry.body.match(matcher);\n    });\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 1,
    filename:
      "/synthetic/raw-member-literal-filter/same-search-name-filter-lexical-arrow-own-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-opaque-exported-store-with-mobx-selected-route",
    code: 'import { decorate, observable } from "mobx";\nclass TextStore {\n  filter = "";\n  setText(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\ndecorate(TextStore, { filter: observable });\nexport default new TextStore();\n',
    expectedCount: 1,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-opaque-exported-store-with-mobx-selected-route.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-same-name-field-on-unrelated-owner",
    code: 'const matcher = { filter: /fixed/ };\nexport const build = () => new RegExp(matcher.filter, "i");\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-same-name-field-on-unrelated-owner.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-regex-object-field",
    code: 'class TextMatcher {\n  filter = /fixed/;\n  setText(value) {\n    if (!(value instanceof RegExp)) return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-regex-object-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-fully-literal-class-field",
    code: 'class FixedMatcher {\n  filter = "fixed";\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport const matches = (value) => new FixedMatcher().matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-fully-literal-class-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-inline-native-escape",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(RegExp.escape(this.filter), "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-inline-native-escape.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-writer-native-escape",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = RegExp.escape(value);\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-writer-native-escape.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-getter-instead-of-own-data-field",
    code: 'class TextMatcher {\n  get filter() { return /fixed/; }\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-getter-instead-of-own-data-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-inherited-data-field",
    code: 'class BaseMatcher { filter = ""; }\nclass TextMatcher extends BaseMatcher {\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-inherited-data-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-nested-ordinary-function-this",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return function detached() { return new RegExp(this.filter, "i").test(value); };\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-nested-ordinary-function-this.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-visible-regex-overwrite",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nmatcher.filter = /fixed/;\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-visible-regex-overwrite.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-receiver-alias-member-overwrite",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nconst sameMatcher = matcher;\nsameMatcher.filter = /fixed/;\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-receiver-alias-member-overwrite.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-detached-selected-reader",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const detached = matcher.matches;\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-detached-selected-reader.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-explicit-call-other-receiver",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const other = (value) => matcher.matches.call({ filter: /fixed/ }, value);\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-explicit-call-other-receiver.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-prototype-accessor-replacement",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nObject.defineProperty(TextMatcher.prototype, "filter", { get: () => /fixed/ });\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-prototype-accessor-replacement.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-unknown-computed-store-write",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nexport const replace = (key, value) => { matcher[key] = value; };\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-unknown-computed-store-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-local-regexp-provider",
    code: 'const RegExp = (source) => source;\nclass TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-local-regexp-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-global-eval-channel",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\nglobalThis.eval("void 0");\n',
    expectedCount: 0,
    filename: "/synthetic/raw-member-literal-filter/active-filter-global-eval-channel.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-raw-selected-value-validated-as-pattern",
    code: 'import { isValidRegexp } from "lib/utils/regexp";\nclass TextMatcher {\n  filter = "";\n  setText(value) {\n    if (typeof value !== "string") return;\n    this.filter = value;\n  }\n  matches(value) {\n    if (!isValidRegexp(this.filter)) return false;\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nconst matcher = new TextMatcher();\nexport const matches = (input, value) => {\n  matcher.setText(input);\n  return matcher.matches(value);\n};\n',
    expectedCount: 0,
    filename:
      "/synthetic/raw-member-literal-filter/active-filter-raw-selected-value-validated-as-pattern.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "active-filter-custom-match-provider",
    code: 'class TextMatcher {\n  filter = "";\n  setText(value) { if (typeof value !== "string") return; this.filter = value; }\n  matches(value) { return value.match(new RegExp(this.filter, "i")); }\n}\nconst matcher = new TextMatcher();\nexport const match = (input, value) => { matcher.setText(input); return matcher.matches(value); };\n',
    expectedCount: 1,
    filename: "/synthetic/raw-member-literal-filter/active-filter-custom-match-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "parameter-sanitized-before-write",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { value = RegExp.escape(value); this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/parameter-sanitized-before-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "parameter-reassigned-after-write",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; value = "fixed"; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/parameter-reassigned-after-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "same-spelling-inner-shadow-only",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { { const value = "fixed"; this.filter = value; } }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/same-spelling-inner-shadow-only.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unrelated-shadow-write-preserves-parameter",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { { let value = "fixed"; value = "later"; } this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename:
      "/synthetic/own-search-slot-adversarial/unrelated-shadow-write-preserves-parameter.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "mixed-raw-and-escaped-writers",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n  setEscaped(value) { this.filter = RegExp.escape(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/mixed-raw-and-escaped-writers.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "safe-character-guard-dominates-writer",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { if (!/^[a-z0-9 ]*$/i.test(value)) return; this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/safe-character-guard-dominates-writer.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "safe-guard-on-shadow-does-not-protect-raw",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { { const value = "fixed"; if (!/^[a-z0-9 ]*$/i.test(value)) return; } this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-adversarial/safe-guard-on-shadow-does-not-protect-raw.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "regex-source-parameter-domain",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst searchStore = new SearchStore();\nexport const matches = (pattern, value) => { searchStore.setFilter(pattern.source); return searchStore.matches(value); };\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/regex-source-parameter-domain.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "closed-literal-only-caller",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst searchStore = new SearchStore();\nexport const matches = (value) => { searchStore.setFilter("fixed"); return searchStore.matches(value); };\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/closed-literal-only-caller.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "exported-instance-not-closed-literal-only",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst searchStore = new SearchStore();\nsearchStore.setFilter("fixed");\nexport default searchStore;\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-adversarial/exported-instance-not-closed-literal-only.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "constructor-returns-foreign-receiver",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n  constructor() { return { filter: "fixed", setFilter() {}, matches() { return false; } }; }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/constructor-returns-foreign-receiver.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "detached-selected-setter",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst searchStore = new SearchStore();\nexport const setFilter = searchStore.setFilter;\nexport default searchStore;\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/detached-selected-setter.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "regexp-provider-global-alias-write",
    code: 'const environment = globalThis;\nenvironment.RegExp = class Replacement { constructor() { return { test: () => true }; } };\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/regexp-provider-global-alias-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "erased-global-type-does-not-close-eval-channel",
    code: 'interface globalThis {}\nglobalThis.eval("globalThis.RegExp = class Replacement {}");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-adversarial/erased-global-type-does-not-close-eval-channel.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "reflected-constructor-provider-channel",
    code: 'const compile = (() => {}).constructor;\ncompile("globalThis.RegExp = class Replacement { test() { return true; } }")();\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/reflected-constructor-provider-channel.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "computed-selected-literal-reset",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n  clear() { this["filter"] = "fixed"; }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/computed-selected-literal-reset.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "nested-class-owner-not-outer-writer",
    code: 'class OuterStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  build() {\n    return class InnerStore {\n      filter = "fixed";\n      matches(value) { return new RegExp(this.filter, "i").test(value); }\n    };\n  }\n}\nexport default new OuterStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-adversarial/nested-class-owner-not-outer-writer.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "old-lexical-risk-survives-new-provider-veto",
    code: 'const compile = (() => {}).constructor;\ncompile("void 0")();\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\nexport const lexical = (filter, value) => new RegExp(filter, "i").test(value);\n',
    expectedCount: 1,
    filename:
      "/synthetic/own-search-slot-adversarial/old-lexical-risk-survives-new-provider-veto.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "parenthesized-typescript-slot",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value: string) { this.filter = value; }\n  matches(value) { return new RegExp((this.filter as string), "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-boundaries/parenthesized-typescript-slot.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "optional-slot-is-unsupported",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this?.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/optional-slot-is-unsupported.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "duplicate-own-field-is-unsupported",
    code: 'class SearchStore {\n  filter = "";\n  filter = "fixed";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/duplicate-own-field-is-unsupported.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "computed-own-field-is-unsupported",
    code: 'class SearchStore {\n  ["filter"] = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/computed-own-field-is-unsupported.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "static-reader-is-not-instance-this",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  static matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/static-reader-is-not-instance-this.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "selected-field-regexp-flags-domain",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n  flags() { return this.filter.flags; }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/selected-field-regexp-flags-domain.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "object-pattern-constructor-channel",
    code: 'const { constructor: compile } = (() => {});\ncompile("void 0")();\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/object-pattern-constructor-channel.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "direct-empty-string-reset-keeps-raw-domain",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n  clear() { this.filter = ""; }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-boundaries/direct-empty-string-reset-keeps-raw-domain.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "reader-literal-overwrite-is-not-raw-input",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { this.filter = "fixed"; return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/reader-literal-overwrite-is-not-raw-input.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "selected-field-pattern-name-is-unsupported",
    code: 'class SearchStore {\n  filterPattern = "";\n  setFilter(value) { this.filterPattern = value; }\n  matches(value) { return new RegExp(this.filterPattern, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-boundaries/selected-field-pattern-name-is-unsupported.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "existing-lexical-calibration-remains-active",
    code: 'export const matchText = (filter, value) => new RegExp(filter, "i").test(value);\n',
    expectedCount: 1,
    filename: "/synthetic/raw-member-literal-filter/lexical-filter-activation-calibration.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "known-dynamic-import-provider-replacement",
    code: 'await import("data:text/javascript,globalThis.RegExp = class { constructor() { return /fixed/; } };");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/known-dynamic-import-provider-replacement.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "constructor-regexp-overwrite",
    code: 'class SearchStore {\n  filter = "";\n  constructor() { this.filter = /fixed/; }\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/constructor-regexp-overwrite.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "indirect-global-regexp-member-write",
    code: 'document.defaultView.RegExp = class Replacement { constructor() { return /fixed/; } };\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/indirect-global-regexp-member-write.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "overwritten-duplicate-selected-writer",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  setFilter(value) {}\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/overwritten-duplicate-selected-writer.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "const-computed-duplicate-selected-field",
    code: 'const selectedKey = "filter";\nclass SearchStore {\n  filter = "";\n  [selectedKey] = /fixed/;\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/const-computed-duplicate-selected-field.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "explicit-regexp-parameter-domain",
    code: 'class SearchStore {\n  filter: string | RegExp = "";\n  setFilter(value: RegExp) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/explicit-regexp-parameter-domain.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "closed-setter-fed-native-regexp-call",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst searchStore = new SearchStore();\nsearchStore.setFilter(RegExp("fixed"));\nexport const matches = (value) => searchStore.matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-holds/closed-setter-fed-native-regexp-call.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "selected-static-block-replacement",
    code: 'class SearchStore {\n  filter = "";\n  static { this.prototype.setFilter = () => {}; }\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/selected-static-block-replacement.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "selected-decorator-channel",
    code: 'const replace = (value) => value;\n@replace\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/selected-decorator-channel.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "field-regexp-union-with-string-writer",
    code: 'class SearchStore {\n  filter: string | RegExp = "";\n  setFilter(value: string) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/field-regexp-union-with-string-writer.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "parameter-regexp-annotation-alone",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value: RegExp) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/parameter-regexp-annotation-alone.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "visible-escaped-caller-input",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nexport const matches = (raw, value) => { store.setFilter(RegExp.escape(raw)); return store.matches(value); };\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/visible-escaped-caller-input.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "explicit-string-field-and-parameter",
    code: 'class SearchStore {\n  filter: string = "";\n  setFilter(value: string) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-repair/explicit-string-field-and-parameter.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "indirect-eval-member-provider",
    code: 'document.defaultView.eval("globalThis.RegExp = class Replacement {} ");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/indirect-eval-member-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "indirect-function-member-provider",
    code: 'const compile = document.defaultView.Function;\ncompile("globalThis.RegExp = class Replacement {} ")();\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/indirect-function-member-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "node-vm-value-import-provider",
    code: 'import { runInThisContext } from "node:vm";\nrunInThisContext("globalThis.RegExp = class Replacement {} ");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/node-vm-value-import-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "node-vm-static-require-provider",
    code: 'const runtimeVm = require("vm");\nruntimeVm.runInThisContext("globalThis.RegExp = class Replacement {} ");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/node-vm-static-require-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unused-type-only-vm-import-preserves-risk",
    code: 'import type { Context } from "node:vm";\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-repair/unused-type-only-vm-import-preserves-risk.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "transparent-native-regexp-callee",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nstore.setFilter((RegExp as RegExpConstructor)("fixed"));\nexport const matches = (value) => store.matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-repair/transparent-native-regexp-callee.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "aliased-computed-function-constructor",
    code: 'const compile = (() => {})["con" + "structor"];\ncompile("globalThis.RegExp = class { constructor() { return /fixed/; } };")();\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-successor-holds/aliased-computed-function-constructor.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "destructured-indirect-eval-provider",
    code: 'const { eval: execute } = document.defaultView;\nexecute("globalThis.RegExp = class { constructor() { return /fixed/; } };");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-successor-holds/destructured-indirect-eval-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "transparent-selected-writer-only-literal-call",
    code: 'interface Setter { (value: string): void; }\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nexport const matches = (value) => {\n  (store.setFilter as Setter)("fixed");\n  return store.matches(value);\n};\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-successor-holds/transparent-selected-writer-only-literal-call.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "native-regexp-alias-call-writer-argument",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nconst CopyRegExp = RegExp;\nstore.setFilter(CopyRegExp("fixed"));\nexport const matches = (value) => store.matches(value);\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-final-boundaries/native-regexp-alias-call-writer-argument.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unknown-call-result-writer-argument",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nstore.setFilter(loadPattern());\nexport const matches = (value) => store.matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-final-boundaries/unknown-call-result-writer-argument.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "initialized-regexp-alias-writer-argument",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nconst CopyRegExp = RegExp;\nconst pattern = CopyRegExp("fixed");\nstore.setFilter(pattern);\nexport const matches = (value) => store.matches(value);\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-final-boundaries/initialized-regexp-alias-writer-argument.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "member-valued-writer-argument",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nconst holder = { value: /fixed/ };\nstore.setFilter(holder.value);\nexport const matches = (value) => store.matches(value);\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-final-boundaries/member-valued-writer-argument.ts",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "literal-reset-method-replaced-with-regexp-writer",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear() { this.filter = ""; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nstore.clear = function () { this.filter = /fixed/; };\nexport const matches = (value) => {\n  store.clear();\n  return store.matches(value);\n};\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-successor-holds/literal-reset-method-replaced-with-regexp-writer.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "raw-before-replaced-literal-reset-method",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear() { this.filter = ""; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nstore.clear = function () { this.filter = /fixed/; };\nexport const matches = (input, value) => {\n  store.setFilter(input);\n  store.clear();\n  return store.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-ownership/raw-before-replaced-literal-reset-method.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unknown-callable-field-writes-selected-slot",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear = () => { this.filter = /fixed/; };\n  matches(value) { this.clear(); return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-ownership/unknown-callable-field-writes-selected-slot.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "lexical-this-replaces-declared-reset-method",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear() { this.filter = ""; }\n  replace() { this.clear = function () { this.filter = /fixed/; }; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nconst store = new SearchStore();\nexport const matches = (input, value) => {\n  store.setFilter(input);\n  store.replace();\n  store.clear();\n  return store.matches(value);\n};\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-ownership/lexical-this-replaces-declared-reset-method.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "accessor-writes-selected-slot",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  get trigger() { this.filter = /fixed/; return 0; }\n  matches(value) { this.trigger; return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-ownership/accessor-writes-selected-slot.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "field-initializer-iife-writes-selected-slot",
    code: 'class SearchStore {\n  filter = "";\n  initialize = (() => { this.filter = /fixed/; return 0; })();\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-ownership/field-initializer-iife-writes-selected-slot.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "unrelated-accessor-retains-own-search-risk",
    code: 'class SearchStore {\n  filter = "";\n  _title = "";\n  get title() { return this._title; }\n  set title(value) { this._title = value; }\n  rename(value) { this.title = value; }\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 1,
    filename: "/synthetic/own-search-slot-ownership/unrelated-accessor-retains-own-search-risk.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "field-initializer-receiver-escape",
    code: 'class SearchStore {\n  filter = "";\n  boot = initialize(this);\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-final-provider/field-initializer-receiver-escape.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "destructured-builtin-loader-provider",
    code: 'const { getBuiltinModule: load } = process;\nconst vm = load("vm");\nvm.runInThisContext("globalThis.RegExp = class { constructor() { return /fixed/; } };");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-final-provider/destructured-builtin-loader-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "runtime-require-alias-provider",
    code: 'const load = require;\nconst vm = load("node:vm");\nvm.runInThisContext("globalThis.RegExp = class { constructor() { return /fixed/; } };");\nclass SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  matches(value) { return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-final-provider/runtime-require-alias-provider.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "reader-calls-unconditional-literal-reset",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear() { this.filter = "fixed"; }\n  matches(value) { this.clear(); return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename:
      "/synthetic/own-search-slot-temporal-holds/reader-calls-unconditional-literal-reset.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "reader-triggers-literal-reset-getter",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  get trigger() { this.filter = "fixed"; return 0; }\n  matches(value) { this.trigger; return new RegExp(this.filter, "i").test(value); }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-temporal-holds/reader-triggers-literal-reset-getter.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
  {
    name: "computed-getter-indirect-literal-reset",
    code: 'class SearchStore {\n  filter = "";\n  setFilter(value) { this.filter = value; }\n  clear() { this.filter = "fixed"; }\n  get trigger() { this.clear(); return 0; }\n  matches(value) {\n    this["tri" + "gger"];\n    return new RegExp(this.filter, "i").test(value);\n  }\n}\nexport default new SearchStore();\n',
    expectedCount: 0,
    filename: "/synthetic/own-search-slot-temporal-holds/computed-getter-indirect-literal-reset.js",
    forceJsx: false,
    includeLocations: true,
    settings: {
      "react-doctor": {
        portedRuleMode: "curated",
        capabilities: [],
      },
    },
  },
];

describe("no-unescaped-dynamic-string-in-regexp own search slots", () => {
  it.each(cases)("$name", (testCase) => {
    const result = runRule(noUnescapedDynamicStringInRegexp, testCase.code, {
      filename: testCase.filename,
      forceJsx: testCase.forceJsx,
      includeLocations: testCase.includeLocations,
      settings: testCase.settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(testCase.expectedCount);
  });
});
