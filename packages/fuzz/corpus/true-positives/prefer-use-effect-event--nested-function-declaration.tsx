// rule: prefer-use-effect-event
// weakness: control-flow
// source: PR #1291 review — block-scoped declaration binding lookup
import { useEffect } from "react";

interface SearchInputProps {
  delay: number;
  onSearch: (value: string) => void;
}

export const SearchInput = ({ delay, onSearch }: SearchInputProps) => {
  useEffect(() => {
    if (delay > 0) {
      const timeoutId = setTimeout(searchLater, delay);
      function searchLater() {
        onSearch("done");
      }
      return () => clearTimeout(timeoutId);
    }
  }, [delay, onSearch]);

  return null;
};
