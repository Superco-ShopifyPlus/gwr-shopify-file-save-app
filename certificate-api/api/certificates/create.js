// api/create.js
import { Shopify } from '@shopify/shopify-api';
import fetch from 'node-fetch';
import FormData from 'form-data';

export default async function handler(req, res) {
  // CORS headers
  console.log('req', req);
  console.log('res', res);
  res.setHeader('Access-Control-Allow-Origin', 'https://gwrstore.com');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end(); // CORS preflight
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { fileData, fileName, mimeType } = req.body;

    const client = new Shopify.Clients.Graphql(
      process.env.SHOPIFY_SHOP_DOMAIN,
      process.env.SHOPIFY_ACCESS_TOKEN
    );

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
          input: [
            {
              filename: fileName,
              mimeType,
              resource: 'FILE'
            }
          ]
        }
      }
    });

    const { url, parameters } = stagingResponse.body.data.stagedUploadsCreate.stagedTargets[0];

    const base64Data = fileData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const formData = new FormData();
    parameters.forEach(({ name, value }) => {
      formData.append(name, value);
    });
    formData.append('file', buffer, fileName);

    await fetch(url, {
      method: 'POST',
      body: formData
    });

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
          files: [
            {
              originalSource: stagingResponse.body.data.stagedUploadsCreate.stagedTargets[0].resourceUrl,
              alt: fileName,
              contentType: mimeType
            }
          ]
        }
      }
    });

    const fileResult = createFileResponse.body.data.fileCreate.files[0];
    res.status(200).json(fileResult);
  } catch (error) {
    console.error('Error uploading to Shopify:', error);
    res.status(500).json({ error: error.message });
  }
}
