const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY } = window.CONFIG;

const supabaseClient =
window.supabase.createClient(
SUPABASE_URL,
SUPABASE_ANON_KEY
);

const toggleBtn =
document.getElementById("toggleBtn");

const formTitle =
document.getElementById("formTitle");

const formSubtitle =
document.getElementById("formSubtitle");

const switchText =
document.getElementById("switchText");

const nameField =
document.getElementById("nameField");

const confirmPasswordField =
document.getElementById("confirmPasswordField");

const submitBtn =
document.querySelector(".primary-btn");

let isLogin = true;

function showFormError(msg) {
  const el = document.getElementById("formError");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function showFormSuccess(msg) {
  const el = document.getElementById("formSuccess");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("hidden", !msg);
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.textContent = loading
    ? (isLogin ? "Signing in…" : "Creating account…")
    : (isLogin ? "Sign In" : "Sign Up");
}

async function ensureCustomerProfile() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.access_token) return;
    
    const response = await fetch(`${window.CONFIG.API_BASE}/my/setup-profile`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json"
      }
    });
    
    if (!response.ok) {
      console.warn("Failed to setup customer profile:", response.status);
    }
  } catch (e) {
    console.warn("Error setting up customer profile:", e);
  }
}

async function roleRedirect(email) {
  if (email === ADMIN_EMAIL) {
    window.location.href = "./dashboard.html";
  } else {
    await ensureCustomerProfile();
    window.location.href = "./chat.html";
  }
}

toggleBtn.addEventListener(
"click",
(e)=>{

e.preventDefault();

isLogin = !isLogin;

if(isLogin){

formTitle.textContent =
"Welcome Back";

formSubtitle.textContent =
"Sign in to access your support workspace.";

submitBtn.textContent =
"Sign In";

switchText.textContent =
"Don't have an account?";

toggleBtn.textContent =
"Sign Up";

nameField.classList.add("hidden");

confirmPasswordField.classList.add("hidden");

}else{

formTitle.textContent =
"Create Account";

formSubtitle.textContent =
"Start building support experiences that remember every customer.";

submitBtn.textContent =
"Sign Up";

switchText.textContent =
"Already have an account?";

toggleBtn.textContent =
"Sign In";

nameField.classList.remove("hidden");

confirmPasswordField.classList.remove("hidden");

}

});

async function signUp(email, password) {
  showFormError("");
  const fullName = document.getElementById("fullName").value;

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    if (error) {
      showFormError(error.message);
      return;
    }

    showFormSuccess("Account created! Please verify your email.");
  } catch (e) {
    showFormError(e.message ?? "Sign up failed");
  }
}

async function signIn(email, password) {
  showFormError("");

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({ email, password });

    if (error) {
      showFormError(error.message);
      return;
    }

    roleRedirect(email);
  } catch (e) {
    showFormError(e.message ?? "Sign in failed");
  }
}

// =========================
// FORM SUBMIT
// =========================

document.getElementById("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showFormError("");
  showFormSuccess("");

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!isLogin) {
    const confirmPassword = document.getElementById("confirmPassword").value;
    if (password !== confirmPassword) {
      showFormError("Passwords do not match");
      return;
    }
  }

  setLoading(true);
  try {
    if (isLogin) {
      await signIn(email, password);
    } else {
      await signUp(email, password);
    }
  } catch (e) {
    showFormError(e.message ?? "Something went wrong");
  } finally {
    setLoading(false);
  }
});

// GOOGLE LOGIN

document.querySelector(".google-btn").addEventListener("click", async () => {
  showFormError("");
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/login.html" },
    });
    if (error) showFormError(error.message);
  } catch (e) {
    showFormError(e.message ?? "Google sign in failed");
  }
});

// Handle OAuth callback — detect session after redirect
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    const email = session.user.email;
    if (email) roleRedirect(email);
  }
});

async function checkSession() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      const email = session.user.email;
      if (email) roleRedirect(email);
    }
  } catch (e) {
    // Session check failed — user will see the login form
  }
}

checkSession();
