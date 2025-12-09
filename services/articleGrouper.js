/**
 * Groups similar articles across sources that cover the same story
 * Uses text similarity, publish time, and URL patterns
 */

/**
 * @typedef {Object} ArticleGroup
 * @property {string} groupId - Unique group identifier
 * @property {Array<NormalizedArticle>} articles - Articles in this group
 */

/**
 * Normalizes text for comparison (lowercase, remove punctuation, trim)
 */
function normalizeText(text) {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

/**
 * Extracts key terms from text (simple word extraction)
 * Improved to capture more relevant terms for better cross-source matching
 */
function extractKeyTerms(text, maxTerms = 30) {
  if (!text || text.trim().length === 0) return [];

  const normalized = normalizeText(text);

  // Filter out common stop words that don't help with matching
  const stopWords = new Set([
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "can",
    "this",
    "that",
    "these",
    "those",
    "a",
    "an",
    "its",
    "it",
    "they",
    "them",
    "their",
    "there",
    "then",
    "than",
    "said",
    "says",
    "new",
    "news",
  ]);

  const words = normalized.split(/\s+/).filter((word) => {
    return word.length > 2 && !stopWords.has(word); // Reduced min length to 2 for better matching
  });

  const wordCounts = {};

  words.forEach((word) => {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  });

  // Sort by frequency and take top terms
  // Increased maxTerms to 30 for better matching across sources
  return Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word);
}

/**
 * Calculates Jaccard similarity between two sets
 * Jaccard = intersection size / union size
 */
