/**
 * Twitter API utility module for posting insights
 * Uses twitter-api-v2 library for robust Twitter API integration
 */

import { TwitterApi } from 'twitter-api-v2';
import { getTwitterCredentials, getAvailableTwitterAccounts, config } from './config.js';
import { addProcessedInsight } from './cache.js';
import { readRateLimitCache, checkCachedRateLimit, cacheRateLimitError } from './rate-limit-cache.js';

// Track current account index for fallback
let currentAccountIndex = 0;

/**
 * Attempts to switch to next available Twitter account
 * @returns {boolean} True if fallback account is available, false if no more accounts
 */
function switchToFallbackAccount() {
    const availableAccounts = getAvailableTwitterAccounts();
    const nextIndex = currentAccountIndex + 1;
    
    if (nextIndex < availableAccounts.length) {
        currentAccountIndex = nextIndex;
        console.log(`🔄 Switching to fallback account: ${availableAccounts[currentAccountIndex].name}`);
        return true;
    }
    
    console.log('❌ No more fallback accounts available');
    return false;
}

/**
 * Resets account index to primary account
 */
function resetToFrimaryAccount() {
    currentAccountIndex = 0;
    const availableAccounts = getAvailableTwitterAccounts();
    if (availableAccounts.length > 0) {
        console.log(`🔄 Reset to primary account: ${availableAccounts[0].name}`);
    }
}

/**
 * Creates and configures Twitter API client
 * @param {number} accountIndex - Index of account to use (for fallback)
 * @returns {TwitterApi} Configured Twitter API client
 */
function createTwitterClient(accountIndex = currentAccountIndex) {
    const credentials = getTwitterCredentials(accountIndex);
    
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessTokenSecret) {
        throw new Error(`Twitter API credentials not configured for account: ${credentials.accountName || 'unknown'}`);
    }

    console.log(`🔐 Using Twitter account: ${credentials.accountName} (index: ${accountIndex})`);

    return new TwitterApi({
        appKey: credentials.apiKey,
        appSecret: credentials.apiSecret,
        accessToken: credentials.accessToken,
        accessSecret: credentials.accessTokenSecret,
    });
}

/**
 * Checks Twitter API rate limits with intelligent caching
 * Uses cached rate limit data to avoid repeated API calls when rate limited
 */
