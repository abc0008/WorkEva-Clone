export async function GET() {
  return Response.json({ status: "ok", service: "workeva", version: "0.3.0" });
}
