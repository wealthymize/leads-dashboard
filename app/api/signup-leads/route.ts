import { NextRequest } from "next/server";
import { proxyLeads } from "@/lib/proxy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return proxyLeads("/api/learner-details", request.nextUrl.searchParams, [
    "range",
    "startDate",
    "endDate",
    "page",
    "limit",
  ]);
}
