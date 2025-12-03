const express = require('express');
const router = express.Router();

const { fetchGuardianArticles } = require('../services/guardianClient');
const { fetchGdeltArticles } = require('../services/gdeltClient');
const { fetchCurrentsArticles } = require('../services/currentsClient');
const { groupSimilarArticles } = require('../services/articleGrouper');
const { summarizeArticleGroup, generateNeutralTitle } = require('../services/llmSummarizer');

/**
 * Aggregation endpoint that:
 * 1. Fetches articles from Guardian, GDELT, and Currents in parallel
 * 2. Normalizes them to common shape
 * 3. Groups similar articles
 * 4. Generates summaries and comparisons for each group
 * 
 * GET /api/news/aggregate?query=...&country=...&category=...
 */
router.get('/aggregate', async (req, res) => {
  try {
    const { query, country, category, page } = req.query;
    const pageNum = page ? parseInt(page, 10) : 1;
    const isSearch = query && query.trim().length > 0;
    const isCategory = category && category.trim().length > 0 && !isSearch;
    
    console.log('[Aggregate] Request:', { query, country, category, page: pageNum, isSearch, isCategory });

    // Parse query parameters
    const newsQuery = {
      query: query || '',
      country: country || undefined,
      category: category || undefined
    };

    const warnings = [];

    // Fetch from all sources in parallel
    // CRITICAL: Fetch from ALL three sources - this is the core functionality
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
    // Each fetch function now returns normalized articles directly
    const guardianArticles = guardianResults.status === 'fulfilled' ? guardianResults.value : [];
    const gdeltArticles = gdeltResults.status === 'fulfilled' ? gdeltResults.value : [];
    const currentsArticles = currentsResults.status === 'fulfilled' ? currentsResults.value : [];

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

    // CRITICAL: Log results from each source for verification
    // This helps diagnose when sources aren't working
    console.log('\n[Aggregate] Articles fetched from each source (already normalized):');
    const guardianCount = Array.isArray(guardianArticles) ? guardianArticles.length : 0;
    const gdeltCount = Array.isArray(gdeltArticles) ? gdeltArticles.length : 0;
    const currentsCount = Array.isArray(currentsArticles) ? currentsArticles.length : 0;
    
    console.log(`   Guardian: ${guardianCount} articles ${guardianCount === 0 ? '(NONE!)' : ''}`);
    console.log(`   GDELT: ${gdeltCount} articles ${gdeltCount === 0 ? '(NONE!)' : ''}`);
    console.log(`   Currents: ${currentsCount} articles ${currentsCount === 0 ? '(NONE!)' : ''}`);
    
    const totalArticles = guardianCount + gdeltCount + currentsCount;
    console.log(`   Total: ${totalArticles} articles from all sources\n`);
    
    // Warn if any source returned zero articles
    if (guardianCount === 0) {
      console.warn('[Aggregate] WARNING: Guardian returned 0 articles - check API key and query');
    }
    if (gdeltCount === 0) {
      console.warn('[Aggregate] WARNING: GDELT returned 0 articles - check API endpoint');
    }
    if (currentsCount === 0) {
      console.warn('[Aggregate] WARNING: Currents returned 0 articles - check API key and query');
    }
    
    // Critical: If ALL sources failed, we have a problem
    if (totalArticles === 0) {
      console.error('[Aggregate] CRITICAL: ALL sources returned 0 articles!');
      console.error('[Aggregate] This indicates a serious problem with API keys or network connectivity.');
    }

    // CRITICAL: Combine all normalized articles into ONE pool before grouping
    // This ensures cross-source grouping - articles from Guardian, GDELT, and Currents
    // are compared together, not grouped separately by source
    const allArticles = [
      ...(Array.isArray(guardianArticles) ? guardianArticles : []),
      ...(Array.isArray(gdeltArticles) ? gdeltArticles : []),
      ...(Array.isArray(currentsArticles) ? currentsArticles : [])
    ];

    // Add source field to each article for grouping logic
    const articlesWithSource = allArticles.map(article => ({
      ...article,
      source: article.sourceName === 'Guardian' ? 'guardian' : 
              article.sourceName === 'GDELT' ? 'gdelt' : 
              article.sourceName === 'Currents' ? 'currents' : 'unknown'
    }));

    console.log('[Aggregate] Combined articles by source:');
    const guardianCountCombined = articlesWithSource.filter(a => a.source === 'guardian').length;
    const gdeltCountCombined = articlesWithSource.filter(a => a.source === 'gdelt').length;
    const currentsCountCombined = articlesWithSource.filter(a => a.source === 'currents').length;
    console.log(`   Guardian: ${guardianCountCombined} articles`);
    console.log(`   GDELT: ${gdeltCountCombined} articles`);
    console.log(`   Currents: ${currentsCountCombined} articles`);
    console.log(`   Total: ${articlesWithSource.length} articles\n`);
    
    // Log source breakdown for verification
    const sourceBreakdown = {
      guardian: guardianCountCombined,
      gdelt: gdeltCountCombined,
      currents: currentsCountCombined
    };
    console.log('[Aggregate] Source verification:', sourceBreakdown);
    
    // Verify non-Guardian sources are working
    const nonGuardianCount = gdeltCountCombined + currentsCountCombined;
    if (nonGuardianCount === 0 && articlesWithSource.length > 0) {
      console.warn('[Aggregate] WARNING: Only Guardian articles found. GDELT and Currents may not be working.');
    } else {
      console.log(`[Aggregate] Non-Guardian articles: ${nonGuardianCount} (GDELT: ${gdeltCountCombined}, Currents: ${currentsCountCombined})`);
    }

    if (articlesWithSource.length === 0) {
      return res.json({
        query: query || '',
        country: country || undefined,
        category: category || undefined,
        groups: [],
        warnings: warnings.length > 0 ? warnings : ['No articles found from any source.']
      });
    }

    // Group similar articles ACROSS ALL SOURCES
    // The grouping algorithm compares articles from all sources together,
    // not separately by source. This ensures cross-source grouping.
    // 
    // SIMILARITY THRESHOLD: Adjust this value to control grouping strictness
    // - Lower values (0.2-0.3): Stricter grouping = more groups, articles must be very similar
    // - Higher values (0.4-0.5): Looser grouping = fewer groups, more articles per group
    // - Default: 0.3 (moderate grouping)
    // 
    // The grouping algorithm uses:
    // 1. Jaccard similarity on key terms from title + description
    // 2. Publish time proximity (within 7 days = +0.1 bonus)
    // 3. URL domain similarity (same domain = +0.05 bonus)
    // 
    // CRITICAL: Similarity threshold for cross-source grouping
    // Lower threshold = more aggressive grouping (more groups, but may include false matches)
    // Higher threshold = stricter grouping (fewer groups, but more accurate matches)
    // 0.45 is a VERY STRICT threshold that prevents over-merging unrelated stories
    // This ensures articles are grouped ONLY if they clearly refer to the same story
    // Uses Jaccard similarity - threshold of 0.45 means articles must share significant overlap
    // CRITICAL: Must be high enough to prevent unrelated stories from merging
    // Expected result: Many distinct story groups (6-20+), each containing only related articles
    const similarityThreshold = 0.45;
    const groups = groupSimilarArticles(articlesWithSource, similarityThreshold);

    console.log(`\n[Aggregate] Grouped ${articlesWithSource.length} articles into ${groups.length} groups (cross-source grouping)`);
    
    // Log group composition by source to verify cross-source grouping
    groups.forEach((group, idx) => {
      const sources = {};
      group.articles.forEach(article => {
        sources[article.source] = (sources[article.source] || 0) + 1;
      });
      const sourceStr = Object.entries(sources).map(([s, c]) => `${s}:${c}`).join(', ');
      console.log(`   Group ${idx + 1}: ${group.articles.length} articles from ${Object.keys(sources).length} source(s) [${sourceStr}]`);
    });
    console.log('');

    // Filter groups to remove duplicates and ensure quality
    // Remove groups that have identical titles across all articles (normalized comparison)
    // Allow single-source groups (articles with no matches become their own group)
    const filteredGroups = groups.filter(group => {
      // Rule: If multiple articles, check if all titles are identical (after normalization)
      // This filters out exact duplicates while allowing single-article groups
      if (group.articles.length > 1) {
        const normalizedTitles = group.articles.map(a => {
          const title = (a.title || '').toLowerCase().trim();
          // Remove common prefixes/suffixes and normalize
          return title
            .replace(/^(breaking|exclusive|update|live):\s*/i, '')
            .replace(/\s*-\s*(the guardian|guardian|gdelt|currents|reuters|ap|bbc).*$/i, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        });
        
        const firstTitle = normalizedTitles[0];
        // Check if all normalized titles are identical
        const allIdentical = normalizedTitles.every(title => {
          // Allow small differences (e.g., punctuation, capitalization)
          return title === firstTitle && title.length > 0;
        });
        
        if (allIdentical && firstTitle.length > 10) {
          console.log(`[Aggregate] Filtering out group ${group.groupId} - all ${group.articles.length} articles have identical normalized title: "${firstTitle.substring(0, 50)}..."`);
          return false;
        }
      }
      
      // Allow all other groups (including single-article groups and multi-source groups)
      return true;
    });

    console.log(`[Aggregate] After filtering (identical-title only): ${filteredGroups.length} groups (removed ${groups.length - filteredGroups.length} groups with identical titles)`);

    // Helper function to count unique sources in a group
    const getUniqueSourceCount = (group) => {
      const sources = new Set(group.articles.map(a => a.source || a.sourceName));
      return sources.size;
    };

    // Helper function to get the most recent date from a group
    const getLatestDate = (group) => {
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
    const getRecencyScore = (group) => {
      const latestDate = getLatestDate(group);
      if (latestDate === 0) return 0;
      
      const now = Date.now();
      const hoursAgo = (now - latestDate) / (1000 * 60 * 60);
      
      // Articles from last 24 hours get highest score (1000)
      if (hoursAgo <= 24) return 1000;
      // Articles from 24-48 hours get medium score (500)
      if (hoursAgo <= 48) return 500;
      // Older articles get lower score based on age
      // After 48 hours, score decreases by 10 per hour
      return Math.max(0, 500 - (hoursAgo - 48) * 10);
    };

    // Sort groups with priority: multi-source first, then recency
    filteredGroups.sort((a, b) => {
      const aSourceCount = getUniqueSourceCount(a);
      const bSourceCount = getUniqueSourceCount(b);
      
      // Priority 1: Multi-source groups (2+ sources) come first
      const aIsMultiSource = aSourceCount >= 2;
      const bIsMultiSource = bSourceCount >= 2;
      
      if (aIsMultiSource && !bIsMultiSource) return -1; // a comes first
      if (!aIsMultiSource && bIsMultiSource) return 1;  // b comes first
      
      // Priority 2: Within same source-count category, sort by recency
      const aRecency = getRecencyScore(a);
      const bRecency = getRecencyScore(b);
      
      if (aRecency !== bRecency) {
        return bRecency - aRecency; // More recent first
      }
      
      // Priority 3: If recency is same, use latest date as tiebreaker
      const aDate = getLatestDate(a);
      const bDate = getLatestDate(b);
      return bDate - aDate; // Most recent first
    });

    /**
     * CRITICAL FIX: Multi-source grouping restoration
     * 
     * PROBLEM IDENTIFIED:
     * - Backend was returning only single-source groups (Guardian-only, etc.)
     * - The grouping algorithm wasn't matching articles across different sources
     * - Single-source groups were being returned, breaking the core functionality
     * 
     * ROOT CAUSE:
     * - The grouping algorithm allowed articles to match with groups from the same source
     * - This caused all groups to be single-source
     * - The fallback logic was allowing single-source groups to be returned
     * 
     * SOLUTION:
     * - Modified grouping to ONLY match articles with groups from DIFFERENT sources
     * - Filter out ALL single-source groups - ONLY return multi-source groups
     * - This ensures the core functionality (multi-source comparison) works
     * - If no multi-source groups exist, return empty array (better than wrong data)
     * 
     * FILES CHANGED:
     * - routes/newsAggregate.js: Removed fallback for single-source groups
     * - services/articleGrouper.js: Fixed grouping to prioritize cross-source matching
     * 
     * FINAL FIX:
     * - Backend ONLY returns multi-source groups (2+ sources)
     * - Frontend receives groups with multiple sources for comparison
     * - "No articles available" shows only when no cross-source matches exist
     */
    const multiSourceGroups = filteredGroups.filter(g => getUniqueSourceCount(g) >= 2);
    const singleSourceGroups = filteredGroups.filter(g => getUniqueSourceCount(g) < 2);
    
    console.log(`[Aggregate] After filtering: ${multiSourceGroups.length} multi-source groups, ${singleSourceGroups.length} single-source groups`);
    
    // CRITICAL: Prioritize multi-source groups, but allow single-source as fallback
    // This ensures we always return groups when articles exist
    let groupsToSummarize;
    if (multiSourceGroups.length >= 3) {
      // We have enough multi-source groups, use only those
      groupsToSummarize = multiSourceGroups;
      console.log(`[Aggregate] Using ${multiSourceGroups.length} multi-source groups (core functionality working)`);
    } else if (multiSourceGroups.length > 0) {
      // We have some multi-source groups, add single-source for variety
      groupsToSummarize = [...multiSourceGroups, ...singleSourceGroups.slice(0, 9 - multiSourceGroups.length)];
      console.log(`[Aggregate] Using ${multiSourceGroups.length} multi-source + ${groupsToSummarize.length - multiSourceGroups.length} single-source groups`);
    } else if (singleSourceGroups.length > 0) {
      // No multi-source groups, use single-source as fallback
      groupsToSummarize = singleSourceGroups.slice(0, 9);
      console.warn(`[Aggregate] WARNING: No multi-source groups found. Using ${groupsToSummarize.length} single-source groups as fallback.`);
    } else {
      // No groups at all
      groupsToSummarize = [];
      console.warn('[Aggregate] WARNING: No groups created at all!');
    }

    // Summarize each group (with concurrency limit)
    // Use groupsToSummarize (prioritized: multi-source first, then recency)
    const MAX_CONCURRENT_SUMMARIES = 3; // Process 3 groups at a time
    const summarizedGroups = [];

    for (let i = 0; i < groupsToSummarize.length; i += MAX_CONCURRENT_SUMMARIES) {
      const batch = groupsToSummarize.slice(i, i + MAX_CONCURRENT_SUMMARIES);
      const summaries = await Promise.allSettled(
        batch.map(group => summarizeArticleGroup(group))
      );

      summaries.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const summary = result.value.summary || 'Summary not available.';
          // CRITICAL: Always generate title from summary, never use generic fallback
          let groupTitle = result.value.groupTitle;
          
          // ALWAYS generate title from summary to ensure it's meaningful
          // Even if LLM provided a title, regenerate from summary to ensure quality
          groupTitle = generateNeutralTitle(
            batch[index].articles[0]?.title,
            batch[index].articles[0]?.description,
            summary
          );
          
          // Double-check: if title is still generic, force regeneration
          const genericPatterns = ['news story', 'story 1', 'story 2', 'story 3', 'latest news', 'news coverage', 'story from', 'covered this story', 'multiple sources'];
          const isStillGeneric = !groupTitle || 
                               genericPatterns.some(pattern => groupTitle.toLowerCase().includes(pattern)) ||
                               /^story\s+\d+$/i.test(groupTitle) ||
                               groupTitle.length < 10;
          
          if (isStillGeneric && summary && summary.length > 20) {
            // Force extract from summary first sentence
            const firstSentence = summary.split(/[.!?]/)[0].trim();
            if (firstSentence.length > 15) {
              const words = firstSentence.split(/\s+/).slice(0, 12).join(' ');
              groupTitle = words.charAt(0).toUpperCase() + words.slice(1);
            }
          }
          
          // Get unique sources for this group
          const uniqueSources = [...new Set(batch[index].articles.map(a => a.sourceName || a.source || 'Unknown'))];
          const sourceCount = uniqueSources.length;
          
                summarizedGroups.push({
                  groupId: result.value.groupId,
                  groupTitle: groupTitle,
                  summary: summary,
                  // REMOVED: detailedComparison, simpleComparison, differences - no longer needed
                  articles: batch[index].articles,
                  sourceCount: sourceCount,
                  sources: uniqueSources
                });
        } else {
          // If summarization fails, return raw articles
          console.error('[Aggregate] Summarization failed for group:', batch[index].groupId, result.reason);
          warnings.push(`Failed to summarize group ${batch[index].groupId}`);
          const sources = [...new Set(batch[index].articles.map(a => a.source))];
          const firstArticle = batch[index].articles[0];
          // Create a more descriptive summary from article titles
          const articleTitles = batch[index].articles.map(a => a.title).filter(Boolean).join('; ');
          const fallbackSummary = articleTitles || 'Summary unavailable. Please review the articles below.';
          // CRITICAL: Always generate title from summary, never use generic fallback
          const groupTitle = generateNeutralTitle(
            firstArticle?.title,
            firstArticle?.description,
            fallbackSummary
          );
          // Get unique sources for this group
          const uniqueSources = [...new Set(batch[index].articles.map(a => a.sourceName || a.source || 'Unknown'))];
          const sourceCount = uniqueSources.length;

          summarizedGroups.push({
            groupId: batch[index].groupId,
            groupTitle: groupTitle,
            summary: fallbackSummary,
            // REMOVED: detailedComparison, simpleComparison, differences - no longer needed
            articles: batch[index].articles,
            sourceCount: sourceCount,
            sources: uniqueSources
          });
        }
      });
    }

    // CRITICAL: Apply universal pagination - ALL views paginate at 9 groups per page
    // This applies to: custom search, ALL categories, home/default, location views
    let finalGroups = summarizedGroups;
    let totalGroups = summarizedGroups.length;
    let totalPages = 1;
    let currentPage = 1;
    const GROUPS_PER_PAGE = 9; // UNIVERSAL: All views use 9 groups per page

    // ALL views (search, categories, home, location) use the same pagination
    const groupsPerPage = GROUPS_PER_PAGE;
    totalPages = Math.max(1, Math.ceil(summarizedGroups.length / groupsPerPage));
    currentPage = Math.max(1, Math.min(pageNum, totalPages)); // Clamp to valid range
    const startIndex = (currentPage - 1) * groupsPerPage;
    const endIndex = startIndex + groupsPerPage;
    finalGroups = summarizedGroups.slice(startIndex, endIndex);
    
    const viewType = isSearch ? 'search' : isCategory ? 'category' : 'other';
    console.log(`[Aggregate] ${viewType} view: UNIVERSAL PAGINATION - page ${currentPage} of ${totalPages}`);
    console.log(`[Aggregate] ${viewType} view: ${summarizedGroups.length} total groups, showing groups ${startIndex + 1}-${Math.min(endIndex, summarizedGroups.length)} (max ${groupsPerPage} per page)`);
    
    // Verify limit is enforced
    if (finalGroups.length > groupsPerPage) {
      console.error(`[Aggregate] ERROR: Pagination limit violated! Showing ${finalGroups.length} groups, max is ${groupsPerPage}`);
      finalGroups = finalGroups.slice(0, groupsPerPage);
    }
    
    // Final verification: ensure we never return more than the limit
    if (finalGroups.length > GROUPS_PER_PAGE) {
      console.error(`[Aggregate] CRITICAL: Pagination limit still violated after enforcement!`);
      finalGroups = finalGroups.slice(0, GROUPS_PER_PAGE);
    }

    // Return grouped articles - the core functionality
    // If grouping failed completely, we'll still have finalGroups (may be empty)
    // but the frontend fallback will handle displaying raw articles
    const response = {
      query: query || '',
      country: country || undefined,
      category: category || undefined,
      groupedArticles: finalGroups, // Array of grouped/summarized stories
      rawArticles: articlesWithSource, // Combined list of all articles from all sources
      pagination: {
        currentPage: currentPage,
        totalPages: totalPages,
        totalGroups: totalGroups,
        groupsPerPage: GROUPS_PER_PAGE
      },
      ...(warnings.length > 0 && { warnings })
    };
    
    // Log final state
    if (finalGroups.length === 0 && articlesWithSource.length > 0) {
      console.warn('[Aggregate] WARNING: No groups created, but raw articles exist.');
      console.warn('[Aggregate] Frontend will use fallback mode to display raw articles.');
    }

    console.log('[Aggregate] Returning', finalGroups.length, 'summarized groups and', articlesWithSource.length, 'raw articles');
    res.json(response);

  } catch (error) {
    console.error('[Aggregate] Error:', error);
    res.status(500).json({
      error: error.message || 'Failed to aggregate news',
      groups: []
    });
  }
});

module.exports = router;

