import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const APP_CONFIG = {
  name: "SpectraGram",
  version: packageJson.version,
  copyright: `© ${currentYear}, SpectraGram.`,
  meta: {
    title: "SpectraGram",
    description: "SpectraGram a speech model inventory and benchmark generator",
  },
};
