interface ProviderRanges {
  readonly reactQueryRange: string;
  readonly nextIntlRange: string;
}

interface YarnClassicEntry {
  readonly fields: Map<string, string>;
  readonly dependencies: Map<string, string>;
  readonly optionalDependencies: Map<string, string>;
}

interface ReviewedRegistryArtifact {
  readonly version: string;
  readonly registryPath: string;
  readonly integrity: string;
}

const TANSTACK_REACT_QUERY = "@tanstack/react-query";
const TANSTACK_QUERY_CORE = "@tanstack/query-core";
const NEXT_INTL = "next-intl";

// Registry tarballs checked for the QueryClient constructor and literal Next config wrapper.
const REACT_QUERY_ARTIFACT: ReviewedRegistryArtifact = {
  version: "5.71.10",
  registryPath:
    "/@tanstack/react-query/-/react-query-5.71.10.tgz#940d485a499b86aaa37764e26709ed79b393fe29",
  integrity:
    "sha512-mQYM/ObpL8YMDz8vCoUuHkbe8Yu7NnVRH8aBaBa/3zlufjp1f1VuWjeO3TcumNHfuVMDwEAGinsgwrB7OKADiQ==",
};
const QUERY_CORE_ARTIFACT: ReviewedRegistryArtifact = {
  version: "5.71.10",
  registryPath:
    "/@tanstack/query-core/-/query-core-5.71.10.tgz#1f2dc5abf595156e7d9c5d6e4f47e805a7083c30",
  integrity:
    "sha512-/fKEY8fO1nbszfrBatzmhJa1nEwIKn0c6Tv2A1ocSA5OiD2GukOIV8nnBbvJRgZb/VIoBy9/N4PVbABI8YQLow==",
};
const NEXT_INTL_ARTIFACT: ReviewedRegistryArtifact = {
  version: "4.0.2",
  registryPath: "/next-intl/-/next-intl-4.0.2.tgz#952cb392e441c4feedc78d158a27c5d3c1d24991",
  integrity:
    "sha512-3cKVflwdrqxCOvAL+DtGN68qR802i0PEj0dttkAD5IK5XxOjugQs4yU8aSakvPMbkOrhEJ+89z5lG2EAqi7Gkw==",
};

const NEXT_ARTIFACT: ReviewedRegistryArtifact = {
  version: "15.2.4",
  registryPath: "/next/-/next-15.2.4.tgz#e05225e9511df98e3b2edc713e17f4c970bff961",
  integrity:
    "sha512-VwL+LAaPSxEkd3lU2xWbgEOtrM8oedmyhBqaVNmgKB+GvZlCy9rgaEc+y2on0wv+l0oSFqLtYD6dcC1eAedUaQ==",
};
const REACT_ARTIFACT: ReviewedRegistryArtifact = {
  version: "19.1.0",
  registryPath: "/react/-/react-19.1.0.tgz#926864b6c48da7627f004795d6cce50e90793b75",
  integrity:
    "sha512-FS+XFBNvn3GTAWq26joslQgWNoFu08F4kl0J4CgdNKADkdSGXQyTCnKteIAJy96Br6YbpEU1LSzV5dYtjMkMDg==",
};

const MAX_YARN_LOCK_LENGTH = 1_000_000;
const MAX_YARN_LOCK_LINE_LENGTH = 4096;
const QUOTED_YARN_STRING = /"(?:[^"\\]|\\.)*"/u.source;
const YARN_TOKEN = `${QUOTED_YARN_STRING}|[A-Za-z][^\\s",:#]*`;
const YARN_HEADER = new RegExp(`^(?:${YARN_TOKEN})(?:, (?:${YARN_TOKEN}))*:$`, "u");
const YARN_SELECTOR = new RegExp(YARN_TOKEN, "gu");
const YARN_FIELD = new RegExp(`^  (version|resolved|integrity) (${YARN_TOKEN})$`, "u");
const YARN_DEPENDENCY = new RegExp(`^    (${YARN_TOKEN}) (${QUOTED_YARN_STRING})$`, "u");

