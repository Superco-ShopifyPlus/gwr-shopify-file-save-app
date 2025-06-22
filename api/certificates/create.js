import fetch from 'node-fetch';
import { put } from '@vercel/blob';
import { PDFDocument, rgb } from 'pdf-lib';

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

// Configure body parser size limit
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '20mb'
        }
    }
};

async function createFileViaGraphQL(fileUrl, fileName, mimeType) {
    const graphqlUrl = `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-01/graphql.json`;

    console.log('Creating file in Shopify:', {
        fileName,
        mimeType,
        fileUrl,
        contentType: mimeType.startsWith('image/') ? 'IMAGE' : 'FILE'
    });

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
            'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query: mutation,
            variables
        })
    });

    if (!response.ok) {
        throw new Error(`Failed to create file via GraphQL: ${await response.text()}`);
    }

    const data = await response.json();

    if (data.errors) {
        throw new Error(`GraphQL operation failed: ${JSON.stringify(data.errors)}`);
    }

    if (data.data.fileCreate.userErrors.length > 0) {
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
    // Set CORS headers
    const allowedOrigins = ['https://gwrstore.com', 'http://localhost:3000', 'http://127.0.0.1:3000'];
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

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
        // console.log('Method not allowed:', req.method);
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    let blobUrl = null;
    let pdfBlobUrl = null;

    try {
        // console.log('Request received:', {
        //     method: req.method,
        //     headers: req.headers,
        //     bodyKeys: Object.keys(req.body || {})
        // });

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

        // Step 1: Upload PNG to Vercel Blob
        console.log('Uploading PNG to Vercel Blob...');
        const pngBuffer = Buffer.from(fileData.replace(/^data:image\/\w+;base64,/, ''), 'base64');

        // console.log('Attempting to upload to Vercel Blob...');
        const blob = await put(fileName, pngBuffer, {
            access: 'public',
            addRandomSuffix: false,
            contentType: mimeType
        });
        console.log('Successfully uploaded to Vercel Blob:', blob.url);
        blobUrl = blob.url;

        // Step 2: Create PNG file in Shopify
        console.log('Attempting to create file in Shopify via GraphQL...');
        const pngUpload = await createFileViaGraphQL(blob.url, fileName, mimeType);
        // console.log('Successfully created PNG file in Shopify:', pngUpload);

        let pdfUpload = null;
        try {
            // Step 3: Generate and upload PDF
            console.log('Generating PDF from PNG...');
            const pdfDoc = await PDFDocument.create();
            const pngImageBytes = pngBuffer;
            const pngImage = await pdfDoc.embedPng(pngImageBytes);
            const {
                width,
                height
            } = pngImage.scale(1);

            const page = pdfDoc.addPage([width, height]);
            page.drawImage(pngImage, {
                x: 0,
                y: 0,
                width: width,
                height: height
            });

            const pdfBytes = await pdfDoc.save();
            const pdfFileName = fileName.replace(/\.png$/, '.pdf');

            console.log('Uploading PDF to Vercel Blob...');
            const pdfBlob = await put(pdfFileName, pdfBytes, {
                access: 'public',
                addRandomSuffix: false,
                contentType: 'application/pdf'
            });
            console.log('PDF uploaded to Vercel Blob:', pdfBlob.url);
            pdfBlobUrl = pdfBlob.url;

            // Step 4: Create PDF file in Shopify
            console.log('Creating PDF file in Shopify...');
            pdfUpload = await createFileViaGraphQL(pdfBlob.url, pdfFileName, 'application/pdf');
            console.log('PDF file created in Shopify:', pdfUpload);
        } catch (pdfError) {
            console.error('Failed to generate or upload PDF:', {
                name: pdfError.name,
                message: pdfError.message,
                stack: pdfError.stack
            });
            // Continue without PDF, as PNG was successful
        }

        // Return success response with both files
        const response = {
            success: true,
            files: {
                png: {
                    ...pngUpload,
                    blobUrl: blob.url
                },
                ...(pdfUpload && {
                    pdf: {
                        ...pdfUpload,
                        blobUrl: pdfBlobUrl
                    }
                })
            }
        };

        console.log('Final response:', JSON.stringify(response, null, 2));
        res.status(200).json(response);

    } catch (error) {
        console.error('Server Error:', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            blobUrl,
            pdfBlobUrl
        });

        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            type: error.name,
            blobUrl,
            pdfBlobUrl
        });
    }
}