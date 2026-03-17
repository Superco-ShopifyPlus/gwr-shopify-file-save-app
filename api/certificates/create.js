import fetch from 'node-fetch';
import { put } from '@vercel/blob';
import { PDFDocument } from 'pdf-lib';
import * as canvas from '@napi-rs/canvas';
import path from 'path';

let fontRegistered = false;
const registerGolosFont = () => {
    if (fontRegistered) return;
    try {
        const fontPath = path.join(process.cwd(), 'api', 'assets', 'GolosText-Bold.ttf');
        console.log(`Attempting to register font from path: ${fontPath}`);
        canvas.GlobalFonts.registerFromPath(fontPath, 'Golos');
        console.log('Font registered successfully.');
        fontRegistered = true;
    } catch (fontError) {
        console.error('Failed to register font:', fontError);
    }
};

function normalizeText(raw) {
    return String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\n/g, '\n');
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const paragraphs = text.split('\n');
    for (let p = 0; p < paragraphs.length; p++) {
        let words = paragraphs[p].split(' ');
        let line = '';
        for (let n = 0; n < words.length; n++) {
            let testLine = line + words[n] + ' ';
            let metrics = ctx.measureText(testLine);
            let testWidth = metrics.width;
            if (testWidth > maxWidth && n > 0) {
                ctx.fillText(line, x, y);
                line = words[n] + ' ';
                y += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, x, y);
        y += lineHeight;
    }
}

