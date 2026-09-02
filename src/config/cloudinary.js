import { v2 as cloudinary } from 'cloudinary';
import env from './env.js';

export const cloudName = env.CLOUDINARY_CLOUD_NAME;
export const apiKey = env.CLOUDINARY_API_KEY;
export const apiSecret = env.CLOUDINARY_API_SECRET;
export const uploadFolder = env.CLOUDINARY_UPLOAD_FOLDER;
export const isCloudinaryConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

export default cloudinary;
