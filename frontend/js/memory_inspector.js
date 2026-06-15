const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let allCustomers = [];
let selectedCustomerId = null;

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = "./login.html"; return; }
  if (session.user.email !== ADMIN_EMAIL) { window.location.href = "./chat.html"; return; }

  const tbody = document.getElementById("memory-table-body");
  if (!tbody) return;

  tbody.innerHTML = `<div style="padding:48px;text-align:center;color:var(--color-muted-foreground);font-size:14px">Loading customers…</div>`;
  document.querySelectorAll(".skeleton, .skeleton-card").forEach(el => el.style.display = "none");
  document.querySelectorAll(".skeleton-target").forEach(el => el.style.display = "");

  try {
    const me = await fetchJSON("/debug/me");
    if (!me.user || me.user.role !== "admin") { window.location.href = "./chat.html"; return; }
  } catch (e) {
    console.error("/debug/me failed", e);
  }

  try {
    const customers = await fetchJSON("/customers");
    if (!customers || !customers.length) { showEmpty("No customers found."); return; }

    allCustomers = await Promise.all(
      customers.map(async (c) => {
        const [memories, tickets] = await Promise.all([
          fetchJSON(`/customers/${c.id}/memories`).catch(() => []),
          fetchJSON(`/customers/${c.id}/tickets`).catch(() => []),
        ]);
        return { ...c, memories: memories || [], tickets: tickets || [] };
      })
    );

    renderTable(allCustomers);
    wireSearch();
    wireFilters();
    wireActions();
  } catch (err) {
    console.error("memory inspector init failed:", err);
    showEmpty("Could not connect to backend: " + (err.message || err));
  }
})();

function wireSearch() {
  const input = document.getElementById("customer-search");
  if (!input) return;
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.toLowerCase().trim();
      renderTable(q ? allCustomers.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) : applyFilters(allCustomers));
    }, 200);
  });
}

let activeFilter = null;
const FILTER_FNS = {
  frustrated: c => c.frustration_score > 60,
  unresolved: c => c.tickets.some(t => t.status === "open" || t.status === "escalated"),
  recent: c => {
    if (!c.memories.length) return false;
    const weekAgo = Date.now() - 7 * 86400000;
    return c.memories.some(m => new Date(m.created_at).getTime() > weekAgo);
  },
};

function wireFilters() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.filter;
      if (f === "all") { activeFilter = null; }
      else { activeFilter = activeFilter === f ? null : f; }
      updateFilterUI();
      const input = document.getElementById("customer-search");
      const q = input?.value.toLowerCase().trim();
      renderTable(q ? allCustomers.filter(c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)) : applyFilters(allCustomers));
    });
  });
}

function applyFilters(list) {
  if (!activeFilter) return list;
  const fn = FILTER_FNS[activeFilter];
  return fn ? list.filter(fn) : list;
}

function updateFilterUI() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    const f = btn.dataset.filter;
    if (f === "all") { btn.style.display = activeFilter ? "" : "none"; return; }
    if (f === activeFilter) {
      btn.className = "filter-btn text-xs font-medium px-3 py-1.5 rounded-md border bg-danger text-danger-foreground border-danger";
    } else {
      btn.className = "filter-btn text-xs font-medium px-3 py-1.5 rounded-md border bg-card text-muted-foreground border-border";
    }
  });
  const clearBtn = document.getElementById("clear-filter");
  if (clearBtn) clearBtn.style.display = activeFilter ? "" : "none";
}

function wireActions() {
  document.getElementById("btn-audit")?.addEventListener("click", runAudit);
  document.getElementById("btn-export")?.addEventListener("click", exportSnapshot);
  document.getElementById("btn-clear")?.addEventListener("click", clearFacts);
  document.getElementById("close-detail")?.addEventListener("click", () => {
    selectedCustomerId = null;
    document.getElementById("customer-detail").classList.add("hidden");
  });
}

