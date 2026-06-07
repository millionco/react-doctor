"use client";

import { useSearchParams } from "next/navigation";

export const SearchBar = () => {
  const params = useSearchParams();
  return <input value={params.get("q") ?? ""} />;
};
