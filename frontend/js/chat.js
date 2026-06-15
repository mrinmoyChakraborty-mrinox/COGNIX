const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentCustomer = null;
let tickets = [];
let activeTicketId = null;

// Safe DOM helpers — no crash if element is missing
function $(id) { return document.getElementById(id); }
function show(id) { const e = $(id); if (e) e.classList.remove("hidden"); }
function hide(id) { const e = $(id); if (e) e.classList.add("hidden"); }
function attr(id, prop, val) { const e = $(id); if (e) e[prop] = val; }
function text(id, val) { attr(id, "textContent", val); }

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${d.getDate()}`;
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scrollToBottom() {
  const el = $("chatMessages");
  if (el) el.scrollTop = el.scrollHeight;
}

async function getToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

async function apiFetch(path, opts = {}) {
  const token = await getToken();
  const headers = { "Accept": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  return res;
}

async function showFailure(profileStatus, profileBody, setupStatus, setupBody) {
  const el = $("errorDetail");
  if (!el) return;
  const lines = [
    `GET /my/profile → ${profileStatus}`,
    `  body: ${profileBody}`,
    `POST /my/setup-profile → ${setupStatus}`,
    `  body: ${setupBody}`,
    `API_BASE: ${API_BASE}`,
  ];

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    lines.push(`session.active: ${!!session?.access_token}`);
    if (session?.access_token) {
      lines.push(`token.prefix: ${session.access_token.substring(0, 12)}...`);
    }
  } catch (_) {
    lines.push("session: error reading");
  }

  lines.push("");
  el.textContent = lines.join("\n");
}

async function loadProfile() {
  let res = await apiFetch("/my/profile");
  if (!res.ok) {
    let profileBody = "?";
    try { profileBody = JSON.stringify(await res.json()); } catch (_) { profileBody = await res.text().catch(() => "?"); }

    const setupRes = await apiFetch("/my/setup-profile", { method: "POST" });
    let setupBody = "?";
    try { setupBody = JSON.stringify(await setupRes.json()); } catch (_) { setupBody = await setupRes.text().catch(() => "?"); }

    console.error("loadProfile failed", {
      profileStatus: res.status,
      profileBody,
      setupStatus: setupRes.status,
      setupBody,
    });

    if (setupRes.ok) {
      res = await apiFetch("/my/profile");
    } else {
      showFailure(res.status, profileBody, setupRes.status, setupBody);
      hide("chatLayout");
      show("errorScreen");
      return null;
    }
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function loadTickets() {
  const res = await apiFetch("/my/tickets");
  if (!res.ok) return [];
  return res.json();
}

async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = "./login.html";
    return;
  }
  if (session.user.email === ADMIN_EMAIL) {
    window.location.href = "./dashboard.html";
    return;
  }

  try {
    currentCustomer = await loadProfile();
    if (!currentCustomer) return;

    tickets = await loadTickets() || [];

    if (tickets.length === 0) {
      const res = await apiFetch("/my/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: "General Support" }),
      });
      if (res.ok) {
        tickets = await loadTickets() || [];
      }
    }

    renderPortalHeader(currentCustomer);
    renderTickets(tickets);

    const openTicket = tickets.find(t => t.status === "open");
    if (openTicket) {
      selectTicket(openTicket);
    } else if (tickets.length > 0) {
      selectTicket(tickets[0]);
    }

    show("chatLayout");

  } catch (err) {
    console.error("Init failed:", err);
    const detail = $("errorDetail");
    if (detail) {
      detail.textContent = [
        `Error: ${err.message || err}`,
        ``,
        `Check browser console (F12) for the full stack trace.`,
        `API_BASE: ${API_BASE}`,
      ].join("\n");
    }
    hide("chatLayout");
    show("errorScreen");
  }
}

function renderPortalHeader(customer) {
  const name = customer.name || customer.email?.split("@")[0] || "Customer";
  text("greetingName", name);
  attr("avatarImg", "src", `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5b5ef4&color=fff`);
}

function getCustomerName() {
  return currentCustomer?.name || currentCustomer?.email?.split("@")[0] || "You";
}

function getUserAvatarHtml() {
  const name = getCustomerName();
  return `<img src="https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5b5ef4&color=fff" class="user-avatar-sm" alt="${escapeHtml(name)}" />`;
}

function renderTickets(list) {
  const container = $("ticketDropdownList");
  if (!container) return;
  const empty = $("ticketDropdownEmpty");
  container.innerHTML = "";

  if (!list || list.length === 0) {
    if (empty) empty.classList.remove("hidden");
    return;
  }

  if (empty) empty.classList.add("hidden");

  for (const t of list) {
    const row = document.createElement("div");
    row.className = "ticket-dropdown-row";
    row.dataset.ticketId = t.id;
    if (t.id === activeTicketId) row.classList.add("active");

    const statusClass = t.status === "resolved" ? "resolved" : "open";
    row.innerHTML = `
      <span class="ticket-dd-subject">${escapeHtml(t.subject)}</span>
      <span class="ticket-dd-status ${statusClass}">${t.status}</span>
      <span class="ticket-dd-date">${formatDate(t.created_at)}</span>
    `;

    row.addEventListener("click", () => {
      selectTicket(t);
      hide("ticketDropdown");
    });

    container.appendChild(row);
  }
}

function selectTicket(ticket) {
  activeTicketId = ticket.id;

  text("ticketBarSubject", ticket.subject);

  const statusEl = $("ticketBarStatus");
  if (statusEl) {
    statusEl.textContent = ticket.status;
    statusEl.style.background = ticket.status === "resolved" ? "#dcfce7" : "#fef3c7";
    statusEl.style.color = ticket.status === "resolved" ? "#166534" : "#92400e";
  }

  const container = $("chatMessages");
  if (!container) return;

  // Save references to elements that would be destroyed by innerHTML = ""
  const savedTypingRow = $("typingRow");

  container.innerHTML = "";
  const welcome = $("welcomeBanner");
  if (welcome) {
    welcome.classList.remove("hidden");
    welcome.innerHTML = `<h2>${escapeHtml(ticket.subject)}</h2><p>${ticket.status === "resolved" ? "This ticket has been resolved." : "Open ticket — type a message below."}</p>`;
    container.appendChild(welcome);
  }

  // Re-insert typingRow — still a live reference even after innerHTML = ""
  if (savedTypingRow) container.appendChild(savedTypingRow);

  hide("ticketDropdown");

  document.querySelectorAll(".ticket-dropdown-row").forEach(el => {
    el.classList.toggle("active", el.dataset.ticketId === ticket.id);
  });

  updateSessionSummary(ticket);
}

function updateSessionSummary(ticket) {
  const summary = $("sessionSummary");
  const summaryText = $("summaryText");
  const badge = $("sessionStatusBadge");
  const num = $("ticketNum");

  if (!ticket) {
    if (summary) summary.classList.add("hidden");
    return;
  }

  if (summary) summary.classList.remove("hidden");
  if (summaryText) summaryText.textContent = ticket.subject;
  if (badge) badge.textContent = ticket.status;
  if (num) num.textContent = `#${ticket.id?.toString().slice(-4) || "---"}`;
}

