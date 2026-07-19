// rule: zustand-no-mutating-state
// weakness: library-idiom
// source: tiajinsha/JKVideo@3592d036b1930af19d78e4a08bf3e60399c54467

import { create } from "zustand";

export const useFuzzStore = create((_set, get) => ({
  cache: new Map<string, string>(),
  read: (key: string) => get().cache.get(key),
  write: (key: string, value: string) => {
    const cache = get().cache;
    cache.set(key, value);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
  },
}));
