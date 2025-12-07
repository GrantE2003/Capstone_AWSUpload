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

// Guardian API configuration
const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;
const GUARDIAN_BASE_URL = 'https://content.guardianapis.com';
const MOCK_MODE = !GUARDIAN_API_KEY;

// OpenAI configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Mock data for when no API key is provided (used by aggregate endpoint)
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

// Country code to country name mapping
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
  const tags = (article.tags || [])
    .map(tag => (typeof tag === 'string' ? tag.toLowerCase() : (tag.webTitle || tag.id || '').toLowerCase()))
    .filter(Boolean);

  const allText = `${title} ${trailText} ${bodyText} ${sectionName} ${tags.join(' ')}`.toLowerCase();

  const countryIndicators = {
    US: {
      sports: {
        positive: [
          'united states', 'usa', 'us ', 'american', 'america',
          'nfl', 'nba', 'mlb', 'nhl', 'mls', 'ncaa', 'college football',
          'super bowl', 'world series', 'stanley cup', 'nba finals', 'march madness',
          'nfl playoffs', 'nba playoffs', 'mlb playoffs', 'nhl playoffs',
          'dodgers', 'yankees', 'lakers', 'warriors', 'cowboys', 'patriots'
        ],
        negative: [
          'premier league', 'english', 'england', 'uk', 'british', 'britain',
          'efl', 'championship', 'fa cup', 'scotland', 'wales', 'celtic', 'rangers',
          'manchester', 'liverpool', 'chelsea', 'arsenal', 'tottenham', 'west ham',
          'newcastle', 'brighton'
        ]
      },
      politics: {
        positive: [
          'united states', 'usa', 'us ', 'american', 'america',
          'congress', 'senate', 'house of representatives', 'white house',
          'supreme court', 'washington dc', 'capitol hill', 'president', 'senator',
          'representative', 'democrat', 'republican', 'biden', 'trump',
          'federal', 'us government', 'us politics'
        ],
        negative: [
          'westminster', 'number 10', 'downing street', 'uk parliament',
          'british parliament', 'house of commons', 'house of lords', 'prime minister',
          'mp ', 'mps', 'tory', 'labour party', 'scottish parliament', 'welsh assembly'
        ]
      },
      business: {
        positive: [
          'united states', 'usa', 'us ', 'american', 'america',
          'nyse', 'nasdaq', 'dow jones', 's&p 500', 'federal reserve', 'fed',
          'us economy', 'us market', 'wall street', 'us dollar', 'us companies',
          'us business', 'us trade'
        ],
        negative: [
          'ftse', 'london stock exchange', 'uk economy', 'uk market',
          'pound sterling', 'bank of england', 'uk companies', 'uk business'
        ]
      },
      positive: ['united states', 'usa', 'us ', 'american', 'america'],
      negative: [
        'premier league', 'english', 'england', 'uk', 'british', 'britain',
        'westminster', 'number 10', 'uk parliament', 'ftse', 'london stock exchange'
      ]
    },
    GB: {
      sports: {
        positive: [
          'united kingdom', 'uk', 'britain', 'british', 'england', 'english',
          'scotland', 'scottish', 'wales', 'welsh', 'premier league', 'efl',
          'championship', 'fa cup', 'celtic', 'rangers', 'manchester', 'liverpool',
          'chelsea', 'arsenal', 'tottenham', 'west ham', 'newcastle', 'brighton'
        ],
        negative: [
          'nfl', 'nba', 'mlb', 'nhl', 'american football', 'super bowl',
          'world series', 'stanley cup', 'nba finals'
        ]
      },
      politics: {
        positive: [
          'united kingdom', 'uk', 'britain', 'british', 'england', 'english',
          'westminster', 'number 10', 'downing street', 'uk parliament',
          'british parliament', 'house of commons', 'house of lords',
          'prime minister', 'mp ', 'mps', 'tory', 'labour party',
          'scottish parliament', 'welsh assembly'
        ],
        negative: [
          'congress', 'senate', 'house of representatives', 'white house',
          'supreme court', 'washington dc', 'capitol hill', 'president',
          'senator', 'representative'
        ]
      },
      business: {
        positive: [
          'united kingdom', 'uk', 'britain', 'british', 'ftse',
          'london stock exchange', 'uk economy', 'uk market', 'pound sterling',
          'bank of england', 'uk companies', 'uk business'
        ],
        negative: [
          'nyse', 'nasdaq', 'dow jones', 's&p 500', 'federal reserve', 'fed',
          'us economy', 'us market', 'wall street'
        ]
      },
      positive: ['united kingdom', 'uk', 'britain', 'british', 'england', 'english'],
      negative: [
        'nfl', 'nba', 'mlb', 'nhl', 'congress', 'senate', 'white house',
        'nyse', 'nasdaq'
      ]
    },
    CA: {
      sports: {
        positive: [
          'canada', 'canadian', 'cfl', 'maple leafs', 'blue jays', 'raptors',
          'canucks', 'flames', 'oilers'
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
      return {
        matches: false,
        confidence: 'high',
        reason: `Contains ${negativeCount} negative indicator(s) for sports`
      };
    }
    if (positiveCount === 0 && negativeCount === 0) {
      const genericCountryTerms = [targetCountryName.toLowerCase(), targetCountryCode.toLowerCase()];
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
        const genericCountryTerms = [targetCountryName.toLowerCase(), targetCountryCode.toLowerCase()];
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
      const genericCountryTerms = [targetCountryName.toLowerCase(), targetCountryCode.toLowerCase()];
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

/**
 * Central country filter
 */
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

/**
 * Aggregate endpoint for grouped stories
 * Supports: category, query, q, country, page, limit
 * Returns: { groupedArticles, rawArticles, warnings, pagination, mockMode, fallbackMode }
 */
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

    // Mock mode (no Guardian key configured)
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

    // Build Guardian API params
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
        `[AGGREGATE] Applying country filter: country=${country}, category=${category || 'none'}, includeInternational=${includeInternational}`
      );
      articles = filterArticlesByCountry(articles, country, category || '', includeInternational);
      console.log(`[AGGREGATE] Filtered from ${originalCount} to ${articles.length} articles`);
    }

    // Limit final articles for grouping
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

// AI Summarization endpoint
app.post('/api/summarize', async (req, res) => {
  try {
    const { text, title } = req.body;

    if (!text || !title) {
      return res.status(400).json({ error: 'Text and title are required' });
    }

    console.log('[Summarize] AI Input - Title:', title);
    console.log('[Summarize] AI Input - Text length:', text.length);
    console.log('[Summarize] AI Input - Text preview:', text.substring(0, 200) + '...');

    // Validate API key - check for missing, placeholder, or invalid keys
    const isApiKeyValid = OPENAI_API_KEY && 
                          OPENAI_API_KEY.trim().length > 0 &&
                          OPENAI_API_KEY !== 'your_openai_api_key_here' &&
                          OPENAI_API_KEY !== 'sk-placeholder' &&
                          !OPENAI_API_KEY.startsWith('sk-0000') &&
                          OPENAI_API_KEY.length > 20; // Valid OpenAI keys are longer than 20 chars

    if (!isApiKeyValid) {
      console.log('[Summarize] No valid OpenAI API key found, using fallback summarizer');
      // Create a basic summary from the article content (fallback)
      const sentences = text.split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 500); // Filter meaningful sentences
      
      // Take first 3 meaningful sentences, or first 2 if text is short
      const keySentences = sentences.slice(0, 3);
      const summary = keySentences.length > 0 
        ? keySentences.join('. ').trim() + '.'
        : 'Summary not available. Please read the full article for details.';
      
      return res.json({ 
        summary: summary
      });
    }

    // Call OpenAI API with proper error handling
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content:
                'You are a news fact extractor. Read the entire article and extract the specific facts, events, and details. Do NOT summarize or paraphrase. Extract the actual information from the article. Include specific names, dates, locations, numbers, quotes, and events mentioned in the article.'
            },
            {
              role: 'user',
              content: `Read this news article and extract the specific facts and details. Include names, dates, locations, numbers, quotes, and events mentioned in the article. Do not summarize - extract the actual information:\n\nTitle: "${title}"\n\nArticle Content:\n${text}`
            }
          ],
          max_tokens: 400,
          temperature: 0.7
        },
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      const summary = response.data.choices?.[0]?.message?.content;
      if (!summary) {
        throw new Error('No summary returned from OpenAI API');
      }

      console.log('[Summarize] Successfully generated summary from OpenAI');
      return res.json({ summary });

    } catch (apiError) {
      // If API call fails, fall back to basic summarizer
      console.error('[Summarize] OpenAI API error:', apiError.message);
      if (apiError.response) {
        console.error('[Summarize] API response status:', apiError.response.status);
        console.error('[Summarize] API response data:', JSON.stringify(apiError.response.data, null, 2));
      }

      // Fallback to basic summary
      const sentences = text.split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 500);
      const keySentences = sentences.slice(0, 3);
      const fallbackSummary = keySentences.length > 0 
        ? keySentences.join('. ').trim() + '.'
        : 'Summary not available. Please read the full article for details.';

      console.log('[Summarize] Using fallback summarizer due to API error');
      return res.json({ 
        summary: fallbackSummary
      });
    }

  } catch (error) {
    console.error('[Summarize] Unexpected error:', error.message);
    res.status(500).json({ error: 'Failed to generate summary' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
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
  console.log(
    `Aggregate example: http://localhost:${PORT}/api/news/aggregate?category=world&limit=6`
  );
});
