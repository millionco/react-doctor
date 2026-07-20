import { create } from "zustand";

export const useFuzzStore = create((_set, get) => ({
  count: get().count,
}));
