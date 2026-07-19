import { translatePath } from "@remotion/paths";
import { makeRect } from "@remotion/shapes";

const { path } = makeRect({ height: 24, width: 8, cornerRadius: 4 });

export const Spinner = () => (
  <svg viewBox="0 0 100 100">
    <path className="animate-spinner" d={translatePath(path, 46, 3)} />
  </svg>
);
