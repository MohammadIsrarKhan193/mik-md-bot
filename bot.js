// =========================
// ✨ MÎK-MD WhatsApp Bot ✨
// =========================

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadContentFromMessage
} from "@whiskeysockets/baileys"
import axios from "axios"
import Pino from "pino"
import fs from "fs"
import dotenv from "dotenv"
import ffmpeg from "fluent-ffmpeg"
import ffmpegPath from "ffmpeg-static"

dotenv.config()

// ENV
const AI_BACKEND_URL = process.env.AI_BACKEND_URL
const BOT_OWNER = process.env.BOT_OWNER || "Owner Not Set"

ffmpeg.setFfmpegPath(ffmpegPath)

// =========================
// MEDIA DOWNLOADER
// =========================
async function downloadMedia(msg, type) {
  const messageType =
    type === "image"
      ? msg.message.imageMessage
      : msg.message.videoMessage

  const stream = await downloadContentFromMessage(messageType, type)

  let buffer = Buffer.from([])

  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk])
  }

  return buffer
}

// =========================
// IMAGE → STICKER
// =========================
function imageToSticker(inputBuffer, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(Buffer.from(inputBuffer))
      .inputFormat("jpg")
      .outputOptions([
        "-vcodec libwebp",
        "-vf scale=512:512"
      ])
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject)
  })
}

// =========================
// VIDEO → STICKER
// =========================
function videoToSticker(inputBuffer, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(Buffer.from(inputBuffer))
      .inputFormat("mp4")
      .outputOptions([
        "-vcodec libwebp",
        "-vf scale=512:512:force_original_aspect_ratio=decrease,fps=14",
        "-loop 0"
      ])
      .save(outputPath)
      .on("end", resolve)
      .on("error", reject)
  })
}

// =========================
// MAIN BOT FUNCTION
// =========================
async function connectBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth")

  const sock = makeWASocket({
    logger: Pino({ level: "silent" }),
    auth: state,
    printQRInTerminal: true
  })

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode

      if (reason !== DisconnectReason.loggedOut) {
        console.log("Reconnecting…")
        connectBot()
      } else {
        console.log("Logged out. Delete auth folder to re-login.")
      }
    } else if (connection === "open") {
      console.log("🔥 MÎK-MD Bot Connected Successfully!")
    }
  })

  // =========================
  // MESSAGE HANDLER
  // =========================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid

    let text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      ""

    text = text.trim()

    console.log(`[MSG] ${from}: ${text}`)

    // =========================
    // MENU
    // =========================
    if (text === ".menu") {
      const menu = `
╔═══🔥 *MÎK-MD MENU* 🔥═══╗

🤖 *Basic Commands*
• .menu
• .ping
• .owner

🧠 *AI Commands*
• .ai <text>

🎨 *Sticker*
• Send image/video with caption: *.sticker*

📥 *Downloaders*
• .yt <url>
• .ig <url>
• .tt <url>

╚══════════════════════╝
      `
      return sock.sendMessage(from, { text: menu })
    }

    // =========================
    // PING
    // =========================
    if (text === ".ping") {
      return sock.sendMessage(from, { text: "Pong! 🏓" })
    }

    // =========================
    // OWNER
    // =========================
    if (text === ".owner") {
      return sock.sendMessage(from, {
        text: `Bot Owner:\n${BOT_OWNER}`
      })
    }

    // =========================
    // AI COMMAND
    // =========================
    if (text.startsWith(".ai ")) {
      const prompt = text.slice(4)

      try {
        await sock.sendPresenceUpdate("composing", from)

        const res = await axios.post(`${AI_BACKEND_URL}/chat`, {
          message: prompt
        })

        const reply = res.data.reply || "AI Error"

        return sock.sendMessage(from, {
          text: `🧠 *AI Reply:*\n${reply}`
        })
      } catch (e) {
        return sock.sendMessage(from, { text: "❌ AI Backend Error" })
      }
    }

    // =========================
    // IMAGE → STICKER
    // =========================
    if (msg.message.imageMessage && text.includes(".sticker")) {
      const buffer = await downloadMedia(msg, "image")
      const out = "./sticker.webp"

      await imageToSticker(buffer, out)
      const sticker = fs.readFileSync(out)

      await sock.sendMessage(from, { sticker })

      fs.unlinkSync(out)
      return
    }

    // =========================
    // VIDEO → STICKER
    // =========================
    if (msg.message.videoMessage && text.includes(".sticker")) {
      const buffer = await downloadMedia(msg, "video")
      const out = "./sticker.webp"

      await videoToSticker(buffer, out)
      const sticker = fs.readFileSync(out)

      await sock.sendMessage(from, { sticker })

      fs.unlinkSync(out)
      return
    }
  })
}

connectBot()
