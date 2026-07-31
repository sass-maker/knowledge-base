import type { APIRoute } from "astro";
import {
  absoluteURL,
  publicSurfaces,
} from "../config/public-surfaces";

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicSurfaces
  .map((surface) => `  <url><loc>${absoluteURL(surface.path)}</loc></url>`)
  .join("\n")}
</urlset>
`;

export const GET: APIRoute = () =>
  new Response(sitemap, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
