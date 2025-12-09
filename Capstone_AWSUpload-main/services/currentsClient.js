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
    console.log('[Currents] fetchCurrentsArticles called with:', { query, country, category });
    
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

    // Determine if this is a search query or category request
    const hasSearchQuery = query && query.trim().length > 0;
    const hasCategory = category && category.trim().length > 0;
    
    console.log('[Currents] Query check:', { 
      query, 
      hasSearchQuery, 
      hasCategory,
      queryType: typeof query,
      queryLength: query ? query.length : 0
    });

    let endpoint = '';
    
    // If search query is provided, use search endpoint (search mode)
    if (hasSearchQuery) {
      params.keywords = query.trim();
      endpoint = `${CURRENTS_BASE_URL}/search`;
      console.log('[Currents] SEARCH MODE: Using search query:', query.trim());
    }
    // If category is provided but no search query, use latest-news with category (category mode)
    else if (hasCategory) {
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
      endpoint = `${CURRENTS_BASE_URL}/latest-news`;
      console.log('[Currents] CATEGORY MODE: Using category:', currentsCategory);
    }
    // If neither, return empty (shouldn't happen in normal flow)
    else {
      console.warn('[Currents] No search query or category provided - returning empty results');
      return [];
    }

    // Add country filter (Currents uses country code) - works with both search and category
    if (country) {
      params.country = country.toLowerCase();
    }

    // Add category filter to search if both are provided (optional enhancement)
    if (hasSearchQuery && hasCategory) {
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
    
    console.log('[Currents] Making API request to:', endpoint);
    console.log('[Currents] Request params (excluding apiKey):', { ...params, apiKey: '[REDACTED]' });
    
    const response = await axios.get(endpoint, { 
      params,
      timeout: 15000
    });

    console.log('[Currents] API response status:', response.data?.status);
    console.log('[Currents] API response news count:', response.data?.news?.length || 0);

    // Currents API response structure: { status: 'ok', news: [...] }
    if (response.data.status && response.data.status !== 'ok') {
      const errorMsg = `Currents API error: ${response.data.message || 'Unknown error'}`;
      console.error('[Currents]', errorMsg);
      throw new Error(errorMsg);
    }

    // Currents API returns articles in news array
    const rawArticles = response.data?.news || [];
    console.log('[Currents] Raw articles received:', rawArticles.length);
    
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
