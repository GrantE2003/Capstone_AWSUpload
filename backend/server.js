const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// ============================
// Basic middleware
// ============================
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

// ============================
// Guardian / LLM config
// ============================
const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;
const GUARDIAN_BASE_URL = 'https://content.guardianapis.com';
const MOCK_MODE = !GUARDIAN_API_KEY; // true if no key

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const LLM_API_URL =
  process.env.LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';

// Mock data (used only when no Guardian key)
const mockData = {
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

// ============================
// Country helpers
// ============================
const COUNTRY_NAMES = {
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  NO: 'Norway',
  DK: 'Denmark',
  FI: 'Finland',
  IE: 'Ireland',
  PT: 'Portugal',
  GR: 'Greece',
  PL: 'Poland',
  CZ: 'Czech Republic',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  HR: 'Croatia',
  SI: 'Slovenia',
  SK: 'Slovakia',
  JP: 'Japan',
  CN: 'China',
  IN: 'India',
  KR: 'South Korea',
  SG: 'Singapore',
  MY: 'Malaysia',
  TH: 'Thailand',
  ID: 'Indonesia',
  PH: 'Philippines',
  VN: 'Vietnam',
  NZ: 'New Zealand',
  ZA: 'South Africa',
  EG: 'Egypt',
  KE: 'Kenya',
  NG: 'Nigeria',
  BR: 'Brazil',
  MX: 'Mexico',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  PE: 'Peru',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  IL: 'Israel',
  TR: 'Turkey',
  RU: 'Russia',
  UA: 'Ukraine'
};

function getCountryName(countryCode) {
  return COUNTRY_NAMES[countryCode] || null;
}

function buildQueryWithCountry(originalQuery, countryCode) {
  const countryName = getCountryName(countryCode);
  if (!countryName) {
    console.log('Country code not found in mapping:', countryCode);
    return originalQuery;
  }

  const countryVariations = {
    US: ['United States', 'USA', 'US', 'America', 'American'],
    GB: ['United Kingdom', 'UK', 'Britain', 'British', 'England', 'English'],
    CA: ['Canada', 'Canadian'],
    AU: ['Australia', 'Australian'],
    DE: ['Germany', 'German'],
    FR: ['France', 'French'],
    IT: ['Italy', 'Italian'],
    ES: ['Spain', 'Spanish'],
    JP: ['Japan', 'Japanese'],
    CN: ['China', 'Chinese'],
    IN: ['India', 'Indian'],
    BR: ['Brazil', 'Brazilian'],
    MX: ['Mexico', 'Mexican'],
    RU: ['Russia', 'Russian'],
    KR: ['South Korea', 'Korean']
  };

  const variations = countryVariations[countryCode] || [countryName, countryCode];
  const countryTerms = variations.map(term => `"${term}"`).join(' OR ');

  if (originalQuery) {
    return `(${originalQuery}) AND (${countryTerms})`;
  }
  return countryTerms;
}

// ---------------------------------------------------------------------
// Country relevance helpers (used by /api/news/aggregate only)
// ---------------------------------------------------------------------
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
  const tags = (article.tags || [])
    .map(tag =>
      typeof tag === 'string'
        ? tag.toLowerCase()
        : (tag.webTitle || tag.id || '').toLowerCase()
    )
    .filter(Boolean);

  const allText = `${title} ${trailText} ${bodyText} ${sectionName} ${tags.join(
    ' '
  )}`.toLowerCase();

  const countryIndicators = {
    US: {
      sports: {
        positive: [
          'united states',
          'usa',
          'us ',
          'american',
          'america',
          'nfl',
          'nba',
          'mlb',
          'nhl',
          'mls',
          'ncaa',
          'college football',
          'super bowl',
          'world series',
          'stanley cup',
          'nba finals',
          'march madness',
          'nfl playoffs',
          'nba playoffs',
          'mlb playoffs',
          'nhl playoffs',
          'dodgers',
          'yankees',
          'lakers',
          'warriors',
          'cowboys',
          'patriots'
        ],
        negative: [
          'premier league',
          'english',
          'england',
          'uk',
          'british',
          'britain',
          'efl',
          'championship',
          'fa cup',
          'scotland',
          'wales',
          'celtic',
          'rangers',
          'manchester',
          'liverpool',
          'chelsea',
          'arsenal',
          'tottenham',
          'west ham',
          'newcastle',
          'brighton'
        ]
      },
      politics: {
        positive: [
          'united states',
          'usa',
          'us ',
          'american',
          'america',
          'congress',
          'senate',
          'house of representatives',
          'white house',
          'supreme court',
          'washington dc',
          'capitol hill',
          'president',
          'senator',
          'representative',
          'democrat',
          'republican',
          'biden',
          'trump',
          'federal',
          'us government',
          'us politics'
        ],
        negative: [
          'westminster',
          'number 10',
          'downing street',
          'uk parliament',
          'british parliament',
          'house of commons',
          'house of lords',
          'prime minister',
          'mp ',
          'mps',
          'tory',
          'labour party',
          'scottish parliament',
          'welsh assembly'
        ]
      },
      business: {
        positive: [
          'united states',
          'usa',
          'us ',
          'american',
          'america',
          'nyse',
          'nasdaq',
          'dow jones',
          's&p 500',
          'federal reserve',
          'fed',
          'us economy',
          'us market',
          'wall street',
          'us dollar',
          'us companies',
          'us business',
          'us trade'
        ],
        negative: [
          'ftse',
          'london stock exchange',
          'uk economy',
          'uk market',
          'pound sterling',
          'bank of england',
          'uk companies',
          'uk business'
        ]
      },
      positive: ['united states', 'usa', 'us ', 'american', 'america'],
      negative: [
        'premier league',
        'english',
        'england',
        'uk',
        'british',
        'britain',
        'westminster',
        'number 10',
        'uk parliament',
        'ftse',
        'london stock exchange'
      ]
    },
    GB: {
      sports: {
        positive: [
          'united kingdom',
          'uk',
          'britain',
          'british',
          'england',
          'english',
          'scotland',
          'scottish',
          'wales',
          'welsh',
          'premier league',
          'efl',
          'championship',
          'fa cup',
          'celtic',
          'rangers',
          'manchester',
          'liverpool',
          'chelsea',
          'arsenal',
          'tottenham',
          'west ham',
          'newcastle',
          'brighton'
        ],
        negative: [
          'nfl',
          'nba',
          'mlb',
          'nhl',
          'american football',
          'super bowl',
          'world series',
          'stanley cup',
          'nba finals'
        ]
      },
      politics: {
        positive: [
          'united kingdom',
          'uk',
          'britain',
          'british',
          'england',
          'english',
          'westminster',
          'number 10',
          'downing street',
          'uk parliament',
          'british parliament',
          'house of commons',
          'house of lords',
          'prime minister',
          'mp ',
          'mps',
          'tory',
          'labour party',
          'scottish parliament',
          'welsh assembly'
        ],
        negative: [
          'congress',
          'senate',
          'house of representatives',
          'white house',
          'supreme court',
          'washington dc',
          'capitol hill',
          'president',
          'senator',
          'representative'
        ]
      },
      business: {
        positive: [
          'united kingdom',
          'uk',
          'britain',
          'british',
          'ftse',
          'london stock exchange',
          'uk economy',
          'uk market',
          'pound sterling',
          'bank of england',
          'uk companies',
          'uk business'
        ],
        negative: [
          'nyse',
          'nasdaq',
          'dow jones',
          's&p 500',
          'federal reserve',
          'fed',
          'us economy',
          'us market',
          'wall street'
        ]
      },
      positive: ['united kingdom', 'uk', 'britain', 'british', 'england', 'english'],
      negative: [
        'nfl',
        'nba',
        'mlb',
        'nhl',
        'congress',
        'senate',
        'white house',
        'nyse',
        'nasdaq'
      ]
    },
    CA: {
      sports: {
        positive: [
          'canada',
          'canadian',
          'cfl',
          'maple leafs',
          'blue jays',
          'raptors',
          'canucks',
          'flames',
          'oilers'
        ],
        negative: ['premier league', 'nfl', 'nba', 'mlb']
      },
      positive: ['canada', 'canadian'],
      negative: ['premier league', 'nfl', 'nba', 'mlb']
    },
    AU: {
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
      US: ['United States', 'USA', 'US', 'America', 'American'],
      GB: ['United Kingdom', 'UK', 'Britain', 'British', 'England', 'English'],
      CA: ['Canada', 'Canadian'],
      AU: ['Australia', 'Australian'],
      DE: ['Germany', 'German'],
      FR: ['France', 'French'],
      IT: ['Italy', 'Italian'],
      ES: ['Spain', 'Spanish'],
      JP: ['Japan', 'Japanese'],
      CN: ['China', 'Chinese'],
      IN: ['India', 'Indian'],
      BR: ['Brazil', 'Brazilian'],
      MX: ['Mexico', 'Mexican'],
      RU: ['Russia', 'Russian'],
      KR: ['South Korea', 'Korean']
    };
    const countryTerms = [
      targetCountryName.toLowerCase(),
      targetCountryCode.toLowerCase(),
      ...(countryVariationsMap[targetCountryCode] || []).map(v => v.toLowerCase())
    ];
    const hasCountryTerm = countryTerms.some(term => allText.includes(term));
    return {
      matches: hasCountryTerm,
      confidence: hasCountryTerm ? 'medium' : 'low',
      reason: hasCountryTerm ? 'Contains country term' : 'No country match'
    };
  }

  const isSports = section === 'sport' || sectionId === 'sport';
  const isPolitics =
    section === 'politics' || sectionId === 'politics' || sectionName.includes('politics');
  const isBusiness =
    section === 'business' ||
    sectionId === 'business' ||
    sectionName.includes('business') ||
    sectionName.includes('economy');

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
  if (
    sectionNameLower.includes('us') ||
    sectionNameLower.includes('usa') ||
    sectionNameLower.includes('united states')
  ) {
    if (targetCountryCode === 'US') positiveCount++;
    else negativeCount++;
  }
  if (
    sectionNameLower.includes('uk') ||
    sectionNameLower.includes('britain') ||
    sectionNameLower.includes('united kingdom')
  ) {
    if (targetCountryCode === 'GB') positiveCount++;
    else negativeCount++;
  }

  if (isSports) {
    if (negativeCount > 0 && positiveCount === 0) {
      return {
        matches: false,
        confidence: 'high',
        reason: `Contains ${negativeCount} negative indicator(s) for sports`
      };
    }
    if (positiveCount === 0 && negativeCount === 0) {
      const genericCountryTerms = [
        targetCountryName.toLowerCase(),
        targetCountryCode.toLowerCase()
      ];
      const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
      if (hasGenericTerm) {
        return {
          matches: true,
          confidence: 'medium',
          reason: 'Contains country name in content'
        };
      }
      return {
        matches: false,
        confidence: 'medium',
        reason: 'No country-specific sports indicators'
      };
    }
    if (positiveCount > 0) {
      return {
        matches: true,
        confidence: positiveCount >= 2 ? 'high' : 'medium',
        reason: `Contains ${positiveCount} positive indicator(s)`
      };
    }
  } else {
    const isStrictCategory = isPolitics || isBusiness;

    if (isStrictCategory) {
      if (negativeCount > 0 && positiveCount === 0) {
        return {
          matches: false,
          confidence: 'high',
          reason: `Contains ${negativeCount} negative indicator(s) for ${section}`
        };
      }
      if (positiveCount === 0 && negativeCount === 0) {
        const genericCountryTerms = [
          targetCountryName.toLowerCase(),
          targetCountryCode.toLowerCase()
        ];
        const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
        if (hasGenericTerm) {
          return {
            matches: true,
            confidence: 'medium',
            reason: 'Contains country name in content'
          };
        }
        return {
          matches: false,
          confidence: 'medium',
          reason: `No country-specific indicators for ${section}`
        };
      }
    } else {
      if (negativeCount > positiveCount && negativeCount >= 2) {
        return {
          matches: false,
          confidence: 'medium',
          reason: 'More negative than positive indicators'
        };
      }
    }

    if (positiveCount > 0) {
      return {
        matches: true,
        confidence: positiveCount >= 2 ? 'high' : 'medium',
        reason: `Contains ${positiveCount} positive indicator(s)`
      };
    }

    if (!isStrictCategory) {
      const genericCountryTerms = [
        targetCountryName.toLowerCase(),
        targetCountryCode.toLowerCase()
      ];
      const hasGenericTerm = genericCountryTerms.some(term => allText.includes(term));
      if (hasGenericTerm) {
        return {
          matches: true,
          confidence: 'low',
          reason: 'Contains country name in content'
        };
      }
    }
  }

  if (isSports || isPolitics || isBusiness) {
    return {
      matches: false,
      confidence: 'low',
      reason: `No country indicators found for ${section} article`
    };
  }
  return {
    matches: true,
    confidence: 'low',
    reason: 'No clear country indicators - allowing as global content'
  };
}

