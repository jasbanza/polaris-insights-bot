/**
 * Cache Pre-seeding Utility
 * Pre-populates the cache with current insights to prevent posting old content on production deploy
 * @author jasbanza
 */

import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors";
import { config } from './config.js';
import { addProcessedInsight, readProcessedIds, writeProcessedIds } from './cache.js';

const out = new ConsoleLogColors();

/**
 * Pre-seeds the cache with current insights to prevent posting old content
 * @param {number} limit - Number of insights to fetch and pre-seed (default: 50)
 * @param {boolean} dryRun - If true, shows what would be pre-seeded without actually doing it
 */
async function preseedProductionCache(limit = 50, dryRun = false) {
    try {
        const mode = config.platform.mode.toUpperCase();
        const testMode = config.telegram?.testMode || config.twitter?.testMode || false;
        const cacheFile = testMode ? 'test_processed_insights.cache.json' : 'processed_insights.cache.json';
        
        out.info(`🌱 Pre-seeding ${mode} cache (${testMode ? 'TEST' : 'PRODUCTION'} mode)`);
        out.info(`📁 Cache file: ${cacheFile}`);
        
        if (dryRun) {
            out.warn(`🔍 DRY RUN MODE - No changes will be made`);
        }
        
        // Fetch current insights
        const url = `${config.polaris.apiUrl}/ai/curated-insights?_sort=publishedAt&_order=desc&_end=${limit}`;
        out.info(`📡 Fetching insights from: ${url}`);
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const insights = await response.json();
        if (!insights?.length) {
            out.warn('⚠️ No insights found to pre-seed');
            return;
        }
        
        out.info(`📊 Found ${insights.length} insights to pre-seed`);
        
        // Get existing processed insights to avoid duplicates
        const existingProcessed = readProcessedIds();
        const existingIds = new Set(existingProcessed.map(item => 
            typeof item === 'string' ? item : item.id
        ));
        
        // Filter out already processed insights
        const newInsights = insights.filter(insight => !existingIds.has(insight.id));
        
        if (newInsights.length === 0) {
            out.success('✅ All fetched insights are already in the cache - no pre-seeding needed');
            return;
        }
        
        out.info(`📝 Pre-seeding ${newInsights.length} new insights (${insights.length - newInsights.length} already in cache)`);
        
        if (dryRun) {
            out.info('🔍 DRY RUN - Would pre-seed these insights:');
            newInsights.forEach((insight, index) => {
                const publishedAt = new Date(insight.publishedAt).toLocaleString();
                out.info(`  ${index + 1}. ${insight.id} - "${insight.headline || insight.title}" (${publishedAt})`);
            });
            return;
        }
        
        // Pre-seed insights into cache
        let preseededCount = 0;
        const preseededAt = new Date().toISOString();
        
        for (const insight of newInsights) {
            const metadata = {
                preseeded: true,
                preseededAt,
                publishedAt: insight.publishedAt,
                title: insight.headline || insight.title,
                note: 'Pre-seeded to prevent posting old insights on production deploy'
            };
            
            // Use a dummy platform response since this wasn't actually posted
            const dummyResponse = {
                preseeded: true,
                reason: 'cache_preseed',
                timestamp: preseededAt
            };
            
            addProcessedInsight(insight.id, metadata, dummyResponse);
            preseededCount++;
            
            const publishedAt = new Date(insight.publishedAt).toLocaleString();
            out.info(`  ✓ Pre-seeded: ${insight.id} - "${insight.headline || insight.title}" (${publishedAt})`);
        }
        
        out.success(`🎉 Successfully pre-seeded ${preseededCount} insights into ${mode} cache`);
        out.info(`📅 Pre-seed timestamp: ${preseededAt}`);
        out.info(`💡 These insights will be skipped during normal processing`);
        
    } catch (error) {
        out.error(`❌ Error pre-seeding cache: ${error.message}`);
        process.exit(1);
    }
}

/**
 * Shows cache statistics
 */