function openModal() {
  show("ticketModal");
  attr("ticketSubject", "value", "");
  hide("ticketSubjectError");
  const input = $("ticketSubject");
  if (input) input.focus();
}

function closeModal() {
  hide("ticketModal");
}

async function handleTicketSubmit() {
  const input = $("ticketSubject");
  if (!input) return;
  const subject = input.value.trim();
  if (!subject) {
    text("ticketSubjectError", "Please enter a subject");
    show("ticketSubjectError");
    return;
  }
  hide("ticketSubjectError");

  const submitBtn = $("modalSubmitBtn");
  if (!submitBtn) return;
  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const res = await apiFetch("/my/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const ticket = await res.json();
    tickets.unshift(ticket);
    renderTickets(tickets);
    selectTicket(ticket);
    closeModal();
    showToast("Ticket created");
  } catch (err) {
    text("ticketSubjectError", "Failed to create ticket");
    show("ticketSubjectError");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Ticket";
  }
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function appendMessage(role, text) {
  const welcome = $("welcomeBanner");
  if (welcome) welcome.classList.add("hidden");

  const isAI = role !== "user";
  const t = now();
  const row = document.createElement("div");
  row.className = `bubble-row ${isAI ? "row-ai" : "row-user"} msg-new`;

  if (isAI) {
    row.innerHTML = `
      <div class="bot-avatar">
        <svg viewBox="0 0 20 20" fill="none">
          <path d="M10 2.5C10 2.5 5 5.5 5 10.5C5 13.26 7.24 15.5 10 15.5C12.76 15.5 15 13.26 15 10.5C15 5.5 10 2.5Z" fill="white" fill-opacity="0.9"/>
          <circle cx="10" cy="10.5" r="2.5" fill="white" fill-opacity="0.5"/>
        </svg>
      </div>
      <div class="bubble-group">
        <span class="bubble-meta">COGNIX AI · ${t}</span>
        <div class="bubble bubble-ai">${escapeHtml(text)}</div>
      </div>`;
  } else {
    const name = getCustomerName();
    row.innerHTML = `
      <div class="bubble-group group-right">
        <span class="bubble-meta meta-right">${escapeHtml(name)} · ${t}</span>
        <div class="bubble bubble-user">${escapeHtml(text)}</div>
      </div>
      ${getUserAvatarHtml()}`;
  }

  const typingRow = $("typingRow");
  const container = $("chatMessages");
  if (!container) return;
  if (typingRow) {
    container.insertBefore(row, typingRow);
  } else {
    container.appendChild(row);
  }
  scrollToBottom();
}

function showTypingIndicator(show) {
  const typingRow = $("typingRow");
  if (!typingRow) return;
  typingRow.style.display = show ? "flex" : "none";
  if (show) scrollToBottom();
}

function showError(msg) {
  const banner = $("errorBanner");
  if (banner) {
    banner.textContent = msg;
    banner.classList.remove("hidden");
  }
}

function hideError() {
  const banner = $("errorBanner");
  if (banner) banner.classList.add("hidden");
}

let _agentConnected = false;
let _pendingPollTimer = null;

let _seenReplyIds = new Set();

function startPendingPoll() {
  if (_pendingPollTimer) clearInterval(_pendingPollTimer);
  _pendingPollTimer = setInterval(async () => {
    try {
      const res = await apiFetch("/my/pending-replies");
      if (res.ok) {
        const data = await res.json();
        for (const reply of data.replies || []) {
          const rid = reply.reply_id || "no_id";
          console.log(`[DIAG] render source=poll reply_id=${rid} text=%.200s`, reply.text);
          appendMessage("assistant", reply.text);
        }
        _agentConnected = !data.agent_disconnected;
      }
    } catch (_) {}
  }, 3000);
}

async function sendMessage() {
  const input = $("msgInput");
  const text = input?.value.trim();
  if (!text) return;

  hideError();
  appendMessage("user", text);
  if (input) {
    input.value = "";
    input.focus();
  }
  showTypingIndicator(true);

  try {
    const res = await apiFetch("/my/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, ticket_id: activeTicketId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${res.status}`);
    }

    const data = await res.json();
    showTypingIndicator(false);

    if (data.reply) {
      const rid = data.reply_id || "no_id";
      console.log(`[DIAG] render source=chat_response reply_id=${rid} text=%.200s`, data.reply);
      appendMessage("assistant", data.reply);
    }

    if (data.agent_connected) {
      _agentConnected = true;
      startPendingPoll();
    }
  } catch (err) {
    showTypingIndicator(false);
    showError(err.message || "Could not reach support. Please try again.");
  }
}

// ── Wire events ────────────────────────────────────────────

$("sendBtn")?.addEventListener("click", sendMessage);
$("msgInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$("newTicketBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  openModal();
});

