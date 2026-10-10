import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://knowledgebase.sassmaker.com",
  output: "static",
  trailingSlash: "never",
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
  build: {
    format: "file",
  },
});
