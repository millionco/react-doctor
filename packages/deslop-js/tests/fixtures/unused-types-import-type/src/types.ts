export type ReturnedShape = {
  status: "ok" | "fail";
  value: number;
};

export type NeverImported = {
  legacy: boolean;
};
