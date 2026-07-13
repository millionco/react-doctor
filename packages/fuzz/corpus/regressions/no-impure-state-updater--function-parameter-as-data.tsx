import { useState } from "react";

interface Row {
  readonly id: string;
}

export function Component() {
  const [_a, setA] = useState<Row | null>(null);
  const [_b, setB] = useState(false);

  const withParam = (row: Row): void => {
    setA(row);
    setB(true);
  };

  const withoutParam = (): void => {
    setA(null);
    setB(true);
  };

  return (
    <div>
      <button type="button" onClick={() => withParam({ id: "x" })}>
        p
      </button>
      <button type="button" onClick={withoutParam}>
        q
      </button>
    </div>
  );
}
