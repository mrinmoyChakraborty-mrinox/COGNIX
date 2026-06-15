const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE, WS_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const CUSTOMER_ID = params.get("customer_id");

let socket = null;

const chatMessages = document.querySelector(".chat-messages");
const replyInput   = document.querySelector(".reply-input");
const aiSuggestBtn = document.getElementById("aiSuggestBtn");
if (aiSuggestBtn) aiSuggestBtn._suggestion = null;
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
    appendMessage("system",
      "Session started \u2014 waiting for customer message.");
  };

  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    console.log("Memory data", msg);
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
      appendMessage("system", msg.data);
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
      showTypingIndicator(false);

      appendMessage("customer", msg.data);

      if (msg.suggested_reply) {
        showSuggestedReply(msg.suggested_reply, msg.suggested_solution);
      }

      if (msg.suggested_reply && aiSuggestBtn) {
        aiSuggestBtn._suggestion = msg.suggested_reply;
      }

      if (msg.escalation_flag) {
        showEscalationBanner(msg.escalation_reason);
      }

      if (msg.memory_summary) {
        updateSessionNotes(msg.memory_summary);
      }

      if (typeof msg.frustration_score === "number") {
        updateFrustrationScore(msg.frustration_score);
      }
      break;

    case "agent_reply_sent":
      break;

    case "error":
      appendMessage("system", msg.data || "An error occurred.");
      break;
  }
}

function sendCustomerMessage() {
  const text = replyInput.value.trim() || "same issue as before";
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendMessage("system", "Not connected. Reconnecting...");
    return;
  }

  replyInput.value = "";
  replyInput.focus();
  hideSuggestedReply();

  socket.send(JSON.stringify({
    type: "customer",
    text: text,
  }));
}

function appendMessage(role, text) {
  showTypingIndicator(false);
  const div = document.createElement("div");

  if (role === "system") {
    div.className = "msg msg-system";
    div.innerHTML = `
      <div class="msg-body" style="justify-content:center">
        <div class="bubble" style="background:var(--color-secondary);
             color:var(--color-muted-foreground);font-size:12px;
             padding:6px 12px;border-radius:20px">
          ${escapeHtml(text)}
        </div>
      </div>`;
  } else if (role === "agent") {
    div.className = "msg msg-right";
    div.innerHTML = `
      <div class="msg-body">
        <div class="bubble bubble-outgoing">${escapeHtml(text)}</div>
        <span class="msg-time">${new Date().toLocaleTimeString([],
          {hour:"2-digit",minute:"2-digit"})}</span>
      </div>`;
  } else {
    div.className = "msg msg-left";
    div.innerHTML = `
      <div class="msg-body">
        <div class="bubble bubble-incoming">${escapeHtml(text)}</div>
        <span class="msg-time">${new Date().toLocaleTimeString([],
          {hour:"2-digit",minute:"2-digit"})}</span>
      </div>`;
  }

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

function buildMemoryGraph(hits) {
  if (!hits || !hits.length) return "";
  const nodes = [];
  const edges = [];
  const seen = new Set();
  hits.forEach((h) => {
    const s = window.formatMemory(h);
    const cat = window.categorizeMemory(h);
    if (!s || seen.has(s)) return;
    seen.add(s);
    const id = "n" + nodes.length;
    nodes.push({ id, label: s, type: cat });
    if (nodes.length > 1) edges.push({ from: nodes[0].id, to: id });
  });
  console.log("Visualization nodes", nodes);
  console.log("Visualization edges", edges);
  if (!nodes.length) return "";
  let html = `<div class="memory-graph"><div class="graph-legend">`;
  [...new Set(nodes.map((n) => n.type))].forEach((t) => {
    const cls = t.toLowerCase();
    html += `<span class="memory-category-badge ${cls}">${t}</span>`;
  });
  html += `</div><div class="graph-tree">`;
  nodes.forEach((n, i) => {
    const cls = n.type.toLowerCase();
    const indent = i === 0 ? "" : " style='padding-left:24px'";
    const connector = i === 0 ? "" : " class='graph-child'";
    html += `<div class="graph-node"${indent}><span class="graph-dot dot-${cls}"${connector}></span><span class="graph-label">${escapeHtml(n.label)}</span></div>`;
    if (i === 0 && nodes.length > 1) html += `<div class="graph-connector"></div>`;
  });
  html += `</div></div>`;
  return html;
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

  console.log("Visualization nodes", hits);
  memoryPanel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18V5m3 8a4.17 4.17 0 0 1-3-4a4.17 4.17 0 0 1-3 4m8.598-6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"></path><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"></path><path d="M18 18a4 4 0 0 0 2-7.464"></path><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"></path><path d="M6 18a4 4 0 0 1-2-7.464"></path><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"></path></svg>
      <span>Memory Retrieval</span>
      <span class="memory-ms">${ms}ms</span>
    </div>
    <div class="memory-query-pill">Query: <code>"${query}"</code></div>
    <div class="memory-hits" id="memoryHits"></div>
    <div id="memoryGraphContainer"></div>
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
        <p class="memory-hit-content">${escapeHtml(window.formatMemory(hit))}</p>
        <span class="memory-type-badge ${TYPE_CLASSES[hit.memory_type] || ""}">${TYPE_LABELS[hit.memory_type] || "Memory"}</span>
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => el.classList.add("visible"), 200 + i * 150);
  });
  const graphContainer = document.getElementById("memoryGraphContainer");
  if (graphContainer) {
    const graphHtml = buildMemoryGraph(hits);
    graphContainer.innerHTML = graphHtml;
  }
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

