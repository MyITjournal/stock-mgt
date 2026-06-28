import { Injectable } from '@nestjs/common';
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
            reject(error ?? new Error('Cloudinary upload failed'));
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
