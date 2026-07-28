import { useEffect, useState } from "react";

interface SynchronizerProperties {
  synchronize: () => void;
}

const Synchronizer = ({ synchronize }: SynchronizerProperties) => {
  useEffect(() => {
    synchronize();
  }, [synchronize]);
  return null;
};

export const Application = () => {
  const [, setRevision] = useState(0);
  const synchronize = () => setRevision((revision) => revision + 1);
  return <Synchronizer synchronize={synchronize} />;
};
