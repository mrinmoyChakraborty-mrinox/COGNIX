const SUPABASE_URL = "https://ckjypqgnkovsdezsjjqo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNranlwcWdua292c2RlenNqanFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDI2MjQsImV4cCI6MjA5NjkxODYyNH0.mCDrIQ5ftcqzSG6oACy-UCdfPR2-virzU_udRuRDXwM";

const supabaseClient =
window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
document.addEventListener('DOMContentLoaded', () => {
  // Agent filter dropdown (placeholder behaviour)
  const agentFilter = document.getElementById('agentFilter');
  if (agentFilter) {
    agentFilter.addEventListener('click', () => {
      // Hook up real agent list / dropdown logic here
      console.log('Agent filter clicked');
    });
  }

  // Start session buttons
  const startButtons = document.querySelectorAll('.start-session-btn');
  startButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const card = e.target.closest('.ticket-card');
      const name = card?.querySelector('.ticket-name')?.textContent || 'customer';
      console.log(`Starting session with ${name}`);
      // Hook up real session-start logic here
    });
  });

  // Notification bell
  const bell = document.getElementById('notifBell');
  if (bell) {
    bell.addEventListener('click', () => {
      console.log('Notifications clicked');
    });
  }
});


async function loadUser(){

 const {
  data:{session}
 } =
 await supabaseClient.auth.getSession();

 if(!session){

   window.location.href =
   "/index.html";

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

 document.getElementById(
 "welcomeText"
 ).innerText =
 `Good morning, ${fullName}`;

 document.getElementById(
 "avatarWrapper"
 ).innerHTML =
 `
 <img
   src="${avatar}"
   class="avatar"
   alt="${fullName}"
 >
 `;
}

async function logout(){

 await supabaseClient.auth.signOut();

 window.location.href =
 "/index.html";
}

document
.getElementById("logoutBtn")
?.addEventListener(
 "click",
 logout
);

loadUser();