function runAudit() {
  const total = allCustomers.length;
  const withMemories = allCustomers.filter(c => c.memories.length > 0).length;
  const resolvedTickets = allCustomers.reduce((s, c) => s + c.tickets.filter(t => t.status === "resolved").length, 0);
  const totalTickets = allCustomers.reduce((s, c) => s + c.tickets.length, 0);
  const highFrustration = allCustomers.filter(c => c.frustration_score > 60).length;
  const avgFrustration = total ? Math.round(allCustomers.reduce((s, c) => s + c.frustration_score, 0) / total) : 0;
  const totalMemories = allCustomers.reduce((s, c) => s + c.memories.length, 0);

  const el = document.getElementById("audit-results");
  const body = document.getElementById("audit-body");
  if (!el || !body) return;
  el.classList.remove("hidden");
  body.innerHTML = `
    <div class="grid grid-cols-2 gap-2">
      <div class="p-2 bg-input rounded"><strong>Customers</strong><br>${total}</div>
      <div class="p-2 bg-input rounded"><strong>With memories</strong><br>${withMemories} (${total ? Math.round(withMemories/total*100) : 0}%)</div>
      <div class="p-2 bg-input rounded"><strong>Total memories</strong><br>${totalMemories}</div>
      <div class="p-2 bg-input rounded"><strong>Total tickets</strong><br>${totalTickets}</div>
      <div class="p-2 bg-input rounded"><strong>Resolved</strong><br>${resolvedTickets}/${totalTickets} (${totalTickets ? Math.round(resolvedTickets/totalTickets*100) : 0}%)</div>
      <div class="p-2 bg-input rounded"><strong>High frustr.</strong><br>${highFrustration} customers</div>
      <div class="p-2 bg-input rounded"><strong>Avg frustration</strong><br>${avgFrustration}/100</div>
    </div>
  `;
}

