import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { REACT_ROUTER_CAPABILITY_THRESHOLDS } from "../../../core/src/constants.js";
import { isMajorMinorAtLeast } from "../../../core/src/project-info/version.js";
import {
  DIFFERENTIAL_FIXTURE_GROUPS,
  DIFFERENTIAL_VIRTUAL_PROJECT_CASES,
} from "./evaluator-differential-fixtures.js";
import { REACT_ROUTER_RULE_IDS } from "../plugin/constants/react-router.js";
import { ruleRegistry } from "../plugin/rule-registry.js";
import type {
  DifferentialFixtureCase,
  DifferentialFixtureGroup,
} from "./evaluator-differential-fixtures.js";
import { evaluateProject, evaluateSource, evaluateVirtualProject } from "./evaluate-source.js";
import type { EvaluatorDiagnostic, EvaluateSourceResult } from "./evaluate-source.js";
import { createInMemoryResourceHost } from "./resource-host/in-memory-resource-host.js";
import { createRealFilesystemResourceHost } from "./resource-host/real-resource-host.js";
import type { InMemoryResourcePackageInput } from "./resource-host/resource-host.js";

interface EvaluatorParityCase {
  readonly filename: string;
  readonly ruleId: string;
  readonly severity: "error" | "warn";
  readonly sourceText: string;
}

interface OxlintParitySpan {
  readonly offset: number;
  readonly length: number;
  readonly line: number;
  readonly column: number;
}

interface OxlintParityDiagnostic {
  readonly message: string;
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly filename: string;
  readonly labels: ReadonlyArray<OxlintParityLabel>;
}

interface OxlintParityLabel {
  readonly span: OxlintParitySpan;
}

interface OxlintParityOutput {
  readonly diagnostics: ReadonlyArray<OxlintParityDiagnostic>;
}

interface ComparableParityDiagnostic {
  readonly filePath: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly line: number | undefined;
  readonly column: number | undefined;
  readonly offset: number | undefined;
  readonly length: number | undefined;
}

interface OxlintRunResult {
  readonly output: OxlintParityOutput;
  readonly rootDirectory: string;
  readonly status: number | null;
  readonly stderr: string;
}

interface OxlintProjectParityInput {
  readonly files: ReadonlyMap<string, string>;
  readonly resourceFiles?: ReadonlyMap<string, string>;
  readonly rules: ReadonlyArray<OxlintProjectParityRule>;
  readonly settings?:
    | Readonly<Record<string, unknown>>
    | ((rootDirectory: string) => Readonly<Record<string, unknown>>);
}

interface OxlintProjectParityRule {
  readonly ruleId: string;
  readonly severity: "error" | "warn";
}

interface InlineSuppressionParityCase {
  readonly name: string;
  readonly sourceText: string;
  readonly expectedDiagnosticLines: ReadonlyArray<number>;
}

const PARITY_CORPUS: ReadonlyArray<EvaluatorParityCase> = [
  {
    filename: "button.tsx",
    ruleId: "button-has-type",
    severity: "warn",
    sourceText: "export const Button = () => <div>😀<button>Save</button></div>;",
  },
  {
    filename: "access-key.tsx",
    ruleId: "no-access-key",
    severity: "warn",
    sourceText: `export const Shortcuts = () => (
  <main accessKey="m">
    <button accessKey="s">Save</button>
  </main>
);`,
  },
  {
    filename: "list.tsx",
    ruleId: "no-array-index-as-key",
    severity: "warn",
    sourceText: `interface ListProps {
  readonly items: ReadonlyArray<string>;
}

export const List = ({ items }: ListProps) =>
  items.map((item, itemIndex) => <span key={itemIndex}>{item}</span>);`,
  },
  {
    filename: "json.ts",
    ruleId: "no-unsafe-json-parse",
    severity: "warn",
    sourceText: `const label = "😀";
export const readName = (sourceText: string) => JSON.parse(sourceText).name;`,
  },
  {
    filename: "dynamic-code.ts",
    ruleId: "no-eval",
    severity: "error",
    sourceText: "export const runCode = (sourceText: string) => eval(sourceText);",
  },
  {
    filename: "line-terminators.ts",
    ruleId: "no-eval",
    severity: "error",
    sourceText: "const first = 1;\reval(first);\u2028eval(second);\u2029eval(third);",
  },
];

