const axios = require('axios');
const { OPENAI_API_KEY, LLM_API_URL, LLM_MODEL } = require('../config/apiKeys');

/**
 * @typedef {Object} GroupSummary
 * @property {string} groupId - Group identifier
 * @property {string} groupTitle - Neutral, relative title for the story group (headline-style, not from any single source)
 * @property {string} summary - Combined neutral summary of all articles
 * @property {string} detailedComparison - Detailed explanation of how sources differ
 * @property {string} simpleComparison - Short, simple comparison (1-2 sentences)
 * @property {Array<string>} differences - Array of differences (for backward compatibility)
 */

/**
 * Summarizes a group of articles and compares how sources differ
 * @param {Object} group - Article group with groupId and articles array
 * @returns {Promise<GroupSummary>}
 */
async function summarizeArticleGroup(group) {
  try {
    if (!group.articles || group.articles.length === 0) {
      return {
        groupId: group.groupId,
        groupTitle: 'News Story',
        summary: 'No articles to summarize.',
        detailedComparison: 'No articles available for comparison.',
        simpleComparison: 'No articles available for comparison.',
        differences: []
      };
    }

    // CRITICAL: Groups should always have multiple sources at this point
    // If we get a single-article group, something went wrong with grouping
    if (group.articles.length === 1) {
      console.warn(`[LLM] WARNING: Group ${group.groupId} has only 1 article. This should not happen after grouping.`);
      const article = group.articles[0];
      const summary = article.description || article.title;
      const neutralTitle = generateNeutralTitle(article.title, article.description, summary);
      return {
        groupId: group.groupId,
        groupTitle: neutralTitle,
        summary: summary
        // REMOVED: detailedComparison, simpleComparison, differences - no longer needed
      };
    }
    
    // Verify we have multiple sources
    const uniqueSources = new Set(group.articles.map(a => a.source || a.sourceName));
    if (uniqueSources.size < 2) {
      console.warn(`[LLM] WARNING: Group ${group.groupId} has ${group.articles.length} articles but only ${uniqueSources.size} unique source(s). This indicates grouping issues.`);
    }

    // Build prompt with ALL articles in the group, regardless of source
    // IMPORTANT: The summarizer considers every article in the group, from all sources,
    // to create one combined summary and comparison. This ensures multi-source aggregation.
    const articlesText = group.articles.map((article, index) => {
      return `[${article.source.toUpperCase()} - Article ${index + 1}]
Title: ${article.title}
Description: ${article.description || 'No description'}
Content: ${article.content?.substring(0, 500) || article.description || 'No content available'}
URL: ${article.url}
Published: ${article.publishedAt || 'Unknown date'}
---`;
    }).join('\n\n');
    
    // Log source breakdown for this group
    const sourcesInGroup = [...new Set(group.articles.map(a => a.source))];
    console.log(`[LLM] Summarizing group ${group.groupId} with ${group.articles.length} articles from ${sourcesInGroup.length} source(s): ${sourcesInGroup.join(', ')}`);

    // Build source names list for the prompt
    const sourceNames = [...new Set(group.articles.map(a => a.sourceName || a.source))].map(s => {
      const nameMap = { 'guardian': 'The Guardian', 'gdelt': 'GDELT', 'currents': 'Currents' };
      return nameMap[s?.toLowerCase()] || s || 'Unknown';
    }).join(', ');

    const prompt = `You are analyzing multiple news articles about the same real-world story from different sources. Your task is to create a clean, neutral combined summary.

Here are the articles:

${articlesText}

CRITICAL REQUIREMENTS:
1. Read ALL articles carefully and identify the key facts that all sources agree on
2. Create ONE neutral summary that combines information from all sources
3. Do NOT mention source differences or comparisons
4. Do NOT create generic filler text - base your summary on the actual content

Please provide a JSON response with the following structure:
{
  "groupTitle": "A short, neutral headline-style title (5-12 words) that describes what the story is about as a whole. This should NOT be copied from any single source's headline. Instead, create a neutral, descriptive title based on the combined content. Examples: 'Government announces new climate targets', 'Local protests over tuition increases', 'Tech company reports quarterly earnings'. Make it clear and descriptive but neutral.",
  "summary": "A clean, neutral summary (2-4 sentences, approximately 80-150 words) that combines the key facts from ALL articles. This should integrate information from all sources into one coherent narrative. Include: what happened, who was involved, when/where it occurred, and key details. Keep it concise, informative, and focused on the shared facts. Do NOT mention differences between sources."
}

IMPORTANT INSTRUCTIONS:
1. The summary MUST combine information from ALL articles - do not just paraphrase one source
2. Keep the summary SHORT (2-4 sentences, 80-150 words maximum)
3. Do NOT mention differences between sources
4. Do NOT compare sources
5. Do NOT mention source names
6. Focus on the FACTS that all sources agree on
7. Use direct, plain language
8. Make it readable and informative

Return ONLY valid JSON, no other text.`;

    // Call LLM API
    // TODO: Replace this with your actual LLM endpoint
    // If using OpenAI-compatible API:
    let response;
    
    if (!OPENAI_API_KEY || OPENAI_API_KEY === 'your_api_key_here') {
      // Fallback: Generate basic summary without LLM
      console.warn('[LLM] No API key provided, generating basic summary');
      return generateBasicSummary(group);
    }

    try {
      response = await axios.post(LLM_API_URL, {
        model: LLM_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a news analysis assistant. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 500, // Reduced for short, clean summaries (2-4 sentences)
        temperature: 0.3, // Lower temperature for more consistent, factual output
        response_format: { type: 'json_object' } // Request JSON format
      }, {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      // Parse response
      const content = response.data.choices[0].message.content;
      let parsed;
      
      try {
        // Try to parse JSON directly
        parsed = JSON.parse(content);
      } catch (e) {
        // If parsing fails, try to extract JSON from markdown code blocks
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          throw new Error('Could not parse JSON from response');
        }
      }

      const summary = parsed.summary || 'Summary not available.';
      // CRITICAL: Always generate title from summary, never use generic fallback
      let groupTitle = parsed.groupTitle;
      // Check for generic titles (case-insensitive)
      const genericPatterns = ['news story', 'story 1', 'story 2', 'story 3', 'latest news', 'news coverage', 'story from'];
      const isGeneric = !groupTitle || 
                       genericPatterns.some(pattern => groupTitle.toLowerCase().includes(pattern)) ||
                       /^story\s+\d+$/i.test(groupTitle) ||
                       groupTitle.length < 10;
      
      if (isGeneric) {
        // Generate title from summary if LLM didn't provide a good one
        groupTitle = generateNeutralTitle(group.articles[0]?.title, group.articles[0]?.description, summary);
      }
      
      return {
        groupId: group.groupId,
        groupTitle: groupTitle,
        summary: summary,
        detailedComparison: parsed.detailedComparison || parsed.differences?.join(' ') || 'Comparison not available.',
        simpleComparison: parsed.simpleComparison || parsed.differences?.[0] || 'Articles differ in their focus and emphasis.',
        differences: Array.isArray(parsed.differences) ? parsed.differences : []
      };

    } catch (apiError) {
      console.error('[LLM] API error:', apiError.message);
      // Fallback to basic summary
      return generateBasicSummary(group);
    }

  } catch (error) {
    console.error('[LLM] Error summarizing group:', error.message);
    // Return fallback summary
    const sources = [...new Set(group.articles.map(a => a.sourceName || a.source))];
    const sourceNames = sources.map(s => {
      const nameMap = { 'guardian': 'The Guardian', 'gdelt': 'GDELT', 'currents': 'Currents' };
      return nameMap[s?.toLowerCase()] || s || 'Unknown';
    }).join(', ');
    
    const summary = `Summary unavailable for this story.`;
    // CRITICAL: Always generate title from summary, never use generic fallback
    const groupTitle = generateNeutralTitle(group.articles[0]?.title, group.articles[0]?.description, group.articles[0]?.title || 'News Story');
    return {
      groupId: group.groupId,
      groupTitle: groupTitle,
      summary: summary
      // REMOVED: detailedComparison, simpleComparison, differences - no longer needed
    };
  }
}

/**
 * Generates a basic summary without LLM (fallback)
 */
function generateBasicSummary(group) {
  const sources = [...new Set(group.articles.map(a => a.sourceName || a.source))];
  const sourceNames = sources.map(s => {
    const nameMap = { 'guardian': 'The Guardian', 'gdelt': 'GDELT', 'currents': 'Currents' };
    return nameMap[s?.toLowerCase()] || s || 'Unknown';
  });
  
  // Build a proper summary from all articles' descriptions
  // Take first 2-3 sentences from each article's description
  const summaryParts = [];
  group.articles.forEach((article, idx) => {
    if (article.description && article.description.trim().length > 20) {
      const sentences = article.description.split(/[.!?]+/).filter(s => s.trim().length > 0);
      if (sentences.length > 0) {
        // Take first 1-2 sentences from each article
        const relevantSentences = sentences.slice(0, 2).join('. ').trim();
        if (relevantSentences.length > 30) {
          summaryParts.push(relevantSentences);
        }
      }
    } else if (article.title && article.title.trim().length > 10) {
      // If no description, use title as fallback
      summaryParts.push(article.title);
    }
  });
  
  // Combine all parts into a coherent summary
  let combinedSummary = '';
  if (summaryParts.length > 0) {
    combinedSummary = summaryParts.slice(0, 3).join(' ') + '.';
    // Clean up and ensure it's readable
    combinedSummary = combinedSummary.replace(/\s+/g, ' ').trim();
  } else {
    // Last resort: use titles
    const titles = group.articles.map(a => a.title).filter(Boolean).join('; ');
    combinedSummary = titles || `Multiple sources (${sourceNames.join(', ')}) covered this story.`;
  }
  
  const descriptions = group.articles
    .map(a => a.description)
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');

  // Generate basic comparisons
  let detailedComparison = `This story was covered by ${sourceNames.join(', ')}. `;
  if (sources.length === 2) {
    detailedComparison += `Each source provides its own perspective on the events.`;
  } else {
    detailedComparison += `Each source offers a different angle on the story.`;
  }

  let simpleComparison = '';
  if (sources.length === 2) {
    simpleComparison = `${sourceNames[0]} and ${sourceNames[1]} cover this story with different perspectives.`;
  } else {
    simpleComparison = `Covered by ${sourceNames.join(', ')} with varying perspectives.`;
  }

  const summary = descriptions || titles || 'Summary unavailable for this story.';
  // CRITICAL: Always generate title from summary, never use generic fallback
  const groupTitle = generateNeutralTitle(group.articles[0]?.title, group.articles[0]?.description, summary);
  return {
    groupId: group.groupId,
    groupTitle: groupTitle,
    summary: summary
    // REMOVED: detailedComparison, simpleComparison, differences - no longer needed
  };
}

/**
 * Generates a neutral, relative title from article title/description/summary
 * Attempts to create a headline-style title that's not source-specific
 * @param {string} title - Article title
 * @param {string} description - Article description
 * @param {string} summary - Optional group summary to extract title from
 */
function generateNeutralTitle(title, description, summary) {
  // CRITICAL: Always extract title from summary FIRST - never return generic labels
  // The summary is the source of truth for what the story is about
  
  // ALWAYS prioritize summary if it exists
  if (summary && summary.trim().length > 10) {
    // Strategy 1: Try to extract key phrases with action verbs
    const actionPatterns = [
      /([A-Z][^.!?]{0,50}(?:announces|announced|approves|approved|rejects|rejected|proposes|proposed|implements|implemented|introduces|introduced|launches|launched|reveals|revealed|confirms|confirmed|denies|denied|reports|reported)[^.!?]{0,50})/i,
      /([A-Z][^.!?]{0,50}(?:protest|protests|protesting|strike|strikes|striking|election|elections|meeting|meetings|decision|decisions|policy|policies|law|laws|bill|bills|plan|plans)[^.!?]{0,40})/i,
      /([A-Z][^.!?]{0,50}(?:breaks|breaking|happens|happened|occurs|occurred|develops|developed|emerges|emerged)[^.!?]{0,40})/i
    ];
    
    for (const pattern of actionPatterns) {
      const match = summary.match(pattern);
      if (match && match[1]) {
        let phrase = match[1].trim();
        // Clean up the phrase
        phrase = phrase
          .replace(/^(This story|The story|This article|The article|According to|Reports indicate|Sources say|Multiple sources)/i, '')
          .trim();
        
        if (phrase.length >= 20 && phrase.length <= 100) {
          // Capitalize first letter
          phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
          // Truncate if needed at word boundary
          if (phrase.length > 100) {
            const truncated = phrase.substring(0, 97);
            const lastSpace = truncated.lastIndexOf(' ');
            if (lastSpace > 50) {
              phrase = truncated.substring(0, lastSpace);
            } else {
              phrase = truncated;
            }
          }
          return phrase;
        }
      }
    }
    
    // Strategy 2: Extract first sentence and clean it up (MOST RELIABLE)
    const sentences = summary.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 0) {
      let firstSentence = sentences[0].trim();
      
      // Clean up common prefixes
      firstSentence = firstSentence
        .replace(/^(This story|The story|This article|The article|According to|Reports indicate|Sources say|Multiple sources|The news|A story|In|On|At|The|A|An)\s+/i, '')
        .replace(/^(that|which|who|where|when|what|how)\s+/i, '')
        .trim();
      
      // Capitalize first letter
      if (firstSentence.length > 0) {
        firstSentence = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
      }
      
      // Check if it's a good length (headline style: 5-15 words, 20-100 chars)
      const wordCount = firstSentence.split(/\s+/).length;
      if (wordCount >= 3 && wordCount <= 15 && firstSentence.length >= 20 && firstSentence.length <= 100) {
        return firstSentence;
      }
      
      // If too long, truncate intelligently at word boundary
      if (firstSentence.length > 100) {
        const truncated = firstSentence.substring(0, 97);
        const lastSpace = truncated.lastIndexOf(' ');
        if (lastSpace > 50) {
          firstSentence = truncated.substring(0, lastSpace);
        } else {
          firstSentence = truncated;
        }
      }
      
      // If still valid after truncation, return it
      if (firstSentence.length >= 20 && firstSentence.length <= 100) {
        return firstSentence;
      }
      
      // If still too long or short, try taking first 8-12 words
      const words = firstSentence.split(/\s+/);
      if (words.length > 8) {
        const shortTitle = words.slice(0, 12).join(' ');
        if (shortTitle.length >= 20 && shortTitle.length <= 100) {
          return shortTitle;
        }
      }
    }
    
    // Strategy 3: Extract first meaningful chunk (first 60-80 chars, at word boundary)
    if (summary.length > 20) {
      let chunk = summary.substring(0, 80).trim();
      const lastSpace = chunk.lastIndexOf(' ');
      if (lastSpace > 30) {
        chunk = chunk.substring(0, lastSpace);
      }
      
      // Clean up
      chunk = chunk
        .replace(/^(This story|The story|This article|The article|According to|Reports indicate|Sources say|Multiple sources|The news|A story|In|On|At|The|A|An)\s+/i, '')
        .trim();
      
      if (chunk.length >= 20) {
        chunk = chunk.charAt(0).toUpperCase() + chunk.slice(1);
        return chunk;
      }
    }
    
    // Strategy 4: Last resort - use first part of summary, even if short
    // This ensures we NEVER return a generic label
    let finalFallback = summary.substring(0, 70).trim();
    const lastSpace = finalFallback.lastIndexOf(' ');
    if (lastSpace > 20) {
      finalFallback = finalFallback.substring(0, lastSpace);
    }
    finalFallback = finalFallback
      .replace(/^(This story|The story|This article|The article|According to|Reports indicate|Sources say|Multiple sources)/i, '')
      .trim();
    
    if (finalFallback.length >= 15) {
      return finalFallback.charAt(0).toUpperCase() + finalFallback.slice(1);
    }
  }
  
  // If summary is too short or missing, try title/description but clean it up
  if (title) {
    let neutral = title
      .replace(/^(BREAKING|EXCLUSIVE|UPDATE|LIVE):\s*/i, '')
      .replace(/\s*-\s*(The Guardian|Guardian|GDELT|Currents|Reuters|AP|BBC).*$/i, '')
      .trim();
    
    if (neutral.length >= 15 && neutral.length <= 100) {
      return neutral;
    }
    
    // Truncate if needed
    if (neutral.length > 100) {
      const truncated = neutral.substring(0, 97);
      const lastSpace = truncated.lastIndexOf(' ');
      if (lastSpace > 50) {
        neutral = truncated.substring(0, lastSpace);
      } else {
        neutral = truncated;
      }
    }
    
    if (neutral.length >= 15) {
      return neutral;
    }
  }
  
  // Absolute last resort: use description if available
  if (description && description.length > 20) {
    const firstSentence = description.split(/[.!?]/)[0].trim();
    if (firstSentence.length >= 15 && firstSentence.length <= 100) {
      return firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
    }
  }
  
  // If we have ANY summary text, use a portion of it
  // This should never be reached if summary exists, but just in case
  if (summary && summary.length > 0) {
    const chunk = summary.substring(0, 60).trim();
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > 15) {
      return chunk.substring(0, lastSpace).charAt(0).toUpperCase() + chunk.substring(0, lastSpace).slice(1);
    }
    return chunk.charAt(0).toUpperCase() + chunk.slice(1);
  }
  
  // This should never happen if summary exists, but if it does, create from summary
  if (summary && summary.trim().length > 0) {
    // Last resort: take first 60 chars of summary
    const chunk = summary.substring(0, 60).trim();
    const lastSpace = chunk.lastIndexOf(' ');
    if (lastSpace > 15) {
      return chunk.substring(0, lastSpace).charAt(0).toUpperCase() + chunk.substring(0, lastSpace).slice(1);
    }
    return chunk.charAt(0).toUpperCase() + chunk.slice(1);
  }
  
  // Absolute last resort: use title as-is
  return title ? title.substring(0, 80).trim() : 'News Story';
}

module.exports = {
  summarizeArticleGroup,
  generateNeutralTitle
};

