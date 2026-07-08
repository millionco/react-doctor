export interface SeededRandom {
  next: () => number;
  int: (maxExclusive: number) => number;
  intBetween: (minInclusive: number, maxExclusive: number) => number;
  pick: <Item>(items: ReadonlyArray<Item>) => Item;
  chance: (probability: number) => boolean;
}

// HACK: mulberry32 — a tiny deterministic PRNG so every fuzz case is
// reproducible from its seed alone.
export const createSeededRandom = (seed: number): SeededRandom => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => Math.floor(next() * maxExclusive);
  return {
    next,
    int,
    intBetween: (minInclusive, maxExclusive) => minInclusive + int(maxExclusive - minInclusive),
    pick: (items) => items[int(items.length)],
    chance: (probability) => next() < probability,
  };
};
