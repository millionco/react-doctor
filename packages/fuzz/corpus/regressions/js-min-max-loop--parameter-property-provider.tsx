// rule: js-min-max-loop
// weakness: wrapper-transparency
// source: public synthetic parameter-property provider
// verdict: pass
export {};

class Picker {
  constructor(
    public Math: { min(...values: number[]): number },
    value = [3, 1, 2].sort((left, right) => left - right)[0],
  ) {}
}
