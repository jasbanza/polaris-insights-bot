import fs from 'fs';
import fetch from 'node-fetch';
import { ConsoleLogColors } from "js-console-log-colors";
import { config, isValidUrl } from './config.js';
import { getRgbColor } from './colors.js';

const out = new ConsoleLogColors();
let Canvas = null;
let canvasAvailable = false;

try {
    Canvas = await import('canvas');
    canvasAvailable = true;
    out.success('Canvas loaded successfully');
} catch (error) {
    out.warn(`Canvas not available: ${error.message}`);
}

export function extractTokenImageUrls(insight) {
    const tokenImageUrls = [];
    
    try {
        // Current API format - subjectValue.logoImgURL
        if (insight.subjectValue?.logoImgURL) {
            out.info(`Found token logo in subjectValue: ${insight.subjectValue.logoImgURL}`);
            tokenImageUrls.push(insight.subjectValue.logoImgURL);
        }
        
        // Legacy format - insight.tokens array
        if (insight.tokens && Array.isArray(insight.tokens)) {
            const legacyUrls = insight.tokens
                .map(token => {
                    try {
                        return token.imageUrl || token.logo_URIs?.png || token.logo_URIs?.svg;
                    } catch (error) {
                        return null;
                    }
                })
                .filter(url => url);
            
            tokenImageUrls.push(...legacyUrls);
        }
        
        const uniqueUrls = [...new Set(tokenImageUrls)];
        if (uniqueUrls.length > 0) {
            out.info(`Extracted ${uniqueUrls.length} token image URL(s)`);
        }
        
        return uniqueUrls;
    } catch (error) {
        out.error(`Error extracting token URLs: ${error.message}`);
        return [];
    }
}

async function overlayImage(ctx, imagePathOrUrl, x, y, size, isCircular = false) {
    let image;
    
    if (imagePathOrUrl.startsWith('http://') || imagePathOrUrl.startsWith('https://')) {
        const response = await fetch(imagePathOrUrl);
        if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
        const buffer = await response.buffer();
        image = await Canvas.loadImage(buffer);
    } else {
        if (!fs.existsSync(imagePathOrUrl)) throw new Error(`File not found: ${imagePathOrUrl}`);
        image = await Canvas.loadImage(imagePathOrUrl);
    }
    
    if (isCircular) {
        // Save the current context state
        ctx.save();
        
        // Create circular clipping path
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
        ctx.clip();
        
        // Draw the image within the circular clip
        ctx.drawImage(image, x, y, size, size);
        
        // Restore the context state to remove the clipping path
        ctx.restore();
    } else {
        ctx.drawImage(image, x, y, size, size);
    }
}

async function overlayPolarisLogo(ctx, logoUrl) {
    if (!logoUrl || !config.insights.doPolarisLogo) return;
    
    try {
        out.info('Applying Polaris logo overlay...');
        await overlayImage(ctx, logoUrl, 40, 40, 80);
        out.success('Polaris logo overlaid successfully');
    } catch (error) {
        out.error(`Error overlaying Polaris logo: ${error.message}`);
    }
}

async function overlayTokenImages(ctx, tokenUrls, canvasWidth, canvasHeight) {
    if (!tokenUrls?.length || !config.insights.doTokenLogo) return;
    
    try {
        out.info(`Overlaying ${tokenUrls.length} token image(s)`);
        
        for (let i = tokenUrls.length - 1; i >= 0; i--) {
            try {
                const visualIndex = tokenUrls.length - 1 - i;
                const x = canvasWidth - 40 - 80 - (visualIndex * 40);
                const y = canvasHeight - 40 - 80;
                
                await overlayImage(ctx, tokenUrls[i], x, y, 80, config.insights.circularClipTokenLogo);
            } catch (error) {
                out.error(`Error overlaying token ${i + 1}: ${error.message}`);
                continue;
            }
        }
        
        out.success('Token images overlaid successfully');
    } catch (error) {
        out.error(`Error overlaying tokens: ${error.message}`);
    }
}

