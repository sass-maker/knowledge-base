import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  CF_ACCESS_DEV_EMAIL?: string;
}

export interface OperatorIdentity {
  email: string;
  subject: string;
  expiresAt: number | null;
}

export class AccessError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 503,
  ) {
    super(message);
  }
}

const jwksByTeam = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

function normalizedTeamDomain(raw: string): string {
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, "");
}

function isLocalPreview(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function identityFromPayload(payload: JWTPayload): OperatorIdentity {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  if (!email || !subject) {
    throw new AccessError("Access token is missing operator identity", 401);
  }
  return {
    email,
    subject,
    expiresAt: typeof payload.exp === "number" ? payload.exp : null,
  };
}

export async function verifyOperator(
  request: Request,
  env: AccessEnv,
): Promise<OperatorIdentity> {
  const devEmail = env.CF_ACCESS_DEV_EMAIL?.trim();
  if (devEmail && isLocalPreview(request)) {
    return {
      email: devEmail,
      subject: `local:${devEmail}`,
      expiresAt: null,
    };
  }

  const teamDomainRaw = env.CF_ACCESS_TEAM_DOMAIN?.trim();
  const audience = env.CF_ACCESS_AUD?.trim();
  if (!teamDomainRaw || !audience) {
    throw new AccessError("Cloudflare Access is not configured", 503);
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion")?.trim();
  if (!token) {
    throw new AccessError("Cloudflare Access session required", 401);
  }

  const teamDomain = normalizedTeamDomain(teamDomainRaw);
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", `${teamDomain}/`),
    );
    jwksByTeam.set(teamDomain, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: teamDomain,
      audience,
    });
    return identityFromPayload(payload);
  } catch (error) {
    if (error instanceof AccessError) throw error;
    throw new AccessError("Cloudflare Access session is invalid or expired", 401);
  }
}

export function accessErrorResponse(error: unknown): Response {
  if (error instanceof AccessError) {
    return Response.json(
      { error: error.message },
      { status: error.status },
    );
  }
  return Response.json(
    { error: "Operator authentication failed" },
    { status: 401 },
  );
}
