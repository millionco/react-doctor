export type SourceTokenKind =
  | "node-enter"
  | "identifier"
  | "string-literal"
  | "numeric-literal"
  | "boolean-literal"
  | "null-literal"
  | "template-literal"
  | "regexp-literal";

export interface SourceToken {
  kind: SourceTokenKind;
  payload: string;
  start: number;
  end: number;
}

export interface HashedToken {
  hash: number;
  originalIndex: number;
}
