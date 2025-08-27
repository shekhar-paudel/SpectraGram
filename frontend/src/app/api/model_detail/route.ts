import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const backendUrl = process.env.PRIVATE_BACKEND_API_URL;
  const id = (req.nextUrl.searchParams.get("id") || "").trim();

  if (!backendUrl) {
    return NextResponse.json({ error: "Missing backend URL" }, { status: 500 });
  }

  const flaskRes = await fetch(`${backendUrl}/api/model/model_detail?id=${encodeURIComponent(id)}`);

  const contentType = flaskRes.headers.get("content-type");

  if (!flaskRes.ok || !contentType?.includes("application/json")) {
    const text = await flaskRes.text();
    console.error("Unexpected response:", text);
    return NextResponse.json({ error: "Backend did not return JSON", detail: text }, { status: 502 });
  }

  const data = await flaskRes.json();
  return NextResponse.json(data);
}
