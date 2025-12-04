(function () {
  // ==========================
  // API base URL (dev vs prod)
  // ==========================
  const API_BASE = (function () {
    if (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1"
    ) {
      console.log("[Article Loader] Using localhost for development");
      return "http://localhost:4000";
    }

    // Production: Render backend URL
    const renderUrl = "https://capstone-awsupload.onrender.com";
    console.log("[Article Loader] Using Render backend for production:", renderUrl);
    return renderUrl;
  })();

  console.log("[Article Loader] Final API_BASE:", API_BASE);

  // ==========================
  // Page → category mapping
  // ==========================
  // These map your HTML filenames (without .html)
  // to Guardian section IDs used by /api/news/aggregate
  const pageToCategory = {
    world_news: "world",
    united_states: "us-news",
    business: "business",
    technology: "technology",
    sports: "sport",
    entertainment: "culture",
    science: "science",
    health: "health",
    politics: "politics"
  };

  // Get current page name from URL (e.g. "world_news" from "/Pages/world_news.html")
  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split("/").pop() || "index.html";
    return filename.replace(".html", "");
  }

  // Get category ID for the current page
  function getCategoryId() {
    const page = getCurrentPage();
    return pageToCategory[page] || null;
  }

  // Country from your LocationService widget
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

    // Ensure API_BASE has no trailing slash
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

    const finalUrl = url.toString();
    console.log("[Article Loader] Fetching from aggregate endpoint:", finalUrl);
    return finalUrl;
  }

  // ==========================
  // Source dropdown (one per group)
  // ==========================
  function createSourceDropdown(group) {
    if (!group.articles || group.articles.length === 0) {
      return null;
    }

    // Deduplicate so only ONE article per source (keep most recent)
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
          // ignore date parse issues
        }
      }
    });

    if (sourceMap.size !== group.articles.length) {
      console.log(
        `[Frontend] Deduplicated sources in group ${group.groupId}: ` +
          `${group.articles.length} articles -> ${sourceMap.size} unique sources`
      );
    }

    const dropdownContainer = document.createElement("div");
    dropdownContainer.className = "source-dropdown-container";

    const dropdownButton = document.createElement("button");
    dropdownButton.className = "source-dropdown-button";
    dropdownButton.setAttribute("aria-expanded", "false");
    dropdownButton.setAttribute("aria-label", "Show sources used");
    dropdownButton.innerHTML = `
      <span class="dropdown-label">Sources used in this summary (${sourceMap.size})</span>
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
      articleLink.textContent = article.title || "No title";

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

    // Close when clicking outside
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
  // Render a grouped story card
  // ==========================
  function renderStoryGroup(group, container) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "story-group-card";
    groupDiv.setAttribute("data-group-id", group.groupId || "");

    // Title
    const titleEl = document.createElement("h3");
    titleEl.className = "story-title";
    titleEl.textContent = group.groupTitle || "News Story";
    groupDiv.appendChild(titleEl);

    // Summary
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "story-summary";

    let fullSummary = group.summary;
    if (!fullSummary || fullSummary.trim().length === 0) {
      const summaryParts = [];
      if (group.articles && group.articles.length > 0) {
        group.articles.forEach((article) => {
          if (article.description && article.description.trim().length > 20) {
            const sentences = article.description
              .split(/[.!?]+/)
              .filter((s) => s.trim().length > 0);
            if (sentences.length > 0) {
              summaryParts.push(sentences[0].trim());
            }
          }
        });
      }
      fullSummary =
        summaryParts.length > 0
          ? summaryParts.slice(0, 2).join(" ") + "."
          : "Multiple sources covered this story. Please review the articles below for details.";
    }

    const summaryPreview =
      fullSummary.length > 250
        ? fullSummary.substring(0, 250) + "..."
        : fullSummary;
    const needsExpansion = fullSummary.length > 250;

    const summaryText = document.createElement("p");
    summaryText.className = "summary-text";
    summaryText.textContent = needsExpansion ? summaryPreview : fullSummary;
    summaryDiv.appendChild(summaryText);

    if (needsExpansion) {
      const readMoreLink = document.createElement("a");
      readMoreLink.href = "#";
      readMoreLink.className = "read-more-link";
      readMoreLink.textContent = "Read more";

      const readLessLink = document.createElement("a");
      readLessLink.href = "#";
      readLessLink.className = "read-less-link";
      readLessLink.textContent = "Read less";
      readLessLink.style.display = "none";

      readMoreLink.addEventListener("click", function (e) {
        e.preventDefault();
        summaryText.textContent = fullSummary;
        readMoreLink.style.display = "none";
        readLessLink.style.display = "inline";
      });

      readLessLink.addEventListener("click", function (e) {
        e.preventDefault();
        summaryText.textContent = summaryPreview;
        readLessLink.style.display = "none";
        readMoreLink.style.display = "inline";
        summaryDiv.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      summaryDiv.appendChild(readMoreLink);
      summaryDiv.appendChild(readLessLink);
    }

    groupDiv.appendChild(summaryDiv);

    // Source dropdown
    const sourceDropdown = createSourceDropdown(group);
    if (sourceDropdown) {
      groupDiv.appendChild(sourceDropdown);
    }

    container.appendChild(groupDiv);
  }

  // ==========================
  // Optional: raw article renderer (not used, but kept)
  // ==========================
  function renderRawArticle(article, container) {
    const articleDiv = document.createElement("div");
    articleDiv.className = "story-group";

    const sourceLabel = article.sourceName || article.source || "Unknown";
    const title = article.title || "No title";
    const description = article.description || "No description available.";
    const url = article.url || "#";

    articleDiv.innerHTML = `
      <div class="story-group-header">
        <h3>${title}</h3>
        <span class="article-source-badge">[${sourceLabel}]</span>
      </div>
      <div class="story-summary">
        <p>${description}</p>
      </div>
      <div class="story-articles">
        <a href="${url}" target="_blank" rel="noopener noreferrer" class="article-link">
          Read full article from ${sourceLabel}
        </a>
        ${
          article.publishedAt
            ? `<span class="article-date">Published: ${new Date(
                article.publishedAt
              ).toLocaleDateString()}</span>`
            : ""
        }
      </div>
    `;

    container.appendChild(articleDiv);
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
      articlesContainer.innerHTML =
        '<div class="card"><p>Loading articles...</p></div>';
      main.appendChild(articlesContainer);
    } else {
      articlesContainer.innerHTML =
        '<div class="card"><p>Loading articles...</p></div>';
    }

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
          fallbackMode: data.fallbackMode || false
        });

        articlesContainer.innerHTML = "";

        if (data.groupedArticles && data.groupedArticles.length > 0) {
          console.log(
            "[Article Loader] Displaying",
            data.groupedArticles.length,
            "grouped stories"
          );
          data.groupedArticles.forEach((group) => {
            renderStoryGroup(group, articlesContainer);
          });

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
            '<div class="card"><p>No grouped stories available for this topic. Articles may be too dissimilar to group together.</p></div>';
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
