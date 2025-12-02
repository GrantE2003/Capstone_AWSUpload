(function () {

  // 🔥 ADD THIS: base URL for backend (local vs production)
  const API_BASE =
    window.location.hostname.includes("localhost") ||
    window.location.hostname.includes("127.0.0.1")
      ? "http://localhost:4000"         // local dev
      : "https://capstone-awsupload.onrender.com";  // <-- your live backend

  // Map page names to API section IDs
  const pageToSection = {
    'world_news': 'world',
    'united_states': 'us-news',
    'business': 'business',
    'technology': 'technology',
    'sports': 'sport',
    'entertainment': 'culture',
    'science': 'science',
    'health': 'health',
    'politics': 'politics'
  };

  // Get current page name from URL
  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    return filename.replace('.html', '');
  }

  // Get section ID for current page
  function getSectionId() {
    const page = getCurrentPage();
    return pageToSection[page] || null;
  }

  // Inline summary functionality
  var activeSummary = null;

  function createSummaryBox(card, title, url, bodyText) {
    if (activeSummary) {
      activeSummary.remove();
    }

    var summaryHTML = `
      <div class="summary-box show">
        <div class="summary-content">
          <div class="summary-header">
            <h4 class="summary-title">AI Summary</h4>
            <button class="summary-close" aria-label="Close summary">&times;</button>
          </div>
          <div class="summary-loading">Loading summary...</div>
          <div class="summary-text" style="display: none;"></div>
          <div class="summary-actions" style="display: none;">
            <a href="${url}" target="_blank" class="btn btn-primary">Read full article</a>
          </div>
        </div>
      </div>
    `;

    card.insertAdjacentHTML('beforeend', summaryHTML);
    activeSummary = card.querySelector('.summary-box');
    card.classList.add('has-summary-open');

    activeSummary.querySelector('.summary-close').addEventListener('click', function() {
      activeSummary.remove();
      activeSummary = null;
    });

    document.addEventListener('click', function(e) {
      if (activeSummary && !activeSummary.contains(e.target) && !card.contains(e.target)) {
        activeSummary.remove();
        activeSummary = null;
        card.classList.remove('has-summary-open');
      }
    });

    // 🔥 UPDATED: summarize endpoint now uses API_BASE
    fetch(`${API_BASE}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: bodyText, title: title })
    })
    .then(response => response.json())
    .then(data => {
      activeSummary.querySelector('.summary-loading').style.display = 'none';
      activeSummary.querySelector('.summary-text').innerHTML = '<p>' + data.summary.replace(/\n/g, '<br>') + '</p>';
      activeSummary.querySelector('.summary-text').style.display = 'block';
      activeSummary.querySelector('.summary-actions').style.display = 'block';
    })
    .catch(error => {
      activeSummary.querySelector('.summary-loading').style.display = 'none';
      activeSummary.querySelector('.summary-text').innerHTML = '<p>Error loading summary. Please try again.</p>';
      activeSummary.querySelector('.summary-text').style.display = 'block';
    });
  }

  function getCountryCode() {
    if (window.LocationService) {
      return window.LocationService.getSelectedCountry();
    }
    return null;
  }

  // 🔥 UPDATED: point Guardian API calls to backend
  function buildApiUrl(sectionId, limit) {
    const countryCode = getCountryCode();
    const category = getSectionId();

    let url = `${API_BASE}/api/guardian?section=${sectionId}&limit=${limit || 12}`;

    if (countryCode) {
      url += '&country=' + encodeURIComponent(countryCode);
    }

    url += '&_t=' + Date.now();

    console.log('[NEWS REQUEST - FRONTEND]', {
      category: category || sectionId,
      countryCode: countryCode || 'none',
      sectionId: sectionId,
      limit: limit || 12,
      url: url
    });

    return url;
  }

  function loadArticles() {
    const sectionId = getSectionId();
    if (!sectionId) return;

    const main = document.querySelector('main');
    if (!main) return;

    let articlesContainer = main.querySelector('.articles-container');
    if (!articlesContainer) {
      articlesContainer = document.createElement('div');
      articlesContainer.className = 'articles-container';
      articlesContainer.innerHTML = '<div class="card"><p>Loading articles...</p></div>';
      main.appendChild(articlesContainer);
    } else {
      articlesContainer.innerHTML = '<div class="card"><p>Loading articles...</p></div>';
    }

    fetch(buildApiUrl(sectionId, 12))
      .then(response => response.json())
      .then(data => {
        if (data.items && data.items.length > 0) {
          articlesContainer.innerHTML = '';
          data.items.forEach(function(article) {
            var cardHTML = `
              <div class="card" data-body="${article.bodyText.replace(/"/g, '&quot;')}">
                <h3>${article.title}</h3>
                <p>${article.trailText || 'No description available.'}</p>
                <a href="#" class="read-more" data-title="${article.title}" data-url="${article.url}" data-body="${article.bodyText.replace(/"/g, '&quot;')}">Read more</a>
              </div>
            `;
            articlesContainer.insertAdjacentHTML('beforeend', cardHTML);
          });

          articlesContainer.querySelectorAll('.read-more').forEach(function(link) {
            link.clickHandler = function(e) {
              e.preventDefault();
              e.stopPropagation();
              var title = this.getAttribute('data-title');
              var url = this.getAttribute('data-url');
              var bodyText = this.getAttribute('data-body');
              var card = this.closest('.card');
              createSummaryBox(card, title, url, bodyText);
            };
            link.addEventListener('click', link.clickHandler);
          });
        } else {
          articlesContainer.innerHTML = '<div class="card"><p>No articles available for this topic.</p></div>';
        }
      })
      .catch(error => {
        articlesContainer.innerHTML = '<div class="card"><p>Error loading articles.</p></div>';
      });
  }

  document.addEventListener('countryChanged', () => {
    loadArticles();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadArticles);
  } else {
    loadArticles();
  }

})();
