// rule: only-export-components
// weakness: name-heuristic
// source: issue #1265
import { useMemo } from "react";

interface CountryOption {
  code: string;
}

export function useCountryOptions(): CountryOption[] {
  return useMemo(() => [], []);
}

export function CountryPickerSheet() {
  const options = useCountryOptions();
  return <div>{options.length}</div>;
}
