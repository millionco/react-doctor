// rule: no-impure-state-updater
// weakness: import-provenance
// source: adversarial audit of recent rules
import { message } from "./domain-message";
import { useState } from "react";

export const useValue = () => {
  const [value, setValue] = useState(0);
  const updateValue = () => setValue(() => message.info());
  return { updateValue, value };
};
