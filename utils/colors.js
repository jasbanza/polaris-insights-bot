import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConsoleLogColors } from "js-console-log-colors";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const out = new ConsoleLogColors();

export function loadColors() {
    try {
        const colorsPath = path.join(__dirname, '..', 'colors.json');
        const colorsData = fs.readFileSync(colorsPath, 'utf8');
        return JSON.parse(colorsData);
    } catch (error) {
        out.error(`Error loading colors.json: ${error.message}`);
        return {};
    }
}

export function parseRgbString(rgbString) {
    return rgbString.split(' ').map(num => parseInt(num, 10));
}

export function getRgbColor(colorName, defaultColor) {
    const colors = loadColors();
    let rgbString = colors[colorName];
    let actualColorName = colorName;
    
    if (!rgbString) {
        out.warn(`Color "${colorName}" not found, using default: ${defaultColor}`);
        actualColorName = defaultColor;
        rgbString = colors[actualColorName];
        
        if (!rgbString) {
            throw new Error(`Default color "${actualColorName}" not found in colors.json`);
        }
    }
    
    const [r, g, b] = parseRgbString(rgbString);
    out.info(`Using RGB color: ${r}, ${g}, ${b} for ${actualColorName}`);
    
    return { r, g, b, colorName: actualColorName };
}