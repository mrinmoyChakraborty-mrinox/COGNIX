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

function roleRedirect(email) {
  if (email === ADMIN_EMAIL) {
    window.location.href = "/frontend/dashboard.html";
  } else {
    window.location.href = "/frontend/chat.html";
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

async function signUp(
 email,
 password
){

 const fullName =
 document
 .getElementById("fullName")
 .value;

 const { data, error }
 =
 await supabaseClient.auth.signUp({

 email,
 password,
 options:{
  data:{
   full_name:fullName
  }
 }

 });

if(error){

alert(error.message);
return;

}

if (data?.user) {
  await supabaseClient.from('user_roles').insert({
    user_id: data.user.id,
    role: 'customer'
  });
}

alert(
"Account created! Please verify your email."
);

}

async function signIn(email,password){

 const { data,error } =
 await supabaseClient.auth.signInWithPassword({
   email,
   password
 });

 console.log("LOGIN DATA:", data);
 console.log("LOGIN ERROR:", error);

 if(error){
   alert(error.message);
   return;
 }

 alert("Login Success");
 roleRedirect(email);
}

// =========================
// FORM SUBMIT
// =========================

document
.getElementById("authForm")
.addEventListener(
"submit",
async(e)=>{

e.preventDefault();

const email =
document
.getElementById("email")
.value;

const password =
document
.getElementById("password")
.value;

if(isLogin){

await signIn(
email,
password
);

}else{

const confirmPassword =
document
.getElementById(
"confirmPassword"
)
.value;

if(
password !==
confirmPassword
){

alert(
"Passwords do not match"
);

return;

}

await signUp(
email,
password
);

}

}
);

// GOOGLE LOGIN

document
.querySelector(".google-btn")
.addEventListener(
"click",
async()=>{

const {
error
}
=
await supabaseClient.auth.signInWithOAuth({

provider:"google",

options:{

redirectTo:
window.location.origin +
"/frontend/login.html"

}

});

if(error){

alert(error.message);

}

}
);

// Handle OAuth callback — detect session after redirect
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_IN' && session?.user) {
    const email = session.user.email;
    if (email) roleRedirect(email);
  }
});

async function checkSession(){

const {
data:{session}
}
=
await supabaseClient.auth.getSession();

if(session?.user){
  const email = session.user.email;
  if (email) roleRedirect(email);
}

}

checkSession();
