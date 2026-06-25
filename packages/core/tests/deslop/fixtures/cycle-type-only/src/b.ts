import type { AType } from "./a";
export interface CType {
  data: string;
}
export const process = (input: AType): CType => ({ data: String(input.value) });
