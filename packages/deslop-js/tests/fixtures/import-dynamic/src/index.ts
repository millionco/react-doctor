import { greet } from "./utils";
const lazy = import("./lazy");
console.log(greet(), lazy);
