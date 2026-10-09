// rule: effect-needs-cleanup
// verdict: safe
export const BuildLayer = (leaflet) =>
  leaflet.Layer.extend({
    onAdd: function (map) {
      leaflet.DomEvent.on(map._proxy, "move", this.update, this);
    },
    onRemove: function () {
      leaflet.DomEvent.off(this._map._proxy, "move", this.update, this);
    },
  });
