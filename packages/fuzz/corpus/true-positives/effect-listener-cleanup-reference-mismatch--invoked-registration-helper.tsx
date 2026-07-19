import { useEffect } from "react";
import { store } from "./store";

export const Preview = () => {
  useEffect(() => {
    const setup = () => store.subscribe(() => console.log("value"));
    setup();
    return () => store.unsubscribe(() => console.log("value"));
  }, []);

  return null;
};