export async function createColoredBackgroundImage({ colorName, overlayImageUrl, polarisLogoUrl, tokenImageUrls, width = 1200, height = 630 }) {
    if (!canvasAvailable) {
        throw new Error('Canvas module not available');
    }

    const { r, g, b } = getRgbColor(colorName, config.insights.defaultBackgroundColor);
    
    // Download overlay image
    const overlayResponse = await fetch(overlayImageUrl);
    if (!overlayResponse.ok) {
        throw new Error(`Failed to fetch overlay image: ${overlayResponse.status}`);
    }
    
    const overlayBuffer = await overlayResponse.buffer();
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Fill background
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, width, height);
    
    // Load and scale overlay image
    const overlayImage = await Canvas.loadImage(overlayBuffer);
    const scaleFactor = config.insights.scaleForegroundImage;
    const targetSize = height * scaleFactor;
    const scale = targetSize / Math.max(overlayImage.width, overlayImage.height);
    
    const scaledWidth = overlayImage.width * scale;
    const scaledHeight = overlayImage.height * scale;
    const x = (width - scaledWidth) / 2;
    const y = (height - scaledHeight) / 2;
    
    ctx.drawImage(overlayImage, x, y, scaledWidth, scaledHeight);
    
    // Apply overlays
    await overlayPolarisLogo(ctx, polarisLogoUrl);
    await overlayTokenImages(ctx, tokenImageUrls, width, height);
    
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

export async function createImageBackgroundWithOverlays({ backgroundImageUrl, polarisLogoUrl, tokenImageUrls, width = 1200, height = 630 }) {
    if (!canvasAvailable) {
        throw new Error('Canvas module not available');
    }

    // Download background image
    const backgroundResponse = await fetch(backgroundImageUrl);
    if (!backgroundResponse.ok) {
        throw new Error(`Failed to fetch background image: ${backgroundResponse.status}`);
    }
    
    const backgroundBuffer = await backgroundResponse.buffer();
    const backgroundImage = await Canvas.loadImage(backgroundBuffer);
    
    const canvas = Canvas.createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Draw background scaled to fill canvas
    ctx.drawImage(backgroundImage, 0, 0, width, height);
    
    // Apply overlays
    await overlayPolarisLogo(ctx, polarisLogoUrl);
    await overlayTokenImages(ctx, tokenImageUrls, width, height);
    
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

export async function getImageForInsight(insight) {
    try {
        const { backgroundType, backgroundValue, visualizationType, visualizationValue } = insight;
        const tokenImageUrls = extractTokenImageUrls(insight);
        
        if (backgroundType === 'image') {
            let backgroundImageUrl;
            
            if (visualizationType === 'graphics' && visualizationValue && isValidUrl(visualizationValue)) {
                backgroundImageUrl = visualizationValue;
            } else if (backgroundValue && isValidUrl(backgroundValue)) {
                backgroundImageUrl = backgroundValue;
            } else {
                return null;
            }
            
            return await createImageBackgroundWithOverlays({
                backgroundImageUrl,
                polarisLogoUrl: config.insights.polarisLogoPath,
                tokenImageUrls
            });
            
        } else if (backgroundType === 'color') {
            if (!visualizationValue || !isValidUrl(visualizationValue)) {
                throw new Error('Invalid visualization value for color background');
            }
            
            return await createColoredBackgroundImage({
                colorName: backgroundValue,
                overlayImageUrl: visualizationValue,
                polarisLogoUrl: config.insights.polarisLogoPath,
                tokenImageUrls
            });
            
        } else {
            return backgroundValue && isValidUrl(backgroundValue) ? backgroundValue : null;
        }
    } catch (error) {
        out.error(`Error getting image for insight: ${error.message}`);
        return null;
    }
}