// rule: no-random-key
// weakness: local-resource-origin
// source: independently synthetic local resource key
// verdict: pass
import { v4 as makeKey } from "uuid";
import { useState } from "react";
const makeCards = () => [{ token: makeKey(), label: "Ready" }];
export const Example = () => {
  const [cards, setCards] = useState([]);
  return (
    <>
      <button onClick={() => setCards(makeCards())}>Add</button>
      <section>
        {cards.map((card) => (
          <span key={card.token}>{card.label}</span>
        ))}
      </section>
    </>
  );
};
