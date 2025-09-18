import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isTestMode = process.env.TEST_MODE === 'true';
const platformMode = process.env.PLATFORM_MODE || 'telegram';

export const config = {
    platform: {
        mode: platformMode // 'telegram' or 'twitter'
    },
    
    polaris: {
        apiUrl: process.env.POLARIS_API_URL || 'https://api.polaris.app',
        insightsUrl: process.env.POLARIS_INSIGHTS_URL || 'https://beta.polaris.app/insights/'
    },
    
    telegram: {
        token: process.env.TELEGRAM_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
        testChatId: process.env.TELEGRAM_TEST_CHAT_ID,
        testMode: isTestMode,
        disableWebPagePreview: process.env.TELEGRAM_DISABLE_WEB_PAGE_PREVIEW === 'true'
    },
    
    twitter: {
        apiKey: process.env.TWITTER_API_KEY,
        apiSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
        testApiKey: process.env.TWITTER_TEST_API_KEY,
        testApiSecret: process.env.TWITTER_TEST_API_SECRET,
        testAccessToken: process.env.TWITTER_TEST_ACCESS_TOKEN,
        testAccessTokenSecret: process.env.TWITTER_TEST_ACCESS_TOKEN_SECRET,
        testMode: isTestMode,
        postImages: process.env.TWITTER_POST_IMAGES === 'true'
    },
    
    cache: {
        filename: path.join(__dirname, '..', isTestMode ? 'test_latest_insight.cache.json' : 'latest_insight.cache.json'),
        processedIdsFilename: path.join(__dirname, '..', isTestMode ? 'test_processed_insights.cache.json' : 'processed_insights.cache.json'),
        maxProcessedIds: parseInt(process.env.MAX_PROCESSED_IDS) || 200
    },
    
    insights: {
        limit: parseInt(process.env.INSIGHTS_LIMIT) || 7,
        minimumAgeMinutes: parseInt(process.env.MINIMUM_AGE_MINUTES) || 10,
        defaultBackgroundColor: process.env.DEFAULT_BACKGROUND_COLOR || 'gray-900',
        baseUrl: process.env.POLARIS_INSIGHTS_URL || 'https://beta.polaris.app/insights/',
        polarisLogoPath: path.join(__dirname, '..', 'assets', 'circle.png'),
        scaleForegroundImage: parseFloat(process.env.SCALE_FOREGROUND_IMAGE) || 0.8,
        doPolarisLogo: process.env.OVERLAY_POLARIS_LOGO === 'true',
        doTokenLogo: process.env.OVERLAY_TOKEN_LOGO === 'true',
        circularClipTokenLogo: process.env.CIRCULAR_CLIP_TOKEN_LOGO === 'true'
    }
};

export function getChatId() {
    if (config.telegram.testMode) {
        if (!config.telegram.testChatId) {
            throw new Error('TEST_MODE is enabled but TELEGRAM_TEST_CHAT_ID is not configured');
        }
        return config.telegram.testChatId;
    } else {
        if (!config.telegram.chatId) {
            throw new Error('TELEGRAM_CHAT_ID is not configured');
        }
        return config.telegram.chatId;
    }
}

export function getTwitterCredentials() {
    if (config.twitter.testMode) {
        return {
            apiKey: config.twitter.testApiKey || config.twitter.apiKey,
            apiSecret: config.twitter.testApiSecret || config.twitter.apiSecret,
            accessToken: config.twitter.testAccessToken || config.twitter.accessToken,
            accessTokenSecret: config.twitter.testAccessTokenSecret || config.twitter.accessTokenSecret
        };
    } else {
        return {
            apiKey: config.twitter.apiKey,
            apiSecret: config.twitter.apiSecret,
            accessToken: config.twitter.accessToken,
            accessTokenSecret: config.twitter.accessTokenSecret
        };
    }
}

export function addTestModePrefix(message) {
    if (config.platform.mode === 'telegram') {
        return config.telegram.testMode ? `🧪 [TEST] ${message}` : message;
    } else if (config.platform.mode === 'twitter') {
        // Don't prefix test mode for Twitter posts
        return message;
    }
    return message;
}

export function isValidUrl(string) {
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}