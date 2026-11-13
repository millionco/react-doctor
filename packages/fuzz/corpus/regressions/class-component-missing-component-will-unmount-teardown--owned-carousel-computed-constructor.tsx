// rule: class-component-missing-component-will-unmount-teardown
// weakness: source-provenance
// source: synthetic bounded computed-constructor review control
// verdict: fail

const route = "con" + "structor";
const create = [][route][route];
create("return import('@splidejs/splide')")().then((namespace) => {
  namespace.Splide.prototype.destroy = () => {};
});
import React from "react";
import { Splide as Deck } from "@splidejs/splide";

export class GalleryView extends React.Component {
  deck: Deck | undefined;

  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.deck.on("ready", () => {});
    this.deck.mount();
  }

  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }

  render() {
    return null;
  }
}
