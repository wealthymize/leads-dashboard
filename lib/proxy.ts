import { NextResponse } from "next/server";
import { isRecord, normalizeLeadPage } from "@/lib/normalize";

function apiBase() {
  return (process.env.API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
}

function messageFrom(payload: unknown, status: number) {
  if (isRecord(payload)) {
    for (const key of ["message", "error", "detail"]) {
      if (typeof payload[key] === "string" && payload[key].trim()) return payload[key];
    }
  }
  return `Leads API returned ${status}.`;
}

export async function proxyLeads(path: string, searchParams: URLSearchParams, allowed: string[]) {
  const params = new URLSearchParams();
  for (const key of allowed) {
    const value = searchParams.get(key);
    if (value) params.set(key, value);
  }

  const page = Number(params.get("page") || "1");
  const limit = Number(params.get("limit") || "10");
  const query = params.toString();
  const base = apiBase();
  const url = `${base}${path}${query ? `?${query}` : ""}`;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const text = await res.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "Leads API returned a non-JSON response." },
          { status: 502 }
        );
      }
    }

    if (!res.ok) {
      return NextResponse.json({ error: messageFrom(payload, res.status) }, { status: res.status });
    }

    return NextResponse.json(
      normalizeLeadPage(payload, {
        page: Number.isFinite(page) ? page : 1,
        limit: Number.isFinite(limit) ? limit : 10,
      })
    );
  } catch {
    return NextResponse.json(
      { error: `Could not reach the leads API at ${base}.` },
      { status: 502 }
    );
  }
}
