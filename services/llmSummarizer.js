const axios = require('axios');
const { OPENROUTER_API_KEY, LLM_API_URL, LLM_MODEL } = require('../config/apiKeys');

/**
 * Summarizes a group of articles (multi-source).
 * Always returns an object with { groupId, groupTitle, summary }.
 */
async function summarizeArticleGroup(group) {
  try {
    if (!group || !Array.isArray(group.articles) || group.articles.length === 0) {
      return {
        groupId: group?.groupId || 'unknown-group',
        groupTitle: 'News story',
        summary: 'No articles to summarize.'
      };
    }

    // If no OpenRouter key, always use basic (non-AI) summary
    if (!OPENROUTER_API_KEY) {
      console.warn('[LLM] No OPENROUTER_API_KEY set – using basic fallback summary.');
      return generateBasicSummary(group);
    }

    // Build text for all articles in the group
    const articlesText = group.articles.map((article, index) => {
      const src = (article.source || article.sourceName || 'Unknown').toUpperCase();
      return `[${src} - Article ${index + 1}]
Title: ${article.title || 'No title'}
Description: ${article.description || 'No description'}
Content: ${(article.content || article.description || '').slice(0, 800) || 'No content available'}
URL: ${article.url || 'Unknown URL'}
Published: ${article.publishedAt || 'Unknown date'}
---`;
    }).join('\n\n');

    const prompt = `You are analyzing multiple news articles about the same real-world story from different sources.
Your task is to create ONE extremely detailed, comprehensive, information-dense combined summary that synthesizes information from all sources and provides maximum value to readers. This summary should be so thorough that readers feel fully informed without needing to read the original articles.

Here are the articles:

${articlesText}

Return ONLY valid JSON with this exact shape:

{
  "groupTitle": "A short, neutral, headline-style title (5-12 words) that describes the story as a whole. Do NOT copy any single article headline.",
  "summary": "An EXTREMELY detailed, comprehensive, information-dense combined summary (12-18 sentences, about 350-500 words) that synthesizes information from ALL of the articles. The summary must be maximally informative and include EVERYTHING relevant:

- WHO: All key people, organizations, and entities with their specific roles, titles, and relationships. Include full names, positions, and affiliations.
- WHAT: The main event, action, or development with extensive specific details. Describe what happened step-by-step, including all relevant actions and outcomes.
- WHEN: Exact dates, times, and complete timeline of events. Include chronological sequence, duration, and temporal context.
- WHERE: Specific locations, regions, or places mentioned with full geographic context. Include addresses, cities, countries, regions, and any relevant location details.
- WHY: The reasons, causes, motivations, and deep context behind the story. Explain underlying factors, historical context, and driving forces.
- HOW: The detailed process, methods, or mechanisms involved. Describe procedures, techniques, approaches, and implementation details.
- IMPACT: Comprehensive consequences, implications, or significance. Include immediate effects, long-term implications, affected parties, and broader significance.
- QUOTES: Important quotes from key sources if available, with attribution context.
- NUMBERS: All specific statistics, figures, amounts, data points, percentages, measurements, and quantitative details mentioned.
- BACKGROUND: Extensive relevant context that helps understand the story. Include historical context, previous related events, and necessary background information.
- DETAILS: All specific facts, names, dates, locations, numbers, and concrete information from the articles.
- ANALYSIS: Key insights, patterns, or important observations that emerge from synthesizing multiple sources.

CRITICAL INSTRUCTIONS - YOU MUST FOLLOW THESE EXACTLY:
1. The summary must contain ONLY the synthesized description of the news story - be extremely thorough and information-dense
2. ABSOLUTELY DO NOT include article titles anywhere in the summary - not at the beginning, not at the end, not anywhere
3. DO NOT repeat or paraphrase the article title - the title is already shown separately, your job is to provide NEW information
4. Do NOT mention source names (Guardian, GDELT, Currents, Reuters, AP, BBC, etc.)
5. Do NOT include references like "[GUARDIAN]", "[SOURCE]", or "[Article 1]"
6. Do NOT include phrases like "According to [source]" or "From [source]"
7. Do NOT include any metadata, formatting markers, or attribution
8. Write in clear, engaging, information-dense prose that makes readers feel fully informed
9. Start the summary directly with the story content - do not preface with title or source
10. Prioritize concrete facts, specific details, numbers, names, dates, and locations over general statements
11. Synthesize information from ALL sources to provide the most complete picture possible
12. If multiple articles have similar titles, synthesize their content into ONE comprehensive summary - do not just repeat the title

The summary should provide complete, comprehensive understanding of the story without any source attribution or title references. Be thorough, detailed, and information-rich. NEVER repeat the title."
}`;

    let apiResponse;
    try {
      apiResponse = await axios.post(
        LLM_API_URL || 'https://openrouter.ai/api/v1/chat/completions',
        {
          model: LLM_MODEL || 'gpt-4.1-mini',
          messages: [
            {
              role: 'system',
              content: 'You are an expert news analyst and summarizer. Create extremely detailed, comprehensive, information-dense summaries that provide maximum value to readers. Your summaries should be thorough, covering all critical aspects: key players and their roles, specific facts and figures, timeline of events, background context, implications, quotes from important sources, locations, dates, and why this story matters. Write in clear, engaging, information-rich prose that makes readers feel fully informed without needing to read the full article. Always respond with valid JSON only.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1800,
          temperature: 0.3,
          response_format: { type: 'json_object' } // new-style JSON mode
        },
        {
          headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': process.env.FRONTEND_URL || 'http://localhost:4000',
            'X-Title': 'News Summarizer'
          },
          timeout: 30000
        }
      );
    } catch (apiErr) {
      console.error('[LLM] API request failed:', apiErr.response?.status, apiErr.response?.data || apiErr.message);
      // If the API call itself fails, fall back to a basic summary
      return generateBasicSummary(group);
    }

    let parsed;
    try {
      const content = apiResponse.data.choices?.[0]?.message?.content;
      parsed = typeof content === 'string' ? JSON.parse(content) : content;
    } catch (parseErr) {
      console.error('[LLM] Failed to parse JSON from LLM response:', parseErr.message);
      return generateBasicSummary(group);
    }

    const rawSummary = (parsed && typeof parsed.summary === 'string')
      ? parsed.summary.trim()
      : '';
    let rawTitle = (parsed && typeof parsed.groupTitle === 'string')
      ? parsed.groupTitle.trim()
      : '';

    // Clean summary: Remove any source names, titles, or reference markers
    let cleanedSummary = rawSummary && rawSummary.length > 20
      ? rawSummary
      : generateBasicSummary(group).summary;
    
    if (cleanedSummary && typeof cleanedSummary === 'string') {
      cleanedSummary = cleanedSummary
        // Remove source references like [GUARDIAN], [GDELT], [CURRENTS], etc.
        .replace(/\[(?:GUARDIAN|GDELT|CURRENTS|SOURCE|ARTICLE)\s*[-\s]*\d*\s*\]/gi, '')
        // Remove patterns like "According to [SOURCE]" or "From [SOURCE]" - only if brackets are present
        .replace(/(?:according to|from|via|source:)\s*\[[^\]]+\]/gi, '')
        // Remove standalone source names in brackets
        .replace(/\[[^\]]*(?:guardian|gdelt|currents|source|article)[^\]]*\]/gi, '')
        // Remove title references if they appear
        .replace(/title:\s*["'][^"']*["']/gi, '')
        // Clean up extra whitespace
        .replace(/\s+/g, ' ')
        .trim();
      
      // Safety check: if cleaning removed too much content, use fallback
      if (cleanedSummary.length < 20 || cleanedSummary === '.' || cleanedSummary.match(/^\.\s*$/)) {
        console.warn('[LLM] Cleaning removed too much content, using basic summary fallback');
        cleanedSummary = generateBasicSummary(group).summary;
      }
    }

    const summary = cleanedSummary;

    // Clean up / regenerate title if it’s too generic
    const genericPatterns = ['news story', 'story 1', 'story 2', 'latest news', 'news coverage', 'breaking news'];
    const isGenericTitle =
      !rawTitle ||
      rawTitle.length < 10 ||
      genericPatterns.some(p => rawTitle.toLowerCase().includes(p));

    let groupTitle;
    if (isGenericTitle) {
      groupTitle = generateNeutralTitle(
        group.articles[0]?.title,
        group.articles[0]?.description,
        summary
      );
    } else {
      groupTitle = rawTitle;
    }

    return {
      groupId: group.groupId,
      groupTitle,
      summary, // Keep for backwards compatibility
      aiSummary: summary // New consistent field name
    };

  } catch (err) {
    console.error('[LLM] Unexpected error summarizing group:', err);
    // Absolute safety net – never throw up to the router
    return generateBasicSummary(group);
  }
}

