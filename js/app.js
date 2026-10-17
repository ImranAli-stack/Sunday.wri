(() => {
  "use strict";

  const STORAGE = {
    bookmarks: "qalamly.bookmarks.v2"
  };

  const STORY_CATEGORIES = [
    "Life", "Lifestyle", "Love", "Skill", "Creativity",
    "Poetry", "Story", "Short story", "Book review",
    "Story review", "Fiction", "Article", "Other"
  ];

  const STORY_LANGUAGES = [
    "English", "Urdu", "Roman Urdu", "Balochi", "Roman Balochi"
  ];

  const RTL_LANGUAGES = new Set(["Urdu", "Balochi"]);

  const feed = document.querySelector(".feed");
  const layout = document.querySelector(".layout");
  const toast = document.getElementById("toast");
  const authLink = document.getElementById("authLink");
  const headerProfile = document.getElementById("headerProfile");
  let supabase;
  let sessionUser = null;
  let profileRows = [];
  let postRows = [];
  let commentRows = [];
  let likeRows = [];
  let followRows = [];
  let notificationRows = [];
  let toastTimer;

  // --- STORAGE & STATE HELPERS ---
  function notify(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
  }

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      console.error("Storage read error:", e);
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error("Storage write error:", e);
      notify("Browser storage is full or restricted.");
    }
  }

  function users() {
    return profileRows;
  }

  function allPosts() {
    return postRows;
  }

  function mapProfile(row) {
    return {
      id: row.id,
      name: row.full_name || row.username || "Writer",
      poeticName: row.id === sessionUser?.id
        ? sessionUser.user_metadata?.poetic_name || row.full_name || row.username
        : row.full_name || row.username || "Writer",
      handle: row.username ? `@${row.username}` : "",
      bio: row.bio || "",
      role: row.role || "both",
      followers: Number(row.followers_count) || 0,
      following: Number(row.following_count) || 0,
      avatarUrl: row.avatar_url || ""
    };
  }

  function mapPost(row) {
    const author = profileRows.find((profile) => profile.id === row.user_id);
    const imagePath = row.image_path || "";
    const imageUrl = imagePath ? supabase.storage.from("post-images").getPublicUrl(imagePath).data.publicUrl : "";
    return {
      id: row.id,
      authorId: row.user_id,
      authorName: author ? displayName(author) : "Writer",
      title: row.title || "",
      category: row.category || "Other",
      language: row.language || "English",
      body: row.content || row.body || "",
      createdAt: row.created_at,
      likes: Number(row.likes_count ?? row.likes) || 0,
      status: row.status || "published",
      imagePath,
      imageUrl,
      imageData: ""
    };
  }

  async function loadRemoteData() {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    sessionUser = sessionData.session?.user || null;

    const profileFields = "id,username,full_name,bio,avatar_url,role,stories_count,followers_count,following_count,total_likes,total_comments,created_at";
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select(profileFields)
      .order("created_at", { ascending: false });
    if (profileError) throw profileError;
    profileRows = (profileData || []).map(mapProfile);

    let postsQuery = supabase.from("posts").select("*").order("created_at", { ascending: false });
    postsQuery = sessionUser
      ? postsQuery.or(`status.eq.published,user_id.eq.${sessionUser.id}`)
      : postsQuery.eq("status", "published");
    const { data: postsData, error: postsError } = await postsQuery;
    if (postsError) throw postsError;
    postRows = (postsData || []).map(mapPost);

    const { data: comments, error: commentsError } = await supabase
      .from("comments")
      .select("*")
      .order("created_at", { ascending: true });
    if (commentsError) throw commentsError;
    commentRows = (comments || []).map((row) => ({
      id: row.id, postId: row.post_id, authorId: row.user_id,
      authorName: row.author_name, content: row.content, createdAt: row.created_at
    }));

    if (sessionUser) {
      const [followsResult, likesResult, notificationsResult] = await Promise.all([
        supabase.from("follows").select("follower_id,following_id").eq("follower_id", sessionUser.id),
        supabase.from("likes_table").select("post_id,user_id").eq("user_id", sessionUser.id),
        supabase.from("notifications").select("*").eq("recipient_id", sessionUser.id).order("created_at", { ascending: false })
      ]);
      const failed = [followsResult, likesResult, notificationsResult].find((result) => result.error);
      if (failed?.error) throw failed.error;
      followRows = followsResult.data || [];
      likeRows = likesResult.data || [];
      notificationRows = (notificationsResult.data || []).map((row) => ({
        id: row.id, recipientId: row.recipient_id, postId: row.post_id,
        message: row.message, isRead: row.is_read, createdAt: row.created_at
      }));
    } else {
      followRows = [];
      likeRows = [];
      notificationRows = [];
    }

    if (!sessionUser) return null;
    let ownProfile = profileRows.find((profile) => profile.id === sessionUser.id);
    if (!ownProfile) {
      ownProfile = mapProfile({
        id: sessionUser.id,
        username: sessionUser.user_metadata?.poetic_name,
        full_name: sessionUser.user_metadata?.full_name,
        role: sessionUser.user_metadata?.role
      });
      profileRows.push(ownProfile);
    }
    return ownProfile;
  }

  async function savePostUpdate(post) {
    const record = {
      ...(post.id ? { id: post.id } : {}),
      user_id: sessionUser.id,
      title: post.title,
      content: post.body,
      category: post.category,
      language: post.language,
      status: post.status,
      image_path: post.imagePath || null
    };
    const { data, error } = await supabase.from("posts").upsert(record).select("*").single();
    if (error) throw error;
    const saved = mapPost(data);
    const index = postRows.findIndex((item) => item.id === saved.id);
    if (index < 0) postRows.unshift(saved);
    else postRows[index] = saved;
    return saved;
  }

  async function deletePostById(postId) {
    const { error } = await supabase.from("posts").delete().eq("id", postId).eq("user_id", sessionUser.id);
    if (error) throw error;
    postRows = postRows.filter((post) => post.id !== postId);
  }

  function currentUser() {
    return sessionUser ? users().find((user) => user.id === sessionUser.id) || null : null;
  }

  function displayName(user) {
    return user?.poeticName || user?.name || "Writer";
  }

  function canWrite(user) {
    return Boolean(user && (user.role === "writer" || user.role === "both" || !user.role));
  }

  function bookmarkList() {
    const all = readStore(STORAGE.bookmarks, {});
    const key = currentUser()?.id || "guest";
    return Array.isArray(all[key]) ? all[key] : [];
  }

  function toggleBookmark(postId) {
    const all = readStore(STORAGE.bookmarks, {});
    const key = currentUser()?.id || "guest";
    const list = Array.isArray(all[key]) ? all[key] : [];
    const isSaved = list.includes(postId);
    all[key] = isSaved ? list.filter((id) => id !== postId) : [...new Set([...list, postId])];
    writeStore(STORAGE.bookmarks, all);
    return !isSaved;
  }

  function likedPostsList() {
    return likeRows.filter((like) => like.user_id === sessionUser?.id).map((like) => like.post_id);
  }

  async function toggleLike(postId) {
    if (!sessionUser) throw new Error("Log in to like a story.");
    const wasLiked = likedPostsList().includes(postId);
    const query = wasLiked
      ? supabase.from("likes_table").delete().eq("post_id", postId).eq("user_id", sessionUser.id)
      : supabase.from("likes_table").insert({ post_id: postId, user_id: sessionUser.id });
    const { error } = await query;
    if (error) throw error;
    likeRows = wasLiked
      ? likeRows.filter((like) => !(like.post_id === postId && like.user_id === sessionUser.id))
      : [...likeRows, { post_id: postId, user_id: sessionUser.id }];
    const target = allPosts().find((p) => p.id === postId);
    if (target) {
      const nextLikes = Math.max(0, Number(target.likes || 0) + (wasLiked ? -1 : 1));
      target.likes = nextLikes;
      return { liked: !wasLiked, count: nextLikes };
    }
    return { liked: !wasLiked, count: 0 };
  }

  function commentsForPost(postId) {
    return commentRows
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async function addCommentToPost(postId, content) {
    const user = currentUser();
    if (!user) throw new Error("Log in to leave a response.");
    const { data, error } = await supabase.from("comments").insert({
      post_id: postId,
      user_id: user.id,
      author_name: displayName(user),
      content: content.trim()
    }).select("*").single();
    if (error) throw error;
    const comment = {
      id: data.id, postId: data.post_id, authorId: data.user_id,
      authorName: data.author_name, content: data.content, createdAt: data.created_at
    };
    commentRows.push(comment);
    return comment;
  }

  async function deleteCommentById(commentId) {
    const user = currentUser();
    if (!user) return;
    const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("user_id", user.id);
    if (error) throw error;
    commentRows = commentRows.filter((comment) => comment.id !== commentId);
  }

  function followingList(userId) {
    const id = userId || currentUser()?.id;
    return followRows.filter((follow) => follow.follower_id === id).map((follow) => follow.following_id);
  }

  function followersCountFor(writerId) {
    const baseWriter = users().find((u) => u.id === writerId);
    return Number(baseWriter?.followers || 0);
  }

  async function toggleFollowWriter(targetWriterId) {
    const user = currentUser();
    if (!user) throw new Error("Log in to follow writers.");
    if (user.id === targetWriterId) throw new Error("You cannot follow yourself.");
    const isFollowing = followingList(user.id).includes(targetWriterId);
    const query = isFollowing
      ? supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", targetWriterId)
      : supabase.from("follows").insert({ follower_id: user.id, following_id: targetWriterId });
    const { error } = await query;
    if (error) throw error;
    followRows = isFollowing
      ? followRows.filter((follow) => !(follow.follower_id === user.id && follow.following_id === targetWriterId))
      : [...followRows, { follower_id: user.id, following_id: targetWriterId }];
    updateHeader();
    return !isFollowing;
  }

  function notificationsForCurrentUser() {
    const user = currentUser();
    if (!user) return [];
    return notificationRows;
  }

  async function markAllNotificationsRead() {
    const user = currentUser();
    if (!user) return;
    const { error } = await supabase.from("notifications").update({ is_read: true }).eq("recipient_id", user.id);
    if (error) throw error;
    notificationRows = notificationRows.map((notification) => ({ ...notification, isRead: true }));
    updateHeader();
  }

  // --- FORMATTING HELPERS ---
  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function initials(name) {
    return String(name || "W")
      .trim()
      .split(/\s+/)
      .map((part) => part[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "Q";
  }

  function formatDate(value) {
    try {
      return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
    } catch {
      return "Recent";
    }
  }

  function readingMinutes(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 200));
  }

  // --- HEADER, NAVIGATION & GLOBAL CONNECTIONS ---
  function ensureGlobalNavConnections() {
    const topbar = document.querySelector(".topbar");
    if (topbar && !document.getElementById("notifNavLink")) {
      const notifLink = document.createElement("a");
      notifLink.id = "notifNavLink";
      notifLink.className = "notif-bell";
      notifLink.href = "notifications.html";
      notifLink.setAttribute("aria-label", "Notifications");
      notifLink.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg><span class="notif-badge" id="notifBadge" hidden>0</span>`;
      if (authLink) topbar.insertBefore(notifLink, authLink);
    }

    const leftSidebar = document.querySelector(".left-sidebar");
    if (leftSidebar && !leftSidebar.querySelector('a[href="writers.html"]')) {
      const settingsLink = leftSidebar.querySelector('a[href="settings.html"]');
      const writersLink = document.createElement("a");
      writersLink.className = "side-link";
      writersLink.href = "writers.html";
      writersLink.setAttribute("data-side-link", "");
      writersLink.innerHTML = `<span class="side-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg></span> Writers`;
      const notifSideLink = document.createElement("a");
      notifSideLink.className = "side-link";
      notifSideLink.href = "notifications.html";
      notifSideLink.setAttribute("data-side-link", "");
      notifSideLink.innerHTML = `<span class="side-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg></span> Notifications`;
      if (settingsLink) {
        leftSidebar.insertBefore(writersLink, settingsLink);
        leftSidebar.insertBefore(notifSideLink, settingsLink);
      }
    }
  }

  function updateHeader() {
    ensureGlobalNavConnections();
    const user = currentUser();
    const writeLink = document.getElementById("writeLink");
    const notifBadge = document.getElementById("notifBadge");

    if (!user) {
      if (authLink) {
        authLink.hidden = false;
        authLink.href = "login.html";
        authLink.textContent = "Log in";
      }
      if (headerProfile) headerProfile.hidden = true;
      if (writeLink) writeLink.href = "write.html";
      if (notifBadge) notifBadge.hidden = true;
      return;
    }

    const ownPublished = allPosts().filter((p) => p.authorId === user.id && p.status === "published");
    const followers = followersCountFor(user.id);
    const following = followingList(user.id).length;
    const unreadNotifs = notificationsForCurrentUser().filter((n) => !n.isRead).length;

    if (notifBadge) {
      notifBadge.hidden = unreadNotifs === 0;
      notifBadge.textContent = String(unreadNotifs);
    }

    if (authLink) {
      authLink.hidden = false;
      authLink.href = "index.html?logout=1";
      authLink.textContent = "Log out";
    }

    if (headerProfile) {
      headerProfile.hidden = false;
      const nameEl = document.getElementById("headerName");
      const avatarEl = document.getElementById("headerAvatar");
      const storiesStat = headerProfile.querySelector("[data-header-stories]");
      const followersStat = headerProfile.querySelector("[data-header-followers]");
      const followingStat = headerProfile.querySelector("[data-header-following]");
      const fallbackStats = document.getElementById("headerStats");

      if (nameEl) nameEl.textContent = displayName(user);
      if (avatarEl) avatarEl.textContent = initials(displayName(user));

      if (storiesStat && followersStat && followingStat) {
        storiesStat.textContent = String(ownPublished.length);
        followersStat.textContent = String(followers);
        followingStat.textContent = String(following);
      } else if (fallbackStats) {
        fallbackStats.textContent = `${ownPublished.length} stories · ${followers} followers · ${following} following`;
      }
    }
  }

  function routeParts() {
    const pageAttr = document.body.dataset.page;
    const file = location.pathname.split("/").pop().replace(/\.html$/, "");
    const raw = pageAttr || file || "home";
    const path = raw === "index" || raw === "" ? "home" : raw;
    const params = new URLSearchParams(location.search);
    return { path, params };
  }

  function navigate(route) {
    const value = String(route || "").replace(/^#/, "");
    if (value === "logout") {
      supabase.auth.signOut().then(({ error }) => {
        if (error) throw error;
        location.href = "index.html";
      }).catch((error) => {
        console.error("Supabase sign-out failed:", error);
        notify("Unable to log out. Please try again.");
      });
      return;
    }
    if (value.startsWith("post/")) {
      location.href = `post.html?id=${encodeURIComponent(value.slice(5))}`;
      return;
    }
    if (value.endsWith(".html") || value.includes(".html?")) {
      location.href = value;
      return;
    }
    const pageMap = {
      home: "index.html",
      about: "about.html",
      contact: "contact.html",
      competitions: "competitions.html",
      login: "login.html",
      signup: "signup.html",
      dashboard: "dashboard.html",
      write: "write.html",
      bookmarks: "bookmarks.html",
      settings: "settings.html",
      post: "post.html",
      writers: "writers.html",
      profile: "profile.html",
      notifications: "notifications.html"
    };
    const [base, query = ""] = value.split("?");
    const targetFile = pageMap[base] || "index.html";
    location.href = query ? `${targetFile}?${query}` : targetFile;
  }

  function setPage(content, options = {}) {
    if (layout) {
      layout.classList.toggle("content-only", Boolean(options.contentOnly));
      layout.classList.toggle("detail-only", Boolean(options.detailOnly));
    }
    if (feed) feed.innerHTML = content;
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  function pageHero(kicker, title, description) {
    return `<section class="page-hero"><div class="page-kicker">${escapeHTML(kicker)}</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></section>`;
  }

  // --- CARD BUILDER ---
  function createPostCardHTML(post) {
    const savedBookmarks = bookmarkList();
    const likedList = likedPostsList();
    const isSaved = savedBookmarks.includes(post.id);
    const isLiked = likedList.includes(post.id);
    const commentCount = commentsForPost(post.id).length;
    const mins = readingMinutes(post.body);
    const isRTL = RTL_LANGUAGES.has(post.language);
    const artClass = post.artClass || "art-journal";
    const artEmoji = post.artEmoji || "✒️";
    const coverHTML = post.imageUrl || post.imageData
      ? `<div class="post-image"><img src="${escapeHTML(post.imageUrl || post.imageData)}" alt="${escapeHTML(post.title)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;"></div>`
      : `<div class="post-image ${escapeHTML(artClass)}" aria-label="Story illustration"><span>${artEmoji}</span></div>`;

    return `
      <article class="post-card" tabindex="0" data-post-id="${escapeHTML(post.id)}" data-category="${escapeHTML(post.category)}" data-language="${escapeHTML(post.language || "English")}" data-likes="${Number(post.likes) || 0}" data-date="${escapeHTML(post.createdAt)}" aria-label="Read story: ${escapeHTML(post.title)}">
        <div class="post-content" ${isRTL ? 'dir="rtl" lang="ur"' : ""}>
          <div class="post-author" dir="ltr">
            <a href="profile.html?id=${encodeURIComponent(post.authorId || "")}" class="author-profile-trigger" style="display:inline-flex;align-items:center;gap:8px;">
              <div class="avatar purple">${escapeHTML(initials(post.authorName))}</div>
              <span class="author-name">${escapeHTML(post.authorName)}</span>
            </a>
            <span class="post-date">· ${escapeHTML(formatDate(post.createdAt))}</span>
          </div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;" dir="ltr">
            <span class="category-label">${escapeHTML((post.category || "Life").toUpperCase())}</span>
            ${post.language && post.language !== "English" ? `<span class="category-label lang-badge">${escapeHTML(post.language)}</span>` : ""}
          </div>
          <h3 class="post-title">${escapeHTML(post.title)}</h3>
          <p class="post-excerpt">${escapeHTML(post.body.slice(0, 190))}${post.body.length > 190 ? "..." : ""}</p>
          <div class="post-footer" dir="ltr">
            <div class="post-meta">
              <span>♥ <span class="like-count">${Number(post.likes) || 0}</span></span>
              <span>· ${mins} min read</span>
              <span>· 💬 ${commentCount}</span>
            </div>
            <div class="post-actions">
              <button class="icon-button like-button ${isLiked ? "liked" : ""}" type="button" aria-label="Like this story" aria-pressed="${isLiked}">${isLiked ? "♥" : "♡"}</button>
              <button class="icon-button bookmark-button ${isSaved ? "bookmarked" : ""}" type="button" aria-label="Bookmark this story" aria-pressed="${isSaved}">${isSaved ? "🔖" : "🏷️"}</button>
            </div>
          </div>
        </div>
        ${coverHTML}
      </article>
    `;
  }

  // --- RIGHT SIDEBAR HYDRATION (HOME) ---
  function hydrateRightSidebar() {
    const writerSuggestions = document.getElementById("writerSuggestions");
    const followed = followingList();
    if (writerSuggestions) {
      const currentId = currentUser()?.id;
      const list = users().filter((u) => u.id !== currentId).slice(0, 4);
      writerSuggestions.innerHTML = list.map((w) => {
        const isFollowing = followed.includes(w.id);
        return `
          <div class="person">
            <a href="profile.html?id=${encodeURIComponent(w.id)}" style="display:flex;align-items:center;gap:9px;flex:1;min-width:0;">
              <div class="avatar ${escapeHTML(w.avatarColor || "purple")}">${escapeHTML(initials(displayName(w)))}</div>
              <div class="person-info">
                <strong>${escapeHTML(displayName(w))}</strong>
                <span>${escapeHTML(w.bio || "Qalamly community writer")}</span>
              </div>
            </a>
            <button class="follow-button ${isFollowing ? "following" : ""}" type="button" data-follow-id="${escapeHTML(w.id)}">${isFollowing ? "Following" : "Follow"}</button>
          </div>
        `;
      }).join("");
    }

    const trendingContainer = document.getElementById("trendingPosts");
    if (trendingContainer) {
      const topPosts = allPosts()
        .filter((p) => p.status === "published")
        .sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
        .slice(0, 3);
      trendingContainer.innerHTML = topPosts.map((p, idx) => `
        <a class="trending-item" href="post.html?id=${encodeURIComponent(p.id)}">
          <span class="trend-number">0${idx + 1}</span>
          <div>
            <strong>${escapeHTML(p.title)}</strong>
            <span>${escapeHTML(p.category)} · ${Number(p.likes || 0)} likes</span>
          </div>
        </a>
      `).join("");
    }
  }

  // --- PAGE RENDERERS ---
  function showHome(params) {
    if (layout) layout.classList.remove("content-only", "detail-only");

    const initialTopic = params.get("topic") || "All";
    const initialQuery = params.get("q") || "";
    const initialLang = params.get("lang") || "All";

    // Build dynamic topic list in left sidebar
    const topicContainer = document.getElementById("topicList");
    if (topicContainer) {
      topicContainer.innerHTML = ["All", ...STORY_CATEGORIES].map((cat) => `
        <button class="topic-chip ${cat === initialTopic ? "selected" : ""}" type="button" data-topic="${escapeHTML(cat)}">
          ${cat === "All" ? "All stories" : escapeHTML(cat)}
        </button>
      `).join("");
    }

    feed.innerHTML = `
      <section class="welcome-banner" aria-label="Welcome">
        <div class="welcome-copy">
          <div class="eyebrow">A little corner of the internet</div>
          <h1>Good stories live here.</h1>
          <p>Fresh ideas, honest words, and perspectives in English, Urdu, and Balochi.</p>
        </div>
        <div class="banner-decoration" aria-hidden="true">✒️</div>
      </section>
      <div class="section-heading">
        <div>
          <h2 id="feedHeading">${initialTopic === "All" ? "Public dashboard" : `${escapeHTML(initialTopic)} stories`}</h2>
          <p id="resultCount" aria-live="polite">Stories shared by the Qalamly community.</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <label>
            <span class="sr-only">Filter by language</span>
            <select class="sort-select" id="langSelect" aria-label="Filter by language">
              <option value="All">All languages</option>
              ${STORY_LANGUAGES.map((l) => `<option value="${escapeHTML(l)}" ${initialLang === l ? "selected" : ""}>${escapeHTML(l)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span class="sr-only">Sort stories</span>
            <select class="sort-select" id="sortSelect" aria-label="Sort stories">
              <option value="latest">Most recent</option>
              <option value="popular">Most loved</option>
            </select>
          </label>
        </div>
      </div>
      <section class="post-list" id="postList" aria-label="All blog posts"></section>
      <div class="empty-state" id="emptyState">No stories found. Try a different search, language, or topic.</div>
    `;

    const postListEl = document.getElementById("postList");
    const searchInput = document.getElementById("searchInput");
    const sortSelect = document.getElementById("sortSelect");
    const langSelect = document.getElementById("langSelect");

    if (searchInput && initialQuery) {
      searchInput.value = initialQuery;
    }

    let activeTopic = initialTopic;

    function renderFeedCards() {
      const query = (searchInput?.value || "").trim().toLowerCase();
      const lang = langSelect?.value || "All";
      const sortBy = sortSelect?.value || "latest";

      const published = allPosts().filter((p) => p.status === "published");
      const filtered = published.filter((p) => {
        const topicMatch = activeTopic === "All" || p.category.toLowerCase() === activeTopic.toLowerCase();
        const langMatch = lang === "All" || (p.language || "English") === lang;
        const queryMatch = !query ||
          p.title.toLowerCase().includes(query) ||
          p.body.toLowerCase().includes(query) ||
          p.authorName.toLowerCase().includes(query) ||
          p.category.toLowerCase().includes(query);
        return topicMatch && langMatch && queryMatch;
      });

      filtered.sort((a, b) =>
        sortBy === "popular"
          ? Number(b.likes || 0) - Number(a.likes || 0)
          : new Date(b.createdAt) - new Date(a.createdAt)
      );

      postListEl.innerHTML = filtered.map(createPostCardHTML).join("");
      const emptyEl = document.getElementById("emptyState");
      if (emptyEl) emptyEl.style.display = filtered.length ? "none" : "block";

      const headingEl = document.getElementById("feedHeading");
      if (headingEl) headingEl.textContent = activeTopic === "All" ? "Public dashboard" : `${activeTopic} stories`;

      const countEl = document.getElementById("resultCount");
      if (countEl) {
        countEl.textContent = query || activeTopic !== "All" || lang !== "All"
          ? `${filtered.length} ${filtered.length === 1 ? "story" : "stories"} found`
          : "Stories shared by the Qalamly community.";
      }
    }

    renderFeedCards();
    hydrateRightSidebar();

    if (searchInput) searchInput.oninput = renderFeedCards;
    if (sortSelect) sortSelect.onchange = renderFeedCards;
    if (langSelect) langSelect.onchange = renderFeedCards;

    document.querySelectorAll("#topicList [data-topic]").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTopic = btn.dataset.topic;
        document.querySelectorAll("#topicList [data-topic]").forEach((b) => b.classList.toggle("selected", b === btn));
        renderFeedCards();
      });
    });
  }

  function renderDetail(id) {
    const post = allPosts().find((p) => p.id === id);
    const user = currentUser();
    const isOwner = Boolean(user && post && post.authorId === user.id);

    if (!post || (post.status !== "published" && !isOwner)) {
      setPage(
        `<div class="page-view"><section class="page-hero"><div class="page-kicker">Story unavailable</div><h1>We couldn't find that story.</h1><p>It may have been removed or is a private draft.</p><a class="primary-button" href="index.html">Back to stories</a></section></div>`,
        { detailOnly: true }
      );
      return;
    }

    const isLiked = likedPostsList().includes(post.id);
    const isSaved = bookmarkList().includes(post.id);
    const isRTL = RTL_LANGUAGES.has(post.language);
    const comments = commentsForPost(post.id);

    const coverHTML = post.imageUrl || post.imageData
      ? `<div class="detail-cover"><img src="${escapeHTML(post.imageUrl || post.imageData)}" alt="${escapeHTML(post.title)}" style="width:100%;max-height:380px;object-fit:cover;border-radius:14px;"></div>`
      : `<div class="detail-cover ${escapeHTML(post.artClass || "art-journal")}" aria-hidden="true">${post.artEmoji || "✒️"}</div>`;

    const commentsHTML = comments.length
      ? comments.map((c) => `
          <div class="comment-item">
            <div class="comment-header">
              <a href="profile.html?id=${encodeURIComponent(c.authorId || "")}"><strong>${escapeHTML(c.authorName)}</strong></a>
              <span>${escapeHTML(formatDate(c.createdAt))}</span>
              ${user && user.id === c.authorId ? `<button type="button" class="comment-delete" data-delete-comment="${escapeHTML(c.id)}" data-post-id="${escapeHTML(post.id)}">Delete</button>` : ""}
            </div>
            <p>${escapeHTML(c.content)}</p>
          </div>
        `).join("")
      : `<p class="sidebar-promo-copy">No responses yet. Start the conversation below.</p>`;

    setPage(
      `<div class="page-view">
        <a class="detail-back" href="${isOwner ? "dashboard.html" : "index.html"}">← Back to ${isOwner ? "your dashboard" : "stories"}</a>
        <article class="detail-article">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <span class="category-label">${escapeHTML(post.category.toUpperCase())}</span>
            <span class="category-label lang-badge">${escapeHTML(post.language || "English")}</span>
            ${post.status === "draft" ? `<span class="status-pill draft">Private Draft</span>` : ""}
          </div>
          <h1 ${isRTL ? 'dir="rtl" lang="ur"' : ""}>${escapeHTML(post.title)}</h1>
          <div class="detail-byline">
            <a href="profile.html?id=${encodeURIComponent(post.authorId || "")}" style="display:flex;align-items:center;gap:9px;">
              <div class="avatar purple">${escapeHTML(initials(post.authorName))}</div>
              <div>
                <strong>${escapeHTML(post.authorName)}</strong>
                <span>${escapeHTML(formatDate(post.createdAt))} · ${readingMinutes(post.body)} min read</span>
              </div>
            </a>
          </div>
          ${coverHTML}
          <div class="detail-body" ${isRTL ? 'dir="rtl" lang="ur"' : ""}>${escapeHTML(post.body)}</div>
          <div class="detail-actions">
            <button class="primary-button" type="button" data-like-detail="${escapeHTML(post.id)}">${isLiked ? "♥ Liked" : "♡ Like"} · ${Number(post.likes) || 0}</button>
            <button class="secondary-button" type="button" data-bookmark-detail="${escapeHTML(post.id)}">${isSaved ? "🔖 Bookmarked" : "🏷️ Bookmark"}</button>
            <button class="secondary-button" type="button" data-share-post="${escapeHTML(post.id)}">Share link</button>
            ${isOwner ? `<a class="secondary-button" href="write.html?edit=${encodeURIComponent(post.id)}">Edit story</a>` : ""}
          </div>
        </article>

        <section class="page-card" style="margin-top:20px;">
          <h2>Responses (${comments.length})</h2>
          ${user ? `
            <form id="commentForm" data-post-id="${escapeHTML(post.id)}" style="margin-bottom:18px;">
              <div class="form-field">
                <label for="commentInput">Share a thoughtful response</label>
                <textarea id="commentInput" name="content" rows="3" maxlength="1000" required placeholder="What resonated with you in this story?"></textarea>
              </div>
              <button class="primary-button" type="submit">Post response</button>
            </form>
          ` : `<p class="form-note" style="margin-bottom:14px;"><a class="panel-link" href="login.html">Log in</a> to leave a response on this story.</p>`}
          <div class="comments-list">${commentsHTML}</div>
        </section>
      </div>`,
      { detailOnly: true }
    );
  }

  function renderDashboard(tab = "all") {
    const user = currentUser();
    if (!user) {
      sessionStorage.setItem("qalamly.next", "dashboard");
      navigate("login.html");
      return;
    }

    const ownAll = allPosts().filter((p) => p.authorId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const published = ownAll.filter((p) => p.status === "published");
    const drafts = ownAll.filter((p) => p.status === "draft");
    const shown = tab === "published" ? published : tab === "draft" ? drafts : ownAll;
    const followers = followersCountFor(user.id);
    const following = followingList(user.id).length;

    const listHTML = shown.length
      ? shown.map((post) => `
          <div class="dashboard-post">
            <div class="dashboard-post-main">
              <strong>${escapeHTML(post.title)}</strong>
              <span>${escapeHTML(post.category)} · ${escapeHTML(post.language || "English")} · ${escapeHTML(formatDate(post.createdAt))} · ♥ ${Number(post.likes) || 0}</span>
            </div>
            <span class="status-pill ${post.status === "draft" ? "draft" : ""}">${post.status === "draft" ? "Private draft" : "Published"}</span>
            <a class="dashboard-open" href="${post.status === "draft" ? `write.html?edit=${encodeURIComponent(post.id)}` : `post.html?id=${encodeURIComponent(post.id)}`}">${post.status === "draft" ? "Resume" : "Read"}</a>
            <a class="dashboard-open" href="write.html?edit=${encodeURIComponent(post.id)}">Edit</a>
            <button class="dashboard-delete" type="button" data-delete-post="${escapeHTML(post.id)}">Delete</button>
          </div>
        `).join("")
      : `<div class="empty-dashboard">No stories in this tab yet. Start writing whenever inspiration strikes!</div>`;

    setPage(
      `<div class="page-view">
        <section class="page-hero">
          <div class="page-kicker">Your private space · ${escapeHTML(user.role || "writer")}</div>
          <h1>Welcome, ${escapeHTML(displayName(user))}</h1>
          <p>${escapeHTML(user.bio || "Your drafts stay private; published stories appear in the community feed.")}</p>
          <div class="dashboard-actions">
            ${canWrite(user) ? '<a class="primary-button" href="write.html">+ Write a story</a>' : '<a class="primary-button" href="settings.html">Enable writing in Settings</a>'}
            <a class="secondary-button" href="profile.html?id=${encodeURIComponent(user.id)}">View public profile</a>
            <a class="secondary-button" href="settings.html">Settings</a>
            <button class="secondary-button" type="button" data-signout>Log out</button>
          </div>
        </section>
        <div class="dashboard-stats" id="userStories">
          <div class="dashboard-stat"><strong>${ownAll.length}</strong><span>Total stories</span></div>
          <div class="dashboard-stat"><strong>${published.length}</strong><span>Published</span></div>
          <div class="dashboard-stat"><strong>${drafts.length}</strong><span>Private drafts</span></div>
          <div class="dashboard-stat" id="userFollowers"><strong>${followers}</strong><span>Followers</span></div>
          <div class="dashboard-stat" id="userFollowing"><strong>${following}</strong><span>Following</span></div>
        </div>
        <section class="page-card">
          <h2>Manage your writing</h2>
          <div class="dashboard-tabs">
            <button class="dashboard-tab ${tab === "all" ? "active" : ""}" data-dashboard-tab="all">All (${ownAll.length})</button>
            <button class="dashboard-tab ${tab === "published" ? "active" : ""}" data-dashboard-tab="published">Published (${published.length})</button>
            <button class="dashboard-tab ${tab === "draft" ? "active" : ""}" data-dashboard-tab="draft">Drafts (${drafts.length})</button>
          </div>
          ${listHTML}
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderWriter(message = "", editId = "") {
    const user = currentUser();
    if (!user) {
      sessionStorage.setItem("qalamly.next", "write");
      navigate("login.html");
      return;
    }
    if (!canWrite(user)) {
      setPage(
        `<div class="page-view">${pageHero("Reader account", "Ready to share your own voice?", "Switch your account role to 'Writer' or 'Reader and writer' in settings to start publishing.")}<section class="page-card"><a class="primary-button" href="settings.html">Update account role</a></section></div>`,
        { contentOnly: true }
      );
      return;
    }

    const existing = editId ? allPosts().find((p) => p.id === editId && p.authorId === user.id) : null;
    const title = existing?.title || "";
    const body = existing?.body || "";
    const category = existing?.category || "Life";
    const language = existing?.language || "English";

    setPage(
      `<div class="page-view">
        ${pageHero(existing ? "Editing your story" : "Make something yours", existing ? "Update story" : "Write a story", "Write in English, Urdu, or Balochi. Publish to the community or save a private draft.")}
        <section class="page-card page-form" style="max-width:100%;">
          <div class="form-error ${message ? "visible" : ""}" id="writerError" role="alert">${escapeHTML(message)}</div>
          <form id="writerForm" data-edit-id="${escapeHTML(existing?.id || "")}" novalidate>
            <div class="form-field">
              <label for="postTitle">Story title</label>
              <input id="postTitle" name="title" maxlength="150" required placeholder="Give your story a compelling title..." value="${escapeHTML(title)}">
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">
              <div class="form-field">
                <label for="postCategory">Topic</label>
                <select id="postCategory" name="category">
                  ${STORY_CATEGORIES.map((c) => `<option value="${escapeHTML(c)}" ${category === c ? "selected" : ""}>${escapeHTML(c)}</option>`).join("")}
                </select>
              </div>
              <div class="form-field">
                <label for="postLanguage">Language</label>
                <select id="postLanguage" name="language">
                  ${STORY_LANGUAGES.map((l) => `<option value="${escapeHTML(l)}" ${language === l ? "selected" : ""}>${escapeHTML(l)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="form-field">
              <label for="postImage">Cover Image <span class="form-label-note">(optional, max 2MB)</span></label>
              <input id="postImage" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
            </div>
            <div class="form-field">
              <label for="postBody">Your story</label>
              <textarea id="postBody" name="body" rows="12" maxlength="50000" required placeholder="Start with the detail you can't stop thinking about..." ${RTL_LANGUAGES.has(language) ? 'dir="rtl" lang="ur"' : ""}>${escapeHTML(body)}</textarea>
            </div>
            <div class="modal-actions writer-actions">
              <button class="primary-button" type="submit" name="status" value="published">Publish story</button>
              <button class="secondary-button" type="submit" name="status" value="draft">Save private draft</button>
            </div>
          </form>
        </section>
      </div>`,
      { contentOnly: true }
    );

    const langSelect = document.getElementById("postLanguage");
    const bodyArea = document.getElementById("postBody");
    if (langSelect && bodyArea) {
      langSelect.addEventListener("change", () => {
        const isRTL = RTL_LANGUAGES.has(langSelect.value);
        bodyArea.dir = isRTL ? "rtl" : "ltr";
      });
    }
  }

  function renderBookmarks() {
    const ids = bookmarkList();
    const savedStories = ids
      .map((id) => allPosts().find((p) => p.id === id))
      .filter((p) => p && (p.status === "published" || p.authorId === currentUser()?.id));

    const rows = savedStories.length
      ? savedStories.map(createPostCardHTML).join("")
      : `<div class="empty-dashboard">Your reading list is empty. Click the bookmark icon on any story to save it for later.</div>`;

    setPage(
      `<div class="page-view">
        ${pageHero("Saved for another day", "Your bookmarks", "A personal reading list of stories you want to revisit.")}
        <section class="post-list">${rows}</section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderWritersPage() {
    const queryInput = document.getElementById("searchInput");
    const followed = followingList();
    const currentId = currentUser()?.id;

    function buildWritersList(filterText = "") {
      const q = filterText.trim().toLowerCase();
      const list = users().filter((w) => {
        if (w.id === currentId) return false;
        if (!q) return true;
        return (
          displayName(w).toLowerCase().includes(q) ||
          (w.bio || "").toLowerCase().includes(q) ||
          (w.handle || "").toLowerCase().includes(q)
        );
      });

      return list.map((w) => {
        const isFollowing = followed.includes(w.id);
        const count = allPosts().filter((p) => p.authorId === w.id && p.status === "published").length;
        return `
          <div class="page-card" style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
            <a href="profile.html?id=${encodeURIComponent(w.id)}" style="display:flex;align-items:center;gap:14px;flex:1;min-width:0;">
              <div class="avatar ${escapeHTML(w.avatarColor || "purple")}" style="width:48px;height:48px;font-size:15px;">${escapeHTML(initials(displayName(w)))}</div>
              <div style="min-width:0;">
                <strong style="font-size:15px;display:block;">${escapeHTML(displayName(w))}</strong>
                <span style="font-size:11px;color:var(--muted);display:block;margin:3px 0;">${escapeHTML(w.handle || "")} · ${count} stories · ${followersCountFor(w.id)} followers</span>
                <p style="margin:4px 0 0;font-size:12px;">${escapeHTML(w.bio || "Writer in the Qalamly community.")}</p>
              </div>
            </a>
            <button class="follow-button ${isFollowing ? "following" : ""}" style="padding:9px 14px;font-size:11px;" type="button" data-follow-id="${escapeHTML(w.id)}">${isFollowing ? "Following" : "Follow"}</button>
          </div>
        `;
      }).join("");
    }

    setPage(
      `<div class="page-view">
        ${pageHero("Qalamly Community", "Writers to follow", "Meet the storytellers, poets, and essayists shaping Qalamly.")}
        <div id="writersDirectory">${buildWritersList(queryInput?.value || "")}</div>
      </div>`,
      { contentOnly: false }
    );

    if (queryInput) {
      queryInput.oninput = () => {
        const dir = document.getElementById("writersDirectory");
        if (dir) dir.innerHTML = buildWritersList(queryInput.value);
      };
    }
  }

  function renderProfilePage(writerId) {
    const target = users().find((u) => u.id === writerId) || currentUser();
    if (!target) {
      setPage(`<div class="page-view">${pageHero("Profile unavailable", "We couldn't find this writer.", "The profile may have been removed or is not public.")}</div>`, { contentOnly: true });
      return;
    }
    const isSelf = currentUser()?.id === target.id;
    const isFollowing = followingList().includes(target.id);
    const writerPosts = allPosts()
      .filter((p) => p.authorId === target.id && p.status === "published")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    setPage(
      `<div class="page-view">
        <section class="page-hero">
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
            <div class="avatar ${escapeHTML(target.avatarColor || "purple")}" style="width:64px;height:64px;font-size:20px;">${escapeHTML(initials(displayName(target)))}</div>
            <div style="flex:1;min-width:200px;">
              <div class="page-kicker">${escapeHTML(target.handle || "@writer")}</div>
              <h1 style="margin:4px 0;">${escapeHTML(displayName(target))}</h1>
              <p>${escapeHTML(target.bio || "Writer and reader on Qalamly.")}</p>
            </div>
            ${!isSelf ? `<button class="primary-button" type="button" data-follow-id="${escapeHTML(target.id)}">${isFollowing ? "Following" : "Follow writer"}</button>` : `<a class="secondary-button" href="settings.html">Edit profile</a>`}
          </div>
          <div class="dashboard-stats" style="margin-top:20px;margin-bottom:0;">
            <div class="dashboard-stat"><strong>${writerPosts.length}</strong><span>Published stories</span></div>
            <div class="dashboard-stat"><strong>${followersCountFor(target.id)}</strong><span>Followers</span></div>
            <div class="dashboard-stat"><strong>${Number(target.following || followingList(target.id).length)}</strong><span>Following</span></div>
          </div>
        </section>
        <h2 style="font-size:18px;margin:22px 0 12px;">Stories by ${escapeHTML(displayName(target))}</h2>
        <section class="post-list">
          ${writerPosts.length ? writerPosts.map(createPostCardHTML).join("") : `<div class="empty-dashboard">No public stories published yet.</div>`}
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderNotificationsPage() {
    const user = currentUser();
    if (!user) {
      sessionStorage.setItem("qalamly.next", "notifications");
      navigate("login.html");
      return;
    }

    const list = notificationsForCurrentUser();
    const rows = list.length
      ? list.map((n) => `
          <div class="dashboard-post" style="${!n.isRead ? "background:#f8f6ff;padding-left:10px;padding-right:10px;border-radius:10px;" : ""}">
            <div class="dashboard-post-main">
              <strong>${escapeHTML(n.message)}</strong>
              <span>${escapeHTML(formatDate(n.createdAt))}</span>
            </div>
            ${n.postId ? `<a class="dashboard-open" href="post.html?id=${encodeURIComponent(n.postId)}">View story</a>` : ""}
          </div>
        `).join("")
      : `<div class="empty-dashboard">You're all caught up! New likes, comments, and followers will appear here.</div>`;

    setPage(
      `<div class="page-view">
        ${pageHero("Activity", "Your notifications", "Updates when readers engage with your stories.")}
        <section class="page-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h2 style="margin:0;">Recent activity</h2>
            ${list.some((n) => !n.isRead) ? `<button class="secondary-button" type="button" id="markReadBtn">Mark all as read</button>` : ""}
          </div>
          ${rows}
        </section>
      </div>`,
      { contentOnly: true }
    );

    const markBtn = document.getElementById("markReadBtn");
    if (markBtn) {
      markBtn.addEventListener("click", async () => {
        try {
          await markAllNotificationsRead();
          renderNotificationsPage();
          notify("All notifications marked as read.");
        } catch (error) {
          console.error("Unable to mark notifications as read:", error);
          notify(error.message || "Unable to update notifications.");
        }
      });
    }
  }

  function renderAbout() {
    setPage(
      `<div class="page-view">
        ${pageHero("A place to put your words", "Stories make a little more room for us.", "Qalamly is a welcoming home for personal essays, poetry, and stories in English, Urdu, and Balochi.")}
        <section class="page-card">
          <h2>Made for writers at every stage</h2>
          <p>Some people arrive with a notebook full of drafts. Some arrive with one sentence they cannot stop thinking about. Qalamly is for both. Read the community's public stories, join a monthly prompt, and share your own work when you are ready.</p>
        </section>
        <section class="page-card">
          <h2>Community guidelines</h2>
          <p>Be generous with one another. Credit the work that inspires you. Share writing that is yours to share, and help us keep the conversation curious, kind, and welcoming.</p>
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderContact() {
    setPage(
      `<div class="page-view">
        ${pageHero("We'd love to hear from you", "Say hello.", "Questions, ideas, kind words, or feedback about Qalamly—send us a message below.")}
        <section class="page-card page-form">
          <h2>Send a message</h2>
          <form id="contactForm">
            <div class="form-field"><label for="contactName">Your name</label><input id="contactName" required placeholder="Your name"></div>
            <div class="form-field"><label for="contactEmail">Your email</label><input id="contactEmail" type="email" required placeholder="you@example.com"></div>
            <div class="form-field"><label for="contactMsg">Message</label><textarea id="contactMsg" rows="5" required placeholder="How can we help?"></textarea></div>
            <button class="primary-button" type="submit">Send message</button>
          </form>
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderCompetitions() {
    setPage(
      `<div class="page-view">
        ${pageHero("Community writing prompts", "No active prompt right now", "New writing prompts will appear here when they are available.")}
        <section class="page-card">
          <h2>Have a story to share?</h2>
          <p>Write about any topic you care about and publish it for the Qalamly community.</p>
          <a class="primary-button" href="write.html">Write a story</a>
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderSettings(message = "") {
    const user = currentUser();
    if (!user) {
      navigate("login.html");
      return;
    }
    setPage(
      `<div class="page-view">
        ${pageHero("Your account", "Profile settings", "Customize how your name, bio, and pen name appear across Qalamly.")}
        <section class="page-card page-form">
          <div class="form-error ${message ? "visible" : ""}" id="settingsError" role="alert">${escapeHTML(message)}</div>
          <form id="settingsFormPage" novalidate>
            <div class="form-field"><label for="settingsName">Full name</label><input id="settingsName" name="name" required maxlength="60" value="${escapeHTML(user.name)}"></div>
            <div class="form-field"><label for="settingsPoeticName">Poetic / Pen name</label><input id="settingsPoeticName" name="poeticName" required maxlength="60" value="${escapeHTML(displayName(user))}"></div>
            <div class="form-field"><label for="settingsHandle">Profile handle</label><input id="settingsHandle" name="handle" required maxlength="30" value="${escapeHTML(user.handle || "")}"></div>
            <div class="form-field"><label for="settingsBio">Short bio</label><textarea id="settingsBio" name="bio" rows="3" maxlength="200">${escapeHTML(user.bio || "")}</textarea></div>
            <div class="form-field">
              <label for="settingsRole">Account role</label>
              <select id="settingsRole" name="role">
                <option value="reader" ${user.role === "reader" ? "selected" : ""}>Reader</option>
                <option value="writer" ${user.role === "writer" ? "selected" : ""}>Writer</option>
                <option value="both" ${user.role === "both" || !user.role ? "selected" : ""}>Reader and writer</option>
              </select>
            </div>
            <button class="primary-button" type="submit">Save changes</button>
          </form>
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function renderAuth(mode, message = "") {
    if (currentUser()) {
      navigate("dashboard.html");
      return;
    }
    const signup = mode === "signup";
    setPage(
      `<div class="page-view">
        ${pageHero(signup ? "A page of your own" : "Your words are waiting", signup ? "Create your Qalamly account" : "Welcome back", signup ? "Join Qalamly to keep private drafts, follow writers, and publish stories." : "Log in to pick up where your reading and writing left off.")}
        <section class="page-card page-form">
          <div class="form-error ${message ? "visible" : ""}" id="authError" role="alert">${escapeHTML(message)}</div>
          <form id="authForm" novalidate>
            ${signup ? '<div class="form-field"><label for="authName">Your name</label><input id="authName" name="name" required maxlength="60" placeholder="Your full name"></div>' : ""}
            ${signup ? '<div class="form-field"><label for="authPoeticName">Poetic name <span class="form-label-note">(your pen name)</span></label><input id="authPoeticName" name="poeticName" required maxlength="60" placeholder="The name readers will see"></div>' : ""}
            <div class="form-field"><label for="authEmail">Email</label><input id="authEmail" name="email" type="email" required placeholder="you@example.com"></div>
            <div class="form-field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" required minlength="${signup ? "8" : "1"}" placeholder="${signup ? "At least 8 characters" : "Your password"}"></div>
            ${signup ? '<div class="form-field"><label for="authConfirmPassword">Confirm password</label><input id="authConfirmPassword" name="confirmPassword" type="password" required minlength="8" placeholder="Re-enter password"></div>' : ""}
            ${signup ? '<div class="form-field"><label for="accountRole">I am here as a</label><select id="accountRole" name="role"><option value="reader">Reader</option><option value="writer">Writer</option><option value="both" selected>Reader and writer</option></select></div>' : ""}
            <button class="primary-button" type="submit">${signup ? "Create account" : "Log in"}</button>
          </form>
          <p class="form-note">${signup ? 'Already registered? <a class="panel-link" href="login.html">Log in</a>.' : 'New to Qalamly? <a class="panel-link" href="signup.html">Create an account</a>.'}</p>
        </section>
      </div>`,
      { contentOnly: true }
    );
  }

  function showFormError(msg) {
    const err = document.querySelector(".form-error");
    if (err) {
      err.textContent = msg;
      err.classList.add("visible");
    }
  }

  // --- ROUTER DISPATCH ---
  function renderRoute() {
    updateHeader();
    const { path, params } = routeParts();

    const activeFile = path === "home" ? "index.html" : `${path}.html`;
    document.querySelectorAll(".top-nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === activeFile));
    document.querySelectorAll("[data-side-link]").forEach((a) => a.classList.toggle("selected", a.getAttribute("href") === activeFile));

    // Global search bar connection from non-home pages
    const globalSearch = document.getElementById("searchInput");
    if (globalSearch && path !== "home" && path !== "writers") {
      globalSearch.onkeydown = (e) => {
        if (e.key === "Enter" && globalSearch.value.trim()) {
          e.preventDefault();
          navigate(`index.html?q=${encodeURIComponent(globalSearch.value.trim())}`);
        }
      };
    }

    switch (path) {
      case "home": showHome(params); break;
      case "about": renderAbout(); break;
      case "contact": renderContact(); break;
      case "competitions": renderCompetitions(); break;
      case "bookmarks": renderBookmarks(); break;
      case "dashboard": renderDashboard(params.get("tab") || "all"); break;
      case "write": renderWriter("", params.get("edit") || ""); break;
      case "settings": renderSettings(); break;
      case "login":
      case "signup": renderAuth(path); break;
      case "post": renderDetail(params.get("id") || ""); break;
      case "writers": renderWritersPage(); break;
      case "profile": renderProfilePage(params.get("id") || ""); break;
      case "notifications": renderNotificationsPage(); break;
      default: showHome(params);
    }
  }

  // --- GLOBAL EVENT LISTENERS ---
  document.addEventListener("click", async (event) => {
    const signout = event.target.closest("[data-signout]");
    if (signout) {
      navigate("logout");
      return;
    }

    const tabBtn = event.target.closest("[data-dashboard-tab]");
    if (tabBtn) {
      renderDashboard(tabBtn.dataset.dashboardTab);
      return;
    }

    const deletePostBtn = event.target.closest("[data-delete-post]");
    if (deletePostBtn) {
      const id = deletePostBtn.dataset.deletePost;
      try {
        await deletePostById(id);
        notify("Story deleted.");
        renderDashboard("all");
        updateHeader();
      } catch (error) {
        console.error("Unable to delete story:", error);
        notify(error.message || "Unable to delete this story.");
      }
      return;
    }

    const followBtn = event.target.closest("[data-follow-id]");
    if (followBtn) {
      event.preventDefault();
      const writerId = followBtn.dataset.followId;
      try {
        const nowFollowing = await toggleFollowWriter(writerId);
        followBtn.classList.toggle("following", nowFollowing);
        followBtn.textContent = nowFollowing ? "Following" : "Follow";
        notify(nowFollowing ? "Writer followed!" : "Unfollowed writer.");
      } catch (error) {
        console.error("Unable to update follow:", error);
        notify(error.message || "Unable to update your follow.");
      }
      return;
    }

    const detailLike = event.target.closest("[data-like-detail]");
    if (detailLike) {
      const id = detailLike.dataset.likeDetail;
      try {
        const res = await toggleLike(id);
        detailLike.textContent = `${res.liked ? "♥ Liked" : "♡ Like"} · ${res.count}`;
      } catch (error) {
        console.error("Unable to update like:", error);
        notify(error.message || "Unable to update your like.");
      }
      return;
    }

    const detailBookmark = event.target.closest("[data-bookmark-detail]");
    if (detailBookmark) {
      const id = detailBookmark.dataset.bookmarkDetail;
      const saved = toggleBookmark(id);
      detailBookmark.textContent = saved ? "🔖 Bookmarked" : "🏷️ Bookmark";
      notify(saved ? "Saved to bookmarks" : "Removed from bookmarks");
      return;
    }

    const shareBtn = event.target.closest("[data-share-post]");
    if (shareBtn) {
      const url = `${location.origin}${location.pathname.replace(/[^/]+$/, "")}post.html?id=${encodeURIComponent(shareBtn.dataset.sharePost)}`;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => notify("Story link copied to clipboard!"));
      } else {
        notify("Share URL: " + url);
      }
      return;
    }

    const deleteComment = event.target.closest("[data-delete-comment]");
    if (deleteComment) {
      try {
        await deleteCommentById(deleteComment.dataset.deleteComment);
        renderDetail(deleteComment.dataset.postId);
        notify("Response removed.");
      } catch (error) {
        console.error("Unable to delete response:", error);
        notify(error.message || "Unable to delete this response.");
      }
      return;
    }

    const likeButton = event.target.closest(".like-button");
    if (likeButton) {
      event.stopPropagation();
      const card = likeButton.closest(".post-card");
      if (!card) return;
      try {
        const res = await toggleLike(card.dataset.postId);
        likeButton.setAttribute("aria-pressed", String(res.liked));
        likeButton.classList.toggle("liked", res.liked);
        likeButton.textContent = res.liked ? "♥" : "♡";
        const countEl = card.querySelector(".like-count");
        if (countEl) countEl.textContent = String(res.count);
      } catch (error) {
        console.error("Unable to update like:", error);
        notify(error.message || "Unable to update your like.");
      }
      return;
    }

    const bookmarkButton = event.target.closest(".bookmark-button");
    if (bookmarkButton) {
      event.stopPropagation();
      const card = bookmarkButton.closest(".post-card");
      if (!card) return;
      const saved = toggleBookmark(card.dataset.postId);
      bookmarkButton.setAttribute("aria-pressed", String(saved));
      bookmarkButton.classList.toggle("bookmarked", saved);
      bookmarkButton.textContent = saved ? "🔖" : "🏷️";
      notify(saved ? "Story saved to bookmarks" : "Removed from bookmarks");
      return;
    }

    const card = event.target.closest(".post-card[data-post-id]");
    if (card && !event.target.closest("button") && !event.target.closest("a")) {
      navigate(`post/${card.dataset.postId}`);
    }
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;

    if (form.id === "contactForm") {
      event.preventDefault();
      const subject = encodeURIComponent(`Qalamly message from ${form.elements.contactName.value.trim()}`);
      const body = encodeURIComponent(
        `From: ${form.elements.contactName.value.trim()} (${form.elements.contactEmail.value.trim()})\n\n${form.elements.contactMsg.value.trim()}`
      );
      location.href = `mailto:hello@qalamly.com?subject=${subject}&body=${body}`;
      notify("Your email app should open with your message.");
      return;
    }

    if (form.id === "commentForm") {
      event.preventDefault();
      const postId = form.dataset.postId;
      const content = form.elements.content.value.trim();
      if (!content) return;
      try {
        await addCommentToPost(postId, content);
        renderDetail(postId);
        notify("Response published!");
      } catch (error) {
        console.error("Unable to publish response:", error);
        showFormError(error.message || "Unable to publish your response.");
      }
      return;
    }

    if (form.id === "authForm") {
      event.preventDefault();
      try {
      const isSignup = routeParts().path === "signup";
      const email = form.elements.email.value.trim().toLowerCase();
      const password = form.elements.password.value;

      if (isSignup) {
        const name = form.elements.name.value.trim();
        const poeticName = form.elements.poeticName.value.trim();
        const confirm = form.elements.confirmPassword.value;
        const role = form.elements.role.value;
        if (name.length < 2 || poeticName.length < 2) { showFormError("Please enter your name and poetic pen name."); return; }
        if (password.length < 8) { showFormError("Password must be at least 8 characters."); return; }
        if (password !== confirm) { showFormError("Passwords do not match."); return; }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, poetic_name: poeticName, role } }
        });
        if (error) { showFormError(error.message); return; }
        if (!data.session) {
          showFormError("Check your email to confirm your account, then log in.");
          return;
        }
        sessionUser = data.user;
        await loadRemoteData();
        navigate("dashboard.html");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { showFormError(error.message); return; }
        await loadRemoteData();
        const next = sessionStorage.getItem("qalamly.next") || "dashboard";
        sessionStorage.removeItem("qalamly.next");
        navigate(`${next}.html`);
      }
      } catch (error) {
        console.error("Authentication request failed:", error);
        showFormError(error.message || "Unable to authenticate. Please try again.");
      }
      return;
    }

    if (form.id === "writerForm") {
      event.preventDefault();
      const user = currentUser();
      if (!user) { navigate("login.html"); return; }

      const title = form.elements.title.value.trim();
      const body = form.elements.body.value.trim();
      const category = form.elements.category.value;
      const language = form.elements.language.value;
      const status = event.submitter?.value === "draft" ? "draft" : "published";
      const editId = form.dataset.editId;

      if (!title || body.length < 10) {
        showFormError("Please enter a title and at least 10 characters for your story.");
        return;
      }

      const existing = editId ? allPosts().find((p) => p.id === editId) : null;
      const fileInput = form.elements.image;
      let imagePath = existing?.imagePath || "";
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        if (file.size > 2 * 1024 * 1024) {
          showFormError("Image must be under 2MB.");
          return;
        }
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        imagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        try {
          const { error } = await supabase.storage.from("post-images").upload(imagePath, file, { upsert: false });
          if (error) { showFormError(error.message); return; }
        } catch (error) {
          console.error("Unable to upload story image:", error);
          showFormError(error.message || "Unable to upload the cover image.");
          return;
        }
      }
      const postObj = {
        ...(existing ? { id: existing.id } : {}),
        authorId: user.id,
        title,
        category,
        language,
        body,
        imagePath,
        status,
        likes: existing?.likes || 0
      };

      try {
        await savePostUpdate(postObj);
        notify(status === "draft" ? "Draft saved privately." : "Story published to Qalamly!");
        navigate("dashboard.html");
      } catch (error) {
        console.error("Unable to save story:", error);
        showFormError(error.message || "Unable to save your story.");
      }
      return;
    }

    if (form.id === "settingsFormPage") {
      event.preventDefault();
      const user = currentUser();
      if (!user) return;
      const name = form.elements.name.value.trim();
      const poeticName = form.elements.poeticName.value.trim();
      let handle = form.elements.handle.value.trim().replace(/\s+/g, "");
      const bio = form.elements.bio.value.trim();
      const role = form.elements.role.value;

      const username = handle.replace(/^@/, "").toLowerCase();
      let error;
      try {
        ({ error } = await supabase.from("profiles").update({
          full_name: name, username, bio, role
        }).eq("id", user.id));
      } catch (requestError) {
        console.error("Unable to update profile:", requestError);
        showFormError(requestError.message || "Unable to save profile settings.");
        return;
      }
      if (error) {
        console.error("Unable to update profile:", error);
        showFormError(error.message || "Unable to save profile settings.");
        return;
      }
      let metadataError;
      try {
        ({ error: metadataError } = await supabase.auth.updateUser({
          data: { full_name: name, poetic_name: poeticName, role }
        }));
      } catch (requestError) {
        console.error("Profile saved, but account metadata update failed:", requestError);
        showFormError("Profile details saved, but your pen name could not be updated.");
        return;
      }
      if (metadataError) {
        console.error("Profile fields saved, but account metadata update failed:", metadataError);
        showFormError("Profile details saved, but your pen name could not be updated.");
        return;
      }
      try {
        await loadRemoteData();
        updateHeader();
        notify("Profile settings saved.");
        navigate("dashboard.html");
      } catch (loadError) {
        console.error("Profile saved but refresh failed:", loadError);
        notify("Profile saved, but refreshing the page data failed.");
      }
    }
  });

  async function startApp() {
    try {
      supabase = await window.getSupabaseClient();
      const user = await loadRemoteData();
      if (user && !profileRows.some((profile) => profile.id === user.id)) profileRows.push(user);
      renderRoute();
    } catch (error) {
      console.error("Unable to load Qalamly from Supabase:", error);
      setPage(
        `<div class="page-view"><section class="page-hero"><div class="page-kicker">Connection problem</div><h1>Qalamly couldn't load its data.</h1><p>${escapeHTML(error.message || "Check your connection and Supabase configuration, then try again.")}</p><button class="primary-button" type="button" onclick="location.reload()">Try again</button></section></div>`,
        { contentOnly: true }
      );
    }
  }

  startApp();
})();