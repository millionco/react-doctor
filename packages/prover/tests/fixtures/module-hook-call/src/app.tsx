import { useState } from "react";

const [count] = useState(0);

export const Counter = () => <p>{count}</p>;
