import { Shopify } from '@shopify/shopify-api';
import fetch from 'node-fetch';
import FormData from 'form-data';

// Configure Shopify
const shopify = new Shopify({
  apiKey: process.env.SHOPIFY_ACCESS_TOKEN,
  apiSecretKey: process.env.SHOPIFY_ACCESS_TOKEN, // Using same token for simplicity
  scopes: ['write_files'],
  hostName: process.env.SHOPIFY_SHOP_DOMAIN,
  apiVersion: '2024-01'
});

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { fileData, fileName, mimeType } = req.body;

        // Initialize Shopify client
        const client = new Shopify.Clients.Graphql(
            process.env.SHOPIFY_SHOP_DOMAIN,
            process.env.SHOPIFY_ACCESS_TOKEN
        );

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
        });

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
        await fetch(url, {
            method: 'POST',
            body: formData
        });

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
        });

        const fileResult = createFileResponse.body.data.fileCreate.files[0];
        res.status(200).json(fileResult);
    } catch (error) {
        console.error('Error creating file:', error);
        res.status(500).json({ error: error.message });
    }
}