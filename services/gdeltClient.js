const axios = require('axios');
const { GDELT_API_KEY } = require('../config/apiKeys');

// GDELT API documentation: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
// Free tier doesn't require API key, but rate limits apply
const GDELT_BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * Fetches and normalizes articles from GDELT API
 * @param {Object} params - Query parameters
 * @param {string} params.query - Search term/topic
 * @param {string} [params.country] - Country code (e.g., 'us')
 * @param {string} [params.category] - Category (not directly supported, but can filter)
 * @returns {Promise<Array>} Array of normalized GDELT articles
 */
async function fetchGdeltArticles({ query, country, category }) {
  try {
    // Determine if this is a search query or category request
    const hasSearchQuery = query && query.trim().length > 0;
    const hasCategory = category && category.trim().length > 0;
    
    let gdeltQuery = '';
    
    // If search query is provided, use it (search mode)
    if (hasSearchQuery) {
      gdeltQuery = query.trim();
      console.log('[GDELT] SEARCH MODE: Using search query:', gdeltQuery);
    }
    // If category is provided but no search query, use category (category mode)
    else if (hasCategory) {
      gdeltQuery = category;
      console.log('[GDELT] CATEGORY MODE: Using category:', category);
    }
    // If neither, return empty (shouldn't happen in normal flow)
    else {
      console.warn('[GDELT] No search query or category provided - returning empty results');
      return [];
    }
    
    const params = {
      query: gdeltQuery,
      mode: 'artlist', // Return article list
      maxrecords: 50,
      format: 'json',
      sort: 'date'
    };

    // Add country filter if provided (append to query)
    if (country) {
      const countryCode = country.toUpperCase();
      params.query = `${params.query} sourcecountry:${countryCode}`;
    }

    console.log('[GDELT] Fetching articles with query:', params.query);

    const response = await axios.get(GDELT_BASE_URL, { 
      params,
      timeout: 20000 // 20 second timeout for GDELT
    });

    // GDELT response structure varies - handle multiple formats
    let articleList = [];
    
    // Check if response.data is an array
    if (Array.isArray(response.data)) {
      articleList = response.data;
    }
    // Check if response.data.articles exists (most common format)
    else if (response.data?.articles && Array.isArray(response.data.articles)) {
      articleList = response.data.articles;
    }
    // Check if response.data has article-like objects at root
    else if (response.data && typeof response.data === 'object') {
      // Try to find array of articles in response
      const keys = Object.keys(response.data);
      for (const key of keys) {
        if (Array.isArray(response.data[key]) && response.data[key].length > 0) {
          const firstItem = response.data[key][0];
          if (firstItem && (firstItem.url || firstItem.title || firstItem.articleurl || firstItem.shareurl)) {
            articleList = response.data[key];
            break;
          }
        }
      }
    }
    
    // If still no articles, check for alternative response structures
    if (articleList.length === 0 && response.data) {
      if (response.data.response?.articles) {
        articleList = response.data.response.articles;
      } else if (response.data.results) {
        articleList = response.data.results;
      }
    }

    // Normalize GDELT articles to consistent format
    const normalizedArticles = articleList
      .filter(article => {
        // Keep articles that have at least a URL or title
        const url = article.url || article.shareurl || article.articleurl || article.articleURL || '';
        const title = article.title || article.seotitle || article.seoTitle || '';
        return url || title;
      })
      .map(article => {
        const url = article.url || article.shareurl || article.articleurl || article.articleURL || '';
        const title = article.title || article.seotitle || article.seoTitle || 'No title';
        // Try multiple fields for description
        const description = article.seodescription || article.seoDescription || article.snippet || article.description || article.bodyText || 'No description available.';
        // Try multiple fields for date
        const publishedAt = article.seendate || article.seenDate || article.date || article.time || article.publishedAt || article.published || '';
        
        return {
          title: title,
          description: description,
          url: url,
          publishedAt: publishedAt,
          sourceName: 'GDELT'
        };
      })
      .filter(article => article.url && article.title); // Final validation - must have URL and title

    console.log(`GDELT returned ${normalizedArticles.length} results`);
    
    return normalizedArticles;

  } catch (error) {
    console.error('[GDELT] Error fetching articles:', error.message);
    if (error.response) {
      console.error('[GDELT] Response status:', error.response.status);
      console.error('[GDELT] Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('GDELT returned 0 results');
    return [];
  }
}

module.exports = { fetchGdeltArticles };
