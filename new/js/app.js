(() => {
  "use strict";

  const page = document.body.dataset.page || "home";
  const file = page === "home" ? "index.html" : `${page}.html`;
  const canonicalUrl = new URL(`../${file}`, location.href);
  canonicalUrl.search = location.search;
  canonicalUrl.hash = location.hash;
  location.replace(canonicalUrl.href);
})();
