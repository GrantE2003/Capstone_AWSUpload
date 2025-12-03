const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Disable caching for HTML files to prevent stale content
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Serve static files from frontend directory
app.use(express.static('../frontend'));

// Serve Pages/index.html as the root route
app.get('/', (req, res) => {
  res.sendFile('Pages/index.html', { root: '../frontend' });
});

// In-memory cache with TTL
const cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

// Helper to clear cache entries for a specific country
function clearCacheForCountry(countryCode) {
  const keysToDelete = [];
  for (const [key, value] of cache.entries()) {
    if (key.includes(`country=${countryCode}`) || key.includes(`country=${encodeURIComponent(countryCode)}`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => cache.delete(key));
  console.log(`Cleared ${keysToDelete.length} cache entries for country: ${countryCode}`);
}

// Cache helper functions
function getCacheKey(url, params) {
  return `${url}?${new URLSearchParams(params).toString()}`;
}

function getFromCache(key) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  if (cached) {
    cache.delete(key); // Remove expired cache
  }
  return null;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}

// Guardian API configuration
const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;
const GUARDIAN_BASE_URL = 'https://content.guardianapis.com';
const MOCK_MODE = !GUARDIAN_API_KEY;

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Mock data for when no API key is provided
const mockData = {
  topics: [
    'world', 'us-news', 'business', 'technology', 
    'sport', 'culture', 'science', 'health', 'politics'
  ],
  articles: [
    {
      id: 'mock-1',
      title: 'Sample World News Article',
      url: 'https://example.com/world-news',
      sectionId: 'world',
      sectionName: 'World news',
      publishedAt: new Date().toISOString()
    },
    {
      id: 'mock-2', 
      title: 'Sample Technology Article',
      url: 'https://example.com/tech-news',
      sectionId: 'technology',
      sectionName: 'Technology',
      publishedAt: new Date().toISOString()
    }
  ]
};

// Country code to country name mapping
const COUNTRY_NAMES = {
  'US': 'United States',
  'GB': 'United Kingdom',
  'CA': 'Canada',
  'AU': 'Australia',
  'DE': 'Germany',
  'FR': 'France',
  'IT': 'Italy',
  'ES': 'Spain',
  'NL': 'Netherlands',
  'BE': 'Belgium',
  'CH': 'Switzerland',
  'AT': 'Austria',
  'SE': 'Sweden',
  'NO': 'Norway',
  'DK': 'Denmark',
  'FI': 'Finland',
  'IE': 'Ireland',
  'PT': 'Portugal',
  'GR': 'Greece',
  'PL': 'Poland',
  'CZ': 'Czech Republic',
  'HU': 'Hungary',
  'RO': 'Romania',
  'BG': 'Bulgaria',
  'HR': 'Croatia',
  'SI': 'Slovenia',
  'SK': 'Slovakia',
  'JP': 'Japan',
  'CN': 'China',
  'IN': 'India',
  'KR': 'South Korea',
  'SG': 'Singapore',
  'MY': 'Malaysia',
  'TH': 'Thailand',
  'ID': 'Indonesia',
  'PH': 'Philippines',
  'VN': 'Vietnam',
  'NZ': 'New Zealand',
  'ZA': 'South Africa',
  'EG': 'Egypt',
  'KE': 'Kenya',
  'NG': 'Nigeria',
  'BR': 'Brazil',
  'MX': 'Mexico',
  'AR': 'Argentina',
  'CL': 'Chile',
  'CO': 'Colombia',
  'PE': 'Peru',
  'AE': 'United Arab Emirates',
  'SA': 'Saudi Arabia',
  'IL': 'Israel',
  'TR': 'Turkey',
  'RU': 'Russia',
  'UA': 'Ukraine'
};

// Helper function to get country name from code
function getCountryName(countryCode) {
  return COUNTRY_NAMES[countryCode] || null;
}

// Helper function to build query with country filter
function buildQueryWithCountry(originalQuery, countryCode) {
  const countryName = getCountryName(countryCode);
  if (!countryName) {
    console.log('Country code not found in mapping:', countryCode);
    return originalQuery;
  }
  
  // Build country search terms - use country name and common variations
  // The Guardian API searches article content, so we need to be more flexible
  // Use quotes for exact phrases and OR for variations
  const countryVariations = {
    'US': ['United States', 'USA', 'US', 'America', 'American'],
    'GB': ['United Kingdom', 'UK', 'Britain', 'British', 'England', 'English'],
    'CA': ['Canada', 'Canadian'],
    'AU': ['Australia', 'Australian'],
    'DE': ['Germany', 'German'],
    'FR': ['France', 'French'],
    'IT': ['Italy', 'Italian'],
    'ES': ['Spain', 'Spanish'],
    'JP': ['Japan', 'Japanese'],
    'CN': ['China', 'Chinese'],
    'IN': ['India', 'Indian'],
    'BR': ['Brazil', 'Brazilian'],
    'MX': ['Mexico', 'Mexican'],
    'RU': ['Russia', 'Russian'],
    'KR': ['South Korea', 'Korean'],
  };
  
  const variations = countryVariations[countryCode] || [countryName, countryCode];
  const countryTerms = variations.map(term => `"${term}"`).join(' OR ');
  
  // If there's already a query, combine it with country using AND
  if (originalQuery) {
    return `(${originalQuery}) AND (${countryTerms})`;
  }
  // Otherwise, just search for the country
  return countryTerms;
}

/**
 * Determine if an article matches a specific country
 * This analyzes article title, content, section, and tags to determine geographic relevance
 * 
 * @param {Object} article - Article object from Guardian API
 * @param {string} targetCountryCode - ISO country code (e.g., 'US', 'GB')
 * @param {string} section - Section ID (e.g., 'sport', 'technology')
 * @returns {Object} - { matches: boolean, confidence: 'high'|'medium'|'low', reason: string }
 */
function articleMatchesCountry(article, targetCountryCode, section) {
  const targetCountryName = getCountryName(targetCountryCode);
  if (!targetCountryName) {
    return { matches: true, confidence: 'low', reason: 'Unknown country code' };
  }

  const title = (article.webTitle || '').toLowerCase();
  const trailText = (article.fields?.trailText || '').toLowerCase();
  const bodyText = (article.fields?.bodyText || '').toLowerCase();
  const sectionName = (article.sectionName || '').toLowerCase();
  const sectionId = (article.sectionId || '').toLowerCase();
  // Tags can be an array of objects with webTitle or just strings
  const tags = (article.tags || []).map(tag => {
    if (typeof tag === 'string') return tag.toLowerCase();
    return (tag.webTitle || tag.id || '').toLowerCase();
  }).filter(Boolean);

  // Combine all text for analysis
  const allText = `${title} ${trailText} ${bodyText} ${sectionName} ${tags.join(' ')}`.toLowerCase();

  // Country-specific indicators with category-specific refinements
  // Provider: Guardian API - uses webTitle, sectionName, tags, fields.trailText, fields.bodyText
  // No explicit country field, but we infer via sectionName (e.g., 'US news', 'UK news'), tags, and content
  const countryIndicators = {
    'US': {
      // Sports indicators
      sports: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'nfl', 'nba', 'mlb', 'nhl', 'mls', 'ncaa', 'college football', 'super bowl', 'world series', 'stanley cup', 'nba finals', 'march madness', 'nfl playoffs', 'nba playoffs', 'mlb playoffs', 'nhl playoffs', 'dodgers', 'yankees', 'lakers', 'warriors', 'cowboys', 'patriots'],
        negative: ['premier league', 'english', 'england', 'uk', 'british', 'britain', 'efl', 'championship', 'fa cup', 'scotland', 'wales', 'celtic', 'rangers', 'manchester', 'liverpool', 'chelsea', 'arsenal', 'tottenham', 'west ham', 'newcastle', 'brighton']
      },
      // Politics indicators
      politics: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'congress', 'senate', 'house of representatives', 'white house', 'supreme court', 'washington dc', 'capitol hill', 'president', 'senator', 'representative', 'democrat', 'republican', 'biden', 'trump', 'federal', 'us government', 'us politics'],
        negative: ['westminster', 'number 10', 'downing street', 'uk parliament', 'british parliament', 'house of commons', 'house of lords', 'prime minister', 'mp ', 'mps', 'tory', 'labour party', 'scottish parliament', 'welsh assembly']
      },
      // Business indicators
      business: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'nyse', 'nasdaq', 'dow jones', 's&p 500', 'federal reserve', 'fed', 'us economy', 'us market', 'wall street', 'us dollar', 'us companies', 'us business', 'us trade'],
        negative: ['ftse', 'london stock exchange', 'uk economy', 'uk market', 'pound sterling', 'bank of england', 'uk companies', 'uk business']
      },
      // General positive/negative for all categories
      positive: ['united states', 'usa', 'us ', 'american', 'america'],
      negative: ['premier league', 'english', 'england', 'uk', 'british', 'britain', 'westminster', 'number 10', 'uk parliament', 'ftse', 'london stock exchange']
    },
    'GB': {
      sports: {
        positive: ['united kingdom', 'uk', 'britain', 'british', 'england', 'english', 'scotland', 'scottish', 'wales', 'welsh', 'premier league', 'efl', 'championship', 'fa cup', 'celtic', 'rangers', 'manchester', 'liverpool', 'chelsea', 'arsenal', 'tottenham', 'west ham', 'newcastle', 'brighton'],
        negative: ['nfl', 'nba', 'mlb', 'nhl', 'american football', 'super bowl', 'world series', 'stanley cup', 'nba finals']
      },
      politics: {
        positive: ['united kingdom', 'uk', 'britain', 'british', 'england', 'english', 'westminster', 'number 10', 'downing street', 'uk parliament', 'british parliament', 'house of commons', 'house of lords', 'prime minister', 'mp ', 'mps', 'tory', 'labour party', 'scottish parliament', 'welsh assembly'],
        negative: ['congress', 'senate', 'house of representatives', 'white house', 'supreme court', 'washington dc', 'capitol hill', 'president', 'senator', 'representative']
      },
      business: {
        positive: ['united kingdom', 'uk', 'britain', 'british', 'ftse', 'london stock exchange', 'uk economy', 'uk market', 'pound sterling', 'bank of england', 'uk companies', 'uk business'],
        negative: ['nyse', 'nasdaq', 'dow jones', 's&p 500', 'federal reserve', 'fed', 'us economy', 'us market', 'wall street']
      },
      positive: ['united kingdom', 'uk', 'britain', 'british', 'england', 'english'],
      negative: ['nfl', 'nba', 'mlb', 'nhl', 'congress', 'senate', 'white house', 'nyse', 'nasdaq']
    },
    'CA': {
      sports: {
        positive: ['canada', 'canadian', 'cfl', 'maple leafs', 'blue jays', 'raptors', 'canucks', 'flames', 'oilers'],
        negative: ['premier league', 'nfl', 'nba', 'mlb']
      },
      positive: ['canada', 'canadian'],
      negative: ['premier league', 'nfl', 'nba', 'mlb']
    },
    'AU': {
      sports: {
        positive: ['australia', 'australian', 'afl', 'nrl', 'a-league'],
        negative: ['premier league', 'nfl', 'nba']
      },
      positive: ['australia', 'australian'],
      negative: ['premier league', 'nfl', 'nba']
    }
  };

  // Get category-specific indicators if available, otherwise use general
  const indicators = countryIndicators[targetCountryCode];
  if (!indicators) {
    // For countries without specific indicators, use generic matching
    // Get country variations from the buildQueryWithCountry function's scope
    const countryVariationsMap = {
      'US': ['United States', 'USA', 'US', 'America', 'American'],
      'GB': ['United Kingdom', 'UK', 'Britain', 'British', 'England', 'English'],
      'CA': ['Canada', 'Canadian'],
      'AU': ['Australia', 'Australian'],
      'DE': ['Germany', 'German'],
      'FR': ['France', 'French'],
      'IT': ['Italy', 'Italian'],
      'ES': ['Spain', 'Spanish'],
      'JP': ['Japan', 'Japanese'],
      'CN': ['China', 'Chinese'],
      'IN': ['India', 'Indian'],
      'BR': ['Brazil', 'Brazilian'],
      'MX': ['Mexico', 'Mexican'],
      'RU': ['Russia', 'Russian'],
      'KR': ['South Korea', 'Korean'],
    };
    const countryTerms = [
      targetCountryName.toLowerCase(),
      targetCountryCode.toLowerCase(),
      ...(countryVariationsMap[targetCountryCode] || []).map(v => v.toLowerCase())
    ];
    const hasCountryTerm = countryTerms.some(term => allText.includes(term));
    return { matches: hasCountryTerm, confidence: hasCountryTerm ? 'medium' : 'low', reason: hasCountryTerm ? 'Contains country term' : 'No country match' };
  }

  // Get category-specific indicators
  const isSports = section === 'sport' || sectionId === 'sport';
  const isPolitics = section === 'politics' || sectionId === 'politics' || sectionName.includes('politics');
  const isBusiness = section === 'business' || sectionId === 'business' || sectionName.includes('business') || sectionName.includes('economy');
  
  // Use category-specific indicators if available
  let categoryIndicators = null;
  if (isSports && indicators.sports) {
    categoryIndicators = indicators.sports;
  } else if (isPolitics && indicators.politics) {
    categoryIndicators = indicators.politics;
  } else if (isBusiness && indicators.business) {
    categoryIndicators = indicators.business;
  }
  
  // Fall back to general indicators
  const activeIndicators = categoryIndicators || {
    positive: indicators.positive || [],
    negative: indicators.negative || []
  };

  // Count positive and negative indicators
  let positiveCount = 0;
  let negativeCount = 0;

  activeIndicators.positive.forEach(term => {
    if (allText.includes(term)) positiveCount++;
  });

  activeIndicators.negative.forEach(term => {
    if (allText.includes(term)) negativeCount++;
  });
  
  // Also check sectionName for country indicators (Guardian uses sectionName like "US news", "UK news")
  const sectionNameLower = sectionName.toLowerCase();
  if (sectionNameLower.includes('us') || sectionNameLower.includes('usa') || sectionNameLower.includes('united states')) {
    if (targetCountryCode === 'US') positiveCount++;
    else negativeCount++;
  }
  if (sectionNameLower.includes('uk') || sectionNameLower.includes('britain') || sectionNameLower.includes('united kingdom')) {
    if (targetCountryCode === 'GB') positiveCount++;
    else negativeCount++;
  }
  
  if (isSports) {
    // For sports, negative indicators strongly suggest non-match
    if (negativeCount > 0 && positiveCount === 0) {
      return { matches: false, confidence: 'high', reason: `Contains ${negativeCount} negative indicator(s) for sports` };
    }
    // Need at least one positive indicator for sports
    if (positiveCount === 0 && negativeCount === 0) {
      // Check if it's clearly about the target country using generic terms
      const genericCountryTerms = [
        targetCountryName.toLowerCase(),
        targetCountryCode.toLowerCase()
      ];
      const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
      if (hasGenericTerm) {
        return { matches: true, confidence: 'medium', reason: 'Contains country name in content' };
      }
      return { matches: false, confidence: 'medium', reason: 'No country-specific sports indicators' };
    }
    // If we have positive indicators, it's a match
    if (positiveCount > 0) {
      return { matches: true, confidence: positiveCount >= 2 ? 'high' : 'medium', reason: `Contains ${positiveCount} positive indicator(s)` };
    }
  } else {
    // For non-sports categories, apply stricter filtering when country is set
    // Politics and Business should be stricter than general/tech
    const isStrictCategory = isPolitics || isBusiness;
    
    if (isStrictCategory) {
      // For politics and business, negative indicators strongly suggest non-match
      if (negativeCount > 0 && positiveCount === 0) {
        return { matches: false, confidence: 'high', reason: `Contains ${negativeCount} negative indicator(s) for ${section}` };
      }
      // Need at least one positive indicator for strict categories
      if (positiveCount === 0 && negativeCount === 0) {
        // Check generic country terms
        const genericCountryTerms = [
          targetCountryName.toLowerCase(),
          targetCountryCode.toLowerCase()
        ];
        const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
        if (hasGenericTerm) {
          return { matches: true, confidence: 'medium', reason: 'Contains country name in content' };
        }
        return { matches: false, confidence: 'medium', reason: `No country-specific indicators for ${section}` };
      }
    } else {
      // For general/tech categories, more lenient but still filter strong negatives
      if (negativeCount > positiveCount && negativeCount >= 2) {
        return { matches: false, confidence: 'medium', reason: 'More negative than positive indicators' };
      }
    }
    
    // If we have positive indicators, it's likely a match
    if (positiveCount > 0) {
      return { matches: true, confidence: positiveCount >= 2 ? 'high' : 'medium', reason: `Contains ${positiveCount} positive indicator(s)` };
    }
    
    // For non-strict categories, also check generic country terms
    if (!isStrictCategory) {
      const genericCountryTerms = [
        targetCountryName.toLowerCase(),
        targetCountryCode.toLowerCase()
      ];
      const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
      if (hasGenericTerm) {
        return { matches: true, confidence: 'low', reason: 'Contains country name in content' };
      }
    }
  }

  // Default: if no clear indicators, be strict for sports and strict categories
  // For sports and strict categories (politics, business), exclude if no indicators
  if (isSports || isPolitics || isBusiness) {
    return { matches: false, confidence: 'low', reason: `No country indicators found for ${section} article` };
  }
  // For general/tech, allow global content but with low confidence
  return { matches: true, confidence: 'low', reason: 'No clear country indicators - allowing as global content' };
}

