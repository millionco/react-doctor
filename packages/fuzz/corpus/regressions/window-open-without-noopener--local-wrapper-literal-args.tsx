// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: react-bench corpus audit 2026-07 (rad-ui NavBar: local wrapper only ever called with hardcoded literal URLs)
import { useCallback } from "react";

export const NavBar = () => {
  const openLink = useCallback(
    (url: string) => () => {
      window.open(url, "_blank");
    },
    [],
  );
  return (
    <div>
      <button type="button" onClick={openLink("https://discord.gg/nMaQfeEPNp")}>
        Discord
      </button>
      <button type="button" onClick={openLink("https://github.com/rad-ui/ui")}>
        Star on GitHub
      </button>
    </div>
  );
};
