// rule: no-redundant-display-class
// weakness: domain-semantics
// source: RDE OSS corpus, evershopcommerce/evershop
// verdict: pass

export const ForcedSlide = () => <div className="slide__wrapper !block" />;
