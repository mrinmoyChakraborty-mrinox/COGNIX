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
  const text = replyInput.textContent.trim();
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;

  appendMessage("user", text);
  socket.send(text);
  replyInput.textContent = "";
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
  clearInterval(memoryPanel._scanInterval);

  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4"
        stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
        <path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4
          m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/>
        <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/>
        <path d="M18 18a4 4 0 0 0 2-7.464"/>
        <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/>
        <path d="M6 18a4 4 0 0 1-2-7.464"/>
        <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/>
      </svg>
      <span>Memory Retrieval</span>
    </div>

    <div class="memory-scanning-card">
      <div class="scanning-dots">
        <div class="scanning-dot"></div>
        <div class="scanning-dot"></div>
        <div class="scanning-dot"></div>
      </div>
      <span class="scanning-label">Searching memory bank...</span>
      ${query
        ? `<div class="memory-query-pill" style="margin-top:8px">
             Query: <code>"${escapeHtml(query)}"</code>
           </div>`
        : ""}
    </div>
  `;
}

function renderMemoryViz(msg) {
  if (!memoryPanel) return;
  if (memoryPanel._scanInterval) {
    clearInterval(memoryPanel._scanInterval);
    delete memoryPanel._scanInterval;
  }

  const hits = msg.hits || [];
  const TYPE_LABELS = { world_fact: "Fact", experience: "Experience", observation: "Observation" };
  const TYPE_CLASSES = { world_fact: "world_fact", experience: "experience", observation: "observation" };
  const query = escapeHtml(msg.query || "");
  const ms = msg.retrieval_time_ms || 0;

  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <span>Memory Retrieval</span>
      <span class="memory-ms">${ms}ms</span>
    </div>
    <div class="memory-query-pill">Query: <code>"${query}"</code></div>
    <div class="memory-hits" id="memoryHits"></div>
    <div class="memory-footer">${hits.length} memories retrieved · ${ms}ms</div>
  `;

  const container = document.getElementById("memoryHits");
  hits.forEach((hit, i) => {
    const el = document.createElement("div");
    el.className = "memory-hit";
    el.innerHTML = `
      <div class="memory-hit-check">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div>
        <p class="memory-hit-content">${escapeHtml(hit.content)}</p>
        <span class="memory-type-badge ${TYPE_CLASSES[hit.memory_type] || ""}">${TYPE_LABELS[hit.memory_type] || "Memory"}</span>
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => el.classList.add("visible"), 200 + i * 150);
  });
}

function renderMemoryIdle() {
  if (!memoryPanel) return;
  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <span>Memory Retrieval</span>
    </div>
    <div class="memory-idle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <p>Waiting for customer message...</p>
    </div>
  `;
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
      replyInput.textContent = suggestion;
      replyInput.focus();
      const range = document.createRange();
      range.selectNodeContents(replyInput);
      range.collapse(false);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
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

  document.getElementById("sendBtn")?.addEventListener("click", sendMessage);
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
  renderMemoryIdle();
  await loadAgent();
  await initProfile();
  wireSend();
  wireAiSuggest();
  connectWebSocket();
  wireResolveButton();
});
