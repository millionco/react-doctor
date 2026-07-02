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

const MUTATION_POOL: ReadonlyArray<Mutation> = [
  deleteSlice,
  duplicateSlice,
  insertNoiseToken,
  insertNoiseToken,
  swapSlices,
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
