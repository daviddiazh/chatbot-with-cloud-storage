import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { createWasender } from 'wasenderapi';
import axios from "axios";
import crypto from'crypto';
import { uploadFileFromBuffer } from "./uploadFile";

const app = express();

app.use(express.json());
app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const apiKey = process.env.WASENDER_API_KEY || '';
const personalAccessToken = process.env.WASENDER_PERSONAL_ACCESS_TOKEN || '';
const webhookSecret = process.env.WASENDER_WEBHOOK_SECRET || '';
const wasender = createWasender(
  apiKey,
  personalAccessToken,
  undefined,
  undefined,
  undefined,
  webhookSecret
);

app.post('/webhook', async (req, res) => {
  try {
    const messagePayload = req.body?.data?.messages;
    const messagesArray = Array.isArray(messagePayload) ? messagePayload : [messagePayload];
    const currentMessage = messagesArray[0];

    if (!currentMessage) {
      return res.status(200).send('<Response>!currentMessage</Response>');
    }

    const { key, message } = currentMessage ?? {};
    const messageId = key?.id || 'unknown_id';
    const remoteJid = key?.remoteJid || key?.remoteId;

    if (!remoteJid) {
      return res.status(200).send('<Response>!remoteJid</Response>');
    }

    const phoneCandidates: Array<string | undefined> = [
      typeof req.body?.data?.senderPn === 'string' ? req.body.data.senderPn : undefined,
      typeof currentMessage?.key?.senderPn === 'string' ? currentMessage?.key?.senderPn : undefined,
      typeof currentMessage?.senderPn === 'string' ? currentMessage?.senderPn : undefined,
      typeof key?.participant === 'string' ? key.participant : undefined,
      typeof req.body?.data?.from === 'string' ? req.body.data.from : undefined,
      remoteJid,
    ];
    const phoneNumber = normalizePhone(phoneCandidates);

    if (!phoneNumber) {
      return res.status(200).send('<Response>!phoneNumber</Response>');
    }
    const messageContent = getMessageContent(message);
    const mediaInfo = findMediaInfo(message);

    console.log({phoneNumber, messageContent})

    const { data: user } = await axios.get(
      `${process.env.BACKEND_URL}/user/findByPhone/${phoneNumber}`
    );

    await wasender.send({
      messageType: "text",
      to: remoteJid,
      text: `Gracias ${user?.fullName || ''} por escribirnos. Hemos recibido tu mensaje y lo estamos gestionando. ¡Estamos conectados!`,
    });

    let file;
    if (mediaInfo?.[0]?.url) {
      const decryptedBuffer = await handleMediaDecryption(mediaInfo[0], mediaInfo[1], messageId);
      
      const extension = mediaInfo[0]?.mimetype ? mediaInfo[0].mimetype.split('/')[1] : 'bin';
      const uploadResult = await uploadFileFromBuffer(decryptedBuffer, extension, mediaInfo[0]?.mimetype);

      file = uploadResult.publicUrl || `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${uploadResult.filename}`;
    }
    await axios.post(`${process.env.BACKEND_URL}/message`, {
      conversationId: user?._id,
      author: user?._id,
      content: messageContent || '',
      attachment: file,
      attachmentType: mediaInfo?.[1],
    });

    return res.status(200).send('<Response>ok</Response>');
  } catch (error) {
    console.error('Error al procesar el mensaje:', error);
    return res.status(400).send("Hubo un error al procesar el mensaje");
  }
});

app.post('/send-message', async (req, res) => {
  try {
    const { conversationId, author, phone, content } = req.body;
    await wasender.send({
      messageType: "text",
      to: `57${phone}`,
      text: content,
    });

    const { data } = await axios.post(`${process.env.BACKEND_URL}/message`, {
      conversationId,
      author,
      content: content || '',
      attachment: null,
      attachmentType: null,
    });

    return res.status(200).json(data);
  } catch (error) {
    console.log({error})
    return res.status(400).send("Hubo un error al enviar el mensaje");
  }
})

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: {
      backendUrl: process.env.BACKEND_URL,
      gcpBucket: process.env.GCP_BUCKET_NAME,
      gcpProject: process.env.GCP_PROJECT_ID
    }
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});

/**
 * Extracts the text content/caption from a message object.
 * @param {any} messageObject - The message object from WhatsApp
 * @returns {string | null} The message content or null
 */
