export type JsDocConsumed = {
  marker: "jsdoc-consumed";
  count: number;
};

export type RegularImported = "bridge";

export type NeverReferenced = {
  marker: "dead";
};
