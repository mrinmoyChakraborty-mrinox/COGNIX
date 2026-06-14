

(function () {
  "use strict";

  /* ── DOM refs ─────────────────────────────────────────────── */
  const chatMessages  = document.getElementById("chatMessages");
  const msgInput      = document.getElementById("msgInput");
  const sendBtn       = document.getElementById("sendBtn");
  const typingRow     = document.getElementById("typingRow");
  const closeBanner   = document.getElementById("closeBanner");
  const memoryBanner  = document.getElementById("memoryBanner");
  const aiSuggestBtn  = document.getElementById("aiSuggestBtn");
  const qrChips       = document.querySelectorAll(".qr-chip");

  /* ── Config ───────────────────────────────────────────────── */
  const BOT_AVATAR_HTML = `
    <div class="bot-avatar">
      <svg viewBox="0 0 20 20" fill="none">
        <path d="M10 2.5C10 2.5 5 5.5 5 10.5C5 13.26 7.24 15.5 10 15.5C12.76 15.5 15 13.26 15 10.5C15 5.5 10 2.5Z" fill="white" fill-opacity="0.9"/>
        <circle cx="10" cy="10.5" r="2.5" fill="white" fill-opacity="0.5"/>
      </svg>
    </div>`;

  const USER_AVATAR_HTML = `
    <img
      src="https://api.dicebear.com/7.x/thumbs/svg?seed=mrinmoy&backgroundColor=b6e3f4"
      class="user-avatar-sm"
      alt="Mrinmoy"
      onerror="this.src='https://storage.googleapis.com/banani-avatars/avatar/male/25-35/South Asian/1'"
    />`;

  /* ── AI response pool ─────────────────────────────────────── */
  const AI_REPLIES = [
    "Since you're on v2.3.1, this matches a known timeout pattern under high concurrency. Try bumping your request timeout to <strong>90s</strong> — no redeploy needed on your end.",
    "I've checked our changelog for v2.3.1. There's an open bug with connection pooling on <strong>us-east-1</strong>. Switching to eu-west-1 is still the fastest fix.",
    "I've escalated this to our engineering team as a priority ticket. You should receive a follow-up within <strong>2 hours</strong>.",
    "Could you share the exact error code you're seeing? That'll help me pinpoint whether this is the same root cause as last time.",
    "I've added a note to your account flagging the recurring nature of this issue. Our team will proactively monitor your usage going forward.",
  ];

  /* ── AI suggest replies ───────────────────────────────────── */
  const SUGGEST_POOL = [
    "Since you're on v2.3.1 and us-east-1, I'd recommend switching your endpoint to eu-west-1 — this resolved the same issue in November. No redeploy needed.",
    "I'm checking for known issues with v2.3.1 now. Can you share your current request timeout config?",
    "I've flagged this as a recurring issue and escalated ticket #523 to our engineering team. You'll hear back within 2 hours.",
  ];
  let suggestIdx = 0;

  /* ── Helpers ──────────────────────────────────────────────── */
  function now() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function scrollToBottom(smooth = true) {
    chatMessages.scrollTo({
      top: chatMessages.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function showTyping() {
    typingRow.style.display = "flex";
    scrollToBottom();
  }

  function hideTyping() {
    typingRow.style.display = "none";
  }

  /* ── Append a message bubble ──────────────────────────────── */
  function appendBubble({ role, text, showMemoryChip = false }) {
    const isAI = role === "ai";
    const t    = now();

    const row = document.createElement("div");
    row.className = `bubble-row ${isAI ? "row-ai" : "row-user"} msg-new`;

    if (isAI) {
      row.innerHTML = `
        ${BOT_AVATAR_HTML}
        <div class="bubble-group">
          <span class="bubble-meta">COGNIX AI · ${t}</span>
          <div class="bubble bubble-ai">${text}</div>
          ${showMemoryChip ? `
            <div class="memory-chip">
              <svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="5" stroke="currentColor" stroke-width="1.2"/><path d="M6 3v3.5L8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              Recalled from last session
            </div>` : ""}
        </div>`;
    } else {
      row.innerHTML = `
        <div class="bubble-group group-right">
          <span class="bubble-meta meta-right">Mrinmoy · ${t}</span>
          <div class="bubble bubble-user">${text}</div>
        </div>
        ${USER_AVATAR_HTML}`;
    }

    /* Insert before typing indicator so typing always stays last */
    chatMessages.insertBefore(row, typingRow);
    scrollToBottom();
  }

  /* ── Send a message ───────────────────────────────────────── */
  function sendMessage(text) {
    text = (text || msgInput.value).trim();
    if (!text) return;

    msgInput.value = "";
    msgInput.focus();

    appendBubble({ role: "user", text });

    /* Show typing, then reply */
    setTimeout(showTyping, 350);
    const delay = 1400 + Math.random() * 800;
    setTimeout(() => {
      hideTyping();
      const reply = AI_REPLIES[Math.floor(Math.random() * AI_REPLIES.length)];
      appendBubble({ role: "ai", text: reply });
    }, delay);
  }

  /* ── Send button & Enter key ──────────────────────────────── */
  sendBtn.addEventListener("click", () => sendMessage());
  msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  /* ── Quick reply chips ────────────────────────────────────── */
  qrChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      msgInput.value = chip.dataset.text;
      msgInput.focus();
    });
  });

  /* ── AI suggest reply ─────────────────────────────────────── */
  aiSuggestBtn.addEventListener("click", () => {
    aiSuggestBtn.classList.add("loading");
    const suggestion = SUGGEST_POOL[suggestIdx % SUGGEST_POOL.length];
    suggestIdx++;

    setTimeout(() => {
      msgInput.value = suggestion;
      msgInput.focus();

      /* Move cursor to end */
      const len = msgInput.value.length;
      msgInput.setSelectionRange(len, len);
      aiSuggestBtn.classList.remove("loading");
    }, 480);
  });

  /* ── Dismiss memory banner ────────────────────────────────── */
  closeBanner.addEventListener("click", (e) => {
    e.stopPropagation();
    memoryBanner.style.animation = "none";
    memoryBanner.style.opacity   = "0";
    memoryBanner.style.transform = "translateY(-4px)";
    memoryBanner.style.transition = "opacity 0.2s ease, transform 0.2s ease";
    setTimeout(() => { memoryBanner.style.display = "none"; }, 220);
  });

  /* ── Auto-scroll on load ──────────────────────────────────── */
  scrollToBottom(false);

})();
