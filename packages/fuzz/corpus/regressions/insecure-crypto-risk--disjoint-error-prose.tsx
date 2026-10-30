// Rule: insecure-crypto-risk
// Weakness: name-heuristic
// Source: synthetic disjoint-method parser prose regression
export class FuzzDataAdapter {
  constructor() {
    this.key = Math.random();
  }
  parse(entries) {
    for (const item of entries) {
      let value = item[0];
      if (value === "AND") value = "and";
      if (value !== "and") throw new Error("Unexpected token: " + value);
    }
  }
}
