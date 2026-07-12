// rule: no-create-context-in-render
// weakness: name-heuristic
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
import { createContext } from "react";

export const ContextPreview = () => {
  const createContext = (value: string) => ({ value });
  return <pre>{createContext("preview").value}</pre>;
};
