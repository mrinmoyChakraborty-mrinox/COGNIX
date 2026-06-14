const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE, WS_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const CUSTOMER_ID = params.get("customer_id");

let socket = null;

const chatMessages = document.querySelector(".chat-messages");
const replyInput   = document.querySelector(".reply-input");
const aiSuggestBtn = document.getElementById("aiSuggestBtn");
const memoryPanel  = document.getElementById("memoryPanel");
const escalationBanner = document.getElementById("escalationBanner");

async function getToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}

async function loadAgent() {
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
  const fullName = user.user_metadata?.full_name || user.email.split("@")[0];
  const avatar = user.user_metadata?.avatar_url ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}`;
  const avatarEl = document.getElementById("agentAvatar");
  if (avatarEl) avatarEl.src = avatar;
}

async function fetchCustomer() {
  const token = await getToken();
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}`, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function connectWebSocket() {
  if (!CUSTOMER_ID) {
    appendMessage("system", "No customer selected. Go back to the dashboard.");
    return;
  }

  const token = await getToken();
  const wsUrl = `${WS_BASE}/ws/session/${CUSTOMER_ID}${token ? `?token=${token}` : ""}`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.info("WS connected | customer_id=", CUSTOMER_ID);
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    handleWsEvent(msg);
  };

  socket.onerror = () => {
    console.error("WS error");
    appendMessage("system", "Connection error. Retrying...");
    setTimeout(connectWebSocket, 3000);
  };

  socket.onclose = (e) => {
    if (e.code !== 4004) {
      setTimeout(connectWebSocket, 3000);
    }
  };
}

function handleWsEvent(msg) {
  switch (msg.event) {

    case "opening":
      appendMessage("assistant", msg.data);
      break;

    case "status":
      showTypingIndicator(true);
      showMemoryScanning(msg.query || "");
      break;

    case "memory.update":
      showTypingIndicator(false);
      renderMemoryViz(msg);
      break;

    case "chat.reply":
      appendMessage("assistant", msg.data);
      if (msg.suggested_solution) {
        aiSuggestBtn._suggestion = msg.suggested_solution;
      }
      if (msg.escalation_flag) {
        showEscalationBanner(msg.escalation_reason);
      }
      break;
  }
}

function sendMessage() {
  const text = replyInput.value.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;

  appendMessage("user", text);
  socket.send(text);
  replyInput.value = "";
  replyInput.focus();
}

function appendMessage(role, text) {
  showTypingIndicator(false);
  const div = document.createElement("div");
  div.className = `msg ${role === "user" ? "msg-right" : role === "system" ? "msg-left" : "msg-left"}`;
  div.innerHTML = `
    <div class="msg-body">
      <div class="bubble ${role === "user" ? "bubble-outgoing" : "bubble-incoming"}">
        ${escapeHtml(text)}
      </div>
      <span class="msg-time">${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</span>
    </div>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

let _typingEl = null;
function showTypingIndicator(show) {
  if (show && !_typingEl) {
    _typingEl = document.createElement("div");
    _typingEl.className = "msg msg-right typing-indicator";
    _typingEl.innerHTML = `
      <div class="msg-body">
        <div class="bubble bubble-incoming">
          <span></span><span></span><span></span>
        </div>
      </div>`;
    chatMessages.appendChild(_typingEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  } else if (!show && _typingEl) {
    _typingEl.remove();
    _typingEl = null;
  }
}

function showMemoryScanning(query) {
  if (!memoryPanel) return;
  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <span>Memory Retrieval</span>
    </div>
    <div class="scanning-text" style="padding:12px;text-align:center;color:var(--color-muted-foreground);font-size:13px;">Searching memory bank...</div>
    ${query ? `<div style="padding:0 12px 12px;font-size:12px;color:var(--color-muted-foreground)">Query: <code style="background:var(--color-input);padding:1px 6px;border-radius:4px">${escapeHtml(query)}</code></div>` : ""}
  `;
}

