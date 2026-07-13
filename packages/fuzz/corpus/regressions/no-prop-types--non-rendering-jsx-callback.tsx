// rule: no-prop-types
// weakness: library-idiom
// source: adversarial review of returned callback render provenance

export const Schema = (items: string[]) => items.some((item) => <span>{item}</span>);

Schema.propTypes = { value: () => true };
