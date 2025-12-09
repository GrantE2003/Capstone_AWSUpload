const axios = require('axios');
const { GUARDIAN_API_KEY } = require('../config/apiKeys');

const GUARDIAN_BASE_URL = 'https://content.guardianapis.com';

/**
 * Fetches and normalizes articles from The Guardian API
 * @param {Object} params - Query parameters
 * @param {string} params.query - Search term/topic
 * @param {string} [params.country] - Country code (e.g., 'us')
 * @param {string} [params.category] - Category (e.g., 'sports', 'business')
 * @returns {Promise<Array>} Array of normalized Guardian articles
 */
async function fetchGuardianArticles({ query, country, category }) {
  try {
    console.log('[Guardian] fetchGuardianArticles called with:', { query, country, category });
    
    if (!GUARDIAN_API_KEY) {
      console.warn('[Guardian] No API key provided, returning empty array');
      return [];
    }

    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'trailText,bodyText,thumbnail',
      'show-tags': 'all',
      'page-size': 50,
      'order-by': 'newest'
    };

    // Determine if this is a search query or category request
    const hasSearchQuery = query && query.trim().length > 0;
    const hasCategory = category && category.trim().length > 0;
    
    console.log('[Guardian] Query check:', { 
      query, 
      hasSearchQuery, 
      hasCategory,
      queryType: typeof query,
      queryLength: query ? query.length : 0
    });

    let searchQuery = null; // Initialize for logging

    // If search query is provided, use it (search mode)
    if (hasSearchQuery) {
      // Build query with country filter if provided
      searchQuery = query.trim();
      if (country) {
        const countryName = getCountryName(country);
        if (countryName) {
          const countryTerms = [countryName, country.toUpperCase()].map(term => `"${term}"`).join(' OR ');
          searchQuery = `(${searchQuery}) AND (${countryTerms})`;
        }
      }
      params.q = searchQuery;
      console.log('[Guardian] SEARCH MODE: Using search query:', searchQuery);
    } 
    // If category is provided but no search query, use category (category mode)
    else if (hasCategory) {
      const categoryMap = {
        'sports': 'sport',
        'business': 'business',
        'technology': 'technology',
        'politics': 'politics',
        'health': 'health',
        'science': 'science',
        'entertainment': 'culture',
        'world': 'world',
        'us': 'us-news'
      };
      params.section = categoryMap[category] || category;
      console.log('[Guardian] CATEGORY MODE: Using category:', params.section);
      
      // Add country filter to category search if provided
      if (country) {
        const countryName = getCountryName(country);
        if (countryName) {
          const countryTerms = [countryName, country.toUpperCase()].map(term => `"${term}"`).join(' OR ');
          params.q = countryTerms;
          searchQuery = countryTerms; // Set for logging
        }
      }
    }
    // If neither query nor category, return empty (shouldn't happen in normal flow)
    else {
      console.warn('[Guardian] No search query or category provided - returning empty results');
      return [];
    }

    console.log('[Guardian] Fetching articles with params:', {
      query: searchQuery || params.q || 'none',
      section: params.section || 'none',
      country: country || 'none'
    });

    console.log('[Guardian] Making API request to:', `${GUARDIAN_BASE_URL}/search`);
    console.log('[Guardian] Request params (excluding api-key):', { ...params, 'api-key': '[REDACTED]' });
    
    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params, timeout: 15000 });
    
    console.log('[Guardian] API response status:', response.data.response?.status);
    console.log('[Guardian] API response total:', response.data.response?.total);
    
    if (response.data.response.status !== 'ok') {
      const errorMsg = `Guardian API error: ${response.data.response.message}`;
      console.error('[Guardian]', errorMsg);
      throw new Error(errorMsg);
    }

    const rawArticles = response.data.response.results || [];
    console.log('[Guardian] Raw articles received:', rawArticles.length);
    
    // Normalize Guardian articles to consistent format
    const normalizedArticles = rawArticles
      .filter(article => article.webUrl && article.webTitle) // Only keep articles with required fields
      .map(article => ({
        title: article.webTitle || 'No title',
        description: article.fields?.trailText || article.fields?.bodyText?.substring(0, 200) || 'No description available.',
        url: article.webUrl || '',
        publishedAt: article.webPublicationDate || '',
        sourceName: 'Guardian'
      }))
      .filter(article => article.url && article.title); // Final validation

    console.log(`Guardian returned ${normalizedArticles.length} results`);
    
    return normalizedArticles;

  } catch (error) {
    console.error('[Guardian] Error fetching articles:', error.message);
    if (error.response) {
      console.error('[Guardian] Response status:', error.response.status);
      console.error('[Guardian] Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.log('Guardian returned 0 results');
    return [];
  }
}

/**
 * Helper to get country name from code
 */
function getCountryName(countryCode) {
  const countryMap = {
    'us': 'United States',
    'gb': 'United Kingdom',
    'ca': 'Canada',
    'au': 'Australia',
    'de': 'Germany',
    'fr': 'France',
    'it': 'Italy',
    'es': 'Spain',
    'jp': 'Japan',
    'cn': 'China',
    'in': 'India',
    'br': 'Brazil',
    'mx': 'Mexico',
    'ru': 'Russia',
    'kr': 'South Korea'
  };
  return countryMap[countryCode?.toLowerCase()] || null;
}

module.exports = { fetchGuardianArticles };
