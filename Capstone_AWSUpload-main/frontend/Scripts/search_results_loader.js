(function () {
  // ============================
  // API BASE (dev vs prod)
  // ============================
  const API_BASE = (function () {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      console.log("[Search Loader] Using localhost backend");
      return "http://localhost:4000";
    }

    const renderUrl = "https://capstone-awsupload-1.onrender.com";
    console.log("[Search Loader] Using Render backend:", renderUrl);
    return renderUrl;
  })();

  console.log("[Search Loader] Final API_BASE:", API_BASE);

  // ============================
  // Helpers
  // ============================

  function getCountryCode() {
    if (window.LocationService) {
      return window.LocationService.getSelectedCountry();
    }
    return null;
  }

  // Read `?q=` from URL or lastSearch
  function getSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get("q") || localStorage.getItem("app:lastSearch") || "";
  }

  // Build URL to your search endpoint
  function buildSearchUrl(query) {
    const countryCode = getCountryCode();
    const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
    const url = new URL("/api/search", base);

    url.searchParams.set("q", query);
    if (countryCode) url.searchParams.set("country", countryCode);

    const finalUrl = url.toString();
    console.log("[Search Loader] Fetching search from:", finalUrl);
    return finalUrl;
  }

  // Format date for display
  function formatDate(dateString) {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // Normalize different article shapes into one shape
  function normalizeArticle(raw) {
    if (!raw) return null;

    const title =
      raw.title ||
      raw.headline ||
      (raw.fields && raw.fields.headline) ||
      "Untitled";

    const url = raw.url || raw.webUrl || raw.link || null;

    const source =
      raw.sourceName ||
      raw.source ||
      (raw.provider && raw.provider.name) ||
      (raw.sectionName ? `The Guardian – ${raw.sectionName}` : null) ||
      "Unknown source";

    const publishedAt =
      raw.publishedAt ||
      raw.webPublicationDate ||
      raw.date ||
      raw.pub_date ||
      null;

    const content =
      raw.content ||
      raw.bodyText ||
      (raw.fields && raw.fields.bodyText) ||
      raw.description ||
      raw.trailText ||
      raw.snippet ||
      "";

    return { title, url, source, publishedAt, content, raw };
  }

  // Choose up to maxCount articles MOST related to the query
  function selectRelevantArticles(rawArticles, query, maxCount = 10) {
    const normArticles = rawArticles
      .map(normalizeArticle)
      .filter(a => a && a.url && a.title);

    if (!query) {
      // No query? Just take the newest ones.
      return normArticles
        .sort((a, b) => {
          const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          return db - da;
        })
        .slice(0, maxCount);
    }

    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    const scored = normArticles.map(a => {
      const text = (
        (a.title || "") +
        " " +
        (a.content || "")
      ).toLowerCase();

      let score = 0;
      for (const term of terms) {
        if (text.includes(term)) score++;
      }

      return { article: a, score };
    });

    // Sort by score (desc), then by date (desc)
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = a.article.publishedAt ? new Date(a.article.publishedAt).getTime() : 0;
      const db = b.article.publishedAt ? new Date(b.article.publishedAt).getTime() : 0;
      return db - da;
    });

    // Filter out completely unrelated ones (score = 0)
    const withScore = scored.filter(s => s.score > 0);

    const chosen = (withScore.length > 0 ? withScore : scored).slice(0, maxCount);

    console.log("[Search Loader] Relevance scores:", chosen.map(c => ({
      title: c.article.title,
      score: c.score,
      date: c.article.publishedAt,
    })));

    return chosen.map(c => c.article);
  }

  // Create / find containers in the DOM
  function getOrCreateContainers() {
    const main = document.querySelector("main") || document.body;

    // Summary card
    let summaryContainer = document.getElementById("search-summary");
    if (!summaryContainer) {
      const section = document.createElement("section");
      section.id = "search-summary-section";

      const summaryCard = document.createElement("div");
      summaryCard.className = "card";
      summaryCard.id = "search-summary";

      section.appendChild(summaryCard);
      main.prepend(section);
      summaryContainer = summaryCard;
    }

    // Articles container
    let articlesContainer = document.getElementById("search-articles");
    if (!articlesContainer) {
      const section = document.createElement("section");
      section.id = "search-articles-section";

      const heading = document.createElement("h2");
      heading.textContent = "Articles used in this summary";

      const container = document.createElement("div");
      container.id = "search-articles";
      container.className = "articles-container";

      section.appendChild(heading);
      section.appendChild(container);
      main.appendChild(section);

      articlesContainer = container;
    }

    return { summaryContainer, articlesContainer };
  }

  // Render list of selected articles
  function renderArticlesList(articles, container) {
    container.innerHTML = "";

    if (!articles || articles.length === 0) {
      container.innerHTML =
        '<p style="padding: 20px; text-align: center;">No articles available.</p>';
      return;
    }

    articles.forEach((article) => {
      const card = document.createElement("article");
      card.className = "article-card";

      const titleLink = document.createElement("a");
      titleLink.href = article.url;
      titleLink.target = "_blank";
      titleLink.rel = "noopener noreferrer";

      const titleEl = document.createElement("h3");
      titleEl.className = "article-title";
      titleEl.textContent = article.title;
      titleLink.appendChild(titleEl);

      const metaEl = document.createElement("p");
      metaEl.className = "article-meta";
      const date = formatDate(article.publishedAt);
      metaEl.textContent = date
        ? `${article.source} • ${date}`
        : article.source;

      card.appendChild(titleLink);
      card.appendChild(metaEl);

      container.appendChild(card);
    });
  }

  // Render summary text in the summary card
  function renderSummaryLoading(container, query) {
    container.innerHTML = `
      <h2>Your AI summary for "${query}"</h2>
      <p style="margin-top: 10px; color: #555;">
        Generating a summary from multiple sources...
      </p>
    `;
  }

  function renderSummaryError(container, errorMessage) {
    container.innerHTML = `
      <h2>AI summary unavailable</h2>
      <p style="margin-top: 10px; color: #b00020; font-style: italic;">
        ${errorMessage}
      </p>
    `;
  }

  function renderSummaryText(container, query, summary) {
    container.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = `Your AI summary for "${query}"`;

    const body = document.createElement("p");
    body.style.marginTop = "12px";
    body.style.lineHeight = "1.5";
    body.textContent = summary;

    container.appendChild(heading);
    container.appendChild(body);
  }

  // ============================
  // MAIN FLOW
  // ============================

  async function loadSearchResults() {
    console.log("[Search Loader] ===============================");
    console.log("[Search Loader] loadSearchResults() called");

    const query = getSearchQuery().trim();
    const titleEl = document.getElementById("searchTitle");

    if (titleEl) {
      titleEl.textContent = query
        ? `Your search summary: "${query}"`
        : "Your search summary";
    }

    const { summaryContainer, articlesContainer } = getOrCreateContainers();

    if (!query) {
      summaryContainer.innerHTML =
        '<p style="padding: 20px; text-align: center;">No search query provided. Please search from the home page.</p>';
      articlesContainer.innerHTML = "";
      return;
    }

    // Show loading states
    renderSummaryLoading(summaryContainer, query);
    articlesContainer.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px;">
        <p style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Loading articles...</p>
        <p style="color: #666; font-size: 14px;">Searching multiple news sources for "${query}"</p>
      </div>
    `;

    const apiUrl = buildSearchUrl(query);

    try {
      const resp = await fetch(apiUrl);
      console.log("[Search Loader] Search response:", resp.status, resp.statusText);

      if (!resp.ok) {
        let msg = `Search error: ${resp.status} ${resp.statusText}`;
        try {
          const errData = await resp.json();
          if (errData && errData.error) msg = errData.error;
        } catch (_) {
          // ignore
        }
        throw new Error(msg);
      }

      const data = await resp.json();
      console.log("[Search Loader] Raw search data:", data);

      let rawArticles = [];

      if (Array.isArray(data.articles)) {
        rawArticles = data.articles;
      } else if (Array.isArray(data.rawArticles)) {
        rawArticles = data.rawArticles;
      } else if (Array.isArray(data.groupedArticles)) {
        data.groupedArticles.forEach((group) => {
          if (Array.isArray(group.articles)) {
            rawArticles.push(...group.articles);
          }
        });
      }

      if (!rawArticles || rawArticles.length === 0) {
        renderSummaryError(
          summaryContainer,
          "No articles were found for this topic. Try a different search term."
        );
        articlesContainer.innerHTML =
          '<p style="padding: 20px; text-align: center;">No articles found.</p>';
        return;
      }

      // ✅ NEW: choose only the most relevant articles to the query
      const selectedArticles = selectRelevantArticles(rawArticles, query, 10);
      console.log(
        "[Search Loader] Selected",
        selectedArticles.length,
        "articles for summary"
      );

      renderArticlesList(selectedArticles, articlesContainer);

      // Now call the multi-article summarizer
      const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
      const summarizeUrl = `${base}/api/summarize/search`;

      console.log("[Search Loader] Calling summarizer:", summarizeUrl);

      const summarizeResp = await fetch(summarizeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          articles: selectedArticles.map((a) => ({
            title: a.title,
            url: a.url,
            source: a.source,
            publishedAt: a.publishedAt,
            content: a.content,
          })),
        }),
      });

      console.log(
        "[Search Loader] Summarizer response:",
        summarizeResp.status,
        summarizeResp.statusText
      );

      const summarizeData = await summarizeResp
        .json()
        .catch(async (parseErr) => {
          console.error("[Search Loader] Failed to parse summarizer JSON:", parseErr);
          const text = await summarizeResp.text();
          console.error("[Search Loader] Raw summarizer response:", text);
          throw new Error(
            `Summarizer returned invalid response (${summarizeResp.status})`
          );
        });

      if (!summarizeResp.ok || summarizeData.error) {
        const msg =
          summarizeData.error ||
          summarizeData.aiSummary ||
          `Summarizer error: ${summarizeResp.status} ${summarizeResp.statusText}`;
        throw new Error(msg);
      }

      const rawSummary =
        summarizeData.aiSummary ||
        summarizeData.summary ||
        "No summary generated.";

      const cleanSummary = String(rawSummary)
        .replace(/<[^>]+>/g, "")
        .trim();

      if (!cleanSummary) {
        renderSummaryError(
          summaryContainer,
          "The AI did not return any summary text. Please try again."
        );
      } else {
        renderSummaryText(summaryContainer, query, cleanSummary);
      }
    } catch (err) {
      console.error("[Search Loader] Error loading search + summary:", err);
      renderSummaryError(summaryContainer, err.message || "Unknown error.");
      articlesContainer.innerHTML =
        '<p style="padding: 20px; text-align: center;">There was an error loading articles.</p>';
    }
  }

  // Init
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadSearchResults);
  } else {
    loadSearchResults();
  }

  // Optional: reload on country change
  document.addEventListener("countryChanged", () => {
    loadSearchResults();
  });
})();
