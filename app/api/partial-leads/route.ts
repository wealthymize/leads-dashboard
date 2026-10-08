import { NextRequest } from "next/server";
import { proxyLeads } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyLeads("/api/partial-lead", request.nextUrl.searchParams, [
    "page",
    "limit",
    "startDate",
    "endDate",
    "status",
  ]);
}
