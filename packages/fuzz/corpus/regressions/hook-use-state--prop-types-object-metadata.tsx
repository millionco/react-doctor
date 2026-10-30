// rule: hook-use-state
// weakness: library-idiom
// verdict: pass
// file-path: /synthetic/prop-types-role/panel.tsx
import { useState } from "react";
import PropTypes from "prop-types";

export const Panel = () => {
  const [value] = useState(0);
  return <span>{value}</span>;
};

Panel.propTypes = { items: PropTypes.arrayOf(Object).isRequired };
