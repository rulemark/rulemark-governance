/**
 * Render's health check, as the API's (`ropa-api.md` §1.1): is this process
 * serving? Deliberately shallow, so a slow API doesn't take the web app out of
 * rotation with it.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json(
    { status: 'ok', uptime: Math.round(process.uptime()) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
