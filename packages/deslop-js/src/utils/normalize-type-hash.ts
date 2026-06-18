const POSITION_KEYS = new Set(["start", "end", "loc", "range"]);

const NOISY_KEYS = new Set([
  "decorators",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "directive",
  "optional",
  "computed",
  "static",
  "accessibility",
  "declare",
  "readonly",
]);

const NAME_KEYS_TO_STRIP = new Set(["id"]);

const sanitizeNode = (input: unknown): unknown => {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((element) => sanitizeNode(element));
  }
  if (typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  const cleaned: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (POSITION_KEYS.has(key)) continue;
    if (NOISY_KEYS.has(key)) continue;
    if (NAME_KEYS_TO_STRIP.has(key)) continue;
    cleaned[key] = sanitizeNode(record[key]);
  }
  if (cleaned.type === "TSTypeLiteral" && Array.isArray(cleaned.members)) {
    cleaned.members = sortMembersByKey(cleaned.members);
  }
  if (cleaned.type === "TSInterfaceBody" && Array.isArray(cleaned.body)) {
    cleaned.body = sortMembersByKey(cleaned.body);
  }
  return cleaned;
};

const extractMemberKey = (member: unknown): string => {
  if (!member || typeof member !== "object") return "";
  const record = member as { key?: { name?: unknown; value?: unknown }; type?: string };
  if (record.key) {
    const candidate = record.key.name ?? record.key.value;
    if (candidate === undefined || candidate === null) return "";
    return String(candidate);
  }
  return `__${record.type ?? ""}__`;
};

const sortMembersByKey = (members: unknown[]): unknown[] => {
  const tagged = members.map((member) => ({ key: extractMemberKey(member), member }));
  tagged.sort((leftEntry, rightEntry) => {
    if (leftEntry.key < rightEntry.key) return -1;
    if (leftEntry.key > rightEntry.key) return 1;
    return 0;
  });
  return tagged.map((entry) => entry.member);
};

export const normalizeTypeAstHash = (typeAnnotation: unknown): string => {
  const sanitized = sanitizeNode(typeAnnotation);
  return JSON.stringify(sanitized);
};