export async function checkTwitterRateLimit() {
    try {
        console.log('🔍 Checking Twitter rate limit status...');
        
        // First check if we have cached rate limit data
        const cachedRateLimit = readRateLimitCache();
        if (cachedRateLimit) {
            console.log('📋 Found cached rate limit data');
            const cacheStatus = checkCachedRateLimit(cachedRateLimit);
            
            if (cacheStatus.isRateLimited) {
                console.error(`🛑 CACHED RATE LIMIT ACTIVE - ${cacheStatus.message}`);
                return {
                    canPost: false,
                    message: cacheStatus.message,
                    cached: true,
                    resetTime: cacheStatus.resetTime,
                    timeRemaining: cacheStatus.timeRemaining
                };
            } else if (cacheStatus.expired) {
                console.log('✅ Cached rate limit has expired - proceeding with fresh check');
            }
        }
        
        // Proceed with authentication and basic API check
        const client = createTwitterClient();
        console.log('🔐 Verifying Twitter authentication...');
        
        const userResponse = await client.v2.me();
        const username = userResponse.data.username;
        console.log(`✅ Authenticated as @${username}`);
        
        // Try to get app-level rate limit status
        try {
            const rateLimitResponse = await client.v1.get('application/rate_limit_status.json');
            console.log('📊 Retrieved app-level rate limit status');
            
            // Check posting endpoint limits
            const statusResources = rateLimitResponse.resources?.statuses;
            if (statusResources) {
                const updateLimit = statusResources['/statuses/update'];
                if (updateLimit && updateLimit.remaining === 0) {
                    const resetTime = new Date(updateLimit.reset * 1000);
                    const timeUntilReset = updateLimit.reset - Math.floor(Date.now() / 1000);
                    const hours = Math.floor(timeUntilReset / 3600);
                    const minutes = Math.floor((timeUntilReset % 3600) / 60);
                    
                    console.error(`🛑 App-level posting rate limit exhausted`);
                    console.error(`⏰ Resets in: ${hours}h ${minutes}m at ${resetTime.toLocaleString()}`);
                    
                    // Cache this rate limit
                    const rateLimitData = {
                        error: true,
                        limitType: 'app-posting',
                        resetTimestamp: updateLimit.reset,
                        details: {
                            remaining: updateLimit.remaining,
                            limit: updateLimit.limit,
                            type: 'App-level posting limit'
                        }
                    };
                    
                    cacheRateLimitError({ rateLimit: { reset: updateLimit.reset, remaining: 0, limit: updateLimit.limit }, message: 'App posting limit exceeded' });
                    
                    return {
                        canPost: false,
                        message: `App posting limit exhausted. Resets in ${hours}h ${minutes}m`,
                        resetTime: resetTime.toISOString(),
                        rateLimitType: 'app-posting'
                    };
                }
                
                if (updateLimit) {
                    console.log(`📝 App posting limit: ${updateLimit.remaining}/${updateLimit.limit} remaining`);
                }
            }
        } catch (rateLimitCheckError) {
            console.warn('⚠️ Could not check app-level rate limits:', rateLimitCheckError.message);
        }
        
        console.log('✅ Pre-flight checks passed');
        console.log('ℹ️ User daily limits (17 tweets/day) will be checked during first posting attempt');
        
        return {
            canPost: true,
            message: `Authentication and app-level checks OK for @${username}`,
            username: username,
            note: 'User daily limits will be detected on first post attempt'
        };
        
    } catch (error) {
        console.error('❌ Twitter rate limit check failed:', error.message);
        
        if (error.code === 401) {
            return {
                canPost: false,
                message: 'Authentication failed - check Twitter API credentials',
                error: error.message
            };
        }
        
        if (error.code === 429) {
            console.error('🛑 Rate limit detected during pre-flight check');
            
            // Cache this rate limit error
            const cachedData = cacheRateLimitError(error);
            if (cachedData) {
                const timeUntilReset = cachedData.resetTimestamp - Math.floor(Date.now() / 1000);
                const hours = Math.floor(timeUntilReset / 3600);
                const minutes = Math.floor((timeUntilReset % 3600) / 60);
                
                return {
                    canPost: false,
                    message: `Rate limit during authentication. Resets in ${hours}h ${minutes}m`,
                    cached: true,
                    resetTime: new Date(cachedData.resetTimestamp * 1000).toISOString()
                };
            }
            
            return {
                canPost: false,
                message: 'Rate limit detected during authentication check',
                error: error.message
            };
        }
        
        return {
            canPost: true,
            message: `Pre-flight check failed: ${error.message} - proceeding with caution`,
            error: error.message
        };
    }
}

/**
 * Posts a text-only tweet to Twitter
 * @param {string} text - The tweet text content
 * @returns {Promise<Object>} Twitter API response
 */
export async function postTweet(text) {
    try {
        const client = createTwitterClient();
        const tweet = await client.v2.tweet(text);
        console.log('Tweet posted successfully:', tweet.data.id);
        return tweet;
    } catch (error) {
        console.error('Error posting tweet:', error);
        throw error;
    }
}

/**
 * Posts a tweet with media (image) to Twitter
 * @param {string} text - The tweet text content
 * @param {Buffer} imageBuffer - The image buffer to upload
 * @returns {Promise<Object>} Twitter API response
 */
export async function postTweetWithMedia(text, imageBuffer) {
    try {
        const client = createTwitterClient();
        
        console.log('Uploading media to Twitter...');
        
        // Upload media using the library's built-in method
        const mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: 'image/png' });
        console.log('Media uploaded successfully, ID:', mediaId);
        
        // Post tweet with media - ensure media ID is a string
        const tweet = await client.v2.tweet({
            text: text,
            media: { media_ids: [String(mediaId)] }
        });
        
        console.log('Tweet with media posted successfully:', tweet.data.id);
        return tweet;
    } catch (error) {
        console.error('Error posting tweet with media:', error);
        throw error;
    }
}

