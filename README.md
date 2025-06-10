# GWR Shopify File Save App

A serverless API for handling certificate file uploads to Shopify's Files API.

## Features

- Uploads PNG and PDF files to Vercel Blob storage
- Creates files in Shopify using the GraphQL Admin API
- Handles CORS and preflight requests
- Supports both PNG and PDF file types
- Returns Shopify and Blob URLs for uploaded files

## API Endpoint

POST `/api/certificates/create`

### Request Body

```json
{
  "fileData": "base64_encoded_png_data",
  "fileName": "certificate_name.png",
  "mimeType": "image/png",
  "pdfData": "base64_encoded_pdf_data (optional)",
  "pdfFileName": "certificate_name.pdf (optional)"
}
```

### Response

```json
{
  "success": true,
  "files": {
    "png": {
      "id": "shopify_file_id",
      "url": "shopify_cdn_url",
      "blobUrl": "vercel_blob_url"
    },
    "pdf": {
      "id": "shopify_file_id",
      "url": "shopify_cdn_url",
      "blobUrl": "vercel_blob_url"
    }
  }
}
```

## Environment Variables

Required environment variables:

- `SHOPIFY_ACCESS_TOKEN`: Shopify Admin API access token (must start with shpat_)
- `SHOPIFY_SHOP_DOMAIN`: Your Shopify store domain (e.g., your-store.myshopify.com)
- `BLOB_READ_WRITE_TOKEN`: Vercel Blob storage access token

## Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with required environment variables
4. Deploy to Vercel:
   ```bash
   vercel deploy
   ```

## Error Handling

The API returns appropriate HTTP status codes:

- 200: Success
- 400: Missing required fields
- 405: Method not allowed
- 500: Server error

Error responses include detailed error messages and maintain URLs of any files that were successfully uploaded before the error occurred.