const parseYarnString = (token: string): string | null => {
  if (!token.startsWith('"')) return token;
  try {
    const value: unknown = JSON.parse(token);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
};

// This recognizes the ordinary v1 writer's format. Unknown syntax or duplicated
// selectors/fields make the lock unsuitable as a proof of a provider resolution.
const readYarnClassicEntries = (lockText: string): Map<string, YarnClassicEntry> | null => {
  if (lockText.length > MAX_YARN_LOCK_LENGTH) return null;
  const entries = new Map<string, YarnClassicEntry>();
  const seenSections = new Set<string>();
  let entry: YarnClassicEntry | null = null;
  let activeSection: Map<string, string> | null = null;
  let hasClassicHeader = false;

  for (const line of lockText.split(/\r?\n/u)) {
    if (line.length > MAX_YARN_LOCK_LINE_LENGTH || line.includes("\r")) return null;
    if (line.startsWith("# yarn lockfile ")) {
      if (line !== "# yarn lockfile v1" || hasClassicHeader || entry) return null;
      hasClassicHeader = true;
    }
    if (line === "" || line.startsWith("#")) continue;
    if (!hasClassicHeader) return null;

    if (YARN_HEADER.test(line)) {
      if (entry && !entry.fields.has("version")) return null;
      entry = { fields: new Map(), dependencies: new Map(), optionalDependencies: new Map() };
      activeSection = null;
      seenSections.clear();
      for (const [rawSelector] of line.matchAll(YARN_SELECTOR)) {
        const selector = parseYarnString(rawSelector);
        if (!selector || entries.has(selector)) return null;
        entries.set(selector, entry);
      }
      continue;
    }
    if (!entry) return null;

    if (line === "  dependencies:" || line === "  optionalDependencies:") {
      if (seenSections.has(line)) return null;
      seenSections.add(line);
      activeSection = line === "  dependencies:" ? entry.dependencies : entry.optionalDependencies;
      continue;
    }
    const field = YARN_FIELD.exec(line);
    if (field) {
      const [, name, rawValue] = field;
      if (entry.fields.has(name) || (name !== "integrity" && !rawValue.startsWith('"')))
        return null;
      const value = parseYarnString(rawValue);
      if (value === null) return null;
      entry.fields.set(name, value);
      activeSection = null;
      continue;
    }
    if (!activeSection) return null;
    const dependency = YARN_DEPENDENCY.exec(line);
    if (!dependency) return null;
    const name = parseYarnString(dependency[1]);
    const range = parseYarnString(dependency[2]);
    if (
      name === null ||
      range === null ||
      entry.dependencies.has(name) ||
      entry.optionalDependencies.has(name)
    ) {
      return null;
    }
    activeSection.set(name, range);
  }
  return entry?.fields.has("version") ? entries : null;
};

const isReviewedRange = (range: string, version: string): boolean =>
  range === version || range === `^${version}`;

const matchesArtifact = (
  entry: YarnClassicEntry | undefined,
  artifact: ReviewedRegistryArtifact,
): boolean => {
  if (!entry) return false;
  const resolved = entry.fields.get("resolved");
  return (
    entry.fields.get("version") === artifact.version &&
    entry.fields.get("integrity") === artifact.integrity &&
    (resolved === `https://registry.yarnpkg.com${artifact.registryPath}` ||
      resolved === `https://registry.npmjs.org${artifact.registryPath}`)
  );
};

// The caller checks package ownership, manifest overrides and installed shadows.
// A matching lock binds the declared artifacts only.
export const hasReviewedQueryClientAndNextIntlYarnLock = (
  lockText: string,
  { reactQueryRange, nextIntlRange }: ProviderRanges,
): boolean => {
  if (
    !isReviewedRange(reactQueryRange, REACT_QUERY_ARTIFACT.version) ||
    !isReviewedRange(nextIntlRange, NEXT_INTL_ARTIFACT.version)
  ) {
    return false;
  }
  const entries = readYarnClassicEntries(lockText);
  if (!entries) return false;
  const reactQuery = entries.get(`${TANSTACK_REACT_QUERY}@${reactQueryRange}`);
  const queryCore = entries.get(`${TANSTACK_QUERY_CORE}@${QUERY_CORE_ARTIFACT.version}`);
  const nextIntl = entries.get(`${NEXT_INTL}@${nextIntlRange}`);
  return (
    reactQuery !== undefined &&
    reactQuery.dependencies.size === 1 &&
    reactQuery.dependencies.get(TANSTACK_QUERY_CORE) === QUERY_CORE_ARTIFACT.version &&
    reactQuery.optionalDependencies.size === 0 &&
    matchesArtifact(reactQuery, REACT_QUERY_ARTIFACT) &&
    matchesArtifact(queryCore, QUERY_CORE_ARTIFACT) &&
    matchesArtifact(nextIntl, NEXT_INTL_ARTIFACT) &&
    matchesArtifact(entries.get("next@15.2.4"), NEXT_ARTIFACT) &&
    matchesArtifact(entries.get("react@^19.0.0"), REACT_ARTIFACT)
  );
};
