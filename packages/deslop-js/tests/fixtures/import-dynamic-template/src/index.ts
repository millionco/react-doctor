const loadLocale = async (language: string) => {
  const { default: locale } = await import(`./locales/${language}/core.js`);
  return locale;
};
export { loadLocale };
