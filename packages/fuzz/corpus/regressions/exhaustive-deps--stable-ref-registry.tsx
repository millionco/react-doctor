// rule: exhaustive-deps
// weakness: identity-provenance
// source: react-bench Lobe UI eUrzJHL — registry initialized once through ref.current ??=
import { useCallback, useRef } from "react";

export const Registry = () => {
  const registryRef = useRef<Set<string> | undefined>(undefined);
  const registry = (registryRef.current ??= new Set<string>());
  const register = useCallback((key: string) => registry.add(key), [registry]);
  const unregister = useCallback((key: string) => registry.delete(key), [registry]);
  return { register, unregister };
};
