import dotenv from 'dotenv'
dotenv.config()

import { Storage } from '@google-cloud/storage'
import crypto from 'crypto'
import { tmpdir } from 'os';
import fs from 'fs'

export const uploadFile = async (data: any, media: string) => {
    const storage = new Storage({
        projectId: process.env.GCP_PROJECT_ID,
        keyFilename: `${__dirname}/../secrets.json`,
    });

    const filename = `${crypto.randomUUID()}.${media}`;
    const tempFilePath = `${tmpdir()}/${filename}`;

    try {
        const bucket = storage.bucket(process.env.GCP_BUCKET_NAME!);

        const writeStream = fs.createWriteStream(tempFilePath);

        await new Promise((resolve, reject) => {
        data.pipe(writeStream)
            .on('error', reject)
            .on('finish', async () => {
                const resp = await bucket.upload(tempFilePath, {
                    destination: filename,
                });
                resolve(resp);
            });
        });

        return { filename };
    } catch (error: any) {
        console.log({ error })
        throw new error;
    } 
    finally {
        try {
          await fs.promises.unlink(tempFilePath);
        } catch (err: any) {
          console.error('Error deleting temporary file:', err);
          throw new err;
        }
    }
}