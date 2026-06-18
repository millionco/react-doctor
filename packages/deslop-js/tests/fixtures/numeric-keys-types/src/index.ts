export interface HttpStatusMap {
  200: "OK";
  404: "NotFound";
  500: "InternalServerError";
}

export type ResponseShape = {
  [200]: { ok: true };
  [404]: { error: "missing" };
};

export interface IndexSignatureShape {
  [key: string]: number;
  (input: string): void;
  readonly tag: symbol;
}

export const sample: HttpStatusMap = { 200: "OK", 404: "NotFound", 500: "InternalServerError" };

console.log(sample);
