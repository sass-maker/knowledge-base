import {
  accessErrorResponse,
  verifyOperator,
  type AccessEnv,
} from "../_lib/access";

interface ProxyEnv extends AccessEnv {
  RAG_SERVICE_URL?: string;
  RAG_SERVICE_KEY?: string;
}

interface ProxyContext {
  request: Request;
  env: ProxyEnv;
  params: {
    path?: string | string[];
  };
}

const REQUEST_HEADERS = ["accept", "content-type", "if-match"];
const RESPONSE_HEADERS = [
  "cache-control",
  "content-disposition",
  "content-type",
  "retry-after",
  "x-rag-timing",
];

function proxyPath(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("/") : (value ?? "");
}

function upstreamHeaders(request: Request, serviceKey: string): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${serviceKey}`,
  });
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function downstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function onRequest(
  context: ProxyContext,
): Promise<Response> {
  try {
    await verifyOperator(context.request, context.env);
  } catch (error) {
    return accessErrorResponse(error);
  }

  const serviceUrl = context.env.RAG_SERVICE_URL?.trim();
  const serviceKey = context.env.RAG_SERVICE_KEY?.trim();
  if (!serviceUrl || !serviceKey) {
    return Response.json(
      { error: "RAG service proxy is not configured" },
      { status: 503 },
    );
  }

  const path = proxyPath(context.params.path).replace(/^\/+/, "");
  if (path !== "v1" && !path.startsWith("v1/")) {
    return Response.json({ error: "Unsupported proxy path" }, { status: 404 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(`/${path}`, `${serviceUrl.replace(/\/+$/, "")}/`);
  } catch {
    return Response.json(
      { error: "RAG service URL is invalid" },
      { status: 503 },
    );
  }
  if (
    upstreamUrl.pathname !== "/v1"
    && !upstreamUrl.pathname.startsWith("/v1/")
  ) {
    return Response.json({ error: "Unsupported proxy path" }, { status: 404 });
  }
  upstreamUrl.search = new URL(context.request.url).search;

  const method = context.request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  const upstream = await fetch(upstreamUrl, {
    method,
    headers: upstreamHeaders(context.request, serviceKey),
    body: hasBody ? context.request.body : undefined,
    redirect: "manual",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: downstreamHeaders(upstream),
  });
}
