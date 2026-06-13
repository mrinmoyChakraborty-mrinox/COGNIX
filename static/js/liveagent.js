// ============================================================
// Live Agent Session — interactions
// ============================================================

const SUPABASE_URL = "https://ckjypqgnkovsdezsjjqo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNranlwcWdua292c2RlenNqanFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDI2MjQsImV4cCI6MjA5NjkxODYyNH0.mCDrIQ5ftcqzSG6oACy-UCdfPR2-virzU_udRuRDXwM";

const supabaseClient =
window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
document.addEventListener("DOMContentLoaded", () => {
  const aiSuggestBtn = document.getElementById("aiSuggestBtn");
  const replyInput = document.querySelector(".reply-input");
  const memorySaveBtn = document.getElementById("memorySaveBtn");

  const memoryItems =
  document.querySelectorAll(".memory-item");

  const memoryCount =
  document.getElementById("memoryCount");

  if(memoryCount){
    memoryCount.textContent =
    `${memoryItems.length} new memories detected`;
  }

  async function loadAgent() {

 const {
   data: { session }
 } = await supabaseClient.auth.getSession();

 if (!session) {
   window.location.href = "/index.html";
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

  console.log(fullName);
  document.getElementById(
    "agentAvatar"
  ).src = avatar;
}

  const SUGGESTED_REPLY =
    "Thanks for confirming — since you're already on v2.3.1, this matches a known timeout pattern under high concurrency. I'll bump your request timeout to 90s on our end and flag it for the engineering team. No redeploy needed on your side.";

  // AI Suggest Reply: fills the reply box with a contextual suggestion
  if (aiSuggestBtn && replyInput) {
    aiSuggestBtn.addEventListener("click", () => {
      aiSuggestBtn.classList.add("is-loading");
      aiSuggestBtn.disabled = true;

      setTimeout(() => {
        replyInput.textContent = SUGGESTED_REPLY;
        replyInput.focus();

        // place cursor at end
        const range = document.createRange();
        range.selectNodeContents(replyInput);
        range.collapse(false);
        const sel = window.getSelection();
        if(sel){
            sel.removeAllRanges();
            sel.addRange(range);
          }
        aiSuggestBtn.classList.remove("is-loading");
        aiSuggestBtn.disabled = false;
      }, 600);
    });
  }

  // Memory Delta: "Save to MemoryDesk" confirmation state
  if (memorySaveBtn) {
    memorySaveBtn.addEventListener("click", () => {
      if (memorySaveBtn.classList.contains("saved")) return;

      memorySaveBtn.textContent = "Saved ✓";
      memorySaveBtn.classList.add("saved");

      setTimeout(() => {
        memorySaveBtn.textContent = "Save to MemoryDesk";
        memorySaveBtn.classList.remove("saved");
      }, 2200);
    });
  }
  loadAgent();
});
