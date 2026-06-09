import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';

// Configure from environment variables
// User must set in server/.env :
// CLOUDINARY_CLOUD_NAME=your_cloud_name
// CLOUDINARY_API_KEY=your_key
// CLOUDINARY_API_SECRET=your_secret
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a local file to Cloudinary.
 * Returns { url: secure_url, public_id, resource_type }
 */
export async function uploadToCloudinary(localFilePath, options = {}) {
  const { folder = 'butuz', resource_type = 'auto', public_id = undefined } = options;

  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    throw new Error('Cloudinary is not configured (missing CLOUDINARY_* env vars)');
  }

  if (!localFilePath || !fs.existsSync(localFilePath)) {
    throw new Error('Local file not found for Cloudinary upload');
  }

  try {
    const result = await cloudinary.uploader.upload(localFilePath, {
      folder,
      resource_type,
      ...(public_id && { public_id }),
    });

    // Delete local temp file after successful upload
    try {
      fs.unlinkSync(localFilePath);
    } catch (cleanupErr) {
      console.warn('Could not delete local file after Cloudinary upload:', cleanupErr.message);
    }

    return {
      url: result.secure_url,
      public_id: result.public_id,
      resource_type: result.resource_type || resource_type,
    };
  } catch (err) {
    console.error('Cloudinary upload failed:', err);
    throw err;
  }
}

/**
 * Delete a resource from Cloudinary by public_id.
 */
export async function deleteFromCloudinary(publicId, resourceType = 'image') {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error('Cloudinary destroy failed for', publicId, err.message);
  }
}

/**
 * Helper to extract public_id from a Cloudinary URL (for deletion).
 */
export function getPublicIdFromUrl(url) {
  if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
  // Matches typical cloudinary urls: .../upload/v1234567890/folder/filename.ext
  const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return match ? match[1] : null;
}
