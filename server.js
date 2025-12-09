const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// CORS Configuration - Allow specific origins for security
const allowedOrigins = [
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:3000',
  'https://www.4970capstone-mss.com', // Production domain
  'https://4970capstone-mss.com', // Production domain without www
  process.env.FRONTEND_URL, // AWS production domain from env
  process.env.CORS_ORIGIN   // Additional allowed origin
].filter(Boolean); // Remove undefined values

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In development, be more permissive; in production, be strict
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[CORS] Allowing origin in dev mode: ${origin}`);
        callback(null, true);
      } else {
        // Production: log blocked origin for debugging
        console.warn(`[CORS] Blocked origin: ${origin}`);
        console.warn(`[CORS] Allowed origins: ${allowedOrigins.join(', ')}`);
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Request logging middleware for API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.log(`[API Request] ${req.method} ${req.originalUrl}`);
    console.log(`[API Request] Query:`, req.query);
  }
  next();
});

// Disable caching for HTML files to prevent stale content
app.use((req, res, next) => {
  if (req.path.endsWith('.html')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// CRITICAL: API routes must be defined BEFORE static file serving
// This ensures /api/* requests are handled by API routes, not static files

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

// OpenRouter configuration
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_API_URL = process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

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
  
  if (originalQuery) {
    return `(${originalQuery}) AND (${countryTerms})`;
  }
  return countryTerms;
}

/**
 * Determine if an article matches a specific country
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
  const tags = (article.tags || []).map(tag => {
    if (typeof tag === 'string') return tag.toLowerCase();
    return (tag.webTitle || tag.id || '').toLowerCase();
  }).filter(Boolean);

  const allText = `${title} ${trailText} ${bodyText} ${sectionName} ${tags.join(' ')}`.toLowerCase();

  const countryIndicators = {
    'US': {
      sports: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'nfl', 'nba', 'mlb', 'nhl', 'mls', 'ncaa', 'college football', 'super bowl', 'world series', 'stanley cup', 'nba finals', 'march madness', 'nfl playoffs', 'nba playoffs', 'mlb playoffs', 'nhl playoffs', 'dodgers', 'yankees', 'lakers', 'warriors', 'cowboys', 'patriots'],
        negative: ['premier league', 'english', 'england', 'uk', 'british', 'britain', 'efl', 'championship', 'fa cup', 'scotland', 'wales', 'celtic', 'rangers', 'manchester', 'liverpool', 'chelsea', 'arsenal', 'tottenham', 'west ham', 'newcastle', 'brighton']
      },
      politics: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'congress', 'senate', 'house of representatives', 'white house', 'supreme court', 'washington dc', 'capitol hill', 'president', 'senator', 'representative', 'democrat', 'republican', 'biden', 'trump', 'federal', 'us government', 'us politics'],
        negative: ['westminster', 'number 10', 'downing street', 'uk parliament', 'british parliament', 'house of commons', 'house of lords', 'prime minister', 'mp ', 'mps', 'tory', 'labour party', 'scottish parliament', 'welsh assembly']
      },
      business: {
        positive: ['united states', 'usa', 'us ', 'american', 'america', 'nyse', 'nasdaq', 'dow jones', 's&p 500', 'federal reserve', 'fed', 'us economy', 'us market', 'wall street', 'us dollar', 'us companies', 'us business', 'us trade'],
        negative: ['ftse', 'london stock exchange', 'uk economy', 'uk market', 'pound sterling', 'bank of england', 'uk companies', 'uk business']
      },
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

  const indicators = countryIndicators[targetCountryCode];
  if (!indicators) {
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

  const isSports = section === 'sport' || sectionId === 'sport';
  const isPolitics = section === 'politics' || sectionId === 'politics' || sectionName.includes('politics');
  const isBusiness = section === 'business' || sectionId === 'business' || sectionName.includes('business') || sectionName.includes('economy');
  
  let categoryIndicators = null;
  if (isSports && indicators.sports) {
    categoryIndicators = indicators.sports;
  } else if (isPolitics && indicators.politics) {
    categoryIndicators = indicators.politics;
  } else if (isBusiness && indicators.business) {
    categoryIndicators = indicators.business;
  }
  
  const activeIndicators = categoryIndicators || {
    positive: indicators.positive || [],
    negative: indicators.negative || []
  };

  let positiveCount = 0;
  let negativeCount = 0;

  activeIndicators.positive.forEach(term => {
    if (allText.includes(term)) positiveCount++;
  });

  activeIndicators.negative.forEach(term => {
    if (allText.includes(term)) negativeCount++;
  });
  
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
    if (negativeCount > 0 && positiveCount === 0) {
      return { matches: false, confidence: 'high', reason: `Contains ${negativeCount} negative indicator(s) for sports` };
    }
    if (positiveCount === 0 && negativeCount === 0) {
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
    if (positiveCount > 0) {
      return { matches: true, confidence: positiveCount >= 2 ? 'high' : 'medium', reason: `Contains ${positiveCount} positive indicator(s)` };
    }
  } else {
    const isStrictCategory = isPolitics || isBusiness;
    
    if (isStrictCategory) {
      if (negativeCount > 0 && positiveCount === 0) {
        return { matches: false, confidence: 'high', reason: `Contains ${negativeCount} negative indicator(s) for ${section}` };
      }
      if (positiveCount === 0 && negativeCount === 0) {
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
      if (negativeCount > positiveCount && negativeCount >= 2) {
        return { matches: false, confidence: 'medium', reason: 'More negative than positive indicators' };
      }
    }
    
    if (positiveCount > 0) {
      return { matches: true, confidence: positiveCount >= 2 ? 'high' : 'medium', reason: `Contains ${positiveCount} positive indicator(s)` };
    }
    
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

  if (isSports || isPolitics || isBusiness) {
    return { matches: false, confidence: 'low', reason: `No country indicators found for ${section} article` };
  }
  return { matches: true, confidence: 'low', reason: 'No clear country indicators - allowing as global content' };
}

/**
 * Central country filter that applies to ALL categories
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
      filtered.push(article);
    } else if (includeInternational && match.confidence === 'low') {
      filtered.push(article);
    } else if (!isStrictCategory && match.confidence === 'low' && !includeInternational) {
      filtered.push(article);
    }
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
    
    console.log('[NEWS REQUEST - BACKEND]', {
      endpoint: '/api/guardian',
      query: req.query,
      section: section || 'none',
      country: country || 'none',
      queryText: q || 'none'
    });
    
    if (MOCK_MODE) {
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

    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'trailText,bodyText',
      'show-tags': 'all',
      'page-size': Math.min(limit * 3, 50),
      'order-by': 'newest'
    };

    if (section) params.section = section;
    
    let query = q || '';
    if (country) {
      clearCacheForCountry(country);
      query = buildQueryWithCountry(query, country);
      console.log('Built query with country:', query);
    }
    if (query) params.q = query;
    
    if (req.query._t) {
      delete params._t;
    }
    
    console.log('Final API params:', JSON.stringify(params, null, 2));

    const cacheKey = getCacheKey(`${GUARDIAN_BASE_URL}/search`, params);
    console.log('Cache key:', cacheKey);
    
    const cachedResult = getFromCache(cacheKey);
    
    if (cachedResult && !country) {
      console.log('Returning cached result');
      return res.json(cachedResult);
    } else if (cachedResult && country) {
      const cacheAge = Date.now() - cachedResult.timestamp;
      if (cacheAge < 10 * 1000) {
        console.log('Returning cached country-filtered result (age:', cacheAge, 'ms)');
        return res.json(cachedResult);
      } else {
        console.log('Cache expired for country filter, fetching fresh results');
      }
    }

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

    let articles = response.data.response.results;

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

    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;
    
    if (country) {
      console.log(`[COUNTRY FILTER] Applying filter: country=${country}, section=${section || 'none'}, includeInternational=${includeInternational}`);
      articles = filterArticlesByCountry(articles, country, section || '', includeInternational);
      console.log(`[COUNTRY FILTER] Filtered from ${originalCount} to ${articles.length} articles`);
      articles = articles.slice(0, limit);
    } else {
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

    setCache(cacheKey, transformedResults);
    
    console.log(`Returning ${transformedResults.items.length} articles after country filtering`);
    res.json(transformedResults);

  } catch (error) {
    console.error('Guardian API error:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch articles' });
  }
});

    // AI Summarization endpoint (single-article)
    app.post('/api/summarize', async (req, res) => {
      try {
        const { text, title } = req.body;
        
        console.log('[Summarize] ========================================');
        console.log('[Summarize] Received summarize request');
        console.log('[Summarize] Title:', title);
        console.log('[Summarize] Text length:', text ? text.length : 0);
        console.log('[Summarize] Text preview:', text ? text.substring(0, 200) + '...' : 'NO TEXT');
        
        if (!text || !title) {
          console.error('[Summarize] Missing required fields - text:', !!text, 'title:', !!title);
          return res.status(400).json({ 
            error: 'Text and title are required',
            aiSummary: 'Error: Missing required article information.'
          });
        }

        if (!OPENROUTER_API_KEY) {
          console.warn('[Summarize] No OpenRouter API key - using fallback summary');
          const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
          const keySentences = sentences.slice(0, 3);
          const fallbackSummary = keySentences.join('. ').trim() + '.';
          
          return res.json({ 
            aiSummary: fallbackSummary || 'Summary not available. Please read the full article for details.'
          });
        }

        console.log('[Summarize] Calling OpenRouter API:', LLM_API_URL);
        console.log('[Summarize] Using model:', LLM_MODEL);

        let modelToUse = LLM_MODEL;
        if (!modelToUse.includes('/')) {
          modelToUse = `openai/${modelToUse}`;
          console.log('[Summarize] Added provider prefix to model:', modelToUse);
        }

        const headers = {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:4000',
          'X-Title': 'News Summarizer'
        };

        const response = await axios.post(LLM_API_URL, {
          model: modelToUse,
          messages: [
            {
              role: 'system',
              content: 'You are an expert news analyst and summarizer. Create highly detailed, comprehensive summaries that provide maximum value to readers. Your summaries should be information-dense, covering all critical aspects: key players and their roles, specific facts and figures, timeline of events, background context, implications, quotes from important sources, locations, dates, and why this story matters. Write in clear, engaging prose that makes readers feel fully informed without needing to read the full article.'
            },
            {
              role: 'user',
              content: `You are summarizing news articles. Create an EXTREMELY detailed, comprehensive, information-dense summary that provides maximum information value. Your summary should be 18-25 sentences (about 500-700 words, MINIMUM 400 characters) and include EVERYTHING relevant. Think broadly about the story - include not just the main event but all surrounding context, implications, and related information:

