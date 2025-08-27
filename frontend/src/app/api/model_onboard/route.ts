import { NextRequest, NextResponse } from "next/server";

const FLASK_ONBOARD_PATH = "/api/model/onboard_model"; // matches Flask blueprint route

export async function POST(req: NextRequest) {
  const backendUrl = process.env.PRIVATE_BACKEND_API_URL;
  if (!backendUrl) {
    return NextResponse.json({ error: "Missing PRIVATE_BACKEND_API_URL" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Optional: quick sanity check that an id exists (your UI auto-generates it)
  if (!body || typeof (body as any).id !== "string" || !(body as any).id.trim()) {
    return NextResponse.json({ error: "Payload must include 'id' (string)" }, { status: 400 });
  }

  const url = `${backendUrl.replace(/\/+$/, "")}${FLASK_ONBOARD_PATH}`;

  // Add a timeout so the request doesn't hang forever
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const flaskRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const ct = flaskRes.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");
    if (!isJson) {
      const text = await flaskRes.text().catch(() => "");
      return NextResponse.json(
        { error: "Backend did not return JSON", detail: text || ct },
        { status: 502 },
      );
    }

    const data = await flaskRes.json();
    // Pass through backend status if sensible, otherwise default to 200
    return NextResponse.json(data, { status: flaskRes.status || 200 });
  } catch (err: any) {
    clearTimeout(timeout);
    const message =
      err?.name === "AbortError" ? "Upstream request timed out" : (err?.message ?? "Proxy error");
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

// (Optional) Block GET on this route to avoid confusion
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
