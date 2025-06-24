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

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    registerGolosFont();

    try {
        const { imageUrl, text, position, textSettings, fileName, mimeType, previewDimensions, isFetchedText } = req.body;

        if (!imageUrl || !text || !position || !textSettings || !fileName || !mimeType || !previewDimensions) {
            return res.status(400).json({ error: 'Missing required fields for image generation' });
        }

        const image = await canvas.loadImage(imageUrl);
        const canvasInstance = canvas.createCanvas(image.width, image.height);
        const context = canvasInstance.getContext('2d');

        const scaleX = image.width / previewDimensions.width;
        const scaleY = canvasInstance.height / previewDimensions.height;
        const scaledX = previewDimensions.width * (position.x / 100);
        const scaledY = previewDimensions.width * (position.y / 100);
        const fontSize = textSettings.fontSize * 0.6;
        context.font = `bold ${fontSize}px Golos`;

        // Set color and log it
        console.log('[CERTIFICATE PNG DEBUG] fillStyle:', textSettings.fontColor);
        context.fillStyle = textSettings.fontColor;

        context.drawImage(image, 0, 0, image.width, image.height);

        // Positioning logic remains the same
        const leftPos = textSettings.leftPos !== undefined ? textSettings.leftPos : 50;
        const topPos = textSettings.topPos !== undefined ? textSettings.topPos : 50;
        const x = canvasInstance.width * (leftPos / 100);
        const y = canvasInstance.height * (topPos / 100);

        let textAlign = 'center';
        if (leftPos == 50) textAlign = 'center';
        else if (leftPos < 50) textAlign = 'left';
        else textAlign = 'right';
        context.textAlign = textAlign;
        context.textBaseline = 'middle';

        // Scale lineHeight and maxWidth
        const maxWidth = canvasInstance.width * 0.25;
        const lineHeight = fontSize * 1.25;
        console.log('[CERTIFICATE PNG DEBUG]', {
            x, y, fontSize, maxWidth, textAlign, isFetchedText, text
        });

        // --- Wrapped text logic for fetched text ---
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

        if (isFetchedText) {
            drawWrappedText(context, text, x, y, maxWidth, lineHeight);
        } else {
            context.fillText(text, x, y);
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