/**
 * Basic (non-AI) summary built from article descriptions/titles.
 * Used when the LLM is unavailable or errors out.
 */
function generateBasicSummary(group) {
  const articles = Array.isArray(group.articles) ? group.articles : [];
  const sources = [...new Set(articles.map(a => a.sourceName || a.source || 'Unknown'))];

  // Collect a few “best” description sentences from the group
  const snippets = [];
  for (const article of articles) {
    if (article.description && article.description.trim().length > 40) {
      const sentences = article.description
        .split(/[.!?]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);
      if (sentences.length > 0) {
        const piece = sentences.slice(0, 2).join('. ');
        if (piece.length > 40) snippets.push(piece);
      }
    } else if (article.title && article.title.trim().length > 20) {
      snippets.push(article.title.trim());
    }
    if (snippets.length >= 3) break;
  }

  let summary;
  if (snippets.length > 0) {
    summary = snippets.join(' ') + '.';
  } else {
    const titles = articles.map(a => a.title).filter(Boolean);
    summary = titles.length
      ? titles.join('; ')
      : `Multiple sources (${sources.join(', ')}) reported on this story, but details are limited.`;
  }

  summary = summary.replace(/\s+/g, ' ').trim();

  const groupTitle = generateNeutralTitle(
    articles[0]?.title,
    articles[0]?.description,
    summary
  );

  return {
    groupId: group.groupId || 'unknown-group',
    groupTitle,
    summary, // Keep for backwards compatibility
    aiSummary: summary // New consistent field name
  };
}

