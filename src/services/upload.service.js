import cloudinary, { isCloudinaryConfigured, apiKey, apiSecret, cloudName, uploadFolder } from '../config/cloudinary.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Generates a short-lived, signed set of parameters the frontend uses to
 * upload a product image DIRECTLY to Cloudinary from the browser — the
 * backend never receives the image bytes themselves (see Product.js's
 * `image` field comment; this is the confirmed original design, only now
 * actually wired up). The signature proves the upload request came from an
 * authenticated session (the route this backs requires auth) and locks the
 * upload into a fixed, server-controlled folder — everything else about
 * the upload is the frontend's concern.
 *
 * Cloudinary's signing rule: every param sent to its upload endpoint
 * (except `file`, `cloud_name`, `resource_type`, and `api_key` itself)
 * must exactly match what was signed here, or Cloudinary rejects the
 * upload — so the frontend must send exactly `timestamp` and `folder`
 * alongside `signature`/`api_key`/`file`, nothing else.
 */
export function getUploadSignature() {
  if (!isCloudinaryConfigured) {
    throw new AppError('رفع الصور غير مُفعّل حالياً على السيرفر', 503, { code: 'CLOUDINARY_NOT_CONFIGURED' });
  }

  const timestamp = Math.round(Date.now() / 1000);
  const paramsToSign = { timestamp, folder: uploadFolder };
  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

  return { signature, timestamp, folder: uploadFolder, apiKey, cloudName };
}
