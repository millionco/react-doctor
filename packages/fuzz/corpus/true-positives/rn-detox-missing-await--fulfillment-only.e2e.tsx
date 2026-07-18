// rule: rn-detox-missing-await
// weakness: control-flow
element(by.id("save")).tap().then(done);
