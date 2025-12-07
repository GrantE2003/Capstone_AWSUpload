const axios = require('axios');
const { MEDIASTACK_API_KEY } = require('../config/apiKeys');

const MEDIASTACK_BASE_URL = 'http://api.mediastack.com/v1';

/**
 * Fetches and normalizes articles from Mediastack API
 * @param {Object} params - Query parameters
 * @param {string} params.query - Search term/topic
 * @param {string} [params.country] - Country code (e.g., 'us')
 * @param {string} [params.category] - Category (e.g., 'sports', 'business')
 * @returns {Promise<Array>} Array of normalized Mediastack articles
 */
async function fetchMediastackArticles({ query, country, category }) {
  try {
    if (!MEDIASTACK_API_KEY) {
      console.warn('[Mediastack] No API key provided, returning empty array');
      console.log('Mediastack returned 0 results');
      return [];
    }

    const params = {
      access_key: MEDIASTACK_API_KEY,
      languages: 'en',
      limit: 50
    };

    // Add keywords/search query
    if (query && query.trim()) {
      params.keywords = query;
    }

    // Add country filter (Mediastack uses ISO country codes)
    if (country) {
      params.countries = country.toLowerCase();
    }

    // Add category filter
    if (category) {
      const categoryMap = {
        'sports': 'sports',
        'business': 'business',
        'technology': 'technology',
        'politics': 'politics',
        'health': 'health',
        'science': 'science',
        'entertainment': 'entertainment',
        'general': 'general'
      };
      const mediastackCategory = categoryMap[category] || category;
      params.categories = mediastackCategory;
    }

    console.log('[Mediastack] Fetching articles with query:', query || 'none');

    // Mediastack API endpoint: /news
    const endpoint = `${MEDIASTACK_BASE_URL}/news`;
    
    const response = await axios.get(endpoint, { 
      params,
      timeout: 15000
    });

    // Mediastack API response structure: { data: [...], pagination: {...} }
    if (response.data.error) {
      throw new Error(`Mediastack API error: ${response.data.error.info || 'Unknown error'}`);
    }

    // Mediastack API returns articles in data array
    const rawArticles = response.data?.data || [];
    
    // Normalize Mediastack articles to consistent format
    const normalizedArticles = rawArticles
      .filter(article => article.url && article.title) // Only keep articles with required fields
      .map(article => {
        // Convert published_at timestamp to ISO string if needed
        let publishedAt = article.published_at || article.publishedAt || '';
        if (publishedAt && !publishedAt.includes('T') && !publishedAt.includes('-')) {
          // If it's a timestamp, convert it
          try {
            const date = new Date(parseInt(publishedAt) * 1000);
            publishedAt = date.toISOString();
          } catch (e) {
            // Keep original if conversion fails
          }
        }
        
        return {
          title: article.title || 'No title',
          description: article.description || 'No description available.',
          url: article.url || '',
          publishedAt: publishedAt,
          sourceName: 'Mediastack'
        };
      })
      .filter(article => article.url && article.title); // Final validation

    console.log(`Mediastack returned ${normalizedArticles.length} results`);
    
    return normalizedArticles;

  } catch (error) {
    console.error('[Mediastack] Error fetching articles:', error.message);
    if (error.response) {
      console.error('[Mediastack] Response status:', error.response.status);
      console.error('[Mediastack] Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('Mediastack returned 0 results');
    return [];
  }
}

module.exports = { fetchMediastackArticles };