/**
 * Sends an insight to Twitter with automatic fallback account support
 * @param {Object} insight - The insight object containing title, summary, and image data
 * @param {Buffer|null} imageBuffer - The image buffer (if images are enabled)
 * @param {Object} config - Configuration object
 * @returns {Promise<string>} Tweet URL
 */
export async function sendInsightToTwitter(insight, imageBuffer, config) {
    const maxRetries = config.twitter.enableFallback ? getAvailableTwitterAccounts().length : 1;
    let lastError = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.log(`📝 Attempt ${attempt + 1}/${maxRetries} to post insight ${insight.id}`);
            
            // Format the tweet text
            const insightUrl = `${config.insights.baseUrl}${insight.id}`;
            const insightText = formatInsightForTwitter(insight, insightUrl);
            
            let response;
            
            if (config.twitter.postImages && imageBuffer) {
                console.log(`Sending tweet with image for insight ${insight.id}`);
                response = await postTweetWithMedia(insightText, imageBuffer);
            } else {
                console.log(`Sending text-only tweet for insight ${insight.id}`);
                response = await postTweet(insightText);
            }
            
            // Extract tweet URL from response
            const tweetId = response.data.id;
            const tweetUrl = `https://twitter.com/i/web/status/${tweetId}`;
            
            const credentials = getTwitterCredentials(currentAccountIndex);
            console.log(`✅ Posted to Twitter (${credentials.accountName}): ${tweetUrl}`);
            
            // Add to cache with platform information
            const platformResponse = {
                platform: 'twitter',
                url: tweetUrl,
                id: tweetId,
                timestamp: new Date().toISOString(),
                accountUsed: credentials.accountName
            };
            
            addProcessedInsight(insight.id, {}, platformResponse);
            
            // Reset to primary account after successful post
            if (attempt > 0) {
                resetToFrimaryAccount();
            }
            
            return tweetUrl;
            
        } catch (error) {
            console.error(`❌ Failed to post insight ${insight.id} to Twitter (attempt ${attempt + 1}):`, error.message);
            lastError = error;
            
            // Check for rate limit and cache it
            if (error.code === 429) {
                console.error(`🛑 Rate limit hit on account: ${getTwitterCredentials(currentAccountIndex).accountName}`);
                cacheRateLimitError(error);
                
                // Try fallback account if enabled and available
                if (config.twitter.enableFallback && attempt < maxRetries - 1) {
                    if (switchToFallbackAccount()) {
                        console.log(`🔄 Retrying with fallback account...`);
                        continue;
                    }
                }
                
                // If no fallback available or fallback disabled, re-throw error
                throw error;
            }
            
            // For non-rate-limit errors, don't retry with fallback
            if (attempt === 0 && config.twitter.enableFallback) {
                console.warn(`⚠️ Non-rate-limit error on primary account, not trying fallback for: ${error.message}`);
            }
            throw error;
        }
    }
    
    // If we get here, all attempts failed
    throw new Error(`All Twitter accounts failed to post insight. Last error: ${lastError?.message}`);
}

/**
 * Formats insight text for Twitter (280 character limit)
 * @param {Object} insight - The insight object
 * @param {string} insightUrl - The URL to the insight
 * @returns {string} Formatted tweet text
 */
export function formatInsightForTwitter(insight, insightUrl) {
    const maxLength = 280;
    const urlLength = 24; // Twitter's t.co URL length + space
    const availableLength = maxLength - urlLength;
    
    // Use headline if available, fallback to title
    let text = insight.headline || insight.title || 'New insight available';
    
    // If text is too long, truncate it
    if (text.length > availableLength) {
        text = text.substring(0, availableLength - 3) + '...';
    }
    
    // Return clean URL without zero-width characters (custom images prevent link preview anyway)
    return `${text} ${insightUrl}`;
}