function filterArticlesByCountry(articles, countryCode, section, includeInternational = false) {
  if (!countryCode) {
    return articles;
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

  console.log(
    `[COUNTRY FILTER] Filtered ${articles.length} articles to ${filtered.length} for country ${countryCode} (section: ${section}, strict: ${isStrictCategory})`
  );
  return filtered;
}

// =====================================================================
// 1) SIMPLE SEARCH ENDPOINT FOR search_results_loader.js
//    GET /api/search?q=...&country=US
// =====================================================================
app.get('/api/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Number(req.query.limit) || 30;
    const country = req.query.country || '';

    console.log('[Search] Request:', { q, country, limit });

    if (!q) {
      return res.status(400).json({ error: 'Missing search query (?q=...)' });
    }

    // Mock mode – just filter mock articles by title
    if (MOCK_MODE) {
      console.warn('[Search] MOCK_MODE enabled – using mock articles only');
      const filtered = mockData.articles.filter(a =>
        a.title.toLowerCase().includes(q.toLowerCase())
      );
      const articles = filtered.slice(0, limit).map(a => ({
        title: a.title,
        description: '',
        url: a.url,
        publishedAt: a.publishedAt,
        sourceName: 'Mock'
      }));
      return res.json({ articles });
    }

    // Build Guardian params
    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'trailText,bodyText',
      'page-size': Math.min(limit, 50),
      'order-by': 'newest'
    };

    let searchQuery = q;
    // Optional: apply country in text query, but we do NOT filter aggressively here
    if (country) {
      searchQuery = buildQueryWithCountry(searchQuery, country);
      console.log('[Search] Query with country:', searchQuery);
    }
    params.q = searchQuery;

    console.log('[Search] Guardian call:', {
      url: `${GUARDIAN_BASE_URL}/search`,
      params
    });

    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });




    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    const results = response.data.response.results || [];
    console.log('[Search] Guardian returned', results.length, 'articles');

    const articles = results.slice(0, limit).map(a => ({
      title: a.webTitle,
      description: a.fields?.trailText || '',
      url: a.webUrl,
      publishedAt: a.webPublicationDate,
      sourceName: 'The Guardian'
    }));

    return res.json({ articles });
  } catch (err) {
    console.error('[Search] ERROR:', err.message);
    if (err.response) {
      console.error('  Status:', err.response.status);
      console.error('  Data:', JSON.stringify(err.response.data, null, 2));
    }
    res.status(500).json({
      error: err.message || 'Internal server error'
    });
  }
});