function updateFrustrationScore(score) {
  const scoreEl = document.getElementById("profileFrustrationScore");
  const circleEl = document.getElementById("frustrationCircle");
  if (scoreEl) scoreEl.textContent = score;
  if (circleEl) {
    const r = 23, c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    circleEl.setAttribute("stroke-dasharray", `${c - offset} ${offset}`);
    circleEl.setAttribute("stroke", score >= 75 ? "#ef4444" : score >= 45 ? "#f59e0b" : "#22c55e");
  }
}

let _suggestionEl = null;

function showSuggestedReply(suggestion, solution) {
  hideSuggestedReply();

  _suggestionEl = document.createElement("div");
  _suggestionEl.className = "suggested-reply-bubble";
  _suggestionEl.style.cssText = `
    margin: 8px 12px;
    padding: 10px 14px;
    background: linear-gradient(135deg, #f0f0ff, #e8e8ff);
    border: 1.5px solid var(--color-primary, #6366f1);
    border-radius: 10px;
    font-size: 13px;
    color: var(--color-foreground);
    position: relative;
    animation: fadeIn 0.2s ease;
  `;

  _suggestionEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px">
      <svg style="flex-shrink:0;margin-top:2px;color:var(--color-primary)"
           width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 1l1.2 4.5a2 2 0 0 0 1.3 1.3L15 8l-4.5 1.2a2 2 0 0 0-1.3 1.3L8 15l-1.2-4.5A2 2 0 0 0 5.5 9.2L1 8l4.5-1.2A2 2 0 0 0 6.8 5.5L8 1Z"
              stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
      </svg>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;font-weight:600;color:var(--color-primary);
                    text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">
          AI Suggested Reply
        </div>
        <div style="line-height:1.5" id="suggestionText">
          ${escapeHtml(suggestion)}
        </div>
        ${solution ? `
          <div style="margin-top:6px;padding:4px 8px;background:rgba(99,102,241,0.08);
                      border-radius:6px;font-size:11px;color:var(--color-primary)">
            💡 ${escapeHtml(solution)}
          </div>
        ` : ''}
      </div>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button id="acceptSuggestionBtn"
        style="flex:1;padding:6px;border-radius:6px;border:none;cursor:pointer;
               background:var(--color-primary);color:white;font-size:12px;
               font-weight:500">
        Use this reply
      </button>
      <button id="editSuggestionBtn"
        style="flex:1;padding:6px;border-radius:6px;cursor:pointer;
               background:transparent;
               border:1px solid var(--color-primary);
               color:var(--color-primary);font-size:12px;font-weight:500">
        Edit first
      </button>
      <button id="dismissSuggestionBtn"
        style="padding:6px 10px;border-radius:6px;cursor:pointer;
               background:transparent;border:1px solid var(--color-border);
               color:var(--color-muted-foreground);font-size:12px">
        ✕
      </button>
    </div>
  `;

  chatMessages.appendChild(_suggestionEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  document.getElementById('acceptSuggestionBtn')
    ?.addEventListener('click', () => {
      sendAgentReplyText(suggestion);
      hideSuggestedReply();
    });

  document.getElementById('editSuggestionBtn')
    ?.addEventListener('click', () => {
      replyInput.value = suggestion;
      replyInput.focus();
      replyInput.setSelectionRange(suggestion.length, suggestion.length);
      hideSuggestedReply();
    });

  document.getElementById('dismissSuggestionBtn')
    ?.addEventListener('click', hideSuggestedReply);
}

function hideSuggestedReply() {
  if (_suggestionEl) {
    _suggestionEl.remove();
    _suggestionEl = null;
  }
}

function sendAgentReplyText(text) {
  if (!text || !socket || socket.readyState !== WebSocket.OPEN) return;
  appendMessage("agent", text);
  hideSuggestedReply();
  socket.send(JSON.stringify({ type: "agent_reply", text }));
}

function wireAiSuggest() {
  if (!aiSuggestBtn || !replyInput) return;
  aiSuggestBtn.addEventListener("click", () => {
    const suggestion = aiSuggestBtn._suggestion;
    if (!suggestion) {
      sendCustomerMessage();
      return;
    }
    aiSuggestBtn.classList.add("is-loading");
    aiSuggestBtn.disabled = true;
    setTimeout(() => {
      replyInput.value = suggestion;
      replyInput.focus();
      replyInput.setSelectionRange(suggestion.length, suggestion.length);
      aiSuggestBtn.classList.remove("is-loading");
      aiSuggestBtn.disabled = false;
    }, 300);
  });
}

function wireSend() {
  const doSend = () => {
    const text = replyInput.value.trim();
    if (!text) return;
    sendAgentReplyText(text);
  };

  replyInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  document.getElementById("sendBtn")
    ?.addEventListener("click", doSend);
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
  const profileLinkEl = document.getElementById("profileLink");
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

  // Wire profile navigation
  const profileUrl = `./customer_profile.html?customer_id=${CUSTOMER_ID}`;
  if (profileLinkEl) profileLinkEl.href = profileUrl;
  if (nameEl) {
    nameEl.style.cursor = "pointer";
    nameEl.title = "View customer profile";
    nameEl.addEventListener("click", () => { window.location.href = profileUrl; });
  }
  if (avatarEl) {
    avatarEl.style.cursor = "pointer";
    avatarEl.title = "View customer profile";
    avatarEl.addEventListener("click", () => { window.location.href = profileUrl; });
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
        appendMessage("system", "✅ Ticket marked as resolved.");
      }
    } catch (e) {
      console.warn("resolve ticket failed", e);
    }
  });
}

async function loadSidebarFacts() {
  const panel = document.getElementById('sidebarFacts');
  if (!panel || !CUSTOMER_ID) return;

  panel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" 
           stroke-width="3" stroke-linecap="round" 
           stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4m0 4h.01"/>
      </svg>
      <span>Known Facts</span>
      <span id="factsCount" style="margin-left:auto;font-size:11px;
            color:var(--color-muted-foreground)">Loading…</span>
    </div>
    <div id="factsList" style="padding:0 12px 12px"></div>
  `;

  const token = await getToken();
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(
      `${API_BASE}/customers/${CUSTOMER_ID}/memories`,
      { headers }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const memories = await res.json();

    const countEl = document.getElementById('factsCount');
    if (countEl) countEl.textContent = `${memories.length} stored`;

    const list = document.getElementById('factsList');
    if (!list) return;

    if (!memories.length) {
      list.innerHTML = `<p style="font-size:12px;
        color:var(--color-muted-foreground);padding:4px 0">
        No facts stored yet.</p>`;
      return;
    }

    const TYPE_COLORS = {
      world_fact: '#6366f1',
      experience: '#f59e0b',
      observation: '#22c55e',
    };
    const TYPE_LABELS = {
      world_fact: 'Fact',
      experience: 'Experience', 
      observation: 'Observation',
    };

    // Use window.formatMemory if available, else raw content
    const fmt = (m) => window.formatMemory 
      ? window.formatMemory(m) 
      : (m.content || '').substring(0, 80);

    list.innerHTML = memories.slice(0, 8).map(m => `
      <div style="display:flex;align-items:flex-start;gap:8px;
                  padding:5px 0;border-bottom:1px solid 
                  var(--color-border)">
        <span style="flex-shrink:0;width:7px;height:7px;
                     border-radius:50%;margin-top:5px;
                     background:${TYPE_COLORS[m.memory_type] 
                       || '#6366f1'}"></span>
        <div style="flex:1;min-width:0">
          <p style="font-size:12px;color:var(--color-foreground);
                    margin:0 0 2px;line-height:1.4;
                    word-break:break-word">
            ${escapeHtml(fmt(m))}
          </p>
          <span style="font-size:10px;
                       color:var(--color-muted-foreground)">
            ${TYPE_LABELS[m.memory_type] || 'Memory'}
            ${m.context && m.context !== 'stored' 
              ? ' · ' + escapeHtml(m.context) : ''}
          </span>
        </div>
      </div>
    `).join('');

    if (memories.length > 8) {
      list.innerHTML += `<p style="font-size:11px;
        color:var(--color-muted-foreground);
        padding:6px 0;text-align:center">
        +${memories.length - 8} more facts in memory</p>`;
    }

  } catch (err) {
    const list = document.getElementById('factsList');
    if (list) list.innerHTML = `<p style="font-size:12px;
      color:var(--color-muted-foreground)">
      Failed to load facts.</p>`;
  }
}


