// rule: no-array-find-result-member-access-without-guard
// weakness: library-idiom
// source: PR #1402 local Daytona parity

interface QueryModel {
  find: (criteria: (value: unknown) => boolean) => {
    exec: (callback: (error: Error | null) => void) => void;
  };
}

declare const findModel: (name: string) => QueryModel;
declare const criteria: (value: unknown) => boolean;
declare const callback: (error: Error | null) => void;

findModel("items").find(criteria).exec(callback);
