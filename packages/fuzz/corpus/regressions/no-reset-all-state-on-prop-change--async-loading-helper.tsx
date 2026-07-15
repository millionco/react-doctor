// rule: no-reset-all-state-on-prop-change
// weakness: control-flow
// source: React Bench Lobe UI Spline loading lifecycle
import { useEffect, useState } from "react";

interface SplineProps {
  load: (scene: string) => Promise<void>;
  scene: string;
}

export const Spline = ({ load, scene }: SplineProps) => {
  const [isLoading, setIsLoading] = useState(true);

  const initialize = async () => {
    await load(scene);
    setIsLoading(false);
  };

  useEffect(() => {
    setIsLoading(true);
    void initialize();
  }, [scene]);

  return <canvas hidden={isLoading} />;
};
