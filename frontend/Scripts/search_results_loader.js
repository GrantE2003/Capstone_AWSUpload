(function () {

// Base URL for backend (environment-aware configuration)
const API_BASE = (function () {
  // Development: localhost
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  ) {
    console.log('[Search Results Loader] Using localhost for development');
    return 'http://localhost:4000';
  }

  // Production: Render backend
  const renderUrl = 'https://capstone-awsupload.onrender.com';
  console.log('[Search Results Loader] Using Render backend for production:', renderUrl);
  return renderUrl;
})();

  // Log the final API_BASE for debugging
  console.log('[Search Results Loader] Final API_BASE:', API_BASE);

  function getCountryCode() {
    if (window.LocationService) {
      return window.LocationService.getSelectedCountry();
    }
    return null;
  }

  // Get search query from URL
  function getSearchQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('q') || localStorage.getItem('app:lastSearch') || '';
  }

  // Build API URL for search (aggregate endpoint in backend)
  function buildSearchUrl(query, page = 1) {
    const countryCode = getCountryCode();

    // Ensure API_BASE doesn't have trailing slash
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

    // Construct absolute URL
    const url = new URL('/api/news/aggregate', base);

    url.searchParams.set('query', query);
    if (countryCode) {
      url.searchParams.set('country', countryCode);
    }
    if (page > 1) {
      url.searchParams.set('page', page);
    }

    const finalUrl = url.toString();
    console.log('[Search Results Loader] API_BASE:', API_BASE);
    console.log('[Search Results Loader] Fetching from aggregate endpoint:', finalUrl);
    return finalUrl;
  }

  // Format date helper (same as Quick Links)
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

  // Create source dropdown for a story group
  function createSourceDropdown(group) {
    if (!group.articles || group.articles.length === 0) {
      return null;
    }

    // Ensure only ONE article per source (keep most recent)
    const sourceMap = new Map();
    group.articles.forEach(article => {
      const sourceName = article.sourceName || article.source || 'Unknown';

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
          // ignore bad dates
        }
      }
    });

    if (sourceMap.size !== group.articles.length) {
      console.log(
        `[Frontend] Deduplicated sources in group ${group.groupId}: ` +
        `${group.articles.length} articles -> ${sourceMap.size} unique sources`
      );
    }

    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'source-dropdown-container';

    const dropdownButton = document.createElement('button');
    dropdownButton.className = 'source-dropdown-button';
    dropdownButton.setAttribute('aria-expanded', 'false');
    dropdownButton.setAttribute('aria-label', 'Show sources used');
    dropdownButton.innerHTML = `
      <span class="dropdown-label">Sources used in this summary (${sourceMap.size})</span>
      <span class="dropdown-arrow">▼</span>
    `;

    const dropdownContent = document.createElement('div');
    dropdownContent.className = 'source-dropdown-content';
    dropdownContent.style.display = 'none';

    const sourcesList = document.createElement('ul');
    sourcesList.className = 'sources-list';

    sourceMap.forEach((article, sourceName) => {
      const listItem = document.createElement('li');
      listItem.className = 'source-item';

      const sourceNameSpan = document.createElement('span');
      sourceNameSpan.className = 'source-name';
      sourceNameSpan.textContent = sourceName;

      const articleLink = document.createElement('a');
      articleLink.href = article.url;
      articleLink.target = '_blank';
      articleLink.rel = 'noopener noreferrer';
      articleLink.className = 'source-article-link';
      articleLink.textContent = article.title || 'No title';

      listItem.appendChild(sourceNameSpan);
      listItem.appendChild(document.createTextNode(': '));
      listItem.appendChild(articleLink);

      sourcesList.appendChild(listItem);
    });

    dropdownContent.appendChild(sourcesList);
    dropdownContainer.appendChild(dropdownButton);
    dropdownContainer.appendChild(dropdownContent);

    dropdownButton.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = dropdownButton.getAttribute('aria-expanded') === 'true';
      dropdownContent.style.display = isExpanded ? 'none' : 'block';
      dropdownButton.setAttribute('aria-expanded', !isExpanded);
      dropdownButton.querySelector('.dropdown-arrow').textContent = isExpanded
        ? '▼'
        : '▲';
    });

    document.addEventListener('click', function (e) {
      if (!dropdownContainer.contains(e.target)) {
        dropdownContent.style.display = 'none';
        dropdownButton.setAttribute('aria-expanded', 'false');
        dropdownButton.querySelector('.dropdown-arrow').textContent = '▼';
      }
    });

    return dropdownContainer;
  }

  // Render a story group - EXACT SAME STRUCTURE AS QUICK LINKS
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

    // Get the Source and Date Info (same as Quick Links)
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

    // AI Generated Summary Section; Hidden until Requested (same as Quick Links)
    const summaryDiv = document.createElement("div");
    summaryDiv.className = "story-summary";
    summaryDiv.style.display = "none";

    const summaryText = document.createElement("p");
    summaryText.className = "summary-text";
    summaryDiv.appendChild(summaryText);
    groupDiv.appendChild(summaryDiv);

    // AI Summary Button; Fetches Summary then Displays It (same as Quick Links)
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

      // Check if summary already exists in group data (from aggregate endpoint)
      const existingSummary = group.aiSummary || group.summary;
      if (existingSummary && existingSummary.trim().length > 20) {
        // Check if summary is just the title - if so, don't show it
        const articleForTitle = primaryArticle || (group.articles && group.articles[0]) || {};
        const articleTitle = articleForTitle.title || group.groupTitle || '';
        
        if (articleTitle) {
          const normalizedTitle = articleTitle.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
          const normalizedSummary = String(existingSummary).toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
          
          // If summary is essentially the title, don't show it
          if (normalizedSummary === normalizedTitle || 
              normalizedSummary.startsWith(normalizedTitle) ||
              normalizedTitle.startsWith(normalizedSummary)) {
            console.log('[Search Results] Summary is just the title, not displaying');
            summaryButton.style.display = 'none';
            return;
          }
        }
        
        // Use pre-generated summary from aggregate endpoint
        const cleanSummary = String(existingSummary).replace(/<[^>]+>/g, "").trim();
        summaryText.textContent = cleanSummary;
        summaryDiv.style.display = "block";
        summaryDiv.dataset.loaded = "true";
        summaryButton.textContent = "Hide Summary";
        return;
      }

      // First Time Click; Fetch Summary from Backend (fallback if no pre-generated summary)
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

        // Build comprehensive text from all articles in the group (EXACT SAME AS QUICK LINKS)
        // Combine descriptions/content from all articles, not the pre-generated group summary
        let textForSummary = "";
        
        if (group.articles && group.articles.length > 0) {
          // Combine text from all articles in the group - NO SOURCE MARKERS
          const articleTexts = group.articles.map((article) => {
            const description = article.description || article.trailText || article.snippet || '';
            const content = article.content || article.bodyText || '';
            const fullText = content || description;
            
            // Return ONLY the content, no source markers, no titles
            return fullText || '';
          }).filter(text => text && text.trim().length > 20); // Only include articles with meaningful content
          
          textForSummary = articleTexts.join('\n\n');
        }
        
        // Fallback to single article if group text is empty
        if (!textForSummary || textForSummary.trim().length === 0) {
          textForSummary =
            articleForSummary.content ||
            articleForSummary.bodyText ||
            articleForSummary.description ||
            articleForSummary.trailText ||
            articleForSummary.snippet ||
            "";
        }

        console.log("[Search Results Loader] Requesting summary for:", titleForSummary);
        console.log("[Search Results Loader] Text length:", textForSummary.length);

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

        console.log("[Search Results Loader] Summary response status:", resp.status, resp.statusText);

        const result = await resp.json().catch(async (parseError) => {
          console.error("[Search Results Loader] Failed to parse JSON response:", parseError);
          const textResponse = await resp.text();
          console.error("[Search Results Loader] Raw response:", textResponse);
          throw new Error(`Server returned invalid response: ${resp.status} ${resp.statusText}`);
        });

        console.log("[Search Results Loader] Summary response received:", {
          status: resp.status,
          statusText: resp.statusText,
          hasAiSummary: !!result.aiSummary,
          hasSummary: !!result.summary,
          hasError: !!result.error,
          resultKeys: Object.keys(result)
        });

        // Check if response indicates an error
        if (!resp.ok || result.error) {
          const errorMessage = result.aiSummary || result.error || `Request failed: ${resp.status} ${resp.statusText}`;
          throw new Error(errorMessage);
        }

        // Read aiSummary field (primary), fallback to summary for backwards compatibility
        const rawSummary =
          result.aiSummary ||
          result.summary ||
          "Summary not available. Please open the full article for details.";

        // Removes HTML Markup from Summary
        const cleanSummary = String(rawSummary).replace(/<[^>]+>/g, "").trim();

        if (cleanSummary.length === 0) {
          throw new Error("Received empty summary from server");
        }

        // Success - display the summary
        summaryText.textContent = cleanSummary;
        summaryText.style.color = "";
        summaryDiv.dataset.loaded = "true";
        summaryButton.textContent = "Hide Summary";
      } catch (err) {
        console.error("[Search Results Loader] Error fetching summary:", err);
        console.error("[Search Results Loader] Error details:", {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Extract error message
        let errorMessage = err.message || "Sorry, we couldn't load a summary right now. Please try again later.";
        
        if (errorMessage.startsWith("Error: ")) {
          errorMessage = errorMessage.substring(7);
        }
        
        summaryText.textContent = errorMessage;
        summaryText.style.color = "#d32f2f";
        summaryText.style.fontStyle = "italic";
        summaryDiv.dataset.loaded = "false";
        summaryButton.textContent = "View AI Generated Summary";
      } finally {
        summaryButton.disabled = false;
      }
    });

    groupDiv.appendChild(summaryButton);

    // Source Dropdown (same as Quick Links)
    const sourceDropdown = createSourceDropdown(group);
    if (sourceDropdown) {
      groupDiv.appendChild(sourceDropdown);
    }

    container.appendChild(groupDiv);
  }

  // Raw article renderer (not used, but kept as fallback utility)
  function renderRawArticle(article, container) {
    const articleDiv = document.createElement('div');
    articleDiv.className = 'story-group';

    const sourceLabel = article.sourceName || article.source || 'Unknown';
    const title = article.title || 'No title';
    const description = article.description || 'No description available.';
    const url = article.url || '#';

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
            : ''
        }
      </div>
    `;

    container.appendChild(articleDiv);
  }

  // Load search results
  function loadSearchResults() {
    console.log('[Search Results Loader] ========================================');
    console.log('[Search Results Loader] loadSearchResults() called');
    
    const query = getSearchQuery();
    console.log('[Search Results Loader] Extracted query from URL:', query);
    console.log('[Search Results Loader] URL params:', window.location.search);

    // Update the title with the search phrase
    const titleEl = document.getElementById('searchTitle');
    if (titleEl && query) {
      titleEl.textContent = `Your search summary: "${query}"`;
    } else if (titleEl && !query) {
      titleEl.textContent = 'Your search summary: (no query provided)';
    }

    if (!query || query.trim().length === 0) {
      console.warn('[Search Results Loader] No search query found - cannot load results');
      const main = document.querySelector('main');
      if (main) {
        const articlesContainer = main.querySelector('.articles-container') || main.querySelector('.Article\\ Links');
        if (articlesContainer) {
          articlesContainer.innerHTML = '<div class="card"><p style="padding: 20px; text-align: center;">No search query provided. Please enter a search term in the search bar above.</p></div>';
        }
      }
      return;
    }

    const main = document.querySelector('main');
    if (!main) return;

    // Find or create articles container
    let articlesContainer = main.querySelector('.articles-container');
    if (!articlesContainer) {
      const articleLinksSection =
        main.querySelector('.Article\\ Links') ||
        Array.from(main.querySelectorAll('section')).find(s =>
          s.textContent.includes('Article') || s.className.includes('Article')
        );

      if (articleLinksSection) {
        articlesContainer = document.createElement('div');
        articlesContainer.className = 'articles-container';
        articleLinksSection.appendChild(articlesContainer);
      } else {
        articlesContainer = document.createElement('div');
        articlesContainer.className = 'articles-container';
        main.appendChild(articlesContainer);
      }
    }

    // Show visible loading indicator with spinner
    articlesContainer.innerHTML = `
      <div class="card" style="text-align: center; padding: 40px;">
        <p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">Loading search results...</p>
        <p style="color: #666; font-size: 14px;">Searching across all news sources...</p>
        <div style="margin-top: 20px;">
          <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        </div>
        <style>
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </div>
    `;

    const apiUrl = buildSearchUrl(query);
    console.log('[Search Results Loader] ========================================');
    console.log('[Search Results Loader] SEARCH REQUEST');
    console.log('[Search Results Loader] Query:', query);
    console.log('[Search Results Loader] API URL:', apiUrl);
    console.log('[Search Results Loader] ========================================');

    fetch(apiUrl)
      .then(response => {
        console.log('[Search Results Loader] Response status:', response.status, response.statusText);
        console.log('[Search Results Loader] Response URL:', response.url);
        if (!response.ok) {
          // Try to get error details from response
          return response.json().then(errData => {
            throw new Error(errData.error || `HTTP error! status: ${response.status} ${response.statusText}`);
          }).catch(() => {
            throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
          });
        }
        return response.json();
      })
      .then(data => {
        console.log('[Search Results] Received data:', {
          groupedArticles: data.groupedArticles?.length || 0,
          rawArticles: data.rawArticles?.length || 0,
          articles: data.articles?.length || 0,
          fallbackMode: data.fallbackMode || false,
          warnings: data.warnings?.length || 0
        });

        articlesContainer.innerHTML = '';

        // Check for explicit "no results" flag from backend (for search queries)
        if (data.noResults === true) {
          articlesContainer.innerHTML =
            '<div class="card" style="text-align: center; padding: 40px;"><p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">No articles found for this topic.</p><p style="color: #666; font-size: 14px;">Try different keywords or check your spelling.</p></div>';
          return;
        }

        // Log full data structure for debugging
        console.log('[Search Results] Full data structure:', {
          hasGroupedArticles: !!data.groupedArticles,
          groupedArticlesLength: data.groupedArticles?.length || 0,
          hasRawArticles: !!data.rawArticles,
          rawArticlesLength: data.rawArticles?.length || 0,
          noResults: data.noResults,
          warnings: data.warnings,
          fullData: data // Log entire data object for debugging
        });

        // If we have raw articles but no groups, show raw articles immediately
        if (data.rawArticles && data.rawArticles.length > 0 && (!data.groupedArticles || data.groupedArticles.length === 0)) {
          console.log('[Search Results] No groups but have', data.rawArticles.length, 'raw articles - displaying them immediately');
          articlesContainer.innerHTML = '<div class="card"><p style="font-weight: bold; margin-bottom: 15px;">Found ' + data.rawArticles.length + ' articles:</p></div>';
          data.rawArticles.slice(0, 20).forEach(article => {
            renderRawArticle(article, articlesContainer);
          });
          return; // Exit early
        }

        if (data.groupedArticles && data.groupedArticles.length > 0) {
          // Less aggressive filtering - only filter out groups that are clearly title-only
          const groupsWithSummaries = data.groupedArticles.filter(group => {
            // Only filter if explicitly marked as title-only
            if (group.isTitleOnlySummary === true) {
              console.log('[Search Results] Filtering out group - marked as title-only summary');
              return false;
            }
            
            // Allow groups even if summary is short or missing - they can still be useful
            const summary = group.aiSummary || group.summary;
            
            // Only filter if summary exists and is clearly just the title
            if (summary && summary.trim().length > 0) {
              const primaryArticle = (group.articles && group.articles[0]) || {};
              const articleTitle = primaryArticle.title || group.groupTitle || '';
              if (articleTitle) {
                const normalizedTitle = articleTitle.toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
                const normalizedSummary = String(summary).toLowerCase().trim().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
                
                // Only filter if summary is EXACTLY the title (not just starts with it)
                if (normalizedSummary === normalizedTitle) {
                  console.log('[Search Results] Filtering out group - summary is exactly the title');
                  return false;
                }
              }
            }
            
            return true;
          });
          
          console.log('[Search Results] Filtered to', groupsWithSummaries.length, 'groups (from', data.groupedArticles.length, 'total)');
          console.log('[Search Results] Source breakdown:', groupsWithSummaries.map(g => {
            const sources = [...new Set(g.articles.map(a => a.sourceName || a.source || 'unknown'))];
            return sources.join(', ');
          }));
          
          if (groupsWithSummaries.length === 0) {
            // All groups were filtered out - check if we have raw articles as fallback
            if (data.rawArticles && data.rawArticles.length > 0) {
              console.log('[Search Results] No groups passed filter, but have', data.rawArticles.length, 'raw articles - showing them');
              articlesContainer.innerHTML = '<div class="card"><p style="font-weight: bold; margin-bottom: 15px;">Found ' + data.rawArticles.length + ' articles:</p></div>';
              data.rawArticles.slice(0, 20).forEach(article => {
                renderRawArticle(article, articlesContainer);
              });
            } else {
              // No groups and no raw articles - show no results
              articlesContainer.innerHTML =
                '<div class="card" style="text-align: center; padding: 40px;"><p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">No articles found for this topic.</p><p style="color: #666; font-size: 14px;">Try different keywords or check your spelling.</p></div>';
            }
          } else {
            console.log('[Search Results] Rendering', groupsWithSummaries.length, 'groups');
            groupsWithSummaries.forEach(group => {
              renderStoryGroup(group, articlesContainer);
            });
          }

          // Pagination display removed per user request
        } else if (data.rawArticles && data.rawArticles.length > 0) {
          console.log('[Search Results] No groupedArticles, but have', data.rawArticles.length, 'raw articles - displaying them');
          // Fallback: show raw articles if no groups were created
          console.log('[Search Results] No groups found, displaying', data.rawArticles.length, 'raw articles');
          articlesContainer.innerHTML = '<div class="card"><p style="font-weight: bold; margin-bottom: 15px;">Found ' + data.rawArticles.length + ' articles:</p></div>';
          data.rawArticles.slice(0, 20).forEach(article => {
            renderRawArticle(article, articlesContainer);
          });
        } else {
          // No results at all
          articlesContainer.innerHTML =
            '<div class="card" style="text-align: center; padding: 40px;"><p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">No articles found for this topic.</p><p style="color: #666; font-size: 14px;">Try different keywords or check your spelling.</p></div>';
        }

        if (data.warnings && data.warnings.length > 0) {
          const warningsDiv = document.createElement('div');
          warningsDiv.className = 'warnings';
          warningsDiv.innerHTML = `
            <h4>Note:</h4>
            <ul>
              ${data.warnings.map(w => `<li>${w}</li>`).join('')}
            </ul>
          `;
          articlesContainer.appendChild(warningsDiv);
        }
      })
      .catch(error => {
        console.error('[Search Results Loader] Error loading search results:', error);
        console.error('[Search Results Loader] API_BASE used:', API_BASE);
        console.error('[Search Results Loader] Full URL attempted:', apiUrl);
        console.error('[Search Results Loader] Full error details:', {
          message: error.message,
          stack: error.stack,
          name: error.name,
          url: apiUrl,
          origin: window.location.origin
        });

        let errorMessage = '<div style="text-align: center; padding: 40px;">';
        errorMessage += '<p style="font-size: 18px; font-weight: bold; margin-bottom: 10px;">Error loading search results</p>';
        errorMessage += '<p style="color: #666; margin-bottom: 20px;">Please try again or check your connection.</p>';
        if (error.message) {
          errorMessage += `<p style="color: #999; font-size: 12px;">Error: ${error.message}</p>`;
        }
        errorMessage += '</div>';

        articlesContainer.innerHTML = `<div class="card">${errorMessage}</div>`;
      });
  }

  // Load results on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSearchResults);
  } else {
    loadSearchResults();
  }

  // Listen for country changes
  document.addEventListener('countryChanged', () => {
    loadSearchResults();
  });

})();
