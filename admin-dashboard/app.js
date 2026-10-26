(() => {
  "use strict";

  const SUPABASE_URL = window.SUPABASE_URL || "https://xjdrqktoeodohyoynphg.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LzIX4TdfqXDldsfjnsO8sQ_zYs4di_B";
  const ADMIN_EMAILS = new Set(["ia050866@gmail.com", "imran0ali0ahmed@gmail.com"]);
  const STORAGE_KEY = "qalamly-admin-demo-v1";

  // Default seed fallback if offline
  const seed = {
    posts: [
      { id: "P-1048", title: "The quiet art of starting over", excerpt: "Some beginnings arrive softly. A cup of coffee, an open window, a blank page.", author: "Maya Chen", handle: "@mayawrites", date: "2026-10-15", status: "published", topic: "Personal growth", language: "English", likes: 128, comments: 14 }
    ],
    comments: [],
    likes: [],
    users: [],
    payouts: [],
    messages: [],
    applications: [],
    competitions: [],
    submissions: []
  };

  function syncCompetitionsToStorage(competitions) {
    try {
      localStorage.setItem("qalamly.competitions.v3", JSON.stringify(competitions));
    } catch (e) {
      console.warn("Could not sync competitions to storage:", e);
    }
  }

  const headings = {
    overview: ["Overview", "Here’s what’s happening across your database and community."],
    posts: ["Post management", "Review, edit, publish, or delete posts directly in the database."],
    comments: ["Comment moderation", "Manage and delete community comments in the database."],
    likes: ["Likes activity", "Inspect and manage story likes stored in the database."],
    users: ["User directory", "Manage user profiles and roles in the database."],
    monetization: ["Monetization & Payouts", "Review creator earnings and manage payout records."],
    applications: ["Creator applications", "Review creator monetization applications submitted on the apply page."],
    competitions: ["Competition Topics", "Create, edit, and publish writing challenges displayed on the competitions page."],
    submissions: ["Competition Submissions", "Review, evaluate, and download participant files submitted for competitions."],
    messages: ["Community messages", "Read and manage incoming inquiries from the contact table."],
    database: ["Database console", "Live table explorer and raw record interface for Supabase."],
    security: ["Security", "Update your administrator password and manage two-factor authentication."]
  };

  let state = {
    posts: [],
    comments: [],
    likes: [],
    users: [],
    admins: [],
    payouts: [],
    messages: [],
    applications: [],
    competitions: [],
    submissions: [],
    notifications: [],
    view: "overview",
    postFilter: "All",
    commentFilter: "All",
    userFilter: "All",
    payoutFilter: "All",
    applicationFilter: "All",
    competitionFilter: "All",
    submissionFilter: "All",
    dbTable: "posts",
    search: "",
    selectedMessage: null,
    isLiveDb: false,
    dbLoading: false
  };
  let adminUser = null;
  let pendingAdminMfa = null;
  let pendingAdminEnrollment = null;

  const content = document.getElementById("content");
  const searchInput = document.getElementById("globalSearch");
  const dialog = document.getElementById("editorDialog");
  const editorForm = document.getElementById("editorForm");
  const dialogFields = document.getElementById("dialogFields");
  const dialogActions = document.getElementById("dialogActions");
  let editing = null;
  let toastTimeout;

  // --- SUPABASE CLIENT HELPER ---
  async function getClient() {
    if (window.getSupabaseClient) {
      try { return await window.getSupabaseClient(); } catch {}
    }
    if (window.supabase?.createClient) {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    // Load script dynamically if needed
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    }
    return null;
  }

  async function isAdminUser(user, sb) {
    if (!user) return false;
    const email = String(user?.email || "").toLowerCase();
    if (ADMIN_EMAILS.has(email)) return true;
    if (user?.app_metadata?.role === "admin" || user?.user_metadata?.role === "admin") return true;

    if (!sb) {
      try { sb = await getClient(); } catch {}
    }
    if (sb) {
      try {
        const { data, error } = await sb
          .from("admins")
          .select("id, is_active, role")
          .eq("id", user.id)
          .eq("is_active", true)
          .maybeSingle();
        if (!error && data) return true;
      } catch (err) {
        console.warn("Admins table check error:", err);
      }
    }
    return false;
  }

  async function checkAdminAuth() {
    const sb = await getClient();
    if (!sb) return { authenticated: false };
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    if (!data?.user) return { authenticated: false };
    const authorized = await isAdminUser(data.user, sb);
    if (!authorized) return { authenticated: false, unauthorized: true };

    const { data: factors, error: factorsError } = await sb.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verifiedFactor = (factors?.totp || []).find((factor) => factor.status === "verified");
    if (verifiedFactor) {
      const { data: assurance, error: assuranceError } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (assuranceError) throw assuranceError;
      if (assurance?.currentLevel !== "aal2") {
        const { data: challenge, error: challengeError } = await sb.auth.mfa.challenge({ factorId: verifiedFactor.id });
        if (challengeError) throw challengeError;
        pendingAdminMfa = { factorId: verifiedFactor.id, challengeId: challenge.id };
        return { authenticated: false, mfaRequired: true };
      }
    }

    adminUser = data.user;
    return { authenticated: true };
  }

  async function fetchAdminRegistrationStatus() {
    // 1. Try server endpoint first
    try {
      const res = await fetch("/api/admin/status");
      if (res.ok) {
        const json = await res.json();
        return json;
      }
    } catch {}

    // 2. Query Supabase directly
    try {
      const sb = await getClient();
      if (sb) {
        const { data: rpcData, error: rpcErr } = await sb.rpc("is_admin_registration_available");
        if (!rpcErr && typeof rpcData === "boolean") {
          return {
            registrationAvailable: rpcData,
            locked: !rpcData,
            message: rpcData ? "Initial administrator registration is open." : "Registration locked."
          };
        }
        const { count, error } = await sb
          .from("admins")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true);
        if (!error) {
          const avail = count === 0;
          return {
            registrationAvailable: avail,
            locked: !avail,
            adminCount: count
          };
        }
      }
    } catch (e) {
      console.warn("Direct Supabase registration check:", e);
    }
    return { registrationAvailable: true, locked: false };
  }

  function renderAuthScreen(html) {
    const portal = document.getElementById("adminAuthPortal");
    const shell = document.getElementById("adminDashboardShell");
    if (shell) shell.style.display = "none";
    if (portal) {
      portal.style.display = "grid";
      portal.innerHTML = html;
    } else if (content) {
      content.innerHTML = html;
    }
  }

  function showDashboardScreen() {
    const portal = document.getElementById("adminAuthPortal");
    const shell = document.getElementById("adminDashboardShell");
    if (portal) {
      portal.style.display = "none";
      portal.innerHTML = "";
    }
    if (shell) {
      shell.style.display = "";
    }
  }

  function showAdminMfaGate() {
    renderAuthScreen(`
      <div class="auth-gate-container">
        <div class="auth-icon-badge">🔐</div>
        <div class="eyebrow" style="margin-bottom:6px;">TWO-FACTOR VERIFICATION</div>
        <h1 style="font-size:22px;margin:0 0 10px;">Verify your identity</h1>
        <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 24px;">Enter the current six-digit code from your authenticator app.</p>
        <form id="adminMfaForm" style="text-align:left;">
          <div class="auth-field" style="margin-bottom:16px;">
            <label for="adminMfaCode">Authentication code</label>
            <input id="adminMfaCode" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required style="width:100%;height:40px;border-radius:8px;border:1px solid #dcdde8;padding:0 12px;font-size:13px;">
          </div>
          <button class="button primary" type="submit" style="width:100%;height:40px;font-size:12px;">Verify and continue</button>
          <p id="adminAuthError" role="alert" style="color:var(--red);font-size:11px;"></p>
        </form>
      </div>
    `);
  }

  async function showAdminAuthGate(errorMessage = "", activeTab = "signin") {
    // Check if user arrived via email confirmation redirect
    const urlParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.slice(1));
    if (
      urlParams.get("type") === "signup" ||
      hashParams.get("type") === "signup" ||
      urlParams.get("type") === "email_confirmation" ||
      hashParams.get("type") === "email_confirmation" ||
      window.location.hash.includes("type=signup")
    ) {
      errorMessage = "";
      showToast("Administrator email confirmed! You can now log in.");
      window.history.replaceState(null, "", window.location.pathname);
    } else if (urlParams.get("error_description") || hashParams.get("error_description")) {
      const errDesc = decodeURIComponent(urlParams.get("error_description") || hashParams.get("error_description") || "");
      errorMessage = errDesc || "Email verification link has expired or is invalid.";
      window.history.replaceState(null, "", window.location.pathname);
    }

    // Show placeholder while checking registration status
    renderAuthScreen(`
      <div class="auth-gate-container">
        <div class="auth-icon-badge">🔒</div>
        <div class="eyebrow" style="margin-bottom:6px;">RESTRICTED ACCESS</div>
        <h1 style="font-size:22px;margin:0 0 10px;">Admin Studio Authentication</h1>
        <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 24px;">Connecting to security services...</p>
      </div>
    `);

    const regStatus = await fetchAdminRegistrationStatus();
    const isLocked = Boolean(regStatus.locked || regStatus.registrationAvailable === false);
    // If registration is available and no error was passed, we can default to signin or allow toggle
    let currentTab = activeTab;

    function renderAdminEmailConfirmation(email, fullName, redirectUrl) {
      renderAuthScreen(`
        <div class="auth-gate-container">
          <div class="auth-icon-badge">📬</div>
          <div class="eyebrow" style="margin-bottom:6px;">VERIFICATION REQUIRED</div>
          <h1 style="font-size:22px;margin:0 0 10px;">Check your email</h1>
          <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 20px;">
            We've sent an activation link to <strong style="color:var(--ink);">${esc(email)}</strong>.<br>
            Please click the confirmation link in that email to activate your administrator account.
          </p>
          <div class="auth-banner info" style="text-align:left;">
            <span style="font-size:18px;">💡</span>
            <div>
              <strong>Almost there!</strong>
              <p style="margin:4px 0 0;font-size:11px;">
                Check your spam or junk folder if the email doesn't appear within 1-2 minutes. Once confirmed, you can sign in directly.
              </p>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="button secondary" type="button" id="resendAdminConfirmBtn" style="width:100%;height:42px;font-size:12px;">
              Resend verification email
            </button>
            <button class="button primary" type="button" id="adminBackToSignIn" style="width:100%;height:42px;font-size:12px;">
              Go to Administrator Sign In →
            </button>
          </div>
        </div>
      `);

      document.getElementById("adminBackToSignIn")?.addEventListener("click", () => renderGate("signin"));
      document.getElementById("resendAdminConfirmBtn")?.addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "Resending...";
        try {
          const sbClient = await getClient();
          const { error: resendErr } = await sbClient.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: redirectUrl }
          });
          if (resendErr) throw resendErr;
          showToast("Confirmation email resent! Please check your inbox.");
          btn.textContent = "✓ Email sent! Check your inbox.";
          setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = "Resend verification email"; } }, 20000);
        } catch (resendEx) {
          showToast(resendEx instanceof Error ? resendEx.message : "Could not resend email.", true);
          btn.disabled = false;
          btn.textContent = "Resend verification email";
        }
      });
    }

    function renderGate(tab = currentTab, err = errorMessage, succ = "") {
      currentTab = tab;
      renderAuthScreen(`
        <div class="auth-gate-container">
          <div class="auth-icon-badge">${tab === "register" ? "⚡" : "🔒"}</div>
          <div class="eyebrow" style="margin-bottom:6px;">${tab === "register" ? "INITIAL SYSTEM SETUP" : "RESTRICTED ACCESS"}</div>
          <h1 style="font-size:22px;margin:0 0 10px;">${tab === "register" ? "One-Time Admin Setup" : "Admin Studio Authentication"}</h1>
          <p style="font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 16px;">
            ${tab === "register"
              ? "Bootstrap the primary administrator account for this platform."
              : "Sign in with your verified administrator credentials."}
          </p>

          <div class="auth-tabs">
            <button class="auth-tab ${tab === "signin" ? "active" : ""}" type="button" id="tabSignIn">
              🔑 Sign In
            </button>
            <button class="auth-tab ${tab === "register" ? "active" : ""}" type="button" id="tabRegister">
              ⚡ One-Time Setup
              <span class="auth-tab-pill ${isLocked ? "locked" : ""}">
                ${isLocked ? "Locked" : "Open"}
              </span>
            </button>
          </div>

          ${err ? `<p id="adminAuthError" role="alert" style="color:var(--red);font-size:11px;margin-bottom:14px;font-weight:600;">${esc(err)}</p>` : `<p id="adminAuthError" role="alert" style="color:var(--red);font-size:11px;"></p>`}
          ${succ ? `<div class="auth-banner success"><span style="font-size:16px;">✓</span><div><strong>Success</strong><p style="margin:2px 0 0;font-size:11px;">${esc(succ)}</p></div></div>` : ""}

          ${tab === "signin" ? `
            <form id="adminAuthForm">
              <div class="auth-field">
                <label for="adminEmailInput">Administrator email</label>
                <input id="adminEmailInput" name="email" type="email" autocomplete="username" required placeholder="admin@example.com">
              </div>
              <div class="auth-field">
                <label for="adminPasswordInput">Password</label>
                <input id="adminPasswordInput" name="password" type="password" autocomplete="current-password" required placeholder="••••••••">
              </div>
              <button class="button primary" type="submit" id="adminSignInBtn" style="width:100%;height:42px;font-size:12px;margin-top:6px;">Unlock Admin Dashboard →</button>
              <button class="button secondary" id="adminForgotPassword" type="button" style="width:100%;margin-top:10px;">Forgot password?</button>
            </form>
            ${!isLocked ? `
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);">
                First time configuring Qalamly? <button type="button" id="linkToRegister" class="text-button" style="font-size:11px;font-weight:700;">Complete One-Time Setup →</button>
              </div>
            ` : ""}
          ` : `
            ${isLocked ? `
              <div class="auth-banner locked">
                <span style="font-size:18px;">🔒</span>
                <div>
                  <strong>Registration Locked</strong>
                  <p style="margin:4px 0 0;font-size:11px;">
                    An administrator has already been registered for this platform. To ensure security, one-time registration is permanently closed.
                  </p>
                </div>
              </div>
              <button class="button primary" type="button" id="backToSignInBtn" style="width:100%;height:42px;font-size:12px;">Go to Administrator Sign In →</button>
            ` : `
              <div class="auth-banner info">
                <span style="font-size:18px;">⚡</span>
                <div>
                  <strong>Primary Administrator Setup</strong>
                  <p style="margin:4px 0 0;font-size:11px;">
                    This one-time registration sets up the master administrator account. Once registered, this form will be permanently locked.
                  </p>
                </div>
              </div>
              <form id="adminRegForm">
                <div class="auth-field">
                  <label for="adminRegName">Full name</label>
                  <input id="adminRegName" name="name" type="text" autocomplete="name" required placeholder="e.g. Imran Ali">
                </div>
                <div class="auth-field">
                  <label for="adminRegEmail">Administrator email</label>
                  <input id="adminRegEmail" name="email" type="email" autocomplete="email" required placeholder="admin@example.com">
                </div>
                <div class="auth-field">
                  <label for="adminRegPassword">Admin password</label>
                  <input id="adminRegPassword" name="password" type="password" autocomplete="new-password" required minlength="8" placeholder="At least 8 characters">
                  <div class="auth-field-hint">Must be at least 8 characters.</div>
                </div>
                <div class="auth-field">
                  <label for="adminRegConfirm">Confirm password</label>
                  <input id="adminRegConfirm" name="confirmPassword" type="password" autocomplete="new-password" required minlength="8" placeholder="Re-enter password">
                </div>
                ${regStatus.hasSetupSecret ? `
                  <div class="auth-field">
                    <label for="adminRegSecret">Setup security key</label>
                    <input id="adminRegSecret" name="secret" type="password" placeholder="Server setup secret key">
                  </div>
                ` : ""}
                <button class="button primary" type="submit" id="adminRegSubmitBtn" style="width:100%;height:42px;font-size:12px;margin-top:6px;">Complete One-Time Registration →</button>
              </form>
              <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);">
                Already registered? <button type="button" id="linkToSignIn" class="text-button" style="font-size:11px;font-weight:700;">Sign in here →</button>
              </div>
            `}
          `}
        </div>
      `);

      // Event bindings
      document.getElementById("tabSignIn")?.addEventListener("click", () => renderGate("signin"));
      document.getElementById("tabRegister")?.addEventListener("click", () => renderGate("register"));
      document.getElementById("linkToRegister")?.addEventListener("click", () => renderGate("register"));
      document.getElementById("linkToSignIn")?.addEventListener("click", () => renderGate("signin"));
      document.getElementById("backToSignInBtn")?.addEventListener("click", () => renderGate("signin"));

      // Sign In Handler
      document.getElementById("adminAuthForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitBtn = document.getElementById("adminSignInBtn");
        const errorEl = document.getElementById("adminAuthError");
        const email = event.currentTarget.elements.email.value.trim().toLowerCase();
        const password = event.currentTarget.elements.password.value;

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Authenticating...";
        }

        try {
          const sb = await getClient();
          if (!sb) throw new Error("Supabase authentication is unavailable.");
          const { data, error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
          const authorized = await isAdminUser(data.user, sb);
          if (!authorized) {
            await sb.auth.signOut();
            throw new Error("This account is not authorized as an administrator.");
          }
          await initAdmin();
        } catch (err) {
          if (err instanceof Error && err.message.toLowerCase().includes("email not confirmed")) {
            if (errorEl) {
              errorEl.innerHTML = `
                <span>Your administrator email address has not been confirmed yet.</span>
                <div style="margin-top:8px;">
                  <button type="button" class="text-button" id="resendAdminLoginLink" data-email="${esc(email)}" style="font-weight:700;">
                    Resend verification email to ${esc(email)} →
                  </button>
                </div>
              `;
              document.getElementById("resendAdminLoginLink")?.addEventListener("click", async () => {
                const btn = document.getElementById("resendAdminLoginLink");
                if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }
                try {
                  const sbClient = await getClient();
                  const basePath = window.location.pathname.includes("/admin-dashboard/")
                    ? window.location.pathname.replace(/admin-dashboard\/[^/]*$/, "")
                    : window.location.pathname.replace(/[^/]*$/, "");
                  const { error: resendErr } = await sbClient.auth.resend({
                    type: "signup",
                    email,
                    options: { emailRedirectTo: `${window.location.origin}${basePath}admin.html` }
                  });
                  if (resendErr) throw resendErr;
                  showToast("Confirmation email resent! Please check your inbox.");
                  if (btn) btn.textContent = "✓ Email sent! Check your inbox.";
                } catch (resendEx) {
                  showToast(resendEx instanceof Error ? resendEx.message : "Could not resend email.", true);
                  if (btn) { btn.disabled = false; btn.textContent = `Resend verification email to ${email} →`; }
                }
              });
            }
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = "Unlock Admin Dashboard →";
            }
            return;
          }
          if (errorEl) errorEl.textContent = err instanceof Error ? err.message : "Could not sign in.";
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Unlock Admin Dashboard →";
          }
        }
      });

      // One-Time Registration Handler
      document.getElementById("adminRegForm")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const submitBtn = document.getElementById("adminRegSubmitBtn");
        const errorEl = document.getElementById("adminAuthError");

        const fullName = form.elements.name.value.trim();
        const email = form.elements.email.value.trim().toLowerCase();
        const password = form.elements.password.value;
        const confirmPassword = form.elements.confirmPassword.value;
        const secret = form.elements.secret?.value.trim() || "";

        if (password !== confirmPassword) {
          if (errorEl) errorEl.textContent = "Passwords do not match.";
          return;
        }
        if (password.length < 8) {
          if (errorEl) errorEl.textContent = "Password must be at least 8 characters.";
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Registering administrator...";
        }

        try {
          // 1. Validate with server if running
          try {
            const valRes = await fetch("/api/admin/register-validate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password, fullName, setupSecret: secret })
            });
            if (!valRes.ok) {
              const errJson = await valRes.json();
              throw new Error(errJson.error || "Server rejected registration.");
            }
          } catch (valErr) {
            if (!valErr.message.includes("Failed to fetch") && !valErr.message.includes("404")) {
              throw valErr;
            }
          }

          // 2. Register user in Supabase auth
          const sb = await getClient();
          if (!sb) throw new Error("Supabase is unavailable.");

          const basePath = window.location.pathname.includes("/admin-dashboard/")
            ? window.location.pathname.replace(/admin-dashboard\/[^/]*$/, "")
            : window.location.pathname.replace(/[^/]*$/, "");
          const redirectUrl = `${window.location.origin}${basePath}admin.html`;

          let authUser = null;
          let { data: authData, error: authError } = await sb.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: redirectUrl,
              data: {
                full_name: fullName,
                role: "admin"
              }
            }
          });

          if (authError && authError.message.toLowerCase().includes("already registered")) {
            const { data: signInData, error: signInError } = await sb.auth.signInWithPassword({ email, password });
            if (signInError) throw signInError;
            authUser = signInData.user;
          } else if (authError) {
            throw authError;
          } else {
            authUser = authData.user;
          }

          if (!authUser) {
            throw new Error("Admin user could not be initialized. Please check confirmation settings.");
          }

          // Check if email confirmation is required
          const requiresConfirmation = !authData?.session || (!authUser.confirmed_at && !authUser.email_confirmed_at);
          if (requiresConfirmation && !authError) {
            renderAdminEmailConfirmation(email, fullName, redirectUrl);
            return;
          }

          // 3. Register in public.admins table (via RPC or direct insert)
          let recorded = false;
          try {
            const { data: rpcRes, error: rpcErr } = await sb.rpc("register_initial_admin", {
              admin_full_name: fullName
            });
            if (!rpcErr) recorded = true;
          } catch (rpcEx) {
            console.warn("RPC register notice:", rpcEx);
          }

          if (!recorded) {
            const { error: insErr } = await sb.from("admins").insert({
              id: authUser.id,
              email: authUser.email,
              full_name: fullName,
              role: "super_admin",
              is_active: true
            });
            if (insErr && !insErr.message.toLowerCase().includes("duplicate")) {
              console.warn("Direct admins insert notice:", insErr);
            }
          }

          showToast("Administrator registered successfully! One-time setup is now locked.");
          await initAdmin();
        } catch (err) {
          if (errorEl) errorEl.textContent = err instanceof Error ? err.message : "Could not complete registration.";
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = "Complete One-Time Registration →";
          }
        }
      });

      // Forgot Password Handler
      document.getElementById("adminForgotPassword")?.addEventListener("click", async () => {
        const email = document.getElementById("adminEmailInput")?.value.trim().toLowerCase() || "";
        const errorEl = document.getElementById("adminAuthError");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          if (errorEl) errorEl.textContent = "Enter your administrator email first.";
          return;
        }
        try {
          const sb = await getClient();
          const basePath = window.location.pathname.includes("/admin-dashboard/")
            ? window.location.pathname.replace(/admin-dashboard\/[^/]*$/, "")
            : window.location.pathname.replace(/[^/]*$/, "");
          const { error } = await sb.auth.resetPasswordForEmail(email, {
            redirectTo: `${window.location.origin}${basePath}login.html`
          });
          if (error) throw error;
          showToast("If that account exists, a password reset link has been sent.");
        } catch (err) {
          if (errorEl) errorEl.textContent = err instanceof Error ? err.message : "Could not send a reset email.";
        }
      });
    }

    renderGate();
  }

  // --- DATABASE HYDRATION ---
  async function fetchAllFromDatabase() {
    state.dbLoading = true;
    updateStatusBadge("Connecting to database...");

    try {
      const sb = await getClient();
      if (!sb) throw new Error("Could not initialize database client.");

      // Fetch all tables in parallel
      const [
        { data: postRows, error: postErr },
        { data: profileRows, error: profErr },
        { data: commentRows, error: commErr },
        { data: likeRows, error: likeErr },
        { data: appRows, error: appErr },
        { data: payoutRows, error: payErr },
        { data: contactRows, error: contactErr },
        { data: compRows, error: compErr },
        { data: subRows, error: subErr },
        { data: adminRows, error: adminErr }
      ] = await Promise.all([
        sb.from("posts").select("*").order("created_at", { ascending: false }),
        sb.from("profiles").select("*").order("created_at", { ascending: false }),
        sb.from("comments").select("*").order("created_at", { ascending: false }),
        sb.from("likes_table").select("*").order("created_at", { ascending: false }),
        sb.from("monetization_applications").select("*").order("submitted_at", { ascending: false }),
        sb.from("payouts").select("*").order("created_at", { ascending: false }),
        sb.from("contact").select("*").order("created_at", { ascending: false }),
        sb.from("competitions").select("*").order("created_at", { ascending: false }),
        sb.from("competition_submissions").select("*").order("submitted_at", { ascending: false }),
        sb.from("admins").select("*").order("created_at", { ascending: false })
      ]);

      if (adminErr) console.warn("Admins fetch notice:", adminErr);
      state.admins = Array.isArray(adminRows) ? adminRows : [];

      if (postErr) console.warn("Posts fetch error:", postErr);
      if (profErr) console.warn("Profiles fetch error:", profErr);

      // Map Posts
      const likesByPost = new Map();
      if (Array.isArray(likeRows)) {
        likeRows.forEach(l => {
          if (l.post_id) likesByPost.set(l.post_id, (likesByPost.get(l.post_id) || 0) + 1);
        });
      }
      const commentsByPost = new Map();
      if (Array.isArray(commentRows)) {
        commentRows.forEach(c => {
          if (c.post_id) commentsByPost.set(c.post_id, (commentsByPost.get(c.post_id) || 0) + 1);
        });
      }

      state.posts = Array.isArray(postRows) ? postRows.map(p => ({
        id: p.id,
        title: p.title || "Untitled Story",
        excerpt: (p.content || "").slice(0, 160) + ((p.content || "").length > 160 ? "..." : ""),
        body: p.content || "",
        author: p.author_name || "Writer",
        handle: `@${(p.author_name || "writer").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
        date: p.created_at ? p.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
        status: p.status || "published",
        topic: p.category || "General",
        language: p.language || "English",
        likes: likesByPost.get(p.id) || 0,
        comments: commentsByPost.get(p.id) || 0,
        userId: p.user_id
      })) : [];

      // Map Profiles / Users
      state.users = Array.isArray(profileRows) ? profileRows.map(u => ({
        id: u.id,
        name: u.full_name || "Writer",
        handle: u.username ? `@${u.username}` : `@writer-${u.id.slice(0, 6)}`,
        peoticName: u.peotic_name || u.full_name,
        email: u.email || "No email",
        joined: u.created_at ? u.created_at.slice(0, 10) : "2026-10-15",
        posts: u.stories_count || state.posts.filter(p => p.userId === u.id).length,
        followers: u.followers_count || 0,
        role: u.role || "both",
        status: "Active",
        bio: u.bio || "Writer and reader on Qalamly."
      })) : [];

      // Map Comments
      state.comments = Array.isArray(commentRows) ? commentRows.map(c => {
        const post = state.posts.find(p => p.id === c.post_id);
        return {
          id: String(c.id),
          author: c.author_name || "Reader",
          handle: `@${(c.author_name || "reader").toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
          text: c.content || "",
          postId: c.post_id,
          postTitle: post ? post.title : "Community Story",
          date: c.created_at ? c.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
          status: "Visible"
        };
      }) : [];

      // Map Likes
      state.likes = Array.isArray(likeRows) ? likeRows.map(l => {
        const post = state.posts.find(p => p.id === l.post_id);
        const user = state.users.find(u => u.id === l.user_id);
        return {
          id: l.id,
          user: user ? user.name : "Reader",
          handle: user ? user.handle : "@reader",
          postId: l.post_id,
          postTitle: post ? post.title : "Story",
          date: l.created_at ? l.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
        };
      }) : [];

      // Map Applications
      state.applications = Array.isArray(appRows) ? appRows.map(a => ({
        id: a.id,
        name: a.name,
        handle: a.handle,
        email: a.email,
        profileUrl: a.profile_url,
        note: a.note || "",
        status: a.status || "Pending",
        reviewNote: a.review_note || "",
        submittedAt: a.submitted_at || new Date().toISOString(),
        reviewedAt: a.reviewed_at,
        userId: a.user_id
      })) : [];

      // Map Payouts
      state.payouts = Array.isArray(payoutRows) ? payoutRows.map(p => ({
        id: p.id,
        creator: p.creator,
        handle: p.handle,
        email: p.email,
        period: p.period,
        amount: Number(p.amount) || 0,
        status: p.status || "Pending",
        createdAt: p.created_at,
        paidAt: p.paid_at
      })) : [];

      // Map Messages (from contact table)
      state.messages = Array.isArray(contactRows) ? contactRows.map(m => ({
        id: m.id,
        name: m.name || "Inquirer",
        email: m.email,
        subject: m.subject || "Inquiry",
        status: "Unread",
        date: m.created_at ? m.created_at.slice(0, 10) : "Today",
        messages: [{ from: "user", text: m.message, time: m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Today" }]
      })) : [];

      // Map Competitions
      state.competitions = Array.isArray(compRows) ? compRows.map(c => ({
        id: c.id,
        title: c.title || "Writing Challenge",
        kicker: c.kicker || "Writing Prompt",
        category: c.category || "Short Story",
        description: c.description || "",
        guidelines: c.guidelines || "",
        prize: c.prize || "Editorial Spotlight",
        deadline: c.deadline ? c.deadline.slice(0, 10) : "Open",
        deadlineRaw: c.deadline,
        status: c.status || "Active",
        createdAt: c.created_at
      })) : [];

      syncCompetitionsToStorage(state.competitions);

      // Map Submissions
      state.submissions = Array.isArray(subRows) ? subRows.map(s => ({
        id: s.id,
        competitionId: s.competition_id,
        competitionTitle: s.competition_title || "General Competition",
        userId: s.user_id,
        authorName: s.author_name || "Writer",
        authorEmail: s.author_email || "",
        authorHandle: s.author_handle || "@writer",
        storyTitle: s.story_title || "Untitled Entry",
        storyExcerpt: s.story_excerpt || "",
        fileUrl: s.file_url || "",
        fileName: s.file_name || "",
        fileSize: s.file_size || "",
        status: s.status || "Submitted",
        reviewNotes: s.review_notes || "",
        submittedAt: s.submitted_at || new Date().toISOString()
      })) : [];

      state.isLiveDb = true;
      state.dbLoading = false;
      updateStatusBadge("Connected to Database: Supabase (Live)");

      // Update counters in nav
      updateNavCounters();
      render();
    } catch (err) {
      console.error("Database fetch failed, falling back to cached state:", err);
      state.isLiveDb = false;
      state.dbLoading = false;
      updateStatusBadge("Offline Cache Mode · Database Unreachable", true);
      render();
    }
  }

  function updateStatusBadge(text, isError = false) {
    const badge = document.getElementById("dbStatusIndicator");
    if (badge) {
      badge.textContent = text;
      badge.className = isError ? "local-note error" : "local-note connected";
    }
  }

  function updateNavCounters() {
    const pendingPosts = state.posts.filter(p => p.status === "Pending" || p.status === "draft").length;
    const pendingApps = state.applications.filter(a => a.status === "Pending").length;
    const unreadMsgs = state.messages.filter(m => m.status === "Unread").length;
    const activeComps = state.competitions.filter(c => c.status === "Active").length;
    const pendingSubs = state.submissions.filter(s => s.status === "Submitted").length;

    const elP = document.getElementById("pendingNavCount");
    const elA = document.getElementById("applicationsNavCount");
    const elM = document.getElementById("unreadNavCount");
    const elC = document.getElementById("competitionsNavCount");
    const elS = document.getElementById("submissionsNavCount");

    if (elP) elP.textContent = String(pendingPosts);
    if (elA) elA.textContent = String(pendingApps);
    if (elM) elM.textContent = String(unreadMsgs);
    if (elC) elC.textContent = String(activeComps);
    if (elS) elS.textContent = String(pendingSubs);
  }

  function showToast(message, error = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", error);
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function initials(name) {
    return String(name || "AD").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
  }

  function badge(status) {
    const s = String(status || "default").toLowerCase();
    return `<span class="badge ${esc(s)}">${esc(status)}</span>`;
  }

  function person(name, handle, avatar = true) {
    return `<div class="person-cell">${avatar ? `<span class="person-avatar">${esc(initials(name))}</span>` : ""}<span><span class="person-name">${esc(name)}</span><span class="person-handle">${esc(handle)}</span></span></div>`;
  }

  function pageHeader(eyebrow, title, description, actions = "") {
    return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;
  }

  function matchSearch(...values) {
    if (!state.search) return true;
    const needle = state.search.toLowerCase();
    return values.some(val => String(val || "").toLowerCase().includes(needle));
  }

  function table(headers, rows, emptyMessage = "No matching records found.") {
    return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="table-empty">${esc(emptyMessage)}</td></tr>`}</tbody></table></div>`;
  }

  // --- RENDER VIEWS ---
  function renderOverview() {
    const totalPosts = state.posts.length;
    const totalUsers = state.users.length;
    const totalApps = state.applications.length;
    const pendingApps = state.applications.filter(a => a.status === "Pending").length;
    const totalPayouts = state.payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

    return `
      ${pageHeader("SYSTEM DASHBOARD", "Database & Community Overview", "Real-time records from your Supabase Postgres database.", `<button class="button primary" data-action="sync-db">↻ Sync from Database</button>`)}
      <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr));">
        <article class="stat-card">
          <div class="stat-top">Posts in Database<span class="stat-icon">▤</span></div>
          <div class="stat-value">${totalPosts}</div>
          <div class="stat-foot">${state.posts.filter(p => p.status === "published").length} published stories</div>
        </article>
        <article class="stat-card">
          <div class="stat-top">Registered Members<span class="stat-icon green">♙</span></div>
          <div class="stat-value">${totalUsers}</div>
          <div class="stat-foot">${state.users.filter(u => u.role === "writer" || u.role === "both").length} active writers</div>
        </article>
        <article class="stat-card">
          <div class="stat-top">Creator Applications<span class="stat-icon amber">✎</span></div>
          <div class="stat-value">${totalApps}</div>
          <div class="stat-foot"><strong>${pendingApps}</strong> awaiting your review</div>
        </article>
        <article class="stat-card">
          <div class="stat-top">Competition Submissions<span class="stat-icon purple" style="background:#f2f0fc;color:var(--purple);">🏆</span></div>
          <div class="stat-value">${state.submissions.length}</div>
          <div class="stat-foot"><strong>${state.submissions.filter(s => s.status === "Submitted").length}</strong> pending files to review</div>
        </article>
      </div>

      <div class="overview-grid">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Recent Database Activity</h2>
              <p>Latest stories published to Qalamly.</p>
            </div>
            <button class="text-button" data-view="posts">View all posts →</button>
          </div>
          <div style="padding:14px 16px;">
            ${state.posts.slice(0, 5).map(p => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f2f2f7;">
                <div>
                  <strong>${esc(p.title)}</strong>
                  <div style="font-size:10px;color:var(--muted);">${esc(p.author)} · ${esc(p.topic)} · ${esc(p.date)}</div>
                </div>
                <div>${badge(p.status)}</div>
              </div>
            `).join("") || `<p class="table-note">No posts in the database yet.</p>`}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <h2>Recent Competition Entries &amp; Files</h2>
              <p>Files received for active challenges.</p>
            </div>
            <button class="text-button" data-view="submissions">View all submissions →</button>
          </div>
          <div style="padding:14px 16px;">
            ${state.submissions.slice(0, 4).map(s => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f2f2f7;">
                <div style="min-width:0;flex:1;padding-right:10px;">
                  <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(s.storyTitle)}</strong>
                  <div style="font-size:10px;color:var(--muted);">${esc(s.authorName)} · ${esc(s.competitionTitle)}</div>
                  ${s.fileName ? `<span class="file-attachment-badge" style="margin-top:4px;padding:2px 7px;font-size:9.5px;">📄 ${esc(s.fileName)}</span>` : ""}
                </div>
                <div>${badge(s.status)}</div>
              </div>
            `).join("") || `<p class="table-note">No competition entries yet. Publish a prompt to receive files!</p>`}
          </div>
        </section>
      </div>
    `;
  }

  function renderPosts() {
    const posts = state.posts.filter(p =>
      (state.postFilter === "All" || p.status.toLowerCase() === state.postFilter.toLowerCase()) &&
      matchSearch(p.title, p.author, p.handle, p.topic, p.id, p.language)
    );

    const rows = posts.map(p => `
      <tr>
        <td><span class="record-title">${esc(p.title)}</span><span class="record-sub">ID: ${esc(p.id)} · ${esc(p.language)}</span></td>
        <td>${person(p.author, p.handle)}</td>
        <td>${esc(p.topic)}</td>
        <td>${badge(p.status)}</td>
        <td>♥ ${p.likes} · 💬 ${p.comments}</td>
        <td>
          <div class="table-actions">
            <button class="row-action" data-action="edit-post" data-id="${esc(p.id)}">Edit</button>
            ${p.status !== "published" ? `<button class="row-action good" data-action="publish-post" data-id="${esc(p.id)}">Publish</button>` : `<button class="row-action" data-action="draft-post" data-id="${esc(p.id)}">Draft</button>`}
            <button class="row-action danger" data-action="delete-post" data-id="${esc(p.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    const actions = `
      <button class="button secondary" data-action="add-post">+ New Post</button>
      <button class="button secondary" data-action="export-posts">Export CSV</button>
      <button class="button primary" data-action="sync-db">↻ Sync</button>
    `;

    return `
      ${pageHeader("DATABASE RECORDS", "Post Management", "View, edit, toggle status, and delete posts directly from the Supabase database.", actions)}
      <div class="filters">
        <select class="filter-select" id="postFilter" aria-label="Filter posts by status">
          ${["All", "Published", "Draft", "Pending", "Rejected"].map(item => `<option${state.postFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${posts.length} posts found</span>
      </div>
      ${table(["TITLE", "AUTHOR", "TOPIC", "STATUS", "ENGAGEMENT", "ACTIONS"], rows, "No posts match your search or filter.")}
    `;
  }

  function renderUsers() {
    const users = state.users.filter(u =>
      (state.userFilter === "All" || u.role.toLowerCase() === state.userFilter.toLowerCase()) &&
      matchSearch(u.name, u.handle, u.email, u.bio, u.id)
    );

    const rows = users.map(u => `
      <tr>
        <td>${person(u.name, u.handle)}</td>
        <td><span class="record-title">${esc(u.email)}</span><span class="record-sub">ID: ${esc(u.id)}</span></td>
        <td>${esc(u.role)}</td>
        <td>${u.posts} stories · ${u.followers} followers</td>
        <td>${badge(u.status)}</td>
        <td>
          <div class="table-actions">
            <button class="row-action" data-action="edit-user" data-id="${esc(u.id)}">Edit</button>
            <button class="row-action danger" data-action="delete-user" data-id="${esc(u.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    return `
      ${pageHeader("MEMBERS", "User Directory", "Manage registered profiles and authors in the Supabase database.")}
      <div class="filters">
        <select class="filter-select" id="userFilter" aria-label="Filter users by role">
          ${["All", "Writer", "Reader", "Both", "Admin"].map(item => `<option${state.userFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${users.length} members</span>
      </div>
      ${table(["PROFILE", "CONTACT", "ROLE", "ACTIVITY", "STATUS", "ACTIONS"], rows, "No user records match your search.")}
    `;
  }

  function renderComments() {
    const comments = state.comments.filter(c => matchSearch(c.author, c.text, c.postTitle, c.id));
    const rows = comments.map(c => `
      <tr>
        <td><span class="record-title">${esc(c.postTitle)}</span><span class="record-sub">Comment ID: ${esc(c.id)}</span></td>
        <td>${person(c.author, c.handle)}</td>
        <td><p style="margin:0;max-width:380px;font-size:11px;">${esc(c.text)}</p></td>
        <td>${esc(c.date)}</td>
        <td>
          <div class="table-actions">
            <button class="row-action" data-action="edit-comment" data-id="${esc(c.id)}">Edit</button>
            <button class="row-action danger" data-action="delete-comment" data-id="${esc(c.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    return `
      ${pageHeader("MODERATION", "Comment Moderation", "Review and moderate reader comments stored in the comments table.")}
      <div class="filters">
        <span class="result-count">${comments.length} comments</span>
      </div>
      ${table(["STORY", "AUTHOR", "COMMENT CONTENT", "DATE", "ACTIONS"], rows, "No comments found.")}
    `;
  }

  function renderLikes() {
    const likes = state.likes.filter(l => matchSearch(l.user, l.postTitle, l.id, l.postId));
    const rows = likes.map(l => `
      <tr>
        <td><span class="record-title">${esc(l.postTitle)}</span><span class="record-sub">Post ID: ${esc(l.postId)}</span></td>
        <td>${person(l.user, l.handle)}</td>
        <td>${esc(l.date)}</td>
        <td>
          <button class="row-action danger" data-action="delete-like" data-id="${esc(l.id)}">Remove Like</button>
        </td>
      </tr>
    `).join("");

    return `
      ${pageHeader("ENGAGEMENT", "Likes Activity", "Inspect reactions recorded in the likes_table.")}
      <div class="filters"><span class="result-count">${likes.length} total likes</span></div>
      ${table(["STORY", "USER", "DATE", "ACTION"], rows, "No likes found.")}
    `;
  }

  function renderApplications() {
    const applications = state.applications.filter(a =>
      (state.applicationFilter === "All" || a.status.toLowerCase() === state.applicationFilter.toLowerCase()) &&
      matchSearch(a.name, a.handle, a.email, a.id, a.note)
    );

    const rows = applications.map(a => {
      const actions = a.status === "Pending"
        ? `
          <button class="row-action" data-action="review-application" data-id="${esc(a.id)}">Review</button>
          <button class="row-action good" data-action="approve-application" data-id="${esc(a.id)}">Approve</button>
          <button class="row-action danger" data-action="reject-application" data-id="${esc(a.id)}">Reject</button>
          <button class="row-action danger" data-action="delete-application" data-id="${esc(a.id)}">Delete</button>
        `
        : `
          <button class="row-action" data-action="review-application" data-id="${esc(a.id)}">View</button>
          <button class="row-action danger" data-action="delete-application" data-id="${esc(a.id)}">Delete</button>
        `;

      const submittedDate = a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "Recently";
      return `
        <tr>
          <td><span class="record-title">${esc(a.id)}</span><span class="record-sub">Submitted: ${esc(submittedDate)}</span></td>
          <td>${person(a.name, a.handle)}</td>
          <td><span class="record-title">${esc(a.email)}</span><span class="record-sub">${esc(a.note)}</span></td>
          <td>${badge(a.status)}</td>
          <td><div class="table-actions">${actions}</div></td>
        </tr>
      `;
    }).join("");

    const actions = `<a class="button secondary" href="../apply.html" target="_blank">Open Creator Apply Page ↗</a>`;

    return `
      ${pageHeader("CREATOR PROGRAM", "Monetization Applications", "Applications submitted from the Creator Program page are saved in public.monetization_applications for your review.", actions)}
      <div class="filters">
        <select class="filter-select" id="applicationFilter" aria-label="Filter applications by status">
          ${["All", "Pending", "Approved", "Rejected"].map(item => `<option${state.applicationFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${state.applications.filter(a => a.status === "Pending").length} awaiting review · ${applications.length} shown</span>
      </div>
      ${table(["APPLICATION ID", "CREATOR", "EMAIL & NOTE", "STATUS", "ACTIONS"], rows, "No applications yet.")}
    `;
  }

  function renderMonetization() {
    const payouts = state.payouts.filter(p =>
      (state.payoutFilter === "All" || p.status.toLowerCase() === state.payoutFilter.toLowerCase()) &&
      matchSearch(p.creator, p.handle, p.id, p.period)
    );

    const pendingTotal = state.payouts.filter(p => p.status === "Pending").reduce((t, p) => t + Number(p.amount), 0);
    const paidTotal = state.payouts.filter(p => p.status === "Paid").reduce((t, p) => t + Number(p.amount), 0);

    const rows = payouts.map(p => `
      <tr>
        <td><span class="record-title">${esc(p.id)}</span><span class="record-sub">${esc(p.period)}</span></td>
        <td>${person(p.creator, p.handle)}</td>
        <td><strong>${formatMoney(p.amount)}</strong></td>
        <td>${badge(p.status)}</td>
        <td>
          <div class="table-actions">
            ${p.status === "Pending" ? `<button class="row-action good" data-action="approve-payout" data-id="${esc(p.id)}">Mark Paid</button>` : ""}
            ${p.status === "Pending" ? `<button class="row-action danger" data-action="reject-payout" data-id="${esc(p.id)}">Reject</button>` : ""}
            <button class="row-action danger" data-action="delete-payout" data-id="${esc(p.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    const actions = `<button class="button primary" data-action="add-payout">+ Record Payout</button>`;

    return `
      ${pageHeader("CREATOR ECONOMY", "Monetization & Payouts", "Track earnings, record payouts, and mark requests paid in the payouts table.", actions)}
      <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-bottom:18px;">
        <article class="stat-card">
          <div class="stat-top">Pending Payouts<span class="stat-icon amber">◈</span></div>
          <div class="stat-value">${formatMoney(pendingTotal)}</div>
          <div class="stat-foot">${state.payouts.filter(p => p.status === "Pending").length} pending requests</div>
        </article>
        <article class="stat-card">
          <div class="stat-top">Completed Payouts<span class="stat-icon green">✓</span></div>
          <div class="stat-value">${formatMoney(paidTotal)}</div>
          <div class="stat-foot">${state.payouts.filter(p => p.status === "Paid").length} completed transfers</div>
        </article>
      </div>
      <div class="filters">
        <select class="filter-select" id="payoutFilter" aria-label="Filter payouts">
          ${["All", "Pending", "Paid", "Rejected"].map(item => `<option${state.payoutFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${payouts.length} records</span>
      </div>
      ${table(["PAYOUT ID", "CREATOR", "AMOUNT", "STATUS", "ACTIONS"], rows, "No payout records found.")}
    `;
  }

  function renderMessages() {
    const messages = state.messages.filter(m => matchSearch(m.name, m.email, m.subject, ...m.messages.map(i => i.text)));
    if (!messages.some(m => m.id === state.selectedMessage)) state.selectedMessage = messages[0]?.id || null;
    const selected = messages.find(m => m.id === state.selectedMessage);

    const list = messages.map(m => `
      <button class="conversation${m.id === state.selectedMessage ? " selected" : ""}" data-action="select-message" data-id="${esc(m.id)}">
        <span class="person-avatar">${esc(initials(m.name))}</span>
        <span class="conversation-copy">
          <span class="conversation-top"><strong>${esc(m.name)}</strong><time>${esc(m.date)}</time></span>
          <span class="conversation-preview">${esc(m.subject)}</span>
        </span>
      </button>
    `).join("");

    const thread = selected ? `
      <div class="thread-head">
        ${person(selected.name, selected.email)}
        <div class="table-actions">
          <button class="row-action danger" data-action="delete-message" data-id="${esc(selected.id)}">Delete Inqury</button>
        </div>
      </div>
      <div class="thread-messages">
        <div style="padding:14px;background:#f9f9fc;border-radius:10px;margin-bottom:12px;">
          <strong style="display:block;margin-bottom:4px;font-size:12px;">Subject: ${esc(selected.subject)}</strong>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#444658;">${esc(selected.messages[0]?.text)}</p>
        </div>
      </div>
      <form class="reply-form" id="replyForm" data-id="${esc(selected.id)}">
        <input id="replyInput" name="reply" maxlength="1000" placeholder="Type a response to this inquiry..." required>
        <button class="button primary" type="submit">Send Reply</button>
      </form>
    ` : `<div class="empty-state"><strong>No messages</strong>Select a conversation or check back later.</div>`;

    return `
      ${pageHeader("INBOX", "Community Inquiries", "Messages submitted through the contact page stored in public.contact table.")}
      <div class="message-layout">
        <section class="inbox-list">
          <div class="inbox-head"><h2>Inbox</h2><span class="result-count">${messages.length} inquiries</span></div>
          ${list || `<div class="empty-state">No inquiries found.</div>`}
        </section>
        <section class="thread">${thread}</section>
      </div>
    `;
  }

  function renderCompetitions() {
    const competitions = state.competitions.filter(c =>
      (state.competitionFilter === "All" || c.status.toLowerCase() === state.competitionFilter.toLowerCase()) &&
      matchSearch(c.title, c.category, c.description, c.kicker, c.prize)
    );

    const rows = competitions.map(c => {
      const subsCount = state.submissions.filter(s => s.competitionId === c.id || s.competitionTitle === c.title).length;
      const statusAction = c.status === "Active"
        ? `<button class="row-action danger" data-action="toggle-competition-status" data-id="${esc(c.id)}" data-next="Closed">Close Topic</button>`
        : `<button class="row-action good" data-action="toggle-competition-status" data-id="${esc(c.id)}" data-next="Active">Activate</button>`;

      return `
        <tr>
          <td>
            <span class="record-title">${esc(c.title)}</span>
            <span class="record-sub">${esc(c.kicker)}</span>
            <p style="margin:4px 0 0;font-size:11px;color:#555770;max-width:320px;line-height:1.4;">${esc(c.description.slice(0, 110))}${c.description.length > 110 ? "..." : ""}</p>
          </td>
          <td><span class="badge" style="background:#f2f0fc;color:var(--purple);">${esc(c.category)}</span></td>
          <td><strong>${esc(c.deadline)}</strong></td>
          <td>
            <span class="record-title" style="color:#bd8424;">🏆 ${esc(c.prize)}</span>
            <span class="record-sub">${esc(c.guidelines ? c.guidelines.slice(0, 60) + "..." : "Standard guidelines")}</span>
          </td>
          <td><strong>${subsCount}</strong> entries</td>
          <td>${badge(c.status)}</td>
          <td>
            <div class="table-actions">
              <button class="row-action" data-action="edit-competition" data-id="${esc(c.id)}">Edit</button>
              ${statusAction}
              <button class="row-action danger" data-action="delete-competition" data-id="${esc(c.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const actions = `
      <button class="button primary" data-action="add-competition">+ Create Competition Topic</button>
      <a class="button secondary" href="../competitions.html" target="_blank">View Live Competition Page ↗</a>
    `;

    return `
      ${pageHeader("CREATIVE WRITING", "Competition Topics", "Create, edit, and publish monthly prompts and challenges displayed directly on the website competition page.", actions)}
      <div class="filters">
        <select class="filter-select" id="competitionFilter" aria-label="Filter competitions by status">
          ${["All", "Active", "Upcoming", "Closed"].map(item => `<option${state.competitionFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${competitions.length} topics shown · ${state.competitions.filter(c => c.status === "Active").length} active</span>
      </div>
      ${table(["TOPIC / PROMPT", "CATEGORY", "DEADLINE", "PRIZE & RULES", "SUBMISSIONS", "STATUS", "ACTIONS"], rows, "No competition topics yet. Click '+ Create Competition Topic' to publish one!")}
    `;
  }

  function renderSubmissions() {
    const submissions = state.submissions.filter(s =>
      (state.submissionFilter === "All" || s.status.toLowerCase() === state.submissionFilter.toLowerCase()) &&
      matchSearch(s.authorName, s.authorEmail, s.storyTitle, s.competitionTitle, s.authorHandle, s.storyExcerpt)
    );

    const rows = submissions.map(s => {
      const submittedDate = s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "Recently";

      const fileCell = s.fileUrl ? `
        <div>
          <div class="file-attachment-badge" title="${esc(s.fileName)}">
            <span>📄</span>
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;">${esc(s.fileName || "Entry Document")}</span>
            <span class="file-size">${esc(s.fileSize || "")}</span>
          </div>
          <div style="margin-top:5px;">
            <a class="download-file-btn" href="${esc(s.fileUrl)}" download="${esc(s.fileName || 'entry_document')}" target="_blank">⬇ Download File</a>
          </div>
        </div>
      ` : `<span style="color:var(--muted);font-size:11px;">Inline text only</span>`;

      return `
        <tr>
          <td>
            <span class="record-title">${esc(s.storyTitle)}</span>
            <span class="record-sub">Submitted: ${esc(submittedDate)} · ID: ${esc(s.id.slice(0, 8))}</span>
            ${s.storyExcerpt ? `<p style="margin:4px 0 0;font-size:11px;color:#555770;max-width:280px;line-height:1.4;">"${esc(s.storyExcerpt.slice(0, 100))}${s.storyExcerpt.length > 100 ? "..." : ""}"</p>` : ""}
          </td>
          <td>
            ${person(s.authorName, s.authorHandle || s.authorEmail)}
            <span class="record-sub">${esc(s.authorEmail)}</span>
          </td>
          <td><span class="badge" style="background:#eef1fb;color:#35447a;">${esc(s.competitionTitle)}</span></td>
          <td>${fileCell}</td>
          <td>${badge(s.status)}</td>
          <td>
            <div class="table-actions">
              <button class="row-action" data-action="review-submission" data-id="${esc(s.id)}">Details</button>
              <button class="row-action good" data-action="shortlist-submission" data-id="${esc(s.id)}">Shortlist</button>
              <button class="row-action danger" data-action="delete-submission" data-id="${esc(s.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const actions = `
      <a class="button secondary" href="../competitions.html" target="_blank">Open Submission Portal ↗</a>
    `;

    return `
      ${pageHeader("SUBMISSIONS INBOX", "Competition Submissions & Files", "Review stories and download documents submitted by writers from the competitions page in public.competition_submissions.", actions)}
      <div class="filters">
        <select class="filter-select" id="submissionFilter" aria-label="Filter submissions by status">
          ${["All", "Submitted", "Shortlisted", "Winner", "Reviewed"].map(item => `<option${state.submissionFilter.toLowerCase() === item.toLowerCase() ? " selected" : ""}>${item}</option>`).join("")}
        </select>
        <span class="filter-spacer"></span>
        <span class="result-count">${submissions.length} submissions · ${state.submissions.filter(s => s.status === "Submitted").length} pending review</span>
      </div>
      ${table(["STORY ENTRY", "PARTICIPANT", "COMPETITION", "ATTACHED FILE", "STATUS", "ACTIONS"], rows, "No submissions received yet.")}
    `;
  }

  function renderDatabaseConsole() {
    const tableCounts = {
      posts: state.posts.length,
      profiles: state.users.length,
      comments: state.comments.length,
      likes_table: state.likes.length,
      monetization_applications: state.applications.length,
      competitions: state.competitions.length,
      competition_submissions: state.submissions.length,
      payouts: state.payouts.length,
      contact: state.messages.length,
      admins: state.admins.length
    };

    const targetData = {
      posts: state.posts,
      profiles: state.users,
      comments: state.comments,
      likes_table: state.likes,
      monetization_applications: state.applications,
      competitions: state.competitions,
      competition_submissions: state.submissions,
      payouts: state.payouts,
      contact: state.messages,
      admins: state.admins
    }[state.dbTable] || [];

    const jsonPreview = JSON.stringify(targetData, null, 2);

    return `
      ${pageHeader("DATABASE CONSOLE", "Direct Table Explorer", "Inspect live Supabase Postgres schema and raw table rows.", `<button class="button primary" data-action="sync-db">↻ Refresh Database</button>`)}
      
      <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
        ${Object.keys(tableCounts).map(t => `
          <button class="button ${state.dbTable === t ? "primary" : "secondary"}" data-action="switch-db-table" data-id="${esc(t)}">
            ${esc(t)} (${tableCounts[t]})
          </button>
        `).join("")}
      </div>

      <section class="panel" style="padding:18px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <strong>Table: <code>public.${esc(state.dbTable)}</code> (${targetData.length} rows)</strong>
          <span class="badge" style="background:#e8f7f0;color:#27966a;">● Supabase Cloud Active</span>
        </div>
        <pre style="background:#1e1e2f;color:#d4d4e2;padding:16px;border-radius:10px;font-size:11px;max-height:480px;overflow:auto;line-height:1.5;">${esc(jsonPreview)}</pre>
      </section>
    `;
  }

  function renderSecurity() {
    return `
      ${pageHeader("ADMIN SECURITY", "Password & two-factor authentication", "Manage credentials for the signed-in administrator account.")}
      <section class="panel" style="max-width:720px;padding:22px;margin-bottom:16px;">
        <h2 style="margin:0 0 6px;font-size:16px;">Change password</h2>
        <p class="table-note">Set a new password for ${esc(adminUser?.email || "your administrator account")}.</p>
        <form id="adminChangePasswordForm">
          <div class="field"><label for="adminNewPassword">New password</label><input id="adminNewPassword" name="password" type="password" autocomplete="new-password" minlength="8" required></div>
          <div class="field"><label for="adminConfirmPassword">Confirm new password</label><input id="adminConfirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required></div>
          <button class="button primary" type="submit">Change password</button>
          <p id="adminSecurityError" role="alert" style="color:var(--red);font-size:11px;"></p>
        </form>
      </section>
      <section class="panel" style="max-width:720px;padding:22px;">
        <h2 style="margin:0 0 6px;font-size:16px;">Two-factor authentication</h2>
        <p class="table-note">Use a TOTP authenticator app to add a second sign-in step.</p>
        <p id="adminTotpStatus" role="status" class="table-note">Checking authenticator status…</p>
        <div id="adminTotpControls"></div>
      </section>
    `;
  }

  async function loadAdminSecurityStatus() {
    const status = document.getElementById("adminTotpStatus");
    const controls = document.getElementById("adminTotpControls");
    if (!status || !controls) return;
    try {
      const sb = await getClient();
      if (!sb) throw new Error("Supabase authentication is unavailable.");
      const { data, error } = await sb.auth.mfa.listFactors();
      if (error) throw error;
      const verified = (data?.totp || []).filter((factor) => factor.status === "verified");
      status.textContent = verified.length
        ? "Two-factor authentication is enabled for this administrator account."
        : "Two-factor authentication is not enabled.";
      controls.innerHTML = verified.length
        ? verified.map((factor) => `<button class="button danger" type="button" data-disable-admin-totp="${esc(factor.id)}">Turn off authenticator</button>`).join("")
        : `<button class="button secondary" type="button" data-enable-admin-totp>Set up authenticator</button>`;
    } catch (err) {
      status.textContent = err instanceof Error ? `Could not check 2FA status: ${err.message}` : "Could not check 2FA status.";
    }
  }

  function render() {
    const pageName = document.getElementById("pageName");
    if (pageName) pageName.textContent = headings[state.view]?.[0] || "Overview";

    // Set active nav
    document.querySelectorAll(".nav-item").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.view === state.view);
    });

    switch (state.view) {
      case "overview": content.innerHTML = renderOverview(); break;
      case "posts": content.innerHTML = renderPosts(); break;
      case "users": content.innerHTML = renderUsers(); break;
      case "comments": content.innerHTML = renderComments(); break;
      case "likes": content.innerHTML = renderLikes(); break;
      case "applications": content.innerHTML = renderApplications(); break;
      case "competitions": content.innerHTML = renderCompetitions(); break;
      case "submissions": content.innerHTML = renderSubmissions(); break;
      case "monetization": content.innerHTML = renderMonetization(); break;
      case "messages": content.innerHTML = renderMessages(); break;
      case "security": content.innerHTML = renderSecurity(); loadAdminSecurityStatus(); break;
      case "database": content.innerHTML = renderDatabaseConsole(); break;
      default: content.innerHTML = renderOverview();
    }
  }

  // --- CRUD MODALS & DATABASE OPERATIONS ---
  function openEditor(type, record) {
    editing = { type, id: record.id };
    dialogActions.innerHTML = `<button class="button secondary" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">Save to Database</button>`;
    const field = (label, key, value, multiline = false) => `
      <div class="field">
        <label for="field-${esc(key)}">${esc(label)}</label>
        ${multiline ? `<textarea id="field-${esc(key)}" name="${esc(key)}" rows="4">${esc(value)}</textarea>` : `<input id="field-${esc(key)}" name="${esc(key)}" value="${esc(value)}" required>`}
      </div>
    `;

    if (type === "post") {
      document.getElementById("dialogTitle").textContent = "Edit Post (Supabase)";
      dialogFields.innerHTML = `
        ${field("Story Title", "title", record.title)}
        ${field("Author Name", "author", record.author)}
        ${field("Category / Topic", "topic", record.topic)}
        ${field("Language", "language", record.language || "English")}
        <div class="field">
          <label for="field-status">Status</label>
          <select id="field-status" name="status">
            <option value="published" ${record.status === "published" ? "selected" : ""}>Published</option>
            <option value="draft" ${record.status === "draft" ? "selected" : ""}>Draft</option>
            <option value="Pending" ${record.status === "Pending" ? "selected" : ""}>Pending</option>
            <option value="Rejected" ${record.status === "Rejected" ? "selected" : ""}>Rejected</option>
          </select>
        </div>
        ${field("Story Content", "body", record.body || record.excerpt, true)}
      `;
    } else if (type === "user") {
      document.getElementById("dialogTitle").textContent = "Edit Member Profile (Supabase)";
      dialogFields.innerHTML = `
        ${field("Full Name", "name", record.name)}
        ${field("Username", "handle", (record.handle || "").replace(/^@/, ""))}
        ${field("Pen / Poetic Name", "peoticName", record.peoticName || record.name)}
        ${field("Email Address", "email", record.email)}
        <div class="field">
          <label for="field-role">Role</label>
          <select id="field-role" name="role">
            <option value="reader" ${record.role === "reader" ? "selected" : ""}>Reader</option>
            <option value="writer" ${record.role === "writer" ? "selected" : ""}>Writer</option>
            <option value="both" ${record.role === "both" ? "selected" : ""}>Both (Reader & Writer)</option>
            <option value="admin" ${record.role === "admin" ? "selected" : ""}>Admin</option>
          </select>
        </div>
        ${field("Bio", "bio", record.bio, true)}
      `;
    } else if (type === "comment") {
      document.getElementById("dialogTitle").textContent = "Edit Comment (Supabase)";
      dialogFields.innerHTML = `
        ${field("Author Name", "author", record.author)}
        ${field("Comment Content", "text", record.text, true)}
      `;
    }
    dialog.showModal();
  }

  function openAddPostModal() {
    editing = { type: "new-post" };
    document.getElementById("dialogTitle").textContent = "Create Story in Database";
    dialogActions.innerHTML = `<button class="button secondary" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">Create Post</button>`;
    dialogFields.innerHTML = `
      <div class="field"><label for="np-title">Title</label><input id="np-title" name="title" required placeholder="Story title..."></div>
      <div class="field"><label for="np-author">Author Name</label><input id="np-author" name="author" required placeholder="Author or pen name..."></div>
      <div class="field"><label for="np-category">Category</label><input id="np-category" name="category" value="Life" required></div>
      <div class="field"><label for="np-language">Language</label><input id="np-language" name="language" value="English" required></div>
      <div class="field">
        <label for="np-status">Status</label>
        <select id="np-status" name="status">
          <option value="published" selected>Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>
      <div class="field"><label for="np-content">Story Body</label><textarea id="np-content" name="content" rows="6" required placeholder="Write story text here..."></textarea></div>
    `;
    dialog.showModal();
  }

  function openAddPayoutModal() {
    editing = { type: "new-payout" };
    document.getElementById("dialogTitle").textContent = "Record Creator Payout";
    dialogActions.innerHTML = `<button class="button secondary" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">Save Payout Record</button>`;
    dialogFields.innerHTML = `
      <div class="field"><label for="py-creator">Creator Name</label><input id="py-creator" name="creator" required placeholder="e.g. Maya Chen"></div>
      <div class="field"><label for="py-handle">Username Handle</label><input id="py-handle" name="handle" required placeholder="@mayawrites"></div>
      <div class="field"><label for="py-email">Email Address</label><input id="py-email" name="email" type="email" required placeholder="creator@example.com"></div>
      <div class="field"><label for="py-period">Period</label><input id="py-period" name="period" value="Oct 2026" required></div>
      <div class="field"><label for="py-amount">Amount ($)</label><input id="py-amount" name="amount" type="number" step="0.01" min="1" value="50.00" required></div>
      <div class="field">
        <label for="py-status">Status</label>
        <select id="py-status" name="status">
          <option value="Pending" selected>Pending Review</option>
          <option value="Paid">Mark Paid</option>
        </select>
      </div>
    `;
    dialog.showModal();
  }

  function openApplicationReview(app) {
    editing = null;
    document.getElementById("dialogTitle").textContent = "Review Creator Application";
    const matchingUser = state.users.find(u => (u.email || "").toLowerCase() === (app.email || "").toLowerCase());

    const storiesCount = matchingUser ? matchingUser.posts : 0;
    const followersCount = matchingUser ? matchingUser.followers : 0;
    const isMet = storiesCount >= 36 && followersCount >= 500;

    dialogFields.innerHTML = `
      <div class="review-profile">
        <div class="review-person">${person(app.name, app.handle)} ${badge(app.status)}</div>
        <div class="review-detail"><span>Email:</span><strong>${esc(app.email)}</strong></div>
        <div class="review-detail"><span>Submitted:</span><strong>${esc(new Date(app.submittedAt).toLocaleString())}</strong></div>
        <div class="review-note"><span>Application Note:</span><p>${esc(app.note)}</p></div>
        
        <div class="review-section-title" style="margin-top:14px;font-weight:750;font-size:12px;color:var(--purple);">Creator Program Criteria Check (500 Followers · 1,000 Reactions · 3 posts/wk in 3 mos)</div>
        <div class="review-detail"><span>Posting Consistency (3 Months):</span><strong>${storiesCount} / 36 stories ${storiesCount >= 36 ? "✓" : "○"}</strong></div>
        <div class="review-detail"><span>Community Followers:</span><strong>${followersCount} / 500 followers ${followersCount >= 500 ? "✓" : "○"}</strong></div>
        <div class="review-detail"><span>Target Reactions:</span><strong>1,000 reader reactions required</strong></div>
        <div class="review-detail"><span>Criteria Status:</span><strong style="color:${isMet ? "#27966a" : "#bd8424"}">${isMet ? "✓ All monetization criteria satisfied" : "○ Criteria in progress"}</strong></div>
        ${app.profileUrl ? `<div style="margin-top:12px;"><a class="button secondary" href="${esc(app.profileUrl)}" target="_blank">Open Profile Link ↗</a></div>` : ""}
      </div>
    `;

    dialogActions.innerHTML = `
      <button class="button secondary" type="button" data-close-dialog>Close</button>
      ${app.status === "Pending" ? `
        <button class="button danger" type="button" data-action="reject-application" data-id="${esc(app.id)}">Reject Application</button>
        <button class="button primary" type="button" data-action="approve-application" data-id="${esc(app.id)}">Approve &amp; Notify</button>
      ` : ""}
    `;
    dialog.showModal();
  }

  function openAddCompetitionModal() {
    editing = { type: "new-competition" };
    document.getElementById("dialogTitle").textContent = "Create Competition Topic (Supabase)";
    dialogActions.innerHTML = `<button class="button secondary" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">Publish to Website</button>`;
    dialogFields.innerHTML = `
      <div class="field"><label for="cp-title">Competition Title</label><input id="cp-title" name="title" required placeholder="e.g. Autumn Short Story Challenge"></div>
      <div class="field"><label for="cp-kicker">Kicker / Edition</label><input id="cp-kicker" name="kicker" value="Writing Prompt · Nov 2026" required></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label for="cp-category">Category</label>
          <select id="cp-category" name="category">
            <option value="Short Story">Short Story</option>
            <option value="Personal Essay">Personal Essay</option>
            <option value="Poetry">Poetry</option>
            <option value="Fiction">Fiction</option>
            <option value="Article">Article</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="field">
          <label for="cp-status">Status</label>
          <select id="cp-status" name="status">
            <option value="Active" selected>Active (Accepting Submissions)</option>
            <option value="Upcoming">Upcoming</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="cp-deadline">Deadline Date</label><input id="cp-deadline" name="deadline" type="date" required value="${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}"></div>
      <div class="field"><label for="cp-prize">Prize / Recognition</label><input id="cp-prize" name="prize" value="$250 + Featured Homepage Story" required></div>
      <div class="field"><label for="cp-desc">Theme Description &amp; Prompt</label><textarea id="cp-desc" name="description" rows="3" required placeholder="Write prompt description..."></textarea></div>
      <div class="field"><label for="cp-guide">Submission Guidelines &amp; Rules</label><textarea id="cp-guide" name="guidelines" rows="3" placeholder="Max 3,000 words. PDF, DOCX, TXT. Original unpublished work."></textarea></div>
    `;
    dialog.showModal();
  }

  function openEditCompetitionModal(comp) {
    editing = { type: "edit-competition", id: comp.id };
    document.getElementById("dialogTitle").textContent = "Edit Competition Topic";
    dialogActions.innerHTML = `<button class="button secondary" type="button" data-close-dialog>Cancel</button><button class="button primary" type="submit">Update Competition</button>`;
    dialogFields.innerHTML = `
      <div class="field"><label for="cp-title">Competition Title</label><input id="cp-title" name="title" required value="${esc(comp.title)}"></div>
      <div class="field"><label for="cp-kicker">Kicker / Edition</label><input id="cp-kicker" name="kicker" value="${esc(comp.kicker)}" required></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="field">
          <label for="cp-category">Category</label>
          <select id="cp-category" name="category">
            <option value="Short Story" ${comp.category === "Short Story" ? "selected" : ""}>Short Story</option>
            <option value="Personal Essay" ${comp.category === "Personal Essay" ? "selected" : ""}>Personal Essay</option>
            <option value="Poetry" ${comp.category === "Poetry" ? "selected" : ""}>Poetry</option>
            <option value="Fiction" ${comp.category === "Fiction" ? "selected" : ""}>Fiction</option>
            <option value="Article" ${comp.category === "Article" ? "selected" : ""}>Article</option>
            <option value="Other" ${comp.category === "Other" ? "selected" : ""}>Other</option>
          </select>
        </div>
        <div class="field">
          <label for="cp-status">Status</label>
          <select id="cp-status" name="status">
            <option value="Active" ${comp.status === "Active" ? "selected" : ""}>Active (Accepting Submissions)</option>
            <option value="Upcoming" ${comp.status === "Upcoming" ? "selected" : ""}>Upcoming</option>
            <option value="Closed" ${comp.status === "Closed" ? "selected" : ""}>Closed</option>
          </select>
        </div>
      </div>
      <div class="field"><label for="cp-deadline">Deadline Date</label><input id="cp-deadline" name="deadline" type="date" required value="${esc(comp.deadlineRaw ? comp.deadlineRaw.slice(0, 10) : comp.deadline)}"></div>
      <div class="field"><label for="cp-prize">Prize / Recognition</label><input id="cp-prize" name="prize" value="${esc(comp.prize)}" required></div>
      <div class="field"><label for="cp-desc">Theme Description &amp; Prompt</label><textarea id="cp-desc" name="description" rows="3" required>${esc(comp.description)}</textarea></div>
      <div class="field"><label for="cp-guide">Submission Guidelines &amp; Rules</label><textarea id="cp-guide" name="guidelines" rows="3">${esc(comp.guidelines)}</textarea></div>
    `;
    dialog.showModal();
  }

  function openSubmissionReview(sub) {
    editing = { type: "review-submission", id: sub.id };
    document.getElementById("dialogTitle").textContent = "Evaluate Competition Submission";
    const submittedDate = sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : "Recently";

    dialogFields.innerHTML = `
      <div class="review-profile">
        <div class="review-person">
          ${person(sub.authorName, sub.authorHandle || sub.authorEmail)}
          ${badge(sub.status)}
        </div>
        <div class="review-detail"><span>Target Competition:</span><strong>${esc(sub.competitionTitle)}</strong></div>
        <div class="review-detail"><span>Author Email:</span><strong>${esc(sub.authorEmail)}</strong></div>
        <div class="review-detail"><span>Story Title:</span><strong>${esc(sub.storyTitle)}</strong></div>
        <div class="review-detail"><span>Submitted:</span><strong>${esc(submittedDate)}</strong></div>

        <div style="margin-top:14px;padding:12px;background:#f8f7fc;border-radius:10px;border:1px solid #e7e6f2;">
          <span style="display:block;font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;margin-bottom:6px;">Attached Document / File:</span>
          ${sub.fileUrl ? `
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
              <span class="file-attachment-badge">📄 ${esc(sub.fileName || "Competition File")} <span class="file-size">(${esc(sub.fileSize || "Attachment")})</span></span>
              <a class="download-file-btn" href="${esc(sub.fileUrl)}" download="${esc(sub.fileName || 'entry_document')}" target="_blank">⬇ Download Full Document</a>
            </div>
          ` : `<span style="font-size:12px;color:var(--muted);">No external file uploaded. Entry submitted as inline text below.</span>`}
        </div>

        ${sub.storyExcerpt ? `
          <div class="review-note" style="margin-top:12px;">
            <span>Story Text / Excerpt:</span>
            <p style="white-space:pre-wrap;max-height:220px;overflow-y:auto;background:white;padding:10px;border:1px solid #ebe9f5;border-radius:8px;">${esc(sub.storyExcerpt)}</p>
          </div>
        ` : ""}

        <div class="field" style="margin-top:14px;">
          <label for="sub-status">Evaluation Status</label>
          <select id="sub-status" name="status">
            <option value="Submitted" ${sub.status === "Submitted" ? "selected" : ""}>Submitted (Under Review)</option>
            <option value="Shortlisted" ${sub.status === "Shortlisted" ? "selected" : ""}>Shortlisted ⭐</option>
            <option value="Winner" ${sub.status === "Winner" ? "selected" : ""}>Winner 🏆</option>
            <option value="Reviewed" ${sub.status === "Reviewed" ? "selected" : ""}>Reviewed ✓</option>
          </select>
        </div>

        <div class="field">
          <label for="sub-notes">Internal Evaluation Notes / Feedback</label>
          <textarea id="sub-notes" name="notes" rows="3" placeholder="Notes on prose, voice, scoring, or feedback...">${esc(sub.reviewNotes || "")}</textarea>
        </div>
      </div>
    `;

    dialogActions.innerHTML = `
      <button class="button secondary" type="button" data-close-dialog>Close</button>
      <button class="button danger" type="button" data-action="delete-submission" data-id="${esc(sub.id)}">Delete Submission</button>
      <button class="button primary" type="submit">Save Evaluation</button>
    `;
    dialog.showModal();
  }

  // --- ACTIONS DISPATCHER ---
  async function performAction(action, id) {
    const sb = await getClient();

    if (action === "sync-db") {
      showToast("Fetching live database tables...");
      await fetchAllFromDatabase();
      showToast("Database synchronized successfully!");
      return;
    }

    if (action === "switch-db-table") {
      state.dbTable = id;
      render();
      return;
    }

    if (action === "add-post") return openAddPostModal();
    if (action === "add-payout") return openAddPayoutModal();
    if (action === "add-competition") return openAddCompetitionModal();

    if (action === "edit-competition") {
      const comp = state.competitions.find(c => c.id === id);
      if (comp) openEditCompetitionModal(comp);
      return;
    }

    if (action === "toggle-competition-status") {
      const comp = state.competitions.find(c => c.id === id);
      if (!comp) return;
      const nextStatus = comp.status === "Active" ? "Closed" : "Active";
      if (sb) {
        await sb.from("competitions").update({ status: nextStatus }).eq("id", id);
      }
      comp.status = nextStatus;
      syncCompetitionsToStorage(state.competitions);
      showToast(`Competition status changed to ${nextStatus}.`);
      updateNavCounters();
      render();
      return;
    }

    if (action === "delete-competition") {
      const comp = state.competitions.find(c => c.id === id);
      if (!confirm(`Permanently delete competition "${comp?.title}" and its topics from the database?`)) return;
      if (sb) {
        await sb.from("competition_submissions").delete().eq("competition_id", id);
        await sb.from("competitions").delete().eq("id", id);
      }
      state.competitions = state.competitions.filter(c => c.id !== id);
      syncCompetitionsToStorage(state.competitions);
      showToast("Competition topic deleted from database.");
      updateNavCounters();
      render();
      return;
    }

    if (action === "review-submission") {
      const sub = state.submissions.find(s => s.id === id);
      if (sub) openSubmissionReview(sub);
      return;
    }

    if (action === "shortlist-submission") {
      const sub = state.submissions.find(s => s.id === id);
      if (!sub) return;
      if (sb) {
        await sb.from("competition_submissions").update({ status: "Shortlisted" }).eq("id", id);
      }
      sub.status = "Shortlisted";
      showToast("Submission marked as Shortlisted ⭐");
      updateNavCounters();
      render();
      return;
    }

    if (action === "delete-submission") {
      if (!confirm("Permanently delete this submission and file record from the database?")) return;
      if (sb) {
        await sb.from("competition_submissions").delete().eq("id", id);
      }
      state.submissions = state.submissions.filter(s => s.id !== id);
      dialog.close();
      showToast("Submission deleted from database.");
      updateNavCounters();
      render();
      return;
    }

    if (action === "edit-post") {
      const p = state.posts.find(item => item.id === id);
      if (p) openEditor("post", p);
      return;
    }

    if (action === "edit-user") {
      const u = state.users.find(item => item.id === id);
      if (u) openEditor("user", u);
      return;
    }

    if (action === "edit-comment") {
      const c = state.comments.find(item => item.id === id);
      if (c) openEditor("comment", c);
      return;
    }

    if (action === "review-application") {
      const a = state.applications.find(item => item.id === id);
      if (a) openApplicationReview(a);
      return;
    }

    // --- DATABASE MUTATIONS ---
    if (action === "publish-post" || action === "draft-post") {
      const newStatus = action === "publish-post" ? "published" : "draft";
      if (sb) {
        await sb.from("posts").update({ status: newStatus }).eq("id", id);
      }
      const post = state.posts.find(p => p.id === id);
      if (post) post.status = newStatus;
      showToast(`Post marked as ${newStatus} in database.`);
      render();
      return;
    }

    if (action === "delete-post") {
      const post = state.posts.find(p => p.id === id);
      if (!confirm(`Permanently delete "${post?.title || "this story"}" from the Supabase database?`)) return;
      if (sb) {
        // Delete dependent records first, then post
        await sb.from("comments").delete().eq("post_id", id);
        await sb.from("likes_table").delete().eq("post_id", id);
        await sb.from("bookmarks").delete().eq("post_id", id);
        await sb.from("notifications").delete().eq("post_id", id);
        const { error } = await sb.from("posts").delete().eq("id", id);
        if (error) console.error("Post delete error:", error);
      }
      state.posts = state.posts.filter(p => p.id !== id);
      showToast("Post deleted from database.");
      render();
      return;
    }

    if (action === "delete-user") {
      const u = state.users.find(item => item.id === id);
      if (!confirm(`Permanently delete profile "${u?.name}" from the database?`)) return;
      if (sb) {
        await sb.from("profiles").delete().eq("id", id);
      }
      state.users = state.users.filter(item => item.id !== id);
      showToast("User profile deleted from database.");
      render();
      return;
    }

    if (action === "delete-comment") {
      if (!confirm("Delete this comment from the database?")) return;
      if (sb) {
        await sb.from("comments").delete().eq("id", Number(id));
      }
      state.comments = state.comments.filter(c => c.id !== id);
      showToast("Comment deleted from database.");
      render();
      return;
    }

    if (action === "delete-like") {
      if (!confirm("Remove this like record from the database?")) return;
      if (sb) {
        await sb.from("likes_table").delete().eq("id", id);
      }
      state.likes = state.likes.filter(l => l.id !== id);
      showToast("Like record removed from database.");
      render();
      return;
    }

    if (action === "approve-application") {
      const app = state.applications.find(a => a.id === id);
      if (!app) return;
      if (sb) {
        await sb.from("monetization_applications").update({
          status: "Approved",
          reviewed_at: new Date().toISOString()
        }).eq("id", id);

        // Send congratulatory notification to the applicant
        if (app.userId) {
          await sb.from("notifications").insert({
            recipient_id: app.userId,
            actor_id: null,
            type: "monetization",
            message: "🎉 Your Creator Monetization application has been APPROVED! Welcome to the Qalamly Creator Program.",
            is_read: false
          });
        }
      }
      app.status = "Approved";
      dialog.close();
      showToast("Application approved and applicant notified!");
      render();
      return;
    }

    if (action === "reject-application") {
      const reason = prompt("Enter a brief reason for declining this application (optional):", "Needs more published stories and reader engagement.");
      if (reason === null) return;
      const app = state.applications.find(a => a.id === id);
      if (!app) return;
      if (sb) {
        await sb.from("monetization_applications").update({
          status: "Rejected",
          review_note: reason,
          reviewed_at: new Date().toISOString()
        }).eq("id", id);

        if (app.userId) {
          await sb.from("notifications").insert({
            recipient_id: app.userId,
            actor_id: null,
            type: "monetization",
            message: `Your Creator Monetization application was not approved: ${reason}`,
            is_read: false
          });
        }
      }
      app.status = "Rejected";
      app.reviewNote = reason;
      dialog.close();
      showToast("Application marked as rejected in database.");
      render();
      return;
    }

    if (action === "delete-application") {
      if (!confirm("Delete this application record from database?")) return;
      if (sb) {
        await sb.from("monetization_applications").delete().eq("id", id);
      }
      state.applications = state.applications.filter(a => a.id !== id);
      showToast("Application deleted from database.");
      render();
      return;
    }

    if (action === "approve-payout") {
      if (sb) {
        await sb.from("payouts").update({ status: "Paid", paid_at: new Date().toISOString() }).eq("id", id);
      }
      const p = state.payouts.find(item => item.id === id);
      if (p) p.status = "Paid";
      showToast("Payout marked as Paid in database.");
      render();
      return;
    }

    if (action === "reject-payout") {
      if (!confirm("Reject this payout request?")) return;
      if (sb) {
        await sb.from("payouts").update({ status: "Rejected" }).eq("id", id);
      }
      const p = state.payouts.find(item => item.id === id);
      if (p) p.status = "Rejected";
      showToast("Payout marked as Rejected.");
      render();
      return;
    }

    if (action === "delete-payout") {
      if (!confirm("Delete this payout record from the database?")) return;
      if (sb) {
        await sb.from("payouts").delete().eq("id", id);
      }
      state.payouts = state.payouts.filter(p => p.id !== id);
      showToast("Payout deleted from database.");
      render();
      return;
    }

    if (action === "delete-message") {
      if (!confirm("Delete this inquiry from the contact table?")) return;
      if (sb) {
        await sb.from("contact").delete().eq("id", id);
      }
      state.messages = state.messages.filter(m => m.id !== id);
      state.selectedMessage = state.messages[0]?.id || null;
      showToast("Inquiry deleted from database.");
      render();
      return;
    }

    if (action === "select-message") {
      state.selectedMessage = id;
      render();
    }
  }

  // --- FORM SUBMIT HANDLERS ---
  editorForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!editing) return;
    const sb = await getClient();
    const formData = new FormData(editorForm);

    if (editing.type === "post") {
      const title = String(formData.get("title") || "").trim();
      const author = String(formData.get("author") || "").trim();
      const topic = String(formData.get("topic") || "").trim();
      const language = String(formData.get("language") || "English").trim();
      const status = String(formData.get("status") || "published").trim();
      const body = String(formData.get("body") || "").trim();

      if (sb) {
        await sb.from("posts").update({
          title,
          author_name: author,
          category: topic,
          language,
          status,
          content: body
        }).eq("id", editing.id);
      }

      const post = state.posts.find(p => p.id === editing.id);
      if (post) {
        post.title = title;
        post.author = author;
        post.topic = topic;
        post.language = language;
        post.status = status;
        post.body = body;
        post.excerpt = body.slice(0, 160) + (body.length > 160 ? "..." : "");
      }
      dialog.close();
      showToast("Post updated in database!");
      render();
      return;
    }

    if (editing.type === "new-post") {
      const title = String(formData.get("title") || "").trim();
      const author = String(formData.get("author") || "").trim();
      const category = String(formData.get("category") || "Life").trim();
      const language = String(formData.get("language") || "English").trim();
      const status = String(formData.get("status") || "published").trim();
      const content = String(formData.get("content") || "").trim();

      if (sb) {
        const { data } = await sb.from("posts").insert({
          title,
          author_name: author,
          category,
          language,
          status,
          content
        }).select().single();

        if (data) {
          state.posts.unshift({
            id: data.id,
            title,
            author,
            handle: `@${author.toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
            topic: category,
            language,
            status,
            body: content,
            excerpt: content.slice(0, 160),
            date: new Date().toISOString().slice(0, 10),
            likes: 0,
            comments: 0
          });
        }
      }
      dialog.close();
      showToast("New post added directly to database!");
      render();
      return;
    }

    if (editing.type === "user") {
      const name = String(formData.get("name") || "").trim();
      const handle = String(formData.get("handle") || "").trim().replace(/^@/, "");
      const peoticName = String(formData.get("peoticName") || "").trim();
      const email = String(formData.get("email") || "").trim();
      const role = String(formData.get("role") || "both").trim();
      const bio = String(formData.get("bio") || "").trim();

      if (sb) {
        await sb.from("profiles").update({
          full_name: name,
          username: handle,
          peotic_name: peoticName,
          email,
          role,
          bio
        }).eq("id", editing.id);
      }

      const u = state.users.find(item => item.id === editing.id);
      if (u) {
        u.name = name;
        u.handle = `@${handle}`;
        u.peoticName = peoticName;
        u.email = email;
        u.role = role;
        u.bio = bio;
      }
      dialog.close();
      showToast("Profile updated in database!");
      render();
      return;
    }

    if (editing.type === "comment") {
      const author = String(formData.get("author") || "").trim();
      const text = String(formData.get("text") || "").trim();

      if (sb) {
        await sb.from("comments").update({ author_name: author, content: text }).eq("id", Number(editing.id));
      }

      const c = state.comments.find(item => item.id === editing.id);
      if (c) {
        c.author = author;
        c.text = text;
      }
      dialog.close();
      showToast("Comment updated in database!");
      render();
      return;
    }

    if (editing.type === "new-payout") {
      const creator = String(formData.get("creator") || "").trim();
      let handle = String(formData.get("handle") || "").trim();
      if (!handle.startsWith("@")) handle = `@${handle}`;
      const email = String(formData.get("email") || "").trim();
      const period = String(formData.get("period") || "Oct 2026").trim();
      const amount = Number(formData.get("amount") || 0);
      const status = String(formData.get("status") || "Pending").trim();

      if (sb) {
        const { data } = await sb.from("payouts").insert({
          creator,
          handle,
          email,
          period,
          amount,
          status,
          paid_at: status === "Paid" ? new Date().toISOString() : null
        }).select().single();

        if (data) {
          state.payouts.unshift({
            id: data.id,
            creator,
            handle,
            email,
            period,
            amount,
            status,
            createdAt: new Date().toISOString()
          });
        }
      }
      dialog.close();
      showToast("Payout record saved to database!");
      render();
      return;
    }

    if (editing.type === "new-competition") {
      const title = String(formData.get("title") || "").trim();
      const kicker = String(formData.get("kicker") || "Writing Prompt").trim();
      const category = String(formData.get("category") || "Short Story").trim();
      const status = String(formData.get("status") || "Active").trim();
      const deadline = String(formData.get("deadline") || "").trim();
      const prize = String(formData.get("prize") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const guidelines = String(formData.get("guidelines") || "").trim();

      if (sb) {
        const { data } = await sb.from("competitions").insert({
          title,
          kicker,
          category,
          status,
          deadline: deadline ? `${deadline} 23:59:59+00` : null,
          prize,
          description,
          guidelines
        }).select().single();

        if (data) {
          state.competitions.unshift({
            id: data.id,
            title,
            kicker,
            category,
            status,
            deadline: deadline || "Open",
            deadlineRaw: data.deadline,
            prize,
            description,
            guidelines,
            createdAt: data.created_at
          });
          syncCompetitionsToStorage(state.competitions);
        }
      }
      dialog.close();
      showToast("New competition topic published to website!");
      updateNavCounters();
      render();
      return;
    }

    if (editing.type === "edit-competition") {
      const title = String(formData.get("title") || "").trim();
      const kicker = String(formData.get("kicker") || "Writing Prompt").trim();
      const category = String(formData.get("category") || "Short Story").trim();
      const status = String(formData.get("status") || "Active").trim();
      const deadline = String(formData.get("deadline") || "").trim();
      const prize = String(formData.get("prize") || "").trim();
      const description = String(formData.get("description") || "").trim();
      const guidelines = String(formData.get("guidelines") || "").trim();

      if (sb) {
        await sb.from("competitions").update({
          title,
          kicker,
          category,
          status,
          deadline: deadline ? `${deadline} 23:59:59+00` : null,
          prize,
          description,
          guidelines
        }).eq("id", editing.id);
      }

      const comp = state.competitions.find(c => c.id === editing.id);
      if (comp) {
        comp.title = title;
        comp.kicker = kicker;
        comp.category = category;
        comp.status = status;
        comp.deadline = deadline || "Open";
        comp.deadlineRaw = deadline ? `${deadline} 23:59:59+00` : null;
        comp.prize = prize;
        comp.description = description;
        comp.guidelines = guidelines;
        syncCompetitionsToStorage(state.competitions);
      }
      dialog.close();
      showToast("Competition topic updated successfully!");
      render();
      return;
    }

    if (editing.type === "review-submission") {
      const status = String(formData.get("status") || "Submitted").trim();
      const notes = String(formData.get("notes") || "").trim();

      if (sb) {
        await sb.from("competition_submissions").update({
          status,
          review_notes: notes
        }).eq("id", editing.id);
      }

      const sub = state.submissions.find(s => s.id === editing.id);
      if (sub) {
        sub.status = status;
        sub.reviewNotes = notes;
      }
      dialog.close();
      showToast("Submission evaluation saved to database!");
      updateNavCounters();
      render();
      return;
    }
  });

  // --- GLOBAL LISTENERS ---
  document.addEventListener("click", event => {
    const enableTotp = event.target.closest("[data-enable-admin-totp]");
    if (enableTotp) {
      (async () => {
        const sb = await getClient();
        const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Qalamly admin authenticator" });
        if (error) throw error;
        pendingAdminEnrollment = data;
        const controls = document.getElementById("adminTotpControls");
        if (controls) {
          controls.innerHTML = `
            <p class="table-note">Scan this QR code in your authenticator app, then enter its six-digit code.</p>
            <img src="${esc(data.totp.qr_code)}" alt="Authenticator setup QR code" style="width:180px;height:180px;">
            <p class="table-note">Setup key: <code>${esc(data.totp.secret)}</code></p>
            <form id="verifyAdminTotpForm">
              <div class="field"><label for="adminEnrollTotpCode">Authentication code</label><input id="adminEnrollTotpCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div>
              <button class="button primary" type="submit">Verify and enable 2FA</button>
              <p id="adminSecurityError" role="alert" style="color:var(--red);font-size:11px;"></p>
            </form>`;
        }
      })().catch((err) => {
        const status = document.getElementById("adminTotpStatus");
        if (status) status.textContent = err instanceof Error ? err.message : "Could not start authenticator setup.";
      });
      return;
    }

    const disableTotp = event.target.closest("[data-disable-admin-totp]");
    if (disableTotp) {
      if (!window.confirm("Turn off two-factor authentication for the administrator account?")) return;
      (async () => {
        const sb = await getClient();
        const { error } = await sb.auth.mfa.unenroll({ factorId: disableTotp.dataset.disableAdminTotp });
        if (error) throw error;
        pendingAdminEnrollment = null;
        await loadAdminSecurityStatus();
        showToast("Two-factor authentication is disabled.");
      })().catch((err) => {
        const status = document.getElementById("adminTotpStatus");
        if (status) status.textContent = err instanceof Error ? err.message : "Could not disable two-factor authentication.";
      });
      return;
    }

    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      if (!adminUser) return;
      state.view = viewButton.dataset.view;
      state.search = "";
      if (searchInput) searchInput.value = "";
      document.getElementById("sidebar")?.classList.remove("open");
      render();
      return;
    }

    // Top Admin profile dropdown toggle
    const trigger = event.target.closest("#topAdminTrigger");
    if (trigger) {
      if (!adminUser) return;
      const menu = document.getElementById("topAdminMenu");
      if (menu) {
        const isHidden = menu.style.display === "none" || !menu.style.display;
        menu.style.display = isHidden ? "block" : "none";
        trigger.setAttribute("aria-expanded", isHidden ? "true" : "false");
      }
      return;
    }
    if (!event.target.closest(".top-admin-wrapper")) {
      const menu = document.getElementById("topAdminMenu");
      if (menu && menu.style.display === "block") {
        menu.style.display = "none";
        document.getElementById("topAdminTrigger")?.setAttribute("aria-expanded", "false");
      }
    }

    const actionButton = event.target.closest("[data-action]");
    if (actionButton) {
      const { action, id } = actionButton.dataset;
      if (action === "logout-admin" || action === "lock-admin") {
        (async () => {
          const sb = await getClient();
          if (sb) {
            try {
              const { error } = await sb.auth.signOut();
              if (error) console.warn("Supabase sign out notice:", error);
            } catch (signOutErr) {
              console.warn("Sign out error:", signOutErr);
            }
          }
          adminUser = null;
          adminInitialized = false;
          showToast(action === "logout-admin" ? "Logged out successfully." : "Admin Studio locked.");
          await showAdminAuthGate();
        })().catch((err) => showToast(err instanceof Error ? err.message : "Could not sign out.", true));
        return;
      }
      if (!adminUser) return;
      performAction(action, id);
    }
  });

  document.addEventListener("submit", async event => {
    if (event.target.id === "adminChangePasswordForm") {
      event.preventDefault();
      const form = event.target;
      const password = form.elements.password.value;
      const confirmPassword = form.elements.confirmPassword.value;
      if (password.length < 8) {
        document.getElementById("adminSecurityError").textContent = "Password must be at least 8 characters.";
        return;
      }
      if (password !== confirmPassword) {
        document.getElementById("adminSecurityError").textContent = "Passwords do not match.";
        return;
      }
      try {
        const sb = await getClient();
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
        form.reset();
        showToast("Administrator password changed.");
      } catch (err) {
        document.getElementById("adminSecurityError").textContent = err instanceof Error ? err.message : "Could not change password.";
      }
      return;
    }

    if (event.target.id === "verifyAdminTotpForm") {
      event.preventDefault();
      if (!pendingAdminEnrollment?.id) {
        document.getElementById("adminSecurityError").textContent = "Authenticator setup expired. Start again.";
        return;
      }
      try {
        const sb = await getClient();
        const { data: challenge, error: challengeError } = await sb.auth.mfa.challenge({ factorId: pendingAdminEnrollment.id });
        if (challengeError) throw challengeError;
        const { error } = await sb.auth.mfa.verify({
          factorId: pendingAdminEnrollment.id,
          challengeId: challenge.id,
          code: event.target.elements.code.value.trim()
        });
        if (error) throw error;
        pendingAdminEnrollment = null;
        await loadAdminSecurityStatus();
        showToast("Two-factor authentication is enabled.");
      } catch (err) {
        const errorEl = document.getElementById("adminSecurityError");
        if (errorEl) errorEl.textContent = err instanceof Error ? err.message : "Could not verify the authenticator code.";
      }
      return;
    }

    if (event.target.id === "adminMfaForm") {
      event.preventDefault();
      if (!pendingAdminMfa) return;
      try {
        const sb = await getClient();
        const { error } = await sb.auth.mfa.verify({
          factorId: pendingAdminMfa.factorId,
          challengeId: pendingAdminMfa.challengeId,
          code: event.target.elements.code.value.trim()
        });
        if (error) throw error;
        pendingAdminMfa = null;
        await initAdmin();
      } catch (err) {
        const errorEl = document.getElementById("adminAuthError");
        if (errorEl) errorEl.textContent = err instanceof Error ? err.message : "The authentication code could not be verified.";
      }
    }
  });

  content?.addEventListener("change", event => {
    const filters = {
      postFilter: "postFilter",
      commentFilter: "commentFilter",
      userFilter: "userFilter",
      payoutFilter: "payoutFilter",
      applicationFilter: "applicationFilter",
      competitionFilter: "competitionFilter",
      submissionFilter: "submissionFilter"
    };
    const prop = filters[event.target.id];
    if (prop) {
      state[prop] = event.target.value;
      render();
    }
  });

  searchInput?.addEventListener("input", () => {
    state.search = searchInput.value.trim();
    render();
  });

  document.addEventListener("click", event => {
    if (event.target.closest("[data-close-dialog]")) dialog?.close();
  });
  dialog?.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });

  document.getElementById("menuToggle")?.addEventListener("click", () => {
    if (!adminUser) return;
    document.getElementById("sidebar")?.classList.toggle("open");
  });

  // --- INITIALIZATION ---
  let initializing = false;
  let adminInitialized = false;

  function updateAdminHeaderDisplay() {
    if (!adminUser) return;
    const email = adminUser.email || "Admin";
    const name = adminUser.user_metadata?.full_name || email.split("@")[0] || "Admin";
    const initials = name.slice(0, 2).toUpperCase();

    const sidebarCardStrong = document.querySelector(".admin-card strong");
    const sidebarAvatar = document.querySelector(".admin-card .admin-avatar");
    const topAdminName = document.querySelector(".top-admin span:nth-child(2)");
    const topAdminAvatar = document.querySelector(".top-admin .admin-avatar");
    const topAdminMenuName = document.getElementById("topAdminMenuName");
    const topAdminMenuEmail = document.getElementById("topAdminMenuEmail");

    if (sidebarCardStrong) sidebarCardStrong.textContent = name;
    if (sidebarAvatar) sidebarAvatar.textContent = initials;
    if (topAdminName) topAdminName.textContent = name;
    if (topAdminAvatar) topAdminAvatar.textContent = initials;
    if (topAdminMenuName) topAdminMenuName.textContent = name;
    if (topAdminMenuEmail) topAdminMenuEmail.textContent = email;
  }

  async function initAdmin() {
    if (initializing) return;
    initializing = true;
    try {
      const auth = await checkAdminAuth();
      if (!auth.authenticated) {
        const shell = document.getElementById("adminDashboardShell");
        if (shell) shell.style.display = "none";
        if (auth.mfaRequired) showAdminMfaGate();
        else showAdminAuthGate(auth.unauthorized ? "This account is not authorized to access the admin dashboard." : "");
        return;
      }
      showDashboardScreen();
      if (!adminInitialized) {
        adminInitialized = true;
        updateAdminHeaderDisplay();
        render();
        fetchAllFromDatabase();
      }
    } catch (err) {
      const shell = document.getElementById("adminDashboardShell");
      if (shell) shell.style.display = "none";
      showAdminAuthGate(err instanceof Error ? err.message : "Could not verify administrator access.");
    } finally {
      initializing = false;
    }
  }

  document.addEventListener("DOMContentLoaded", initAdmin);
  if (document.readyState === "complete" || document.readyState === "interactive") {
    initAdmin();
  }
})();
