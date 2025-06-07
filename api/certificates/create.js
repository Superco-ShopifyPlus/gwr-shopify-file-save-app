import fetch from 'node-fetch';
import FormData from 'form-data';

// Debug logging for environment variables
console.log('Environment check:', {
    hasShopifyToken: !!process.env.SHOPIFY_ACCESS_TOKEN,
    tokenPrefix: process.env.SHOPIFY_ACCESS_TOKEN?.substring(0, 5),
    hasShopifyDomain: !!process.env.SHOPIFY_SHOP_DOMAIN,
    domainSample: process.env.SHOPIFY_SHOP_DOMAIN?.substring(0, 10)
});

// Validate environment variables
if (!process.env.SHOPIFY_ACCESS_TOKEN || !process.env.SHOPIFY_SHOP_DOMAIN) {
    throw new Error('Missing required environment variables SHOPIFY_ACCESS_TOKEN or SHOPIFY_SHOP_DOMAIN');
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'https://gwrstore.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-vercel-set-bypass-cookie');
    res.setHeader('Access-Control-Max-Age', '86400');

    // Set Vercel bypass header
    res.setHeader('x-vercel-set-bypass-cookie', 'true');

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST requests
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        console.log('Request received:', {
            method: req.method,
            headers: req.headers,
            body: req.body
        });

        const { fileData, fileName, mimeType } = req.body;

        if (!fileData || !fileName || !mimeType) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Convert base64 to buffer
        const buffer = Buffer.from(fileData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        // Create form data
        const formData = new FormData();
        formData.append('fileData', buffer, {
            filename: fileName,
            contentType: mimeType,
        });

        // Upload to Shopify
        const shopifyUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/files.json`;
        console.log('Sending request to Shopify:', {
            url: shopifyUrl,
            fileName,
            mimeType
        });

        const response = await fetch(shopifyUrl, {
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            },
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Shopify API Error:', {
                status: response.status,
                statusText: response.statusText,
                error: errorData
            });
            res.status(response.status).json({
                error: 'Failed to upload file to Shopify',
                details: errorData
            });
            return;
        }

        const data = await response.json();
        console.log('Shopify API Success:', data);
        res.status(200).json(data);
    } catch (error) {
        console.error('Server Error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}