- WHO: All key people, organizations, and entities involved with their specific roles, titles, and relationships. Include full names, positions, affiliations, and their connections to each other. Mention all stakeholders, participants, and affected parties.
- WHAT: The main event, action, or development with extensive specific details. Describe what happened step-by-step, including all relevant actions, outcomes, and sub-events. Cover all aspects of the story, not just the headline.
- WHEN: Exact dates, times, and complete timeline of events. Include chronological sequence, duration, temporal context, and any relevant historical dates that provide context.
- WHERE: Specific locations, regions, or places mentioned with full geographic context. Include addresses, cities, countries, regions, and any relevant location details. Mention all locations involved.
- WHY: The reasons, causes, motivations, and deep context behind the story. Explain underlying factors, historical context, driving forces, and the broader reasons this story matters. Include political, economic, social, or cultural context.
- HOW: The detailed process, methods, or mechanisms involved. Describe procedures, techniques, approaches, implementation details, and how events unfolded.
- IMPACT: Comprehensive consequences, implications, or significance. Include immediate effects, long-term implications, affected parties, broader significance, and potential future developments. Discuss impact on different groups, sectors, or regions.
- QUOTES: Important quotes from key sources if available, with attribution context. Include multiple perspectives and viewpoints.
- NUMBERS: All specific statistics, figures, amounts, data points, percentages, measurements, and quantitative details mentioned. Include all numerical information.
- BACKGROUND: Extensive relevant context that helps understand the story. Include historical context, previous related events, necessary background information, and the broader situation that led to this story.
- DETAILS: All specific facts, names, dates, locations, numbers, and concrete information from the articles. Be comprehensive and include everything mentioned.
- ANALYSIS: Key insights, patterns, or important observations that emerge from the content. Provide thoughtful analysis of what this story means and why it matters.
- BROADER CONTEXT: Related stories, similar events, industry trends, or broader implications that help readers understand the full picture. Connect this story to larger themes or trends.

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE EXACTLY:
1. Your summary must contain ONLY the synthesized description of the news story - be extremely thorough and information-dense
2. ABSOLUTELY DO NOT include article titles anywhere in your summary - not at the beginning, not at the end, not anywhere
3. DO NOT repeat or paraphrase the article title - the title is already shown separately, your job is to provide NEW information
4. Do NOT mention source names (Guardian, GDELT, Currents, Reuters, AP, BBC, etc.)
5. Do NOT include references like "[GUARDIAN]", "[SOURCE]", or "[Article 1]"
6. Do NOT include phrases like "According to [source]" or "From [source]"
7. Do NOT include any metadata, formatting markers, or attribution
8. Write in engaging, clear, information-dense prose that stands alone without any source attribution or title references
9. Prioritize concrete facts, specific details, numbers, names, dates, and locations over general statements
10. Be thorough, detailed, and information-rich - readers should feel fully informed
11. If multiple articles have similar titles, synthesize their content into ONE comprehensive summary - do not just repeat the title
12. The summary MUST be at least 400 characters long - be thorough, broad, and detailed enough to meet this requirement
13. Think BROADLY about the story - include all related information, context, implications, and background. Don't just focus on the main event, but provide a comprehensive overview that helps readers fully understand the story and its significance
14. Include multiple perspectives, viewpoints, and angles from the different sources
15. Connect the story to broader themes, trends, or related events when relevant

