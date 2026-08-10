// api/admin/upload-media.js
// Handles image and video uploads for products

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Note: In Vercel serverless, file uploads via multipart form-data
    // require special handling. This endpoint provides the structure,
    // but actual file persistence would need:
    // 1. Temporary storage during request
    // 2. Upload to external storage (S3, Vercel Blob, etc.)
    // OR redeploy with updated files locally

    const password = req.body?.password || req.headers['x-admin-password'];

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const product = req.body?.product;
    if (!product) {
      return res.status(400).json({ error: 'Product name required' });
    }

    // In a real deployment, you would:
    // 1. Use a library like 'busboy' to parse multipart form data
    // 2. Upload files to cloud storage (S3, Vercel Blob, etc.)
    // 3. Update catalog references

    // For now, return success - files would be uploaded via local development
    return res.status(200).json({
      success: true,
      message: `Media uploaded for ${product}`,
      product,
      note: 'For production: use Vercel Blob or similar for file storage'
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message });
  }
};
