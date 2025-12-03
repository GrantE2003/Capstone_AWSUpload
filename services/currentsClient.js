const axios = require('axios');
const { CURRENTS_API_KEY } = require('../config/apiKeys');

const CURRENTS_BASE_URL = 'https://api.currentsapi.services/v1';

/**
 * Fetches and normalizes articles from Currents API
 * Currents API documentation: https://currentsapi.services/en/docs
 * @param {Object} params - Query parameters
 * @param {string} params.query - Search term/topic
 * @param {string} [params.country] - Country code (e.g., 'us')
 * @param {string} [params.category] - Category (e.g., 'sports', 'business')
 * @returns {Promise<Array>} Array of normalized Currents articles
 */
async function fetchCurrentsArticles({ query, country, category }) {
  try {
    if (!CURRENTS_API_KEY) {
      console.warn('[Currents] No API key provided, returning empty array');
      console.log('Currents returned 0 results');
      return [];
    }

    const params = {
      apiKey: CURRENTS_API_KEY,
      language: 'en',
      pageSize: 50
    };

    // Add keywords/search query
    if (query && query.trim()) {
      params.keywords = query;
    }

    // Add country filter (Currents uses country code)
    if (country) {
      params.country = country.toLowerCase();
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
      const currentsCategory = categoryMap[category] || category;
      params.category = currentsCategory;
    }

    console.log('[Currents] Fetching articles with query:', query || 'none');

    // Currents API endpoint: /latest-news or /search
    const endpoint = query ? `${CURRENTS_BASE_URL}/search` : `${CURRENTS_BASE_URL}/latest-news`;
    
    const response = await axios.get(endpoint, { 
      params,
      timeout: 15000
    });

    // Currents API response structure: { status: 'ok', news: [...] }
    if (response.data.status && response.data.status !== 'ok') {
      throw new Error(`Currents API error: ${response.data.message || 'Unknown error'}`);
    }

    // Currents API returns articles in news array
    const rawArticles = response.data?.news || [];
    
    // If no articles in news, check for data array (some endpoints use this)
    const articlesToProcess = rawArticles.length > 0 ? rawArticles : (response.data?.data || []);

    // Normalize Currents articles to consistent format
    const normalizedArticles = articlesToProcess
      .filter(article => article.url && article.title) // Only keep articles with required fields
      .map(article => ({
        title: article.title || 'No title',
        description: article.description || 'No description available.',
        url: article.url || '',
        publishedAt: article.published || '',
        sourceName: 'Currents'
      }))
      .filter(article => article.url && article.title); // Final validation

    console.log(`Currents returned ${normalizedArticles.length} results`);
    
    return normalizedArticles;

  } catch (error) {
    console.error('[Currents] Error fetching articles:', error.message);
    if (error.response) {
      console.error('[Currents] Response status:', error.response.status);
      console.error('[Currents] Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('Currents returned 0 results');
    return [];
  }
}

module.exports = { fetchCurrentsArticles };
