import dotenv from "dotenv";
dotenv.config();
import fs from 'fs'

export const parseSecret = async () => {
    const secret = process.env.SECRET_TEXT;

    if (!secret) {
        throw new Error("SECRET_TEXT is not defined");
    }

    fs.writeFileSync('./secrets.json', secret as any)
}