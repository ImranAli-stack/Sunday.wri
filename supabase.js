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

  window.SUPABASE_URL = SUPABASE_URL;
  window.getSupabaseClient = getSupabaseClient;
})();