/**
 * Central country filter that applies to ALL categories
 * This is the main filtering function used across all news endpoints
 * 
 * @param {Array} articles - Array of article objects from Guardian API
 * @param {string} countryCode - ISO country code to filter by (e.g., 'US', 'GB')
 * @param {string} section - Section/category ID (e.g., 'sport', 'politics', 'business')
 * @param {boolean} includeInternational - Whether to include international/global articles (default: false for strict filtering)
 * @returns {Array} - Filtered array of articles
 */
function filterArticlesByCountry(articles, countryCode, section, includeInternational = false) {
  if (!countryCode) {
    return articles; // No filter if no country selected
  }

  const filtered = [];
  const isSports = section === 'sport';
  const isStrictCategory = isSports || section === 'politics' || section === 'business';

  for (const article of articles) {
    const match = articleMatchesCountry(article, countryCode, section);
    
    if (match.matches) {
      // Include if it matches
      filtered.push(article);
    } else if (includeInternational && match.confidence === 'low') {
      // Include low-confidence rejects if international toggle is on
      filtered.push(article);
    } else if (!isStrictCategory && match.confidence === 'low' && !includeInternational) {
      // For non-strict categories (tech, general), allow low-confidence if international is off
      // This is more lenient but still filters out clear mismatches
      filtered.push(article);
    }
    // Otherwise, exclude the article (strict filtering by default)
  }

  console.log(`[COUNTRY FILTER] Filtered ${articles.length} articles to ${filtered.length} for country ${countryCode} (section: ${section}, strict: ${isStrictCategory})`);
  return filtered;
}

