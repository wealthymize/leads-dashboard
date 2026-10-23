"use client";

import { FormEvent, Fragment, useRef, useState } from "react";
import { toCsv } from "@/lib/csv";

type LeadItem = Record<string, unknown>;
type TabId = "signup" | "partial";
type Query = Record<string, string>;

type PanelResult = {
  status: "idle" | "loading" | "ready" | "error";
  total: number | null;
  items: LeadItem[];
  page: number;
  limit: number;
  error: string;
  loadedAt: string | null;
  responseKeys: string[];
};

const EMPTY: PanelResult = {
  status: "idle",
  total: null,
  items: [],
  page: 1,
  limit: 10,
  error: "",
  loadedAt: null,
  responseKeys: [],
};

const TABLE_COLUMNS = [
  "learnerCreatedAt",
  "createdAt",
  "name",
  "email",
  "phoneNumber",
  "age",
  "profession",
  "status",
  "route",
];

const ALWAYS_TABLE_COLUMNS = new Set(["age", "profession"]);

const KNOWN_ROUTES = ["/checkout", "/meta/checkout", "/ggl/checkout"];

const ROUTE_LABELS: Record<string, string> = {
  "/checkout": "Checkout",
  "/meta/checkout": "Meta",
  "/ggl/checkout": "Google",
};

const EXPORT_COLUMNS = [
  "name",
  "email",
  "phoneNumber",
  "countryCode",
  "status",
  "profession",
  "age",
  "timezone",
  "route",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "fbp",
  "fbc",
  "marketingConsent",
  "learnerCreatedAt",
  "utmCreatedAt",
  "createdAt",
  "updatedAt",
  "clientIp",
  "userAgent",
];

const HIDDEN_COLUMNS = new Set(["password", "token", "accessToken", "refreshToken", "otp", "__v"]);

const COLUMN_LABELS: Record<string, string> = {
  learnerCreatedAt: "Time",
  createdAt: "Time",
  phoneNumber: "Phone",
  countryCode: "Country code",
  utm_source: "Source",
  utm_medium: "Medium",
  utm_campaign: "Campaign",
  utm_content: "Content",
  utm_term: "Term",
  fbclid: "Facebook click ID",
  fbp: "Facebook browser ID",
  fbc: "Facebook click cookie",
  marketingConsent: "Marketing consent",
  utmCreatedAt: "UTM captured",
  updatedAt: "Updated",
  clientIp: "IP address",
  userAgent: "User agent",
};

const ATTRIBUTION_FIELDS: Array<[string, string]> = [
  ["utm_source", "Source"],
  ["utm_medium", "Medium"],
  ["utm_campaign", "Campaign"],
  ["utm_content", "Content"],
  ["utm_term", "Term"],
  ["route", "Landing route"],
  ["fbclid", "Facebook click ID"],
  ["fbp", "Facebook browser ID"],
  ["fbc", "Facebook click cookie"],
  ["utmCreatedAt", "UTM captured"],
  ["clientIp", "IP address"],
  ["userAgent", "User agent"],
];

function isRecord(value: unknown): value is LeadItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenLead(row: LeadItem): LeadItem {
  const flat: LeadItem = { ...row };
  for (const key of ["user", "learner", "profile", "lead"]) {
    const nested = row[key];
    if (!isRecord(nested)) continue;
    for (const [childKey, childValue] of Object.entries(nested)) {
      if (!(childKey in flat)) flat[childKey] = childValue;
    }
  }
  return flat;
}

function columnLabel(key: string) {
  if (COLUMN_LABELS[key]) return COLUMN_LABELS[key];
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    }
  }
  return String(value);
}