const REACT_NATIVE_RULE_ID = "rn-no-raw-text";
const REACT_NATIVE_SETTINGS = {
  "react-doctor": {
    capabilities: ["react", "react-native"],
    framework: "react-native",
    packageCapabilityGates: true,
  },
};
const MISSING_REACT_NATIVE_CAPABILITY_SETTINGS = {
  "react-doctor": {
    capabilities: ["react"],
    framework: "react-native",
    packageCapabilityGates: true,
  },
};
const WEB_SETTINGS = {
  "react-doctor": {
    capabilities: ["react", "vite"],
    framework: "vite",
  },
};
const PACKAGE_MANIFEST_SETTINGS = {
  "react-doctor": {
    capabilities: ["react", "react-native"],
    framework: "expo",
    packageCapabilityGates: true,
  },
};
const REACT_ROUTER_ROUTE_SOURCE_TEXT = `import { useNavigate } from "react-router";

export const Route = () => {
  const navigate = useNavigate();
  navigate("/next");
  return null;
};`;
const REACT_ROUTER_VERSION = { major: 7, minor: 9 };
const REACT_ROUTER_VERSION_SPECIFIER = "7.9.0";
const REACT_ROUTER_CAPABILITIES = [
  "react-router",
  ...REACT_ROUTER_CAPABILITY_THRESHOLDS.filter((threshold) =>
    isMajorMinorAtLeast(REACT_ROUTER_VERSION, threshold),
  ).map((threshold) => threshold.capability),
  "react-router-framework",
];
const REACT_ROUTER_PROJECT_FILES = new Map<string, string>([
  ["src/route.tsx", REACT_ROUTER_ROUTE_SOURCE_TEXT],
]);
const REACT_ROUTER_MANIFEST = {
  name: "react-router-project",
  dependencies: {
    "@react-router/dev": REACT_ROUTER_VERSION_SPECIFIER,
    react: "19.1.0",
    "react-router": REACT_ROUTER_VERSION_SPECIFIER,
  },
};
const REACT_ROUTER_RESOURCE_FILES = new Map<string, string>([
  ["package.json", JSON.stringify(REACT_ROUTER_MANIFEST)],
]);
const REACT_ROUTER_VIRTUAL_PACKAGES: ReadonlyArray<InMemoryResourcePackageInput> = [
  {
    directoryPath: ".",
    manifest: REACT_ROUTER_MANIFEST,
    installedDependencyVersions: {
      "@react-router/dev": REACT_ROUTER_VERSION_SPECIFIER,
      react: "19.1.0",
      "react-router": REACT_ROUTER_VERSION_SPECIFIER,
    },
  },
];
const REACT_ROUTER_RULES: ReadonlyArray<OxlintProjectParityRule> = REACT_ROUTER_RULE_IDS.map(
  (ruleId) => ({
    ruleId,
    severity: ruleRegistry[ruleId]?.severity === "warn" ? "warn" : "error",
  }),
);
const createReactRouterSettings = (rootDirectory: string): Readonly<Record<string, unknown>> => ({
  "react-doctor": {
    rootDirectory,
    capabilities: ["react", "react:19", ...REACT_ROUTER_CAPABILITIES],
  },
});
const REACT_NATIVE_PROJECT_FILES = new Map<string, string>([
  [
    "packages/native/src/app.tsx",
    `import { Card, Label } from "./wrappers";

export const App = () => (
  <>
    <Card>😀 Crash</Card>
    <Label>Safe</Label>
    <View>Direct crash</View>
  </>
);`,
  ],
  [
    "packages/native/src/wrappers.tsx",
    `export const Card = ({ children }) => <View>{children}</View>;
export const Label = ({ children }) => <Text>{children}</Text>;`,
  ],
  [
    "packages/native/src/dom-component.tsx",
    `"use dom";
export const DomComponent = () => <View>DOM text</View>;`,
  ],
  [
    "packages/native/src/platform.web.tsx",
    `export const WebComponent = () => <View>Web text</View>;`,
  ],
  [
    "packages/web/src/component.tsx",
    `export const WebComponent = () => <View>Web package text</View>;`,
  ],
  [
    "packages/web/src/component.native.tsx",
    `export const NativeComponent = () => <View>Native override text</View>;`,
  ],
  ["src/loose.tsx", `export const LooseComponent = () => <View>Framework text</View>;`],
]);
const REACT_NATIVE_RESOURCE_FILES = new Map<string, string>([
  [
    "packages/native/package.json",
    JSON.stringify({
      name: "native-package",
      dependencies: { "react-native": "0.80.0" },
    }),
  ],
  [
    "packages/web/package.json",
    JSON.stringify({
      name: "web-package",
      dependencies: { "react-dom": "19.1.0" },
    }),
  ],
]);
const REACT_NATIVE_VIRTUAL_PACKAGES: ReadonlyArray<InMemoryResourcePackageInput> = [
  {
    directoryPath: "packages/native",
    manifest: {
      name: "native-package",
      dependencies: { "react-native": "0.80.0" },
    },
    installedDependencyVersions: { "react-native": "0.80.0" },
  },
  {
    directoryPath: "packages/web",
    manifest: {
      name: "web-package",
      dependencies: { "react-dom": "19.1.0" },
    },
    installedDependencyVersions: { "react-dom": "19.1.0" },
  },
];
const PACKAGE_MANIFEST_RULES: ReadonlyArray<OxlintProjectParityRule> = [
  { ruleId: "no-full-lodash-import", severity: "warn" },
  { ruleId: "rn-prefer-expo-image", severity: "warn" },
  { ruleId: "rn-no-legacy-shadow-styles", severity: "warn" },
  { ruleId: "rn-style-prefer-boxshadow", severity: "warn" },
];
const PACKAGE_MANIFEST_PROJECT_FILES = new Map<string, string>([
  [
    "packages/web/src/lodash.ts",
    `const marker = "😀";\r
import lodash from "lodash";\r
export const chunks = lodash.chunk([1, 2, 3], 2);`,
  ],
  [
    "packages/cli/src/lodash.ts",
    `import lodash from "lodash";
export const chunks = lodash.chunk([1, 2, 3], 2);`,
  ],
  [
    "packages/library/src/demo.page.tsx",
    `import lodash from "lodash";
export const Demo = () => <output>{lodash.chunk([1, 2, 3], 2).length}</output>;`,
  ],
  [
    "packages/expo/src/image.tsx",
    `const marker = "😀";\r
import { Image as NativeImage } from "react-native";\r
export const Avatar = ({ uri }) => <NativeImage source={{ uri }} />;`,
  ],
  [
    "packages/native/src/image.tsx",
    `import { Image } from "react-native";
export const Avatar = ({ uri }) => <Image source={{ uri }} />;`,
  ],
  [
    "packages/expo/src/image.web.tsx",
    `import { Image } from "react-native";
export const Avatar = ({ uri }) => <Image source={{ uri }} />;`,
  ],
  [
    "packages/modern/src/shadow.tsx",
    `export const Card = () => <View style={{ shadowOpacity: 0.2 }} />;`,
  ],
  [
    "packages/old/src/shadow.tsx",
    `export const Card = () => <View style={{ shadowOpacity: 0.2 }} />;`,
  ],
  [
    "packages/disabled/src/shadow.tsx",
    `export const Card = () => <View style={{ shadowOpacity: 0.2 }} />;`,
  ],
  [
    "packages/disabled/android/gradle.properties",
    `hermesEnabled=true
newArchEnabled=false`,
  ],
  [
    "packages/web/src/shadow.native.tsx",
    `export const Card = () => <View style={{ elevation: 4 }} />;`,
  ],
  [
    "packages/expo/src/shadow.web.tsx",
    `export const Card = () => <View style={{ shadowOpacity: 0.2 }} />;`,
  ],
  [
    "src/loose-image.tsx",
    `import { Image } from "react-native";
export const Avatar = ({ uri }) => <Image source={{ uri }} />;`,
  ],
]);
const PACKAGE_MANIFEST_VIRTUAL_PACKAGES: ReadonlyArray<InMemoryResourcePackageInput> = [
  {
    directoryPath: "packages/web",
    manifest: {
      name: "web-package",
      private: true,
      dependencies: { "react-dom": "19.1.0", react: "19.1.0" },
    },
  },
  {
    directoryPath: "packages/cli",
    manifest: {
      name: "cli-package",
      bin: "./dist/cli.js",
      dependencies: { lodash: "4.17.21" },
    },
  },
  {
    directoryPath: "packages/library",
    manifest: {
      name: "library-package",
      peerDependencies: { react: "^19.0.0" },
    },
  },
  {
    directoryPath: "packages/expo",
    manifest: {
      name: "expo-package",
      dependencies: { expo: "53.0.0", "react-native": "0.80.0" },
    },
    installedDependencyVersions: { expo: "53.0.0", "react-native": "0.80.0" },
  },
  {
    directoryPath: "packages/native",
    manifest: {
      name: "native-package",
      dependencies: { "react-native": "0.80.0" },
    },
    installedDependencyVersions: { "react-native": "0.80.0" },
  },
  {
    directoryPath: "packages/modern",
    manifest: {
      name: "modern-native-package",
      dependencies: { "react-native": "0.80.0" },
    },
    installedDependencyVersions: { "react-native": "0.80.0" },
  },
  {
    directoryPath: "packages/old",
    manifest: {
      name: "old-native-package",
      dependencies: { "react-native": "0.75.4" },
    },
    installedDependencyVersions: { "react-native": "0.75.4" },
  },
  {
    directoryPath: "packages/disabled",
    manifest: {
      name: "disabled-native-package",
      dependencies: { "react-native": "0.80.0" },
    },
    installedDependencyVersions: { "react-native": "0.80.0" },
  },
];
const PACKAGE_MANIFEST_RESOURCE_FILES = new Map(
  PACKAGE_MANIFEST_VIRTUAL_PACKAGES.map((projectPackage): [string, string] => [
    `${projectPackage.directoryPath}/package.json`,
    JSON.stringify(projectPackage.manifest),
  ]),
);
const BROWSER_HYDRATION_RULES: ReadonlyArray<OxlintProjectParityRule> = [
  { ruleId: "no-hydration-branch-on-browser-global", severity: "error" },
  { ruleId: "no-match-media-in-state-initializer", severity: "warn" },
  { ruleId: "no-unguarded-browser-global-in-render-or-hook-init", severity: "error" },
  { ruleId: "rendering-hydration-mismatch-time", severity: "warn" },
  { ruleId: "window-open-without-noopener", severity: "warn" },
];
const BROWSER_HYDRATION_SETTINGS = {
  "react-doctor": {
    capabilities: ["react", "ssr"],
    framework: "nextjs",
    packageCapabilityGates: true,
  },
};
const BROWSER_HYDRATION_PROJECT_FILES = new Map<string, string>([
  [
    "packages/web/src/hydration-branch.tsx",
    `"use client";\r
const marker = "😀";\r
export const HydrationBranch = () =>\r
  typeof window === "undefined" ? <Server /> : <Client />;\r
export const StableBranch = () =>\r
  typeof document === "undefined" ? <span>same</span> : <span>same</span>;`,
  ],
  [
    "packages/web/src/browser-read.tsx",
    `import { useClientReady, useReadyOnServer } from "./hydration-hooks";

export const SafeBrowserRead = () => {
  const hydrated = useClientReady();
  return hydrated && <span>{document.title}</span>;
};

export const UnsafeBrowserRead = () => {
  const readyOnServer = useReadyOnServer();
  return readyOnServer && <span>{window.innerWidth}</span>;
};`,
  ],
  [
    "packages/web/src/hooks.ts",
    `import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);
const useServerReady = () => useSyncExternalStore(subscribe, () => true, () => true);

export { useHydrated, useServerReady };`,
  ],
  [
    "packages/web/src/hydration-hooks/index.ts",
    `export {
  useHydrated as useClientReady,
  useServerReady as useReadyOnServer,
} from "../hooks";`,
  ],
  [
    "packages/web/src/media.tsx",
    `import { useEffect, useState } from "react";

export const Media = () => {
  const [isCompact] = useState(() => window.matchMedia("(max-width: 48rem)").matches);
  useEffect(() => {
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);
  return <output>{String(isCompact)}</output>;
};`,
  ],
  [
    "packages/web/src/time.tsx",
    `export const CurrentTime = () => <time>{Date.now()}</time>;
export const IntentionalTime = () => <time suppressHydrationWarning>{Date.now()}</time>;`,
  ],
  [
    "packages/web/src/open-window.ts",
    `import {
  externalDownloadPage,
  localDownloadTarget,
} from "./url-paths";
import { missingDownloadPage } from "./missing-paths";

window.open(localDownloadTarget, "_blank");
window.open(externalDownloadPage, "_blank");
window.open(missingDownloadPage, "_blank");
window.open("https://example.com", "_blank", "noopener");`,
  ],
  [
    "packages/web/src/open-window-helper.ts",
    `import {
  buildExternalUrl as buildExternalDownloadUrl,
  buildInternalUrl as buildLocalDownloadUrl,
} from "./route-paths";

window.open(buildLocalDownloadUrl(), "_blank");
window.open(buildExternalDownloadUrl(), "_blank");`,
  ],
  [
    "packages/web/src/route-paths.ts",
    `export const internalDownloadPath = "/downloads/latest";
export const externalPage = "https://downloads.example.com/latest";
export const buildInternalUrl = () => "/downloads/archive";
export const buildExternalUrl = () => "https://downloads.example.com/archive";`,
  ],
  [
    "packages/web/src/url-paths/index.ts",
    `export {
  externalPage as externalDownloadPage,
  internalDownloadPath as localDownloadTarget,
} from "../route-paths";`,
  ],
  [
    "packages/native/src/skipped.tsx",
    `import { useState } from "react";

export const NativeScreen = () => {
  const [compact] = useState(matchMedia("(max-width: 48rem)").matches);
  return typeof window === "undefined"
    ? <Text>{Date.now()}</Text>
    : <Text>{document.title}{String(compact)}</Text>;
};`,
  ],
  [
    "packages/native/src/active.web.tsx",
    `export const WebOverride = () => <time>{Date.now()}</time>;`,
  ],
  [
    "packages/web/src/skipped.native.tsx",
    `export const NativeOverride = () => <time>{Date.now()}</time>;`,
  ],
]);
const BROWSER_HYDRATION_VIRTUAL_PACKAGES: ReadonlyArray<InMemoryResourcePackageInput> = [
  {
    directoryPath: "packages/web",
    manifest: {
      name: "web-package",
      dependencies: { next: "15.4.0", react: "19.1.0", "react-dom": "19.1.0" },
    },
  },
  {
    directoryPath: "packages/native",
    manifest: {
      name: "native-package",
      dependencies: { next: "15.4.0", react: "19.1.0", "react-native": "0.80.0" },
    },
  },
];
const BROWSER_HYDRATION_RESOURCE_FILES = new Map(
  BROWSER_HYDRATION_VIRTUAL_PACKAGES.map((projectPackage): [string, string] => [
    `${projectPackage.directoryPath}/package.json`,
    JSON.stringify(projectPackage.manifest),
  ]),
);
const NEXT_RULES: ReadonlyArray<OxlintProjectParityRule> = [
  { ruleId: "nextjs-async-dynamic-api-not-awaited", severity: "error" },
  { ruleId: "nextjs-no-img-element", severity: "warn" },
];
const NEXT_PROJECT_FILES = new Map<string, string>([
  [
    "packages/next15/app/page.tsx",
    `"use client";\r
import { cookies } from "next/headers";\r
const marker = "😀";\r
export default function Page({ params }) {\r
  const locale = params.locale;\r
  return <main>{marker}{cookies().get("session")?.value}{locale}<img src="/hero.png" /></main>;\r
}`,
  ],
  [
    "packages/next15/pages/legacy.tsx",
    `import * as NextHeaders from "next/headers";
export default function Legacy() {
  return <span>{NextHeaders.headers().get("host")}<img src="/legacy.png" /></span>;
}`,
  ],
  [
    "packages/next15/lib/card.tsx",
    `export const Card = () => <img src="/social-card.png" alt="" />;`,
  ],
  ["packages/next15/lib/index.ts", `export { Card as SocialCard } from "./card";`],
  [
    "packages/next15/lib/forwarded-card.tsx",
    `import { SocialCard } from "./index";
export const ForwardedCard = () => <SocialCard />;`,
  ],
  [
    "packages/next15/app/api/card/route.tsx",
    `import { ImageResponse as OgResponse } from "next/og";
import { ForwardedCard as Card } from "../../../lib/forwarded-card";
export const GET = () => new OgResponse(<Card />);`,
  ],
  [
    "packages/next14/app/page.tsx",
    `import { cookies } from "next/headers";
export default function Page() {
  return <main>{cookies().get("session")}<img src="/next-14.png" /></main>;
}`,
  ],
  [
    "packages/web/src/component.tsx",
    `import { cookies } from "next/headers";
export const Component = () => <main>{cookies().get("session")}<img src="/web.png" /></main>;`,
  ],
  [
    "packages/next15/app/unresolved.ts",
    `import { missing } from "./missing";
export const unresolved = missing;`,
  ],
]);
const NEXT_VIRTUAL_PACKAGES: ReadonlyArray<InMemoryResourcePackageInput> = [
  {
    directoryPath: "packages/next15",
    manifest: {
      name: "next-15-app",
      dependencies: { next: "15.4.0", react: "19.1.0", "react-dom": "19.1.0" },
    },
  },
  {
    directoryPath: "packages/next14",
    manifest: {
      name: "next-14-app",
      dependencies: { next: "14.2.0", react: "18.3.0", "react-dom": "18.3.0" },
    },
  },
  {
    directoryPath: "packages/web",
    manifest: {
      name: "web-package",
      dependencies: { react: "19.1.0", "react-dom": "19.1.0", vite: "7.0.0" },
    },
  },
];
const NEXT_RESOURCE_FILES = new Map(
  NEXT_VIRTUAL_PACKAGES.map((projectPackage): [string, string] => [
    `${projectPackage.directoryPath}/package.json`,
    JSON.stringify(projectPackage.manifest),
  ]),
);
const createRulePackageDependency = (
  name: string,
  resolvedSpecifier: string,
): Readonly<Record<string, string>> => ({
  name,
  section: "dependencies",
  rawSpecifier: resolvedSpecifier,
  resolvedSpecifier,
});
const createNextSettings = (rootDirectory: string): Readonly<Record<string, unknown>> => ({
  "react-doctor": {
    rootDirectory,
    capabilities: ["react", "nextjs", "nextjs:15", "nextjs:16"],
    framework: "nextjs",
    packageCapabilityGates: true,
    packageContextEnabled: true,
    packageContexts: [
      {
        relativeDirectory: "packages/next15",
        capabilities: ["react", "react:19", "nextjs", "nextjs:15"],
        dependencies: [
          createRulePackageDependency("next", "15.4.0"),
          createRulePackageDependency("react", "19.1.0"),
        ],
      },
      {
        relativeDirectory: "packages/next14",
        capabilities: ["react", "nextjs"],
        dependencies: [
          createRulePackageDependency("next", "14.2.0"),
          createRulePackageDependency("react", "18.3.0"),
        ],
      },
      {
        relativeDirectory: "packages/web",
        capabilities: ["react", "react:19", "vite"],
        dependencies: [
          createRulePackageDependency("react", "19.1.0"),
          createRulePackageDependency("vite", "7.0.0"),
        ],
      },
    ],
  },
});

