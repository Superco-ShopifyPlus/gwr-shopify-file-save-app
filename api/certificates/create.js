import { Shopify } from '@shopify/shopify-api';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Validate environment variables
if (!process.env.SHOPIFY_ACCESS_TOKEN || !process.env.SHOPIFY_SHOP_DOMAIN) {
    throw new Error('Missing required environment variables SHOPIFY_ACCESS_TOKEN or SHOPIFY_SHOP_DOMAIN');
}

// Ensure the access token is in the correct format
if (!process.env.SHOPIFY_ACCESS_TOKEN.startsWith('shpat_')) {
    console.warn('Warning: SHOPIFY_ACCESS_TOKEN should start with "shpat_". Make sure you are using the Admin API access token, not the API key or secret.');
}

// Configure Shopify
const client = new Shopify.Clients.Graphql(
    process.env.SHOPIFY_SHOP_DOMAIN,
    process.env.SHOPIFY_ACCESS_TOKEN
);

export default async function handler(req, res) {
    // Log request details for debugging
    console.log('Request method:', req.method);
    console.log('Request headers:', req.headers);

    // Handle preflight request
    if (req.method === 'OPTIONS') {
        // Return 200 for preflight
        res.status(200).end();
        return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const { fileData, fileName, mimeType } = req.body;

        if (!fileData || !fileName || !mimeType) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Stage the upload
        const stagingResponse = await client.query({
            data: {
                query: `
                    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
                        stagedUploadsCreate(input: $input) {
                            stagedTargets {
                                resourceUrl
                                url
                                parameters {
                                    name
                                    value
                                }
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }
                `,
                variables: {
                    input: [{
                        filename: fileName,
                        mimeType: mimeType,
                        resource: "FILE"
                    }]
                }
            }
        }).catch(error => {
            console.error('Staging error:', error);
            throw error;
        });

        // Check for staging errors
        if (stagingResponse.body?.data?.stagedUploadsCreate?.userErrors?.length > 0) {
            const errors = stagingResponse.body.data.stagedUploadsCreate.userErrors;
            throw new Error(`Staging failed: ${errors.map(e => e.message).join(', ')}`);
        }

        const { url, parameters } = stagingResponse.body.data.stagedUploadsCreate.stagedTargets[0];

        // Convert base64 to buffer
        const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');

        // Create form data for file upload
        const formData = new FormData();
        parameters.forEach(({ name, value }) => {
            formData.append(name, value);
        });
        formData.append('file', buffer, { filename: fileName });

        // Upload to the staged URL
        const uploadResponse = await fetch(url, {
            method: 'POST',
            body: formData
        });

        if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        // Create the file record in Shopify
        const createFileResponse = await client.query({
            data: {
                query: `
                    mutation fileCreate($files: [FileCreateInput!]!) {
                        fileCreate(files: $files) {
                            files {
                                id
                                url
                            }
                            userErrors {
                                field
                                message
                            }
                        }
                    }
                `,
                variables: {
                    files: [{
                        originalSource: url,
                        alt: fileName,
                        contentType: mimeType
                    }]
                }
            }
        }).catch(error => {
            console.error('File creation error:', error);
            throw error;
        });

        // Check for file creation errors
        if (createFileResponse.body?.data?.fileCreate?.userErrors?.length > 0) {
            const errors = createFileResponse.body.data.fileCreate.userErrors;
            throw new Error(`File creation failed: ${errors.map(e => e.message).join(', ')}`);
        }

        const fileResult = createFileResponse.body.data.fileCreate.files[0];
        res.status(200).json(fileResult);
    } catch (error) {
        console.error('Error creating file:', error);
        const status = error.message.includes('Unauthorized') ? 401 : 500;
        res.status(status).json({
            error: error.message,
            hint: error.message.includes('Unauthorized') ?
                'Make sure you are using the Admin API access token (starts with shpat_) and not the API key or secret' :
                undefined
        });
    }
}