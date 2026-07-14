// rule: no-unstable-nested-components
// weakness: library-idiom
// source: DouyinFE/semi-design@9a1d6cce203898610e44f15f1e8a698beaade0ae

import { useMemo } from "react";

export const Parent = ({ shouldMemoize }: { shouldMemoize: boolean }) => {
  const RenderContent = () => <div>Hello</div>;

  return shouldMemoize ? useMemo(RenderContent, []) : RenderContent();
};
