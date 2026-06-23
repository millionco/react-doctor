import { createUser } from "./index";
import type { User } from "./index";

const user: User = createUser("Alice");
console.log(user);