// Helper function to transform Guardian API response
function transformArticle(article) {
  return {
    id: article.id,
    title: article.webTitle,
    url: article.webUrl,
    sectionId: article.sectionId,
    sectionName: article.sectionName,
    publishedAt: article.webPublicationDate
  };
}

// Guardian articles endpoint
app.get('/api/guardian', async (req, res) => {
  try {
    const { section, q, limit = 6, country } = req.query;
    
    // Comprehensive backend logging
    console.log('[NEWS REQUEST - BACKEND]', {
      endpoint: '/api/guardian',
      query: req.query,
      section: section || 'none',
      country: country || 'none',
      queryText: q || 'none'
    });
    
    if (MOCK_MODE) {
      // Return mock data when no API key
      const mockArticles = [
        {
          id: 'mock-1',
          title: 'Sample Technology Article',
          url: 'https://example.com/tech-news',
          sectionId: 'technology',
          sectionName: 'Technology',
          date: new Date().toISOString(),
          trailText: 'This is a sample article about technology trends.',
          bodyText: 'This is the full body text of the sample article. It contains detailed information about the topic.'
        }
      ];
      
      return res.json({ items: mockArticles });
    }

    // Build Guardian API URL
    // Request tags for better country filtering
    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'trailText,bodyText',
      'show-tags': 'all', // Get tags for country filtering
      'page-size': Math.min(limit * 3, 50), // Fetch more to account for filtering
      'order-by': 'newest'
    };

    if (section) params.section = section;
    
    // Build query with country filter if provided
    let query = q || '';
    if (country) {
      // Clear cache for this country to ensure fresh results
      clearCacheForCountry(country);
      query = buildQueryWithCountry(query, country);
      console.log('Built query with country:', query);
    }
    if (query) params.q = query;
    
    // Remove cache-busting timestamp parameter if present
    if (req.query._t) {
      delete params._t;
    }
    
    console.log('Final API params:', JSON.stringify(params, null, 2));

    const cacheKey = getCacheKey(`${GUARDIAN_BASE_URL}/search`, params);
    console.log('Cache key:', cacheKey);
    
    // Reduce cache time when country filter is active to get fresher results
    const cachedResult = getFromCache(cacheKey);
    
    if (cachedResult && !country) {
      // Only use cache if no country filter (to allow testing)
      console.log('Returning cached result');
      return res.json(cachedResult);
    } else if (cachedResult && country) {
      // For country-filtered results, use shorter cache or bypass
      const cacheAge = Date.now() - cachedResult.timestamp;
      if (cacheAge < 10 * 1000) { // 10 seconds for country-filtered
        console.log('Returning cached country-filtered result (age:', cacheAge, 'ms)');
        return res.json(cachedResult);
      } else {
        console.log('Cache expired for country filter, fetching fresh results');
      }
    }

    // Call Guardian API
    console.log('[NEWS API CALL]', {
      category: section || 'general',
      provider: 'Guardian',
      url: `${GUARDIAN_BASE_URL}/search`,
      params: params,
      countryInQuery: country || 'none'
    });
    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });
    
    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    // Transform articles (keep original for filtering)
    let articles = response.data.response.results;

    // Log sample response for inspection
    // Provider: Guardian API - response structure: response.data.response.results[]
    // Each article has: webTitle, sectionName, sectionId, tags[], fields.trailText, fields.bodyText
    // No explicit country field, but we infer via sectionName, tags, and content analysis
    if (articles && articles.length > 0) {
      console.log('[NEWS API RESPONSE SAMPLE]', {
        category: section || 'general',
        totalArticles: articles.length,
        sampleArticles: articles.slice(0, 3).map(a => ({
          title: a.webTitle,
          sectionName: a.sectionName,
          sectionId: a.sectionId,
          tags: (a.tags || []).slice(0, 3).map(t => t.webTitle || t.id || t),
          hasTrailText: !!a.fields?.trailText,
          hasBodyText: !!a.fields?.bodyText
        }))
      });
    }

    // Apply country filtering if country is specified
    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;
    
    if (country) {
      console.log(`[COUNTRY FILTER] Applying filter: country=${country}, section=${section || 'none'}, includeInternational=${includeInternational}`);
      articles = filterArticlesByCountry(articles, country, section || '', includeInternational);
      console.log(`[COUNTRY FILTER] Filtered from ${originalCount} to ${articles.length} articles`);
      
      // If we don't have enough articles after filtering, try to get more
      if (articles.length < limit && originalCount > 0) {
        console.log(`Only ${articles.length} articles after filtering, requested ${limit}. Consider fetching more.`);
      }
      
      // Limit to requested amount after filtering
      articles = articles.slice(0, limit);
    } else {
      // If no country filter, just limit to requested amount
      articles = articles.slice(0, limit);
    }

    const transformedResults = {
      items: articles.map(article => ({
        id: article.id,
        title: article.webTitle,
        url: article.webUrl,
        sectionId: article.sectionId,
        sectionName: article.sectionName,
        date: article.webPublicationDate,
        trailText: article.fields?.trailText || '',
        bodyText: article.fields?.bodyText || ''
      }))
    };

    // Cache the result
    setCache(cacheKey, transformedResults);
    
    console.log(`Returning ${transformedResults.items.length} articles after country filtering`);
    res.json(transformedResults);

  } catch (error) {
    console.error('Guardian API error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch articles' });
  }
});

    // AI Summarization endpoint
    app.post('/api/summarize', async (req, res) => {
      try {
        const { text, title } = req.body;
        
        if (!text || !title) {
          return res.status(400).json({ error: 'Text and title are required' });
        }

        // Debug: Log the content being sent to AI
        console.log('AI Input - Title:', title);
        console.log('AI Input - Text length:', text.length);
        console.log('AI Input - Text preview:', text.substring(0, 200) + '...');

        if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_openai_api_key_here') {
          // Create a basic summary from the article content
          const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
          const keySentences = sentences.slice(0, 3); // Take first 3 meaningful sentences
          const summary = keySentences.join('. ').trim() + '.';
          
          return res.json({ 
            summary: summary || 'Summary not available. Please read the full article for details.'
          });
        }

    // Call OpenAI API
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'You are a news fact extractor. Read the entire article and extract the specific facts, events, and details. Do NOT summarize or paraphrase. Extract the actual information from the article. Include specific names, dates, locations, numbers, quotes, and events mentioned in the article.'
        },
        {
          role: 'user',
          content: `Read this news article and extract the specific facts and details. Include names, dates, locations, numbers, quotes, and events mentioned in the article. Do not summarize - extract the actual information:\n\nTitle: "${title}"\n\nArticle Content:\n${text}`
        }
      ],
      max_tokens: 400,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const summary = response.data.choices[0].message.content;
    res.json({ summary });

  } catch (error) {
    console.error('OpenAI API error:', error.message);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Topics endpoint
app.get('/api/topics', (req, res) => {
  res.json(mockData.topics);
});

// Search endpoint
app.get('/api/search', async (req, res) => {
  try {
    const { q, section, page = 1, country } = req.query;
    
    if (MOCK_MODE) {
      // Return mock data when no API key
      const filteredArticles = mockData.articles.filter(article => {
        if (section && article.sectionId !== section) return false;
        if (q && !article.title.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      });
      
      return res.json({
        results: filteredArticles,
        total: filteredArticles.length,
        page: parseInt(page),
        mockMode: true
      });
    }

    // Build Guardian API URL
    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'headline,trailText,bodyText',
      'show-tags': 'all', // Get tags for country filtering
      'page-size': Math.min(30, 10 * 3), // Fetch more to account for filtering
      'page': page
    };

    // Build query with country filter if provided
    let query = q || '';
    if (country) {
      clearCacheForCountry(country);
      query = buildQueryWithCountry(query, country);
    }
    if (query) params.q = query;
    if (section) params.section = section;

    console.log('[NEWS API CALL]', {
      category: section || 'search',
      provider: 'Guardian',
      url: `${GUARDIAN_BASE_URL}/search`,
      params: params,
      countryInQuery: country || 'none'
    });

    const cacheKey = getCacheKey(`${GUARDIAN_BASE_URL}/search`, params);
    const cachedResult = getFromCache(cacheKey);
    
    if (cachedResult && !country) {
      return res.json(cachedResult);
    } else if (cachedResult && country) {
      const cacheAge = Date.now() - cachedResult.timestamp;
      if (cacheAge < 10 * 1000) {
        return res.json(cachedResult);
      }
    }

    // Call Guardian API
    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });
    
    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    // Log sample response
    let articles = response.data.response.results;
    if (articles && articles.length > 0) {
      console.log('[NEWS API RESPONSE SAMPLE]', {
        category: section || 'search',
        totalArticles: articles.length,
        sampleTitles: articles.slice(0, 3).map(a => a.webTitle)
      });
    }

    // Apply country filtering
    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;
    
    if (country) {
      console.log(`[COUNTRY FILTER] Applying filter: country=${country}, section=${section || 'search'}, includeInternational=${includeInternational}`);
      articles = filterArticlesByCountry(articles, country, section || '', includeInternational);
      console.log(`[COUNTRY FILTER] Filtered from ${originalCount} to ${articles.length} articles`);
      articles = articles.slice(0, 10); // Limit after filtering
    } else {
      articles = articles.slice(0, 10);
    }

    const transformedResults = {
      results: articles.map(transformArticle),
      total: response.data.response.total,
      page: response.data.response.currentPage,
      mockMode: false
    };

    // Cache the result
    setCache(cacheKey, transformedResults);
    
    res.json(transformedResults);

  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
});

