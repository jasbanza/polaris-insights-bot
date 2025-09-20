/**
 * Rate limit caching utility
 * Stores rate limit status to avoid repeated API calls when rate limited
 */

import fs from 'fs';
import path from 'path';
import { config } from './config.js';

/**
 * Get rate limit cache filename based on test mode
 */
function getRateLimitCacheFilename() {
    const prefix = config.telegram.testMode || config.twitter.testMode ? 'test_' : '';
    return `${prefix}rate_limit.cache.json`;
}

/**
 * Read rate limit cache from file
 */
export function readRateLimitCache() {
    try {
        const filename = getRateLimitCacheFilename();
        if (!fs.existsSync(filename)) {
            return null;
        }

        const data = fs.readFileSync(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.warn('Failed to read rate limit cache:', error.message);
        return null;
    }
}

/**
 * Write rate limit cache to file
 */
export function writeRateLimitCache(rateLimitData) {
    try {
        const filename = getRateLimitCacheFilename();
        const cacheData = {
            ...rateLimitData,
            cachedAt: new Date().toISOString(),
            platform: config.platform.mode
        };

        fs.writeFileSync(filename, JSON.stringify(cacheData, null, 2));
        console.log(`💾 Rate limit status cached to ${filename}`);
    } catch (error) {
        console.error('Failed to write rate limit cache:', error.message);
    }
}

/**
 * Check if cached rate limit is still active
 * @param {Object} cachedData - Cached rate limit data
 * @returns {Object} Status of cached rate limit
 */
export function checkCachedRateLimit(cachedData) {
    if (!cachedData || !cachedData.resetTimestamp) {
        return { isRateLimited: false, message: 'No cached rate limit data' };
    }

    const now = Math.floor(Date.now() / 1000); // Current time in Unix timestamp
    const resetTime = cachedData.resetTimestamp;
    const timeRemaining = resetTime - now;

    if (timeRemaining <= 0) {
        console.log('✅ Cached rate limit has expired - proceeding');
        return { 
            isRateLimited: false, 
            message: 'Cached rate limit expired',
            expired: true
        };
    }

    // Rate limit is still active
    const remainingHours = Math.floor(timeRemaining / 3600);
    const remainingMinutes = Math.floor((timeRemaining % 3600) / 60);
    const remainingSeconds = timeRemaining % 60;

    let timeString = '';
    if (remainingHours > 0) {
        timeString = `${remainingHours}h ${remainingMinutes}m ${remainingSeconds}s`;
    } else if (remainingMinutes > 0) {
        timeString = `${remainingMinutes}m ${remainingSeconds}s`;
    } else {
        timeString = `${remainingSeconds}s`;
    }

    const resetDate = new Date(resetTime * 1000);
    const message = `Rate limit active. ${timeString} remaining (resets at ${resetDate.toLocaleString()})`;

    return {
        isRateLimited: true,
        message: message,
        timeRemaining: timeRemaining,
        resetTime: resetDate.toISOString(),
        cachedData: cachedData
    };
}

/**
 * Cache a rate limit error for future reference
 * @param {Object} error - Rate limit error object
 */
export function cacheRateLimitError(error) {
    let resetTimestamp = null;
    let limitType = 'unknown';
    let details = {};

    // Extract rate limit info from error
    if (error.rateLimit) {
        const rl = error.rateLimit;
        
        // Check user daily limit first (most common)
        if (rl.userDay && rl.userDay.remaining === 0) {
            resetTimestamp = rl.userDay.reset;
            limitType = 'user-daily';
            details = {
                remaining: rl.userDay.remaining,
                limit: rl.userDay.limit,
                type: 'User daily limit (tweets per day)'
            };
        }
        // Check app daily limit
        else if (rl.day && rl.day.remaining === 0) {
            resetTimestamp = rl.day.reset;
            limitType = 'app-daily';
            details = {
                remaining: rl.day.remaining,
                limit: rl.day.limit,
                type: 'App daily limit'
            };
        }
        // Check general rate limit
        else if (rl.remaining === 0) {
            resetTimestamp = rl.reset;
            limitType = 'general';
            details = {
                remaining: rl.remaining,
                limit: rl.limit,
                type: 'General rate limit'
            };
        }
    }

    if (resetTimestamp) {
        const rateLimitData = {
            error: true,
            limitType: limitType,
            resetTimestamp: resetTimestamp,
            details: details,
            errorMessage: error.message,
            detectedAt: new Date().toISOString()
        };

        writeRateLimitCache(rateLimitData);
        
        const resetDate = new Date(resetTimestamp * 1000);
        const timeUntilReset = resetTimestamp - Math.floor(Date.now() / 1000);
        const hours = Math.floor(timeUntilReset / 3600);
        const minutes = Math.floor((timeUntilReset % 3600) / 60);
        
        console.log(`🛑 Rate limit cached: ${limitType} (${details.type})`);
        console.log(`⏰ Resets in: ${hours}h ${minutes}m at ${resetDate.toLocaleString()}`);
        
        return rateLimitData;
    }

    return null;
}

/**
 * Clear rate limit cache (for manual reset or testing)
 */
export function clearRateLimitCache() {
    try {
        const filename = getRateLimitCacheFilename();
        if (fs.existsSync(filename)) {
            fs.unlinkSync(filename);
            console.log(`🗑️ Rate limit cache cleared: ${filename}`);
        }
    } catch (error) {
        console.error('Failed to clear rate limit cache:', error.message);
    }
}