function drawTextLayer(context, canvasInstance, text, settings, shouldWrap) {
    if (!text || !text.trim() || !settings) return;

    const normalizedText = normalizeText(text);
    if (!normalizedText.trim()) return;

    const fontSize = (parseFloat(settings.fontSize) || 24) * 0.6;
    context.font = `bold ${fontSize}px Golos`;
    context.fillStyle = settings.fontColor || '#000000';

    const leftPos = settings.leftPos !== undefined ? parseFloat(settings.leftPos) : 50;
    const topPos = settings.topPos !== undefined ? parseFloat(settings.topPos) : 50;
    const x = canvasInstance.width * (leftPos / 100);
    const y = canvasInstance.height * (topPos / 100);

    let textAlign = 'center';
    if (leftPos == 50) textAlign = 'center';
    else if (leftPos < 50) textAlign = 'left';
    else textAlign = 'right';
    context.textAlign = textAlign;
    context.textBaseline = 'middle';

    const maxWidth = canvasInstance.width * 0.55;
    const lineHeight = fontSize * 1.25;

    console.log('[CERTIFICATE TEXT LAYER]', {
        text: normalizedText.substring(0, 50),
        x, y, fontSize, maxWidth, lineHeight, textAlign, shouldWrap,
        fontColor: settings.fontColor
    });

    if (shouldWrap || normalizedText.includes('\n')) {
        drawWrappedText(context, normalizedText, x, y, maxWidth, lineHeight);
    } else {
        context.fillText(normalizedText, x, y);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    registerGolosFont();

    try {
        const {
            imageUrl,
            text,
            position,
            textSettings,
            fileName,
            mimeType,
            previewDimensions,
            isFetchedText,
            recordText,
            recordTextSettings
        } = req.body;

        if (!imageUrl || !fileName || !mimeType || !previewDimensions) {
            return res.status(400).json({ error: 'Missing required fields: imageUrl, fileName, mimeType, previewDimensions' });
        }

        const hasCustomText = text && String(text).trim().length > 0;
        const hasRecordText = recordText && String(recordText).trim().length > 0;

        if (!hasCustomText && !hasRecordText) {
            return res.status(400).json({ error: 'At least one of text or recordText is required' });
        }

        if (hasCustomText && !textSettings) {
            return res.status(400).json({ error: 'textSettings is required when text is provided' });
        }

        if (hasRecordText && !recordTextSettings) {
            return res.status(400).json({ error: 'recordTextSettings is required when recordText is provided' });
        }

        const image = await canvas.loadImage(imageUrl);
        const canvasInstance = canvas.createCanvas(image.width, image.height);
        const context = canvasInstance.getContext('2d');

        context.drawImage(image, 0, 0, image.width, image.height);

        // Layer 1: Record text (drawn first, always wrapped)
        if (hasRecordText) {
            console.log('[CERTIFICATE] Drawing record text layer');
            drawTextLayer(context, canvasInstance, recordText, recordTextSettings, true);
        }

        // Layer 2: Custom text (drawn second, wrapped only if fetched or multiline)
        if (hasCustomText) {
            console.log('[CERTIFICATE] Drawing custom text layer');
            drawTextLayer(context, canvasInstance, text, textSettings, Boolean(isFetchedText));
        }

        const pngBuffer = await canvasInstance.toBuffer('image/png');

        const blob = await put(fileName, pngBuffer, { access: 'public', addRandomSuffix: false, contentType: mimeType });
        const pngUpload = await createFileViaGraphQL(blob.url, fileName, mimeType);

        const pdfDoc = await PDFDocument.create();
        const pngImage = await pdfDoc.embedPng(pngBuffer);
        const { width, height } = pngImage.scale(1);
        const page = pdfDoc.addPage([width, height]);
        page.drawImage(pngImage, { x: 0, y: 0, width, height });
        const pdfBytes = await pdfDoc.save();
        const pdfFileName = fileName.replace(/\.png$/, '.pdf');

        const pdfBlob = await put(pdfFileName, pdfBytes, { access: 'public', addRandomSuffix: false, contentType: 'application/pdf' });
        const pdfUpload = await createFileViaGraphQL(pdfBlob.url, pdfFileName, 'application/pdf');

        res.status(200).json({
            success: true,
            files: {
                png: { ...pngUpload, blobUrl: blob.url },
                pdf: { ...pdfUpload, blobUrl: pdfBlob.url }
            }
        });
    } catch (error) {
        console.error('Server Error:', { name: error.name, message: error.message, stack: error.stack });
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

async function createFileViaGraphQL(fileUrl, fileName, mimeType) {
    const shopifyDomain = process.env.SHOPIFY_SHOP_DOMAIN;
    const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyDomain || !accessToken) {
        const message = 'Shopify domain or access token is not set in environment variables.';
        console.error(message);
        throw new Error(message);
    }

    console.log('Shopify Domain:', shopifyDomain ? 'Set' : 'Not Set');
    console.log('Shopify Access Token:', accessToken ? 'Set' : 'Not Set');
    const graphqlUrl = `https://${shopifyDomain}/admin/api/2024-01/graphql.json`;
    const mutation = `
        mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
                files { id, preview { image { url } }, alt }
                userErrors { field, message }
            }
        }
    `;
    const variables = {
        files: [{
            contentType: mimeType.startsWith('image/') ? 'IMAGE' : 'FILE',
            originalSource: fileUrl,
            alt: fileName
        }]
    };
    const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: mutation, variables })
    });

    const responseText = await response.text();

    if (!response.ok) {
        console.error('Shopify GraphQL API Error Response:', responseText);
        throw new Error(`Failed to create file via GraphQL: ${responseText}`);
    }

    const data = JSON.parse(responseText);

    if (data.errors) {
        console.error('Shopify GraphQL API Errors:', data.errors);
        throw new Error(`GraphQL operation failed: ${JSON.stringify(data.errors)}`);
    }
    if (data.data.fileCreate.userErrors.length > 0) {
        console.error('Shopify GraphQL User Errors:', data.data.fileCreate.userErrors);
        throw new Error(`File creation failed: ${JSON.stringify(data.data.fileCreate.userErrors)}`);
    }
    const file = data.data.fileCreate.files[0];
    return { id: file.id, url: file.preview?.image?.url, alt: file.alt };
}
