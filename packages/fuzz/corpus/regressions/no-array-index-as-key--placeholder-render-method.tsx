// rule: no-array-index-as-key
// weakness: alias-guard
// source: saved candidate audit, numbered placeholder inputs
// verdict: pass
export class Inputs {
  renderInputs(length: number) {
    return Array.from({ length }, (_, index) => this.renderInput(index + 1));
  }
  renderInput(index: number) {
    return <input key={index} />;
  }
}
