(() => {
  "use strict";

  const DEFAULT_SUPABASE_URL = "https://xjdrqktoeodohyoynphg.supabase.co";
  const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_LzIX4TdfqXDldsfjnsO8sQ_zYs4di_B";
  const SUPABASE_SDK_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

  const envObj = (typeof process !== "undefined" && process.env) ? process.env : (window.__ENV__ || {});
  let resolvedUrl =
    envObj.NEXT_PUBLIC_SUPABASE_URL ||
    envObj.SUPABASE_URL ||
    window.NEXT_PUBLIC_SUPABASE_URL ||
    window.SUPABASE_URL ||
    DEFAULT_SUPABASE_URL;
  let resolvedAnonKey =
    envObj.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    envObj.SUPABASE_ANON_KEY ||
    window.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    window.SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_ANON_KEY;

  let supabaseClient = null;
  let supabaseLoadPromise = null;
  let configLoadPromise = null;

  async function loadServerEnvConfig() {
    if (configLoadPromise) return configLoadPromise;
    configLoadPromise = (async () => {
      if (!window.location.protocol.startsWith("http")) return;
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) {
          const cfg = await res.json();
          const urlFromEnv = cfg.NEXT_PUBLIC_SUPABASE_URL || cfg.supabaseUrl;
          const keyFromEnv = cfg.NEXT_PUBLIC_SUPABASE_ANON_KEY || cfg.supabaseAnonKey;
          if (urlFromEnv && typeof urlFromEnv === "string") {
            resolvedUrl = urlFromEnv.trim();
            window.SUPABASE_URL = resolvedUrl;
            window.NEXT_PUBLIC_SUPABASE_URL = resolvedUrl;
          }
          if (keyFromEnv && typeof keyFromEnv === "string") {
            resolvedAnonKey = keyFromEnv.trim();
            window.SUPABASE_ANON_KEY = resolvedAnonKey;
            window.NEXT_PUBLIC_SUPABASE_ANON_KEY = resolvedAnonKey;
          }
        }
      } catch {
        // Fallback to default constants when running without the local Node server
      }
    })();
    return configLoadPromise;
  }

  function createSupabaseInstance() {
    if (!resolvedUrl || !resolvedAnonKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
    return window.supabase.createClient(resolvedUrl, resolvedAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      global: {
        headers: {
          apikey: resolvedAnonKey
        }
      }
    });
  }

  async function getSupabaseClient() {
    await loadServerEnvConfig();

    if (!window.supabase?.createClient) {
      if (!supabaseLoadPromise) {
        supabaseLoadPromise = new Promise((resolve, reject) => {
          const script = document.createElement("script");
          script.src = SUPABASE_SDK_URL;
          script.onload = resolve;
          script.onerror = () => reject(new Error("Supabase SDK could not load. Check your connection and try again."));
          document.head.appendChild(script);
        });
      }
      await supabaseLoadPromise;
    }

    if (!window.supabase?.createClient) {
      throw new Error("Supabase could not initialize. Refresh the page and try again.");
    }

    if (!supabaseClient) {
      supabaseClient = createSupabaseInstance();
    }
    return supabaseClient;
  }

  function createClient() {
    if (supabaseClient) return supabaseClient;
    if (window.supabase?.createClient) {
      supabaseClient = createSupabaseInstance();
      return supabaseClient;
    }
    throw new Error("Supabase SDK is still loading. Use await window.getSupabaseClient() instead.");
  }

  window.SUPABASE_URL = resolvedUrl;
  window.SUPABASE_ANON_KEY = resolvedAnonKey;
  window.NEXT_PUBLIC_SUPABASE_URL = resolvedUrl;
  window.NEXT_PUBLIC_SUPABASE_ANON_KEY = resolvedAnonKey;
  window.getSupabaseClient = getSupabaseClient;
  window.createClient = createClient;
})();
