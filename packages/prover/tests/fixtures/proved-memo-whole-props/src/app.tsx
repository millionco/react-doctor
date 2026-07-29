import { memo } from "react";

interface BadgeProperties {
  label: string;
  title: string;
}

const BadgeView = ({ label, ...attributes }: BadgeProperties) => (
  <span {...attributes}>{label}</span>
);

export const Badge = memo(
  BadgeView,
  (previousProperties, nextProperties) => previousProperties === nextProperties,
);
