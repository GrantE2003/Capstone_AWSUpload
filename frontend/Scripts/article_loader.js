(function () {
  'use strict';

  // ======================================================
  // API base URL (dev → localhost | prod → Render)
  // ======================================================
  const API_BASE = (function () {
    if (
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    ) {
      console.log('[Article Loader] Using localhost backend');
      return 'http://localhost:4000';
    }

    const renderUrl = 'https://capstone-awsupload.onrender.com';
    console.log('[Article Loader] Using Render backend:', renderUrl);
    return renderUrl;
  })();

  console.log('[Article Loader] Final API_BASE:', API_BASE);

  // ======================================================
  // Page → category mapping
  // ======================================================
  const pageToCategory = {
    world_news: 'world',
    united_states: 'us-news',
    business: 'business',
    technology: 'technology',
    sports: 'sport',
    entertainment: 'culture',
    science: 'science',
    health: 'health',
    politics: 'politics'
  };

  function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    return filename.replace('.html', '');
  }

  function getCategoryId() {
    return pageToCategory[getCurrentPage()] || null;
  }

  function getCountryCode() {
    return window.LocationService
      ? window.LocationService.getSelectedCountry()
      : null;
  }

  // ======================================================
  // Build backend aggregate URL
  // ======================================================
  function buildApiUrl(category, page = 1) {
    const countryCode = getCountryCode();
    const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;

    const url = new URL('/api/news/aggregate', base);

    if (category) url.searchParams.set('category', category);
    if (countryCode) url.searchParams.set('country', countryCode);
    if (page > 1) url.searchParams.set('page', page);

    console.log('[Article Loader] Fetch:', url.toString());
    return url.toString();
  }

  // ======================================================
  // Source dropdown (unique per story group)
  // ======================================================
  function createSourceDropdown(group) {
    if (!group.articles || group.articles.length === 0) return null;

    const sourceMap = new Map();

    group.articles.forEach((article) => {
      const name = article.sourceName || article.source || 'Unknown';

      if (!sourceMap.has(name)) {
        sourceMap.set(name, article);
      } else {
        const existing = sourceMap.get(name);
        const newDate = new Date(article.publishedAt || 0).getTime();
        const oldDate = new Date(existing.publishedAt || 0).getTime();
        if (newDate > oldDate) sourceMap.set(name, article);
      }
    });

    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'source-dropdown-container';

    const button = document.createElement('button');
    button.className = 'source-dropdown-button';
    button.innerHTML = `
      <span class="dropdown-label">Sources used (${sourceMap.size})</span>
      <span class="dropdown-arrow">▼</span>
    `;
    button.setAttribute('aria-expanded', 'false');

    const content = document.createElement('div');
    content.className = 'source-dropdown-content';
    content.style.display = 'none';

    const ul = document.createElement('ul');
    ul.className = 'sources-list';

    sourceMap.forEach((article, sourceName) => {
      const li = document.createElement('li');
      li.className = 'source-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'source-name';
      nameSpan.textContent = sourceName;

      const title =
        article.title ||
        article.webTitle ||
        article.headline ||
        article.description ||
        'View article'; // ⭐ FIX

      const link = document.createElement('a');
      link.href = article.url;
      link.target = '_blank';
      link.className = 'source-article-link';
      link.textContent = title;

      li.appendChild(nameSpan);
      li.appendChild(document.createTextNode(': '));
      li.appendChild(link);
      ul.appendChild(li);
    });

    content.appendChild(ul);
    dropdownContainer.appendChild(button);
    dropdownContainer.appendChild(content);

    button.addEventListener('click', (e) => {
      e.preventDefault();
      const open = button.getAttribute('aria-expanded') === 'true';
      content.style.display = open ? 'none' : 'block';
      button.setAttribute('aria-expanded', String(!open));
      button.querySelector('.dropdown-arrow').textContent = open ? '▼' : '▲';
    });

    document.addEventListener('click', (event) => {
      if (!dropdownContainer.contains(event.target)) {
        content.style.display = 'none';
        button.setAttribute('aria-expanded', 'false');
        button.querySelector('.dropdown-arrow').textContent = '▼';
      }
    });

    return dropdownContainer;
  }

  // ======================================================
  // RENDER group card
  // ======================================================
  function renderStoryGroup(group, container) {
    const card = document.createElement('div');
    card.className = 'story-group-card';

    // ⭐ FIX — universal fallback for titles (Guardian + Currents + GDELT)
    const title =
      group.groupTitle ||
      group.title ||
      group.articles?.[0]?.title ||
      group.articles?.[0]?.webTitle ||
      'News Story';

    const h3 = document.createElement('h3');
    h3.className = 'story-title';
    h3.textContent = title;
    card.appendChild(h3);

    // ⭐ FIX — universal fallback for summary/description
    let fullSummary =
      group.summary ||
      group.description ||
      group.articles?.[0]?.description ||
      group.articles?.[0]?.trailText ||
      '';

    if (!fullSummary.trim()) {
      fullSummary = 'Summary not available for this story.';
    }

    const summaryDiv = document.createElement('div');
    summaryDiv.className = 'story-summary';

    const preview =
      fullSummary.length > 250 ? fullSummary.substring(0, 250) + '...' : fullSummary;

    const p = document.createElement('p');
    p.className = 'summary-text';
    p.textContent = preview;

    summaryDiv.appendChild(p);
    card.appendChild(summaryDiv);

    // Add dropdown of sources
    const dropdown = createSourceDropdown(group);
    if (dropdown) card.appendChild(dropdown);

    container.appendChild(card);
  }

  // ======================================================
  // LOAD ARTICLES
  // ======================================================
  function loadArticles() {
    const category = getCategoryId();
    if (!category) return;

    const main = document.querySelector('main');
    if (!main) return;

    let container = main.querySelector('.articles-container');

    if (!container) {
      container = document.createElement('div');
      container.className = 'articles-container';
      main.appendChild(container);
    }

    container.innerHTML = `<div class="card"><p>Loading articles...</p></div>`;

    fetch(buildApiUrl(category))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        console.log('[Article Loader] Received:', data);

        container.innerHTML = '';

        if (data.groupedArticles?.length) {
          data.groupedArticles.forEach((group) =>
            renderStoryGroup(group, container)
          );
        } else {
          container.innerHTML =
            '<div class="card"><p>No grouped stories available.</p></div>';
        }

        if (data.warnings?.length) {
          const warn = document.createElement('div');
          warn.className = 'warnings';
          warn.innerHTML = `<h4>Note:</h4><ul>${data.warnings
            .map((w) => `<li>${w}</li>`)
            .join('')}</ul>`;
          container.appendChild(warn);
        }
      })
      .catch((err) => {
        console.error('[Article Loader] ERROR:', err);
        container.innerHTML = `<div class="card"><p>Error loading articles.<br>${err}</p></div>`;
      });
  }

  document.addEventListener('countryChanged', loadArticles);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadArticles);
  } else {
    loadArticles();
  }
})();
