// rule: react-router-no-multiple-middleware-next
// weakness: control-flow
// source: Bugbot PR #1411

export const middleware = [async ({ isAuthorized }, next) => (isAuthorized ? next() : next())];
