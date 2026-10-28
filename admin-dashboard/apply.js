(() => {
  "use strict";

  const STORAGE_KEY = "qalamly-admin-demo-v1";
  const form = document.getElementById("applicationForm");
  const formView = document.getElementById("applyFormView");
  const statusView = document.getElementById("applicationStatus");
  const toast = document.getElementById("toast");
  let toastTimeout;
  let activeEmail = "";

  function loadApplications() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const data = JSON.parse(saved);
      return Array.isArray(data.applications) ? data.applications : [];
    } catch (error) {
      console.error("Could not read the local creator application data.", error);
      showToast("Could not load existing application status.", true);
      return [];
    }
  }

  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function renderStatus(application) {
    if (!application) {
      formView.hidden = false;
      statusView.hidden = true;
      return;
    }
    formView.hidden = true;
    statusView.hidden = false;
    const status = application.status || "Pending";
    const isPending = status === "Pending";
    const icon = isPending ? "◷" : status === "Approved" ? "✓" : "×";
    const heading = isPending ? "Your application is under review" : status === "Approved" ? "You’re approved!" : "Application not approved";
    const reviewNote = application.review_note || application.reviewNote || "";
    const message = isPending
      ? "An admin will review your Qalamly profile and application. You can check back here for an update."
      : status === "Approved"
        ? "Your application was approved. Welcome to the creator monetization program."
        : `Your application was declined${reviewNote ? `: ${reviewNote}` : "."} You may submit a new application when you are ready.`;
    const submittedDate = application.submitted_at || application.submittedAt || new Date().toISOString();
    statusView.innerHTML = `<div class="status-icon${status === "Approved" ? " approved" : status === "Rejected" ? " rejected" : ""}" aria-hidden="true">${icon}</div><div class="eyebrow">APPLICATION ${status.toUpperCase()}</div><h2>${heading}</h2><p>${message}</p><div class="status-details"><strong>${escapeHtml(application.name)}</strong> · ${escapeHtml(application.handle)}<br>Submitted ${escapeHtml(new Date(submittedDate).toLocaleDateString())}</div>${status === "Rejected" ? `<button class="button primary" type="button" id="newApplication">Apply again</button>` : ""}<a class="button secondary" href="admindashboard.html">Back to admin dashboard</a>`;
    statusView.querySelector("#newApplication")?.addEventListener("click", () => {
      form.reset();
      renderStatus(null);
    });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  async function initExistingApplication() {
    const existingApplication = loadApplications()
      .filter(application => application.email)
      .sort((a, b) => String(b.submittedAt || b.submitted_at).localeCompare(String(a.submittedAt || a.submitted_at)))[0];

    if (typeof window.getSupabaseClient === "function") {
      try {
        const sb = await window.getSupabaseClient();
        const { data: sessionRes } = await sb.auth.getSession();
        const authUser = sessionRes?.session?.user;
        const targetEmail = authUser?.email || existingApplication?.email;
        if (targetEmail) {
          const { data } = await sb
            .from("monetization_applications")
            .select("*")
            .eq("email", targetEmail.toLowerCase())
            .order("submitted_at", { ascending: false })
            .limit(1);
          if (Array.isArray(data) && data[0] && data[0].status !== "Rejected") {
            activeEmail = String(data[0].email).toLowerCase();
            renderStatus(data[0]);
            return;
          }
        }
      } catch (err) {
        console.warn("Supabase application check notice:", err);
      }
    }

    if (existingApplication && existingApplication.status !== "Rejected") {
      activeEmail = String(existingApplication.email).toLowerCase();
      renderStatus(existingApplication);
    }
  }

  initExistingApplication();

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const email = String(values.email).trim().toLowerCase();
    const handle = String(values.handle).trim().replace(/^@+/, "");
    if (!handle) {
      showToast("Enter a valid Qalamly username.", true);
      return;
    }
    try {
      const current = localStorage.getItem(STORAGE_KEY);
      const data = current ? JSON.parse(current) : {};
      if (current && (!data || typeof data !== "object" || Array.isArray(data))) {
        throw new Error("Stored demo data is invalid.");
      }
      const applications = Array.isArray(data.applications) ? data.applications : [];
      const pendingDuplicate = applications.find(application =>
        String(application.email).toLowerCase() === email && application.status === "Pending"
      );
      if (pendingDuplicate) {
        renderStatus(pendingDuplicate);
        showToast("You already have an application waiting for review.");
        return;
      }
      const submittedAt = new Date().toISOString();
      const application = {
        id: `A-${Date.now()}`,
        name: String(values.name).trim(),
        handle: `@${handle}`,
        email,
        profileUrl: String(values.profileUrl || "").trim(),
        note: String(values.note).trim(),
        submittedAt,
        status: "Pending"
      };

      if (typeof window.getSupabaseClient === "function") {
        try {
          const sb = await window.getSupabaseClient();
          const { data: sessionRes } = await sb.auth.getSession();
          const userId = sessionRes?.session?.user?.id || null;
          const { data: inserted, error: insertErr } = await sb
            .from("monetization_applications")
            .insert({
              user_id: userId,
              name: application.name,
              handle: application.handle,
              email: application.email,
              profile_url: application.profileUrl,
              note: application.note,
              status: "Pending",
              submitted_at: submittedAt
            })
            .select()
            .single();
          if (!insertErr && inserted?.id) {
            application.id = inserted.id;
          }
        } catch (sbErr) {
          console.warn("Supabase application insert notice:", sbErr);
        }
      }

      data.applications = [...applications, application];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      activeEmail = email;
      renderStatus(application);
      showToast("Application submitted to database for admin review.");
    } catch (error) {
      console.error("Could not save the creator monetization application.", error);
      showToast("Could not save your application in this browser.", true);
    }
  });

  window.addEventListener("storage", event => {
    if (event.key !== STORAGE_KEY || !event.newValue || !activeEmail) return;
    try {
      const data = JSON.parse(event.newValue);
      const application = Array.isArray(data.applications)
        ? data.applications.find(item => String(item.email).toLowerCase() === activeEmail)
        : null;
      if (application) renderStatus(application);
    } catch (error) {
      console.error("Could not refresh monetization application status.", error);
      showToast("Could not refresh application status.", true);
    }
  });
})();
