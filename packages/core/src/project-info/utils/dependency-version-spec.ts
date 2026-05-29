const UNRESOLVABLE_PROTOCOL_VERSION =
  /^(?:file|git|github|https?|link|patch|portal|workspace|npm):/i;
const DIST_TAG_VERSION = /^[a-z][a-z0-9._-]*$/i;
const WILDCARD_VERSION = /^[*xX](?:\.[*xX])*$/;
const NPM_ALIAS_VERSION = /^npm:(?:@[^/]+\/[^@]+|[^@]+)@(.+)$/i;

interface LowerBoundMajor {
  end: number;
  major: number;
}

const isDigit = (value: string | undefined): boolean =>
  value !== undefined && value >= "0" && value <= "9";

const isWhitespace = (value: string | undefined): boolean =>
  value === " " ||
  value === "\t" ||
  value === "\n" ||
  value === "\r" ||
  value === "\f" ||
  value === "\v";

const isSeparator = (value: string | undefined): boolean =>
  isWhitespace(value) || value === "," || value === "|";

const skipWhitespace = (value: string, start: number): number => {
  let index = start;
  while (isWhitespace(value[index])) index += 1;
  return index;
};

const skipSeparators = (value: string, start: number): number => {
  let index = start;
  while (isSeparator(value[index])) index += 1;
  return index;
};

const readDigits = (value: string, start: number): number => {
  let index = start;
  while (isDigit(value[index])) index += 1;
  return index;
};

const getUpperBoundComparatorEnd = (version: string, start: number): number | null => {
  if (version[start] !== "<") return null;

  let index = skipWhitespace(version, start + 1);
  if (version[index] === "=") index = skipWhitespace(version, index + 1);

  const majorStart = index;
  index = readDigits(version, index);
  if (index === majorStart) return null;

  for (let segments = 0; segments < 2 && version[index] === "."; segments += 1) {
    const segmentStart = index + 1;
    const segmentEnd = readDigits(version, segmentStart);
    if (segmentEnd === segmentStart) break;
    index = segmentEnd;
  }

  if (version[index] === "-") {
    index += 1;
    while (index < version.length && !isSeparator(version[index])) index += 1;
  }

  return index;
};

const stripUpperBoundComparators = (version: string): string => {
  let stripped = "";
  let index = 0;

  while (index < version.length) {
    const comparatorEnd = getUpperBoundComparatorEnd(version, index);
    if (comparatorEnd === null) {
      stripped += version[index];
      index += 1;
      continue;
    }

    stripped += " ";
    index = comparatorEnd;
  }

  return stripped;
};

const hasNonLowerBoundComparator = (branch: string): boolean => {
  for (let index = 0; index < branch.length; index += 1) {
    if (index > 0 && !isSeparator(branch[index - 1])) continue;

    if (branch[index] === ">" && branch[index + 1] !== "=") {
      const valueIndex = skipWhitespace(branch, index + 1);
      if (isDigit(branch[valueIndex])) return true;
      continue;
    }

    if (branch[index] !== "!") continue;

    let valueIndex = index + 1;
    if (branch[valueIndex] === "=") valueIndex += 1;
    if (branch[valueIndex] === "=") valueIndex += 1;
    valueIndex = skipWhitespace(branch, valueIndex);
    if (isDigit(branch[valueIndex])) return true;
  }

  return false;
};

const isMajorTerminator = (value: string | undefined): boolean =>
  value === undefined ||
  isSeparator(value) ||
  value === "." ||
  value === "*" ||
  value === "x" ||
  value === "X" ||
  value === "-";

const getLowerBoundMajorAt = (branch: string, start: number): LowerBoundMajor | null => {
  let index = start;

  if (branch[index] === ">" && branch[index + 1] === "=") {
    index = skipWhitespace(branch, index + 2);
  } else if (
    branch[index] === "~" ||
    branch[index] === "^" ||
    branch[index] === "=" ||
    branch[index] === "v"
  ) {
    index = skipWhitespace(branch, index + 1);
  }

  const majorStart = index;
  const majorEnd = readDigits(branch, majorStart);
  if (majorEnd === majorStart || !isMajorTerminator(branch[majorEnd])) return null;

  return {
    end: majorEnd,
    major: Number.parseInt(branch.slice(majorStart, majorEnd), 10),
  };
};

export const normalizeDependencyVersion = (version: string): string | null => {
  const trimmed = version.trim();
  if (trimmed.length === 0) return null;

  const npmAliasMatch = trimmed.match(NPM_ALIAS_VERSION);
  const normalizedVersion = npmAliasMatch?.[1]?.trim() ?? trimmed;
  if (UNRESOLVABLE_PROTOCOL_VERSION.test(normalizedVersion)) return null;
  if (DIST_TAG_VERSION.test(normalizedVersion) && !/^v\d/i.test(normalizedVersion)) return null;
  if (WILDCARD_VERSION.test(normalizedVersion)) return null;

  return normalizedVersion;
};

export const splitDependencyVersionBranches = (version: string): string[] =>
  version
    .split("||")
    .map((branch) => branch.trim())
    .filter(Boolean);

export const hasUpperBoundComparator = (version: string): boolean => {
  for (let index = 0; index < version.length; index += 1) {
    if (getUpperBoundComparatorEnd(version, index) !== null) return true;
  }
  return false;
};

export const getBranchLowestMajor = (branch: string): number | null => {
  if (hasNonLowerBoundComparator(branch)) return null;

  const lowerBoundComparators = stripUpperBoundComparators(branch).trim();
  if (lowerBoundComparators.length === 0) return null;

  let branchLowestMajor: number | null = null;
  let index = 0;
  while (index < lowerBoundComparators.length) {
    const lowerBoundStart = skipSeparators(lowerBoundComparators, index);
    if (lowerBoundStart > 0 && !isSeparator(lowerBoundComparators[lowerBoundStart - 1])) {
      index = lowerBoundStart + 1;
      continue;
    }

    const lowerBoundMajor = getLowerBoundMajorAt(lowerBoundComparators, lowerBoundStart);
    if (
      lowerBoundMajor !== null &&
      Number.isFinite(lowerBoundMajor.major) &&
      lowerBoundMajor.major > 0
    ) {
      const major = lowerBoundMajor.major;
      if (branchLowestMajor === null || major < branchLowestMajor) branchLowestMajor = major;
    }
    index = lowerBoundMajor?.end ?? lowerBoundStart + 1;
  }

  return branchLowestMajor;
};

export const getLowestDependencyMajor = (version: string): number | null => {
  const normalizedVersion = normalizeDependencyVersion(version);
  if (normalizedVersion === null) return null;

  let lowestMajor: number | null = null;
  for (const branch of splitDependencyVersionBranches(normalizedVersion)) {
    const normalizedBranch = normalizeDependencyVersion(branch);
    if (normalizedBranch === null) return null;

    const branchLowestMajor = getBranchLowestMajor(normalizedBranch);
    if (branchLowestMajor === null && hasUpperBoundComparator(normalizedBranch)) return null;
    if (branchLowestMajor !== null && (lowestMajor === null || branchLowestMajor < lowestMajor)) {
      lowestMajor = branchLowestMajor;
    }
  }

  return lowestMajor;
};

export const isConcreteDependencyVersion = (version: string): boolean => {
  const normalizedVersion = normalizeDependencyVersion(version);
  return normalizedVersion !== null && /\d/.test(normalizedVersion);
};
