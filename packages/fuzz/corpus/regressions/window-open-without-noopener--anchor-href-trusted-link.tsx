// rule: window-open-without-noopener
// weakness: wrapper-transparency
// source: react-bench corpus audit 2026-07 (anchorEl.href helper fed e.currentTarget from a locally proven relative URL getter)
const createRelativePlaygroundUrl = ({ fixture }: { fixture: string }) => `/playground/${fixture}`;

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
