import {
  createUser,
  updateUser,
  fetchProfile,
  buildProfile,
  localAlias,
  uniqueShape,
  twoPropShape,
  twoPropShape2,
} from "./operations.js";
import { renderProfile } from "./elsewhere.js";

createUser({ id: "1", name: "Ada", email: "ada@example.com" });
updateUser({ id: "1", name: "Ada", email: "ada@example.com" });
console.log(
  fetchProfile(),
  buildProfile(),
  localAlias(),
  renderProfile({ id: "1", name: "Ada", email: "ada@example.com" }),
);
uniqueShape({ onlyHere: true });
twoPropShape({ a: 1, b: 2 });
twoPropShape2({ a: 3, b: 4 });
