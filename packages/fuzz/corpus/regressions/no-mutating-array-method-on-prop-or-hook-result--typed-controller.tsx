// rule: no-mutating-array-method-on-prop-or-hook-result
// weakness: library-idiom
// source: adversarial audit of render/data-safety rules
interface Controller {
  reverse(): void;
  splice(position: number): void;
}

export const Controls = ({ controller }: { controller: Controller }) => {
  controller.reverse();
  controller.splice(0);
  return null;
};
