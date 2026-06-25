class Animal {
  public speak(): string {
    return "generic sound";
  }

  public eat(): string {
    return "eating";
  }

  public sleep(): string {
    return "snoring";
  }
}

class Dog extends Animal {
  public speak(): string {
    return "woof";
  }
}

const buddy = new Dog();
console.log(buddy.speak());
console.log(buddy.eat());