// =====================================================================
// 2) AGGREGATE ENDPOINT FOR CATEGORY PAGES
//    GET /api/news/aggregate?... (unchanged from your version)
// =====================================================================
app.get('/api/news/aggregate', async (req, res) => {
  try {
    const { category, country, page = 1, limit = 18, query, q } = req.query;

    const numericLimit = Number(limit) || 18;
    const numericPage = Number(page) || 1;

    console.log('[AGGREGATE] Request received', {
      category,
      country,
      page: numericPage,
      limit: numericLimit,
      query: query || q || ''
    });

    if (MOCK_MODE) {
      const articles = mockData.articles.slice(0, numericLimit);
      const grouped = articles.map((a, idx) => ({
        groupId: a.id || `mock-${idx}`,
        groupTitle: a.title,
        summary: `Mock summary for "${a.title}".`,
        articles: [
          {
            id: a.id,
            title: a.title,
            url: a.url,
            source: 'Mock Source',
            sourceName: 'Mock Source',
            description: '',
            publishedAt: a.publishedAt || a.date || new Date().toISOString()
          }
        ]
      }));

      return res.json({
        groupedArticles: grouped,
        rawArticles: articles,
        warnings: ['Mock mode enabled (no real Guardian data).'],
        pagination: {
          currentPage: numericPage,
          totalPages: 1
        },
        mockMode: true,
        fallbackMode: false
      });
    }

    const params = {
      'api-key': GUARDIAN_API_KEY,
      'show-fields': 'trailText,bodyText',
      'show-tags': 'all',
      'page-size': Math.min(numericLimit * 3, 50),
      page: numericPage,
      'order-by': 'newest'
    };

    if (category) {
      params.section = category;
    }

    let searchQuery = query || q || '';

    if (country) {
      searchQuery = buildQueryWithCountry(searchQuery, country);
      console.log('[AGGREGATE] Built query with country:', searchQuery);
    }

    if (searchQuery) {
      params.q = searchQuery;
    }

    console.log('[AGGREGATE] Guardian API call', {
      url: `${GUARDIAN_BASE_URL}/search`,
      params
    });

    const response = await axios.get(`${GUARDIAN_BASE_URL}/search`, { params });

    console.log("==============================================");
    console.log("[DEBUG] RAW GUARDIAN RESPONSE:");
    console.log(JSON.stringify(response.data, null, 2));
    console.log("==============================================");



    if (response.data.response.status !== 'ok') {
      throw new Error(`Guardian API error: ${response.data.response.message}`);
    }

    let articles = response.data.response.results;
    const totalPages = response.data.response.pages || 1;

    if (articles && articles.length > 0) {
      console.log(
        '[AGGREGATE] Sample articles:',
        articles.slice(0, 3).map(a => a.webTitle)
      );
    }

    const includeInternational = req.query.includeInternational === 'true';
    const originalCount = articles.length;

    if (country) {
      console.log(
        `[AGGREGATE] Applying country filter: country=${country}, category=${
          category || 'none'
        }, includeInternational=${includeInternational}`
      );
      articles = filterArticlesByCountry(
        articles,
        country,
        category || '',
        includeInternational
      );
      console.log(`[AGGREGATE] Filtered from ${originalCount} to ${articles.length} articles`);
    }

    articles = articles.slice(0, numericLimit);

    function buildSummaryFromArticle(a) {
      const trail = a.fields?.trailText || '';
      const body = a.fields?.bodyText || '';

      if (trail && trail.trim().length > 0) {
        return trail;
      }

      if (body && body.trim().length > 0) {
        const sentences = body
          .split(/[.!?]+/)
          .map(s => s.trim())
          .filter(s => s.length > 0);

        if (sentences.length === 0) {
          return 'Summary not available. Please read the article for details.';
        }

        return sentences.slice(0, 2).join('. ') + '.';
      }

      return 'Summary not available. Please read the article for details.';
    }

    const groupedArticles = articles.map((a, idx) => ({
      groupId: a.id || `guardian-${idx}`,
      groupTitle: a.webTitle,
      summary: buildSummaryFromArticle(a),
      articles: [
        {
          id: a.id,
          title: a.webTitle,
          url: a.webUrl,
          source: 'The Guardian',
          sourceName: 'The Guardian',
          description: a.fields?.trailText || '',
          publishedAt: a.webPublicationDate
        }
      ]
    }));

    const rawArticles = articles.map(a => ({
      id: a.id,
      title: a.webTitle,
      url: a.webUrl,
      sectionId: a.sectionId,
      sectionName: a.sectionName,
      publishedAt: a.webPublicationDate,
      description: a.fields?.trailText || ''
    }));

    res.json({
      groupedArticles,
      rawArticles,
      warnings: [],
      pagination: {
        currentPage: numericPage,
        totalPages
      },
      mockMode: false,
      fallbackMode: false
    });
  } catch (error) {
    console.error('[AGGREGATE] Error:', error.message);
    res.status(500).json({
      error: error.message || 'Failed to fetch aggregated news'
    });
  }
});

