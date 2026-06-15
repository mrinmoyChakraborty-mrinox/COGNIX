window.CONFIG = {
  ADMIN_EMAIL: "runtimeco.team@gmail.com",
  SUPABASE_URL: "https://ckjypqgnkovsdezsjjqo.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNranlwcWdua292c2RlenNqanFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDI2MjQsImV4cCI6MjA5NjkxODYyNH0.mCDrIQ5ftcqzSG6oACy-UCdfPR2-virzU_udRuRDXwM",
  API_BASE: "https://cognix-jge0.onrender.com",
  WS_BASE: "wss://cognix-jge0.onrender.com",
}

window.formatMemory = function (mem) {
  const raw = typeof mem === "string" ? mem : mem && mem.content ? mem.content : "";
  if (!raw) return "";
  let t = raw
    .replace(/\b[a-z]{3,4}_[a-zA-Z0-9]+\b/g, "")
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, "")
    .replace(/\{[^}]*\}/g, "")
    .replace(/["""]/g, "").replace(/['']/g, "")
    .replace(/^the customer'?s? support case[^.]*\.?\s*/i, "")
    .replace(/^customer (stated|mentioned|reported|indicated|said)[:\s]+/i, "")
    .replace(/^customer (requested|asked for|wants|needs|requires)[:\s]+/i, "")
    .replace(/^customer is (experiencing|having|facing|dealing with)[:\s]+/i, "")
    .replace(/^customer (unable to|cannot|could not)[:\s]+/i, "")
    .replace(/^customer'?s? (account|support case|ticket|issue) (is|was|has been)[:\s]+/i, "")
    .replace(/^in this session,? (the )?customer[:\s]+/i, "")
    .replace(/\s+/g, " ").trim();
  if (!t) { t = raw.substring(0, 77) + "..."; }
  else { if (t.length > 80) t = t.substring(0, 77) + "..."; }
  return t.charAt(0).toUpperCase() + t.slice(1);
};

window.categorizeMemory = function (mem) {
  const t = (mem.content || "").toLowerCase();
  const ctx = (mem.context || "").toLowerCase();
  if (ctx === "preference" || t.includes("prefer") || t.includes("would like") || t.includes("wants to")) return "Preference";
  if (mem.memory_type === "experience" || /error|timeout|fail|crash|bug|broken|issue|problem|incident|unable|cannot/u.test(t)) return "Issue";
  if (/ticket|case #|support case/u.test(t)) return "Ticket";
  if (mem.memory_type === "observation" && /resolved|fixed|patch|workaround|solution/u.test(t)) return "Resolution";
  if (/frustrat|angr|upset|disappoint|annoy|unhappy|mad|sad|furious|tired/u.test(t)) return "Sentiment";
  return "Observation";
};
