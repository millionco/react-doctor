import * as React from "react";

interface StatusProperties {
  label: string;
}

const StatusView = ({ label }: StatusProperties) => <output>{label}</output>;

export const Status = React.memo(
  StatusView,
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
