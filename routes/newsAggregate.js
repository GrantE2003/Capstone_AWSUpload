const express = require('express');
const router = express.Router();

const { fetchGuardianArticles } = require('../services/guardianClient');
const { fetchGdeltArticles } = require('../services/gdeltClient');
const { fetchCurrentsArticles } = require('../services/currentsClient');
const { groupSimilarArticles } = require('../services/articleGrouper');
const { summarizeArticleGroup, generateNeutralTitle } = require('../services/llmSummarizer');

// How many story groups we want to return per page
const MAX_GROUPS_PER_PAGE = 18;

// CRITICAL: Log router initialization
console.log('[NewsAggregate Router] Router initialized');
console.log('[NewsAggregate Router] Will register: GET /aggregate');
console.log('[NewsAggregate Router] Full path will be: GET /api/news/aggregate');

// Test route to verify router is mounted correctly
// GET /api/news/test - Returns simple JSON to verify routing works
router.get('/test', (req, res) => {
  res.json({
    message: 'News aggregate router is working!',
    path: '/api/news/test',
    aggregateRoute: '/api/news/aggregate',
    timestamp: new Date().toISOString()
  });
});

/**
 * Aggregation endpoint that:
 * 1. Fetches articles from Guardian, GDELT, and Currents in parallel
 * 2. Normalizes them to common shape
 * 3. Groups similar articles
 * 4. Generates summaries and comparisons for each group
 *
 * CRITICAL PRODUCTION ROUTE:
 * GET /api/news/aggregate?category=business&country=US
 *
 * This route MUST exist exactly as /api/news/aggregate
 * Frontend calls: https://www.4970capstone-mss.com/api/news/aggregate?category=business&country=US
 */
