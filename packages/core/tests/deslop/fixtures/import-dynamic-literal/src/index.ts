const notes = import("../notes");
const packageModule = import("@some/package");
const missing = import("./missing");

console.log(notes, packageModule, missing);
