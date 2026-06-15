const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE } = window.CONFIG;
const QUEUE_LIMIT = 8;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Helpers ──────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function show(el) { if (el) el.classList.remove("hidden"); }

function hide(el) { if (el) el.classList.add("hidden"); }

function frustrationColor(score) {
  if (score >= 75) return "#ef4444";
  if (score >= 45) return "#f59e0b";
  return "#22c55e";
}

function frustrationDash(score) {
  const r = 22, c = 2 * Math.PI * r;
  const pct = Math.min(score, 100) / 100;
  return `${(c * pct).toFixed(2)} ${(c * (1 - pct)).toFixed(2)}`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `waiting ${min} min`;
  const hr = Math.floor(min / 60);
  return `waiting ${hr}h ${min % 60}m`;
}

// ── API call with auth token ─────────────────────────────────

async function getSessionToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

async function apiFetch(path) {
  const token = await getSessionToken();
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401) {
    await supabaseClient.auth.signOut();
    window.location.href = "./login.html";
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Render queue ────────────────────────────────────────────

function renderQueue(customers, ticketsByCust) {
  const list = $("ticketList");
  list.innerHTML = "";

  if (customers.length === 0) {
    show($("queueEmpty"));
    hide($("queueError"));
    return;
  }

  let totalOpen = 0;
  for (const c of customers) {
    const ts = ticketsByCust[c.id] || [];
    totalOpen += ts.filter((t) => t.status === "open").length;
  }

  $("queueSubtitle").textContent =
    `${customers.length} customers waiting \u00B7 ${totalOpen} open tickets \u00B7 Sorted by frustration`;

  for (const c of customers) {
    const ts = ticketsByCust[c.id] || [];
    const open = ts.filter((t) => t.status === "open");
    const latest = open.length > 0 ? open[0] : ts[0];
    const latestId = latest?.id;
    const color = frustrationColor(c.frustration_score);
    const isHigh = c.frustration_score >= 75;
    const initials = c.name.split(" ").map((s) => s[0]).join("").toUpperCase().slice(0, 2);

    const card = document.createElement("div");
    card.className = `ticket-card${isHigh ? " priority" : ""}`;

    card.innerHTML = `
      <div class="ticket-avatar-initials" style="background-color:${color}20;color:${color};font-weight:600;font-size:16px">${initials}</div>
      <div class="ticket-body">
        <div class="ticket-header">
          <span class="ticket-name">${esc(c.name)}</span>
          <span class="ticket-wait">${timeAgo(c.created_at)}</span>
        </div>
        <p class="ticket-desc">${latest ? esc(latest.subject) : "No recent tickets"}</p>
        <div class="ticket-tags">
          <span class="ticket-tag">${c.ticket_count} prior ticket${c.ticket_count !== 1 ? "s" : ""}</span>
          <span class="ticket-tag">${open.length} open</span>
          <span class="ticket-tag">${esc(c.email)}</span>
        </div>
      </div>
      <div class="ticket-actions">
        <div class="frustration-ring">
          <svg width="52" height="52">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#e2e5ea" stroke-width="4"></circle>
            <circle cx="26" cy="26" r="22" fill="none" stroke="${color}" stroke-width="4" stroke-dasharray="${frustrationDash(c.frustration_score)}" stroke-linecap="round"></circle>
          </svg>
          <span class="frustration-score" style="color:${color}">${c.frustration_score}</span>
        </div>
        <div class="ticket-action-btns">
          ${latestId && open.length > 0 ? `<button class="resolve-btn" data-ticket-id="${esc(latestId)}">Resolve</button>` : ""}
          <button class="start-session-btn" data-customer-id="${esc(c.id)}">Start session</button>
        </div>
      </div>
    `;

    list.appendChild(card);
  }

  // Wire session buttons
  list.querySelectorAll(".start-session-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cid = btn.dataset.customerId;
      window.location.href = `./liveagent.html?customer_id=${cid}`;
    });
  });

  // Wire resolve buttons
  list.querySelectorAll(".resolve-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ticketId = btn.dataset.ticketId;
      btn.disabled = true;
      btn.textContent = "...";
      try {
        const token = await getSessionToken();
        const headers = { "Accept": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        await fetch(`${API_BASE}/tickets/${ticketId}/resolve`, {
          method: "PATCH",
          headers,
        });
        btn.textContent = "Done ✓";
        btn.style.background = "#22c55e";
        btn.style.color = "#fff";
      } catch {
        btn.disabled = false;
        btn.textContent = "Resolve";
      }
    });
  });
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Render trending ─────────────────────────────────────────