// =====================================================================
// 3) SINGLE-ARTICLE SUMMARIZER (used by article_loader.js)
//    POST /api/summarize
// =====================================================================
app.post('/api/summarize', async (req, res) => {
  try {
    const { text, title } = req.body;

    console.log('[Summarize] ========================================');
    console.log('[Summarize] Received summarize request');
    console.log('[Summarize] Title:', title);
    console.log('[Summarize] Text length:', text ? text.length : 0);

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
        aiSummary:
          fallbackSummary ||
          'Summary not available. Please read the full article for details.'
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
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:4000',
      'X-Title': 'News Summarizer'
    };

    const response = await axios.post(
      LLM_API_URL,
      {
        model: modelToUse,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert news analyst and summarizer. Create highly detailed, comprehensive summaries that provide maximum value to readers.'
          },
          {
            role: 'user',
            content: `You are summarizing a single news article. Create a 6–10 sentence, detailed summary that covers who, what, when, where, why, how, and impact. Do NOT repeat the title or mention sources.\n\nArticle Content:\n${text}`
          }
        ],
        max_tokens: 1000,
        temperature: 0.4
      },
      {
        headers,
        timeout: 30000
      }
    );

    let aiSummary = null;
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const firstChoice = response.data.choices[0];
      if (firstChoice.message && firstChoice.message.content) {
        aiSummary = firstChoice.message.content.trim();
      }
    }

    if (!aiSummary || aiSummary.length === 0) {
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

    return res.json({ aiSummary });
  } catch (error) {
    console.error('[Summarize] ERROR in summarize endpoint:', error.message);
    let errorMessage = error.message || 'Unable to generate summary. Please try again later.';

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
      }
    }

    return res.status(500).json({
      error: 'Failed to generate summary',
      aiSummary: errorMessage
    });
  }
});

