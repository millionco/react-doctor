import type { PackageJson } from "./types/index.js";

interface DeadCodeFrameworkEntryPatternGroup {
  readonly dependencyNames: ReadonlyArray<string>;
  readonly entryPatterns: ReadonlyArray<string>;
}

const DEFAULT_DEAD_CODE_ENTRY_PATTERNS = [
  "src/index.{ts,tsx,js,jsx}",
  "src/main.{ts,tsx,js,jsx}",
  "index.{ts,tsx,js,jsx}",
  "main.{ts,tsx,js,jsx}",
];
const JS_TS_EXTENSIONS = "{ts,tsx,js,jsx}";
const INERTIA_EXTENSIONS = "{ts,tsx,js,jsx,vue,svelte}";
const VIKE_ROUTE_EXTENSIONS = "{ts,tsx,js,jsx,md,mdx}";

const DEAD_CODE_FRAMEWORK_ENTRY_PATTERN_GROUPS: ReadonlyArray<DeadCodeFrameworkEntryPatternGroup> =
  [
    {
      dependencyNames: [
        "@inertiajs/react",
        "@inertiajs/inertia-react",
        "@inertiajs/vue3",
        "@inertiajs/inertia-vue3",
        "@inertiajs/svelte",
        "@inertiajs/inertia-svelte",
        "@inertiajs/inertia",
      ],
      entryPatterns: [
        `resources/js/app.${INERTIA_EXTENSIONS}`,
        `resources/js/App.${INERTIA_EXTENSIONS}`,
        `resources/js/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `resources/js/pages/**/*.${INERTIA_EXTENSIONS}`,
        `app/frontend/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `app/frontend/pages/**/*.${INERTIA_EXTENSIONS}`,
        `app/frontend/entrypoints/**/*.${INERTIA_EXTENSIONS}`,
        `app/javascript/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `app/javascript/pages/**/*.${INERTIA_EXTENSIONS}`,
        `frontend/src/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `frontend/src/pages/**/*.${INERTIA_EXTENSIONS}`,
        `inertia/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `inertia/pages/**/*.${INERTIA_EXTENSIONS}`,
        `src/app.${INERTIA_EXTENSIONS}`,
        `src/App.${INERTIA_EXTENSIONS}`,
        `src/Pages/**/*.${INERTIA_EXTENSIONS}`,
        `src/pages/**/*.${INERTIA_EXTENSIONS}`,
      ],
    },
    {
      dependencyNames: ["@redwoodjs/router", "@redwoodjs/web"],
      entryPatterns: [
        `web/src/App.${JS_TS_EXTENSIONS}`,
        `web/src/Routes.${JS_TS_EXTENSIONS}`,
        `web/src/index.${JS_TS_EXTENSIONS}`,
        `web/src/layouts/**/*.${JS_TS_EXTENSIONS}`,
        `web/src/pages/**/*.${JS_TS_EXTENSIONS}`,
      ],
    },
    {
      dependencyNames: ["waku"],
      entryPatterns: [
        `src/pages/**/*.${JS_TS_EXTENSIONS}`,
        `src/waku.client.${JS_TS_EXTENSIONS}`,
        `src/waku.server.${JS_TS_EXTENSIONS}`,
      ],
    },
    {
      dependencyNames: ["vike", "vite-plugin-ssr"],
      entryPatterns: [
        `pages/**/*.${VIKE_ROUTE_EXTENSIONS}`,
        `renderer/**/*.${JS_TS_EXTENSIONS}`,
        `src/pages/**/*.${VIKE_ROUTE_EXTENSIONS}`,
        `src/renderer/**/*.${JS_TS_EXTENSIONS}`,
      ],
    },
    {
      dependencyNames: ["rakkasjs"],
      entryPatterns: [
        `src/client.${JS_TS_EXTENSIONS}`,
        `src/server.${JS_TS_EXTENSIONS}`,
        `src/routes/**/*.${JS_TS_EXTENSIONS}`,
      ],
    },
    {
      dependencyNames: [
        "@module-federation/enhanced",
        "@module-federation/node",
        "@module-federation/vite",
        "@originjs/vite-plugin-federation",
      ],
      entryPatterns: [
        "federation.config.{ts,js,mjs,cjs,mts,cts}",
        "module-federation.config.{ts,js,mjs,cjs,mts,cts}",
      ],
    },
  ];

const collectDependencyNames = (packageJson: PackageJson): Set<string> => {
  const dependencyNames = new Set<string>();
  for (const dependencies of [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
    packageJson.optionalDependencies,
  ]) {
    if (dependencies === undefined) continue;
    for (const dependencyName of Object.keys(dependencies)) dependencyNames.add(dependencyName);
  }
  return dependencyNames;
};

export const buildDeadCodeEntryPatterns = (packageJson: PackageJson): string[] => {
  const dependencyNames = collectDependencyNames(packageJson);
  const entryPatterns = new Set<string>();

  for (const group of DEAD_CODE_FRAMEWORK_ENTRY_PATTERN_GROUPS) {
    const isEnabled = group.dependencyNames.some((dependencyName) =>
      dependencyNames.has(dependencyName),
    );
    if (!isEnabled) continue;
    for (const pattern of DEFAULT_DEAD_CODE_ENTRY_PATTERNS) entryPatterns.add(pattern);
    for (const pattern of group.entryPatterns) entryPatterns.add(pattern);
  }

  return [...entryPatterns];
};