$("ticketSelector")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const dd = $("ticketDropdown");
  if (dd) dd.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  const dd = $("ticketDropdown");
  const bar = $("ticketBar");
  if (dd && !dd.classList.contains("hidden") && bar && !bar.contains(e.target)) {
    dd.classList.add("hidden");
  }
});

$("modalCancelBtn")?.addEventListener("click", closeModal);
$("modalSubmitBtn")?.addEventListener("click", handleTicketSubmit);
$("ticketModal")?.addEventListener("click", (e) => {
  if (e.target === $("ticketModal")) closeModal();
});
$("ticketSubject")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleTicketSubmit();
  }
});

$("logoutBtn")?.addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  window.location.href = "./login.html";
});

$("closeBanner")?.addEventListener("click", () => {
  const banner = $("memoryBanner");
  if (banner) {
    banner.style.animation = "none";
    banner.style.opacity = "0";
    banner.style.transform = "translateY(-4px)";
    banner.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    setTimeout(() => { banner.style.display = "none"; }, 220);
  }
});

document.querySelectorAll(".qr-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    const input = $("msgInput");
    if (input) {
      input.value = chip.dataset.text;
      input.focus();
    }
  });
});

$("aiSuggestBtn")?.addEventListener("click", () => {
  const btn = $("aiSuggestBtn");
  btn?.classList.add("loading");

  const suggestions = [
    "I'm still experiencing the same issue. Can you help?",
    "Can you check the status of my ticket?",
    "I need help with a new problem related to the API.",
    "Following up on this issue — any update?"
  ];
  const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];

  setTimeout(() => {
    const input = $("msgInput");
    if (input) {
      input.value = suggestion;
      input.focus();
      input.setSelectionRange(suggestion.length, suggestion.length);
    }
    btn?.classList.remove("loading");
  }, 480);
});

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const typingRow = $("typingRow");
  if (typingRow) typingRow.style.display = "none";
  init();
});