const temporaryDirectories: string[] = [];
const esmRequire = createRequire(import.meta.url);
const oxlintMainPath = esmRequire.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);
const pluginPath = path.resolve(import.meta.dirname, "../../dist/index.js");

const runOxlintProject = (input: OxlintProjectParityInput): OxlintRunResult => {
  const temporaryDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-evaluator-parity-")),
  );
  temporaryDirectories.push(temporaryDirectory);
  const configPath = path.join(temporaryDirectory, "oxlintrc.json");
  const settings =
    typeof input.settings === "function" ? input.settings(temporaryDirectory) : input.settings;
  const projectResources = new Map(input.resourceFiles);
  for (const [filename, sourceText] of input.files) {
    projectResources.set(filename, sourceText);
  }
  for (const [filename, sourceText] of projectResources) {
    const sourcePath = path.join(temporaryDirectory, filename);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, sourceText, "utf8");
  }
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      categories: {
        correctness: "off",
        suspicious: "off",
        pedantic: "off",
        perf: "off",
        restriction: "off",
        style: "off",
        nursery: "off",
      },
      plugins: [],
      jsPlugins: [pluginPath],
      ...(settings === undefined ? {} : { settings }),
      rules: Object.fromEntries(
        input.rules.map(({ ruleId, severity }) => [`react-doctor/${ruleId}`, severity]),
      ),
    }),
    "utf8",
  );

  const oxlintResult = spawnSync(
    oxlintBinaryPath,
    ["--config", configPath, "--format", "json", "--threads", "1", ...input.files.keys()],
    {
      cwd: temporaryDirectory,
      encoding: "utf8",
    },
  );
  expect(oxlintResult.error).toBeUndefined();
  return {
    output: JSON.parse(oxlintResult.stdout),
    rootDirectory: temporaryDirectory,
    status: oxlintResult.status,
    stderr: oxlintResult.stderr,
  };
};

const runOxlint = (parityCase: EvaluatorParityCase): OxlintRunResult =>
  runOxlintProject({
    files: new Map([[parityCase.filename, parityCase.sourceText]]),
    rules: [{ ruleId: parityCase.ruleId, severity: parityCase.severity }],
  });

const normalizeOxlintDiagnostics = (
  result: OxlintRunResult,
): ReadonlyArray<ComparableParityDiagnostic> =>
  result.output.diagnostics.map((diagnostic) => ({
    filePath: path
      .relative(result.rootDirectory, path.resolve(result.rootDirectory, diagnostic.filename))
      .replaceAll("\\", "/"),
    rule: diagnostic.code.replace(/^react-doctor\((.+)\)$/, "$1"),
    severity: diagnostic.severity,
    message: diagnostic.message,
    line: diagnostic.labels[0]?.span.line,
    column: diagnostic.labels[0]?.span.column,
    offset: diagnostic.labels[0]?.span.offset,
    length: diagnostic.labels[0]?.span.length,
  }));

const normalizeEvaluatorDiagnostics = (
  diagnostics: ReadonlyArray<EvaluatorDiagnostic>,
): ReadonlyArray<ComparableParityDiagnostic> =>
  diagnostics.map((diagnostic) => ({
    filePath: diagnostic.filePath,
    rule: diagnostic.rule,
    severity: diagnostic.severity,
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
    offset: diagnostic.offset,
    length: diagnostic.length,
  }));

