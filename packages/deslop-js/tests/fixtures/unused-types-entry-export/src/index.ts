export type PublicApiShape = {
  contract: "v1";
  data: string;
};

export type DeadEntryType = {
  legacy: true;
};

export const callApi = (data: string): PublicApiShape => ({ contract: "v1", data });

console.log(callApi("hello"));