// Section endpoint
app.get('/api/section/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, country } = req.query;
    
    // Comprehensive backend logging
    console.log('[NEWS REQUEST - BACKEND]', {
      endpoint: '/api/section/:id',
      sectionId: id,
      query: req.query,
      country: country || 'none'
    });

    if (MOCK_MODE) {
      // Return mock data for the section
      const sectionArticles = mockData.articles.filter(article => article.sectionId === id);
      
      return res.json({
        results: sectionArticles,
        total: sectionArticles.length,
        page: parseInt(page),
        sectionId: id,
        mockMode: true
      });
    }

    const params = {
      'api-key': GUARDIAN_API_KEY,
      'section': id,
      'show-fields': 'headline,trailText,bodyText',
      'show-tags': 'all', // Get tags for country filtering
      'page-size': Math.min(30, 10 * 3), // Fetch more to account for filtering
      'page': page
    };

    // Add country filter to query if provided
    if (country) {
      clearCacheForCountry(country);
      const countryQuery = buildQueryWithCountry('', country);
      if (countryQuery) params.q = countryQuery;
    }

    console.log('[NEWS API CALL]', {
      category: id,
      provider: 'Guardian',
      url: `${GUARDIAN_BASE_URL}/search`,
      params: params,
      countryInQuery: country || 'none'
    });

    const cacheKey = getCacheKey(`${GUARDIAN_BASE_URL}/search`, params);
    const cachedResult = getFromCache(cacheKey);
    
    if (cachedResult && !country) {
      return res.json(cachedResult);
    } else if (cachedResult && country) {
      const cacheAge = Date.now() - cachedResult.timestamp;
      if (cacheAge < 10 * 1000) {
        return res.json(cachedResult);
      }
    }

    // Call Guardian API
    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });
    
    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    // Log sample response
    let articles = response.data.response.results;
    if (articles && articles.length > 0) {
      console.log('[NEWS API RESPONSE SAMPLE]', {
        category: id,
        totalArticles: articles.length,
        sampleTitles: articles.slice(0, 3).map(a => a.webTitle)
      });
    }

    // Apply country filtering
    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;
    
    if (country) {
      console.log(`[COUNTRY FILTER] Applying filter: country=${country}, section=${id}, includeInternational=${includeInternational}`);
      articles = filterArticlesByCountry(articles, country, id, includeInternational);
      console.log(`[COUNTRY FILTER] Filtered from ${originalCount} to ${articles.length} articles`);
      articles = articles.slice(0, 10); // Limit after filtering
    } else {
      articles = articles.slice(0, 10);
    }

    const transformedResults = {
      results: articles.map(transformArticle),
      total: response.data.response.total,
      page: response.data.response.currentPage,
      sectionId: id,
      mockMode: false
    };

    // Cache the result
    setCache(cacheKey, transformedResults);
    
    res.json(transformedResults);

  } catch (error) {
    console.error('Section error:', error.message);
    res.status(500).json({ 
      error: error.message || 'Internal server error' 
    });
  }
});

