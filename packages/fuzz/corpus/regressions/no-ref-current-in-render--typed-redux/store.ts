import { configureStore } from "@reduxjs/toolkit";
import counter from "./counter";

export const makeStore = () => configureStore({ reducer: { counter } });
export type Store = ReturnType<typeof makeStore>;
