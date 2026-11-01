// rule: no-effect-event-handler
// verdict: pass
// weakness: framework-gating
// source: independently synthetic
// file-path: src/pages/library.tsx
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
