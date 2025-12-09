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
Your task is to create ONE comprehensive, informative combined summary that synthesizes information from all sources.

Here are the articles:

${articlesText}

Return ONLY valid JSON with this exact shape:

{
  "groupTitle": "A short, neutral, headline-style title (5-12 words) that describes the story as a whole. Do NOT copy any single article headline.",
  "summary": "A comprehensive, informative combined summary (4-7 sentences, about 150-250 words) that synthesizes information from ALL of the articles. Include key details: who, what, when, where, why, and how. Include specific names, dates, locations, numbers, quotes, and important context. Do not mention sources or compare them. Write in clear, engaging prose that provides substantial information and helps readers understand the full story."
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
              content: 'You are a news analysis assistant. Always respond with valid JSON only.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 800,
          temperature: 0.4,
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

    const summary = rawSummary && rawSummary.length > 20
      ? rawSummary
      : generateBasicSummary(group).summary;

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
