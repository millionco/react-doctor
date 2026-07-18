// rule: no-adjust-state-on-prop-change
// weakness: member-style-http-effect
// source: PR #1361 review

import axios from "axios";
import { useEffect, useState } from "react";

export const Search = ({ query }: { query: string }) => {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    setSelection(null);
    void axios.get("/search", { params: { query } });
  }, [query]);

  return <div>{selection}</div>;
};
