import fs from 'fs';
import { ConsoleLogColors } from "js-console-log-colors";
import { config } from './config.js';

const out = new ConsoleLogColors();

export function readCache(filename) {
    try {
        if (!fs.existsSync(filename)) {
            return {};
        }
        const data = fs.readFileSync(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        out.warn(`Error reading cache (${filename}): ${error.message}`);
        return {};
    }
}

export function writeCache(data, filename) {
    try {
        fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    } catch (error) {
        out.error(`Error writing cache: ${error.message}`);
    }
}

export function readProcessedIds() {
    try {
        const data = readCache(config.cache.processedIdsFilename);
        return Array.isArray(data.processedIds) ? data.processedIds : [];
    } catch (error) {
        return [];
    }
}

export function writeProcessedIds(processedIds) {
    const boundedIds = processedIds.slice(-config.cache.maxProcessedIds);
    writeCache({
        processedIds: boundedIds,
        lastUpdated: new Date().toISOString(),
        totalCount: boundedIds.length
    }, config.cache.processedIdsFilename);
}

export function isInsightProcessed(insightId) {
    const processedInsights = readProcessedIds();
    return processedInsights.some(item => 
        typeof item === 'string' ? item === insightId : item.id === insightId
    );
}

export function addProcessedInsight(insightId, metadata = {}, platformResponse = null) {
    const processedInsights = readProcessedIds();
    const existingIndex = processedInsights.findIndex(item => 
        typeof item === 'string' ? item === insightId : item.id === insightId
    );
    
    if (existingIndex === -1) {
        const insightData = {
            id: insightId,
            processedAt: new Date().toISOString(),
            platform: config.platform.mode,
            testMode: config.platform.mode === 'telegram' ? config.telegram.testMode : config.twitter.testMode,
            ...metadata
        };
        
        // Add platform-specific response data
        if (platformResponse) {
            if (config.platform.mode === 'twitter' && platformResponse.tweetUrl) {
                insightData.tweetUrl = platformResponse.tweetUrl;
                insightData.tweetId = platformResponse.data?.id;
            } else if (config.platform.mode === 'telegram' && platformResponse.result) {
                insightData.messageId = platformResponse.result.message_id;
                insightData.chatId = platformResponse.result.chat.id;
            }
        }
        
        processedInsights.push(insightData);
        writeProcessedIds(processedInsights);
    }
}