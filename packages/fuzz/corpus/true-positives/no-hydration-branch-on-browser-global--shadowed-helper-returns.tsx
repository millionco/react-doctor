"use client";

const isClient = () => {
  if (typeof window !== "undefined") {
    const available = true;
    return available;
  }
  const available = false;
  return available;
};

export const Page = () => (isClient() ? <Client /> : <Server />);
