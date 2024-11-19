import dotenv from "dotenv";
dotenv.config();

import express from 'express';
import bodyParser from 'body-parser';
import twilio from 'twilio';
import axios from "axios";
import { uploadFile } from "./uploadFile";
import { parseSecret } from "./parse-secret";
import { getFile } from "./getTwilioFile";

const app = express();

app.use(bodyParser.urlencoded({ extended: false }));

app.post('/twilio-hook', async (req, res) => {

  const twiml = new twilio.twiml.MessagingResponse();
  const ctx = req.body;
  const { data: user } = await axios.get(
    `${process.env.BACKEND_URL}/user/findByPhone/${ctx?.WaId?.substring(
      2,
      ctx?.WaId?.length
    )}`
  );
  // if ( user?.role !== 'CLIENT' || user?.role !== 'ALLY' ) return;

  twiml.message(`Gracias ${user?.fullName} por escribirnos. Hemos recibido tu mensaje y lo estamos gestionando. ¡Estamos conectados!`);
  if (ctx?.MessageType !== "text") {
    parseSecret()
    let media = ctx?.MediaContentType0?.split('/')[1]
    if (media?.includes('ogg')) {
      media = 'mp3'
    }
    const url = await getFile(ctx?.MediaUrl0);
    const resp = await uploadFile(url, media);

    const urlParsed = `https://storage.cloud.google.com/${process.env.GCP_BUCKET_NAME}/${resp?.filename}`;
    await axios.post(`${process.env.BACKEND_URL}/message`, {
      userId: user?._id,
      content: ctx?.Body,
      attachment: urlParsed,
      attachmentType: media,
    });
    res.set('Content-Type', 'text/xml');
    res.send(twiml.toString());
    return;
  }
  await axios.post(`${process.env.BACKEND_URL}/message`, {
    userId: user?._id,
    content: ctx?.Body,
  });

  res.set('Content-Type', 'text/xml');
  res.send(twiml.toString());
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
