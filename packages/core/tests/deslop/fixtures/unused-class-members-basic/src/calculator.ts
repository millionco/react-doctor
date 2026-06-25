class InternalCalculator {
  public sum(a: number, b: number): number {
    return a + b;
  }

  public deadMethod(): string {
    return "never called";
  }

  public usedProperty = 42;

  public deadProperty = "unused field";

  private internalHelper(): void {
    console.log("private — should not flag");
  }
}

export const calculator = new InternalCalculator();
console.log(calculator.sum(1, 2), calculator.usedProperty);
