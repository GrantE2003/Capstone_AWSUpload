(function () {

  // Base URL for backend (environment-aware configuration)
  // Priority: window.API_BASE_URL (set by server) > hostname detection > fallback
  const API_BASE = (function() {
    // Check if server set a global API base URL (for production)
    // This is injected by the backend server into the HTML
    if (window.API_BASE_URL) {
      return window.API_BASE_URL;
    }
    
    // Development: detect localhost
    if (window.location.hostname.includes("localhost") ||
        window.location.hostname.includes("127.0.0.1")) {
      return "http://localhost:4000";
    }
    
    // Production: use same origin (backend and frontend on same domain)
    // This works for AWS deployments where frontend and backend are served together
    // The backend should inject window.API_BASE_URL, but this is a fallback
    return window.location.origin;
  })();

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

  // Build API URL for search
  function buildSearchUrl(query, page = 1) {
    const countryCode = getCountryCode();
    const url = new URL(`${API_BASE}/api/news/aggregate`);
    
    url.searchParams.set('query', query);
    if (countryCode) {
      url.searchParams.set('country', countryCode);
    }
    if (page > 1) {
      url.searchParams.set('page', page);
    }

    return url.toString();
  }

  // Create source dropdown for a story group
  function createSourceDropdown(group) {
    if (!group.articles || group.articles.length === 0) {
      return null;
    }

    // CRITICAL: Ensure only ONE article per source
    // Group articles by source, then keep only the most recent one per source
    const sourceMap = new Map();
    group.articles.forEach(article => {
      const sourceName = article.sourceName || article.source || 'Unknown';
      
      if (!sourceMap.has(sourceName)) {
        // First article from this source, keep it
        sourceMap.set(sourceName, article);
      } else {
        // We already have an article from this source, compare dates
        const existing = sourceMap.get(sourceName);
        try {
          const existingDate = existing.publishedAt ? new Date(existing.publishedAt).getTime() : 0;
          const currentDate = article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
          
          // Keep the more recent article
          if (currentDate > existingDate && currentDate > 0) {
            sourceMap.set(sourceName, article);
          }
          // If dates are equal or invalid, keep the first one (existing)
        } catch (e) {
          // Invalid date, keep existing
        }
      }
    });
    
    // Verify we have unique sources
    if (sourceMap.size !== group.articles.length) {
      console.log(`[Frontend] Deduplicated sources in group ${group.groupId}: ${group.articles.length} articles -> ${sourceMap.size} unique sources`);
    }

    // Create dropdown container
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

    // Create list of sources
    const sourcesList = document.createElement('ul');
    sourcesList.className = 'sources-list';

    // sourceMap now contains only ONE article per source (the most recent one)
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

    // Toggle dropdown on click
    dropdownButton.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const isExpanded = dropdownButton.getAttribute('aria-expanded') === 'true';
      dropdownContent.style.display = isExpanded ? 'none' : 'block';
      dropdownButton.setAttribute('aria-expanded', !isExpanded);
      dropdownButton.querySelector('.dropdown-arrow').textContent = isExpanded ? '▼' : '▲';
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
      if (!dropdownContainer.contains(e.target)) {
        dropdownContent.style.display = 'none';
        dropdownButton.setAttribute('aria-expanded', 'false');
        dropdownButton.querySelector('.dropdown-arrow').textContent = '▼';
      }
    });

    return dropdownContainer;
  }

  // Render a story group with its summary and articles
  // This matches the screenshot style: white rounded card with title, summary, and dropdown
  function renderStoryGroup(group, container) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'story-group-card'; // Changed to match screenshot style
    groupDiv.setAttribute('data-group-id', group.groupId);

    // Title (bold, at top) - matches screenshot
    const titleEl = document.createElement('h3');
    titleEl.className = 'story-title';
    titleEl.textContent = group.groupTitle || 'News Story';
    groupDiv.appendChild(titleEl);

    // Combined summary with truncation and expand functionality
    // CRITICAL: Summary must ALWAYS be present - it's the core of the story
    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'story-summary';
    
    // CRITICAL: Summary must ALWAYS exist - build fallback if missing
    let fullSummary = group.summary;
    if (!fullSummary || fullSummary.trim().length === 0) {
      // Build fallback summary from article descriptions
      const summaryParts = [];
      if (group.articles && group.articles.length > 0) {
        group.articles.forEach(article => {
          if (article.description && article.description.trim().length > 20) {
            const sentences = article.description.split(/[.!?]+/).filter(s => s.trim().length > 0);
            if (sentences.length > 0) {
              summaryParts.push(sentences[0].trim());
            }
          }
        });
      }
      fullSummary = summaryParts.length > 0 
        ? summaryParts.slice(0, 2).join(' ') + '.'
        : 'Multiple sources covered this story. Please review the articles below for details.';
    }
    
    const summaryPreview = fullSummary.length > 250 ? fullSummary.substring(0, 250) + '...' : fullSummary;
    const needsExpansion = fullSummary.length > 250;
    
    const summaryText = document.createElement('p');
    summaryText.className = 'summary-text';
    summaryText.textContent = needsExpansion ? summaryPreview : fullSummary;
    summaryDiv.appendChild(summaryText);
    
    // Add "Read more" link if summary is long (matches screenshot)
    if (needsExpansion) {
      const readMoreLink = document.createElement('a');
      readMoreLink.href = '#';
      readMoreLink.className = 'read-more-link';
      readMoreLink.textContent = 'Read more';
      readMoreLink.addEventListener('click', function(e) {
        e.preventDefault();
        summaryText.textContent = fullSummary;
        readMoreLink.style.display = 'none';
        if (readLessLink) readLessLink.style.display = 'inline';
      });
      summaryDiv.appendChild(readMoreLink);
      
      const readLessLink = document.createElement('a');
      readLessLink.href = '#';
      readLessLink.className = 'read-less-link';
      readLessLink.textContent = 'Read less';
      readLessLink.style.display = 'none';
      readLessLink.addEventListener('click', function(e) {
        e.preventDefault();
        summaryText.textContent = summaryPreview;
        readLessLink.style.display = 'none';
        readMoreLink.style.display = 'inline';
        summaryDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      summaryDiv.appendChild(readLessLink);
    }
    
    groupDiv.appendChild(summaryDiv);

    // REMOVED: Key Differences section - no longer needed
    // REMOVED: "Articles from Multiple Sources" section - sources only appear in dropdown
    
    // Source dropdown - this is the ONLY place sources are shown
    const sourceDropdown = createSourceDropdown(group);
    if (sourceDropdown) {
      groupDiv.appendChild(sourceDropdown);
    }
    
    container.appendChild(groupDiv);
  }

  // Render a raw article (fallback when grouping fails)
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
        ${article.publishedAt ? `<span class="article-date">Published: ${new Date(article.publishedAt).toLocaleDateString()}</span>` : ''}
      </div>
    `;
    
    container.appendChild(articleDiv);
  }

  // Load search results
  function loadSearchResults() {
    const query = getSearchQuery();
    if (!query) {
      const main = document.querySelector('main');
      if (main) {
        main.innerHTML = '<div class="card"><p>No search query provided.</p></div>';
      }
      return;
    }

    const main = document.querySelector('main');
    if (!main) return;

    // Find or create articles container
    let articlesContainer = main.querySelector('.articles-container');
    if (!articlesContainer) {
      // Try to find Article Links section
      const articleLinksSection = main.querySelector('.Article\\ Links') || 
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
        articlesContainer.innerHTML = '<div class="card"><p>Loading search results...</p></div>';
        main.appendChild(articlesContainer);
      }
    } else {
      articlesContainer.innerHTML = '<div class="card"><p>Loading search results...</p></div>';
    }

    console.log('[Search Results] Fetching:', buildSearchUrl(query));

    fetch(buildSearchUrl(query))
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('[Search Results] Received data:', {
          groupedArticles: data.groupedArticles?.length || 0,
          rawArticles: data.rawArticles?.length || 0,
          articles: data.articles?.length || 0,
          fallbackMode: data.fallbackMode || false
        });
        
        articlesContainer.innerHTML = '';

        // CRITICAL: ONLY render grouped articles - this is the core functionality
        // NO fallback to raw articles - the UI must show grouped summaries only
        if (data.groupedArticles && data.groupedArticles.length > 0) {
          // Display grouped articles - this is the ONLY rendering mode
          console.log('[Search Results] Displaying', data.groupedArticles.length, 'grouped stories');
          data.groupedArticles.forEach(group => {
            renderStoryGroup(group, articlesContainer);
          });

          // Show pagination if available
          if (data.pagination && data.pagination.totalPages > 1) {
            const paginationDiv = document.createElement('div');
            paginationDiv.className = 'pagination';
            paginationDiv.innerHTML = `
              <p>Page ${data.pagination.currentPage} of ${data.pagination.totalPages}</p>
            `;
            articlesContainer.appendChild(paginationDiv);
          }
        } else {
          // No groups available - show message instead of raw articles
          articlesContainer.innerHTML = '<div class="card"><p>No grouped stories found for your search. Try a different keyword.</p></div>';
        }

        // Show warnings if any
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
        console.error('Error loading search results:', error);
        articlesContainer.innerHTML = '<div class="card"><p>Error loading search results. Please try again.</p></div>';
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

