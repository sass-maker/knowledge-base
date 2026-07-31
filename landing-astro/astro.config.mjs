import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://knowledgebase.sassmaker.com",
  output: "static",
  trailingSlash: "never",
  build: {
    format: "file",
    inlineStylesheets: "always",
  },
});
