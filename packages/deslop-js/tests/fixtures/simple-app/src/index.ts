import { anotherUnused2, usedFunction } from "./utils";
import { UsedType } from "./types";

const result: UsedType = usedFunction();
console.log(result);

export function anotherUnused3(): void {
  // This function is exported but never imported
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
  console.log("anotherUnused");
}

anotherUnused2();
