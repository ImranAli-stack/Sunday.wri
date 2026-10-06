    (() => {
      "use strict";

      const SUPABASE_URL = "https://xjdrqktoeodohyoynphg.supabase.co";
      const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LzIX4TdfqXDldsfjnsO8sQ_zYs4di_B";
      const SUPABASE_SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      let supabaseClient;
      let supabaseLoadPromise;

      async function getSupabaseClient() {
        if (!window.supabase?.createClient) {
          if (!supabaseLoadPromise) {
            supabaseLoadPromise = new Promise((resolve, reject) => {
              const script = document.createElement("script");
              script.src = SUPABASE_SDK_URL;
              script.onload = resolve;
              script.onerror = () => reject(new Error("Supabase could not load. Check your connection and try again."));
              document.head.appendChild(script);
            });
          }
          await supabaseLoadPromise;
        }
        if (!window.supabase?.createClient) {
          throw new Error("Supabase could not initialize. Refresh the page and try again.");
        }
        if (!supabaseClient) {
          supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
        }
        return supabaseClient;
      }

      const STORAGE = {
        users: "sunday.users.v1",
        posts: "sunday.posts.v1",
        session: "sunday.session.v1"
      };
      const feed = document.querySelector(".feed");
      const layout = document.querySelector(".layout");
      const originalHome = feed.innerHTML;
      const toast = document.getElementById("toast");
      const authLink = document.getElementById("authLink");
      const headerProfile = document.getElementById("headerProfile");
      let toastTimer;
      let activeDashboardTab = "all";

      function notify(message) {
        toast.textContent = message;
        toast.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
      }

      function readStore(key, fallback) {
        try {
          const value = localStorage.getItem(key);
          return value === null ? fallback : JSON.parse(value);
        } catch (error) {
          console.error(`Unable to read ${key} from browser storage.`, error);
          notify("Saved browser data could not be read. Try clearing this site's local data.");
          return fallback;
        }
      }

      function writeStore(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
          console.error(`Unable to save ${key} to browser storage.`, error);
          throw new Error("Your browser could not save this change. Check available storage and try again.");
        }
      }

      function users() {
        const value = readStore(STORAGE.users, []);
        return Array.isArray(value) ? value : [];
      }

      function posts() {
        const value = readStore(STORAGE.posts, []);
        return Array.isArray(value) ? value : [];
      }

      function updatePostCommentCount(postId, count) {
        const savedPosts = posts();
        const post = savedPosts.find((item) => item.id === postId);
        if (post) {
          post.commentCount = count;
          try {
            writeStore(STORAGE.posts, savedPosts);
          } catch (error) {
            console.error("Unable to save the updated comment count locally.", error);
            notify("Your comment was posted, but the story count may not refresh until the next page load.");
          }
        }

        document.querySelectorAll(".post-card[data-post-id]").forEach((card) => {
          if (card.dataset.postId !== postId) return;
          card.dataset.comments = String(count);
          const commentCount = card.querySelector(".comment-count");
          if (commentCount) commentCount.textContent = String(count);
        });
      }

      function normalizeRemotePost(post) {
        const likesCount = Array.isArray(post.likes_table) && post.likes_table[0]
          ? Number(post.likes_table[0].count)
          : Number(post.likes) || 0;
        const commentsCount = Array.isArray(post.comments) && post.comments[0]
          ? Number(post.comments[0].count)
          : Number(post.commentCount) || 0;
        return {
          id: String(post.id),
          title: post.title || "Untitled story",
          category: post.category || "Lifestyle",
          body: post.content || post.body || "",
          authorId: post.user_id || post.author_id || "",
          authorName: post.author_name || post.full_name || "Writer",
          status: post.status || "published",
          likes: likesCount,
          commentCount: commentsCount,
          imagePath: post.image_path || "",
          createdAt: post.created_at || post.createdAt || new Date().toISOString()
        };
      }

      function postImageUrl(imagePath) {
        if (!imagePath) return "";
        const encodedPath = imagePath.split("/").map(encodeURIComponent).join("/");
        return `${SUPABASE_URL}/storage/v1/object/public/post-images/${encodedPath}`;
      }

      function safePostImageUrl(imagePath) {
        const imageUrl = postImageUrl(imagePath);
        return imageUrl.startsWith(`${SUPABASE_URL}/storage/v1/object/public/post-images/`) ? imageUrl : "";
      }

      async function syncRemotePosts() {
        writeStore(STORAGE.posts, posts().filter((post) => post.status === "draft"));
        const { data, error } = await (await getSupabaseClient())
          .from("posts")
          .select("*, likes_table(count), comments(count)")
          .eq("status", "published")
          .order("created_at", { ascending: false });
        if (error) throw error;

        const remotePosts = data.map(normalizeRemotePost);
        const localDrafts = posts().filter((post) => post.status === "draft");
        writeStore(STORAGE.posts, [...localDrafts, ...remotePosts]);
      }

      async function deleteUserPost(postId) {
        const user = currentUser();
        const post = posts().find((item) => item.id === postId);
        if (!user || !post || post.authorId !== user.id) {
          throw new Error("You can only delete stories from your own account.");
        }

        if (post.status === "published") {
          const client = await getSupabaseClient();
          const { data: authData, error: authError } = await client.auth.getUser();
          if (authError) throw authError;
          if (!authData.user || authData.user.id !== user.id) {
            throw new Error("Your Supabase session is no longer active. Log in again before deleting.");
          }
          const { data, error } = await client.from("posts")
            .delete()
            .eq("id", post.id)
            .eq("user_id", authData.user.id)
            .select("id")
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("The story could not be deleted. It may no longer exist or you may not own it.");
        }

        writeStore(STORAGE.posts, posts().filter((item) => item.id !== post.id));
        const savedBookmarks = readStore("sunday.bookmarks.v1", {});
        const bookmarks = savedBookmarks && typeof savedBookmarks === "object" && !Array.isArray(savedBookmarks)
          ? savedBookmarks
          : {};
        Object.keys(bookmarks).forEach((key) => {
          if (Array.isArray(bookmarks[key])) bookmarks[key] = bookmarks[key].filter((id) => id !== post.id);
        });
        writeStore("sunday.bookmarks.v1", bookmarks);

        if (routeParts().path === "post") {
          navigate("dashboard.html");
        } else if (routeParts().path === "dashboard") {
          renderDashboard(activeDashboardTab);
        } else if (routeParts().path === "home") {
          showHome();
        }
        notify("Your story has been deleted");
      }

      function currentUser() {
        const id = readStore(STORAGE.session, null);
        return id ? users().find((user) => user.id === id) || null : null;
      }

      function displayName(user) {
        return user?.poeticName || user?.name || "Writer";
      }

      function canWrite(user) {
        return user && (user.role === "writer" || user.role === "both" || !user.role);
      }

      function bookmarkList() {
        const all = readStore("sunday.bookmarks.v1", {});
        const user = currentUser();
        return Array.isArray(all[user?.id || "guest"]) ? all[user?.id || "guest"] : [];
      }

      function saveBookmark(id, saved) {
        const all = readStore("sunday.bookmarks.v1", {});
        const user = currentUser();
        const key = user?.id || "guest";
        const values = Array.isArray(all[key]) ? all[key] : [];
        all[key] = saved ? [...new Set([...values, id])] : values.filter((item) => item !== id);
        writeStore("sunday.bookmarks.v1", all);
      }

      async function renderFollowSuggestions() {
        const container = document.getElementById("writerSuggestions");
        if (!container) return;
        const user = currentUser();
        const writers = [...new Map(posts()
          .filter((post) => post.status === "published" && post.authorId && post.authorName)
          .filter((post) => !user || post.authorId !== user.id)
          .map((post) => [post.authorId, post])).values()].slice(0, 3);

        if (!writers.length) {
          container.innerHTML = '<p class="sidebar-promo-copy">No other writers to follow yet. Check back after more stories are published.</p>';
          return;
        }

        let followingIds = new Set();
        if (user) {
          try {
            const client = await getSupabaseClient();
            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData.user || authData.user.id !== user.id) {
              throw new Error("Your Supabase session has expired. Log in again to follow writers.");
            }
            const { data, error } = await client.from("follows")
              .select("following_id")
              .eq("follower_id", user.id);
            if (error) throw error;
            followingIds = new Set(data.map((follow) => follow.following_id));
          } catch (error) {
            console.error("Unable to load followed writers.", error);
            container.innerHTML = '<p class="sidebar-promo-copy">Following could not be loaded. Please refresh and try again.</p>';
            return;
          }
        }

        container.innerHTML = writers.map((writer) => {
          const following = followingIds.has(writer.authorId);
          const button = user
            ? `<button class="follow-button${following ? " following" : ""}" type="button" data-follow-user="${escapeHTML(writer.authorId)}" aria-pressed="${following}">${following ? "Following" : "Follow"}</button>`
            : '<a class="follow-button" href="login.html">Log in</a>';
          return `<div class="person"><div class="avatar purple">${escapeHTML(initials(writer.authorName))}</div><div class="person-info"><strong>${escapeHTML(writer.authorName)}</strong><span>${escapeHTML(writer.category)} writer</span></div>${button}</div>`;
        }).join("");
      }

      async function toggleFollow(followButton) {
        const user = currentUser();
        if (!user) {
          navigate("login.html");
          return;
        }
        const targetId = followButton.dataset.followUser;
        if (!targetId || targetId === user.id) return;

        followButton.disabled = true;
        try {
          const client = await getSupabaseClient();
          const { data: authData, error: authError } = await client.auth.getUser();
          if (authError) throw authError;
          if (!authData.user || authData.user.id !== user.id) {
            throw new Error("Your Supabase session has expired. Log in again to follow writers.");
          }

          const isFollowing = followButton.getAttribute("aria-pressed") === "true";
          if (isFollowing) {
            const { error } = await client.from("follows")
              .delete()
              .eq("follower_id", user.id)
              .eq("following_id", targetId);
            if (error) throw error;
          } else {
            const { error } = await client.from("follows")
              .insert({ follower_id: user.id, following_id: targetId });
            if (error) throw error;
          }

          await renderFollowSuggestions();
          notify(isFollowing ? "You unfollowed this writer" : "You’re now following this writer");
        } catch (error) {
          console.error("Unable to update followed writers.", error);
          notify(error instanceof Error ? error.message : "Following could not be updated.");
        } finally {
          followButton.disabled = false;
        }
      }

      function escapeHTML(value) {
        return String(value).replace(/[&<>"']/g, (char) => ({
          "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        })[char]);
      }

      function initials(name) {
        return name.trim().split(/\s+/).map((part) => part[0] || "").join("").slice(0, 2).toUpperCase();
      }

      function updateHeader() {
        const user = currentUser();
        if (!user) {
          authLink.hidden = false;
          authLink.href = "login.html";
          authLink.textContent = "Log in";
          headerProfile.hidden = true;
          document.getElementById("writeLink").href = "write.html";
          return;
        }
        const ownPosts = posts().filter((post) => post.authorId === user.id);
        authLink.hidden = false;
        authLink.href = "index.html?logout=1";
        authLink.textContent = "Log out";
        headerProfile.hidden = false;
        headerProfile.href = "dashboard.html";
        document.getElementById("headerName").textContent = displayName(user);
        document.getElementById("headerStats").textContent = `${ownPosts.length} stories · ${user.followers || 0} followers · ${user.following || 0} following`;
        document.getElementById("headerAvatar").textContent = initials(user.name);
        document.getElementById("writeLink").href = "write.html";
      }

      function navigate(route) {
        const value = String(route || "").replace(/^#/, "");
        if (value.endsWith(".html") || value.includes(".html?")) {
          location.href = new URL(value, location.href).href;
          return;
        }
        if (value === "logout") {
          writeStore(STORAGE.session, null);
          location.href = "index.html";
          return;
        }
        if (value.startsWith("post/")) {
          location.href = `post.html?id=${encodeURIComponent(value.slice(5))}`;
          return;
        }
        if (value.startsWith("dashboard/")) {
          location.href = `dashboard.html?tab=${encodeURIComponent(value.slice(10))}`;
          return;
        }
        const [path, query = ""] = value.split("?");
        const page = {
          home: "index.html", about: "about.html", contact: "contact.html",
          competitions: "competitions.html", login: "login.html", signup: "signup.html",
          dashboard: "dashboard.html", write: "write.html", bookmarks: "bookmarks.html",
          settings: "settings.html", post: "post.html"
        }[path];
        if (!page) {
          location.href = "index.html";
          return;
        }
        const params = new URLSearchParams(query);
        const target = new URL(page, location.href);
        params.forEach((paramValue, key) => target.searchParams.set(key, paramValue));
        location.href = target.href;
      }

      function setPage(content, options = {}) {
        layout.classList.toggle("content-only", Boolean(options.contentOnly));
        layout.classList.toggle("detail-only", Boolean(options.detailOnly));
        feed.innerHTML = content;
        window.scrollTo({ top: 0, behavior: "auto" });
      }

      function formatDate(value) {
        return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
      }

      function routeParts() {
        const route = document.body.dataset.page || location.pathname.split("/").pop().replace(/\.html$/, "") || "home";
        const params = new URLSearchParams(location.search);
        if (route === "index" || route === "") return { path: "home", params };
        return { path: route, params };
      }

      function showHome() {
        layout.classList.remove("content-only", "detail-only");
        feed.innerHTML = originalHome;
        const cardList = feed.querySelector("#postList");
        cardList.replaceChildren();
        posts().filter((post) => post.status === "published")
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .forEach((post) => cardList.appendChild(createPostCard(post)));
        const savedBookmarks = bookmarkList();
        cardList.querySelectorAll(".post-card").forEach((card) => {
          const button = card.querySelector(".bookmark-button");
          if (!button) return;
          const saved = savedBookmarks.includes(card.dataset.postId);
          button.setAttribute("aria-pressed", String(saved));
          button.classList.toggle("bookmarked", saved);
          button.textContent = saved ? "▣" : "♧";
        });
        const queryInput = document.getElementById("searchInput");
        const sortSelect = document.getElementById("sortSelect");
        let topic = "All";
        function filter() {
          const query = queryInput.value.trim().toLowerCase();
          let count = 0;
          cardList.querySelectorAll(".post-card").forEach((card) => {
            const matches = (topic === "All" || card.dataset.category === topic)
              && (!query || card.textContent.toLowerCase().includes(query));
            card.hidden = !matches;
            if (matches) count++;
          });
          document.getElementById("emptyState").style.display = count ? "none" : "block";
          document.getElementById("resultCount").textContent = query || topic !== "All"
            ? `${count} ${count === 1 ? "story" : "stories"} found`
            : "All the good things, in one place.";
        }
        function sort() {
          const cards = [...cardList.querySelectorAll(".post-card")];
          cards.sort((a, b) => sortSelect.value === "popular"
            ? Number(b.dataset.likes) - Number(a.dataset.likes)
            : new Date(b.dataset.date) - new Date(a.dataset.date));
          cards.forEach((card) => cardList.appendChild(card));
          filter();
        }
        queryInput.addEventListener("input", filter);
        sortSelect.addEventListener("change", sort);
        feed.querySelectorAll("[data-topic]").forEach((button) => button.addEventListener("click", () => {
          topic = button.dataset.topic;
          feed.querySelectorAll("[data-topic]").forEach((item) => item.classList.toggle("selected", item === button));
          filter();
        }));
        renderFollowSuggestions();
        document.querySelectorAll(".top-nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === "#home"));
      }

      function createPostCard(post) {
        const card = document.createElement("article");
        card.className = "post-card";
        card.dataset.postId = post.id;
        card.dataset.category = post.category;
        card.dataset.likes = String(post.likes || 0);
        card.dataset.date = post.createdAt.slice(0, 10);
        card.dataset.title = post.title;
        card.dataset.imagePath = post.imagePath || "";
        card.tabIndex = 0;
        card.setAttribute("aria-label", `Read story: ${post.title}`);
        card.dataset.fullBody = post.body;
        const readingMinutes = Math.max(1, Math.ceil(post.body.trim().split(/\s+/).length / 200));
        const imageUrl = safePostImageUrl(post.imagePath);
        card.innerHTML = `<div class="post-content">
          <div class="post-author"><div class="avatar purple">${escapeHTML(initials(post.authorName))}</div><span class="author-name">${escapeHTML(post.authorName)}</span><span class="post-date">· ${escapeHTML(formatDate(post.createdAt))}</span></div>
          <span class="category-label">${escapeHTML(post.category.toUpperCase())}</span>
          <h3 class="post-title">${escapeHTML(post.title)}</h3>
          <p class="post-excerpt">${escapeHTML(post.body.slice(0, 190))}${post.body.length > 190 ? "…" : ""}</p>
          <div class="post-footer"><div class="post-meta"><span>♡ <span class="like-count">${Number(post.likes) || 0}</span></span><span>◷ ${readingMinutes} min read</span><span aria-label="Comments">◯ <span class="comment-count">${Number(post.commentCount) || 0}</span></span></div>
          <div class="post-actions"><button class="icon-button like-button" type="button" aria-label="Like this story" aria-pressed="false">♡</button><button class="icon-button bookmark-button" type="button" aria-label="Bookmark this story" aria-pressed="false">♧</button></div></div></div>
          <div class="post-image art-journal" aria-label="${imageUrl ? "Story picture" : "Illustration for this story"}">${imageUrl ? "" : "<span>✍️</span>"}</div>`;
        if (imageUrl) {
          const image = document.createElement("img");
          image.className = "post-image-source";
          image.src = imageUrl;
          image.alt = `Picture for ${post.title}`;
          card.querySelector(".post-image").appendChild(image);
        }
        return card;
      }

      function fullBodyFor(post) {
        return post.body;
      }

      function findPost(id) {
        const saved = posts().find((post) => post.id === id);
        if (saved) return saved;
        const card = [...document.querySelectorAll(".post-card")].find((item) => item.dataset.postId === id);
        if (!card) return null;
        return {
          id, title: card.querySelector(".post-title").textContent,
          body: card.dataset.fullBody || card.querySelector(".post-excerpt").textContent,
          category: card.dataset.category, authorName: card.querySelector(".author-name").textContent,
          createdAt: new Date(card.dataset.date).toISOString(), likes: Number(card.dataset.likes),
          imagePath: card.dataset.imagePath || "", status: "published"
        };
      }

      function renderDetail(id) {
        const post = findPost(id);
        const user = currentUser();
        const isOwner = Boolean(user && post && post.authorId === user.id);
        if (!post || post.status !== "published" && !isOwner) {
          setPage('<div class="page-view"><section class="page-hero"><div class="page-kicker">Story unavailable</div><h1>We couldn’t find that story.</h1><p>It may have been removed or is not public.</p><a class="primary-button" href="index.html">Back to stories</a></section></div>', { detailOnly: true });
          return;
        }
        const imageUrl = safePostImageUrl(post.imagePath);
        const content = `<div class="page-view"><a class="detail-back" href="${isOwner ? "dashboard.html" : "index.html"}">← Back to ${isOwner ? "your dashboard" : "stories"}</a>
          <article class="detail-article"><span class="category-label">${escapeHTML(post.category.toUpperCase())}</span><h1>${escapeHTML(post.title)}</h1>
          <div class="detail-byline"><div class="avatar purple">${escapeHTML(initials(post.authorName))}</div><div><strong>${escapeHTML(post.authorName)}</strong><span>${escapeHTML(formatDate(post.createdAt))} · ${Math.max(1, Math.ceil(fullBodyFor(post).trim().split(/\s+/).length / 200))} min read</span></div></div>
          <div class="detail-cover art-journal"${imageUrl ? "" : ' aria-hidden="true"'}>${imageUrl ? "" : "✍️"}</div><div class="detail-body">${escapeHTML(fullBodyFor(post))}</div>
          <div class="detail-actions"><button class="primary-button" type="button" data-like-detail="${escapeHTML(post.id)}">♡ Like · ${Number(post.likes) || 0}</button><a class="secondary-button" href="index.html">Discover more stories</a>${isOwner ? `<a class="secondary-button" href="write.html?edit=${encodeURIComponent(post.id)}">Edit story</a><button class="secondary-button delete-action" type="button" data-delete-post="${escapeHTML(post.id)}">Delete story</button>` : ""}</div>
          ${post.status === "published" ? `<section class="comments-section" aria-labelledby="commentsHeading" data-comment-section data-post-id="${escapeHTML(post.id)}">
            <h2 id="commentsHeading">Comments <span data-comment-count>(0)</span></h2>
            <p class="comment-status" data-comment-status role="status">Loading comments…</p>
            <div class="comment-list" data-comment-list></div>
            <form class="comment-form" data-comment-form data-post-id="${escapeHTML(post.id)}">
              <label for="commentContent">Join the conversation</label>
              <textarea id="commentContent" name="content" rows="3" maxlength="1000" required placeholder="Share a thoughtful response…"></textarea>
              <div class="comment-form-footer"><span>${user ? "Be kind and constructive." : "Log in to leave a comment."}</span><button class="primary-button" type="submit">Post comment</button></div>
            </form>
          </section>` : ""}</article></div>`;
        setPage(content, { detailOnly: true });
        if (imageUrl) {
          const image = document.createElement("img");
          image.src = imageUrl;
          image.alt = `Picture for ${post.title}`;
          feed.querySelector(".detail-cover").appendChild(image);
        }
        if (post.status === "published") loadPostComments(post.id);
      }

      function createCommentElement(comment) {
        const item = document.createElement("article");
        item.className = "comment-item";
        const header = document.createElement("div");
        header.className = "comment-header";
        const author = document.createElement("strong");
        author.textContent = comment.author_name || "Sunday reader";
        const date = document.createElement("time");
        date.dateTime = comment.created_at;
        date.textContent = formatDate(comment.created_at);
        const body = document.createElement("p");
        body.textContent = comment.content;
        header.append(author, date);
        item.append(header, body);
        return item;
      }

      async function loadPostComments(postId) {
        const section = document.querySelector("[data-comment-section]");
        if (!section || section.dataset.postId !== postId) return;

        const status = section.querySelector("[data-comment-status]");
        const list = section.querySelector("[data-comment-list]");
        const count = section.querySelector("[data-comment-count]");
        try {
          const { data, error } = await (await getSupabaseClient())
            .from("comments")
            .select("id, post_id, user_id, author_name, content, created_at")
            .eq("post_id", postId)
            .order("created_at", { ascending: true });
          if (error) throw error;
          if (!section.isConnected || section.dataset.postId !== postId) return;

          list.replaceChildren(...data.map(createCommentElement));
          count.textContent = `(${data.length})`;
          status.textContent = data.length ? "" : "No comments yet. Start the conversation.";
          updatePostCommentCount(postId, data.length);
        } catch (error) {
          console.error("Unable to load comments for story.", error);
          if (section.isConnected) status.textContent = "Comments could not be loaded. Please refresh and try again.";
        }
      }

      function renderDashboard(tab = "all") {
        const user = currentUser();
        if (!user) {
          sessionStorage.setItem("sunday.next", "dashboard");
          navigate("#login");
          return;
        }
        activeDashboardTab = tab;
        const own = posts().filter((post) => post.authorId === user.id)
          .filter((post) => tab === "all" || post.status === tab)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const allCount = posts().filter((post) => post.authorId === user.id).length;
        const publishedCount = posts().filter((post) => post.authorId === user.id && post.status === "published").length;
        const list = own.length ? own.map((post) => `<div class="dashboard-post">
          <div class="dashboard-post-main"><strong>${escapeHTML(post.title)}</strong><span>${escapeHTML(post.category)} · ${escapeHTML(formatDate(post.createdAt))}</span></div>
          <span class="status-pill ${post.status === "draft" ? "draft" : ""}">${post.status === "draft" ? "Private draft" : "Published"}</span>
          <div class="dashboard-post-actions">${post.status === "published" ? `<a class="dashboard-open" href="post.html?id=${encodeURIComponent(post.id)}">Open</a>` : ""}
            <a class="dashboard-action" href="write.html?edit=${encodeURIComponent(post.id)}">${post.status === "draft" ? "Edit draft" : "Edit"}</a>
            <button class="dashboard-action delete" type="button" data-delete-post="${escapeHTML(post.id)}">Delete</button></div></div>`).join("")
          : `<div class="empty-dashboard">${tab === "draft" ? "No private drafts yet. Start writing and save one for later." : tab === "published" ? "No public posts yet. Publish a story to share it with everyone." : "Your stories will live here. Start a new post whenever inspiration strikes."}</div>`;
        setPage(`<div class="page-view"><section class="page-hero"><div class="page-kicker">Your private space · ${escapeHTML(user.role || "writer")}</div><h1>Writer dashboard</h1><p>Welcome back, ${escapeHTML(displayName(user))}. Your drafts stay private; published stories appear here and in the public feed.</p><div class="dashboard-actions">${canWrite(user) ? '<a class="primary-button" href="write.html">✎ Write a story</a>' : '<a class="secondary-button" href="settings.html">Update your reader profile</a>'}<a class="secondary-button" href="index.html">Browse public stories</a><button class="secondary-button" type="button" data-signout>Log out</button></div></section>
          <div class="dashboard-stats"><div class="dashboard-stat"><strong>${allCount}</strong><span>Your stories</span></div><div class="dashboard-stat"><strong>${publishedCount}</strong><span>Public posts</span></div><div class="dashboard-stat"><strong>${posts().filter((post) => post.authorId === user.id && post.status === "draft").length}</strong><span>Private drafts</span></div></div>
          <section class="page-card"><h2>Your writing</h2><div class="dashboard-tabs"><button class="dashboard-tab ${tab === "all" ? "active" : ""}" data-dashboard-tab="all">All (${allCount})</button><button class="dashboard-tab ${tab === "published" ? "active" : ""}" data-dashboard-tab="published">Published (${publishedCount})</button><button class="dashboard-tab ${tab === "draft" ? "active" : ""}" data-dashboard-tab="draft">Drafts</button></div>${list}</section></div>`, { contentOnly: true });
      }

      function renderBookmarks() {
        const savedPosts = posts();
        const stories = bookmarkList().map((id) => savedPosts.find((post) => post.id === id))
          .filter((post) => post && (post.status === "published" || post.authorId === currentUser()?.id));
        const rows = stories.length ? stories.map((post) => `<div class="dashboard-post"><div class="dashboard-post-main"><strong>${escapeHTML(post.title)}</strong><span>${escapeHTML(post.category)} · ${escapeHTML(post.authorName)}</span></div><a class="dashboard-open" href="post.html?id=${encodeURIComponent(post.id)}">Read story</a></div>`).join("")
          : '<div class="empty-dashboard">Your reading list is waiting. Bookmark a story from the public feed and it will be saved here.</div>';
        setPage(`<div class="page-view">${pageHero("Saved for another day", "Your bookmarks", "A personal reading list of stories you want to come back to.")}<section class="page-card">${rows}</section></div>`, { contentOnly: true });
      }

      function pageHero(kicker, title, description) {
        return `<section class="page-hero"><div class="page-kicker">${kicker}</div><h1>${title}</h1><p>${description}</p></section>`;
      }

      function renderAbout() {
        setPage(`<div class="page-view">${pageHero("A place to put your words", "Stories make a little more room for us.", "Sunday is a welcoming home for personal essays, thoughtful ideas, and the small observations that make a day feel larger.")}<section class="page-card"><h2>Made for writers at every stage</h2><p>Some people arrive with a notebook full of drafts. Some arrive with one sentence they cannot stop thinking about. Sunday is for both. Read the community’s public stories, find a prompt when you need a nudge, and share your own work when you are ready.</p><p>Our aim is simple: make it easier to write honestly, discover a different point of view, and meet people who care about the same things.</p></section><section class="page-card"><h2>A gentle set of guidelines</h2><p>Be generous with one another. Credit the work that inspires you. Share writing that is yours to share, and help us keep the conversation curious, kind, and welcoming.</p></section></div>`, { contentOnly: true });
      }

      function renderContact() {
        setPage(`<div class="page-view">${pageHero("We’d love to hear from you", "Say hello.", "Questions, ideas, kind words, or a story about your writing life—our inbox is open.")}<section class="page-card"><h2>Get in touch</h2><p>Email the Sunday team and we’ll get back to you as soon as we can.</p><p><a class="primary-button" href="mailto:hello@sunday.example">✉ hello@sunday.example</a></p><p class="form-note">For this demo, the address is a placeholder. Replace it with your real contact email before publishing the site.</p></section><section class="page-card"><h2>Community &amp; story questions</h2><p>For writing prompts, submissions, or help with your account, include “Sunday community” in the subject line so we can point you in the right direction.</p></section></div>`, { contentOnly: true });
      }

      function renderCompetitions() {
        setPage(`<div class="page-view">${pageHero("A little nudge to put pen to paper", "The October writing prompt", "Write about a place that feels like home. There is no single right answer: a kitchen, a bus route, a borrowed room, or a person can all be home.")}<section class="page-card"><h2>Your prompt</h2><p>“Write about a place that feels like home.”</p><p>Try writing for ten minutes without editing. Begin with a detail you can see, hear, or smell. When your story is ready, publish it with the topic “Lifestyle” and include “October prompt” in your title or opening paragraph.</p><p><strong>Entries close October 31, 2026.</strong> The community will celebrate a few favorite stories in November.</p><a class="primary-button" href="write.html">✎ Write your entry</a></section><section class="page-card"><h2>Friendly guidelines</h2><p>Stories should be your own work, respectful of others’ privacy, and no longer than 1,200 characters in this demo. Sharing is optional; saving a draft keeps your entry private until you decide to publish.</p></section></div>`, { contentOnly: true });
      }

      function renderAuth(mode, message = "") {
        if (currentUser()) {
          navigate("dashboard.html");
          return;
        }
        const signup = mode === "signup";
        const formTitle = signup ? "Create your writer account" : "Welcome back";
        const intro = signup ? "Join Sunday to keep private drafts and share your stories when you’re ready." : "Log in to pick up where your writing left off.";
        setPage(`<div class="page-view">${pageHero(signup ? "A page of your own" : "Your words are waiting", formTitle, intro)}
          <section class="page-card page-form"><div class="form-error ${message ? "visible" : ""}" id="authError" role="alert">${escapeHTML(message)}</div><form id="authForm" data-auth-mode="${mode}" novalidate>
          ${signup ? '<div class="form-field"><label for="authName">Your name</label><input id="authName" name="name" required maxlength="60" autocomplete="name" placeholder="How should we call you?"></div>' : ""}
          ${signup ? '<div class="form-field"><label for="authPoeticName">Poetic name <span class="form-label-note">(your pen name)</span></label><input id="authPoeticName" name="poeticName" required maxlength="60" autocomplete="nickname" placeholder="The name readers will see"></div>' : ""}
          <div class="form-field"><label for="authEmail">Email</label><input id="authEmail" name="email" type="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"></div>
          <div class="form-field"><label for="authPassword">Password</label><input id="authPassword" name="password" type="password" required minlength="${signup ? "8" : "1"}" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="${signup ? "At least 8 characters" : "Your password"}"></div>
          ${signup ? '<div class="form-field"><label for="authConfirmPassword">Confirm password</label><input id="authConfirmPassword" name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" placeholder="Enter your password again"></div>' : ""}
          ${signup ? '<div class="form-field"><label for="accountRole">I am here as a</label><select id="accountRole" name="role" required><option value="reader">Reader</option><option value="writer">Writer</option><option value="both" selected>Reader and writer</option></select></div>' : ""}
          <button class="primary-button" type="submit">${signup ? "Create account" : "Log in"}</button>
          <p class="form-note">Authentication is handled by Supabase. Profile details, drafts, and stories are stored only in this browser and do not sync between devices.</p>
          </form><p class="form-note">${signup ? 'Already registered? <a class="panel-link" href="login.html">Log in</a>.' : 'New to Sunday? <a class="panel-link" href="signup.html">Create an account</a>.'}</p></section></div>`, { contentOnly: true });
      }

      function renderWriter(message = "", draftId = "") {
        const user = currentUser();
        if (!user) {
          sessionStorage.setItem("sunday.next", "write");
          navigate("#signup");
          return;
        }
        if (!canWrite(user)) {
          setPage(`<div class="page-view">${pageHero("Reader account", "Your next chapter can include writing.", "Your account is set up for reading. Change your account type to Writer or Both in settings to publish stories.")}<section class="page-card"><a class="primary-button" href="settings.html">Update account type</a> <a class="secondary-button" href="index.html">Browse stories</a></section></div>`, { contentOnly: true });
          return;
        }
        const editingPost = draftId ? posts().find((post) => post.id === draftId && post.authorId === user.id) : null;
        if (draftId && !editingPost) {
          setPage(`<div class="page-view">${pageHero("Story unavailable", "This isn’t one of your stories", message || "Only the author can edit a story.")}<section class="page-card"><a class="primary-button" href="dashboard.html">Back to your dashboard</a></section></div>`, { contentOnly: true });
          return;
        }
        const isPublishedEdit = editingPost?.status === "published";
        const title = editingPost?.title || "";
        const body = editingPost?.body || "";
        const category = editingPost?.category || "Lifestyle";
        const currentImageUrl = safePostImageUrl(editingPost?.imagePath);
        setPage(`<div class="page-view">${pageHero(isPublishedEdit ? "Update your story" : editingPost ? "Pick up where you left off" : "Make something yours", isPublishedEdit ? "Edit published story" : editingPost ? "Resume your story" : "Write a story", "Every good story starts somewhere. Publish it for the community or save a private draft to finish later.")}
          <section class="page-card page-form"><div class="form-error ${message ? "visible" : ""}" id="writerError" role="alert">${escapeHTML(message)}</div><form id="writerForm" data-edit-id="${escapeHTML(editingPost?.id || "")}" data-edit-status="${escapeHTML(editingPost?.status || "")}" novalidate>
          <div class="form-field"><label for="postTitle">Story title</label><input id="postTitle" name="title" maxlength="120" required placeholder="Give your story a title" value="${escapeHTML(title)}"></div>
          <div class="form-field"><label for="postCategory">Topic</label><select id="postCategory" name="category">${["Lifestyle", "Creativity", "Travel", "Design", "Wellness"].map((option) => `<option${category === option ? " selected" : ""}>${option}</option>`).join("")}</select></div>
          <div class="form-field"><label for="postImage">Story picture <span class="form-label-note">(optional, JPG, PNG, WebP or GIF; up to 5 MB)</span></label><input id="postImage" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"><div class="image-preview${currentImageUrl ? " visible" : ""}" data-image-preview data-current-image="${escapeHTML(currentImageUrl)}">${currentImageUrl ? `<img src="${escapeHTML(currentImageUrl)}" alt="Current story picture preview">` : ""}</div>${currentImageUrl ? '<label class="remove-image-option"><input name="removeImage" type="checkbox"> Remove current picture</label>' : ""}<span class="form-label-note">Pictures are uploaded when published; a selected picture is not saved with a private draft.</span></div>
          <div class="form-field"><label for="postBody">Your story</label><textarea id="postBody" name="body" maxlength="12000" required placeholder="Start with the detail you can't stop thinking about...">${escapeHTML(body)}</textarea></div>
          <div class="modal-actions writer-actions"><button class="primary-button" type="submit" name="status" value="published">${isPublishedEdit ? "Save changes" : "Publish to the community"}</button>${isPublishedEdit ? '<a class="secondary-button" href="dashboard.html">Cancel</a>' : '<button class="secondary-button" type="submit" name="status" value="draft">Save private draft</button>'}</div>
          </form><p class="form-note">Published stories appear on the home page and your dashboard. Private drafts are visible only in your dashboard in this browser.</p></section></div>`, { contentOnly: true });
      }

      function renderSettings(message = "") {
        const user = currentUser();
        if (!user) { navigate("login.html"); return; }
        setPage(`<div class="page-view">${pageHero("Your account", "Profile settings", "Update the details shown beside your writing.")}
          <section class="page-card page-form"><div class="form-error ${message ? "visible" : ""}" id="settingsError" role="alert">${escapeHTML(message)}</div><form id="settingsFormPage" novalidate>
          <div class="form-field"><label for="settingsName">Your name</label><input id="settingsName" name="name" required maxlength="60" value="${escapeHTML(user.name)}"></div>
          <div class="form-field"><label for="settingsPoeticName">Poetic name</label><input id="settingsPoeticName" name="poeticName" required maxlength="60" value="${escapeHTML(displayName(user))}"></div>
          <div class="form-field"><label for="settingsHandle">Profile handle</label><input id="settingsHandle" name="handle" required maxlength="30" value="${escapeHTML(user.handle)}"></div>
          <div class="form-field"><label for="settingsRole">Account type</label><select id="settingsRole" name="role"><option value="reader"${user.role === "reader" ? " selected" : ""}>Reader</option><option value="writer"${user.role === "writer" ? " selected" : ""}>Writer</option><option value="both"${user.role === "both" || !user.role ? " selected" : ""}>Reader and writer</option></select></div>
          <button class="primary-button" type="submit">Save profile</button></form></section>
          <section class="page-card"><h2>Account privacy</h2><p>Drafts are private to this local browser account. Publishing a post makes it visible in this browser’s public feed.</p></section></div>`, { contentOnly: true });
      }

      function setAuthError(message) {
        const error = document.querySelector(".form-error");
        if (error) {
          error.textContent = message;
          error.classList.add("visible");
        }
      }

      function localProfile(authUser, details = {}) {
        const existing = users().find((user) => user.id === authUser.id);
        if (existing) return existing;

        const metadata = authUser.user_metadata || {};
        const email = authUser.email || "";
        const name = details.name || metadata.full_name || email.split("@")[0] || "Writer";
        const poeticName = details.poeticName || metadata.poetic_name || name;
        const requestedRole = details.role || metadata.role;
        const role = ["reader", "writer", "both"].includes(requestedRole) ? requestedRole : "both";
        const account = {
          id: authUser.id, name, poeticName, role, handle: `@${email.split("@")[0]}`,
          email, followers: 0, following: 0
        };
        writeStore(STORAGE.users, [...users(), account]);
        return account;
      }

      async function handleAuth(form, signup) {
        const errorNode = document.getElementById("authError");
        const name = signup ? form.elements.name.value.trim() : "";
        const poeticName = signup ? form.elements.poeticName.value.trim() : "";
        const email = form.elements.email.value.trim().toLowerCase();
        const password = form.elements.password.value;
        if (signup && name.length < 2) { setAuthError("Please enter a name with at least two characters."); return; }
        if (signup && poeticName.length < 2) { setAuthError("Please enter a poetic name with at least two characters."); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setAuthError("Enter a valid email address."); return; }
        if (signup && password.length < 8) { setAuthError("Choose a password with at least 8 characters."); return; }
        if (signup && password !== form.elements.confirmPassword.value) { setAuthError("The passwords do not match. Please confirm your password."); return; }
        if (signup && !["reader", "writer", "both"].includes(form.elements.role.value)) { setAuthError("Choose whether you are here as a reader, writer, or both."); return; }
        try {
          const auth = (await getSupabaseClient()).auth;
          if (signup) {
            const { data, error } = await auth.signUp({
              email,
              password,
              options: { data: { full_name: name, poetic_name: poeticName, role: form.elements.role.value } }
            });
            if (error) throw error;
            if (!data.user) throw new Error("Supabase did not return the new account. Please try again.");
            const account = localProfile(data.user, { name, poeticName, role: form.elements.role.value });
            if (!data.session) {
              notify("Check your email to confirm your account, then log in.");
              renderAuth("login");
              return;
            }
            writeStore(STORAGE.session, account.id);
            sessionStorage.removeItem("sunday.next");
            updateHeader();
            navigate(account.role === "reader" ? "dashboard.html" : "write.html");
            return;
          }
          const { data, error } = await auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (!data.user || !data.session) throw new Error("Sign-in did not return an active session. Please try again.");
          const account = localProfile(data.user);
          writeStore(STORAGE.session, account.id);
          const next = sessionStorage.getItem("sunday.next") || "dashboard";
          sessionStorage.removeItem("sunday.next");
          updateHeader();
          navigate(next === "write" && !canWrite(account) ? "dashboard.html" : `${next}.html`);
        } catch (error) {
          console.error("Account action failed.", error);
          if (errorNode) {
            errorNode.textContent = error instanceof Error ? error.message : "Account could not be saved. Please try again.";
            errorNode.classList.add("visible");
          }
        }
      }

      function renderRoute() {
        updateHeader();
        const { path, params } = routeParts();
        const pageName = path === "home" ? "index.html" : `${path}.html`;
        document.querySelectorAll(".top-nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === pageName));
        document.querySelectorAll("[data-side-link]").forEach((link) => link.classList.toggle("selected", link.getAttribute("href") === pageName));

        if (path === "home" && params.get("logout") === "1") {
          writeStore(STORAGE.session, null);
          updateHeader();
          showHome();
          notify("You’re logged out");
          return;
        }
        if (path === "home" || path === "") { showHome(); return; }
        if (path === "bookmarks") { renderBookmarks(); return; }
        if (path === "about") { renderAbout(); return; }
        if (path === "contact") { renderContact(); return; }
        if (path === "competitions") { renderCompetitions(); return; }
        if (path === "dashboard") { renderDashboard(params.get("tab") || "all"); return; }
        if (path === "settings") { renderSettings(); return; }
        if (path === "write") {
          renderWriter("", params.get("edit") || "");
          return;
        }
        if (path === "login" || path === "signup") { renderAuth(path); return; }
        if (path === "post") { renderDetail(params.get("id") || ""); return; }
        if (path === "auth-next") { navigate(`#${params.get("to") || "dashboard"}`); return; }
        navigate("#home");
      }

      document.addEventListener("click", async (event) => {
        const followButton = event.target.closest("[data-follow-user]");
        if (followButton) {
          event.preventDefault();
          await toggleFollow(followButton);
          return;
        }
        const sideLink = event.target.closest("[data-side-link]");
        if (sideLink) {
          event.preventDefault();
          event.stopImmediatePropagation();
          navigate(sideLink.getAttribute("href"));
          return;
        }
        const authFormLink = event.target.closest("#authForm a[href]");
        if (authFormLink) return;
        const writeLink = event.target.closest("#writeLink");
        if (writeLink) {
          event.preventDefault();
          if (!currentUser()) {
            sessionStorage.setItem("sunday.next", "write");
            navigate("#signup");
          } else navigate("#write");
          return;
        }
        const signout = event.target.closest("[data-signout]");
        if (signout) { navigate("#logout"); return; }
        const deletePost = event.target.closest("[data-delete-post]");
        if (deletePost) {
          event.preventDefault();
          if (!confirm("Delete this story? This cannot be undone.")) return;
          try {
            await deleteUserPost(deletePost.dataset.deletePost);
          } catch (error) {
            console.error("Unable to delete story.", error);
            notify(error instanceof Error ? error.message : "The story could not be deleted.");
          }
          return;
        }
        const tab = event.target.closest("[data-dashboard-tab]");
        if (tab) { renderDashboard(tab.dataset.dashboardTab); return; }
        const detailLike = event.target.closest("[data-like-detail]");
        if (detailLike) {
          const savedPosts = posts();
          const post = savedPosts.find((item) => item.id === detailLike.dataset.likeDetail);
          if (post) {
            post.likes = Number(post.likes || 0) + 1;
            writeStore(STORAGE.posts, savedPosts);
            renderDetail(post.id);
          } else {
            const card = [...document.querySelectorAll(".post-card")].find((item) => item.dataset.postId === detailLike.dataset.likeDetail);
            if (card) {
              card.dataset.likes = String(Number(card.dataset.likes) + 1);
              detailLike.textContent = `♡ Like · ${card.dataset.likes}`;
            }
          }
          return;
        }
        const likeButton = event.target.closest(".like-button");
        const bookmarkButton = event.target.closest(".bookmark-button");
        if (bookmarkButton) {
          const card = bookmarkButton.closest(".post-card");
          const saved = bookmarkButton.getAttribute("aria-pressed") === "true";
          saveBookmark(card.dataset.postId, !saved);
          bookmarkButton.setAttribute("aria-pressed", String(!saved));
          bookmarkButton.classList.toggle("bookmarked", !saved);
          bookmarkButton.textContent = saved ? "♧" : "▣";
          notify(saved ? "Removed from your bookmarks" : "Story saved to your bookmarks");
          return;
        }
        if (likeButton) {
          const user = currentUser();
          if (!user) {
            notify("Please log in to like stories.");
            return;
          }

          const card = likeButton.closest(".post-card");
          const postId = card.dataset.postId;
          const wasLiked = likeButton.getAttribute("aria-pressed") === "true";

          likeButton.disabled = true;
          try {
            const client = await getSupabaseClient();
            if (wasLiked) {
              const { error } = await client
                .from("likes_table")
                .delete()
                .eq("post_id", postId)
                .eq("user_id", user.id);
              if (error) throw error;
            } else {
              const { error } = await client
                .from("likes_table")
                .insert({ post_id: postId, user_id: user.id });
              if (error) throw error;
            }

            const countSpan = card.querySelector(".like-count");
            const currentCount = Number(countSpan.textContent) || 0;
            const newCount = wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1;
            countSpan.textContent = String(newCount);
            card.dataset.likes = String(newCount);
            likeButton.setAttribute("aria-pressed", String(!wasLiked));
            likeButton.textContent = wasLiked ? "♡" : "♥";
            likeButton.classList.toggle("liked", !wasLiked);
          } catch (error) {
            console.error("Failed to update like in Supabase:", error);
            notify("Could not update like. Please try again.");
          } finally {
            likeButton.disabled = false;
          }
          return;
        }
        const card = event.target.closest(".post-card[data-post-id]");
        if (card && !event.target.closest("button")) navigate(`#post/${encodeURIComponent(card.dataset.postId)}`);
      });

      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest(".post-card[data-post-id]");
        if (!card || event.target !== card) return;
        event.preventDefault();
        navigate(`#post/${encodeURIComponent(card.dataset.postId)}`);
      });

      document.addEventListener("change", (event) => {
        const imageInput = event.target.closest("#postImage");
        const removeImage = event.target.closest('[name="removeImage"]');
        if (!imageInput && !removeImage) return;

        const form = (imageInput || removeImage).form;
        const preview = form.querySelector("[data-image-preview]");
        const image = preview.querySelector("img");

        if (imageInput) {
          const file = imageInput.files[0];
          if (file && (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
            imageInput.value = "";
            setAuthError("Choose a JPG, PNG, WebP, or GIF picture that is no larger than 5 MB.");
            return;
          }
        }
        if (image?.dataset.objectUrl) URL.revokeObjectURL(image.dataset.objectUrl);

        if (imageInput) {
          const file = imageInput.files[0];
          if (file) {
            if (form.elements.removeImage) form.elements.removeImage.checked = false;
            const objectUrl = URL.createObjectURL(file);
            if (image) {
              image.src = objectUrl;
              image.dataset.objectUrl = objectUrl;
            } else {
              const previewImage = document.createElement("img");
              previewImage.src = objectUrl;
              previewImage.alt = "Selected story picture preview";
              previewImage.dataset.objectUrl = objectUrl;
              preview.appendChild(previewImage);
            }
            preview.classList.add("visible");
          } else if (preview.dataset.currentImage && image) {
            image.src = preview.dataset.currentImage;
            delete image.dataset.objectUrl;
            preview.classList.add("visible");
          } else {
            image?.remove();
            preview.classList.remove("visible");
          }
        } else if (removeImage.checked) {
          form.elements.image.value = "";
          preview.classList.remove("visible");
        } else {
          const currentImage = preview.dataset.currentImage;
          if (currentImage && image) {
            image.src = currentImage;
            delete image.dataset.objectUrl;
            preview.classList.add("visible");
          }
        }
      });

      document.addEventListener("submit", async (event) => {
        const form = event.target;
        if (form.id === "authForm") {
          event.preventDefault();
          await handleAuth(form, form.dataset.authMode === "signup");
          return;
        }
        if (form.matches("[data-comment-form]")) {
          event.preventDefault();
          const user = currentUser();
          if (!user) {
            notify("Please log in to leave a comment.");
            return;
          }

          const content = form.elements.content.value.trim();
          const status = form.closest("[data-comment-section]").querySelector("[data-comment-status]");
          if (!content) {
            status.textContent = "Write a comment before posting.";
            return;
          }

          const submitButton = form.querySelector('button[type="submit"]');
          submitButton.disabled = true;
          try {
            const client = await getSupabaseClient();
            const { data: authData, error: authError } = await client.auth.getUser();
            if (authError) throw authError;
            if (!authData.user || authData.user.id !== user.id) {
              throw new Error("Your Supabase session is no longer active. Log in again before commenting.");
            }

            const { data: comment, error } = await client
              .from("comments")
              .insert({
                post_id: form.dataset.postId,
                user_id: authData.user.id,
                author_name: user.poeticName || user.name,
                content
              })
              .select("id, post_id, user_id, author_name, content, created_at")
              .single();
            if (error) throw error;
            if (!comment) throw new Error("The comment was not returned by the server. Please refresh and check the story.");

            const section = form.closest("[data-comment-section]");
            const list = section.querySelector("[data-comment-list]");
            list.appendChild(createCommentElement(comment));
            let commentCount = list.children.length;
            try {
              const { count, error: countError } = await client
                .from("comments")
                .select("id", { count: "exact", head: true })
                .eq("post_id", form.dataset.postId);
              if (countError) throw countError;
              if (count !== null) commentCount = count;
            } catch (error) {
              console.error("Unable to refresh the comment count after posting.", error);
            }
            section.querySelector("[data-comment-count]").textContent = `(${commentCount})`;
            updatePostCommentCount(form.dataset.postId, commentCount);
            status.textContent = "Your comment was posted.";
            form.reset();
          } catch (error) {
            console.error("Unable to post comment.", error);
            status.textContent = error instanceof Error && error.message.startsWith("Your Supabase session")
              ? error.message
              : "Your comment could not be posted. Please try again.";
            notify("Could not post your comment. Please try again.");
          } finally {
            submitButton.disabled = false;
          }
          return;
        }
        if (form.id === "writerForm") {
          event.preventDefault();
          const user = currentUser();
          if (!user) { sessionStorage.setItem("sunday.next", "write"); navigate("#signup"); return; }
          if (!canWrite(user)) { renderWriter(); return; }
          const title = form.elements.title.value.trim();
          const body = form.elements.body.value.trim();
          if (!title || body.length < 10) { setAuthError("Add a title and at least 10 characters to your story."); return; }
          const submitter = event.submitter;
          const status = submitter?.value === "draft" ? "draft" : "published";
          const imageFile = form.elements.image.files[0];
          if (imageFile && (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(imageFile.type) || imageFile.size > 5 * 1024 * 1024)) {
            setAuthError("Choose a JPG, PNG, WebP, or GIF picture that is no larger than 5 MB.");
            return;
          }
          let uploadedImagePath = "";
          let remotePostSaved = false;
          let imagePathToRemove = "";
          try {
            const savedPosts = posts();
            const editId = form.dataset.editId;
            const existing = editId && savedPosts.find((post) => post.id === editId && post.authorId === user.id);
            if (editId && !existing) { setAuthError("This story is no longer available in your account."); return; }
            let post;
            let nextPosts;
            if (status === "draft") {
              if (existing?.status === "published") {
                setAuthError("Published stories must be saved as published.");
                return;
              }
              post = existing
                ? { ...existing, title, category: form.elements.category.value, body, createdAt: new Date().toISOString() }
                : {
                  id: crypto.randomUUID(), authorId: user.id, authorName: user.poeticName || user.name,
                  title, category: form.elements.category.value, body,
                  status: "draft", likes: 0, createdAt: new Date().toISOString()
                };
              nextPosts = existing ? savedPosts.map((item) => item.id === existing.id ? post : item) : [...savedPosts, post];
            } else {
              const client = await getSupabaseClient();
              const { data: authData, error: authError } = await client.auth.getUser();
              if (authError) throw authError;
              if (!authData.user || authData.user.id !== user.id) {
                throw new Error("Your Supabase session is no longer active. Log in again before publishing.");
              }
              const postId = existing?.id || crypto.randomUUID();
              const previousImagePath = existing?.imagePath || "";
              let imagePath = form.elements.removeImage?.checked ? "" : previousImagePath;
              if (imageFile) {
                const extension = {
                  "image/jpeg": "jpg",
                  "image/png": "png",
                  "image/webp": "webp",
                  "image/gif": "gif"
                }[imageFile.type];
                const newImagePath = `${authData.user.id}/${postId}/${crypto.randomUUID()}.${extension}`;
                const { error: uploadError } = await client.storage
                  .from("post-images")
                  .upload(newImagePath, imageFile, { contentType: imageFile.type, upsert: false });
                if (uploadError) throw uploadError;
                uploadedImagePath = newImagePath;
                imagePath = newImagePath;
              }
              if (previousImagePath && previousImagePath !== imagePath) imagePathToRemove = previousImagePath;
              const postValues = {
                id: postId,
                title,
                category: form.elements.category.value,
                content: body,
                user_id: authData.user.id,
                author_name: user.poeticName || user.name,
                status: "published",
                image_path: imagePath || null
              };
              const query = existing?.status === "published"
                ? client.from("posts").update(postValues).eq("id", existing.id).eq("user_id", authData.user.id)
                : client.from("posts").insert(postValues);
              const { data, error } = await query.select("*").single();
              if (error) throw error;
              if (!data) throw new Error("The server did not return the saved story. Please refresh and check your dashboard.");
              remotePostSaved = true;
              post = normalizeRemotePost(data);
              nextPosts = [...savedPosts.filter((item) => item.id !== existing?.id && item.id !== post.id), post];
            }
            writeStore(STORAGE.posts, nextPosts);
            if (imagePathToRemove) {
              try {
                const { error: removeError } = await (await getSupabaseClient()).storage
                  .from("post-images")
                  .remove([imagePathToRemove]);
                if (removeError) console.error("Unable to remove the previous story picture.", removeError);
              } catch (removeError) {
                console.error("Unable to remove the previous story picture.", removeError);
              }
            }
            notify(status === "draft" ? "Saved privately to your dashboard" : existing?.status === "published" ? "Your story has been updated" : "Published to your dashboard and the public feed");
            navigate("#dashboard");
          } catch (error) {
            if (uploadedImagePath && !remotePostSaved) {
              try {
                const { error: cleanupError } = await (await getSupabaseClient()).storage
                  .from("post-images")
                  .remove([uploadedImagePath]);
                if (cleanupError) console.error("Unable to clean up the picture after the story save failed.", cleanupError);
              } catch (cleanupError) {
                console.error("Unable to clean up the picture after the story save failed.", cleanupError);
              }
            }
            setAuthError(error instanceof Error ? error.message : "Your story could not be saved.");
          }
          return;
        }
        if (form.id === "settingsFormPage") {
          event.preventDefault();
          const user = currentUser();
          const name = form.elements.name.value.trim();
          let handle = form.elements.handle.value.trim().replace(/\s+/g, "");
          if (!name || name.length < 2 || !handle) { setAuthError("Enter a display name and profile handle."); return; }
          if (!handle.startsWith("@")) handle = `@${handle}`;
          try {
              const poeticName = form.elements.poeticName.value.trim();
              const role = form.elements.role.value;
              if (poeticName.length < 2) { setAuthError("Please enter a poetic name with at least two characters."); return; }
              if (!["reader", "writer", "both"].includes(role)) { setAuthError("Choose Reader, Writer, or Reader and writer."); return; }
              const updatedUsers = users().map((item) => item.id === user.id ? { ...item, name, poeticName, handle, role } : item);
              writeStore(STORAGE.users, updatedUsers);
              const savedPosts = posts();
              savedPosts.forEach((post) => {
                if (post.authorId === user.id) post.authorName = poeticName;
              });
              writeStore(STORAGE.posts, savedPosts);
            updateHeader();
            notify("Your profile has been updated");
            navigate("#dashboard");
          } catch (error) {
            setAuthError(error instanceof Error ? error.message : "Your settings could not be saved.");
          }
        }
      });

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.querySelector(".modal-backdrop.open")) {
          document.querySelectorAll(".modal-backdrop.open").forEach((modal) => modal.classList.remove("open"));
        }
      });
      syncRemotePosts().catch((error) => {
        console.error("Unable to fetch published posts from Supabase.", error);
        notify("Stories could not be refreshed from the server.");
      }).finally(renderRoute);
    })();
