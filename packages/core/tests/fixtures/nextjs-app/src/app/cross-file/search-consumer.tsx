"use client";

const useSearchParams = () => new URLSearchParams();

export const SearchConsumer = () => {
  const params = useSearchParams();
  return <input value={params.get("q") ?? ""} />;
};