const slugifyFixtureName = (fixtureName: string): string =>
  fixtureName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const buildDifferentialFixtureFiles = (
  group: DifferentialFixtureGroup,
): ReadonlyMap<string, string> =>
  new Map(
    group.cases.map((fixtureCase, caseIndex) => [
      `corpus/${group.ruleId}/${String(caseIndex).padStart(2, "0")}-${slugifyFixtureName(fixtureCase.name)}.tsx`,
      fixtureCase.sourceText,
    ]),
  );

const mergeEvaluatorResults = (
  results: ReadonlyArray<EvaluateSourceResult>,
): EvaluateSourceResult => ({
  diagnostics: results.flatMap((result) => result.diagnostics),
  failures: results.flatMap((result) => result.failures),
});

const evaluateSourceFixtureGroup = (
  group: DifferentialFixtureGroup,
  files: ReadonlyMap<string, string>,
): EvaluateSourceResult =>
  mergeEvaluatorResults(
    [...files].map(([filename, sourceText]) =>
      evaluateSource({
        sourceText,
        filename,
        ruleIds: [group.ruleId],
        settings: group.settings,
      }),
    ),
  );

const assertExpectedDifferentialCounts = (
  cases: ReadonlyArray<DifferentialFixtureCase>,
  files: ReadonlyMap<string, string>,
  diagnostics: ReadonlyArray<EvaluatorDiagnostic>,
): void => {
  const filenames = [...files.keys()];
  for (const [caseIndex, fixtureCase] of cases.entries()) {
    const filename = filenames[caseIndex];
    expect(filename).toBeDefined();
    expect(
      diagnostics.filter((diagnostic) => diagnostic.filePath === filename),
      fixtureCase.provenance,
    ).toHaveLength(fixtureCase.expectedDiagnosticCount);
  }
};

