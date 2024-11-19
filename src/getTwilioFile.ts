import dotenv from 'dotenv'
dotenv.config()

import axios from 'axios'

export const getFile = async (url: string) => {
    const { data } = await axios({
        url: url,
        method: 'GET',
        responseType: 'stream',
        headers: {
            Authorization: `Basic ${process.env.TWILIO_KEY_API}`
        }
    })
    return data;
}