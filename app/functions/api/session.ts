import { accessErrorResponse, verifyOperator, type AccessEnv } from '../_lib/access';

interface SessionContext {
  request: Request;
  env: AccessEnv;
}

export async function onRequest(context: SessionContext): Promise<Response> {
  try {
    const operator = await verifyOperator(context.request, context.env);
    return Response.json({ operator });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
