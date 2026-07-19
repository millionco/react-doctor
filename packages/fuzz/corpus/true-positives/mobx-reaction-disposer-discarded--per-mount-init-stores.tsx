import { autorun } from "mobx";
import { useEffect } from "react";
import { store } from "./store";

export const initStores = () => {
  autorun(() => console.log(store.value));
};

export const Preview = () => {
  useEffect(() => initStores(), []);
  return null;
};
