import { memo } from "react";

interface DynamicProperties {
  label: string;
  revision: number;
}

const propertyName: keyof DynamicProperties = "revision";

const DynamicView = (properties: DynamicProperties) => <output>{properties[propertyName]}</output>;

export const Dynamic = memo(
  DynamicView,
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
