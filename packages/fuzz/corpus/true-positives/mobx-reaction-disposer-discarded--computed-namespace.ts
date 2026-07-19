import * as mobx from "mobx";

export const startTracking = () => {
  mobx["autorun"](() => sync());
};

declare const sync: () => void;
