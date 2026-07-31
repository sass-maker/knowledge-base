import type { APIRoute } from "astro";
import { homeMarkdown } from "../config/public-surfaces";

export const GET: APIRoute = () =>
  new Response(homeMarkdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