function renderTrending(categories) {
  const list = $("trendingList");
  if (!categories || categories.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>No trending issues.</p></div>`;
    return;
  }

  const maxVal = categories[0].count;
  list.innerHTML = "";
  for (const cat of categories) {
    const pct = maxVal > 0 ? (cat.count / maxVal) * 100 : 0;
    const row = document.createElement("div");
    row.className = "trending-row";
    row.innerHTML = `
      <span class="trending-label">${esc(cat.label)}</span>
      <div class="trending-bar-bg"><div class="trending-bar-fill" style="width:${pct}%"></div></div>
      <span class="trending-value">${cat.count}</span>
    `;
    list.appendChild(row);
  }
}

// ── Load queue ──────────────────────────────────────────────

async function loadQueue() {
  const list = $("ticketList");
  const err = $("queueError");
  const empty = $("queueEmpty");

  hide(err);
  hide(empty);
  show(list);
  list.querySelectorAll(".skeleton-card").forEach((s) => show(s));

  try {
    const customers = await apiFetch("/customers");
    if (!customers) return;

    const sorted = customers
      .sort((a, b) => b.frustration_score - a.frustration_score)
      .slice(0, QUEUE_LIMIT);

    const ticketsByCust = {};
    await Promise.all(
      sorted.map(async (c) => {
        try {
          ticketsByCust[c.id] = await apiFetch(`/customers/${c.id}/tickets`) || [];
        } catch {
          ticketsByCust[c.id] = [];
        }
      })
    );

    // Hide skeletons, render
    list.querySelectorAll(".skeleton-card").forEach((s) => s.remove());
    renderQueue(sorted, ticketsByCust);

  } catch (e) {
    list.querySelectorAll(".skeleton-card").forEach((s) => s.remove());
    list.innerHTML = "";
    $("queueSubtitle").textContent = "Failed to load";
    show(err);
  }
}

// ── Load trending ───────────────────────────────────────────

const CATEGORY_KEYWORDS = {
  "API timeouts": ["timeout", "api", "rate limit", "429", "latency"],
  "Auth errors": ["auth", "sso", "login", "token", "oauth", "saml", "session"],
  "Billing sync": ["billing", "invoice", "charge", "payment", "refund", "duplicate"],
  "Webhook fail": ["webhook", "callback", "notification"],
  "Data export": ["export", "report", "csv"],
};

async function loadTrending() {
  const list = $("trendingList");
  const err = $("trendingError");

  try {
    const customers = await apiFetch("/customers");
    if (!customers) return;

    const allTickets = await Promise.all(
      customers.slice(0, 20).map((c) =>
        apiFetch(`/customers/${c.id}/tickets`).catch(() => [])
      )
    );

    const flat = allTickets.flat();
    const counts = {};
    for (const key of Object.keys(CATEGORY_KEYWORDS)) counts[key] = 0;
    let other = 0;

    for (const t of flat) {
      const subject = (t.subject || "").toLowerCase();
      let matched = false;
      for (const [key, words] of Object.entries(CATEGORY_KEYWORDS)) {
        if (words.some((w) => subject.includes(w))) {
          counts[key]++;
          matched = true;
          break;
        }
      }
      if (!matched) other++;
    }

    const sorted = Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);

    if (other > 0) sorted.push({ label: "Other", count: other });

    renderTrending(sorted);
  } catch {
    show(err);
  }
}

// ── Auth / User ─────────────────────────────────────────────

async function loadUser() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "./login.html";
    return;
  }

  if (session.user.email !== ADMIN_EMAIL) {
    window.location.href = "./chat.html";
    return;
  }

  const user = session.user;
  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.email.split("@")[0];

  const avatar =
    user.user_metadata?.avatar_url ||
    user.user_metadata?.picture ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}`;

  $("welcomeText").innerText = `Good morning, ${fullName}`;
  const img = document.createElement("img");
  img.src = avatar;
  img.className = "avatar";
  img.alt = fullName;
  $("avatarWrapper").appendChild(img);
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = "./login.html";
}

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  $("logoutBtn")?.addEventListener("click", logout);

  $("queueRetryBtn")?.addEventListener("click", () => {
    loadQueue();
    loadTrending();
  });

  await loadUser();
  await Promise.all([loadQueue(), loadTrending()]);
});
