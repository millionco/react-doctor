// rule: no-fetch-in-effect
// kind: verdict-drop
// seed: 3155051234 (iteration 399)
// variant: non-null-asserted call receivers

import axios from "axios";
import { useEffect, useState } from "react";

export const NonNullSearch = ({ query }: { query: string }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    void axios!.get("/search", { params: { query } });
  }, [query]);

  return <div>{selection}</div>;
};