Start your summary directly with the story content. Do not preface it with the title or source. NEVER repeat the title. MINIMUM LENGTH: 400 characters. Think comprehensively and include all relevant information that helps readers understand the full story.

Article Content:\n${text}`
            }
          ],
          max_tokens: 2000,
          temperature: 0.3
        }, {
          headers: headers,
          timeout: 30000
        });

        console.log('[Summarize] API response status:', response.status);
        console.log('[Summarize] Response structure:', {
          hasData: !!response.data,
          hasChoices: !!response.data?.choices,
          choicesLength: response.data?.choices?.length || 0
        });

        let aiSummary = null;
        if (response.data && response.data.choices && response.data.choices.length > 0) {
          const firstChoice = response.data.choices[0];
          if (firstChoice.message && firstChoice.message.content) {
            aiSummary = firstChoice.message.content.trim();
            console.log('[Summarize] Successfully extracted summary, length:', aiSummary.length);
          } else {
            console.error('[Summarize] Response missing message.content:', JSON.stringify(firstChoice, null, 2));
          }
        } else {
          console.error('[Summarize] Unexpected response structure:', JSON.stringify(response.data, null, 2));
        }

        if (!aiSummary || aiSummary.length === 0) {
          console.error('[Summarize] Failed to extract valid summary from API response');
          return res.status(500).json({ 
            error: 'Failed to extract summary from API response',
            aiSummary: 'Error: The AI service returned an invalid response. Please try again later.'
          });
        }

        aiSummary = aiSummary
          .replace(/\[(?:GUARDIAN|GDELT|CURRENTS|SOURCE|ARTICLE)\s*[-\s]*\d*\s*\]/gi, '')
          .replace(/(?:according to|from|via|source:)\s*\[?[^\]]*\]?/gi, '')
          .replace(/\[[^\]]*(?:guardian|gdelt|currents|source|article)[^\]]*\]/gi, '')
          .replace(/title:\s*["'][^"']*["']/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

        console.log('[Summarize] Returning cleaned summary to frontend, length:', aiSummary.length);
        return res.json({ aiSummary });

      } catch (error) {
        console.error('[Summarize] ========================================');
        console.error('[Summarize] ERROR in summarize endpoint');
        console.error('[Summarize] Error type:', error.constructor.name);
        console.error('[Summarize] Error message:', error.message);
        console.error('[Summarize] Error code:', error.code);
        if (error.response) {
          console.error('[Summarize] API response status:', error.response.status);
          console.error('[Summarize] API response headers:', error.response.headers);
          console.error('[Summarize] API response data:', JSON.stringify(error.response.data, null, 2));
          
          if (error.response.data) {
            if (error.response.status === 401) {
              console.error('[Summarize] OpenRouter: Authentication failed - check API key');
            } else if (error.response.status === 402) {
              console.error('[Summarize] OpenRouter: Insufficient credits');
            } else if (error.response.status === 429) {
              console.error('[Summarize] OpenRouter: Rate limit exceeded');
            }
          }
        }
        if (error.request) {
          console.error('[Summarize] Request was made but no response received');
          console.error('[Summarize] Request URL:', error.config?.url);
          console.error('[Summarize] Request method:', error.config?.method);
          console.error('[Summarize] Request headers:', error.config?.headers ? Object.keys(error.config.headers) : []);
        }
        console.error('[Summarize] ========================================');
        
        let errorMessage = 'Unable to generate summary. Please try again later.';
        if (error.response?.data) {
          if (error.response.data.error) {
            if (typeof error.response.data.error === 'string') {
              errorMessage = error.response.data.error;
            } else if (error.response.data.error.message) {
              errorMessage = error.response.data.error.message;
            } else {
              errorMessage = JSON.stringify(error.response.data.error);
            }
          } else if (error.response.data.message) {
            errorMessage = error.response.data.message;
          } else if (typeof error.response.data === 'string') {
            errorMessage = error.response.data;
          } else {
            errorMessage = JSON.stringify(error.response.data);
          }
          
          if (error.response.status === 401) {
            errorMessage = `Authentication failed: ${errorMessage}. Please check your API key.`;
          } else if (error.response.status === 402) {
            errorMessage = `Insufficient credits: ${errorMessage}. Please add credits to your OpenRouter account.`;
          } else if (error.response.status === 429) {
            errorMessage = `Rate limit exceeded: ${errorMessage}. Please try again later.`;
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        return res.status(500).json({ 
          error: 'Failed to generate summary',
          aiSummary: errorMessage
        });
      }
    });

    // Multi-article search summarization endpoint (for search_results_loader.js)
    app.post('/api/summarize/search', async (req, res) => {
      try {
        const { query, articles } = req.body || {};

        console.log('[Search Summarize] ========================================');
        console.log('[Search Summarize] Received summarize request');
        console.log('[Search Summarize] Query:', query);
        console.log('[Search Summarize] Articles count:', Array.isArray(articles) ? articles.length : 0);

        if (!Array.isArray(articles) || articles.length === 0) {
          return res.status(400).json({
            error: 'At least one article is required for summarization',
          });
        }

        const selected = articles.slice(0, 10);

        const chunks = selected.map((a, idx) => {
          const title = a.title || 'Untitled';
          const source = a.source || a.sourceName || 'Unknown source';
          const publishedAt = a.publishedAt || a.date || '';
          const body =
            a.content ||
            a.description ||
            a.summary ||
            a.trailText ||
            a.snippet ||
            '';

          return [
            `Article ${idx + 1}:`,
            `Title: ${title}`,
            `Source: ${source}`,
            publishedAt ? `Published: ${publishedAt}` : '',
            `Content: ${body}`,
          ]
            .filter(Boolean)
            .join('\n');
        });

        const combinedText = chunks.join('\n\n-----\n\n');

        console.log('[Search Summarize] Combined text length:', combinedText.length);

        if (!combinedText || combinedText.trim().length === 0) {
          return res.status(400).json({
            error: 'No article text available to summarize',
          });
        }

        if (!OPENROUTER_API_KEY) {
          console.warn('[Search Summarize] No OpenRouter API key - using fallback summary');

          const fallback = selected
            .map((a) => `• ${a.title || 'Untitled'} (${a.source || a.sourceName || 'Unknown'})`)
            .join(' ');

          return res.json({
            aiSummary:
              `This is a rough summary of ${selected.length} articles about "${query || 'this topic'}". ` +
              `The sources cover related themes and perspectives. Headlines include: ${fallback}`,
          });
        }

        let modelToUse = LLM_MODEL;
        if (!modelToUse.includes('/')) {
          modelToUse = `openai/${modelToUse}`;
          console.log('[Search Summarize] Using model:', modelToUse);
        }

        const headers = {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:4000',
          'X-Title': 'Multi-source Search Summarizer',
        };

        const userPrompt = `
