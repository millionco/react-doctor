import { useEffect } from "react";

class FakeEventTarget implements EventTarget {
  addEventListener(
    _type: string,
    _callback: EventListenerOrEventListenerObject | null,
    _options?: AddEventListenerOptions | boolean,
  ) {}

  dispatchEvent(_event: Event) {
    return true;
  }

  removeEventListener(
    _type: string,
    _callback: EventListenerOrEventListenerObject | null,
    _options?: EventListenerOptions | boolean,
  ) {}
}

const target: EventTarget = new FakeEventTarget();
const handleChange = () => undefined;

export const StructuralListener = () => {
  useEffect(() => {
    target.addEventListener("change", handleChange);
    return () => target.removeEventListener("change", handleChange);
  }, []);

  return null;
};
