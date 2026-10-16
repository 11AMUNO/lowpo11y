export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, service: "lowpo11y", time: new Date().toISOString() });
}
