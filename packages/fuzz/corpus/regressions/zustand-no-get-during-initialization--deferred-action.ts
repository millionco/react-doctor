import { create } from "zustand";

export const useFuzzStore = create((_set, get) => ({
  count: 0,
  readCount: () => get().count,
}));
