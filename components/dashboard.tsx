"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
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
  "name",
  "email",
  "phoneNumber",
  "status",
  "utm_source",
  "route",
  "learnerCreatedAt",
  "createdAt",
  "updatedAt",
];

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
  learnerCreatedAt: "Signed up",
  utmCreatedAt: "UTM captured",
  createdAt: "Created",
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
  if (value == null || value === "") return "—";
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
      if (value == null || value === "" || HIDDEN_COLUMNS.has(key)) continue;
      present.add(key);
    }
  }
  return TABLE_COLUMNS.filter((key) => present.has(key)).slice(0, 7);
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

function totalCaption(result: PanelResult) {
  if (!result.loadedAt) return result.status === "loading" ? "Loading" : "Not loaded";
  if (result.total === null) return "Total was not in the response";
  const time = new Date(result.loadedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `Loaded ${time}`;
}

function LeadDrawer({
  lead,
  title,
  onClose,
}: {
  lead: LeadItem;
  title: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const contact = [
    ["Email", lead.email],
    ["Phone", [lead.countryCode, lead.phoneNumber].filter(Boolean).join(" ")],
    ["Profession", lead.profession],
    ["Age", lead.age],
    ["Timezone", lead.timezone],
    ["Marketing consent", lead.marketingConsent],
    ["Signed up", lead.learnerCreatedAt],
    ["Created", lead.createdAt],
    ["Updated", lead.updatedAt],
  ].filter(([, value]) => value != null && value !== "");

  return (
    <>
      <button className="backdrop" type="button" aria-label="Close lead details" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="lead-title">
        <div className="drawer-head">
          <div>
            <p className="drawer-kicker">{title}</p>
            <h2 id="lead-title">{formatValue(lead.name)}</h2>
            {lead.status ? <span className={pillClass(String(lead.status))}>{String(lead.status)}</span> : null}
          </div>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="contact-line">
          <strong>{formatValue(lead.email)}</strong>
          {lead.phoneNumber ? ` · ${formatValue([lead.countryCode, lead.phoneNumber].filter(Boolean).join(" "))}` : ""}
        </p>

        <section className="detail-section">
          <h3>Attribution</h3>
          <p className="path">{attributionPath(lead)}</p>
          <dl className="detail-grid">
            {ATTRIBUTION_FIELDS.map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{formatValue(lead[key])}</dd>
              </div>
            ))}
          </dl>
        </section>

        {contact.length ? (
          <section className="detail-section">
            <h3>Lead details</h3>
            <dl className="detail-grid">
              {contact.map(([label, value]) => (
                <div key={String(label)}>
                  <dt>{label}</dt>
                  <dd>{formatValue(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </aside>
    </>
  );
}

function LeadPanel({
  id,
  title,
  endpoint,
  filename,
  result,
  onResult,
  selectedKey,
  onSelect,
  children,
  buildQuery,
}: {
  id: string;
  title: string;
  endpoint: string;
  filename: string;
  result: PanelResult;
  onResult: (result: PanelResult) => void;
  selectedKey: string | null;
  onSelect: (lead: LeadItem, key: string) => void;
  children: React.ReactNode;
  buildQuery: (page: number) => Query | string;
}) {
  const [applied, setApplied] = useState<Query | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const requestId = useRef(0);

  async function load(query: Query) {
    const request = ++requestId.current;
    setExportNote("");
    onResult({ ...result, status: "loading", error: "" });
    try {
      const body = await requestLeads(endpoint, query);
      if (request !== requestId.current) return;
      setApplied(query);
      onResult({
        status: "ready",
        total: typeof body.total === "number" ? body.total : null,
        items: (Array.isArray(body.items) ? body.items : []).map(flattenLead),
        page: body.page || Number(query.page || 1),
        limit: body.limit || Number(query.limit || 10),
        error: "",
        loadedAt: new Date().toISOString(),
        responseKeys: Array.isArray(body.responseKeys) ? body.responseKeys : [],
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
      const items = await fetchAllLeads(endpoint, query);
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

  return (
    <div role="tabpanel" id={id} aria-labelledby={`${id}-tab`}>
      <div className="toolbar">
        <form className="filters" onSubmit={onSubmit}>
          {children}
          <button className="button button-primary" type="submit" disabled={result.status === "loading"}>
            {result.status === "loading" ? "Loading…" : "Load leads"}
          </button>
        </form>
        <div className="actions">
          <button className="button button-secondary" type="button" onClick={() => void exportCsv()} disabled={exporting}>
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="board-body">
        {result.error ? (
          <p className="error" role="alert">
            {result.error}
          </p>
        ) : null}
        {exportNote ? <p className="export-note">{exportNote}</p> : null}

        {result.status === "idle" ? (
          <div className="empty">
            <strong>{title} are not loaded</strong>
            <p>Choose filters, then load this list. Export uses the same filters and includes attribution columns.</p>
          </div>
        ) : null}

        {result.status === "loading" && !result.loadedAt ? (
          <div className="empty">
            <strong>Loading {title.toLowerCase()}</strong>
            <p>Fetching the current page.</p>
          </div>
        ) : null}

        {result.loadedAt ? (
          <>
            {result.items.length === 0 ? (
              <div className="empty">
                <strong>No leads matched</strong>
                <p>Try another range, status, or date.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {columns.map((column) => (
                        <th key={column}>{columnLabel(column)}</th>
                      ))}
                      <th>Attribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((row, index) => {
                      const key = rowKey(row, index);
                      return (
                        <tr
                          key={key}
                          className={selectedKey === key ? "is-selected" : undefined}
                          tabIndex={0}
                          onClick={() => onSelect(row, key)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              onSelect(row, key);
                            }
                          }}
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
                                onSelect(row, key);
                              }}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

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
    </div>
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

function Metric({
  label,
  result,
  active,
  onClick,
}: {
  label: string;
  result: PanelResult;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`metric${active ? " is-active" : ""}`} type="button" onClick={onClick} aria-pressed={active}>
      <span className="metric-label">{label}</span>
      <strong className={result.total === null ? "is-empty" : undefined}>
        {result.total === null ? "—" : result.total.toLocaleString()}
      </strong>
      <small>{totalCaption(result)}</small>
    </button>
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
  });
  const [partialDraft, setPartialDraft] = useState({
    status: "",
    startDate: "",
    endDate: "",
    limit: "10",
  });

  function switchTab(next: TabId) {
    setTab(next);
    setSelected(null);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            W
          </div>
          <p className="brand-name">
            Wealthymize <span>/ Leads</span>
          </p>
        </div>
        <p className="topbar-note">Lists stay empty until you load them.</p>
      </header>

      <main className="page">
        <section className="metrics" aria-label="Lead totals">
          <Metric label="Signup leads" result={signup} active={tab === "signup"} onClick={() => switchTab("signup")} />
          <Metric label="Partial leads" result={partial} active={tab === "partial"} onClick={() => switchTab("partial")} />
        </section>

        <section className="board">
          <div className="tabs" role="tablist" aria-label="Lead types">
            <button
              className="tab"
              id="signup-panel-tab"
              type="button"
              role="tab"
              aria-selected={tab === "signup"}
              aria-controls="signup-panel"
              tabIndex={tab === "signup" ? 0 : -1}
              onClick={() => switchTab("signup")}
            >
              Signup leads
              <span className="tab-count">{signup.total === null ? "—" : signup.total.toLocaleString()}</span>
            </button>
            <button
              className="tab"
              id="partial-panel-tab"
              type="button"
              role="tab"
              aria-selected={tab === "partial"}
              aria-controls="partial-panel"
              tabIndex={tab === "partial" ? 0 : -1}
              onClick={() => switchTab("partial")}
            >
              Partial leads
              <span className="tab-count">{partial.total === null ? "—" : partial.total.toLocaleString()}</span>
            </button>
          </div>

          <div hidden={tab !== "signup"}>
            <LeadPanel
              id="signup-panel"
              title="Signup leads"
              endpoint="/api/signup-leads"
              filename="signup-leads"
              result={signup}
              onResult={setSignup}
              selectedKey={selected?.tab === "signup" ? selected.key : null}
              onSelect={(lead, key) => setSelected({ tab: "signup", lead, key })}
              buildQuery={(page) => {
                if (signupDraft.range === "custom" && (!signupDraft.startDate || !signupDraft.endDate)) {
                  return "Choose a start and end date for a custom range.";
                }
                const query: Query = {
                  range: signupDraft.range,
                  page: String(page),
                  limit: signupDraft.limit,
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
                  <Field label="Start">
                    <input
                      type="date"
                      value={signupDraft.startDate}
                      onChange={(event) =>
                        setSignupDraft((draft) => ({ ...draft, startDate: event.target.value }))
                      }
                      required
                    />
                  </Field>
                  <Field label="End">
                    <input
                      type="date"
                      value={signupDraft.endDate}
                      onChange={(event) => setSignupDraft((draft) => ({ ...draft, endDate: event.target.value }))}
                      required
                    />
                  </Field>
                </>
              ) : null}
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
              id="partial-panel"
              title="Partial leads"
              endpoint="/api/partial-leads"
              filename="partial-leads"
              result={partial}
              onResult={setPartial}
              selectedKey={selected?.tab === "partial" ? selected.key : null}
              onSelect={(lead, key) => setSelected({ tab: "partial", lead, key })}
              buildQuery={(page) => ({
                page: String(page),
                limit: partialDraft.limit,
                status: partialDraft.status,
                startDate: partialDraft.startDate,
                endDate: partialDraft.endDate,
              })}
            >
              <Field label="Status">
                <select
                  value={partialDraft.status}
                  onChange={(event) => setPartialDraft((draft) => ({ ...draft, status: event.target.value }))}
                >
                  <option value="">All</option>
                  <option value="PENDING">Pending</option>
                  <option value="CONVERTED">Converted</option>
                  <option value="ABANDONED">Abandoned</option>
                </select>
              </Field>
              <Field label="From">
                <input
                  type="date"
                  value={partialDraft.startDate}
                  onChange={(event) =>
                    setPartialDraft((draft) => ({ ...draft, startDate: event.target.value }))
                  }
                />
              </Field>
              <Field label="To">
                <input
                  type="date"
                  value={partialDraft.endDate}
                  onChange={(event) => setPartialDraft((draft) => ({ ...draft, endDate: event.target.value }))}
                />
              </Field>
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
        </section>
      </main>

      {selected ? (
        <LeadDrawer
          lead={selected.lead}
          title={selected.tab === "signup" ? "Signup lead" : "Partial lead"}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
