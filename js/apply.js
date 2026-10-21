(() => {
  "use strict";

  const STORAGE_LOCAL_APP = "qalamly.monetization.application";

  const formView = document.getElementById("applyFormView");
  const statusView = document.getElementById("applicationStatusView");
  const form = document.getElementById("creatorApplyForm");
  const reapplyBtn = document.getElementById("reapplyBtn");
  const refreshStatusBtn = document.getElementById("refreshStatusBtn");

  // Input fields
  const nameInput = document.getElementById("applicantName");
  const handleInput = document.getElementById("applicantHandle");
  const emailInput = document.getElementById("applicantEmail");
  const profileInput = document.getElementById("applicantProfile");
  const noteInput = document.getElementById("applicationNote");
  const submitBtn = document.getElementById("submitApplyBtn");

  // Criteria elements
  const critStories = document.getElementById("critStories");
  const critFollowers = document.getElementById("critFollowers");
  const critLikes = document.getElementById("critLikes");
  const progStories = document.getElementById("progStories");
  const progFollowers = document.getElementById("progFollowers");
  const progLikes = document.getElementById("progLikes");
  const statStories = document.getElementById("statStories");
  const statFollowers = document.getElementById("statFollowers");
  const statLikes = document.getElementById("statLikes");
  const overallBadge = document.getElementById("criteriaOverallBadge");
  const footerText = document.getElementById("criteriaFooterText");

  // Status view elements
  const statusIconWrap = document.getElementById("statusIconWrap");
  const statusKicker = document.getElementById("statusKicker");
  const statusTitle = document.getElementById("statusTitle");
  const statusMsg = document.getElementById("statusMsg");
  const statusDetails = document.getElementById("statusDetails");

  function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function getUser() {
    try {
      const sessionId = JSON.parse(localStorage.getItem("qalamly.session.v3"));
      if (!sessionId) return null;
      const users = JSON.parse(localStorage.getItem("qalamly.users.v3")) || [];
      return users.find(u => u.id === sessionId) || null;
    } catch {
      return null;
    }
  }

  function getMetrics(user) {
    if (!user) return { stories: 0, recentStories: 0, weeklyRate: 0, followers: 0, likes: 0, isEligible: false, metCount: 0 };
    try {
      const posts = JSON.parse(localStorage.getItem("qalamly.posts.v3")) || [];
      const ownPublished = posts.filter(p => p.authorId === user.id && p.status === "published");
      const stories = ownPublished.length;

      // Calculate stories published in the last 3 months (90 days)
      const threeMonthsAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);
      const recentPublished = ownPublished.filter(p => {
        const time = new Date(p.createdAt || p.created_at || Date.now()).getTime();
        return time >= threeMonthsAgo;
      });
      const recentStories = recentPublished.length;
      // Target: 3 posts weekly * 12 weeks = 36 posts in 3 months
      const targetStories = 36;
      const weeklyRate = Number((recentStories / 12).toFixed(1));

      const follows = JSON.parse(localStorage.getItem("qalamly.follows.v3")) || {};
      let followers = Number(user.followers || 0);
      Object.values(follows).forEach(list => {
        if (Array.isArray(list) && list.includes(user.id)) followers++;
      });

      const likes = ownPublished.reduce((sum, p) => sum + (Number(p.likes) || 0), 0);

      const targetFollowers = 500;
      const targetLikes = 1000;

      const storiesMet = recentStories >= targetStories || (stories >= targetStories && weeklyRate >= 3.0);
      const followersMet = followers >= targetFollowers;
      const likesMet = likes >= targetLikes;
      const metCount = (storiesMet ? 1 : 0) + (followersMet ? 1 : 0) + (likesMet ? 1 : 0);

      return {
        stories,
        recentStories,
        weeklyRate,
        followers,
        likes,
        targetStories,
        targetFollowers,
        targetLikes,
        storiesMet,
        followersMet,
        likesMet,
        metCount,
        isEligible: storiesMet && followersMet && likesMet
      };
    } catch {
      return { stories: 0, recentStories: 0, weeklyRate: 0, followers: 0, likes: 0, isEligible: false, metCount: 0 };
    }
  }

  function updateCriteriaUI() {
    const user = getUser();
    const metrics = getMetrics(user);

    // Update Progress Bars & Numbers
    const targetStories = metrics.targetStories || 36;
    const targetFollowers = metrics.targetFollowers || 500;
    const targetLikes = metrics.targetLikes || 1000;

    const storyPct = Math.min(100, Math.round(((metrics.recentStories || 0) / targetStories) * 100));
    const folPct = Math.min(100, Math.round(((metrics.followers || 0) / targetFollowers) * 100));
    const likePct = Math.min(100, Math.round(((metrics.likes || 0) / targetLikes) * 100));

    progStories.style.width = `${storyPct}%`;
    progFollowers.style.width = `${folPct}%`;
    progLikes.style.width = `${likePct}%`;

    statStories.innerHTML = `<span class="crit-pill">${metrics.recentStories || 0} / ${targetStories} stories <small style="display:block;font-size:9px;color:var(--muted);font-weight:normal;">(${metrics.weeklyRate || 0}/3 weekly)</small></span>`;
    statFollowers.innerHTML = `<span class="crit-pill">${metrics.followers || 0} / ${targetFollowers}</span>`;
    statLikes.innerHTML = `<span class="crit-pill">${metrics.likes || 0} / 1,000</span>`;

    critStories.classList.toggle("met", Boolean(metrics.storiesMet));
    critFollowers.classList.toggle("met", Boolean(metrics.followersMet));
    critLikes.classList.toggle("met", Boolean(metrics.likesMet));

    if (metrics.isEligible) {
      overallBadge.className = "criteria-overall-badge eligible";
      overallBadge.textContent = "✓ Criteria Met (3 of 3)";
      footerText.innerHTML = `<strong>Congratulations, ${escapeHTML(user.poeticName || user.name)}!</strong> You meet all criteria (500+ followers, 1,000+ reactions, and 3 posts weekly in 3 months). Complete your application below for priority approval.`;
    } else if (user) {
      overallBadge.className = "criteria-overall-badge";
      overallBadge.textContent = `${metrics.metCount} of 3 goals met`;
      footerText.textContent = `You're making great progress (${metrics.metCount}/3 requirements completed). Criteria: 500 followers, 1,000 reactions, and 3 posts weekly in 3 months (36 stories). Keep writing!`;
    } else {
      overallBadge.className = "criteria-overall-badge";
      overallBadge.textContent = "Guest view";
      footerText.innerHTML = `Log in to automatically calculate your 3-month consistency, 500 followers, and 1,000 reactions. <a href="login.html" style="color:var(--purple);font-weight:700;text-decoration:underline;">Log in now</a>`;
    }

    // Auto-fill form fields if user is logged in
    if (user) {
      if (!nameInput.value) nameInput.value = user.name || user.poeticName || "";
      if (!handleInput.value) handleInput.value = user.handle || `@writer`;
      if (!emailInput.value) emailInput.value = user.email || "";
      if (!profileInput.value) {
        const origin = window.location.origin;
        profileInput.value = `${origin}${window.location.pathname.replace(/[^/]+$/, "")}profile.html?id=${encodeURIComponent(user.id)}`;
      }
    }
  }

  function renderApplicationStatus(app) {
    if (!app) {
      formView.hidden = false;
      statusView.hidden = true;
      return;
    }

    formView.hidden = true;
    statusView.hidden = false;

    const status = app.status || "Pending";
    const isPending = status === "Pending";
    const isApproved = status === "Approved";
    const isRejected = status === "Rejected";

    statusIconWrap.className = `status-icon-wrap ${status.toLowerCase()}`;
    statusIconWrap.textContent = isPending ? "◷" : isApproved ? "✓" : "×";

    statusKicker.textContent = `APPLICATION ${status.toUpperCase()}`;

    if (isPending) {
      statusTitle.textContent = "Your application is under review";
      statusMsg.textContent = "Our editorial team is reviewing your profile and storytelling activity. You will receive an in-app notification once a decision is made.";
      reapplyBtn.hidden = true;
    } else if (isApproved) {
      statusTitle.textContent = "You're an approved creator! 🎉";
      statusMsg.textContent = "Welcome to the Qalamly Creator Monetization Program! Your stories are now eligible for reader tips and creator earnings.";
      reapplyBtn.hidden = true;
    } else {
      statusTitle.textContent = "Application not approved at this time";
      statusMsg.textContent = app.review_note || app.reviewNote
        ? `Note from admin: "${escapeHTML(app.review_note || app.reviewNote)}"`
        : "Your application was declined. You are welcome to submit a new application as you publish more stories.";
      reapplyBtn.hidden = false;
    }

    const submittedDate = app.submitted_at || app.submittedAt;
    const dateFormatted = submittedDate ? new Date(submittedDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Recently";

    statusDetails.innerHTML = `
      <div><strong>Applicant:</strong> ${escapeHTML(app.name)} (${escapeHTML(app.handle)})</div>
      <div><strong>Email:</strong> ${escapeHTML(app.email)}</div>
      <div><strong>Submitted:</strong> ${escapeHTML(dateFormatted)}</div>
      <div><strong>Application ID:</strong> <code>${escapeHTML(app.id || "APP-REC")}</code></div>
      ${app.note ? `<div style="margin-top:6px;padding-top:6px;border-top:1px dashed #e2e2ec;"><strong>Your Note:</strong> <em>"${escapeHTML(app.note)}"</em></div>` : ""}
    `;
  }

  async function checkExistingApplication() {
    const user = getUser();
    const localSaved = localStorage.getItem(STORAGE_LOCAL_APP);
    let app = localSaved ? JSON.parse(localSaved) : null;

    // Check Supabase if available
    if (window.getSupabaseClient) {
      try {
        const sb = await window.getSupabaseClient();
        const query = user?.id
          ? sb.from("monetization_applications").select("*").or(`user_id.eq.${user.id},email.eq.${user.email || ""}`).order("submitted_at", { ascending: false }).limit(1)
          : app?.email
          ? sb.from("monetization_applications").select("*").eq("email", app.email).order("submitted_at", { ascending: false }).limit(1)
          : null;

        if (query) {
          const { data, error } = await query;
          if (!error && Array.isArray(data) && data.length > 0) {
            app = data[0];
            localStorage.setItem(STORAGE_LOCAL_APP, JSON.stringify(app));
          }
        }
      } catch (err) {
        console.warn("Could not check Supabase for application:", err);
      }
    }

    if (app) {
      renderApplicationStatus(app);
    } else {
      renderApplicationStatus(null);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    const user = getUser();
    const name = nameInput.value.trim();
    let handle = handleInput.value.trim();
    if (!handle.startsWith("@")) handle = `@${handle}`;
    const email = emailInput.value.trim().toLowerCase();
    const profileUrl = profileInput.value.trim();
    const note = noteInput.value.trim();

    if (!name || !handle || !email || !note) {
      showToast("Please fill in all required fields.", true);
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>Saving application...</span>`;

    const applicationRecord = {
      user_id: user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ? user.id : null,
      name,
      handle,
      email,
      profile_url: profileUrl,
      note,
      status: "Pending",
      submitted_at: new Date().toISOString()
    };

    let savedToDatabase = false;

    // Save directly to Supabase table
    if (window.getSupabaseClient) {
      try {
        const sb = await window.getSupabaseClient();
        const { data, error } = await sb.from("monetization_applications").insert(applicationRecord).select().single();
        if (!error && data) {
          applicationRecord.id = data.id;
          savedToDatabase = true;
        } else if (error) {
          console.warn("Supabase insert error:", error);
        }
      } catch (err) {
        console.warn("Could not write application to database:", err);
      }
    }

    if (!applicationRecord.id) {
      applicationRecord.id = `APP-${Date.now()}`;
    }

    // Save to local cache
    localStorage.setItem(STORAGE_LOCAL_APP, JSON.stringify(applicationRecord));

    // Also sync to admin storage demo key for dual compatibility
    try {
      const adminRaw = localStorage.getItem("qalamly-admin-demo-v1");
      const adminData = adminRaw ? JSON.parse(adminRaw) : {};
      const apps = Array.isArray(adminData.applications) ? adminData.applications : [];
      adminData.applications = [...apps.filter(a => a.email !== email), applicationRecord];
      localStorage.setItem("qalamly-admin-demo-v1", JSON.stringify(adminData));
    } catch {}

    submitBtn.disabled = false;
    submitBtn.innerHTML = `<span>Submit application for review</span><span aria-hidden="true">→</span>`;

    renderApplicationStatus(applicationRecord);
    showToast(savedToDatabase ? "Application saved to database and submitted for review!" : "Application submitted for admin review!");
  });

  reapplyBtn?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_LOCAL_APP);
    form.reset();
    updateCriteriaUI();
    renderApplicationStatus(null);
  });

  refreshStatusBtn?.addEventListener("click", async () => {
    refreshStatusBtn.textContent = "Checking...";
    await checkExistingApplication();
    refreshStatusBtn.textContent = "↻ Check status again";
    showToast("Application status refreshed.");
  });

  // Initialize
  document.addEventListener("DOMContentLoaded", () => {
    updateCriteriaUI();
    checkExistingApplication();
  });

  // Auto refresh if storage changes in another tab
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_LOCAL_APP || e.key === "qalamly-admin-demo-v1") {
      checkExistingApplication();
    }
  });
})();
