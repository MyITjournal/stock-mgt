import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { env } from '../../config/env';

export type CloudinaryUploadResult = Pick<
  UploadApiResponse,
  'public_id' | 'secure_url' | 'width' | 'height' | 'format' | 'bytes'
>;

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
    });
  }

  /**
   * Whether the credentials are actually set.
   *
   * They are optional in `env.ts` — the app has to boot without them, and does
   * so on every developer machine — so the honest failure is a 503 saying image
   * hosting is not configured. Without this check the SDK fails deep inside an
   * upload stream with a message about a missing cloud name, which reads like a
   * bug in the product rather than a missing environment variable.
   */
  get isConfigured(): boolean {
    return Boolean(
      env.CLOUDINARY_CLOUD_NAME &&
        env.CLOUDINARY_API_KEY &&
        env.CLOUDINARY_API_SECRET,
    );
  }

  assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Image hosting is not configured on this server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or set the product’s imageUrl directly.',
      );
    }
  }

  uploadImage(
    buffer: Buffer,
    folder: string,
    publicId?: string,
  ): Promise<CloudinaryUploadResult> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          public_id: publicId,
          overwrite: true,
          resource_type: 'image',
          allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (error, result) => {
          if (error || !result) {
            reject(new Error(error?.message ?? 'Cloudinary upload failed'));
            return;
          }
          resolve({
            public_id: result.public_id,
            secure_url: result.secure_url,
            width: result.width,
            height: result.height,
            format: result.format,
            bytes: result.bytes,
          });
        },
      );

      stream.end(buffer);
    });
  }

  deleteImage(publicId: string): Promise<void> {
    return cloudinary.uploader.destroy(publicId).then(() => undefined);
  }
}
