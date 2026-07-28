import { useState } from "react";

export const App = () => (
  <button
    type="button"
    onClick={() => {
      useState(0);
    }}
  >
    Invalid
  </button>
);
