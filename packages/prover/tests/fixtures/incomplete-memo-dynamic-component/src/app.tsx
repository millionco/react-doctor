import { memo } from "react";

interface LabelProperties {
  label: string;
}

declare const loadComponent: () => (properties: LabelProperties) => unknown;

export const Dynamic = memo(
  loadComponent(),
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
