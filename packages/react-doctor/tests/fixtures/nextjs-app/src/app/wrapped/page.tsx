"use client";

import React, { Suspense } from "react";

void React;

const useSearchParams = () => new URLSearchParams();

// Regression: useSearchParams() inside a file that already imports
// Suspense (or renders a <Suspense> boundary) is not flagged, since
// the developer is clearly aware of the bailout requirement.
// Pre-fix this fired false-positive on every call site regardless of
// surrounding Suspense.
const SearchConsumer = () => {
  const params = useSearchParams();
  return <div>{params.toString()}</div>;
};

const WrappedPage = () => (
  <Suspense fallback={<div>loading…</div>}>
    <SearchConsumer />
  </Suspense>
);

export default WrappedPage;
