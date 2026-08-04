import { memo } from "react";

interface MetadataProperties {
  label: string;
  revision: number;
}

const MetadataView = ({ label, ...metadata }: MetadataProperties) => (
  <output>
    {label}: {JSON.stringify(metadata)}
  </output>
);

export const Metadata = memo(
  MetadataView,
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
