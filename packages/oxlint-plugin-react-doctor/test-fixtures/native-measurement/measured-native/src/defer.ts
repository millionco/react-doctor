export default function defer<T extends (...args: any[]) => void>(run: T, wait: number) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  return function later(this: unknown, ...values: Parameters<T>): void {
    clearTimeout(pending);
    pending = setTimeout(() => {
      run.apply(this, values);
    }, wait);
  };
}
