"use client";

import { useSearchParams } from "next/navigation";

export const SearchConsumer = () => {
  const params = useSearchParams();
  return <input value={params.get("q") ?? ""} />;
};