function exportSnapshot() {
  const data = JSON.stringify(allCustomers, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cognix-memory-snapshot-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function clearFacts() {
  if (!confirm("This will remove low-confidence memories from the display. No backend changes will be made.")) return;
  allCustomers.forEach(c => {
    c.memories = c.memories.filter(m => m.memory_type === "experience");
  });
  renderTable(applyFilters(allCustomers));
  if (selectedCustomerId) selectCustomer(selectedCustomerId);
}

function selectCustomer(id) {
  selectedCustomerId = id;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;
  const detail = document.getElementById("customer-detail");
  if (!detail) return;
  detail.classList.remove("hidden");

  document.getElementById("detail-avatar").textContent = (c.name || "?")[0].toUpperCase();
  document.getElementById("detail-name").textContent = c.name;
  document.getElementById("detail-email").textContent = c.email;

  const fs = document.getElementById("detail-frustration");
  fs.textContent = `Frustration: ${c.frustration_score}`;
  fs.className = `text-xs font-semibold px-2 py-0.5 rounded-md ${c.frustration_score > 60 ? "bg-warning text-warning-foreground" : c.frustration_score > 30 ? "bg-muted text-foreground" : "bg-success text-success-foreground"}`;

  document.getElementById("detail-tickets").textContent = `${c.tickets.length} tickets`;
  document.getElementById("detail-memories").textContent = `${c.memories.length} memories`;
  document.getElementById("detail-last-seen").textContent = c.memories.length
    ? `Last active ${timeAgo(new Date(Math.max(...c.memories.map(m => new Date(m.created_at)))))}`
    : "No activity";

  renderMemoryBreakdown(c.memories);
  renderMemoryTimeline(c.memories);
}

function renderMemoryBreakdown(memories) {
  const el = document.getElementById("memory-breakdown");
  if (!el) return;
  const counts = {};
  memories.forEach(m => {
    const cat = window.categorizeMemory(m);
    counts[cat] = (counts[cat] || 0) + 1;
  });
  const total = memories.length || 1;
  const CAT_COLORS = { Issue: "#ef4444", Resolution: "#22c55e", Preference: "#5b5ef4", Sentiment: "#a855f7", Observation: "#f59e0b", Ticket: "#64748b" };
  el.innerHTML = Object.entries(counts).map(([cat, count]) => {
    const pct = Math.round(count / total * 100);
    return `
      <div class="flex items-center gap-2">
        <span style="width:8px;height:8px;border-radius:2px;background:${CAT_COLORS[cat] || "#94a3b8"};flex-shrink:0"></span>
        <span class="text-xs flex-1 text-foreground">${cat}</span>
        <span class="text-xs font-medium text-muted-foreground">${count} (${pct}%)</span>
      </div>
      <div style="height:4px;background:var(--color-muted);border-radius:2px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${CAT_COLORS[cat] || "#94a3b8"};border-radius:2px"></div>
      </div>
    `;
  }).join("");
}

function renderMemoryTimeline(memories) {
  const el = document.getElementById("memory-timeline");
  if (!el) return;
  if (!memories.length) {
    el.innerHTML = '<div class="text-xs text-muted-foreground">No memories stored.</div>';
    return;
  }
  const sorted = [...memories].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
  const CAT_COLORS = { Issue: "#ef4444", Resolution: "#22c55e", Preference: "#5b5ef4", Sentiment: "#a855f7", Observation: "#f59e0b", Ticket: "#64748b" };
  el.innerHTML = sorted.map(m => {
    const cat = window.categorizeMemory(m);
    const summary = window.formatMemory(m);
    const time = timeAgo(new Date(m.created_at));
    return `
      <div class="flex gap-2" style="border-left:2px solid ${CAT_COLORS[cat] || "#e2e5ea"};padding-left:8px">
        <div class="flex-1 min-w-0">
          <div class="text-xs text-foreground leading-relaxed">${escapeHtml(summary)}</div>
          <div class="text-xs text-muted-foreground mt-0.5 flex gap-2">
            <span style="color:${CAT_COLORS[cat] || "#94a3b8"};font-weight:600">${cat}</span>
            <span>${time}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderTable(customers) {
  const tbody = document.getElementById("memory-table-body");
  if (!tbody) return;
  if (!customers.length) {
    tbody.innerHTML = `<div style="padding:48px;text-align:center;color:var(--color-muted-foreground);font-size:14px">${activeFilter ? "No customers match this filter." : "No customers found."}</div>`;
    return;
  }
  tbody.innerHTML = customers.map(c => {
    const factCount = c.memories.length;
    const lastActive = c.memories.length
      ? timeAgo(new Date(Math.max(...c.memories.map(m => new Date(m.created_at)))))
      : "Never";
    const accPct = computeAccuracy(c.tickets);
    const isSelected = c.id === selectedCustomerId;
    return `
      <div>
        <input type="checkbox" id="expand-${c.id}" class="expand-toggle" />
        <div class="grid px-4 py-3.5 border-b border-border items-center ${factCount ? "bg-secondary" : ""} ${isSelected ? "shadow-sm" : ""}" style="grid-template-columns: 2fr 80px 100px 120px 100px 110px;cursor:pointer">
          <div class="flex items-center gap-3">
            <label for="expand-${c.id}" class="expand-label" style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer">
              <span class="expand-icon" style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 16px; height: 16px; color: var(--color-muted-foreground);">
                <svg xmlns="http://www.w3.org/2000/svg" width="16px" height="16px" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m6 9l6 6l6-6"></path></svg>
              </span>
              <div class="memory-avatar" data-customer-id="${escapeHtml(c.id)}" style="width:32px;height:32px;border-radius:50%;background:var(--color-primary);color:white;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;cursor:pointer;flex-shrink:0">
                ${escapeHtml((c.name || "?")[0].toUpperCase())}
              </div>
              <span class="text-sm font-medium text-foreground memory-name" data-customer-id="${escapeHtml(c.id)}" style="cursor:pointer">${escapeHtml(c.name)}</span>
            </label>
          </div>
          <span class="text-xs font-semibold px-2 py-0.5 rounded-md ${c.frustration_score > 60 ? "bg-warning text-warning-foreground" : c.frustration_score > 30 ? "bg-muted text-foreground" : "bg-success text-success-foreground"}">${c.frustration_score}</span>
          <span class="text-sm text-foreground font-medium">${factCount} <span class="text-muted-foreground font-normal">facts</span></span>
          <span class="text-sm text-muted-foreground">${lastActive}</span>
          <span class="${accPct >= 70 ? "text-success" : "text-warning"} flex items-center gap-1 text-xs">
            <span style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 13px; height: 13px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="13px" height="13px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.6923076923076925"><path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11l3 3L22 4"></path></g></svg>
            </span>
            ${accPct >= 70 ? "Verified" : "Needs review"}
          </span>
          <button class="start-session-btn" data-customer-id="${escapeHtml(c.id)}" style="font-size:12px;padding:4px 10px;border-radius:6px;background:var(--color-primary);color:var(--color-primary-foreground);border:none;cursor:pointer;white-space:nowrap">Start session</button>
        </div>

        <div class="expand-content ${factCount ? "bg-secondary border-b border-border" : ""}">
          <div class="px-6 py-4">
            ${factCount ? renderFacts(c.memories) : '<p class="text-xs text-muted-foreground">No memories stored for this customer.</p>'}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Wire profile navigation
  const navToProfile = (cid) => window.location.href = `./customer_profile.html?customer_id=${cid}`;
  tbody.querySelectorAll(".memory-avatar, .memory-name").forEach(el => {
    el.addEventListener("click", (e) => { e.stopPropagation(); navToProfile(el.dataset.customerId); });
  });

  // Wire Start Session buttons
  tbody.querySelectorAll(".start-session-btn").forEach(btn => {
    btn.addEventListener("click", (e) => { e.stopPropagation(); window.location.href = `./liveagent.html?customer_id=${btn.dataset.customerId}`; });
  });

  // Wire row click → select customer
  tbody.querySelectorAll(".grid").forEach(row => {
    const avatar = row.querySelector(".memory-avatar");
    if (!avatar) return;
    const cid = avatar.dataset.customerId;
    row.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("label") || e.target.closest("a")) return;
      selectCustomer(cid);
    });
  });

  // Wire memory card click to open modal
  tbody.querySelectorAll(".fact-card").forEach(card => {
    card.addEventListener("click", () => {
      const content = card.dataset.memoryContent;
      const category = card.dataset.memoryCategory;
      const type = card.dataset.memoryType;
      const ctx = card.dataset.memoryContext;
      const overlay = document.createElement("div");
      overlay.className = "memory-modal-overlay";
      overlay.innerHTML = `
        <div class="memory-modal">
          <div class="memory-modal-header">
            <div>
              <span class="memory-category-badge ${(category || "observation").toLowerCase()}">${category || "Observation"}</span>
              <span class="text-xs text-muted-foreground ml-2">${escapeHtml(type || "")}${ctx ? " / " + escapeHtml(ctx) : ""}</span>
            </div>
            <button class="memory-modal-close">&times;</button>
          </div>
          <div class="memory-modal-content">${escapeHtml(content || "")}</div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector(".memory-modal-close").addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    });
  });
}

function renderFacts(memories) {
  const CATEGORY_COLORS = {
    issue:      "background:#fee2e2;color:#991b1b",
    resolution: "background:#dcfce7;color:#166534",
    preference: "background:#eff6ff;color:#1d4ed8",
    sentiment:  "background:#faf5ff;color:#7e22ce",
    observation:"background:#fef9c3;color:#854d0e",
    ticket:     "background:#f1f5f9;color:#475569",
  };
  const items = memories.map(m => ({
    memory: m,
    summary: window.formatMemory(m),
    category: window.categorizeMemory(m),
    border: m.memory_type === "experience" ? "border-left:3px solid var(--color-warning);" : m.memory_type === "observation" ? "border-left:3px solid var(--color-success);" : "",
  }));
  return `
    <div class="facts-carousel">
      ${items.map(({ memory: m, summary, category, border }) => `
        <div class="fact-card" style="${border}" data-memory-content="${escapeHtml(m.content)}" data-memory-category="${category}" data-memory-type="${escapeHtml(m.memory_type)}" data-memory-context="${escapeHtml(m.context || "")}">
          <span class="fact-badge ${category.toLowerCase()}">${category}</span>
          <p class="fact-summary">${escapeHtml(summary)}</p>
        </div>
      `).join("")}
    </div>
  `;
}

function computeAccuracy(tickets) {
  if (!tickets.length) return 0;
  const resolved = tickets.filter(t => t.status === "resolved").length;
  return Math.round((resolved / tickets.length) * 100);
}

function showEmpty(msg) {
  const tbody = document.getElementById("memory-table-body");
  if (tbody) {
    tbody.innerHTML = `<div style="padding:48px;text-align:center;color:var(--color-muted-foreground);font-size:14px">${escapeHtml(msg)}</div>`;
  }
}

async function fetchJSON(path) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const token = session?.access_token || null;
  const url = `${API_BASE}${path}`;
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

function timeAgo(date) {
  const sec = Math.floor((Date.now() - date) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
