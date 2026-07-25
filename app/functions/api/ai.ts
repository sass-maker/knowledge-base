import catalog from "../../public/api-ai.json";

export async function onRequest(): Promise<Response> {
  return Response.json(catalog, {
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
