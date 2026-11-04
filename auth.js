"use strict";

(() => {
  const loginDialog = document.getElementById("login-dialog");
  const emailForm = document.getElementById("login-email-form");
  const codeForm = document.getElementById("login-code-form");
  const emailInput = document.getElementById("login-email");
  const codeInput = document.getElementById("login-code");
  const sendButton = document.getElementById("send-otp");
  const verifyButton = document.getElementById("verify-otp");
  const resendButton = document.getElementById("resend-otp");
  const changeButton = document.getElementById("change-login-email");
  const openButton = document.getElementById("open-login");
  const logoutButton = document.getElementById("logout");
  const status = document.getElementById("auth-status");
  const message = document.getElementById("login-message");
  const errorMessage = document.getElementById("login-error");
  let client = null;
  let email = "";
  let busy = false;
  let resendAt = 0;
  let currentSession = null;

  function showError(error) {
    errorMessage.textContent = error.message || "Login failed. Please try again.";
  }

  function updateButtons() {
    sendButton.disabled = !client || busy;
    verifyButton.disabled = busy;
    changeButton.disabled = busy;
    resendButton.disabled = busy || Date.now() < resendAt;
    resendButton.textContent = Date.now() < resendAt
      ? `Resend in ${Math.ceil((resendAt - Date.now()) / 1000)}s`
      : "Resend code";
    logoutButton.disabled = busy;
  }

  function showSession(session) {
    currentSession = session;
    status.textContent = session
      ? `Logged in as ${session.user.email}`
      : "Not logged in. Use email OTP to verify your email.";
    openButton.textContent = session ? "Account" : "Log in";
    logoutButton.hidden = !session;
  }

  openButton.addEventListener("click", () => {
    if (currentSession) {
      notify(`Logged in as ${currentSession.user.email}. Use Log out to end this session.`);
      return;
    }
    if (!loginDialog.open) loginDialog.showModal();
  });
  document.getElementById("close-login").addEventListener("click", () => loginDialog.close());

  async function sendCode() {
    if (busy || !client) return;
    busy = true;
    errorMessage.textContent = "";
    message.textContent = "Requesting your login code...";
    updateButtons();
    try {
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      resendAt = Date.now() + 60000;
      emailForm.hidden = true;
      codeForm.hidden = false;
      codeInput.value = "";
      message.textContent = `Code requested for ${email}. Check your inbox and spam folder. Use the newest code.`;
      codeInput.focus();
    } catch (error) {
      message.textContent = "";
      showError(error);
    } finally {
      busy = false;
      updateButtons();
    }
  }

  emailForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!emailForm.reportValidity()) return;
    if (Date.now() < resendAt) {
      showError(new Error("Please wait before requesting another code."));
      return;
    }
    email = emailInput.value.trim();
    void sendCode();
  });
  resendButton.addEventListener("click", () => {
    if (Date.now() >= resendAt) void sendCode();
  });
  changeButton.addEventListener("click", () => {
    codeForm.hidden = true;
    emailForm.hidden = false;
    codeInput.value = "";
    errorMessage.textContent = "";
    message.textContent = "Enter your email. Requests must be at least one minute apart.";
    emailInput.focus();
  });

  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !client || !codeForm.reportValidity()) return;
    busy = true;
    errorMessage.textContent = "";
    message.textContent = "Verifying your code...";
    updateButtons();
    try {
      const { data, error } = await client.auth.verifyOtp({
        email,
        token: codeInput.value.trim(),
        type: "email",
      });
      if (error) throw error;
      if (!data.session) throw new Error("No login session was returned. Request a new code.");
      showSession(data.session);
      codeInput.value = "";
      codeForm.hidden = true;
      emailForm.hidden = false;
      message.textContent = "";
      loginDialog.close();
      notify("Email verified. You are now logged in.");
    } catch (error) {
      message.textContent = "";
      showError(error);
    } finally {
      busy = false;
      updateButtons();
    }
  });

  logoutButton.addEventListener("click", async () => {
    if (busy || !client) return;
    busy = true;
    updateButtons();
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) throw error;
      showSession(null);
      notify("Logged out of this browser.");
    } catch (error) {
      notify(`Logout failed: ${error.message}`);
    } finally {
      busy = false;
      updateButtons();
    }
  });

  async function initialize() {
    try {
      if (location.protocol === "file:") {
        throw new Error("Start the UI with node start-ui.mjs, then open http://127.0.0.1:3000.");
      }
      const response = await fetch("/api/public-config", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Login configuration unavailable. Run node start-ui.mjs.");
      const config = await response.json();
      if (!config.url || !config.publishableKey) {
        throw new Error("Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY to .env, then restart.");
      }
      if (!window.supabase) throw new Error("Could not load the login library. Check your internet connection and reload.");
      client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: {
          fetch: (input, options) => fetch(input, {
            ...options,
            signal: AbortSignal.timeout(15000),
          }),
        },
      });
      client.auth.onAuthStateChange((_event, session) => showSession(session));
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      showSession(data.session);
      updateButtons();
    } catch (error) {
      client = null;
      status.textContent = `Email login unavailable: ${error.message}`;
      showError(error);
      updateButtons();
    }
  }
  setInterval(updateButtons, 1000);
  void initialize();
})();
