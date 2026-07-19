// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: framework-gating
// source: react-bench corpus audit 2026-07 (hyperdx search page: same-file dynamic(..., { ssr: false }) export never renders on the server)
import dynamic from "next/dynamic";

export function DBSearchPage() {
  const paths = window.location.pathname.split("/");
  return <div>{paths.length}</div>;
}

const DBSearchPageDynamic = dynamic(async () => DBSearchPage, { ssr: false });

export default DBSearchPageDynamic;