// Debug endpoint for testing country filtering
app.get('/debug/news', async (req, res) => {
  try {
    const { country, category, limit = 10 } = req.query;
    
    if (!country || !category) {
      return res.status(400).json({ 
        error: 'Missing required parameters: country and category' 
      });
    }

    // Use the same logic as /api/guardian
    const params = {
      'api-key': GUARDIAN_API_KEY,
      'section': category,
      'show-fields': 'trailText,bodyText',
      'show-tags': 'all',
      'page-size': Math.min(limit * 3, 50),
      'order-by': 'newest'
    };

    if (country) {
      const query = buildQueryWithCountry('', country);
      if (query) params.q = query;
    }

    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });
    
    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    let articles = response.data.response.results;
    const originalCount = articles.length;

    // Apply filtering
    articles = filterArticlesByCountry(articles, country, category, false);
    articles = articles.slice(0, limit);

    // Return debug info
    res.json({
      countryCode: country,
      category: category,
      originalCount: originalCount,
      filteredCount: articles.length,
      articles: articles.map(article => ({
        title: article.webTitle,
        sectionName: article.sectionName,
        sectionId: article.sectionId,
        tags: (article.tags || []).slice(0, 5).map(t => t.webTitle || t.id || t),
        inferredCountry: articleMatchesCountry(article, country, category),
        url: article.webUrl
      }))
    });

  } catch (error) {
    console.error('Debug endpoint error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch debug data' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Guardian API Proxy Server running on port ${PORT}`);
  console.log(`API Key configured: ${GUARDIAN_API_KEY ? 'Yes' : 'No (Mock Mode)'}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(`Available topics: http://localhost:${PORT}/api/topics`);
  console.log(`Search: http://localhost:${PORT}/api/search?q=technology`);
  console.log(`Section: http://localhost:${PORT}/api/section/technology`);
});
