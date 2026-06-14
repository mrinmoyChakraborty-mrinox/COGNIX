const ADMIN_EMAIL = "your-admin@email.com";
const SUPABASE_URL = "https://ckjypqgnkovsdezsjjqo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNranlwcWdua292c2RlenNqanFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDI2MjQsImV4cCI6MjA5NjkxODYyNH0.mCDrIQ5ftcqzSG6oACy-UCdfPR2-virzU_udRuRDXwM";

const API_BASE = "http://localhost:8000";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentCustomer = null;
let tickets = [];
let activeTicketId = null;
let _typingEl = null;

function $(id) { return document.getElementById(id); }

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

async function loadProfile() {
  const res = await apiFetch("/my/profile");
  if (res.status === 404) {
    $("chatLayout").classList.add("hidden");
    $("errorScreen").classList.remove("hidden");
    return null;
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
    window.location.href = "/frontend/login.html";
    return;
  }
  if (session.user.email === ADMIN_EMAIL) {
    window.location.href = "/frontend/dashboard.html";
    return;
  }

  try {
    currentCustomer = await loadProfile();
    if (!currentCustomer) return;

    tickets = await loadTickets() || [];

    renderSidebar(currentCustomer);
    renderTickets(tickets);

    const openTicket = tickets.find(t => t.status === "open");
    if (openTicket) {
      selectTicket(openTicket);
    } else if (tickets.length > 0) {
      selectTicket(tickets[0]);
    }

    $("chatLayout").classList.remove("hidden");

  } catch (err) {
    console.error("Init failed:", err);
    $("chatLayout").classList.add("hidden");
    $("errorScreen").classList.remove("hidden");
  }
}

function renderSidebar(customer) {
  const name = customer.name || customer.email?.split("@")[0] || "Customer";
  $("greetingName").textContent = name;
  $("planBadge").textContent = customer.plan || "Free";
  $("avatarImg").src = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=5b5ef4&color=fff`;
}

function renderTickets(list) {
  const container = $("ticketList");
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerHTML = '<div class="ticket-empty">No tickets yet. Create one to get started.</div>';
    return;
  }

  for (const t of list) {
    const row = document.createElement("div");
    row.className = "ticket-row";
    row.dataset.ticketId = t.id;
    if (t.id === activeTicketId) row.classList.add("active");

    const statusClass = t.status === "resolved" ? "resolved" : "open";
    row.innerHTML = `
      <span class="ticket-row-subject">${escapeHtml(t.subject)}</span>
      <div class="ticket-row-meta">
        <span class="status-pill ${statusClass}">${t.status}</span>
        <span class="ticket-row-date">${formatDate(t.created_at)}</span>
      </div>
    `;

    row.addEventListener("click", () => selectTicket(t));
    container.appendChild(row);
  }
}

function selectTicket(ticket) {
  activeTicketId = ticket.id;
  $("chatHeaderSubject").textContent = ticket.subject;
  $("chatHeaderMeta").textContent = ticket.status === "resolved"
    ? "This ticket has been resolved."
    : "Open ticket — type a message below.";
  $("chatMessages").innerHTML = "";
  $("welcomeBanner").classList.remove("hidden");

  document.querySelectorAll(".ticket-row").forEach(el => {
    el.classList.toggle("active", el.dataset.ticketId === ticket.id);
  });
}

function openModal() {
  $("ticketModal").classList.remove("hidden");
  $("ticketSubject").value = "";
  $("ticketSubjectError").classList.add("hidden");
  $("ticketSubject").focus();
}

function closeModal() {
  $("ticketModal").classList.add("hidden");
}

async function handleTicketSubmit() {
  const subject = $("ticketSubject").value.trim();
  if (!subject) {
    $("ticketSubjectError").classList.remove("hidden");
    return;
  }
  $("ticketSubjectError").classList.add("hidden");

  const submitBtn = $("modalSubmitBtn");
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
    $("ticketSubjectError").textContent = "Failed to create ticket";
    $("ticketSubjectError").classList.remove("hidden");
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
  $("welcomeBanner")?.classList.add("hidden");
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "msg-right" : "msg-left"}`;
  div.innerHTML = `
    <div class="msg-body">
      <div class="bubble ${role === "user" ? "bubble-outgoing" : "bubble-incoming"}">
        ${escapeHtml(text)}
      </div>
      <span class="msg-time">${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
    </div>
  `;
  $("chatMessages").appendChild(div);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}

function showTypingIndicator(show) {
  if (show && !_typingEl) {
    _typingEl = document.createElement("div");
    _typingEl.className = "msg msg-left typing-indicator";
    _typingEl.innerHTML = `
      <div class="msg-body">
        <div class="bubble bubble-incoming">
          <span></span><span></span><span></span>
        </div>
      </div>`;
    $("chatMessages").appendChild(_typingEl);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
  } else if (!show && _typingEl) {
    _typingEl.remove();
    _typingEl = null;
  }
}

function showError(msg) {
  const banner = $("errorBanner");
  banner.textContent = msg;
  banner.classList.remove("hidden");
}

function hideError() {
  $("errorBanner").classList.add("hidden");
}

async function sendMessage() {
  const text = $("replyInput").textContent.trim();
  if (!text) return;

  hideError();
  appendMessage("user", text);
  $("replyInput").textContent = "";
  $("replyInput").focus();
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
    appendMessage("assistant", data.reply);
  } catch (err) {
    showTypingIndicator(false);
    showError(err.message || "Could not reach support. Please try again.");
  }
}

// ── Wire events ────────────────────────────────────────────

$("sendBtn")?.addEventListener("click", sendMessage);
$("replyInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
$("newTicketBtn")?.addEventListener("click", openModal);
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
  window.location.href = "/frontend/login.html";
});

// ── Init ───────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