async function showCacheStats() {
    try {
        const testMode = config.telegram?.testMode || config.twitter?.testMode || false;
        const cacheFile = testMode ? 'test_processed_insights.cache.json' : 'processed_insights.cache.json';
        
        out.info(`📊 Cache Statistics (${testMode ? 'TEST' : 'PRODUCTION'} mode)`);
        out.info(`📁 Cache file: ${cacheFile}`);
        
        const processed = readProcessedIds();
        const preseeded = processed.filter(item => 
            typeof item === 'object' && item.preseeded === true
        );
        const naturallyProcessed = processed.filter(item => 
            typeof item === 'string' || item.preseeded !== true
        );
        
        out.info(`📈 Total processed insights: ${processed.length}`);
        out.info(`🌱 Pre-seeded insights: ${preseeded.length}`);
        out.info(`🔄 Naturally processed: ${naturallyProcessed.length}`);
        
        // Find the latest naturally processed insight
        let latestNaturallyProcessed = null;
        if (naturallyProcessed.length > 0) {
            const objectBasedNatural = naturallyProcessed.filter(item => typeof item === 'object');
            if (objectBasedNatural.length > 0) {
                latestNaturallyProcessed = objectBasedNatural.reduce((latest, item) => {
                    const itemDate = new Date(item.publishedAt || item.processedAt);
                    const latestDate = new Date(latest.publishedAt || latest.processedAt);
                    return itemDate > latestDate ? item : latest;
                });
            }
        }
        
        if (latestNaturallyProcessed) {
            const latestNaturalDate = new Date(latestNaturallyProcessed.publishedAt || latestNaturallyProcessed.processedAt);
            out.info(`🕒 Latest naturally processed: ${latestNaturalDate.toLocaleString()}`);
            
            // Count pre-seeded insights that are newer than the latest naturally processed
            const newerPreseeded = preseeded.filter(item => {
                const preseededDate = new Date(item.publishedAt);
                return preseededDate > latestNaturalDate;
            });
            
            out.info(`📊 Pre-seeded insights newer than latest natural: ${newerPreseeded.length}`);
            
            if (newerPreseeded.length > 0) {
                out.info(`💡 These ${newerPreseeded.length} insights would be "new" content if pre-seeding hadn't blocked them`);
            }
        }
        
        if (preseeded.length > 0) {
            const latestPreseed = preseeded.reduce((latest, item) => {
                const itemDate = new Date(item.preseededAt || item.processedAt);
                const latestDate = new Date(latest.preseededAt || latest.processedAt);
                return itemDate > latestDate ? item : latest;
            });
            
            out.info(`🕒 Latest pre-seed timestamp: ${new Date(latestPreseed.preseededAt || latestPreseed.processedAt).toLocaleString()}`);
            
            // Show date range of pre-seeded insights
            if (preseeded.length > 1) {
                const oldestPreseed = preseeded.reduce((oldest, item) => {
                    const itemDate = new Date(item.publishedAt);
                    const oldestDate = new Date(oldest.publishedAt);
                    return itemDate < oldestDate ? item : oldest;
                });
                
                const newestPreseed = preseeded.reduce((newest, item) => {
                    const itemDate = new Date(item.publishedAt);
                    const newestDate = new Date(newest.publishedAt);
                    return itemDate > newestDate ? item : newest;
                });
                
                out.info(`📅 Pre-seeded date range: ${new Date(oldestPreseed.publishedAt).toLocaleDateString()} to ${new Date(newestPreseed.publishedAt).toLocaleDateString()}`);
            }
        }
        
    } catch (error) {
        out.error(`❌ Error reading cache stats: ${error.message}`);
    }
}

// CLI handling
const args = process.argv.slice(2);
const command = args[0];
const options = {
    limit: parseInt(args.find(arg => arg.startsWith('--limit='))?.split('=')[1]) || 50,
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h')
};

if (options.help) {
    console.log(`
Cache Pre-seeding Utility

Usage:
  node utils/preseed-cache.js [command] [options]

Commands:
  preseed     Pre-seed cache with current insights (default)
  stats       Show cache statistics
  help        Show this help message

Options:
  --limit=N   Number of insights to fetch (default: 50)
  --dry-run   Show what would be pre-seeded without making changes
  --help, -h  Show this help message

Examples:
  node utils/preseed-cache.js preseed
  node utils/preseed-cache.js preseed --limit=100
  node utils/preseed-cache.js preseed --dry-run
  node utils/preseed-cache.js stats
`);
    process.exit(0);
}

// Execute command
if (command === 'stats') {
    showCacheStats();
} else {
    // Default to preseed
    preseedProductionCache(options.limit, options.dryRun);
}