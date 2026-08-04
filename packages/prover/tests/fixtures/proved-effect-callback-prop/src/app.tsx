import { useEffect } from "react";

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
  const synchronize = () => undefined;
  return <Synchronizer synchronize={synchronize} />;
};
