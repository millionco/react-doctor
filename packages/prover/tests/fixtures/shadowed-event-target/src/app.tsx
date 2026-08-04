import { useEffect } from "react";

class EventRegistry {
  addEventListener(_eventName: string, _callback: () => void) {}

  removeEventListener(_eventName: string, _callback: () => void) {}
}

const registry = new EventRegistry();
const handleChange = () => undefined;

export const RegistryConsumer = () => {
  useEffect(() => {
    registry.addEventListener("change", handleChange);
    return () => registry.removeEventListener("change", handleChange);
  }, []);

  return null;
};
