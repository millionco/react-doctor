export interface Identifiable {
  id: string;
}

export type Box<TItem extends Identifiable> = {
  content: TItem;
  label: string;
};

export type DeadBox = {
  marker: "dead";
};
