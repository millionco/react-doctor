// rule: no-effect-event-handler
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: fail
// file-path: src/pages/library.tsx
namespace require {
  export interface Marker {}
}
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