function jaccardSimilarity(set1, set2) {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Calculates text similarity between two articles
 * Combines title, description similarity and publish time proximity
 * Improved to better match articles from different sources about the same story
 */
function calculateSimilarity(article1, article2) {
  // Extract key terms from title and description
  // Use both title and description for better matching
  const text1 = `${article1.title || ""} ${article1.description || ""}`.trim();
  const text2 = `${article2.title || ""} ${article2.description || ""}`.trim();

  if (!text1 || !text2) {
    return 0; // Can't compare if either is empty
  }

  const terms1 = new Set(extractKeyTerms(text1, 40)); // Increased term count for better matching
  const terms2 = new Set(extractKeyTerms(text2, 40));

  // Calculate Jaccard similarity
  let textSimilarity = jaccardSimilarity(terms1, terms2);

  // CRITICAL: Boost similarity if titles share significant overlap
  // This is the most important signal for cross-source matching
  if (article1.title && article2.title) {
    const title1 = normalizeText(article1.title);
    const title2 = normalizeText(article2.title);
    const titleTerms1 = new Set(extractKeyTerms(title1, 20));
    const titleTerms2 = new Set(extractKeyTerms(title2, 20));
    const titleSimilarity = jaccardSimilarity(titleTerms1, titleTerms2);

    // CRITICAL: Title similarity is the PRIMARY signal for grouping
    // Make title matching much more aggressive - if titles share significant words, group them
    if (titleSimilarity > 0.15) { // Lowered threshold from 0.2
      // Weight title similarity very heavily (98%) since it's the strongest signal
      textSimilarity = Math.max(
        textSimilarity,
        titleSimilarity * 0.98 + textSimilarity * 0.02
      );
    }

    // Additional boost: check for shared important words in titles (more aggressive)
    const title1Words = new Set(title1.split(/\s+/).filter((w) => w.length > 2)); // Lowered from 3 to 2
    const title2Words = new Set(title2.split(/\s+/).filter((w) => w.length > 2));
    const sharedTitleWords = [...title1Words].filter((w) => title2Words.has(w));
    if (sharedTitleWords.length >= 2) { // Lowered from 3 to 2
      textSimilarity = Math.min(1, textSimilarity + 0.2); // Increased boost from 0.1 to 0.2
    }
    
    // EXTRA: If titles share 4+ words, they're definitely about the same story
    if (sharedTitleWords.length >= 4) {
      textSimilarity = Math.min(1, textSimilarity + 0.3); // Strong boost for high overlap
    }
  }

  // Check publish time proximity (within 7 days = bonus)
  let timeBonus = 0;
  if (article1.publishedAt && article2.publishedAt) {
    try {
      const date1 = new Date(article1.publishedAt);
      const date2 = new Date(article2.publishedAt);
      const daysDiff = Math.abs(date1 - date2) / (1000 * 60 * 60 * 24);

      if (daysDiff <= 7) {
        timeBonus = 0.15;
      } else if (daysDiff <= 14) {
        timeBonus = 0.05;
      }
    } catch (e) {
      // ignore
    }
  }

  // Check URL domain similarity (same domain = bonus)
  let urlBonus = 0;
  try {
    const url1 = new URL(article1.url);
    const url2 = new URL(article2.url);
    if (url1.hostname === url2.hostname) {
      urlBonus = 0.05;
    }
  } catch (e) {
    // ignore
  }

  // Combined similarity score
  const combinedScore = textSimilarity * 0.95 + timeBonus * 0.05;
  return Math.min(1, combinedScore);
}

/**
 * Groups similar articles together ACROSS ALL SOURCES
 *
 * @param {Array<NormalizedArticle>} articles - Array of normalized articles from ALL sources
 * @param {number} similarityThreshold - Minimum similarity to group (0-1), default 0.3
 * @returns {Array<ArticleGroup>}
 */
function groupSimilarArticles(articles, similarityThreshold = 0.3) {
  if (!articles || articles.length === 0) {
    console.log("[ArticleGrouper] No articles provided");
    return [];
  }

  console.log(
    `[ArticleGrouper] Starting grouping with ${articles.length} articles, threshold: ${similarityThreshold}`
  );

  // Log source distribution
  const sourceCounts = {};
  articles.forEach((a) => {
    const source = a.source || a.sourceName || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  console.log("[ArticleGrouper] Source distribution:", sourceCounts);

  const groups = [];
  const used = new Set();

  // Sort articles by source (optional, but deterministic)
  const sortedArticles = [...articles].sort((a, b) => {
    const sourceA = (a.source || a.sourceName || "").toLowerCase();
    const sourceB = (b.source || b.sourceName || "").toLowerCase();
    return sourceA.localeCompare(sourceB);
  });

  // Phase 1: assign articles to groups
  for (let i = 0; i < sortedArticles.length; i++) {
    if (used.has(i)) continue;

    const article = sortedArticles[i];
    const articleSource = (article.source || article.sourceName || "unknown").toLowerCase();

    let bestGroup = null;
    let bestSimilarity = 0;
    let bestGroupHasDifferentSource = false;

    for (const group of groups) {
      const groupSources = new Set(
        group.articles.map((a) =>
          (a.source || a.sourceName || "unknown").toLowerCase()
        )
      );
      const hasDifferentSource = !groupSources.has(articleSource);

      let maxSimilarity = 0;
      for (const groupArticle of group.articles) {
        const similarity = calculateSimilarity(article, groupArticle);
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
        }
      }

      // Apply cross-source boost BEFORE threshold check to improve grouping
      // Make cross-source grouping even more aggressive
      const effectiveSimilarity = hasDifferentSource ? maxSimilarity * 1.5 : maxSimilarity; // Increased to 50% boost for cross-source
      
      if (effectiveSimilarity >= similarityThreshold) {
        // STRONGLY prefer groups with different sources (cross-source grouping)
        if (hasDifferentSource) {
          if (effectiveSimilarity > bestSimilarity || !bestGroupHasDifferentSource) {
            bestGroup = group;
            bestSimilarity = effectiveSimilarity;
            bestGroupHasDifferentSource = true;
          }
        } else if (!bestGroupHasDifferentSource && maxSimilarity > bestSimilarity) {
          // Only consider same-source groups if no cross-source match found
          bestGroup = group;
          bestSimilarity = maxSimilarity;
        }
      }
    }

    if (bestGroup) {
      bestGroup.articles.push(article);
    } else {
      const groupId = `group-${groups.length + 1}`;
      groups.push({ groupId, articles: [article] });
    }

    used.add(i);
  }

  console.log(
    `[ArticleGrouper] Phase 1 complete: ${groups.length} initial groups created`
  );

  // Phase 2: merge groups that clearly refer to the same story
  // Focus on title similarity - if titles are similar, merge the groups
  const mergedGroups = [];
  const merged = new Set();
  let mergeCount = 0;
  const mergeThreshold = similarityThreshold * 0.85; // Lowered from 0.95 to merge more aggressively

  for (let i = 0; i < groups.length; i++) {
    if (merged.has(i)) continue;

    const currentGroup = groups[i];
    const currentSources = new Set(
      currentGroup.articles.map((a) =>
        (a.source || a.sourceName || "unknown").toLowerCase()
      )
    );
    const mergedGroup = {
      groupId: currentGroup.groupId,
      articles: [...currentGroup.articles],
    };

    for (let j = i + 1; j < groups.length; j++) {
      if (merged.has(j)) continue;
      const otherGroup = groups[j];
      const otherSources = new Set(
        otherGroup.articles.map((a) =>
          (a.source || a.sourceName || "unknown").toLowerCase()
        )
      );

      const hasDifferentSources = [...currentSources].every(
        (s) => !otherSources.has(s)
      );

      if (!hasDifferentSources) continue;

      // Check title similarity first - if titles are similar, merge
      let maxSimilarity = 0;
      let maxTitleSimilarity = 0;
      
      for (const a1 of currentGroup.articles) {
        for (const a2 of otherGroup.articles) {
          const similarity = calculateSimilarity(a1, a2);
          if (similarity > maxSimilarity) maxSimilarity = similarity;
          
          // Extra check: if titles share significant words, boost similarity
          if (a1.title && a2.title) {
            const title1 = normalizeText(a1.title);
            const title2 = normalizeText(a2.title);
            const title1Words = new Set(title1.split(/\s+/).filter((w) => w.length > 2));
            const title2Words = new Set(title2.split(/\s+/).filter((w) => w.length > 2));
            const sharedWords = [...title1Words].filter((w) => title2Words.has(w));
            if (sharedWords.length >= 3) {
              maxTitleSimilarity = Math.max(maxTitleSimilarity, 0.3); // Boost for title similarity
            }
          }
        }
      }
      
      // Boost similarity if titles are similar
      if (maxTitleSimilarity > 0) {
        maxSimilarity = Math.max(maxSimilarity, maxSimilarity + maxTitleSimilarity);
      }

      if (maxSimilarity >= mergeThreshold) {
        console.log(
          `[ArticleGrouper] Merging groups ${i + 1} and ${j + 1}: similarity ${maxSimilarity.toFixed(
            3
          )} >= ${mergeThreshold.toFixed(3)}`
        );
        mergedGroup.articles.push(...otherGroup.articles);
        merged.add(j);
        mergeCount++;

        otherGroup.articles.forEach((a) => {
          const src = (a.source || a.sourceName || "unknown").toLowerCase();
          currentSources.add(src);
        });
      }
    }

    mergedGroups.push(mergedGroup);
    merged.add(i);
  }

  console.log(
    `[ArticleGrouper] Phase 2 complete: ${mergedGroups.length} merged groups (${mergeCount} merges performed)`
  );

  // Deduplicate sources in each group (keep most recent per source)
  const deduplicatedGroups = mergedGroups.map((group) => {
    const sourceMap = new Map(); // source -> article

    group.articles.forEach((article) => {
      const source = article.source || article.sourceName || "unknown";
      const existing = sourceMap.get(source);

      if (!existing) {
        sourceMap.set(source, article);
      } else {
        try {
          const existingDate = existing.publishedAt
            ? new Date(existing.publishedAt).getTime()
            : 0;
          const currentDate = article.publishedAt
            ? new Date(article.publishedAt).getTime()
            : 0;
          if (currentDate > existingDate && currentDate > 0) {
            sourceMap.set(source, article);
          }
        } catch (e) {
          // ignore
        }
      }
    });

    return {
      groupId: group.groupId,
      articles: Array.from(sourceMap.values()),
    };
  });

  // Separate multi-source and single-source groups
  const multiSourceGroupsFinal = deduplicatedGroups.filter((group) => {
    const uniqueSources = new Set(
      group.articles.map((a) =>
        (a.source || a.sourceName || "unknown").toLowerCase().trim()
      )
    );
    return uniqueSources.size >= 2;
  });

  const singleSourceGroupsFinal = deduplicatedGroups.filter((group) => {
    const uniqueSources = new Set(
      group.articles.map((a) =>
        (a.source || a.sourceName || "unknown").toLowerCase().trim()
      )
    );
    return uniqueSources.size < 2;
  });

  console.log(
    `[ArticleGrouper] After deduplication: ${multiSourceGroupsFinal.length} multi-source groups, ${singleSourceGroupsFinal.length} single-source groups`
  );

  // IMPORTANT: DO NOT enforce any page/size limits here.
  // Return ALL groups and let the router (newsAggregate.js) handle pagination (9, 18, etc.)
  if (multiSourceGroupsFinal.length > 0) {
    const combined = [...multiSourceGroupsFinal, ...singleSourceGroupsFinal];
    console.log(
      `[ArticleGrouper] Returning ${combined.length} groups (multi-source first, then single-source)`
    );
    return combined;
  }

  if (singleSourceGroupsFinal.length > 0) {
    console.log(
      `[ArticleGrouper] WARNING: No multi-source groups found. Returning ${singleSourceGroupsFinal.length} single-source groups`
    );
    return singleSourceGroupsFinal;
  }

  console.error("[ArticleGrouper] ERROR: No groups created at all!");
  return [];
}

module.exports = {
  groupSimilarArticles,
  calculateSimilarity,
  normalizeText,
  extractKeyTerms,
  jaccardSimilarity,
};
