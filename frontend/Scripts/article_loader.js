(function () {
  // ==========================
  // API base URL (dev vs prod)
  // ==========================

  //Used to determine which Backend to use Based on Environment

  // Environment used by LocalHost
  const API_BASE = (function () {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      console.log("[Article Loader] Using localhost for development");
      return "http://localhost:4000";
    }

    // Environment used for Production Deployment
    const renderUrl = "https://capstone-awsupload-1.onrender.com";
    console.log("[Article Loader] Using Render backend for production:", renderUrl);
    return renderUrl;
  })();

  console.log("[Article Loader] Final API_BASE:", API_BASE);

  // Controls the Number of Articles Shown Per Page
  const ARTICLES_PER_PAGE = 18;

  // ==========================
  // Maps API category Ids to the Correct Pages
  // ==========================
  const pageToCategory = {
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

  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split("/").pop() || "index.html";
    return filename.replace(".html", "");
  }

  function getCategoryId() {
    const page = getCurrentPage();
    return pageToCategory[page] || null;
  }

  function getCountryCode() {
    if (window.LocationService) {
      return window.LocationService.getSelectedCountry();
    }
    return null;
  }

  // ==========================
  // Build aggregate API URL
  // ==========================
  function buildApiUrl(category, page = 1) {
    const countryCode = getCountryCode();
    const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;

    const url = new URL("/api/news/aggregate", base);

    if (category) {
      url.searchParams.set("category", category);
    }
    if (countryCode) {
      url.searchParams.set("country", countryCode);
    }
    if (page > 1) {
      url.searchParams.set("page", page);
    }

    // Asks the Backend for Articles and then Randomly Selects based on ARTICLES_PER_PAGE
    url.searchParams.set("limit", 50);

    const finalUrl = url.toString();
    console.log("[Article Loader] Fetching from aggregate endpoint:", finalUrl);
    return finalUrl;
  }

  // ==========================
  // Helpers
  // ==========================
  function shuffleArray(array) {
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function formatDate(dateString) {
    if (!dateString) return "";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  // ==========================
  // Source Dropdown 
  // ==========================
  function createSourceDropdown(group) {
    if (!group.articles || group.articles.length === 0) {
      return null;
    }

    const sourceMap = new Map();
    group.articles.forEach((article) => {
      const sourceName = article.sourceName || article.source || "Unknown";

      if (!sourceMap.has(sourceName)) {
        sourceMap.set(sourceName, article);
      } else {
        const existing = sourceMap.get(sourceName);
        try {
          const existingDate = existing.publishedAt
            ? new Date(existing.publishedAt).getTime()
            : 0;
          const currentDate = article.publishedAt
            ? new Date(article.publishedAt).getTime()
            : 0;

          if (currentDate > existingDate && currentDate > 0) {
            sourceMap.set(sourceName, article);
          }
        } catch (e) {
          // ignore
        }
      }
    });

    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "source-dropdown-container";

    const dropdownButton = document.createElement("button");
    dropdownButton.className = "source-dropdown-button";
    dropdownButton.setAttribute("aria-expanded", "false");
    dropdownButton.setAttribute("aria-label", "Show sources used");
    dropdownButton.innerHTML = `
      <span class="dropdown-label">View Original Source</span>
      <span class="dropdown-arrow">▼</span>
    `;

    const dropdownContent = document.createElement("div");
    dropdownContent.className = "source-dropdown-content";
    dropdownContent.style.display = "none";

    const sourcesList = document.createElement("ul");
    sourcesList.className = "sources-list";

    sourceMap.forEach((article, sourceName) => {
      const listItem = document.createElement("li");
      listItem.className = "source-item";

      const sourceNameSpan = document.createElement("span");
      sourceNameSpan.className = "source-name";
      sourceNameSpan.textContent = sourceName;

      const articleLink = document.createElement("a");
      articleLink.href = article.url;
      articleLink.target = "_blank";
      articleLink.rel = "noopener noreferrer";
      articleLink.className = "source-article-link";
      articleLink.textContent =
        article.title ||
        article.headline ||
        article.description ||
        "View article";

      listItem.appendChild(sourceNameSpan);
      listItem.appendChild(document.createTextNode(": "));
      listItem.appendChild(articleLink);
      sourcesList.appendChild(listItem);
    });

    dropdownContent.appendChild(sourcesList);
    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownContent);

    dropdownButton.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = dropdownButton.getAttribute("aria-expanded") === "true";
      dropdownContent.style.display = isExpanded ? "none" : "block";
      dropdownButton.setAttribute("aria-expanded", String(!isExpanded));
      dropdownButton.querySelector(".dropdown-arrow").textContent = isExpanded
        ? "▼"
        : "▲";
    });

    document.addEventListener("click", function (e) {
      if (!dropdownContainer.contains(e.target)) {
        dropdownContent.style.display = "none";
        dropdownButton.setAttribute("aria-expanded", "false");
        dropdownButton.querySelector(".dropdown-arrow").textContent = "▼";
      }
    });

    return dropdownContainer;
  }

  // ==========================
  // Story Card Renderer
  // ==========================
  function renderStoryGroup(group, container) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "story-group-card";
    groupDiv.setAttribute("data-group-id", group.groupId || "");

    const primaryArticle =
      (group.articles && group.articles[0]) ||
      group.mainArticle ||
      group.article ||
      null;

    // Gets the Story Title
    const titleEl = document.createElement("h3");
    titleEl.className = "story-title";
    titleEl.textContent =
      (primaryArticle && (primaryArticle.title || primaryArticle.headline)) ||
      (group.groupTitle && String(group.groupTitle)) ||
      "Untitled story";

    groupDiv.appendChild(titleEl);

    // Get the Source and Date Info
    if (primaryArticle) {
      const linkWrapper = document.createElement("div");
      linkWrapper.className = "story-link-block";

      const metaEl = document.createElement("p");
      metaEl.className = "story-meta";

      const sourceName =
        primaryArticle.sourceName || primaryArticle.source || "Unknown source";
      const dateStr = formatDate(primaryArticle.publishedAt);

      if (dateStr) {
        metaEl.textContent = `From: ${sourceName} on ${dateStr}`;
      } else {
        metaEl.textContent = `From: ${sourceName}`;
      }

      linkWrapper.appendChild(metaEl);
      groupDiv.appendChild(linkWrapper);
    }

    // AI Generated Summary Section; Hidden until Requested
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "story-summary";
    summaryDiv.style.display = "none";

    const summaryText = document.createElement("p");
    summaryText.className = "summary-text";
    summaryDiv.appendChild(summaryText);
    groupDiv.appendChild(summaryDiv);

    // AI Summary Button; Fetches Summary then Displays It
    const summaryButton = document.createElement("button");
    summaryButton.type = "button";
    summaryButton.className = "summary-read-more";
    summaryButton.textContent = "View AI Generated Summary";

    summaryButton.addEventListener("click", async () => {
      // If the Summary is Already Loaded, Toggle Visibility on Button Click
      if (summaryDiv.dataset.loaded === "true") {
        const isHidden = summaryDiv.style.display === "none";
        summaryDiv.style.display = isHidden ? "block" : "none";
        summaryButton.textContent = isHidden
          ? "Hide Summary"
          : "View AI Generated Summary";
        return;
      }

      // First Time Click; Fetch Summary from Backend
      summaryDiv.style.display = "block";
      summaryText.textContent = "Loading summary...";
      summaryButton.disabled = true;

      try {
        const base = API_BASE.endsWith("/") ? API_BASE.slice(0, -1) : API_BASE;
        const summarizeUrl = `${base}/api/summarize`;

        const articleForSummary =
          primaryArticle || (group.articles && group.articles[0]) || {};
        const titleForSummary =
          group.groupTitle ||
          articleForSummary.title ||
          articleForSummary.headline ||
          "News article";

        const textForSummary =
          (group.fullArticleText && String(group.fullArticleText)) ||
          (group.summary && String(group.summary)) ||
          (group.aiSummary && String(group.aiSummary)) ||
          articleForSummary.description ||
          articleForSummary.trailText ||
          articleForSummary.snippet ||
          articleForSummary.content ||
          "";

        console.log("[Article Loader] Requesting summary for:", titleForSummary);
        console.log("[Article Loader] Text length:", textForSummary.length);

        if (!textForSummary || textForSummary.trim().length === 0) {
          throw new Error("No article text available for summarization");
        }

        const resp = await fetch(summarizeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleForSummary,
            text: textForSummary,
          }),
        });

        console.log("[Article Loader] Summary response status:", resp.status, resp.statusText);

        if (!resp.ok) {
          const errorData = await resp.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Summary request failed: ${resp.status} ${resp.statusText}`
          );
        }

        const result = await resp.json();
        console.log("[Article Loader] Summary response received:", {
          hasAiSummary: !!result.aiSummary,
          hasSummary: !!result.summary,
          hasError: !!result.error
        });

        // Read aiSummary field (primary), fallback to summary for backwards compatibility
        const rawSummary =
          result.aiSummary ||
          result.summary ||
          result.error ||
          "Summary not available. Please open the full article for details.";

        // Removes HTML Markup from Summary
        // Must keep for Plain Text Display
        const cleanSummary = String(rawSummary).replace(/<[^>]+>/g, "").trim();

        if (cleanSummary.length === 0 || cleanSummary.startsWith("Error:")) {
          summaryText.textContent = cleanSummary || "Unable to generate summary. Please try again later.";
          summaryText.style.color = "#d32f2f";
        } else {
          summaryText.textContent = cleanSummary;
          summaryText.style.color = "";
          summaryDiv.dataset.loaded = "true";
          summaryButton.textContent = "Hide Summary";
        }
      } catch (err) {
        console.error("[Article Loader] Error fetching summary:", err);
        const errorMessage = err.message || "Sorry, we couldn't load a summary right now. Please try again later.";
        summaryText.textContent = errorMessage;
        summaryText.style.color = "#d32f2f";
        // Don't mark as loaded if there was an error, so user can retry
        summaryDiv.dataset.loaded = "false";
      } finally {
        summaryButton.disabled = false;
      }
    });

    groupDiv.appendChild(summaryButton);

    // Old; Showed Multiple Sources as List in Dropdown
    const sourceDropdown = createSourceDropdown(group);
    if (sourceDropdown) {
      groupDiv.appendChild(sourceDropdown);
    }

    container.appendChild(groupDiv);
  }

  // ==========================
  // Load grouped stories
  // ==========================
  function loadArticles() {
    const category = getCategoryId();
    if (!category) {
      console.log("[Article Loader] No category for this page; skipping load.");
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

    const url = buildApiUrl(category);

    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `HTTP error! status: ${response.status} ${response.statusText} - URL: ${response.url}`
          );
        }
        return response.json();
      })
      .then((data) => {
        console.log("[Article Loader] Received data:", {
          groupedArticles: data.groupedArticles?.length || 0,
          rawArticles: data.rawArticles?.length || 0,
          fallbackMode: data.fallbackMode || false,
        });

        articlesContainer.innerHTML = "";

        let groups = data.groupedArticles || [];

        if (!groups.length && data.rawArticles && data.rawArticles.length) {
          // Fallback; Precautionary Raw Articles Handling incase Article Grouping Fails
          groups = data.rawArticles.map((a, idx) => ({
            groupId: a.id || `raw-${idx}`,
            groupTitle: a.title,
            summary: a.description || "",
            articles: [
              {
                title: a.title,
                url: a.url,
                description: a.description || "",
                publishedAt: a.publishedAt,
                sourceName: a.sourceName || a.source || "Unknown source",
                source: a.source || "",
              },
            ],
          }));
        }

        if (groups.length > 0) {
          // Randomize and take only ARTICLES_PER_PAGE
          const shuffled = shuffleArray(groups);
          const selectedGroups = shuffled.slice(0, ARTICLES_PER_PAGE);

          console.log(
            "[Article Loader] Displaying",
            selectedGroups.length,
            "randomized grouped stories"
          );

          selectedGroups.forEach((group) =>
            renderStoryGroup(group, articlesContainer)
          );

          if (data.pagination && data.pagination.totalPages > 1) {
            const paginationDiv = document.createElement("div");
            paginationDiv.className = "pagination";
            paginationDiv.innerHTML = `
              <p>Page ${data.pagination.currentPage} of ${data.pagination.totalPages}</p>
            `;
            articlesContainer.appendChild(paginationDiv);
          }
        } else {
          articlesContainer.innerHTML =
            '<div class="card"><p>No stories are available right now for this topic.</p></div>';
        }

        if (data.warnings && data.warnings.length > 0) {
          const warningsDiv = document.createElement("div");
          warningsDiv.className = "warnings";
          warningsDiv.innerHTML = `
            <h4>Note:</h4>
            <ul>
              ${data.warnings.map((w) => `<li>${w}</li>`).join("")}
            </ul>
          `;
          articlesContainer.appendChild(warningsDiv);
        }
      })
      .catch((error) => {
        console.error("[Article Loader] Error loading articles:", error);
        console.error("[Article Loader] API_BASE used:", API_BASE);

        let errorMessage = "Error loading articles. Please try again.";
        if (error.message) {
          errorMessage += `<br><small>${error.message}</small>`;
        }

        articlesContainer.innerHTML = `<div class="card"><p>${errorMessage}</p></div>`;
      });
  }

  // ==========================
  // Country changes + initial load
  // ==========================
  document.addEventListener("countryChanged", () => {
    loadArticles();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadArticles);
  } else {
    loadArticles();
  }
})();