// =====================================================================
// 4) MULTI-ARTICLE SEARCH SUMMARY
//    POST /api/summarize/search   (used by search_results_loader.js)
// =====================================================================
app.post('/api/summarize/search', async (req, res) => {
  try {
    const { query, articles } = req.body || {};
    console.log('[Search Summarize] Request received:', {
      query,
      articleCount: Array.isArray(articles) ? articles.length : 0
    });

    if (!Array.isArray(articles) || articles.length === 0) {
      return res.status(400).json({
        error: 'No articles provided for summarization',
        aiSummary: 'Error: No articles provided for summarization.'
      });
    }

    // Build a big text blob from all articles (title + source + content)
    const combinedText = articles
      .map((a, idx) => {
        const title = a.title || `Article ${idx + 1}`;
        const src = a.source || a.sourceName || 'Unknown Source';
        const date = a.publishedAt || '';
        const content =
          a.content || a.description || a.trailText || a.bodyText || '';

        return `### Article ${idx + 1}\nTitle: ${title}\nSource: ${src}\nPublished: ${date}\n\n${content}\n`;
      })
      .join('\n\n');

    if (!OPENROUTER_API_KEY) {
      console.warn(
        '[Search Summarize] No OpenRouter API key – using simple fallback summary'
      );
      const sentences = combinedText
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      const fallback = sentences.slice(0, 10).join('. ') + '.';
      return res.json({
        aiSummary:
          fallback ||
          'Summary not available. Please read the individual articles for details.'
      });
    }

    let modelToUse = LLM_MODEL;
    if (!modelToUse.includes('/')) {
      modelToUse = `openai/${modelToUse}`;
    }

    const headers = {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:4000',
      'X-Title': 'Multi-Source Search Summary'
    };

    const response = await axios.post(
      LLM_API_URL,
      {
        model: modelToUse,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert news analyst that synthesizes multiple related articles into one clear, neutral, information-dense summary.'
          },
          {
            role: 'user',
            content: `You are summarizing multiple news articles related to the search topic "${query}". Create a single, comprehensive summary (about 18–25 sentences) that synthesizes ALL articles together. Cover who, what, when, where, why, how, background, and impact. Do NOT repeat any article titles or mention specific sources.\n\nHere is the combined article content:\n\n${combinedText}`
          }
        ],
        max_tokens: 2000,
        temperature: 0.3
      },
      { headers, timeout: 30000 }
    );

    let aiSummary = null;
    if (response.data && response.data.choices && response.data.choices.length > 0) {
      const firstChoice = response.data.choices[0];
      if (firstChoice.message && firstChoice.message.content) {
        aiSummary = firstChoice.message.content.trim();
      }
    }

    if (!aiSummary || aiSummary.length === 0) {
      return res.status(500).json({
        error: 'Failed to extract summary from API response',
        aiSummary: 'Error: The AI service returned an invalid response.'
      });
    }

    aiSummary = aiSummary
      .replace(/\[(?:GUARDIAN|GDELT|CURRENTS|SOURCE|ARTICLE)\s*[-\s]*\d*\s*\]/gi, '')
      .replace(/(?:according to|from|via|source:)\s*\[?[^\]]*\]?/gi, '')
      .replace(/\[[^\]]*(?:guardian|gdelt|currents|source|article)[^\]]*\]/gi, '')
      .replace(/title:\s*["'][^"']*["']/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return res.json({ aiSummary });
  } catch (error) {
    console.error('[Search Summarize] ERROR:', error.message);
    let errorMessage =
      error.message || 'Unable to generate search summary. Please try again later.';
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
      }
    }
    return res.status(500).json({
      error: 'Failed to generate search summary',
      aiSummary: errorMessage
    });
  }
});

// =====================================================================
// Health + error handlers
// =====================================================================
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// =====================================================================
// Start server
// =====================================================================
app.listen(PORT, () => {
  console.log('========================================');
  console.log(`Guardian API Proxy Server running on port ${PORT}`);
  console.log(`API Key configured: ${GUARDIAN_API_KEY ? 'Yes' : 'No (Mock Mode)'}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
  console.log(
    `Aggregate example: http://localhost:${PORT}/api/news/aggregate?category=world&limit=6`
  );
  console.log('Search example:  http://localhost:' + PORT + '/api/search?q=technology');
  console.log('========================================');
});
