import dotenv from 'dotenv'
dotenv.config()

import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'

export const uploadFileFromBuffer = async (buffer: Buffer, extension: string, mimeType?: string) => {
    const credentials = process.env.SECRET_TEXT 
        ? JSON.parse(process.env.SECRET_TEXT)
        : undefined;

    const storage = new Storage({
        projectId: process.env.GCP_PROJECT_ID,
        ...(credentials && { credentials })
    });

    const filename = `${crypto.randomUUID()}.${extension}`;

    try {
        const bucket = storage.bucket(process.env.GCP_BUCKET_NAME!);
        const file = bucket.file(filename);

        const writeStream = file.createWriteStream({
            metadata: {
                contentType: mimeType || 'application/octet-stream',
                cacheControl: 'public, max-age=31536000',
            },
            resumable: false,
        });

        await new Promise<void>((resolve, reject) => {
            writeStream.on('error', (error: any) => {
                reject(error);
            });

            writeStream.on('finish', () => {
                resolve();
            });

            writeStream.end(buffer);
        });

        try {
            await file.makePublic();
        } catch (error: any) {
            console.log('Bucket usa Uniform Bucket-Level Access - permisos controlados a nivel de bucket');
        }

        const publicUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${filename}`;

        return { filename, publicUrl };
    } catch (error: any) {
        console.error('Error al subir archivo a GCP:', error);
        throw error;
    }
}