const GRAPHQL_TYPESCRIPT_OUTPUT_MARKERS = [
  "export type Maybe<T> = T | null;",
  "export type Exact<T extends { [key: string]: unknown }>",
  "export type MakeOptional<T, K extends keyof T>",
  "export type MakeMaybe<T, K extends keyof T>",
  "export type Scalars = {",
];

const APOLLO_CLIENT_HELPERS_OUTPUT_MARKERS = [
  'from "@apollo/client/cache";',
  "type FieldPolicy",
  "type FieldReadFunction",
  "type TypePolicies",
  "type TypePolicy",
  "KeySpecifier =",
  "FieldPolicy = {",
  "export type TypedTypePolicies = TypePolicies & {",
];

const containsEveryMarker = (sourceText: string, markers: ReadonlyArray<string>): boolean =>
  markers.every((marker) => sourceText.includes(marker));

export const hasGraphqlCodegenSignature = (sourceText: string): boolean =>
  containsEveryMarker(sourceText, GRAPHQL_TYPESCRIPT_OUTPUT_MARKERS) ||
  containsEveryMarker(sourceText, APOLLO_CLIENT_HELPERS_OUTPUT_MARKERS);
