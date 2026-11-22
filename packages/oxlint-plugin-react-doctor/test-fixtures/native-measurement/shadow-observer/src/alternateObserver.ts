export class ResizeObserver {
  private notify: (entries: any[]) => void;
  constructor(notify: (entries: any[]) => void) {
    this.notify = notify;
  }
  observe(element: Element) {
    this.notify([{ contentRect: { width: 12, height: 8 } }]);
  }
  unobserve(element: Element) {}
}