router.get('/aggregate', async (req, res) => {
  try {
    // Log incoming request for debugging
    console.log('[Aggregate] ========================================');
    console.log('[Aggregate] Incoming request to /api/news/aggregate');
    console.log('[Aggregate] Method:', req.method);
    console.log('[Aggregate] URL:', req.originalUrl);
    console.log('[Aggregate] Query params:', req.query);
    console.log('[Aggregate] ========================================');

    const { query, country, category, page } = req.query;
    const pageNum = page ? parseInt(page, 10) : 1;
    const isSearch = query && query.trim().length > 0;
    const isCategory = category && category.trim().length > 0 && !isSearch;

    console.log('[Aggregate] Request:', {
      query: query || '(none)',
      country: country || '(none)',
      category: category || '(none)',
      page: pageNum,
      isSearch,
      isCategory
    });

    // CRITICAL: If a search query is provided, it MUST be used - don't fall back to category
    if (isSearch) {
      console.log('[Aggregate] SEARCH MODE: Using search query, ignoring category if present');
    } else if (isCategory) {
      console.log('[Aggregate] CATEGORY MODE: Using category, no search query');
    } else {
      console.warn('[Aggregate] WARNING: No search query or category provided - may return empty results');
    }

    // Parse query parameters - prioritize search query over category
    const newsQuery = {
      query: isSearch ? query.trim() : '', // Only use query if it's a search
      country: country || undefined,
      category: isSearch ? undefined : (category || undefined) // Don't use category if search is active
    };

    const warnings = [];

    // Fetch from all sources in parallel
    console.log('[Aggregate] Fetching from all sources (Guardian, GDELT, Currents)...');
    console.log('[Aggregate] Query:', query || category || 'default');

    const [guardianResults, gdeltResults, currentsResults] = await Promise.allSettled([
      fetchGuardianArticles(newsQuery).catch(err => {
        console.error('[Aggregate] Guardian API FAILED:', err.message);
        if (err.response) {
          console.error('[Aggregate] Guardian response status:', err.response.status);
        }
        warnings.push(`Guardian API: ${err.message}`);
        return [];
      }),
      fetchGdeltArticles(newsQuery).catch(err => {
        console.error('[Aggregate] GDELT API FAILED:', err.message);
        if (err.response) {
          console.error('[Aggregate] GDELT response status:', err.response.status);
        }
        warnings.push(`GDELT API: ${err.message}`);
        return [];
      }),
      fetchCurrentsArticles(newsQuery).catch(err => {
        console.error('[Aggregate] Currents API FAILED:', err.message);
        if (err.response) {
          console.error('[Aggregate] Currents response status:', err.response.status);
        }
        warnings.push(`Currents API: ${err.message}`);
        return [];
      })
    ]);

    // Extract results (handle Promise.allSettled structure)
    const guardianArticles =
      guardianResults.status === 'fulfilled' ? guardianResults.value : [];
    const gdeltArticles =
      gdeltResults.status === 'fulfilled' ? gdeltResults.value : [];
    const currentsArticles =
      currentsResults.status === 'fulfilled' ? currentsResults.value : [];

    // Verify results are arrays
    if (!Array.isArray(guardianArticles)) {
      console.warn('[Aggregate] Guardian returned non-array:', typeof guardianArticles);
    }
    if (!Array.isArray(gdeltArticles)) {
      console.warn('[Aggregate] GDELT returned non-array:', typeof gdeltArticles);
    }
    if (!Array.isArray(currentsArticles)) {
      console.warn('[Aggregate] Currents returned non-array:', typeof currentsArticles);
    }

    // Log results from each source for verification
    console.log('\n[Aggregate] Articles fetched from each source (already normalized):');
    const guardianCount = Array.isArray(guardianArticles) ? guardianArticles.length : 0;
    const gdeltCount = Array.isArray(gdeltArticles) ? gdeltArticles.length : 0;
    const currentsCount = Array.isArray(currentsArticles) ? currentsArticles.length : 0;

    console.log(
      `   Guardian: ${guardianCount} articles ${guardianCount === 0 ? '(NONE!)' : ''}`
    );
    console.log(`   GDELT: ${gdeltCount} articles ${gdeltCount === 0 ? '(NONE!)' : ''}`);
    console.log(
      `   Currents: ${currentsCount} articles ${currentsCount === 0 ? '(NONE!)' : ''}`
    );

    const totalArticles = guardianCount + gdeltCount + currentsCount;
    console.log(`   Total: ${totalArticles} articles from all sources\n`);
    
    // Warn if one source is dominating
    const maxCount = Math.max(guardianCount, gdeltCount, currentsCount);
    if (maxCount > 0) {
      const maxPercentage = (maxCount / totalArticles) * 100;
      if (maxPercentage > 70) {
        console.warn(`[Aggregate] WARNING: One source is dominating (${maxPercentage.toFixed(1)}% of articles). Source balancing will help.`);
      }
    }

    // Warn if any source returned zero articles and add to warnings
    if (guardianCount === 0) {
      const warningMsg = 'Guardian returned 0 articles - check API key and query';
      console.warn(`[Aggregate] WARNING: ${warningMsg}`);
      if (!warnings.some(w => w.includes('Guardian'))) {
        warnings.push(warningMsg);
      }
    }
    if (gdeltCount === 0) {
      const warningMsg = 'GDELT returned 0 articles - check API endpoint and query';
      console.warn(`[Aggregate] WARNING: ${warningMsg}`);
      if (!warnings.some(w => w.includes('GDELT'))) {
        warnings.push(warningMsg);
      }
    }
    if (currentsCount === 0) {
      const warningMsg = 'Currents returned 0 articles - check API key and query';
      console.warn(`[Aggregate] WARNING: ${warningMsg}`);
      if (!warnings.some(w => w.includes('Currents'))) {
        warnings.push(warningMsg);
      }
    }
    
    // Log which sources succeeded
    const successfulSources = [];
    if (guardianCount > 0) successfulSources.push(`Guardian (${guardianCount})`);
    if (gdeltCount > 0) successfulSources.push(`GDELT (${gdeltCount})`);
    if (currentsCount > 0) successfulSources.push(`Currents (${currentsCount})`);
    
    if (successfulSources.length > 0) {
      console.log(`[Aggregate] Successfully fetched articles from: ${successfulSources.join(', ')}`);
    }

    // Critical: If ALL sources failed, we have a problem
    if (totalArticles === 0) {
      console.error('[Aggregate] CRITICAL: ALL sources returned 0 articles!');
      console.error(
        '[Aggregate] This indicates a serious problem with API keys or network connectivity.'
      );
    }

    // Balance articles from each source to prevent one source from dominating
    // Take up to 30 articles from each source to ensure diversity
    // CRITICAL: Ensure we get articles from ALL available sources
    const MAX_ARTICLES_PER_SOURCE = 30;
    const MIN_ARTICLES_PER_SOURCE = 10; // Try to get at least 10 from each source if available
    
    const balancedGuardian = Array.isArray(guardianArticles) 
      ? guardianArticles.slice(0, Math.max(MIN_ARTICLES_PER_SOURCE, Math.min(MAX_ARTICLES_PER_SOURCE, guardianArticles.length))) 
      : [];
    const balancedGdelt = Array.isArray(gdeltArticles) 
      ? gdeltArticles.slice(0, Math.max(MIN_ARTICLES_PER_SOURCE, Math.min(MAX_ARTICLES_PER_SOURCE, gdeltArticles.length))) 
      : [];
    const balancedCurrents = Array.isArray(currentsArticles) 
      ? currentsArticles.slice(0, Math.max(MIN_ARTICLES_PER_SOURCE, Math.min(MAX_ARTICLES_PER_SOURCE, currentsArticles.length))) 
      : [];

    console.log(`[Aggregate] Balanced article counts: Guardian: ${balancedGuardian.length}, GDELT: ${balancedGdelt.length}, Currents: ${balancedCurrents.length}`);
    
    // CRITICAL: Log if we're missing sources
    if (balancedGuardian.length === 0 && guardianCount > 0) {
      console.error('[Aggregate] ERROR: Guardian articles available but not included!');
    }
    if (balancedGdelt.length === 0 && gdeltCount > 0) {
      console.error('[Aggregate] ERROR: GDELT articles available but not included!');
    }
    if (balancedCurrents.length === 0 && currentsCount > 0) {
      console.error('[Aggregate] ERROR: Currents articles available but not included!');
    }

    // Combine all normalized articles into ONE pool before grouping
    // Interleave articles from different sources to improve cross-source grouping
    const allArticles = [];
    const maxLength = Math.max(balancedGuardian.length, balancedGdelt.length, balancedCurrents.length);
    
    for (let i = 0; i < maxLength; i++) {
      if (i < balancedGuardian.length) allArticles.push(balancedGuardian[i]);
      if (i < balancedGdelt.length) allArticles.push(balancedGdelt[i]);
      if (i < balancedCurrents.length) allArticles.push(balancedCurrents[i]);
    }

    // Add source field to each article for grouping logic
    const articlesWithSource = allArticles.map(article => ({
      ...article,
      source:
        article.sourceName === 'Guardian'
          ? 'guardian'
          : article.sourceName === 'GDELT'
          ? 'gdelt'
          : article.sourceName === 'Currents'
          ? 'currents'
          : 'unknown'
    }));

    console.log('[Aggregate] Combined articles by source:');
    const guardianCountCombined = articlesWithSource.filter(a => a.source === 'guardian')
      .length;
    const gdeltCountCombined = articlesWithSource.filter(a => a.source === 'gdelt').length;
    const currentsCountCombined = articlesWithSource.filter(a => a.source === 'currents')
      .length;
    console.log(`   Guardian: ${guardianCountCombined} articles`);
    console.log(`   GDELT: ${gdeltCountCombined} articles`);
    console.log(`   Currents: ${currentsCountCombined} articles`);
    console.log(`   Total: ${articlesWithSource.length} articles\n`);

    const sourceBreakdown = {
      guardian: guardianCountCombined,
      gdelt: gdeltCountCombined,
      currents: currentsCountCombined
    };
    console.log('[Aggregate] Source verification:', sourceBreakdown);

    const nonGuardianCount = gdeltCountCombined + currentsCountCombined;
    if (nonGuardianCount === 0 && articlesWithSource.length > 0) {
      console.warn(
        '[Aggregate] WARNING: Only Guardian articles found. GDELT and Currents may not be working.'
      );
    } else {
      console.log(
        `[Aggregate] Non-Guardian articles: ${nonGuardianCount} (GDELT: ${gdeltCountCombined}, Currents: ${currentsCountCombined})`
      );
    }

    if (articlesWithSource.length === 0) {
      return res.json({
        query: query || '',
        country: country || undefined,
        category: category || undefined,
        groupedArticles: [],
        rawArticles: [],
        warnings: warnings.length > 0 ? warnings : ['No articles found from any source.']
      });
    }

    // Group similar articles ACROSS ALL SOURCES
    // Focus on title-based grouping - articles with similar titles should definitely group
    const similarityThreshold = 0.20; // Lowered to 0.20 to group more articles with similar titles
    const groups = groupSimilarArticles(articlesWithSource, similarityThreshold);
    
    // CRITICAL: Ensure grouping actually happened
    if (groups.length === articlesWithSource.length) {
      console.warn('[Aggregate] WARNING: No articles were grouped! All articles are in separate groups.');
      console.warn('[Aggregate] This suggests the similarity threshold may be too high or grouping logic needs adjustment.');
    } else {
      const groupedCount = groups.reduce((sum, g) => sum + g.articles.length, 0);
      const avgGroupSize = groupedCount / groups.length;
      console.log(`[Aggregate] Grouping successful: ${articlesWithSource.length} articles -> ${groups.length} groups (avg ${avgGroupSize.toFixed(1)} articles per group)`);
    }

    console.log(
      `\n[Aggregate] Grouped ${articlesWithSource.length} articles into ${groups.length} groups (cross-source grouping)`
    );

    // Log group composition by source to verify cross-source grouping
    let multiSourceCount = 0;
    let singleSourceCount = 0;
    groups.forEach((group, idx) => {
      const sources = {};
      group.articles.forEach(article => {
        sources[article.source] = (sources[article.source] || 0) + 1;
      });
      const sourceCount = Object.keys(sources).length;
      if (sourceCount > 1) {
        multiSourceCount++;
      } else {
        singleSourceCount++;
      }
      const sourceStr = Object.entries(sources)
        .map(([s, c]) => `${s}:${c}`)
        .join(', ');
      const firstTitle = group.articles[0]?.title?.substring(0, 50) || 'No title';
      console.log(
        `   Group ${idx + 1}: ${group.articles.length} articles from ${sourceCount} source(s) [${sourceStr}] - "${firstTitle}..."`
      );
    });
    console.log(`[Aggregate] Grouping summary: ${multiSourceCount} multi-source groups, ${singleSourceCount} single-source groups`);
    console.log('');

    // Filter groups to remove duplicates and ensure quality
    const filteredGroups = groups.filter(group => {
      if (group.articles.length > 1) {
        const normalizedTitles = group.articles.map(a => {
          const title = (a.title || '').toLowerCase().trim();
          return title
            .replace(/^(breaking|exclusive|update|live):\s*/i, '')
            .replace(
              /\s*-\s*(the guardian|guardian|gdelt|currents|reuters|ap|bbc).*$/i,
              ''
            )
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        });

        const firstTitle = normalizedTitles[0];
        const allIdentical = normalizedTitles.every(title => {
          return title === firstTitle && title.length > 0;
        });

        if (allIdentical && firstTitle.length > 10) {
          console.log(
            `[Aggregate] Filtering out group ${group.groupId} - all ${group.articles.length} articles have identical normalized title: "${firstTitle.substring(
              0,
              50
            )}..."`
          );
          return false;
        }
      }

      return true;
    });

    console.log(
      `[Aggregate] After filtering (identical-title only): ${filteredGroups.length} groups (removed ${
        groups.length - filteredGroups.length
      } groups with identical titles)`
    );

    // Helper function to count unique sources in a group
    const getUniqueSourceCount = group => {
      const sources = new Set(group.articles.map(a => a.source || a.sourceName));
      return sources.size;
    };

    // Helper function to get the most recent date from a group
    const getLatestDate = group => {
      const dates = group.articles
        .map(article => {
          try {
            return article.publishedAt ? new Date(article.publishedAt).getTime() : 0;
          } catch {
            return 0;
          }
        })
        .filter(d => d > 0);
      return dates.length > 0 ? Math.max(...dates) : 0;
    };

    // Helper function to calculate recency score (prioritize last 48 hours)
    const getRecencyScore = group => {
      const latestDate = getLatestDate(group);
      if (latestDate === 0) return 0;

      const now = Date.now();
      const hoursAgo = (now - latestDate) / (1000 * 60 * 60);

      if (hoursAgo <= 24) return 1000;
      if (hoursAgo <= 48) return 500;
      return Math.max(0, 500 - (hoursAgo - 48) * 10);
    };

    // Sort groups with priority: multi-source first (3 sources > 2 sources > 1 source), then recency
    filteredGroups.sort((a, b) => {
      const aSourceCount = getUniqueSourceCount(a);
      const bSourceCount = getUniqueSourceCount(b);

      const aIsMultiSource = aSourceCount >= 2;
      const bIsMultiSource = bSourceCount >= 2;

      // Prioritize groups with more sources (3 > 2 > 1)
      if (aSourceCount !== bSourceCount) {
        return bSourceCount - aSourceCount;
      }

      // If same source count, prioritize multi-source over single-source
      if (aIsMultiSource && !bIsMultiSource) return -1;
      if (!aIsMultiSource && bIsMultiSource) return 1;

      const aRecency = getRecencyScore(a);
      const bRecency = getRecencyScore(b);

      if (aRecency !== bRecency) {
        return bRecency - aRecency;
      }

      const aDate = getLatestDate(a);
      const bDate = getLatestDate(b);
      return bDate - aDate;
    });

    const multiSourceGroups = filteredGroups.filter(g => getUniqueSourceCount(g) >= 2);
    const singleSourceGroups = filteredGroups.filter(g => getUniqueSourceCount(g) < 2);

    console.log(
      `[Aggregate] After filtering: ${multiSourceGroups.length} multi-source groups, ${singleSourceGroups.length} single-source groups`
    );

    // Prioritize multi-source groups, but allow single-source as fallback
    let groupsToSummarize;

    if (multiSourceGroups.length >= MAX_GROUPS_PER_PAGE) {
      // Plenty of multi-source groups, just take the top N
      groupsToSummarize = multiSourceGroups.slice(0, MAX_GROUPS_PER_PAGE);
      console.log(
        `[Aggregate] Using ${groupsToSummarize.length} multi-source groups (core functionality working)`
      );
    } else if (multiSourceGroups.length > 0) {
      // Some multi-source groups, top them up with single-source groups
      const remainingSlots = MAX_GROUPS_PER_PAGE - multiSourceGroups.length;
      groupsToSummarize = [
        ...multiSourceGroups,
        ...singleSourceGroups.slice(0, remainingSlots)
      ];
      console.log(
        `[Aggregate] Using ${multiSourceGroups.length} multi-source + ${
          groupsToSummarize.length - multiSourceGroups.length
        } single-source groups`
      );
    } else if (singleSourceGroups.length > 0) {
      // No multi-source groups, fallback to single-source (capped)
      groupsToSummarize = singleSourceGroups.slice(0, MAX_GROUPS_PER_PAGE);
      console.warn(
        `[Aggregate] WARNING: No multi-source groups found. Using ${groupsToSummarize.length} single-source groups as fallback.`
      );
    } else {
      groupsToSummarize = [];
      console.warn('[Aggregate] WARNING: No groups created at all!');
    }

    // Summarize each group (with concurrency limit)
    const MAX_CONCURRENT_SUMMARIES = 3;
    const summarizedGroups = [];

    for (let i = 0; i < groupsToSummarize.length; i += MAX_CONCURRENT_SUMMARIES) {
      const batch = groupsToSummarize.slice(i, i + MAX_CONCURRENT_SUMMARIES);
      const summaries = await Promise.allSettled(
        batch.map(group => summarizeArticleGroup(group))
      );

      summaries.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const summary = result.value.summary || 'Summary not available.';
          let groupTitle = result.value.groupTitle;

          // Always generate a neutral title from summary + metadata
          groupTitle = generateNeutralTitle(
            batch[index].articles[0]?.title,
            batch[index].articles[0]?.description,
            summary
          );

          const genericPatterns = [
            'news story',
            'story 1',
            'story 2',
            'story 3',
            'latest news',
            'news coverage',
            'story from',
            'covered this story',
            'multiple sources'
          ];
          const isStillGeneric =
            !groupTitle ||
            genericPatterns.some(pattern =>
              groupTitle.toLowerCase().includes(pattern)
            ) ||
            /^story\s+\d+$/i.test(groupTitle) ||
            groupTitle.length < 10;

          if (isStillGeneric && summary && summary.length > 20) {
            const firstSentence = summary.split(/[.!?]/)[0].trim();
            if (firstSentence.length > 15) {
              const words = firstSentence.split(/\s+/).slice(0, 12).join(' ');
              groupTitle = words.charAt(0).toUpperCase() + words.slice(1);
            }
          }

          const uniqueSources = [
            ...new Set(
              batch[index].articles.map(
                a => a.sourceName || a.source || 'Unknown'
              )
            )
          ];
          const sourceCount = uniqueSources.length;

          summarizedGroups.push({
            groupId: result.value.groupId,
            groupTitle: groupTitle,
            summary: summary, // Keep for backwards compatibility
            aiSummary: summary, // New consistent field name
            articles: batch[index].articles,
            sourceCount: sourceCount,
            sources: uniqueSources
          });
        } else {
          console.error(
            '[Aggregate] Summarization failed for group:',
            batch[index].groupId,
            result.reason
          );
          warnings.push(`Failed to summarize group ${batch[index].groupId}`);

          const firstArticle = batch[index].articles[0];
          const articleTitles = batch[index].articles
            .map(a => a.title)
            .filter(Boolean)
            .join('; ');
          const fallbackSummary =
            articleTitles ||
            'Summary unavailable. Please review the articles below.';

          const groupTitle = generateNeutralTitle(
            firstArticle?.title,
            firstArticle?.description,
            fallbackSummary
          );

          const uniqueSources = [
            ...new Set(
              batch[index].articles.map(
                a => a.sourceName || a.source || 'Unknown'
              )
            )
          ];
          const sourceCount = uniqueSources.length;

          summarizedGroups.push({
            groupId: batch[index].groupId,
            groupTitle: groupTitle,
            summary: fallbackSummary, // Keep for backwards compatibility
            aiSummary: fallbackSummary, // New consistent field name
            articles: batch[index].articles,
            sourceCount: sourceCount,
            sources: uniqueSources
          });
        }
      });
    }

    // Apply universal pagination - ALL views paginate at 18 groups per page
    let finalGroups = summarizedGroups;
    let totalGroups = summarizedGroups.length;
    let totalPages = 1;
    let currentPage = 1;
    const GROUPS_PER_PAGE = MAX_GROUPS_PER_PAGE; // 18

    const groupsPerPage = GROUPS_PER_PAGE;
    totalPages = Math.max(1, Math.ceil(summarizedGroups.length / groupsPerPage));
    currentPage = Math.max(1, Math.min(pageNum, totalPages));
    const startIndex = (currentPage - 1) * groupsPerPage;
    const endIndex = startIndex + groupsPerPage;
    finalGroups = summarizedGroups.slice(startIndex, endIndex);

    const viewType = isSearch ? 'search' : isCategory ? 'category' : 'other';
    console.log(
      `[Aggregate] ${viewType} view: UNIVERSAL PAGINATION - page ${currentPage} of ${totalPages}`
    );
    console.log(
      `[Aggregate] ${viewType} view: ${summarizedGroups.length} total groups, showing groups ${
        startIndex + 1
      }-${Math.min(endIndex, summarizedGroups.length)} (max ${groupsPerPage} per page)`
    );

    if (finalGroups.length > groupsPerPage) {
      console.error(
        `[Aggregate] ERROR: Pagination limit violated! Showing ${finalGroups.length} groups, max is ${groupsPerPage}`
      );
      finalGroups = finalGroups.slice(0, groupsPerPage);
    }

    if (finalGroups.length > GROUPS_PER_PAGE) {
      console.error(
        `[Aggregate] CRITICAL: Pagination limit still violated after enforcement!`
      );
      finalGroups = finalGroups.slice(0, GROUPS_PER_PAGE);
    }

    const responsePayload = {
      query: query || '',
      country: country || undefined,
      category: category || undefined,
      groupedArticles: finalGroups,
      rawArticles: articlesWithSource,
      pagination: {
        currentPage: currentPage,
        totalPages: totalPages,
        totalGroups: totalGroups,
        groupsPerPage: GROUPS_PER_PAGE
      },
      ...(warnings.length > 0 && { warnings })
    };

    if (finalGroups.length === 0 && articlesWithSource.length > 0) {
      console.warn('[Aggregate] WARNING: No groups created, but raw articles exist.');
      console.warn('[Aggregate] Frontend will use fallback mode to display raw articles.');
    }

    console.log(
      '[Aggregate] Returning',
      finalGroups.length,
      'summarized groups and',
      articlesWithSource.length,
      'raw articles'
    );
    res.json(responsePayload);
  } catch (error) {
    console.error('[Aggregate] ========================================');
    console.error('[Aggregate] ERROR in aggregate endpoint');
    console.error('[Aggregate] Error message:', error.message);
    console.error('[Aggregate] Error stack:', error.stack);
    console.error('[Aggregate] ========================================');
    
    res.status(500).json({
      error: error.message || 'Failed to aggregate news',
      groupedArticles: [],
      rawArticles: [],
      warnings: [`Error: ${error.message || 'Unknown error occurred'}`]
    });
  }
});

// Log router export
console.log('[NewsAggregate Router] Router exported successfully');
console.log(
  '[NewsAggregate Router] Routes registered:',
  router.stack
    .map(layer => {
      if (layer.route) {
        return `${Object.keys(layer.route.methods)
          .join(', ')
          .toUpperCase()} ${layer.route.path}`;
      }
      return null;
    })
    .filter(Boolean)
);

module.exports = router;