function renderMemoryViz(msg) {
  if (!memoryPanel) return;
  const hits = msg.hits || [];
  const TYPE_LABELS = { world_fact: "Fact", experience: "Experience", observation: "Observation" };

  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <span>Memory Retrieval</span>
      <span style="margin-left:auto;font-size:11px;color:var(--color-muted-foreground)">${msg.retrieval_time_ms || 0}ms</span>
    </div>
    <div style="padding:0 12px 8px;font-size:12px;color:var(--color-muted-foreground)">Query: <code style="background:var(--color-input);padding:1px 6px;border-radius:4px">${escapeHtml(msg.query || "")}</code></div>
    <div class="memory-hits" id="memoryHits" style="padding:0 12px 12px"></div>
    <div style="padding:8px 12px;border-top:1px solid var(--color-border);font-size:11px;color:var(--color-muted-foreground);text-align:center">${hits.length} memories retrieved</div>
  `;

  const container = document.getElementById("memoryHits");
  hits.forEach((hit, i) => {
    const el = document.createElement("div");
    el.className = "memory-hit";
    el.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:6px 0;opacity:0;transition:opacity 0.3s";
    el.innerHTML = `
      <span style="color:var(--color-success);font-size:12px;flex-shrink:0">✓</span>
      <div>
        <p style="font-size:12px;color:var(--color-foreground);margin:0">${escapeHtml(hit.content)}</p>
        <span style="font-size:10px;color:var(--color-muted-foreground)">${TYPE_LABELS[hit.memory_type] || "Memory"}</span>
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => el.style.opacity = "1", 200 + i * 150);
  });
}

function showEscalationBanner(reason) {
  if (!escalationBanner) return;
  escalationBanner.innerHTML = `
    <div style="background:var(--color-warning);color:var(--color-warning-foreground);padding:8px 12px;border-radius:6px;font-size:13px;font-weight:500">
      ⚠ Escalation recommended${reason ? `: ${reason}` : ""}
    </div>
  `;
  escalationBanner.classList.remove("hidden");
}

function wireAiSuggest() {
  if (!aiSuggestBtn || !replyInput) return;
  aiSuggestBtn.addEventListener("click", () => {
    const suggestion = aiSuggestBtn._suggestion;
    if (!suggestion) return;
    aiSuggestBtn.classList.add("is-loading");
    aiSuggestBtn.disabled = true;
    setTimeout(() => {
      replyInput.value = suggestion;
      replyInput.focus();
      aiSuggestBtn.classList.remove("is-loading");
      aiSuggestBtn.disabled = false;
    }, 400);
  });
}

function wireSend() {
  replyInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

async function initProfile() {
  const titleEl = document.getElementById("sessionTitle");
  const nameEl  = document.getElementById("customerName");
  const emailEl = document.getElementById("customerEmail");
  const avatarEl = document.getElementById("customerAvatar");
  const scoreEl  = document.getElementById("profileFrustrationScore");
  const circleEl = document.getElementById("frustrationCircle");

  if (!CUSTOMER_ID) {
    if (nameEl) nameEl.textContent = "No customer selected";
    return;
  }

  const customer = await fetchCustomer();
  if (!customer) return;

  if (titleEl) titleEl.textContent = `Session with ${customer.name}`;
  if (nameEl) nameEl.textContent = customer.name;
  if (emailEl) emailEl.textContent = customer.email;
  if (avatarEl && !avatarEl.src.includes("ui-avatars")) {
    avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(customer.name)}`;
  }

  const score = customer.frustration_score || 0;
  if (scoreEl) scoreEl.textContent = score;
  if (circleEl) {
    const r = 23, c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    circleEl.setAttribute("stroke-dasharray", `${c - offset} ${offset}`);
    circleEl.setAttribute("stroke", score >= 75 ? "#ef4444" : score >= 45 ? "#f59e0b" : "#22c55e");
  }
}

async function fetchCustomerTickets() {
  const token = await getToken();
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}/customers/${CUSTOMER_ID}/tickets`, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function wireResolveButton() {
  const btn = document.getElementById("resolveTicketBtn");
  if (!btn || !CUSTOMER_ID) return;

  const tickets = await fetchCustomerTickets();
  const openTicket = tickets.find(t => t.status === "open");
  if (!openTicket) return;
  btn.style.display = "";

  btn.addEventListener("click", async () => {
    const token = await getToken();
    const headers = { "Accept": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    try {
      const res = await fetch(`${API_BASE}/tickets/${openTicket.id}/resolve`, {
        method: "PATCH",
        headers,
      });
      if (res.ok) {
        btn.style.display = "none";
        appendMessage("assistant", "✅ Ticket marked as resolved.");
      }
    } catch (e) {
      console.warn("resolve ticket failed", e);
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAgent();
  await initProfile();
  wireSend();
  wireAiSuggest();
  connectWebSocket();
  wireResolveButton();
});
