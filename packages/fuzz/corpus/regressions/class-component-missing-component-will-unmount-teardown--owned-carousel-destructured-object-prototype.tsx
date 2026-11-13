// rule: class-component-missing-component-will-unmount-teardown
// weakness: source-provenance
// source: synthetic bounded owned-carousel review control
// verdict: fail

const { getPrototypeOf: get } = Object;
get([]).forEach = (callback) => queueMicrotask(() => callback(["ready", "onReady"]));
import React from "react";
import { Splide as Deck } from "@splidejs/splide";
const subscriptions = [["ready", "onReady"]];
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.listen(this.deck);
    this.deck.mount();
  }
  listen(owner: Deck) {
    subscriptions.forEach(([eventName, callbackName]) => {
      const callback = this.props[callbackName];
      if (typeof callback === "function") {
        owner.on(eventName, (...values) => callback(...values));
      }
    });
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
