// rule: rules-of-hooks
// verdict: fail
// weakness: provider-erasure
// source: synthetic
namespace require {}
require("react-markdown").default = () => null;
import Markdown from "react-markdown";
import { useState } from "react";
function View() {
  return (
    <Markdown
      components={{
        "count-item": () => {
          const [count] = useState(0);
          return <span>{count}</span>;
        },
      }}
    />
  );
}