async function loadSidebarTimeline() {
  const panel = document.getElementById('sidebarTimeline');
  if (!panel || !CUSTOMER_ID) return;

  panel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="3" stroke-linecap="round" 
           stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 6v6l4 2"/>
      </svg>
      <span>Ticket History</span>
    </div>
    <div id="timelineList" style="padding:0 12px 12px"></div>
  `;

  const token = await getToken();
  const headers = { 'Accept': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(
      `${API_BASE}/customers/${CUSTOMER_ID}/tickets`,
      { headers }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tickets = await res.json();

    const list = document.getElementById('timelineList');
    if (!list) return;

    if (!tickets.length) {
      list.innerHTML = `<p style="font-size:12px;
        color:var(--color-muted-foreground);padding:4px 0">
        No tickets yet.</p>`;
      return;
    }

    const fmt = (iso) => {
      if (!iso) return '';
      const d = new Date(iso);
      return d.toLocaleDateString('en-US', 
        { month: 'short', day: 'numeric' });
    };

    const statusColor = (s) => 
      s === 'resolved' ? '#22c55e' 
      : s === 'escalated' ? '#ef4444' 
      : '#f59e0b';

    list.innerHTML = tickets.slice(0, 5).map(t => `
      <div style="display:flex;align-items:flex-start;gap:8px;
                  padding:5px 0;border-bottom:1px solid 
                  var(--color-border)">
        <span style="flex-shrink:0;width:7px;height:7px;
                     border-radius:50%;margin-top:5px;
                     background:${statusColor(t.status)}">
        </span>
        <div style="flex:1;min-width:0">
          <p style="font-size:12px;color:var(--color-foreground);
                    margin:0 0 2px;line-height:1.4;font-weight:500;
                    white-space:nowrap;overflow:hidden;
                    text-overflow:ellipsis">
            ${escapeHtml(t.subject)}
          </p>
          <span style="font-size:10px;
                       color:var(--color-muted-foreground)">
            ${fmt(t.created_at)} · 
            <span style="color:${statusColor(t.status)}">
              ${t.status}
            </span>
          </span>
        </div>
      </div>
    `).join('');

  } catch (err) {
    const list = document.getElementById('timelineList');
    if (list) list.innerHTML = `<p style="font-size:12px;
      color:var(--color-muted-foreground)">
      Failed to load tickets.</p>`;
  }
}


function initSidebarSessionNotes() {
  const panel = document.getElementById('sidebarSessionNotes');
  if (!panel) return;

  panel.innerHTML = `
    <div class="section-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="3" stroke-linecap="round" 
           stroke-linejoin="round">
        <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8l6 6v12a2 2 0 0 1-2 2z"/>
        <path d="M14 2v6h6M10 9H8m8 4H8m8 4H8"/>
      </svg>
      <span>Session Notes</span>
    </div>
    <div id="sessionNotesList" style="padding:0 12px 12px;
         font-size:12px;color:var(--color-muted-foreground)">
      Notes will appear as the session progresses.
    </div>
  `;
}

// Call this from handleWsEvent when memory.update fires
// to update session notes with the latest memory summary
function updateSessionNotes(memorySummary) {
  const list = document.getElementById('sessionNotesList');
  if (!list || !memorySummary) return;

  const note = document.createElement('div');
  note.style.cssText = 'padding:4px 0;border-bottom:1px solid var(--color-border);line-height:1.4;color:var(--color-foreground)';
  note.innerHTML = `
    <span style="font-size:10px;color:var(--color-muted-foreground)">
      ${new Date().toLocaleTimeString([], 
        {hour:'2-digit',minute:'2-digit'})}
    </span>
    <p style="margin:2px 0 0;font-size:12px">
      ${escapeHtml(memorySummary)}
    </p>
  `;

  // Remove placeholder text on first note
  if (list.textContent.includes('Notes will appear')) {
    list.innerHTML = '';
  }
  list.prepend(note);
}

document.addEventListener("DOMContentLoaded", async () => {
  renderMemoryIdle();
  initSidebarSessionNotes();
  await loadAgent();
  await initProfile();
  wireSend();
  wireAiSuggest();
  connectWebSocket();
  wireResolveButton();
  // Load sidebar data after profile is loaded
  await Promise.all([
    loadSidebarFacts(),
    loadSidebarTimeline(),
  ]);
});
