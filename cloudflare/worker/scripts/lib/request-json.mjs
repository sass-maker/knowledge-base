/**
 * Shared JSON fetch helper used by benchmark, eval, and migration scripts.
 * Sends an authenticated JSON request and throws on non-2xx responses.
 */
export async function requestJson(url, { key, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} failed ${res.status}: ${JSON.stringify(payload)}`);
  return payload;
}
