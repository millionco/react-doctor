// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: react-bench corpus audit 2026-07 (react-cosmos: anchorEl.href helper fed e.currentTarget from a link whose href is a trusted URL getter)
import { createRelativePlaygroundUrl } from "./playground-url";

const openAnchorInNewTab = (anchorEl: HTMLAnchorElement) => {
  window.open(anchorEl.href, "_blank");
};

export function FixtureLink({
  children,
  fixtureId,
  onFixtureSelect,
}: {
  children: string;
  fixtureId: string;
  onFixtureSelect: (fixtureId: string) => void;
}) {
  return (
    <a
      href={createRelativePlaygroundUrl({ fixture: fixtureId })}
      onClick={(event) => {
        event.preventDefault();
        if (event.metaKey) {
          openAnchorInNewTab(event.currentTarget);
        } else {
          onFixtureSelect(fixtureId);
        }
      }}
    >
      {children}
    </a>
  );
}
