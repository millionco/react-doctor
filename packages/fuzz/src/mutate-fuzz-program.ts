import type { SeededRandom } from "./seeded-random.js";

const NOISE_TOKEN_POOL = [
  "?.",
  "!",
  "...",
  " satisfies unknown",
  " as const",
  "/* fuzz */",
  "// fuzz\n",
  "\u200b",
  "\uFEFF",
  "𝕏",
  "${",
  "`",
  "<",
  ">",
  "{",
  "}",
  ")",
  ";",
  "\\u0041",
  "#!",
  " ?? 0",
  " && null",
  "await ",
  "void ",
  "yield ",
  "e\u0301",
] as const;

// Tokens rules key on — splicing them into random positions produces the
// half-formed shapes (a dangling `useEffect(`, an orphan `.cancel()`) that
// crash visitors which assume their trigger token implies full context.
const DICTIONARY_TOKEN_POOL = [
  "useEffect(() => {}",
  ".addEventListener(",
  ".removeEventListener(",
  "window.open(",
  "JSON.parse(",
  "?? {}",
  ".sort()",
  ".current",
  "dangerouslySetInnerHTML",
  "key={index}",
  "typeof window",
  "new AbortController()",
  ".mutateAsync(",
  "reaction(",
  "styled.div`",
  "useState(",
  "return () =>",
  "[items]",
  ", []",
] as const;

type Mutation = (code: string, random: SeededRandom) => string;

const deleteSlice: Mutation = (code, random) => {
  const start = random.int(code.length);
  const end = Math.min(code.length, start + random.intBetween(1, 40));
  return code.slice(0, start) + code.slice(end);
};

const duplicateSlice: Mutation = (code, random) => {
  const start = random.int(code.length);
  const end = Math.min(code.length, start + random.intBetween(1, 60));
  return code.slice(0, end) + code.slice(start, end) + code.slice(end);
};

const insertNoiseToken: Mutation = (code, random) => {
  const position = random.int(code.length);
  return code.slice(0, position) + random.pick(NOISE_TOKEN_POOL) + code.slice(position);
};

const insertDictionaryToken: Mutation = (code, random) => {
  const position = random.int(code.length);
  return code.slice(0, position) + random.pick(DICTIONARY_TOKEN_POOL) + code.slice(position);
};

const swapSlices: Mutation = (code, random) => {
  const firstStart = random.int(code.length);
  const firstEnd = Math.min(code.length, firstStart + random.intBetween(1, 20));
  const secondStart = random.int(code.length);
  const secondEnd = Math.min(code.length, secondStart + random.intBetween(1, 20));
  if (firstStart >= secondStart) return code;
  return (
    code.slice(0, firstStart) +
    code.slice(secondStart, secondEnd) +
    code.slice(firstEnd, secondStart) +
    code.slice(firstStart, firstEnd) +
    code.slice(secondEnd)
  );
};

// Line-level splices survive parsing far more often than character-level
// ones (statements are usually line-aligned), so mutants keep exercising
// rule logic instead of being discarded as parse errors.
const deleteLine: Mutation = (code, random) => {
  const lines = code.split("\n");
  if (lines.length < 2) return code;
  lines.splice(random.int(lines.length), 1);
  return lines.join("\n");
};

const duplicateLine: Mutation = (code, random) => {
  const lines = code.split("\n");
  const index = random.int(lines.length);
  lines.splice(index, 0, lines[index]);
  return lines.join("\n");
};

const swapAdjacentLines: Mutation = (code, random) => {
  const lines = code.split("\n");
  if (lines.length < 2) return code;
  const index = random.int(lines.length - 1);
  const held = lines[index];
  lines[index] = lines[index + 1];
  lines[index + 1] = held;
  return lines.join("\n");
};

const MUTATION_POOL: ReadonlyArray<Mutation> = [
  deleteSlice,
  duplicateSlice,
  insertNoiseToken,
  insertNoiseToken,
  insertDictionaryToken,
  insertDictionaryToken,
  swapSlices,
  deleteLine,
  duplicateLine,
  swapAdjacentLines,
];

export const mutateFuzzProgram = (
  code: string,
  random: SeededRandom,
  mutationCount: number,
): string => {
  let mutated = code;
  for (let index = 0; index < mutationCount; index += 1) {
    mutated = random.pick(MUTATION_POOL)(mutated, random);
  }
  return mutated;
};

// AFL-style crossover: transplant a line-aligned chunk of the donor into
// the host. Combines shapes from two programs (e.g. a corpus file's JSX
// with a generated effect block) that no single generator path produces.
export const crossoverFuzzPrograms = (
  hostCode: string,
  donorCode: string,
  random: SeededRandom,
): string => {
  const hostLines = hostCode.split("\n");
  const donorLines = donorCode.split("\n");
  if (hostLines.length < 2 || donorLines.length < 2) return hostCode;
  const donorStart = random.int(donorLines.length);
  const donorEnd = Math.min(donorLines.length, donorStart + random.intBetween(1, 20));
  const insertAt = random.int(hostLines.length);
  return [
    ...hostLines.slice(0, insertAt),
    ...donorLines.slice(donorStart, donorEnd),
    ...hostLines.slice(insertAt),
  ].join("\n");
};
