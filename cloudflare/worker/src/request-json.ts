import { HTTPException } from 'hono/http-exception';
import { boundedJsonResponse } from './decision-engine';

export async function readRequestJson(request: Request, maxBytes: number): Promise<unknown> {
  try {
    return await boundedJsonResponse(request, maxBytes);
  } catch (error) {
    const tooLarge = String(error).includes('exceeds size limit');
    throw new HTTPException(tooLarge ? 413 : 400, { message: tooLarge ? 'Request body exceeds size limit' : 'Invalid JSON request body' });
  }
}
