export type LeadItem = Record<string, unknown>;

export type NormalizedPage = {
  total: number | null;
  items: LeadItem[];
  page: number;
  limit: number;
  responseKeys: string[];
};

const ITEM_KEYS = [
  "leads",
  "items",
  "results",
  "learners",
  "records",
  "rows",
  "data",
  "partialLeads",
  "learnerDetails",
  "signupLeads",
  "list",
  "content",
];

const TOTAL_KEYS = [
  "total",
  "totalCount",
  "totalLeads",
  "totalItems",
  "totalRecords",
  "total_count",
  "total_leads",
  "totalElements",
  "totalDocs",
  "recordsTotal",
  "count",
];

const META_KEYS = ["pagination", "meta", "pageInfo", "data"];

export function isRecord(value: unknown): value is LeadItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function readNestedNumber(payload: unknown, keys: string[], depth = 0): number | null {
  if (!isRecord(payload) || depth > 3) return null;
  for (const key of keys) {
    const value = asNumber(payload[key]);
    if (value !== null) return value;
  }
  for (const key of ["pagination", "meta", "pageInfo", "data"]) {
    const found = readNestedNumber(payload[key], keys, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function readTotal(obj: LeadItem): number | null {
  for (const key of TOTAL_KEYS) {
    const value = asNumber(obj[key]);
    if (value !== null) return value;
  }
  return null;
}

export function extractTotal(payload: unknown): number | null {
  if (!isRecord(payload)) return null;
  const direct = readTotal(payload);
  if (direct !== null) return direct;

  for (const key of META_KEYS) {
    const nested = payload[key];
    if (!isRecord(nested)) continue;
    const found = readTotal(nested);
    if (found !== null) return found;
    for (const inner of ["pagination", "meta", "pageInfo"]) {
      if (isRecord(nested[inner])) {
        const deep = readTotal(nested[inner]);
        if (deep !== null) return deep;
      }
    }
  }

  return null;
}

function asRows(value: unknown): LeadItem[] | null {
  if (!Array.isArray(value)) return null;
  if (value.every(isRecord)) return value;
  return null;
}

function findRows(payload: unknown, depth: number): LeadItem[] | null {
  const direct = asRows(payload);
  if (direct) return direct;
  if (!isRecord(payload) || depth > 3) return null;

  for (const key of ITEM_KEYS) {
    const rows = asRows(payload[key]);
    if (rows) return rows;
  }

  for (const key of ITEM_KEYS) {
    const nested = findRows(payload[key], depth + 1);
    if (nested) return nested;
  }

  return null;
}

export function normalizeLeadPage(
  payload: unknown,
  fallback: { page: number; limit: number }
): NormalizedPage {
  let items = findRows(payload, 0) ?? [];

  if (items.length === 0 && isRecord(payload)) {
    const looksLikeLead = ["email", "phone", "mobile", "name", "fullName"].some(
      (key) => key in payload
    );
    if (looksLikeLead) items = [payload];
  }

  const page = readNestedNumber(payload, ["page", "currentPage", "current_page"]) ?? fallback.page;
  const limit = readNestedNumber(payload, ["limit", "pageSize", "perPage", "per_page"]) ?? fallback.limit;

  return {
    total: extractTotal(payload),
    items,
    page,
    limit,
    responseKeys: isRecord(payload) ? Object.keys(payload) : [],
  };
}