/**
 * Generate a neutral, headline-style title from title/description/summary.
 */
function generateNeutralTitle(title, description, summary) {
  // Prefer to mine the summary
  if (summary && summary.trim().length > 10) {
    const sentences = summary
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length > 0) {
      let s = sentences[0];

      s = s.replace(
        /^(This story|The story|This article|The article|According to|Reports indicate|Sources say|Multiple sources)\s+/i,
        ''
      ).trim();

      const words = s.split(/\s+/);
      if (words.length > 15) {
        s = words.slice(0, 15).join(' ');
      }

      if (s.length >= 20 && s.length <= 100) {
        return s.charAt(0).toUpperCase() + s.slice(1);
      }
    }
  }

  // Fallback: clean original title
  if (title && title.trim().length > 0) {
    let t = title
      .replace(/^(BREAKING|EXCLUSIVE|UPDATE|LIVE):\s*/i, '')
      .replace(/\s*-\s*(The Guardian|Guardian|GDELT|Currents|Reuters|AP|BBC).*$/i, '')
      .trim();

    if (t.length > 100) {
      const truncated = t.slice(0, 97);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 40) t = truncated.slice(0, lastSpace);
      else t = truncated;
    }

    if (t.length >= 15) {
      return t;
    }
  }

  // Last fallback: derive something short from description or summary
  const base = (description || summary || 'News story').trim();
  const short = base.split(/[.!?]/)[0].trim();
  return short.length > 0 ? short : 'News story';
}

module.exports = {
  summarizeArticleGroup,
  generateNeutralTitle
};
