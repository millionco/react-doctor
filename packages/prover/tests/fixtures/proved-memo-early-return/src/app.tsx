import { memo } from "react";

interface RowProperties {
  label: string;
  revision: number;
}

const RowView = ({ label, revision }: RowProperties) => (
  <p>
    {label} revision {revision}
  </p>
);

export const Row = memo(RowView, (previousProperties, nextProperties) => {
  if (previousProperties.label !== nextProperties.label) return false;
  if (!Object.is(previousProperties.revision, nextProperties.revision)) return false;
  return true;
});
