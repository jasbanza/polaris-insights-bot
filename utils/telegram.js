import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors";
import { config, getChatId, addTestModePrefix } from './config.js';

const out = new ConsoleLogColors();

export async function sendTextMessage({ insight }) {
    const telegramApiUrl = `https://api.telegram.org/bot${config.telegram.token}/sendMessage`;
    const messageText = addTestModePrefix(`${insight.headline}

[Read more](${config.polaris.insightsUrl}${insight.id})`);

    const response = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: getChatId(),
            text: messageText,
            parse_mode: 'markdown',
            disable_web_page_preview: config.telegram.disableWebPagePreview
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error! status: ${response.status}, response: ${errorText}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
    }

    return data;
}

export async function sendPhotoMessage({ insight, imageUrl, imageBuffer }) {
    const telegramApiUrl = `https://api.telegram.org/bot${config.telegram.token}/sendPhoto`;
    const caption = addTestModePrefix(`${insight.headline}

[Read more](${config.polaris.insightsUrl}${insight.id})`);

    let response;

    if (imageBuffer) {
        // Send with buffer
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', getChatId());
        form.append('photo', imageBuffer, 'insight-image.jpg');
        form.append('caption', caption);
        form.append('parse_mode', 'markdown');

        response = await fetch(telegramApiUrl, {
            method: 'POST',
            body: form
        });
    } else {
        // Send with URL
        response = await fetch(telegramApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: getChatId(),
                photo: imageUrl,
                caption: caption,
                parse_mode: 'markdown'
            })
        });
    }

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error! status: ${response.status}, response: ${errorText}`);
    }

    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Telegram API returned error: ${data.description || 'Unknown error'}`);
    }

    return data;
}