/**
 * Qalamly Platform Server
 * Native Node.js HTTP server for static assets and Admin setup API.
 * Runs with zero external dependencies.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

// --- 1. Simple Environment Variable Loader (.env.local & .env) ---
function loadEnv() {
  const envFiles = [".env.local", ".env"];
  for (const file of envFiles) {
    const envPath = path.join(__dirname, file);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      content.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    }
  }
}
loadEnv();

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  "https://xjdrqktoeodohyoynphg.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "sb_publishable_LzIX4TdfqXDldsfjnsO8sQ_zYs4di_B";
const ADMIN_REGISTRATION_ENABLED = process.env.ADMIN_REGISTRATION_ENABLED !== "false";
const ADMIN_SETUP_SECRET = process.env.ADMIN_SETUP_SECRET || "";

// --- 2. MIME Types ---
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8"
};

// --- 3. Route Aliases ---
const ROUTE_ALIASES = {
  "/": "index.html",
  "/auth/callback": "auth/callback/index.html",
  "/auth/callback/": "auth/callback/index.html",
  "/admin": "admin.html",
  "/dashboard": "dashboard.html",
  "/login": "login.html",
  "/signup": "signup.html",
  "/write": "write.html",
  "/apply": "apply.html",
  "/about": "about.html",
  "/contact": "contact.html",
  "/competitions": "competitions.html",
  "/bookmarks": "bookmarks.html",
  "/notifications": "notifications.html",
  "/profile": "profile.html",
  "/settings": "settings.html",
  "/writers": "writers.html"
};

// --- 4. Helper: Check Supabase Admin Count via REST ---
async function checkSupabaseAdminsCount() {
  try {
    const endpoint = `${SUPABASE_URL}/rest/v1/admins?select=id,is_active&is_active=eq.true`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json"
      }
    });
    if (!res.ok) {
      return { ok: false, status: res.status, error: "Database query error" };
    }
    const data = await res.json();
    const count = Array.isArray(data) ? data.length : 0;
    return { ok: true, count };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// --- 5. Request Handler ---
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // Security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  // Log request
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);

  // --- API Routes ---
  if (pathname.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");

    // GET /api/health
    if (pathname === "/api/health" && req.method === "GET") {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: "healthy", timestamp, server: "Qalamly Node Server" }));
    }

    // GET /api/config
    if (pathname === "/api/config" && req.method === "GET") {
      res.writeHead(200);
      return res.end(JSON.stringify({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY,
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
        adminRegistrationEnabled: ADMIN_REGISTRATION_ENABLED,
        hasSetupSecret: Boolean(ADMIN_SETUP_SECRET)
      }));
    }

    // GET /api/admin/status
    if (pathname === "/api/admin/status" && req.method === "GET") {
      if (!ADMIN_REGISTRATION_ENABLED) {
        res.writeHead(200);
        return res.end(JSON.stringify({
          registrationAvailable: false,
          locked: true,
          message: "Admin registration has been administratively disabled in server configuration."
        }));
      }

      const dbCheck = await checkSupabaseAdminsCount();
      if (dbCheck.ok) {
        const registrationAvailable = dbCheck.count === 0;
        res.writeHead(200);
        return res.end(JSON.stringify({
          registrationAvailable,
          locked: !registrationAvailable,
          adminCount: dbCheck.count,
          hasSetupSecret: Boolean(ADMIN_SETUP_SECRET),
          message: registrationAvailable
            ? "Initial administrator registration is open."
            : "Registration is locked. An administrator has already been registered."
        }));
      }

      // If table query returned 404 or relation does not exist, registration is ready to bootstrap
      res.writeHead(200);
      return res.end(JSON.stringify({
        registrationAvailable: true,
        locked: false,
        dbStatus: dbCheck.status || "unverified",
        hasSetupSecret: Boolean(ADMIN_SETUP_SECRET),
        message: "Initial administrator registration is ready."
      }));
    }

    // POST /api/admin/register-validate
    if (pathname === "/api/admin/register-validate" && req.method === "POST") {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", async () => {
        try {
          const payload = JSON.parse(body || "{}");
          const { email, password, fullName, setupSecret } = payload;

          if (!ADMIN_REGISTRATION_ENABLED) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: "Admin registration is disabled by the server configuration." }));
          }

          if (ADMIN_SETUP_SECRET && setupSecret !== ADMIN_SETUP_SECRET) {
            res.writeHead(403);
            return res.end(JSON.stringify({ error: "Invalid administrator setup key." }));
          }

          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: "A valid administrator email is required." }));
          }

          if (!password || password.length < 8) {
            res.writeHead(400);
            return res.end(JSON.stringify({ error: "Password must be at least 8 characters." }));
          }

          const dbCheck = await checkSupabaseAdminsCount();
          if (dbCheck.ok && dbCheck.count > 0) {
            res.writeHead(403);
            return res.end(JSON.stringify({
              error: "Registration locked: An administrator is already registered. One-time setup is closed."
            }));
          }

          res.writeHead(200);
          return res.end(JSON.stringify({
            valid: true,
            message: "Validation successful. Proceed with Supabase user creation."
          }));
        } catch (err) {
          res.writeHead(400);
          return res.end(JSON.stringify({ error: "Invalid JSON payload." }));
        }
      });
      return;
    }

    // 404 for unknown API
    res.writeHead(404);
    return res.end(JSON.stringify({ error: "Endpoint not found" }));
  }

  // --- Static Files ---
  if (ROUTE_ALIASES[pathname]) {
    pathname = ROUTE_ALIASES[pathname];
  }

  let filePath = path.join(__dirname, pathname);

  // Prevent directory traversal attacks
  const relative = path.relative(__dirname, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("403 Forbidden");
  }

  // If path is a directory, check for index.html
  try {
    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch (err) {
    // If not found, try adding .html
    if (fs.existsSync(filePath + ".html")) {
      filePath = filePath + ".html";
    } else {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(`
        <!doctype html>
        <html>
        <head><title>404 Not Found</title><style>body{font-family:sans-serif;padding:50px;text-align:center;}a{color:#7458e8;}</style></head>
        <body>
          <h1>404 · Page Not Found</h1>
          <p>The requested page <code>${pathname}</code> was not found.</p>
          <p><a href="/">Return to Qalamly Home</a> · <a href="/admin">Admin Studio</a></p>
        </body>
        </html>
      `);
    }
  }

  // Read and serve file
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("500 Internal Server Error");
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`=======================================================`);
  console.log(`  Qalamly Server is running!`);
  console.log(`  Local URL:   http://localhost:${PORT}`);
  console.log(`  Admin URL:   http://localhost:${PORT}/admin`);
  console.log(`  Healthcheck: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);
});
