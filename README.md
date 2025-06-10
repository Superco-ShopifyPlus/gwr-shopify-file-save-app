# GWR Shopify File Save App

A Next.js application that handles file uploads to Vercel Blob Storage and Shopify, with automatic PDF generation.

## Features

- PNG file upload to Vercel Blob Storage
- Automatic PDF generation from PNG files
- File creation in Shopify via GraphQL API
- Error handling and logging
- Secure file storage and access

## Prerequisites

- Node.js 18 or later
- Vercel account with Blob Storage enabled
- Shopify store with Admin API access

## Environment Variables

The following environment variables are required:

```env
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=your_blob_token

# Shopify API
SHOPIFY_ACCESS_TOKEN=your_shopify_token
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
```

## Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in your environment variables.

3. Run the development server:
   ```bash
   npm run dev
   ```

## Deployment to Vercel

1. Push your code to a Git repository (GitHub, GitLab, or Bitbucket).

2. Import your project in the Vercel dashboard.

3. Configure the following environment variables in your Vercel project settings:
   - `BLOB_READ_WRITE_TOKEN`
   - `SHOPIFY_ACCESS_TOKEN`
   - `SHOPIFY_SHOP_DOMAIN`

4. Deploy! Vercel will automatically build and deploy your application.

## API Endpoints

### POST /api/certificates/create

Creates a PNG file and generates a PDF version.

Request body:
```json
{
  "fileData": "base64_encoded_png_data",
  "fileName": "certificate.png",
  "mimeType": "image/png"
}
```

Response:
```json
{
  "success": true,
  "files": {
    "png": {
      "id": "shopify_file_id",
      "url": "shopify_file_url",
      "blobUrl": "vercel_blob_url"
    },
    "pdf": {
      "id": "shopify_file_id",
      "url": "shopify_file_url",
      "blobUrl": "vercel_blob_url"
    }
  }
}
```

## Testing

Run the test script to verify file upload and PDF generation:
```bash
npm test
```
