// rule: radio-input-missing-name
// weakness: other
// source: deep audit of millionco/react-doctor#1000

export const Choice = () => <input type="radio" name value="yes" />;
