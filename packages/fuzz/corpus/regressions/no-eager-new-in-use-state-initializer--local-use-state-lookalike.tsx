// rule: no-eager-new-in-use-state-initializer
// weakness: library-idiom
// source: PR #1357 aggregate detector audit
const useState = <Value,>(value: Value) => value;

class ApiClient {
  connect() {}
}

export const createClient = () => useState(new ApiClient());
