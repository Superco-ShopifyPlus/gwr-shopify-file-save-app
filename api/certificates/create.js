import fetch from 'node-fetch';
import { put } from '@vercel/blob';

// Debug logging for environment variables
console.log('Environment check:', {
    hasShopifyToken: !!process.env.SHOPIFY_ACCESS_TOKEN,
    tokenPrefix: process.env.SHOPIFY_ACCESS_TOKEN?.substring(0, 5),
    hasShopifyDomain: !!process.env.SHOPIFY_SHOP_DOMAIN,
    domainSample: process.env.SHOPIFY_SHOP_DOMAIN
});

// Validate environment variables
if (!process.env.SHOPIFY_ACCESS_TOKEN || !process.env.SHOPIFY_SHOP_DOMAIN) {
    console.error('Missing environment variables:', {
        hasShopifyToken: !!process.env.SHOPIFY_ACCESS_TOKEN,
        hasShopifyDomain: !!process.env.SHOPIFY_SHOP_DOMAIN
    });
    throw new Error('Missing required environment variables SHOPIFY_ACCESS_TOKEN or SHOPIFY_SHOP_DOMAIN');
}

// Validate Shopify domain format
if (!process.env.SHOPIFY_SHOP_DOMAIN.includes('myshopify.com')) {
    console.error('Invalid Shopify domain format:', process.env.SHOPIFY_SHOP_DOMAIN);
    throw new Error('SHOPIFY_SHOP_DOMAIN must be in the format your-store.myshopify.com');
}

// Validate Shopify access token format
if (!process.env.SHOPIFY_ACCESS_TOKEN.startsWith('shpat_')) {
    console.error('Invalid Shopify access token format:', process.env.SHOPIFY_ACCESS_TOKEN.substring(0, 5));
    throw new Error('SHOPIFY_ACCESS_TOKEN must start with shpat_');
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};

async function createFileViaGraphQL(fileUrl, fileName, mimeType) {
    const graphqlUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/graphql.json`;

    // GraphQL mutation for file creation
    const mutation = `
        mutation fileCreate($files: [FileCreateInput!]!) {
            fileCreate(files: $files) {
                files {
                    id
                    preview {
                        image {
                            url
                        }
                    }
                    alt
                }
                userErrors {
                    field
                    message
                }
            }
        }
    `;

    // Map MIME type to Shopify's FileContentType enum
    const getFileContentType = (mimeType) => {
        if (mimeType.startsWith('image/')) return 'IMAGE';
        if (mimeType.startsWith('video/')) return 'VIDEO';
        return 'FILE';
    };

    const response = await fetch(graphqlUrl, {
        method: 'POST',
        headers: {
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query: mutation,
            variables: {
                files: [{
                    contentType: getFileContentType(mimeType),
                    originalSource: fileUrl,
                    alt: fileName
                }]
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('GraphQL error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorText
        });
        throw new Error(`Failed to create file via GraphQL: ${errorText}`);
    }

    const data = await response.json();

    if (data.errors) {
        console.error('GraphQL operation errors:', data.errors);
        throw new Error(`GraphQL operation failed: ${JSON.stringify(data.errors)}`);
    }

    if (data.data.fileCreate.userErrors.length > 0) {
        console.error('File creation errors:', data.data.fileCreate.userErrors);
        throw new Error(`File creation failed: ${JSON.stringify(data.data.fileCreate.userErrors)}`);
    }

    const file = data.data.fileCreate.files[0];
    return {
        id: file.id,
        url: file.preview?.image?.url,
        alt: file.alt
    };
}

export default async function handler(req, res) {
    try {
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', 'https://gwrstore.com');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');

        // Handle preflight request
        if (req.method === 'OPTIONS') {
            res.status(200).end();
            return;
        }

        // Only allow POST requests
        if (req.method !== 'POST') {
            console.log('Method not allowed:', req.method);
            res.status(405).json({ error: 'Method not allowed' });
            return;
        }

        console.log('Request received:', {
            method: req.method,
            headers: req.headers,
            bodyKeys: Object.keys(req.body || {})
        });

        const { fileData, fileName, mimeType } = req.body;

        if (!fileData || !fileName || !mimeType) {
            console.error('Missing required fields:', {
                hasFileData: !!fileData,
                hasFileName: !!fileName,
                hasMimeType: !!mimeType
            });
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Step 1: Upload to Vercel Blob
        console.log('Uploading to Vercel Blob...');
        const blob = await put(fileName, Buffer.from(fileData.replace(/^data:image\/\w+;base64,/, ''), 'base64'), {
            access: 'public',
            addRandomSuffix: true,
            contentType: mimeType
        });
        console.log('File uploaded to Vercel Blob:', blob.url);

        // Step 2: Create file in Shopify using the Blob URL
        console.log('Creating file in Shopify...');
        const fileUpload = await createFileViaGraphQL(blob.url, fileName, mimeType);
        console.log('File created in Shopify:', fileUpload);

        res.status(200).json({
            success: true,
            file: fileUpload
        });
    } catch (error) {
        console.error('Server Error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            type: error.name
        });
    }
}