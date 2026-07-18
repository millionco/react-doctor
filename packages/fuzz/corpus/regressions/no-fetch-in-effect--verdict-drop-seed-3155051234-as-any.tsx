// rule: no-fetch-in-effect
// kind: verdict-drop
// seed: 3155051234 (iteration 399)
// variant: as-any call receivers

import axios from "axios";
import { useEffect, useState } from "react";

export const AsAnySearch = ({ query }: { query: string }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    void (axios as any).get("/search", { params: { query } });
  }, [query]);

  return <div>{selection}</div>;
};
