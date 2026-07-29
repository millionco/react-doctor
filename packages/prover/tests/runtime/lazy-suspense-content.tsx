import { useState } from "react";
import { LAZY_INCREMENT, LAZY_INITIAL_COUNT } from "./constants.js";

interface LazySuspenseContentProperties {
  revision: number;
}

const LazySuspenseContent = ({ revision }: LazySuspenseContentProperties) => {
  const [count, setCount] = useState(LAZY_INITIAL_COUNT);
  return (
    <section>
      <button
        type="button"
        onClick={() => setCount((previousCount) => previousCount + LAZY_INCREMENT)}
      >
        increment lazy count
      </button>
      <output data-testid="lazy-count">{count}</output>
      <output data-testid="lazy-revision">{revision}</output>
    </section>
  );
};

export default LazySuspenseContent;
