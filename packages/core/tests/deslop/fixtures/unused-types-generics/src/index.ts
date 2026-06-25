import type { Box } from "./types.js";

interface User {
  id: string;
  name: string;
}

export const wrap = (user: User): Box<User> => ({ content: user, label: user.name });

console.log(wrap({ id: "1", name: "Ada" }));
