// rule: rules-of-hooks
// verdict: pass
// weakness: framework-gating; source: synthetic
// file-path: corpus/regressions/react-static-plugin/src/browser.api.js
import { useState } from "react";

export default () => ({
  Root:
    (Previous) =>
    ({ children }) => {
      const [value] = useState(0);
      return (
        <Previous>
          {children}
          {value}
        </Previous>
      );
    },
});