function plainValue(value: unknown) {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function rowKey(row: LeadItem, index: number) {
  return String(row._id ?? row.id ?? row.email ?? index);
}

function columnsFor(items: LeadItem[]) {
  const present = new Set<string>();
  for (const item of items) {
    for (const [key, value] of Object.entries(item)) {
      if (HIDDEN_COLUMNS.has(key)) continue;
      if (ALWAYS_TABLE_COLUMNS.has(key) || (value != null && value !== "")) present.add(key);
    }
  }
  if (items.some((item) => "age" in item || "profession" in item)) {
    present.add("age");
    present.add("profession");
  }
  const preferred = TABLE_COLUMNS.filter((key) => present.has(key));
  if (preferred.includes("learnerCreatedAt")) {
    return preferred.filter((key) => key !== "createdAt");
  }
  return preferred;
}

function applyRouteFilter(items: LeadItem[], route: string) {
  const value = route.trim();
  if (!value) return items;
  return items.filter((item) => String(item.route ?? "").trim() === value);
}

function collectRoutes(items: LeadItem[]) {
  const routes = new Set<string>();
  for (const item of items) {
    const route = String(item.route ?? "").trim();
    if (route) routes.add(route);
  }
  return [...routes];
}

function mergeRouteList(current: string[], extra: string[]) {
  if (extra.length === 0) return current;
  const next = new Set(current);
  let changed = false;
  for (const route of extra) {
    if (!next.has(route)) {
      next.add(route);
      changed = true;
    }
  }
  return changed ? [...next] : current;
}

function routeOptionLabel(route: string) {
  return ROUTE_LABELS[route] ? `${ROUTE_LABELS[route]} (${route})` : route;
}

function orderedRouteOptions(routes: string[], selected: string) {
  const extra = [...routes, selected].map((route) => route.trim()).filter(Boolean);
  const unique = new Set([...KNOWN_ROUTES, ...extra]);
  const rest = [...unique].filter((route) => !KNOWN_ROUTES.includes(route)).sort((a, b) => a.localeCompare(b));
  return [...KNOWN_ROUTES.filter((route) => unique.has(route)), ...rest];
}

function queryKeyWithoutPage(query: Query) {
  return JSON.stringify({ ...query, page: "" });
}

function exportColumns(items: LeadItem[]) {
  const present = new Set<string>();
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!HIDDEN_COLUMNS.has(key)) present.add(key);
    }
  }
  const preferred = EXPORT_COLUMNS.filter((key) => present.has(key));
  const rest = [...present].filter((key) => !preferred.includes(key) && key !== "_id" && key !== "id");
  return [...preferred, ...rest];
}

function pillClass(status: string) {
  const value = status.toUpperCase();
  if (value === "ACTIVE" || value === "CONVERTED") return "pill pill-ok";
  if (value === "PENDING") return "pill pill-pending";
  return "pill pill-muted";
}

function attributionPath(lead: LeadItem) {
  const parts = ["utm_source", "utm_medium", "utm_campaign"]
    .map((key) => lead[key])
    .filter((value) => value != null && value !== "")
    .map(String);
  return parts.length ? parts.join(" / ") : "No campaign parameters";
}

async function requestLeads(endpoint: string, query: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const res = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
  const body = (await res.json()) as PanelResult & { error?: string };
  if (!res.ok) throw new Error(body.error || "Could not load leads.");
  return body;
}

async function fetchAllLeads(endpoint: string, query: Query) {
  const limit = "100";
  const items: LeadItem[] = [];
  let page = 1;
  let total: number | null = null;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const body = await requestLeads(endpoint, { ...query, page: String(page), limit });
    const batch = (Array.isArray(body.items) ? body.items : []).map(flattenLead);
    if (typeof body.total === "number") total = body.total;
    items.push(...batch);
    if (batch.length === 0) break;
    if (total !== null && items.length >= total) break;
    if (batch.length < Number(limit)) break;
    page += 1;
  }

  return items;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function abandonedOnly(result: PanelResult): PanelResult {
  const items = result.items.filter((item) => String(item.status ?? "").toUpperCase() === "ABANDONED");
  if (items.length === result.items.length) return result;
  return { ...result, items, total: items.length };
}

