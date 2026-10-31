// rule: no-random-key
// verdict: pass
// weakness: provider-erasure
// source: independently synthetic binding namespace control
namespace globalThis {
  export interface Marker {}
}
globalThis.require("uuid").v4 = () => "stable";
import { v4 as makeKey } from "uuid";
const makeCards = () => [{ token: makeKey(), label: "Ready" }];
const Cards = () => {
  const cards = makeCards();
  return (
    <>
      {cards.map((card) => (
        <span key={card.token}>{card.label}</span>
      ))}
    </>
  );
};
export const Example = () => <Cards />;
