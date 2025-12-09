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

  // Render a story group with its summary and sources dropdown
  function renderStoryGroup(group, container) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'story-group-card';
    groupDiv.setAttribute('data-group-id', group.groupId);

    const titleEl = document.createElement('h3');
    titleEl.className = 'story-title';
    titleEl.textContent = group.groupTitle || 'News Story';
    groupDiv.appendChild(titleEl);

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'story-summary';

    // Check for aiSummary first (new field name), then fallback to summary (for backwards compatibility)
    let fullSummary = group.aiSummary || group.summary;
    if (!fullSummary || fullSummary.trim().length === 0) {
      const summaryParts = [];
      if (group.articles && group.articles.length > 0) {
        group.articles.forEach(article => {
          if (article.description && article.description.trim().length > 20) {
            const sentences = article.description
              .split(/[.!?]+/)
              .filter(s => s.trim().length > 0);
            if (sentences.length > 0) {
              summaryParts.push(sentences[0].trim());
            }
          }
        });
      }
      fullSummary =
        summaryParts.length > 0
          ? summaryParts.slice(0, 2).join(' ') + '.'
          : 'Multiple sources covered this story. Please review the articles below for details.';
    }

    const summaryPreview =
      fullSummary.length > 250
        ? fullSummary.substring(0, 250) + '...'
        : fullSummary;
    const needsExpansion = fullSummary.length > 250;

    const summaryText = document.createElement('p');
    summaryText.className = 'summary-text';
    summaryText.textContent = needsExpansion ? summaryPreview : fullSummary;
    summaryDiv.appendChild(summaryText);

    if (needsExpansion) {
      const readMoreLink = document.createElement('a');
      readMoreLink.href = '#';
      readMoreLink.className = 'read-more-link';
      readMoreLink.textContent = 'Read more';

      const readLessLink = document.createElement('a');
      readLessLink.href = '#';
      readLessLink.className = 'read-less-link';
      readLessLink.textContent = 'Read less';
      readLessLink.style.display = 'none';

      readMoreLink.addEventListener('click', function (e) {
        e.preventDefault();
        summaryText.textContent = fullSummary;
        readMoreLink.style.display = 'none';
        readLessLink.style.display = 'inline';
      });

      readLessLink.addEventListener('click', function (e) {
        e.preventDefault();
        summaryText.textContent = summaryPreview;
        readLessLink.style.display = 'none';
        readMoreLink.style.display = 'inline';
        summaryDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });

      summaryDiv.appendChild(readMoreLink);
      summaryDiv.appendChild(readLessLink);
    }

    groupDiv.appendChild(summaryDiv);

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
        <div style="font-size: 24px; margin-bottom: 20px;">🔍</div>
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

        if (data.groupedArticles && data.groupedArticles.length > 0) {
          console.log('[Search Results] Displaying', data.groupedArticles.length, 'grouped stories');
          data.groupedArticles.forEach(group => {
            renderStoryGroup(group, articlesContainer);
          });

          if (data.pagination && data.pagination.totalPages > 1) {
            const paginationDiv = document.createElement('div');
            paginationDiv.className = 'pagination';
            paginationDiv.innerHTML = `
              <p>Page ${data.pagination.currentPage} of ${data.pagination.totalPages}</p>
            `;
            articlesContainer.appendChild(paginationDiv);
          }
        } else if (data.rawArticles && data.rawArticles.length > 0) {
          // Fallback: show raw articles if no groups were created
          console.log('[Search Results] No groups found, displaying', data.rawArticles.length, 'raw articles');
          articlesContainer.innerHTML = '<div class="card"><p style="font-weight: bold; margin-bottom: 15px;">Found ' + data.rawArticles.length + ' articles:</p></div>';
          data.rawArticles.slice(0, 20).forEach(article => {
            renderRawArticle(article, articlesContainer);
          });
        } else {
          articlesContainer.innerHTML =
            '<div class="card"><p style="font-size: 16px; padding: 20px;">No articles found for your search: "<strong>' + query + '</strong>"</p><p style="color: #666; font-size: 14px;">Try different keywords or check your spelling.</p></div>';
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
        errorMessage += '<div style="font-size: 48px; margin-bottom: 20px;">⚠️</div>';
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
