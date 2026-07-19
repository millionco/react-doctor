// rule: window-open-without-noopener
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (hyperdx cmd+click row: Router.push in the sibling branch witnesses an internal route)
import Router from "next/router";

export function ListingRow({ href, name }: { href: string; name: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey) {
          window.open(href, "_blank");
        } else {
          Router.push(href);
        }
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          window.open(href, "_blank");
        }
      }}
    >
      {name}
    </button>
  );
}