You are summarizing multiple news articles on the SAME topic.

User search query (topic): "${query || 'N/A'}"

Below is combined content from up to 10 different sources. Write ONE clear, neutral, multi-source summary.

Requirements:
- DO NOT mention article titles or source names.
- DO NOT say "according to", "from [source]", or similar.
- 8–14 sentences.
- Cover the main points, areas of agreement, and any notable differences.
- Include concrete facts, dates, locations, numbers, and key people when present.
- Assume the reader will NOT see the original articles.

Articles content:
${combinedText}
        `.trim();

        console.log('[Search Summarize] Calling OpenRouter API:', LLM_API_URL);

        const response = await axios.post(
          LLM_API_URL,
          {
            model: modelToUse,
            messages: [
              {
                role: 'system',
                content:
                  'You are a neutral news summarizer that combines multiple sources into a single, balanced overview. Never mention titles or sources by name.',
              },
              {
                role: 'user',
                content: userPrompt,
              },
            ],
            max_tokens: 900,
            temperature: 0.3,
          },
          {
            headers,
            timeout: 30000,
          }
        );

        let aiSummary = null;
        if (response.data?.choices?.length) {
          aiSummary = response.data.choices[0]?.message?.content?.trim() || '';
        }

        if (!aiSummary) {
          return res.status(500).json({
            error: 'Failed to extract summary from AI response',
          });
        }

        aiSummary = aiSummary.replace(/<[^>]+>/g, '').trim();
        console.log('[Search Summarize] Summary length:', aiSummary.length);

        return res.json({ aiSummary });
      } catch (error) {
        console.error('[Search Summarize] ERROR:', error.message);
        if (error.response) {
          console.error('[Search Summarize] API status:', error.response.status);
          console.error('[Search Summarize] API data:', error.response.data);
        }

        let message = 'Unable to generate multi-article summary. Please try again later.';
        if (error.response?.data?.error) {
          message =
            typeof error.response.data.error === 'string'
              ? error.response.data.error
              : error.response.data.error.message || message;
        }

        return res.status(500).json({
          error: message,
        });
      }
    });

// News aggregation endpoint (multi-source)
console.log('[Server] Loading newsAggregate router...');
const newsAggregateRouter = require('./routes/newsAggregate');
console.log('[Server] Mounting newsAggregate router at /api/news');
app.use('/api/news', newsAggregateRouter);
console.log('[Server] ✓ Successfully mounted /api/news router');
console.log('[Server] ✓ Route available at: GET /api/news/aggregate');

console.log('[Server] ========================================');
console.log('[Server] Registered API routes:');
console.log('[Server]   GET  /api/news/aggregate - News aggregation endpoint (CRITICAL)');
console.log('[Server]   GET  /api/health - Health check');
console.log('[Server]   GET  /api/topics - Topics list');
console.log('[Server]   GET  /api/search - Search endpoint');
console.log('[Server]   GET  /api/guardian - Guardian API proxy');
console.log('[Server]   GET  /api/section/:id - Section endpoint');
console.log('[Server]   POST /api/summarize - Single-article summarization');
console.log('[Server]   POST /api/summarize/search - Multi-article search summarization');
console.log('[Server] ========================================');

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Topics endpoint
app.get('/api/topics', (req, res) => {
  res.json(mockData.topics);
});

// Search endpoint - simple Guardian-only search
app.get('/api/search', async (req, res) => {
  try {
    const query = (req.query.q || '').trim();

    console.log('[Search] Request received:', { query });

    if (!query) {
      return res.status(400).json({ error: 'Missing search query (?q=...)' });
    }

    // If we don't have a Guardian key, just use mock data
    if (MOCK_MODE) {
      console.warn('[Search] MOCK_MODE is ON – using mock articles only');
      const filteredArticles = mockData.articles.filter(article => {
        return article.title.toLowerCase().includes(query.toLowerCase());
      });

      return res.json({
        articles: filteredArticles.map(a => ({
          title: a.title,
          description: a.description || 'No description available.',
          url: a.url,
          publishedAt: a.publishedAt || '',
          sourceName: 'Mock'
        }))
      });
    }

    // Guardian search parameters
    const params = {
      'api-key': GUARDIAN_API_KEY,
      'q': query,
      'page-size': 30,                  // grab up to 30 results
      'order-by': 'newest',
      'show-fields': 'trailText,bodyText'
    };

    console.log('[Search] Calling Guardian /search with params:', params);

    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });

    if (!response.data || response.data.response.status !== 'ok') {
      console.error('[Search] Guardian error:', response.data);
      throw new Error('Guardian API returned an error');
    }

    const results = response.data.response.results || [];
    console.log('[Search] Guardian returned', results.length, 'results');

    // Normalize into { title, description, url, publishedAt, sourceName }
    const articles = results.map(item => {
      const fields = item.fields || {};
      const body = fields.bodyText || '';
      const trail = fields.trailText || '';

      // Take a short snippet as description
      const descriptionSource = body || trail;
      const description = descriptionSource
        ? descriptionSource.slice(0, 400) + (descriptionSource.length > 400 ? '…' : '')
        : 'No description available.';

      return {
        title: item.webTitle || 'No title',
        description,
        url: item.webUrl || '',
        publishedAt: item.webPublicationDate || '',
        sourceName: 'The Guardian'
      };
    }).filter(a => a.url && a.title && a.title !== 'No title');

    console.log('[Search] Returning', articles.length, 'normalized articles');

    return res.json({ articles });

  } catch (error) {
    console.error('[Search] ERROR:', error.message);
    if (error.response) {
      console.error('[Search] Guardian status:', error.response.status);
      console.error('[Search] Guardian data:', JSON.stringify(error.response.data, null, 2));
    }
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
    
    console.log('[NEWS REQUEST - BACKEND]', {
      endpoint: '/api/section/:id',
      sectionId: id,
      query: req.query,
      country: country || 'none'
    });

    if (MOCK_MODE) {
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
      'show-tags': 'all',
      'page-size': Math.min(30, 10 * 3),
      'page': page
    };

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

    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });
    
    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    let articles = response.data.response.results;
    if (articles && articles.length > 0) {
      console.log('[NEWS API RESPONSE SAMPLE]', {
        category: id,
        totalArticles: articles.length,
        sampleTitles: articles.slice(0, 3).map(a => a.webTitle)
      });
    }

    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;
    
    if (country) {
      console.log(`[COUNTRY FILTER] Applying filter: country=${country}, section=${id}, includeInternational=${includeInternational}`);
      articles = filterArticlesByCountry(articles, country, id, includeInternational);
      console.log(`[COUNTRY FILTER] Filtered from ${originalCount} to ${articles.length} articles`);
      articles = articles.slice(0, 10);
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

    articles = filterArticlesByCountry(articles, country, category, false);
    articles = articles.slice(0, limit);

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

// Middleware to inject API base URL into HTML files
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    const originalSend = res.send;
    res.send = function(data) {
      if (typeof data === 'string' && data.includes('</head>')) {
        let apiBaseUrl;
        if (process.env.API_BASE_URL) {
          apiBaseUrl = process.env.API_BASE_URL;
          console.log('[Server] Using API_BASE_URL from environment:', apiBaseUrl);
        } else if (process.env.NODE_ENV === 'production') {
          apiBaseUrl = process.env.FRONTEND_URL || 
                      (req.protocol + '://' + req.get('host'));
          console.log('[Server] Production mode - API base URL:', apiBaseUrl);
          console.log('[Server] Request origin:', req.protocol + '://' + req.get('host'));
          console.log('[Server] FRONTEND_URL env:', process.env.FRONTEND_URL);
        } else {
          apiBaseUrl = 'http://localhost:4000';
          console.log('[Server] Development mode - API base URL:', apiBaseUrl);
        }
        const script = `<script>window.API_BASE_URL = "${apiBaseUrl}";</script>`;
        data = data.replace('</head>', script + '</head>');
        console.log('[Server] Injected API_BASE_URL into HTML:', apiBaseUrl);
      }
      return originalSend.call(this, data);
    };
  }
  next();
});

// Serve static files from frontend directory
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  next();
}, express.static('frontend', {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
    }
  }
}));

// Serve index.html as the root route
app.get('/', (req, res) => {
  res.sendFile('index.html', { root: 'frontend' });
});

// 404 handler for API routes - provide detailed error
app.use('/api/*', (req, res) => {
  console.error('[404] API route not found:', req.method, req.originalUrl);
  console.error('[404] Available API routes: /api/health, /api/topics, /api/search, /api/guardian, /api/news/aggregate, /api/section/:id, /api/summarize, /api/summarize/search');
  res.status(404).json({ 
    error: 'API endpoint not found',
    method: req.method,
    path: req.originalUrl,
    availableRoutes: [
      'GET /api/health',
      'GET /api/topics',
      'GET /api/search',
      'GET /api/guardian',
      'GET /api/news/aggregate',
      'GET /api/section/:id',
      'POST /api/summarize',
      'POST /api/summarize/search'
    ]
  });
});

// 404 handler for all other routes
app.use('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'Endpoint not found', path: req.path });
  } else {
    res.status(404).send('Page not found');
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`Guardian API Proxy Server running on port ${PORT}`);
  console.log(`API Key configured: ${GUARDIAN_API_KEY ? 'Yes' : 'No (Mock Mode)'}`);
  console.log(`========================================`);
  console.log(`CRITICAL PRODUCTION ROUTE:`);
  console.log(`  GET /api/news/aggregate`);
  console.log(`  Production URL: https://www.4970capstone-mss.com/api/news/aggregate`);
  console.log(`  Test URL: http://localhost:${PORT}/api/news/aggregate?category=business&country=US`);
  console.log(`========================================`);
  console.log(`Other available routes:`);
  console.log(`  GET  /api/health`);
  console.log(`  GET  /api/topics`);
  console.log(`  GET  /api/search?q=technology`);
  console.log(`  GET  /api/section/technology`);
  console.log(`  GET  /api/guardian`);
  console.log(`  POST /api/summarize`);
  console.log(`  POST /api/summarize/search`);
  console.log(`  GET  /api/news/test`);
  console.log(`========================================`);
});
