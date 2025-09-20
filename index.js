/**
 * Polaris Insights Bot - Multi-Platform Version
 * Fetches insights from Polaris API and sends them to Telegram or Twitter with custom images
 * @author jasbanza
 * @version 4.0.0
 */

import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors";
import { config, getChatId, getTwitterCredentials } from './utils/config.js';
import { readCache, writeCache, isInsightProcessed, addProcessedInsight } from './utils/cache.js';
import { sendTextMessage, sendPhotoMessage } from './utils/telegram.js';
import { sendInsightToTwitter, checkTwitterRateLimit } from './utils/twitter.js';
import { getImageForInsight } from './utils/image.js';

const out = new ConsoleLogColors();

async function main() {
    try {
        validateConfig();
        logConfiguration();
        await processNewPublishedInsights();
        out.success('Finished processing insights');
    } catch (error) {
        out.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

function validateConfig() {
    out.info(`Platform mode: ${config.platform.mode.toUpperCase()}`);
    
    if (config.platform.mode === 'telegram') {
        if (!config.telegram.token) {
            throw new Error('Missing TELEGRAM_TOKEN for Telegram mode');
        }
        const chatId = getChatId(); // This will throw if misconfigured
        out.info(`Using chat ID: ${chatId} (${config.telegram.testMode ? 'TEST' : 'PROD'})`);
    } else if (config.platform.mode === 'twitter') {
        const credentials = getTwitterCredentials();
        if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessTokenSecret) {
            throw new Error('Missing Twitter API credentials for Twitter mode');
        }
        out.info(`Twitter configured - Images: ${config.twitter.postImages ? 'enabled' : 'disabled'} (${config.twitter.testMode ? 'TEST' : 'PROD'})`);
    } else {
        throw new Error(`Invalid PLATFORM_MODE: ${config.platform.mode}. Must be 'telegram' or 'twitter'`);
    }
}

function logConfiguration() {
    if (config.platform.mode === 'telegram' && config.telegram.testMode) {
        out.warn(`🧪 TEST MODE - Messages sent to: ${config.telegram.testChatId}`);
    } else if (config.platform.mode === 'twitter' && config.twitter.testMode) {
        out.warn(`🧪 TEST MODE - Using test Twitter credentials`);
    }
    
    out.info(`Processing up to ${config.insights.limit} insights`);
    out.info(`Minimum age: ${config.insights.minimumAgeMinutes} minutes`);
    
    if (config.platform.mode === 'telegram') {
        out.info(`Overlays - Polaris: ${config.insights.doPolarisLogo}, Tokens: ${config.insights.doTokenLogo}, Circular tokens: ${config.insights.circularClipTokenLogo}`);
    } else if (config.platform.mode === 'twitter') {
        out.info(`Twitter images: ${config.twitter.postImages ? 'enabled' : 'disabled'}`);
        out.info(`Overlays - Polaris: ${config.insights.doPolarisLogo}, Tokens: ${config.insights.doTokenLogo}, Circular tokens: ${config.insights.circularClipTokenLogo}`);
    }
}

async function processNewPublishedInsights() {
    const url = `${config.polaris.apiUrl}/ai/curated-insights?_sort=publishedAt&_order=desc&_end=${config.insights.limit}`;
    out.info(`Fetching insights from: ${url}`);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    const insights = await response.json();
    if (!insights?.length) {
        out.warn('No insights available');
        return;
    }

    const eligibleInsights = filterEligibleInsights(insights.reverse());
    out.info(`${eligibleInsights.length} of ${insights.length} insights eligible for processing`);

    // Check Twitter rate limits before processing if using Twitter platform
    if (config.platform.mode === 'twitter') {
        out.info('Checking Twitter rate limits before processing...');
        const rateLimitCheck = await checkTwitterRateLimit();
        
        if (!rateLimitCheck.canPost) {
            out.error(`🛑 TWITTER RATE LIMIT EXCEEDED - ${rateLimitCheck.message}`);
            out.warn('Stopping execution to avoid API violations');
            process.exit(1);
        }
        
        out.success(`✅ Twitter rate limits OK - proceeding with ${eligibleInsights.length} insights`);
        if (rateLimitCheck.tweetLimits) {
            out.info(`Tweet limit: ${rateLimitCheck.tweetLimits.remaining}/${rateLimitCheck.tweetLimits.limit} remaining`);
        }
    }

    for (const insight of eligibleInsights) {
        try {
            if (isInsightProcessed(insight.id)) {
                out.info(`Insight ${insight.id} already processed, skipping`);
                continue;
            }

            if (isInsightTooOld(insight)) {
                continue;
            }

            out.info(`Processing insight: ${insight.id}`);
            
            const platformResponse = await sendMessage(insight);
            if (config.platform.mode === 'telegram' && !platformResponse?.ok) {
                throw new Error(`Message failed: ${platformResponse?.description || 'Unknown error'}`);
            } else if (config.platform.mode === 'twitter' && !platformResponse?.data) {
                throw new Error(`Tweet failed: ${platformResponse?.error || 'Unknown error'}`);
            }

            out.success(`Message sent for insight ${insight.id}`);
            
            // Update caches with platform response
            addProcessedInsight(insight.id, extractBackgroundMetadata(insight), platformResponse);
            writeCache({
                id: insight.id,
                publishedAt: insight.publishedAt,
                sentAt: new Date().toISOString()
            }, config.cache.filename);

            // Rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            // Check for rate limit errors (HTTP 429) and exit immediately
            if (error.message.includes('429') || error.code === 429 || (error.error && error.code === 429)) {
                out.error(`🛑 RATE LIMIT HIT (429) - Stopping execution immediately to avoid further API violations`);
                out.warn(`Rate limit details: ${error.message}`);
                if (error.rateLimit) {
                    out.warn(`Rate limit info: ${JSON.stringify(error.rateLimit)}`);
                }
                
                // Ensure rate limit caching completes before exit
                try {
                    // Import and cache the rate limit error if not already done
                    const { cacheRateLimitError } = await import('./utils/rate-limit-cache.js');
                    if (error.rateLimit) {
                        cacheRateLimitError(error);
                        out.info('💾 Rate limit cached before exit');
                    }
                } catch (cacheError) {
                    out.warn(`Failed to cache rate limit: ${cacheError.message}`);
                }
                
                process.exit(1);
            }
            
            out.error(`Error processing insight ${insight.id}: ${error.message}`);
            continue;
        }
    }
}

function filterEligibleInsights(insights) {
    const now = new Date();
    const minAgeMs = config.insights.minimumAgeMinutes * 60 * 1000;
    
    return insights.filter(insight => {
        const publishedAt = new Date(insight.publishedAt);
        const ageMs = now.getTime() - publishedAt.getTime();
        const isOldEnough = ageMs >= minAgeMs;
        
        if (!isOldEnough) {
            const ageMinutes = Math.floor(ageMs / (60 * 1000));
            out.info(`Insight ${insight.id} too recent (${ageMinutes}min), skipping`);
        }
        
        return isOldEnough;
    });
}

function isInsightTooOld(insight) {
    const cacheData = readCache(config.cache.filename);
    if (cacheData?.publishedAt) {
        const cachedDate = new Date(cacheData.publishedAt);
        const insightDate = new Date(insight.publishedAt);
        
        if (insightDate < cachedDate) {
            out.info(`Insight ${insight.id} older than cache, skipping`);
            return true;
        }
    }
    return false;
}

function extractBackgroundMetadata(insight) {
    const metadata = {};
    if (insight.backgroundType && insight.backgroundValue) {
        metadata.backgroundType = insight.backgroundType;
        metadata.backgroundValue = insight.backgroundValue;
    }
    return metadata;
}

async function sendMessage(insight) {
    try {
        if (config.platform.mode === 'telegram') {
            return await sendTelegramMessage(insight);
        } else if (config.platform.mode === 'twitter') {
            return await sendTwitterMessage(insight);
        } else {
            throw new Error(`Unsupported platform mode: ${config.platform.mode}`);
        }
    } catch (error) {
        out.error(`Error sending message: ${error.message}`);
        
        // Fallback handling by platform
        if (config.platform.mode === 'telegram') {
            out.warn(`Falling back to text message for insight ${insight.id}`);
            return await sendTextMessage({ insight });
        } else {
            throw error; // Re-throw for Twitter as there's no fallback
        }
    }
}

async function sendTelegramMessage(insight) {
    const imageData = await getImageForInsight(insight);
    
    if (imageData) {
        if (typeof imageData === 'string') {
            out.info(`Sending photo with URL for insight ${insight.id}`);
            return await sendPhotoMessage({ insight, imageUrl: imageData });
        } else if (Buffer.isBuffer(imageData)) {
            out.info(`Sending photo with buffer for insight ${insight.id}`);
            return await sendPhotoMessage({ insight, imageBuffer: imageData });
        }
    }
    
    out.info(`Sending text message for insight ${insight.id}`);
    return await sendTextMessage({ insight });
}

async function sendTwitterMessage(insight) {
    let imageBuffer = null;
    
    if (config.twitter.postImages) {
        const imageData = await getImageForInsight(insight);
        if (Buffer.isBuffer(imageData)) {
            imageBuffer = imageData;
            out.info(`Sending tweet with image for insight ${insight.id}`);
        } else {
            out.info(`Sending text-only tweet for insight ${insight.id}`);
        }
    } else {
        out.info(`Sending text-only tweet for insight ${insight.id} (images disabled)`);
    }
    
    return await sendInsightToTwitter(insight, imageBuffer, config);
}

// Start the bot
main();