import { useImperativeHandle, useRef, useState } from "react";
import type { Ref } from "react";

interface CounterHandle {
  increment(): void;
  read(): number;
}

interface CounterProperties {
  ref?: Ref<CounterHandle>;
}

const Counter = ({ ref }: CounterProperties) => {
  const [count, setCount] = useState(0);
  useImperativeHandle(
    ref,
    () => ({
      increment: () => setCount((currentCount) => currentCount + 1),
      read: () => count,
    }),
    [count],
  );
  return <output>{count}</output>;
};

export const Application = () => {
  const counterRef = useRef<CounterHandle | null>(null);
  return (
    <main>
      <Counter ref={counterRef} />
      <button type="button" onClick={() => counterRef.current?.increment()}>
        Increment
      </button>
    </main>
  );
};
