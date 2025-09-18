/**
 * Twitter API utility module for posting insights
 * Uses twitter-api-v2 library for robust Twitter API integration
 */

import { TwitterApi } from 'twitter-api-v2';
import { getTwitterCredentials } from './config.js';
import { addProcessedInsight } from './cache.js';

/**
 * Creates and configures Twitter API client
 * @returns {TwitterApi} Configured Twitter API client
 */
function createTwitterClient() {
    const credentials = getTwitterCredentials();
    
    if (!credentials.apiKey || !credentials.apiSecret || !credentials.accessToken || !credentials.accessTokenSecret) {
        throw new Error('Twitter API credentials not configured');
    }

    return new TwitterApi({
        appKey: credentials.apiKey,
        appSecret: credentials.apiSecret,
        accessToken: credentials.accessToken,
        accessSecret: credentials.accessTokenSecret,
    });
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
 * Sends an insight to Twitter (with or without image based on configuration)
 * @param {Object} insight - The insight object containing title, summary, and image data
 * @param {Buffer|null} imageBuffer - The image buffer (if images are enabled)
 * @param {Object} config - Configuration object
 * @returns {Promise<string>} Tweet URL
 */
export async function sendInsightToTwitter(insight, imageBuffer, config) {
    try {
        // Format the tweet text
        const insightUrl = `${config.insightsUrl}${insight.id}`;
        const insightText = formatInsightForTwitter(insight, insightUrl);
        
        let response;
        
        if (config.postImages && imageBuffer) {
            console.log(`Sending tweet with image for insight ${insight.id}`);
            response = await postTweetWithMedia(insightText, imageBuffer);
        } else {
            console.log(`Sending text-only tweet for insight ${insight.id}`);
            response = await postTweet(insightText);
        }
        
        // Extract tweet URL from response
        const tweetId = response.data.id;
        const tweetUrl = `https://twitter.com/i/web/status/${tweetId}`;
        
        console.log(`✅ Posted to Twitter: ${tweetUrl}`);
        
        // Add to cache with platform information
        const platformResponse = {
            platform: 'twitter',
            url: tweetUrl,
            id: tweetId,
            timestamp: new Date().toISOString()
        };
        
        addProcessedInsight(insight.id, platformResponse);
        
        return tweetUrl;
        
    } catch (error) {
        console.error(`❌ Failed to post insight ${insight.id} to Twitter:`, error.message);
        throw new Error(`Twitter API error: ${error.message}`);
    }
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
    
    // Add zero-width character to prevent link preview (custom images already prevent this)
    const urlWithoutPreview = insightUrl.replace('://', '://\u200B');
    
    return `${text} ${urlWithoutPreview}`;
}