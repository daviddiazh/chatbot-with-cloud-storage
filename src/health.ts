import dotenv from "dotenv";
dotenv.config();

import express from 'express';

const app = express();

app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    console.log('Servidor corriendo en el puerto: ', PORT);
});

const health = app;

export default health;