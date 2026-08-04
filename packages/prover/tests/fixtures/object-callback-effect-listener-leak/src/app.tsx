import { useEffect } from "react";

interface CallbackOptions {
  callback: () => void;
}

const invokeCallback = (options: CallbackOptions) => options.callback();

export const Listener = () => {
  useEffect(() => {
    invokeCallback({
      callback: () => window.addEventListener("resize", () => undefined),
    });
  }, []);
  return null;
};
