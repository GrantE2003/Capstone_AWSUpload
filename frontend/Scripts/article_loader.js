(function () {
  // ==============================
  // API base: local vs Render
  // ==============================
  const API_BASE =
    window.location.hostname.includes("localhost") ||
    window.location.hostname.includes("127.0.0.1")
      ? "http://localhost:4000"                             // Local dev (Node server)
      : "https://capstone-awsupload.onrender.com";          // Render backend

  console.log("[Article Loader] API_BASE =", API_BASE);

  // ==============================
  // Page -> Guardian section map
  // ==============================
  const pageToSection = {
    world_news: "world",
    united_states: "us-news",
    business: "business",
    technology: "technology",
    sports: "sport",
    entertainment: "culture",
    science: "science",
    health: "health",
    politics: "politics",
  };

  // Get current page name from URL (e.g., "world_news" from "world_news.html")
  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split("/").pop() || "index.html";
    return filename.replace(".html", "");
  }

  // Get Guardian section ID for current page
  function getSectionId() {
    const page = getCurrentPage();
    return pageToSection[page] || null;
  }

  // ==============================
  // Country handling
  // ==============================
  function getCountryCode() {
    if (window.LocationService) {
      return window.LocationService.getSelectedCountry();
    }
    return null;
  }

  // Build /api/guardian URL (against API_BASE) with section + country
  function buildApiUrl(sectionId, limit) {
    const countryCode = getCountryCode();
    const pageName = getCurrentPage();

    const url = new URL(API_BASE + "/api/guardian");
    url.searchParams.set("section", sectionId);
    url.searchParams.set("limit", limit || 12);

    if (countryCode) {
      url.searchParams.set("country", countryCode);
    }

    // Cache-busting so country changes always refetch
    url.searchParams.set("_t", Date.now().toString());

    // Frontend logging
    console.log("[NEWS REQUEST - FRONTEND]", {
      page: pageName,
      sectionId,
      countryCode: countryCode || "none",
      limit: limit || 12,
      url: url.toString(),
    });

    return url.toString();
  }

  // ==============================
  // Inline AI summary logic
  // ==============================
  let activeSummary = null;

  // Escape text for safe use in data-* attributes
  function escapeForDataAttr(text) {
    if (!text) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function createSummaryBox(card, title, url, bodyText) {
    // Remove any existing summary box
    if (activeSummary) {
      activeSummary.remove();
      activeSummary = null;
    }

    const summaryHTML = `
      <div class="summary-box show">
        <div class="summary-content">
          <div class="summary-header">
            <h4 class="summary-title">AI Summary</h4>
            <button class="summary-close" aria-label="Close summary">&times;</button>
          </div>
          <div class="summary-loading">Loading summary...</div>
          <div class="summary-text" style="display: none;"></div>
          <div class="summary-actions" style="display: none;">
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
              Read full article
            </a>
          </div>
        </div>
      </div>
    `;

    card.insertAdjacentHTML("beforeend", summaryHTML);
    activeSummary = card.querySelector(".summary-box");
    card.classList.add("has-summary-open");

    const closeBtn = activeSummary.querySelector(".summary-close");
    const loadingEl = activeSummary.querySelector(".summary-loading");
    const textEl = activeSummary.querySelector(".summary-text");
    const actionsEl = activeSummary.querySelector(".summary-actions");

    closeBtn.addEventListener("click", function () {
      if (activeSummary) {
        activeSummary.remove();
        activeSummary = null;
        card.classList.remove("has-summary-open");
      }
    });

    // One-time outside click handler for this summary
    const outsideClickHandler = function (e) {
      if (
        activeSummary &&
        !activeSummary.contains(e.target) &&
        !card.contains(e.target)
      ) {
        activeSummary.remove();
        activeSummary = null;
        card.classList.remove("has-summary-open");
        document.removeEventListener("click", outsideClickHandler);
      }
    };
    document.addEventListener("click", outsideClickHandler);

    // Call summarizer on the backend (note API_BASE)
    fetch(API_BASE + "/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: bodyText || "", title: title || "" }),
    })
      .then((response) => response.json())
      .then((data) => {
        loadingEl.style.display = "none";
        textEl.innerHTML =
          "<p>" +
          (data.summary || "Summary not available.").replace(/\n/g, "<br>") +
          "</p>";
        textEl.style.display = "block";
        actionsEl.style.display = "block";
      })
      .catch((error) => {
        console.error("[SUMMARY] Error:", error);
        loadingEl.style.display = "none";
        textEl.innerHTML =
          "<p>Error loading summary. Please try again.</p>";
        textEl.style.display = "block";
      });
  }

  // ==============================
  // Load articles for topic pages
  // ==============================
  function loadArticles() {
    const sectionId = getSectionId();
    if (!sectionId) {
      // Not on a topic page (e.g. index.html) – nothing to do
      console.log("[Article Loader] No section for this page, skipping.");
      return;
    }

    const main = document.querySelector("main");
    if (!main) return;

    let articlesContainer = main.querySelector(".articles-container");
    if (!articlesContainer) {
      articlesContainer = document.createElement("div");
      articlesContainer.className = "articles-container";
      main.appendChild(articlesContainer);
    }

    articlesContainer.innerHTML =
      '<div class="card"><p>Loading articles...</p></div>';

    fetch(buildApiUrl(sectionId, 12))
      .then((response) => {
        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }
        return response.json();
      })
      .then((data) => {
        if (!data.items || data.items.length === 0) {
          articlesContainer.innerHTML =
            '<div class="card"><p>No articles available for this topic.</p></div>';
          return;
        }

        articlesContainer.innerHTML = "";

        data.items.forEach(function (article) {
          const safeBody = escapeForDataAttr(article.bodyText || "");
          const safeTitle = escapeForDataAttr(article.title || "");
          const safeUrl = escapeForDataAttr(article.url || "#");
          const description =
            article.trailText || "No description available.";

          const cardHTML = `
            <div class="card">
              <h3>${article.title}</h3>
              <p>${description}</p>
              <a href="#" 
                 class="read-more" 
                 data-title="${safeTitle}" 
                 data-url="${safeUrl}" 
                 data-body="${safeBody}">
                Read more
              </a>
            </div>
          `;

          articlesContainer.insertAdjacentHTML("beforeend", cardHTML);
        });

        // Attach click handlers for "Read more"
        articlesContainer
          .querySelectorAll(".read-more")
          .forEach(function (link) {
            link.addEventListener("click", function (e) {
              e.preventDefault();
              e.stopPropagation();

              const title = this.getAttribute("data-title") || "";
              const url = this.getAttribute("data-url") || "#";
              const bodyText = this.getAttribute("data-body") || "";
              const card = this.closest(".card");

              // data-body is HTML-escaped; decode simple entities back
              const decodedBody = bodyText
                .replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, "&");

              createSummaryBox(card, title, url, decodedBody);
            });
          });
      })
      .catch((error) => {
        console.error("[Article Loader] Error loading articles:", error);
        articlesContainer.innerHTML =
          '<div class="card"><p>Error loading articles.</p></div>';
      });
  }

  // ==============================
  // React to country changes
  // ==============================
  document.addEventListener("countryChanged", () => {
    console.log("[Article Loader] Country changed, reloading articles.");
    loadArticles();
  });

  // ==============================
  // Initialize on page load
  // ==============================
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadArticles);
  } else {
    loadArticles();
  }
})();