function getMessageContent(messageObject: any): string | null {
  if (!messageObject) return null;

  if (messageObject.conversation) {
    return messageObject.conversation;
  }

  if (messageObject?.documentWithCaptionMessage?.message?.documentMessage?.caption) {
    return messageObject?.documentWithCaptionMessage?.message?.documentMessage?.caption;
  }

  if (messageObject.imageMessage?.caption) {
    return messageObject.imageMessage.caption;
  }

  if (messageObject.videoMessage?.caption) {
    return messageObject.videoMessage.caption;
  }

  if (messageObject.documentMessage?.caption) {
    return messageObject.documentMessage.caption;
  }
  
  return null;
}

/**
 * Finds the first available media object and its type from the message.
 * @returns {[{url: string, mediaKey: string, mimetype: string, fileName?: string}, string]|null}
 */
function findMediaInfo(messageObject: any): [any, string] | null {
  const mediaKeys: { [key: string]: string } = {
    imageMessage: 'image',
    videoMessage: 'video',
    audioMessage: 'audio',
    documentMessage: 'document',
    stickerMessage: 'sticker',
  };

  if (messageObject?.documentWithCaptionMessage?.message?.documentMessage) {
    return [messageObject.documentWithCaptionMessage.message.documentMessage, 'document'];
  }

  for (const key in mediaKeys) {
    if (messageObject && messageObject[key]) {
      return [messageObject[key], mediaKeys[key]];
    }
  }
  return null;
}

/**
 * Derives decryption keys using HKDF.
 * @param {Buffer} mediaKeyBuffer - The decoded media key.
 * @param {string} mediaType - e.g., 'image', 'video'.
 * @returns {Promise<Buffer>} The 112-byte expanded key.
 */
function getDecryptionKeys(mediaKeyBuffer: Buffer, mediaType: string): Promise<Buffer> {
  const infoMap: { [key: string]: string } = {
    image: 'WhatsApp Image Keys',
    sticker: 'WhatsApp Image Keys',
    video: 'WhatsApp Video Keys',
    audio: 'WhatsApp Audio Keys',
    document: 'WhatsApp Document Keys',
  };

  const info = infoMap[mediaType];
  if (!info) {
    throw new Error(`Invalid media type: ${mediaType}`);
  }

  return new Promise((resolve, reject) => {
    crypto.hkdf('sha256', mediaKeyBuffer, '', info, 112, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(Buffer.from(derivedKey));
    });
  });
}

/**
 * Main function to decrypt and save a media file.
 */
async function handleMediaDecryption(mediaInfo: any, mediaType: string, messageId: string): Promise<Buffer> {
  const { url, mediaKey } = mediaInfo;
  if (!url || !mediaKey) {
    throw new Error("Media object is missing 'url' or 'mediaKey'.");
  }

  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const encryptedData = Buffer.from(response.data);

  const mediaKeyBuffer = Buffer.from(mediaKey, 'base64');
  const keys: Buffer = await getDecryptionKeys(mediaKeyBuffer, mediaType);
  const iv = keys.slice(0, 16);
  const cipherKey = keys.slice(16, 48);
  const macKey = keys.slice(48, 80);

  const ciphertext = encryptedData.slice(0, -10);
  
  const hmac = crypto.createHmac('sha256', macKey);
  hmac.update(iv);
  hmac.update(ciphertext);

  // 4. Decrypt using AES-256-CBC
  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  decipher.setAutoPadding(true);
  
  let decryptedData: Buffer;
  try {
    decryptedData = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    throw new Error('Failed to decrypt media file');
  }
  
  return decryptedData;
}

function normalizePhone(candidates: Array<string | undefined>): string | null {
  for (const candidate of candidates) {
    const sanitized = sanitizePhoneCandidate(candidate);
    if (!sanitized) continue;

    const digits = sanitized.replace(/\D/g, '');
    if (digits.length < 7) continue;

    if (digits.startsWith('1203630') && digits.length >= 15) {
      continue;
    }

    const withoutPrefix = digits.startsWith('57') && digits.length > 8
      ? digits.substring(2)
      : digits;

    if (withoutPrefix.length >= 7) {
      return withoutPrefix;
    }
  }
  return null;
}

function sanitizePhoneCandidate(rawValue?: string): string | null {
  if (!rawValue) return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const lowerValue = trimmed.toLowerCase();
  if (lowerValue.includes('@g.us') || lowerValue.includes('@broadcast')) {
    return null;
  }

  const beforeDomain = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  return beforeDomain || null;
}
