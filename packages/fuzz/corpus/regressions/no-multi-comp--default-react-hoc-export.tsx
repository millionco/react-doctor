import { memo } from "react";

const PrivateHeader = () => <header />;
const PrivateBody = () => <main />;
const FeatureImpl = () => (
  <>
    <PrivateHeader />
    <PrivateBody />
  </>
);

export default memo(FeatureImpl);
