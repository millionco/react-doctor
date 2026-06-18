import { buildUser, formatLabel } from "./consumer.js";

const user = buildUser("1", "Ada");
const label = formatLabel(42);

console.log(user, label);
