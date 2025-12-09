const crypto = require('crypto');

/**
 * Normalized article shape that all sources map to
 * @typedef {Object} NormalizedArticle
 * @property {string} id - Unique ID (source + hash)
 * @property {'guardian'|'gdelt'|'mediastack'} source - Source identifier
 * @property {string} title - Article title
 * @property {string} [description] - Article description/summary
 * @property {string} [content] - Full article content
 * @property {string} url - Article URL
 * @property {string} sourceName - Source name for display
 * @property {string} [imageUrl] - Article image URL
 * @property {string} [publishedAt] - ISO date string
 * @property {string} [author] - Author name
 * @property {string} [language] - Language code
 */

/**
 * Creates a unique ID for an article based on source and URL
 */
function createArticleId(source, url, title) {
  const hashInput = `${source}:${url}:${title}`;
  const hash = crypto.createHash('md5').update(hashInput).digest('hex').substring(0, 8);
  return `${source}-${hash}`;
}

/**
 * Normalizes a Guardian API article to common shape
 * Guardian API fields used:
 * - raw.webTitle → title
 * - raw.webUrl → url
 * - raw.webPublicationDate → publishedAt
 * - raw.fields.trailText → description
 * - raw.fields.bodyText → content
 * - raw.fields.thumbnail → imageUrl
 * - raw.tags (contributor type) → author
 * @param {Object} raw - Raw Guardian article
 * @returns {NormalizedArticle}
 */
function normalizeGuardian(raw) {
  const description = raw.fields?.trailText || raw.fields?.bodyText?.substring(0, 200) || 'No description available.';
  return {
    id: createArticleId('guardian', raw.webUrl || raw.id, raw.webTitle),
    source: 'guardian',
    sourceName: 'The Guardian',
    title: raw.webTitle || 'No title',
    description: description,
    content: raw.fields?.bodyText || raw.fields?.trailText || description,
    url: raw.webUrl || '',
    imageUrl: raw.fields?.thumbnail || '',
    publishedAt: raw.webPublicationDate || '',
    author: raw.tags?.find(tag => tag.type === 'contributor')?.webTitle || '',
    language: 'en'
  };
}

/**
 * Normalizes a GDELT API article to common shape
 * GDELT API fields vary - handles multiple possible field names
 * @param {Object} raw - Raw GDELT article
 * @returns {NormalizedArticle}
 */
function normalizeGdelt(raw) {
  // GDELT structure varies significantly, handle multiple field name variations
  // Common GDELT fields: url, shareurl, articleurl, title, seotitle, snippet, seodescription
  const url = raw.url || raw.shareurl || raw.articleurl || raw.articleURL || '';
  const title = raw.title || raw.seotitle || raw.seoTitle || 'No title';
  const description = raw.seodescription || raw.seoDescription || raw.snippet || raw.description || 'No description available.';
  const content = raw.snippet || raw.body || description || 'No description available.';
  
  // GDELT date fields: seendate, date, time, publishedAt, published
  const publishedAt = raw.seendate || raw.seenDate || raw.date || raw.time || raw.publishedAt || raw.published || '';

  // Extract source name from URL or source field
  let sourceName = 'GDELT';
  if (raw.source) {
    sourceName = raw.source;
  } else if (url) {
    try {
      const urlObj = new URL(url);
      sourceName = urlObj.hostname.replace('www.', '');
    } catch (e) {
      // Invalid URL, use default
    }
  }

  return {
    id: createArticleId('gdelt', url, title),
    source: 'gdelt',
    sourceName: sourceName,
    title: title,
    description: description,
    content: content,
    url: url,
    imageUrl: raw.imageurl || raw.imageURL || raw.image || '',
    publishedAt: publishedAt,
    author: raw.source || raw.sourceName || raw.author || '',
    language: raw.language || 'en'
  };
}

/**
 * Normalizes a Mediastack API article to common shape
 * Mediastack API fields used:
 * - raw.title → title
 * - raw.url → url
 * - raw.description → description, content
 * - raw.published_at → publishedAt
 * - raw.image → imageUrl
 * - raw.author → author
 * - raw.language → language
 * - raw.source → sourceName
 * @param {Object} raw - Raw Mediastack article
 * @returns {NormalizedArticle}
 */
function normalizeMediastack(raw) {
  // Extract source name
  let sourceName = 'Mediastack';
  if (raw.source) {
    sourceName = typeof raw.source === 'string' ? raw.source : (raw.source.name || 'Mediastack');
  }

  const description = raw.description || 'No description available.';

  return {
    id: createArticleId('mediastack', raw.url || '', raw.title),
    source: 'mediastack',
    sourceName: sourceName,
    title: raw.title || 'No title',
    description: description,
    content: raw.description || raw.content || description,
    url: raw.url || '',
    imageUrl: raw.image || '',
    publishedAt: raw.published_at || raw.publishedAt || '',
    author: raw.author || '',
    language: raw.language || 'en'
  };
}

/**
 * Normalizes an array of articles from a specific source
 * @param {Array} articles - Raw articles
 * @param {string} source - Source name ('guardian', 'gdelt', 'mediastack')
 * @returns {Array<NormalizedArticle>}
 */
function normalizeArticles(articles, source) {
  if (!Array.isArray(articles)) {
    console.warn(`[Normalize] Articles is not an array for source ${source}, got:`, typeof articles);
    return [];
  }

  const normalizers = {
    guardian: normalizeGuardian,
    gdelt: normalizeGdelt,
    mediastack: normalizeMediastack
  };

  const normalizer = normalizers[source];
  if (!normalizer) {
    console.warn(`[Normalize] Unknown source: ${source}`);
    return [];
  }

  const filtered = articles.filter(article => {
    // Filter out articles without required fields
    const hasUrl = article.webUrl || article.url || article.articleurl || article.shareurl;
    const hasTitle = article.webTitle || article.title || article.seotitle;
    return hasUrl && hasTitle;
  });

  console.log(`[Normalize] Filtered ${articles.length} articles to ${filtered.length} valid articles for ${source}`);

  const normalized = filtered
    .map(normalizer)
    .map(article => {
      // Ensure description always has a fallback
      if (!article.description || article.description.trim() === '') {
        article.description = 'No description available.';
      }
      // Ensure sourceName always has a fallback
      if (!article.sourceName || article.sourceName.trim() === '') {
        article.sourceName = article.source || 'Unknown Source';
      }
      return article;
    })
    .filter(article => {
      // Only filter out articles missing critical fields (url and title)
      return article.url && article.title;
    });

  console.log(`[Normalize] Normalized ${filtered.length} articles to ${normalized.length} final articles for ${source}`);
  
  // Log sample normalized article to verify structure
  if (normalized.length > 0) {
    console.log(`[Normalize] Sample normalized article for ${source}:`, {
      id: normalized[0].id,
      source: normalized[0].source,
      sourceName: normalized[0].sourceName,
      hasTitle: !!normalized[0].title,
      hasDescription: !!normalized[0].description,
      hasUrl: !!normalized[0].url,
      hasPublishedAt: !!normalized[0].publishedAt
    });
  }
  
  return normalized;
}

module.exports = {
  normalizeGuardian,
  normalizeGdelt,
  normalizeMediastack,
  normalizeArticles
};