const evaluateComparableDiagnostics = (
  parityCase: EvaluatorParityCase,
): ReadonlyArray<ComparableParityDiagnostic> => {
  const evaluatorResult = evaluateSource({
    sourceText: parityCase.sourceText,
    filename: parityCase.filename,
    ruleIds: [parityCase.ruleId],
  });
  expect(evaluatorResult.failures).toEqual([]);
  return normalizeEvaluatorDiagnostics(evaluatorResult.diagnostics);
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("in-process evaluator and Oxlint parity", () => {
  for (const parityCase of PARITY_CORPUS) {
    it(`matches Oxlint exactly for ${parityCase.ruleId}`, () => {
      const oxlintResult = runOxlint(parityCase);
      expect(oxlintResult.stderr).toBe("");
      expect(oxlintResult.status).toBe(parityCase.severity === "error" ? 1 : 0);
      expect(evaluateComparableDiagnostics(parityCase)).toEqual(
        normalizeOxlintDiagnostics(oxlintResult),
      );
    });
  }

  describe("deterministic differential fixture corpus", () => {
    for (const group of DIFFERENTIAL_FIXTURE_GROUPS) {
      it(`matches ${group.cases.length} ${group.ruleId} fixtures across repeated state`, () => {
        const files = buildDifferentialFixtureFiles(group);
        const oxlintResult = runOxlintProject({
          files,
          rules: [{ ruleId: group.ruleId, severity: group.severity }],
          settings: group.settings,
        });
        const expectedDiagnosticCount = group.cases.reduce(
          (total, fixtureCase) => total + fixtureCase.expectedDiagnosticCount,
          0,
        );
        expect(oxlintResult.stderr).toBe("");
        expect(oxlintResult.status).toBe(
          group.severity === "error" && expectedDiagnosticCount > 0 ? 1 : 0,
        );

        let evaluatorResult: EvaluateSourceResult;
        let repeatedEvaluatorResult: EvaluateSourceResult;
        if (group.evaluationMode === "source") {
          evaluatorResult = evaluateSourceFixtureGroup(group, files);
          repeatedEvaluatorResult = evaluateSourceFixtureGroup(group, files);
        } else {
          const realResourceHost = createRealFilesystemResourceHost({
            rootDirectory: oxlintResult.rootDirectory,
          });
          const realResult = evaluateProject({
            files,
            resourceHost: realResourceHost,
            ruleIds: [group.ruleId],
            settings: group.settings,
          });
          const repeatedRealResult = evaluateProject({
            files,
            resourceHost: realResourceHost,
            ruleIds: [group.ruleId],
            settings: group.settings,
          });
          const virtualRootDirectory = `/virtual-differential-${group.ruleId}`;
          const virtualResult = evaluateVirtualProject({
            rootDirectory: virtualRootDirectory,
            files,
            ruleIds: [group.ruleId],
            settings: group.settings,
          });
          const repeatedVirtualResult = evaluateVirtualProject({
            rootDirectory: virtualRootDirectory,
            files,
            ruleIds: [group.ruleId],
            settings: group.settings,
          });

          expect(repeatedRealResult).toEqual(realResult);
          expect(virtualResult).toEqual(realResult);
          expect(repeatedVirtualResult).toEqual(virtualResult);
          evaluatorResult = virtualResult;
          repeatedEvaluatorResult = repeatedVirtualResult;
        }

        expect(repeatedEvaluatorResult).toEqual(evaluatorResult);
        expect(evaluatorResult.failures).toEqual([]);
        assertExpectedDifferentialCounts(group.cases, files, evaluatorResult.diagnostics);
        expect(normalizeEvaluatorDiagnostics(evaluatorResult.diagnostics)).toEqual(
          normalizeOxlintDiagnostics(oxlintResult),
        );
      });
    }

    for (const [projectIndex, projectCase] of DIFFERENTIAL_VIRTUAL_PROJECT_CASES.entries()) {
      it(`matches virtual project: ${projectCase.name}`, () => {
        const oxlintResult = runOxlintProject({
          files: projectCase.files,
          rules: [{ ruleId: projectCase.ruleId, severity: projectCase.severity }],
        });
        const realResourceHost = createRealFilesystemResourceHost({
          rootDirectory: oxlintResult.rootDirectory,
        });
        const realResult = evaluateProject({
          files: projectCase.files,
          resourceHost: realResourceHost,
          ruleIds: [projectCase.ruleId],
        });
        const repeatedRealResult = evaluateProject({
          files: projectCase.files,
          resourceHost: realResourceHost,
          ruleIds: [projectCase.ruleId],
        });
        const virtualRootDirectory = `/virtual-differential-project-${projectIndex}`;
        const virtualResult = evaluateVirtualProject({
          rootDirectory: virtualRootDirectory,
          files: projectCase.files,
          ruleIds: [projectCase.ruleId],
        });
        const repeatedVirtualResult = evaluateVirtualProject({
          rootDirectory: virtualRootDirectory,
          files: projectCase.files,
          ruleIds: [projectCase.ruleId],
        });
        const expectedDiagnosticCount = [
          ...projectCase.expectedDiagnosticCountByFile.values(),
        ].reduce((total, count) => total + count, 0);

        expect(oxlintResult.stderr).toBe("");
        expect(oxlintResult.status).toBe(
          projectCase.severity === "error" && expectedDiagnosticCount > 0 ? 1 : 0,
        );
        expect(repeatedRealResult).toEqual(realResult);
        expect(virtualResult).toEqual(realResult);
        expect(repeatedVirtualResult).toEqual(virtualResult);
        expect(virtualResult.failures, projectCase.provenance).toEqual([]);
        for (const filename of projectCase.files.keys()) {
          expect(
            virtualResult.diagnostics.filter((diagnostic) => diagnostic.filePath === filename),
            projectCase.provenance,
          ).toHaveLength(projectCase.expectedDiagnosticCountByFile.get(filename) ?? 0);
        }
        expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
          normalizeOxlintDiagnostics(oxlintResult),
        );
      });
    }

    it("keeps unsupported, unknown, and parse failures exact across repeated state", () => {
      const input = {
        sourceText: 'const marker = "😀";\r\nconst broken = ;',
        filename: "src/broken.ts",
        ruleIds: ["missing-differential-rule", "no-barrel-import", "no-eval"],
      };
      const firstResult = evaluateSource(input);
      const repeatedResult = evaluateSource(input);

      expect(repeatedResult).toEqual(firstResult);
      expect(firstResult).toEqual({
        diagnostics: [],
        failures: [
          {
            kind: "unknown-rule",
            filePath: "src/broken.ts",
            rule: "missing-differential-rule",
            message: "Unknown React Doctor rule: missing-differential-rule",
          },
          {
            kind: "unsupported-rule",
            filePath: "src/broken.ts",
            rule: "no-barrel-import",
            message: "Rule requires a project host: no-barrel-import",
          },
          {
            kind: "parse",
            filePath: "src/broken.ts",
            message: "Unexpected token",
            line: 2,
            column: 16,
            offset: 39,
            length: 1,
          },
        ],
      });
    });

    it("serializes rule crashes in deterministic file and rule order across repeated state", () => {
      const crashingRuleSettings = new Proxy<Record<string, unknown>>(
        {},
        {
          get: (_target, property) => {
            if (property === "buttonHasType") {
              throw new Error("button settings unavailable");
            }
            return undefined;
          },
        },
      );
      const input = {
        rootDirectory: "/virtual-rule-crash-project",
        files: new Map<string, string>([
          [
            "src/z-last.tsx",
            `eval(first);
export const Last = () => <button>Save</button>;
eval(second);`,
          ],
          [
            "src/a-first.tsx",
            `export const First = () => <button>Open</button>;
eval(third);`,
          ],
        ]),
        ruleIds: [
          "missing-differential-rule",
          "active-static-asset",
          "button-has-type",
          "no-eval",
          "button-has-type",
        ],
        settings: {
          "react-doctor": crashingRuleSettings,
        },
      };
      const firstResult = evaluateVirtualProject(input);
      const repeatedResult = evaluateVirtualProject(input);

      expect(repeatedResult).toEqual(firstResult);
      expect(
        firstResult.diagnostics.map(({ filePath, rule, line }) => ({ filePath, rule, line })),
      ).toEqual([
        { filePath: "src/z-last.tsx", rule: "no-eval", line: 1 },
        { filePath: "src/z-last.tsx", rule: "no-eval", line: 3 },
        { filePath: "src/a-first.tsx", rule: "no-eval", line: 2 },
      ]);
      expect(firstResult.failures).toEqual([
        {
          kind: "unknown-rule",
          filePath: "src/z-last.tsx",
          rule: "missing-differential-rule",
          message: "Unknown React Doctor rule: missing-differential-rule",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/z-last.tsx",
          rule: "active-static-asset",
          message: "Rule requires a project host: active-static-asset",
        },
        {
          kind: "rule-crash",
          filePath: "src/z-last.tsx",
          rule: "button-has-type",
          message: "button settings unavailable",
        },
        {
          kind: "rule-crash",
          filePath: "src/z-last.tsx",
          rule: "button-has-type",
          message: "button settings unavailable",
        },
        {
          kind: "unknown-rule",
          filePath: "src/a-first.tsx",
          rule: "missing-differential-rule",
          message: "Unknown React Doctor rule: missing-differential-rule",
        },
        {
          kind: "unsupported-rule",
          filePath: "src/a-first.tsx",
          rule: "active-static-asset",
          message: "Rule requires a project host: active-static-asset",
        },
        {
          kind: "rule-crash",
          filePath: "src/a-first.tsx",
          rule: "button-has-type",
          message: "button settings unavailable",
        },
        {
          kind: "rule-crash",
          filePath: "src/a-first.tsx",
          rule: "button-has-type",
          message: "button settings unavailable",
        },
      ]);
    });
  });

  it("preserves exact multi-file and multi-rule ordering across repeated evaluations", () => {
    const files = new Map<string, string>([
      [
        "src/z-last.tsx",
        `import { useState } from "react";

export const Last = ({ enabled }: { enabled: boolean }) => {
  if (enabled) useState(0);
  return <button accessKey="s">Save</button>;
};
eval(lastSource);`,
      ],
      [
        "src/a-first.tsx",
        `eval(firstSource);
export const First = () => <button accessKey="f">Open</button>;`,
      ],
    ]);
    const rules: ReadonlyArray<OxlintProjectParityRule> = [
      { ruleId: "no-access-key", severity: "warn" },
      { ruleId: "button-has-type", severity: "warn" },
      { ruleId: "rules-of-hooks", severity: "error" },
      { ruleId: "no-eval", severity: "error" },
    ];
    const firstOxlintResult = runOxlintProject({ files, rules });
    const secondOxlintResult = runOxlintProject({ files, rules });
    expect(firstOxlintResult.stderr).toBe("");
    expect(secondOxlintResult.stderr).toBe("");
    expect(firstOxlintResult.status).toBe(1);
    expect(secondOxlintResult.status).toBe(1);

    const resourceHost = createRealFilesystemResourceHost({
      rootDirectory: firstOxlintResult.rootDirectory,
    });
    const evaluatorInput = {
      files,
      resourceHost,
      ruleIds: rules.map(({ ruleId }) => ruleId),
    };
    const firstEvaluatorResult = evaluateProject(evaluatorInput);
    const poisoningResult = evaluateSource({
      sourceText: `import { useState } from "react";

export const Poison = ({ enabled }: { enabled: boolean }) => {
  if (enabled) useState(0);
  return null;
};`,
      filename: "src/poison.tsx",
      ruleIds: ["rules-of-hooks"],
    });
    const secondEvaluatorResult = evaluateProject(evaluatorInput);

    expect(poisoningResult.failures).toEqual([]);
    expect(poisoningResult.diagnostics.map((diagnostic) => diagnostic.rule)).toEqual([
      "rules-of-hooks",
    ]);
    expect(firstEvaluatorResult.failures).toEqual([]);
    expect(secondEvaluatorResult).toEqual(firstEvaluatorResult);
    expect(normalizeOxlintDiagnostics(secondOxlintResult)).toEqual(
      normalizeOxlintDiagnostics(firstOxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(firstEvaluatorResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(firstOxlintResult),
    );
  });

  it("matches the complete React Router family across real, virtual, and built hosts", () => {
    const oxlintResult = runOxlintProject({
      files: REACT_ROUTER_PROJECT_FILES,
      resourceFiles: REACT_ROUTER_RESOURCE_FILES,
      rules: REACT_ROUTER_RULES,
      settings: createReactRouterSettings,
    });
    const realResult = evaluateProject({
      files: REACT_ROUTER_PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: REACT_ROUTER_RULE_IDS,
      settings: createReactRouterSettings(oxlintResult.rootDirectory),
    });
    const virtualRootDirectory = "/virtual-react-router-project";
    const virtualResult = evaluateVirtualProject({
      rootDirectory: virtualRootDirectory,
      files: REACT_ROUTER_PROJECT_FILES,
      packages: REACT_ROUTER_VIRTUAL_PACKAGES,
      ruleIds: REACT_ROUTER_RULE_IDS,
      settings: createReactRouterSettings(virtualRootDirectory),
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(1);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "src/route.tsx",
        rule: "react-router-no-navigate-in-render",
        severity: "error",
        message:
          "navigate() runs during render and can cause navigation loops or hydration divergence.",
        line: 5,
        column: 3,
        offset: 110,
        length: 17,
      },
    ]);
  });

  it("keeps the complete React Router family quiet outside React Router packages", () => {
    const files = new Map<string, string>([
      ["packages/web/src/route.tsx", REACT_ROUTER_ROUTE_SOURCE_TEXT],
    ]);
    const resourceFiles = new Map<string, string>([
      [
        "packages/web/package.json",
        JSON.stringify({
          name: "vite-project",
          dependencies: { react: "19.1.0", vite: "7.0.0" },
        }),
      ],
    ]);
    const oxlintResult = runOxlintProject({
      files,
      resourceFiles,
      rules: REACT_ROUTER_RULES,
      settings: createReactRouterSettings,
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: REACT_ROUTER_RULE_IDS,
      settings: createReactRouterSettings(oxlintResult.rootDirectory),
    });
    const virtualRootDirectory = "/virtual-non-react-router-project";
    const virtualResult = evaluateVirtualProject({
      rootDirectory: virtualRootDirectory,
      files,
      packages: [
        {
          directoryPath: "packages/web",
          manifest: {
            name: "vite-project",
            dependencies: { react: "19.1.0", vite: "7.0.0" },
          },
          installedDependencyVersions: { react: "19.1.0", vite: "7.0.0" },
        },
      ],
      ruleIds: REACT_ROUTER_RULE_IDS,
      settings: createReactRouterSettings(virtualRootDirectory),
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(normalizeOxlintDiagnostics(oxlintResult)).toEqual([]);
    expect(realResult).toEqual({ diagnostics: [], failures: [] });
    expect(virtualResult).toEqual(realResult);
  });

  it("keeps the React Router family unsupported without a project host", () => {
    const result = evaluateSource({
      sourceText: REACT_ROUTER_ROUTE_SOURCE_TEXT,
      filename: "src/route.tsx",
      ruleIds: REACT_ROUTER_RULE_IDS,
      settings: createReactRouterSettings("/virtual-react-router-project"),
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.failures).toEqual(
      REACT_ROUTER_RULE_IDS.map((ruleId) => ({
        kind: "unsupported-rule",
        filePath: "src/route.tsx",
        rule: ruleId,
        message: `Rule requires a project host: ${ruleId}`,
      })),
    );
  });

  it("matches React Native framework gating across real, virtual, and built hosts", () => {
    const oxlintResult = runOxlintProject({
      files: REACT_NATIVE_PROJECT_FILES,
      resourceFiles: REACT_NATIVE_RESOURCE_FILES,
      rules: [{ ruleId: REACT_NATIVE_RULE_ID, severity: "error" }],
      settings: REACT_NATIVE_SETTINGS,
    });
    const realResult = evaluateProject({
      files: REACT_NATIVE_PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: REACT_NATIVE_SETTINGS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-react-native-project",
      files: REACT_NATIVE_PROJECT_FILES,
      packages: REACT_NATIVE_VIRTUAL_PACKAGES,
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: REACT_NATIVE_SETTINGS,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(1);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "packages/native/src/app.tsx",
        rule: REACT_NATIVE_RULE_ID,
        severity: "error",
        message:
          'Your users hit a crash when raw "😀 Crash" renders outside a <Text> component on React Native.',
        line: 5,
        column: 11,
        offset: 85,
        length: 10,
      },
      {
        filePath: "packages/native/src/app.tsx",
        rule: REACT_NATIVE_RULE_ID,
        severity: "error",
        message:
          'Your users hit a crash when raw "Direct crash" renders outside a <Text> component on React Native.',
        line: 7,
        column: 11,
        offset: 137,
        length: 12,
      },
      {
        filePath: "packages/web/src/component.native.tsx",
        rule: REACT_NATIVE_RULE_ID,
        severity: "error",
        message:
          'Your users hit a crash when raw "Native override text" renders outside a <Text> component on React Native.',
        line: 1,
        column: 44,
        offset: 43,
        length: 20,
      },
      {
        filePath: "src/loose.tsx",
        rule: REACT_NATIVE_RULE_ID,
        severity: "error",
        message:
          'Your users hit a crash when raw "Framework text" renders outside a <Text> component on React Native.',
        line: 1,
        column: 43,
        offset: 42,
        length: 14,
      },
    ]);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, line, column, endLine, endColumn, offset, length }) => ({
          filePath,
          line,
          column,
          endLine,
          endColumn,
          offset,
          length,
        }),
      ),
    ).toEqual([
      {
        filePath: "packages/native/src/app.tsx",
        line: 5,
        column: 11,
        endLine: 5,
        endColumn: 21,
        offset: 85,
        length: 10,
      },
      {
        filePath: "packages/native/src/app.tsx",
        line: 7,
        column: 11,
        endLine: 7,
        endColumn: 23,
        offset: 137,
        length: 12,
      },
      {
        filePath: "packages/web/src/component.native.tsx",
        line: 1,
        column: 44,
        endLine: 1,
        endColumn: 64,
        offset: 43,
        length: 20,
      },
      {
        filePath: "src/loose.tsx",
        line: 1,
        column: 43,
        endLine: 1,
        endColumn: 57,
        offset: 42,
        length: 14,
      },
    ]);
  });

  it("matches an explicit web framework gate across real, virtual, and built hosts", () => {
    const files = new Map([
      ["src/ambiguous.tsx", `export const Component = () => <View>Web text</View>;`],
    ]);
    const oxlintResult = runOxlintProject({
      files,
      rules: [{ ruleId: REACT_NATIVE_RULE_ID, severity: "error" }],
      settings: WEB_SETTINGS,
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: WEB_SETTINGS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-web-project",
      files,
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: WEB_SETTINGS,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(normalizeOxlintDiagnostics(oxlintResult)).toEqual([]);
    expect(realResult).toEqual({ diagnostics: [], failures: [] });
    expect(virtualResult).toEqual(realResult);
  });

  it("matches an explicit missing React Native capability across all hosts", () => {
    const files = new Map([
      ["src/ambiguous.tsx", `export const Component = () => <View>Native text</View>;`],
    ]);
    const oxlintResult = runOxlintProject({
      files,
      rules: [{ ruleId: REACT_NATIVE_RULE_ID, severity: "error" }],
      settings: MISSING_REACT_NATIVE_CAPABILITY_SETTINGS,
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: MISSING_REACT_NATIVE_CAPABILITY_SETTINGS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-missing-react-native-capability-project",
      files,
      ruleIds: [REACT_NATIVE_RULE_ID],
      settings: MISSING_REACT_NATIVE_CAPABILITY_SETTINGS,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(normalizeOxlintDiagnostics(oxlintResult)).toEqual([]);
    expect(realResult).toEqual({ diagnostics: [], failures: [] });
    expect(virtualResult).toEqual(realResult);
  });

  it("matches Next.js package, version, cross-file ownership, and UTF-8 spans across hosts", () => {
    const oxlintResult = runOxlintProject({
      files: NEXT_PROJECT_FILES,
      resourceFiles: NEXT_RESOURCE_FILES,
      rules: NEXT_RULES,
      settings: createNextSettings,
    });
    const realSettings = createNextSettings(oxlintResult.rootDirectory);
    const realResult = evaluateProject({
      files: NEXT_PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: NEXT_RULES.map(({ ruleId }) => ruleId),
      settings: realSettings,
    });
    const virtualRootDirectory = "/virtual-next-project";
    const virtualResult = evaluateVirtualProject({
      rootDirectory: virtualRootDirectory,
      files: NEXT_PROJECT_FILES,
      packages: NEXT_VIRTUAL_PACKAGES,
      ruleIds: NEXT_RULES.map(({ ruleId }) => ruleId),
      settings: createNextSettings(virtualRootDirectory),
    });
    const repeatedVirtualResult = evaluateVirtualProject({
      rootDirectory: virtualRootDirectory,
      files: NEXT_PROJECT_FILES,
      packages: NEXT_VIRTUAL_PACKAGES,
      ruleIds: NEXT_RULES.map(({ ruleId }) => ruleId),
      settings: createNextSettings(virtualRootDirectory),
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(1);
    expect(virtualResult).toEqual(realResult);
    expect(repeatedVirtualResult).toEqual(virtualResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "packages/next15/app/page.tsx",
        rule: "nextjs-async-dynamic-api-not-awaited",
        severity: "error",
        message:
          "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.",
        line: 5,
        column: 18,
        offset: 141,
        length: 6,
      },
      {
        filePath: "packages/next15/app/page.tsx",
        rule: "nextjs-async-dynamic-api-not-awaited",
        severity: "error",
        message:
          "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.",
        line: 6,
        column: 25,
        offset: 181,
        length: 9,
      },
      {
        filePath: "packages/next15/app/page.tsx",
        rule: "nextjs-no-img-element",
        severity: "warning",
        message: "Plain <img> ships unoptimized, oversized images.",
        line: 6,
        column: 65,
        offset: 221,
        length: 23,
      },
      {
        filePath: "packages/next15/pages/legacy.tsx",
        rule: "nextjs-async-dynamic-api-not-awaited",
        severity: "error",
        message:
          "This Next.js request API returns a Promise. Synchronous property access warns in Next.js 15 and is removed in Next.js 16; await it or unwrap it with React `use()`.",
        line: 3,
        column: 17,
        offset: 96,
        length: 21,
      },
      {
        filePath: "packages/next15/pages/legacy.tsx",
        rule: "nextjs-no-img-element",
        severity: "warning",
        message: "Plain <img> ships unoptimized, oversized images.",
        line: 3,
        column: 51,
        offset: 130,
        length: 25,
      },
      {
        filePath: "packages/next14/app/page.tsx",
        rule: "nextjs-no-img-element",
        severity: "warning",
        message: "Plain <img> ships unoptimized, oversized images.",
        line: 3,
        column: 42,
        offset: 114,
        length: 26,
      },
    ]);
  });

  it("fails closed identically when a generated-image consumer graph cannot parse", () => {
    const files = new Map([
      [
        "packages/next15/lib/card.tsx",
        `export const Card = () => <img src="/social-card.png" alt="" />;`,
      ],
    ]);
    const resourceFiles = new Map<string, string>([
      ...NEXT_RESOURCE_FILES,
      [
        "packages/next15/app/api/card/route.tsx",
        `import { ImageResponse } from "next/og";
import { Card } from "../../../lib/card";
export const GET = () => new ImageResponse(<Card />);`,
      ],
      ["packages/next15/app/broken.tsx", `export const broken = ;`],
    ]);
    const oxlintResult = runOxlintProject({
      files,
      resourceFiles,
      rules: [{ ruleId: "nextjs-no-img-element", severity: "warn" }],
      settings: createNextSettings,
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: ["nextjs-no-img-element"],
      settings: createNextSettings(oxlintResult.rootDirectory),
    });
    const virtualResources = new Map(resourceFiles);
    for (const [filename, sourceText] of files) virtualResources.set(filename, sourceText);
    const virtualRootDirectory = "/virtual-malformed-next-project";
    const virtualResult = evaluateProject({
      files,
      resourceHost: createInMemoryResourceHost({
        rootDirectory: virtualRootDirectory,
        files: virtualResources,
        packages: NEXT_VIRTUAL_PACKAGES,
      }),
      ruleIds: ["nextjs-no-img-element"],
      settings: createNextSettings(virtualRootDirectory),
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "packages/next15/lib/card.tsx",
        rule: "nextjs-no-img-element",
        severity: "warning",
        message: "Plain <img> ships unoptimized, oversized images.",
        line: 1,
        column: 27,
        offset: 26,
        length: 37,
      },
    ]);
  });

  it("matches package-manifest and architecture gates across all hosts", () => {
    const oxlintResult = runOxlintProject({
      files: PACKAGE_MANIFEST_PROJECT_FILES,
      resourceFiles: PACKAGE_MANIFEST_RESOURCE_FILES,
      rules: PACKAGE_MANIFEST_RULES,
      settings: PACKAGE_MANIFEST_SETTINGS,
    });
    const realResult = evaluateProject({
      files: PACKAGE_MANIFEST_PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: PACKAGE_MANIFEST_RULES.map(({ ruleId }) => ruleId),
      settings: PACKAGE_MANIFEST_SETTINGS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-package-manifest-project",
      files: PACKAGE_MANIFEST_PROJECT_FILES,
      packages: PACKAGE_MANIFEST_VIRTUAL_PACKAGES,
      ruleIds: PACKAGE_MANIFEST_RULES.map(({ ruleId }) => ruleId),
      settings: PACKAGE_MANIFEST_SETTINGS,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "packages/web/src/lodash.ts",
        rule: "no-full-lodash-import",
        severity: "warning",
        message:
          "Importing all of lodash ships the whole library to your users & slows page load. Import from 'lodash/functionName' instead.",
        line: 2,
        column: 1,
        offset: 24,
        length: 28,
      },
      {
        filePath: "packages/expo/src/image.tsx",
        rule: "rn-prefer-expo-image",
        severity: "warning",
        message:
          "Your users watch images reload often because Image from react-native has no caching.",
        line: 2,
        column: 10,
        offset: 33,
        length: 20,
      },
      {
        filePath: "packages/modern/src/shadow.tsx",
        rule: "rn-no-legacy-shadow-styles",
        severity: "warning",
        message:
          'Shadow style "shadowOpacity" only work on one platform, so your users on the other see no shadow.',
        line: 1,
        column: 40,
        offset: 39,
        length: 22,
      },
      {
        filePath: "packages/modern/src/shadow.tsx",
        rule: "rn-style-prefer-boxshadow",
        severity: "warning",
        message: "Your users on the other platform see no shadow when you use shadowOpacity.",
        line: 1,
        column: 42,
        offset: 41,
        length: 18,
      },
      {
        filePath: "packages/web/src/shadow.native.tsx",
        rule: "rn-no-legacy-shadow-styles",
        severity: "warning",
        message:
          'Shadow style "elevation" only work on one platform, so your users on the other see no shadow.',
        line: 1,
        column: 40,
        offset: 39,
        length: 16,
      },
      {
        filePath: "packages/web/src/shadow.native.tsx",
        rule: "rn-style-prefer-boxshadow",
        severity: "warning",
        message: "Your users on the other platform see no shadow when you use elevation.",
        line: 1,
        column: 42,
        offset: 41,
        length: 12,
      },
      {
        filePath: "src/loose-image.tsx",
        rule: "rn-prefer-expo-image",
        severity: "warning",
        message:
          "Your users watch images reload often because Image from react-native has no caching.",
        line: 1,
        column: 10,
        offset: 9,
        length: 5,
      },
    ]);
    expect(
      virtualResult.diagnostics.map(
        ({ filePath, rule, line, column, endLine, endColumn, offset, length }) => ({
          filePath,
          rule,
          line,
          column,
          endLine,
          endColumn,
          offset,
          length,
        }),
      ),
    ).toEqual([
      {
        filePath: "packages/web/src/lodash.ts",
        rule: "no-full-lodash-import",
        line: 2,
        column: 1,
        endLine: 2,
        endColumn: 29,
        offset: 24,
        length: 28,
      },
      {
        filePath: "packages/expo/src/image.tsx",
        rule: "rn-prefer-expo-image",
        line: 2,
        column: 10,
        endLine: 2,
        endColumn: 30,
        offset: 33,
        length: 20,
      },
      {
        filePath: "packages/modern/src/shadow.tsx",
        rule: "rn-no-legacy-shadow-styles",
        line: 1,
        column: 40,
        endLine: 1,
        endColumn: 62,
        offset: 39,
        length: 22,
      },
      {
        filePath: "packages/modern/src/shadow.tsx",
        rule: "rn-style-prefer-boxshadow",
        line: 1,
        column: 42,
        endLine: 1,
        endColumn: 60,
        offset: 41,
        length: 18,
      },
      {
        filePath: "packages/web/src/shadow.native.tsx",
        rule: "rn-no-legacy-shadow-styles",
        line: 1,
        column: 40,
        endLine: 1,
        endColumn: 56,
        offset: 39,
        length: 16,
      },
      {
        filePath: "packages/web/src/shadow.native.tsx",
        rule: "rn-style-prefer-boxshadow",
        line: 1,
        column: 42,
        endLine: 1,
        endColumn: 54,
        offset: 41,
        length: 12,
      },
      {
        filePath: "src/loose-image.tsx",
        rule: "rn-prefer-expo-image",
        line: 1,
        column: 10,
        endLine: 1,
        endColumn: 15,
        offset: 9,
        length: 5,
      },
    ]);
  });

  it("matches browser and hydration rules across real, virtual, and built hosts", () => {
    const oxlintResult = runOxlintProject({
      files: BROWSER_HYDRATION_PROJECT_FILES,
      resourceFiles: BROWSER_HYDRATION_RESOURCE_FILES,
      rules: BROWSER_HYDRATION_RULES,
      settings: BROWSER_HYDRATION_SETTINGS,
    });
    const realResult = evaluateProject({
      files: BROWSER_HYDRATION_PROJECT_FILES,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: BROWSER_HYDRATION_RULES.map(({ ruleId }) => ruleId),
      settings: BROWSER_HYDRATION_SETTINGS,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-browser-hydration-project",
      files: BROWSER_HYDRATION_PROJECT_FILES,
      packages: BROWSER_HYDRATION_VIRTUAL_PACKAGES,
      ruleIds: BROWSER_HYDRATION_RULES.map(({ ruleId }) => ruleId),
      settings: BROWSER_HYDRATION_SETTINGS,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(1);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "packages/web/src/hydration-branch.tsx",
        rule: "no-hydration-branch-on-browser-global",
        severity: "error",
        message:
          "`typeof window` selects different rendered output on the server and during hydration. Render the same initial output, then switch after mount.",
        line: 4,
        column: 3,
        offset: 79,
        length: 29,
      },
      {
        filePath: "packages/web/src/browser-read.tsx",
        rule: "no-unguarded-browser-global-in-render-or-hook-init",
        severity: "error",
        message:
          "`window` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot.",
        line: 10,
        column: 34,
        offset: 321,
        length: 6,
      },
      {
        filePath: "packages/web/src/media.tsx",
        rule: "no-match-media-in-state-initializer",
        severity: "warning",
        message:
          "`matchMedia()` in a useState initializer can cause an SSR crash or seed different server and hydration state. Prefer CSS media queries for layout, or use `useSyncExternalStore` with a stable server snapshot.",
        line: 4,
        column: 38,
        offset: 112,
        length: 39,
      },
      {
        filePath: "packages/web/src/media.tsx",
        rule: "no-unguarded-browser-global-in-render-or-hook-init",
        severity: "error",
        message:
          "`window` is read while React is rendering on the server, where browser globals are unavailable. Move the read into an effect or event, or provide a stable server snapshot.",
        line: 4,
        column: 38,
        offset: 112,
        length: 6,
      },
      {
        filePath: "packages/web/src/time.tsx",
        rule: "rendering-hydration-mismatch-time",
        severity: "warning",
        message:
          "This can cause a hydration mismatch because Date.now() in JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.",
        line: 1,
        column: 40,
        offset: 39,
        length: 12,
      },
      {
        filePath: "packages/web/src/open-window.ts",
        rule: "window-open-without-noopener",
        severity: "warning",
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
        line: 8,
        column: 1,
        offset: 178,
        length: 43,
      },
      {
        filePath: "packages/web/src/open-window.ts",
        rule: "window-open-without-noopener",
        severity: "warning",
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
        line: 9,
        column: 1,
        offset: 223,
        length: 42,
      },
      {
        filePath: "packages/web/src/open-window-helper.ts",
        rule: "window-open-without-noopener",
        severity: "warning",
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
        line: 7,
        column: 1,
        offset: 175,
        length: 49,
      },
      {
        filePath: "packages/native/src/active.web.tsx",
        rule: "rendering-hydration-mismatch-time",
        severity: "warning",
        message:
          "This can cause a hydration mismatch because Date.now() in JSX gives a different value on the server than in the browser. Move it into useEffect+useState to run only in the browser, or add suppressHydrationWarning to the parent if it's on purpose.",
        line: 1,
        column: 40,
        offset: 39,
        length: 12,
      },
    ]);
  });

  it("fails closed identically when an imported browser destination cannot parse", () => {
    const files = new Map([
      [
        "src/open-window.ts",
        `import { downloadPage } from "./invalid-paths";
window.open(downloadPage, "_blank");`,
      ],
    ]);
    const resourceFiles = new Map([["src/invalid-paths.ts", "export const downloadPage = ;"]]);
    const oxlintResult = runOxlintProject({
      files,
      resourceFiles,
      rules: [{ ruleId: "window-open-without-noopener", severity: "warn" }],
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: ["window-open-without-noopener"],
    });
    const virtualResources = new Map(resourceFiles);
    for (const [filename, sourceText] of files) {
      virtualResources.set(filename, sourceText);
    }
    const virtualResult = evaluateProject({
      files,
      resourceHost: createInMemoryResourceHost({
        rootDirectory: "/virtual-invalid-browser-destination-project",
        files: virtualResources,
      }),
      ruleIds: ["window-open-without-noopener"],
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(virtualResult).toEqual(realResult);
    expect(virtualResult.failures).toEqual([]);
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual(
      normalizeOxlintDiagnostics(oxlintResult),
    );
    expect(normalizeEvaluatorDiagnostics(virtualResult.diagnostics)).toEqual([
      {
        filePath: "src/open-window.ts",
        rule: "window-open-without-noopener",
        severity: "warning",
        message:
          "This `window.open` call leaves the opened page able to redirect your tab via `window.opener`, so pass `'noopener'` in the features argument.",
        line: 2,
        column: 1,
        offset: 48,
        length: 35,
      },
    ]);
  });

  it("matches the missing SSR capability gate across all hosts", () => {
    const files = new Map([
      [
        "src/hydration.tsx",
        `"use client";
export const Hydration = () =>
  typeof window === "undefined" ? <Server /> : <Client />;`,
      ],
    ]);
    const settings = {
      "react-doctor": {
        capabilities: ["react"],
        framework: "nextjs",
        packageCapabilityGates: true,
      },
    };
    const oxlintResult = runOxlintProject({
      files,
      rules: BROWSER_HYDRATION_RULES,
      settings,
    });
    const realResult = evaluateProject({
      files,
      resourceHost: createRealFilesystemResourceHost({
        rootDirectory: oxlintResult.rootDirectory,
      }),
      ruleIds: BROWSER_HYDRATION_RULES.map(({ ruleId }) => ruleId),
      settings,
    });
    const virtualResult = evaluateVirtualProject({
      rootDirectory: "/virtual-missing-ssr-capability-project",
      files,
      ruleIds: BROWSER_HYDRATION_RULES.map(({ ruleId }) => ruleId),
      settings,
    });

    expect(oxlintResult.stderr).toBe("");
    expect(oxlintResult.status).toBe(0);
    expect(normalizeOxlintDiagnostics(oxlintResult)).toEqual([]);
    expect(realResult).toEqual({ diagnostics: [], failures: [] });
    expect(virtualResult).toEqual(realResult);
  });

  it("rejects project-host and project-scan rules instead of claiming parity", () => {
    const result = evaluateSource({
      sourceText: "export const value = true;",
      filename: "src/value.ts",
      ruleIds: [
        "nextjs-async-dynamic-api-not-awaited",
        "nextjs-no-img-element",
        "no-barrel-import",
        "active-static-asset",
      ],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.failures).toEqual([
      {
        kind: "unsupported-rule",
        filePath: "src/value.ts",
        rule: "nextjs-async-dynamic-api-not-awaited",
        message: "Rule requires a project host: nextjs-async-dynamic-api-not-awaited",
      },
      {
        kind: "unsupported-rule",
        filePath: "src/value.ts",
        rule: "nextjs-no-img-element",
        message: "Rule requires a project host: nextjs-no-img-element",
      },
      {
        kind: "unsupported-rule",
        filePath: "src/value.ts",
        rule: "no-barrel-import",
        message: "Rule requires a project host: no-barrel-import",
      },
      {
        kind: "unsupported-rule",
        filePath: "src/value.ts",
        rule: "active-static-asset",
        message: "Rule requires a project host: active-static-asset",
      },
    ]);
  });

  const inlineSuppressionCases: ReadonlyArray<InlineSuppressionParityCase> = [
    {
      name: "global disable and enable regions",
      sourceText: "// oxlint-disable\neval(first);\n// oxlint-enable\neval(second);",
      expectedDiagnosticLines: [4],
    },
    {
      name: "plugin-prefixed rule disable and enable regions",
      sourceText:
        "// oxlint-disable react-doctor/no-eval\neval(first);\n// oxlint-enable react-doctor/no-eval\neval(second);",
      expectedDiagnosticLines: [4],
    },
    {
      name: "bare rule IDs that Oxlint does not bind to a plugin rule",
      sourceText:
        "// oxlint-disable no-eval\neval(first);\n// oxlint-enable no-eval\neval(second);",
      expectedDiagnosticLines: [2, 4],
    },
    {
      name: "global disable-line",
      sourceText: "eval(first); // oxlint-disable-line\neval(second);",
      expectedDiagnosticLines: [2],
    },
    {
      name: "plugin-prefixed disable-line with a UTF-8 boundary",
      sourceText:
        'const emoji = "😀";\neval(first); // oxlint-disable-line react-doctor/no-eval\neval(second);',
      expectedDiagnosticLines: [3],
    },
    {
      name: "global disable-next-line across CRLF boundaries",
      sourceText: "// oxlint-disable-next-line\r\neval(first);\r\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "disable-next-line with lone CR compatibility",
      sourceText: "// oxlint-disable-next-line\reval(first);\reval(second);",
      expectedDiagnosticLines: [],
    },
    {
      name: "disable-next-line with U+2028 compatibility",
      sourceText: "// oxlint-disable-next-line\u2028eval(first);\u2028eval(second);",
      expectedDiagnosticLines: [],
    },
    {
      name: "disable-next-line with U+2029 compatibility",
      sourceText: "// oxlint-disable-next-line\u2029eval(first);\u2029eval(second);",
      expectedDiagnosticLines: [],
    },
    {
      name: "plugin-prefixed disable-next-line",
      sourceText: "// oxlint-disable-next-line react-doctor/no-eval\neval(first);\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "disable-line before a diagnostic on the same line",
      sourceText: "/* oxlint-disable-line react-doctor/no-eval */ eval(first);\neval(second);",
      expectedDiagnosticLines: [1, 2],
    },
    {
      name: "block disable-next-line before same-line and following-line diagnostics",
      sourceText:
        "/* oxlint-disable-next-line react-doctor/no-eval */ eval(first);\neval(second);\neval(third);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "multiple comma-separated rule IDs",
      sourceText:
        "// oxlint-disable-next-line react-doctor/button-has-type, react-doctor/no-eval\neval(first);\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "multiple whitespace-separated rule IDs",
      sourceText:
        "// oxlint-disable-next-line react-doctor/button-has-type react-doctor/no-eval\neval(first);\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "rule list followed by a description",
      sourceText:
        "// oxlint-disable-next-line react-doctor/no-eval -- intentional fixture\neval(first);\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "global disable followed by rule-specific enable",
      sourceText:
        "// oxlint-disable\neval(first);\n// oxlint-enable react-doctor/no-eval\neval(second);\n// oxlint-enable\neval(third);",
      expectedDiagnosticLines: [6],
    },
    {
      name: "rule-specific disable followed by global enable",
      sourceText:
        "// oxlint-disable react-doctor/no-eval\neval(first);\n// oxlint-enable\neval(second);\n// oxlint-enable react-doctor/no-eval\neval(third);",
      expectedDiagnosticLines: [6],
    },
    {
      name: "multiline block disable-next-line",
      sourceText:
        "/* oxlint-disable-next-line react-doctor/no-eval\nbecause this fixture is intentional */\neval(first);\neval(second);",
      expectedDiagnosticLines: [4],
    },
    {
      name: "ESLint-compatible disable-next-line",
      sourceText: "// eslint-disable-next-line react-doctor/no-eval\neval(first);\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "region directives sharing a line with diagnostics",
      sourceText: "/* oxlint-disable */ eval(first); /* oxlint-enable */ eval(second);",
      expectedDiagnosticLines: [1],
    },
    {
      name: "region directive inside a diagnostic span",
      sourceText:
        "eval(/* oxlint-disable react-doctor/no-eval */ first);\n// oxlint-enable react-doctor/no-eval\neval(second);",
      expectedDiagnosticLines: [3],
    },
    {
      name: "directive text inside strings and templates",
      sourceText:
        'const line = "// oxlint-disable";\nconst block = `/* oxlint-disable react-doctor/no-eval */`;\neval(first);',
      expectedDiagnosticLines: [3],
    },
  ];

  for (const suppressionCase of inlineSuppressionCases) {
    it(`matches Oxlint for ${suppressionCase.name}`, () => {
      const parityCase: EvaluatorParityCase = {
        filename: "inline-suppression.ts",
        ruleId: "no-eval",
        severity: "error",
        sourceText: suppressionCase.sourceText,
      };
      const oxlintResult = runOxlint(parityCase);
      expect(oxlintResult.stderr).toBe("");
      expect(
        oxlintResult.output.diagnostics.map((diagnostic) => diagnostic.labels[0]?.span.line),
      ).toEqual(suppressionCase.expectedDiagnosticLines);
      expect(evaluateComparableDiagnostics(parityCase)).toEqual(
        normalizeOxlintDiagnostics(oxlintResult),
      );
    });
  }
});
