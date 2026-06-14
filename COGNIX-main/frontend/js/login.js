
const SUPABASE_URL =
"https://ckjypqgnkovsdezsjjqo.supabase.co";

const SUPABASE_ANON_KEY =
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNranlwcWdua292c2RlenNqanFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNDI2MjQsImV4cCI6MjA5NjkxODYyNH0.mCDrIQ5ftcqzSG6oACy-UCdfPR2-virzU_udRuRDXwM";

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


// TOGGLE LOGIN / SIGNUP


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

// EMAIL SIGNUP


async function signUp(
 email,
 password
){

 const fullName =
 document
 .getElementById("fullName")
 .value;

 const {
 error
 }
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

alert(
"Account created! Please verify your email."
);

}


// EMAIL LOGIN


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

 window.location.href =
 "dashboard.html";
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
"/dashboard.html"

}

});

if(error){

alert(error.message);

}

}
);


// CHECK SESSION


async function checkSession(){

const {
data:{session}
}
=
await supabaseClient.auth.getSession();

if(session){

window.location.href =
"/dashboard.html";

}

}

checkSession();