function totalCaption(result: PanelResult) {
  if (!result.loadedAt) return result.status === "loading" ? "Loading..." : "Not loaded";
  if (result.total === null) return "Total was not in the response";
  const time = new Date(result.loadedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Loaded ${time}`;
}

function ExportIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function LeadPanel({
  title,
  endpoint,
  filename,
  result,
  onResult,
  selectedKey,
  onSelect,
  stats,
  children,
  buildQuery,
  onDiscoverRoutes,
}: {
  title: string;
  endpoint: string;
  filename: string;
  result: PanelResult;
  onResult: (result: PanelResult) => void;
  selectedKey: string | null;
  onSelect: (lead: LeadItem | null, key: string | null) => void;
  stats: React.ReactNode;
  children: React.ReactNode;
  buildQuery: (page: number) => Query | string;
  onDiscoverRoutes?: (routes: string[]) => void;
}) {
  const [applied, setApplied] = useState<Query | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const requestId = useRef(0);
  const routeCache = useRef<{ key: string; items: LeadItem[] } | null>(null);

  async function load(query: Query) {
    const request = ++requestId.current;
    setExportNote("");
    onSelect(null, null);
    onResult({ ...result, status: "loading", error: "" });
    try {
      const page = Number(query.page || 1);
      const limit = Number(query.limit || 10);
      const route = (query.route || "").trim();
      let items: LeadItem[];
      let total: number | null;
      let responseKeys: string[] = [];

      if (route) {
        const key = queryKeyWithoutPage({ ...query, route: "" });
        const cached = page > 1 && routeCache.current?.key === key ? routeCache.current.items : null;
        const all = cached ?? (await fetchAllLeads(endpoint, { ...query, route: "" }));
        routeCache.current = { key, items: all };
        onDiscoverRoutes?.(collectRoutes(all));
        const filtered = applyRouteFilter(all, route);
        total = filtered.length;
        items = filtered.slice((Math.max(page, 1) - 1) * limit, Math.max(page, 1) * limit);
      } else {
        routeCache.current = null;
        const body = await requestLeads(endpoint, query);
        total = typeof body.total === "number" ? body.total : null;
        items = (Array.isArray(body.items) ? body.items : []).map(flattenLead);
        responseKeys = Array.isArray(body.responseKeys) ? body.responseKeys : [];
        onDiscoverRoutes?.(collectRoutes(items));
      }

      if (request !== requestId.current) return;
      setApplied(query);
      onResult({
        status: "ready",
        total,
        items,
        page: Number.isFinite(page) && page > 0 ? page : 1,
        limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
        error: "",
        loadedAt: new Date().toISOString(),
        responseKeys,
      });
    } catch (error) {
      if (request !== requestId.current) return;
      onResult({
        ...result,
        status: "error",
        error: error instanceof Error ? error.message : "Could not load leads.",
      });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const query = buildQuery(1);
    if (typeof query === "string") {
      onResult({ ...result, status: "error", error: query });
      return;
    }
    void load(query);
  }

  async function exportCsv() {
    const query = buildQuery(1);
    if (typeof query === "string") {
      onResult({ ...result, error: query });
      return;
    }
    setExporting(true);
    setExportNote("");
    try {
      const all = await fetchAllLeads(endpoint, { ...query, route: "" });
      onDiscoverRoutes?.(collectRoutes(all));
      const items = applyRouteFilter(all, query.route || "");
      if (items.length === 0) {
        setExportNote("No leads matched these filters.");
        return;
      }
      const keys = exportColumns(items);
      const csv = toCsv(
        keys.map(columnLabel),
        items.map((item) => keys.map((key) => plainValue(item[key])))
      );
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`${filename}-${stamp}.csv`, csv);
      setExportNote(`Exported ${items.length.toLocaleString()} ${title.toLowerCase()}.`);
    } catch (error) {
      onResult({
        ...result,
        error: error instanceof Error ? error.message : "Could not export leads.",
      });
    } finally {
      setExporting(false);
    }
  }

  const columns = columnsFor(result.items);
  const hasNext =
    result.total !== null
      ? result.page * result.limit < result.total
      : result.items.length >= result.limit && result.items.length > 0;
  const selectedLead = result.items.find((row, index) => rowKey(row, index) === selectedKey) ?? null;
  const colSpan = Math.max(columns.length + 1, 1);

  return (
    <>
      <form className="filters" onSubmit={onSubmit}>
        {children}
        <div className="actions">
          <button className="button button-primary" type="submit" disabled={result.status === "loading"}>
            {result.status === "loading" ? "Loading..." : "Load Report"}
          </button>
        </div>
      </form>

      {result.error ? (
        <p className="error" role="alert">
          {result.error}
        </p>
      ) : null}

      {stats}

      <section className="board">
        <div className="card-glass">
          <div className="card-head">
            <h2>
              {title}
              {result.total !== null ? ` (${result.total.toLocaleString()})` : ""}
            </h2>
            <button className="button button-export" type="button" onClick={() => void exportCsv()} disabled={exporting}>
              <ExportIcon />
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>

          {exportNote ? <p className="export-note">{exportNote}</p> : null}

          {result.status === "idle" ? (
            <div className="empty">Select a range and load the report to see metrics.</div>
          ) : null}

          {result.status === "loading" && !result.loadedAt ? (
            <div className="empty">Loading {title.toLowerCase()}...</div>
          ) : null}

          {result.loadedAt && result.items.length === 0 ? (
            <div className="empty">No leads matched these filters.</div>
          ) : null}

          {result.loadedAt && result.items.length > 0 ? (
            <>
              <div className="table-wrap">
                <table className="leads-table">
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{columnLabel(column)}</th>
                      ))}
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((row, index) => {
                      const key = rowKey(row, index);
                      const open = selectedKey === key;
                      return (
                        <Fragment key={key}>
                          <tr
                            className={open ? "is-selected" : undefined}
                            onClick={() => onSelect(open ? null : row, open ? null : key)}
                          >
                            {columns.map((column) => (
                              <td key={column} title={formatValue(row[column])}>
                                {column === "status" && row.status ? (
                                  <span className={pillClass(String(row.status))}>{String(row.status)}</span>
                                ) : (
                                  formatValue(row[column])
                                )}
                              </td>
                            ))}
                            <td>
                              <button
                                className="text-button"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onSelect(open ? null : row, open ? null : key);
                                }}
                              >
                                {open ? "Hide" : "View"}
                              </button>
                            </td>
                          </tr>
                          {open && selectedLead ? (
                            <tr className="lead-details-row">
                              <td colSpan={colSpan}>
                                <p className="path">{attributionPath(selectedLead)}</p>
                                <dl className="lead-details-panel">
                                  {ATTRIBUTION_FIELDS.map(([field, label]) => (
                                    <div className="lead-details-item" key={field}>
                                      <dt>{label}</dt>
                                      <dd>{formatValue(selectedLead[field])}</dd>
                                    </div>
                                  ))}
                                  {["profession", "age", "timezone", "marketingConsent", "learnerCreatedAt", "createdAt"].map(
                                    (field) =>
                                      selectedLead[field] == null || selectedLead[field] === "" ? null : (
                                        <div className="lead-details-item" key={field}>
                                          <dt>{columnLabel(field)}</dt>
                                          <dd>{formatValue(selectedLead[field])}</dd>
                                        </div>
                                      )
                                  )}
                                </dl>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="pager">
                <p>
                  Page {result.page}
                  {result.total !== null ? ` of ${Math.max(1, Math.ceil(result.total / result.limit))}` : ""}
                  {" · "}
                  {result.items.length.toLocaleString()} shown
                </p>
                <div className="pager-actions">
                  <button
                    type="button"
                    disabled={!applied || result.page <= 1 || result.status === "loading"}
                    onClick={() => applied && void load({ ...applied, page: String(result.page - 1) })}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={!applied || !hasNext || result.status === "loading"}
                    onClick={() => applied && void load({ ...applied, page: String(result.page + 1) })}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Totals({ kind, result }: { kind: TabId; result: PanelResult }) {
  const label = kind === "signup" ? "Signup Leads" : "Partial Leads";
  return (
    <section className="metrics" aria-label="Lead totals">
      <article className={`metric metric-${kind}`}>
        <span className="metric-label">{label}</span>
        <strong className={result.total === null ? "is-empty" : undefined}>
          {result.total === null ? "—" : result.total.toLocaleString()}
        </strong>
        <small>{totalCaption(result)}</small>
      </article>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function RouteField({
  value,
  onChange,
  routes,
}: {
  value: string;
  onChange: (value: string) => void;
  routes: string[];
}) {
  const options = orderedRouteOptions(routes, value);
  return (
    <Field label="Route">
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">All routes</option>
        {options.map((route) => (
          <option key={route} value={route}>
            {routeOptionLabel(route)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Dashboard() {
  const [tab, setTab] = useState<TabId>("signup");
  const [signup, setSignup] = useState<PanelResult>(EMPTY);
  const [partial, setPartial] = useState<PanelResult>(EMPTY);
  const [selected, setSelected] = useState<{ tab: TabId; lead: LeadItem; key: string } | null>(null);
  const [signupDraft, setSignupDraft] = useState({
    range: "today",
    startDate: "",
    endDate: "",
    limit: "10",
    route: "",
  });
  const [partialDraft, setPartialDraft] = useState({
    startDate: "",
    endDate: "",
    limit: "10",
    route: "",
  });
  const [signupRoutes, setSignupRoutes] = useState<string[]>(KNOWN_ROUTES);
  const [partialRoutes, setPartialRoutes] = useState<string[]>(KNOWN_ROUTES);
  const abandonedPartial = abandonedOnly(partial);

  function switchTab(next: TabId) {
    setTab(next);
    setSelected(null);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <h1>Leads Dashboard</h1>
          <div className="nav">
            <button
              className={`nav-btn${tab === "signup" ? " is-active" : ""}`}
              type="button"
              onClick={() => switchTab("signup")}
            >
              Signup Leads
            </button>
            <button
              className={`nav-btn${tab === "partial" ? " is-active" : ""}`}
              type="button"
              onClick={() => switchTab("partial")}
            >
              Partial Leads
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <div hidden={tab !== "signup"}>
          <LeadPanel
            title="Signup Leads"
            endpoint="/api/signup-leads"
            filename="signup-leads"
            result={signup}
            onResult={setSignup}
            selectedKey={selected?.tab === "signup" ? selected.key : null}
            onSelect={(lead, key) => setSelected(lead && key ? { tab: "signup", lead, key } : null)}
            onDiscoverRoutes={(routes) => setSignupRoutes((current) => mergeRouteList(current, routes))}
            stats={<Totals kind="signup" result={signup} />}
            buildQuery={(page) => {
              if (signupDraft.range === "custom" && (!signupDraft.startDate || !signupDraft.endDate)) {
                return "Choose a start and end date for a custom range.";
              }
              const query: Query = {
                range: signupDraft.range,
                page: String(page),
                limit: signupDraft.limit,
                route: signupDraft.route,
              };
              if (signupDraft.range === "custom") {
                query.startDate = signupDraft.startDate;
                query.endDate = signupDraft.endDate;
              }
              return query;
            }}
          >
            <Field label="Range">
              <select
                value={signupDraft.range}
                onChange={(event) => setSignupDraft((draft) => ({ ...draft, range: event.target.value }))}
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="7days">Last 7 days</option>
                <option value="1month">Last month</option>
                <option value="custom">Custom range</option>
              </select>
            </Field>
            {signupDraft.range === "custom" ? (
              <>
                <Field label="Start date">
                  <input
                    type="date"
                    value={signupDraft.startDate}
                    onChange={(event) => setSignupDraft((draft) => ({ ...draft, startDate: event.target.value }))}
                    required
                  />
                </Field>
                <Field label="End date">
                  <input
                    type="date"
                    value={signupDraft.endDate}
                    onChange={(event) => setSignupDraft((draft) => ({ ...draft, endDate: event.target.value }))}
                    required
                  />
                </Field>
              </>
            ) : null}
            <RouteField
              value={signupDraft.route}
              onChange={(route) => setSignupDraft((draft) => ({ ...draft, route }))}
              routes={signupRoutes}
            />
            <Field label="Rows">
              <select
                value={signupDraft.limit}
                onChange={(event) => setSignupDraft((draft) => ({ ...draft, limit: event.target.value }))}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </Field>
          </LeadPanel>
        </div>

        <div hidden={tab !== "partial"}>
          <LeadPanel
            title="Partial Leads"
            endpoint="/api/partial-leads"
            filename="partial-leads"
            result={abandonedPartial}
            onResult={setPartial}
            selectedKey={selected?.tab === "partial" ? selected.key : null}
            onSelect={(lead, key) => setSelected(lead && key ? { tab: "partial", lead, key } : null)}
            onDiscoverRoutes={(routes) => setPartialRoutes((current) => mergeRouteList(current, routes))}
            stats={<Totals kind="partial" result={abandonedPartial} />}
            buildQuery={(page) => ({
              page: String(page),
              limit: partialDraft.limit,
              status: "ABANDONED",
              startDate: partialDraft.startDate,
              endDate: partialDraft.endDate,
              route: partialDraft.route,
            })}
          >
            <span className="scope-pill">Abandoned only</span>
            <Field label="Start date">
              <input
                type="date"
                value={partialDraft.startDate}
                onChange={(event) => setPartialDraft((draft) => ({ ...draft, startDate: event.target.value }))}
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={partialDraft.endDate}
                onChange={(event) => setPartialDraft((draft) => ({ ...draft, endDate: event.target.value }))}
              />
            </Field>
            <RouteField
              value={partialDraft.route}
              onChange={(route) => setPartialDraft((draft) => ({ ...draft, route }))}
              routes={partialRoutes}
            />
            <Field label="Rows">
              <select
                value={partialDraft.limit}
                onChange={(event) => setPartialDraft((draft) => ({ ...draft, limit: event.target.value }))}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </Field>
          </LeadPanel>
        </div>
      </main>
    </div>
  );
}
