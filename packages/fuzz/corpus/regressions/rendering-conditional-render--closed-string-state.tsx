// rule: rendering-conditional-render
// verdict: pass
import { useState } from "react";

const formatPageCount = (count: number) => {
  if (count < 1) return "Empty";
  return count + " pages";
};

export const PageCounter = ({ pages }: { pages: number }) => {
  const [resultSize, setResultSize] = useState("");

  return (
    <section>
      <button type="button" onClick={() => setResultSize(formatPageCount(pages))}>
        Count
      </button>
      {resultSize && <output>{resultSize}</output>}
    </section>
  );
};
