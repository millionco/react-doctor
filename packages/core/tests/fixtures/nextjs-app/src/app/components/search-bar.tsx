"use client";

const useSearchParams = () => new URLSearchParams();

// Non-page component that calls useSearchParams() — it is expected to
// be wrapped in <Suspense> by its parent (cross-file), so the rule
// should NOT fire here. See https://github.com/millionco/react-doctor/issues/695
export const SearchBar = () => {
  const params = useSearchParams();
  return <input value={params.get("q") ?? ""} />;
};
