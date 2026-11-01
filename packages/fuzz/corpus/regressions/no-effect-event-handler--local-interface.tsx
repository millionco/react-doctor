// rule: no-effect-event-handler
// weakness: provider-identity
// source: independent synthetic runtime binding regression
// verdict: pass
// file-path: src/pages/library.tsx
const require = (_source: string) => ({ useRouter: () => ({ replace: () => {} }) });
interface require {}
require("next/router").useRouter = () => ({ replace: () => {} });
import { useEffect } from "react";
import { useRouter } from "next/router";
export const getServerSideProps = async () => ({ props: { nextPath: "/library", item: null } });
const LibraryPage = ({ nextPath, item }) => {
  const router = useRouter();
  useEffect(() => {
    if (nextPath && !item) {
      router.replace(nextPath);
    }
  }, [nextPath, item]);
  return null;
};
export default LibraryPage;
