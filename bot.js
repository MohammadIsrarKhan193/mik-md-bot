// MÎK-MD WhatsApp Bot
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason
} from "@whiskeysockets/baileys"
import axios from "axios"
import Pino from "pino"
import fs from "fs"
import dotenv from "dotenv"
import ffmpeg from "fluent-ffmpeg"
import ffmpegPath from "ffmpeg-static"

dotenv.config()

const AI_BACKEND_URL = process.env.AI_BACKEND_URL
const BOT_OWNER = process.env.BOT_OWNER || "Owner Not Set"

ffmpeg.setFfmpegPath(ffmpegPath)

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

  // MESSAGE LISTENER
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return

    const from = msg.key.remoteJid

    // extract message text
    let text = msg.message.conversation ||
               msg.message.extendedTextMessage?.text ||
               msg.message.imageMessage?.caption ||
               msg.message.videoMessage?.caption ||
               ""

    text = text.trim()

    console.log(`[MSG] ${from}: ${text}`)

    // ===== COMMANDS =====

    // FANCY MENU
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
• .yt <url> – YouTube Video
• .ig <url> – Instagram Reel
• .tt <url> – TikTok Video

╚══════════════════════╝
      `
      return sock.sendMessage(from, { text: menu })
    }

    // PING
    if (text === ".ping") {
      return sock.sendMessage(from, { text: "Pong! 🏓" })
    }

    // OWNER
    if (text === ".owner") {
      return sock.sendMessage(from, { text: `Bot Owner:\n${BOT_OWNER}` })
    }

    // ⭐ AI COMMAND
    if (text.startsWith(".ai ")) {
      const prompt = text.slice(4)

      try {
        await sock.sendPresenceUpdate("composing", from)

        const res = await axios.post(
          `${AI_BACKEND_URL}/chat`,
          { message: prompt }
        )

        const reply = res.data.reply || "No response from AI"

        return sock.sendMessage(from, { text: `🧠 *AI Reply:*\n${reply}` })
      } catch (e) {
        return sock.sendMessage(from, { text: "AI Backend Error ❌" })
      }
    }

    // ⭐ STICKER MAKER
    if (msg.message.imageMessage && text === ".sticker") {
      const buffer = await downloadMedia(msg, "image")
      const out = "./sticker.webp"

      await imageToSticker(buffer, out)
      const sticker = fs.readFileSync(out)

      await sock.sendMessage(from, { sticker })

      fs.unlinkSync(out)
      return
    }

    if (msg.message.videoMessage && text === ".sticker") {
      const buffer = await downloadMedia(msg, "video")
      const out = "./sticker.webp"

      await videoToSticker(buffer, out)
      const sticker = fs.readFileSync(out)

      await sock.sendMessage(from, { sticker })

      fs.unlinkSync(out)
      return
    }

    // ====== DOWNLOADERS ======

    // TikTok
    if (text.startsWith(".tt ")) {
      const url = text.split(" ")[1]
      return tiktokDownloader(url, sock, from)
    }

    // Instagram
    if (text.startsWith(".ig ")) {
      const url = text.split(" ")[1]
      return instagramDownloader(url, sock, from)
    }

    // YouTube Downloader
    if (text.startsWith(".yt ")) {
      const url = text.split(" ")[1]
      return youtubeDownloader(url, sock, from)
    }
  })
}

connectBot()

// =========================
//   FUNCTIONS
// =========================

async function downloadMedia(msg, type) {
  const buffer = await downloadContentFromMessage(
    msg.message[`${type}Message`],
    type
  )
  let data = Buffer.from([])
  for await (const chunk of buffer) {
    data = Buffer.concat([data, chunk])
  }
  return data
}

// IMAGE TO STICKER
function imageToSticker(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input)
      .outputOptions(["-vf", "scale=512:512:force_original_aspect_ratio=decrease"])
      .save(output)
      .on("end", resolve)
      .on("error", reject)
  })
}

// VIDEO TO STICKER
function videoToSticker(input, output) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(input)
      .outputOptions([
        "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
        "-t", "8"
      ])
      .save(output)
      .on("end", resolve)
      .on("error", reject)
  })
}

// TikTok Downloader
async function tiktokDownloader(url, sock, from) {
  try {
    await sock.sendMessage(from, { text: "Downloading from TikTok... ⏳" })
    
    const res = await axios.get(`https://api.xyroinee.xyz/api/tiktokdl?url=${url}`)
    const video = res.data.data.play

    await sock.sendMessage(from, {
      video: { url: video },
      caption: "TikTok Downloaded ✓"
    })
  } catch (e) {
    sock.sendMessage(from, { text: "❌ TikTok download failed." })
  }
}

// Instagram Downloader
async function instagramDownloader(url, sock, from) {
  try {
    await sock.sendMessage(from, { text: "Downloading Instagram Reel... ⏳" })

    const res = await axios.get(`https://itzpire.site/download/instagram?url=${url}`)
    const video = res.data.result.url[0].url

    await sock.sendMessage(from, {
      video: { url: video },
      caption: "Instagram Downloaded ✓"
    })
  } catch (e) {
    sock.sendMessage(from, { text: "❌ Instagram download failed." })
  }
}

// YouTube Downloader
async function youtubeDownloader(url, sock, from) {
  try {
    await sock.sendMessage(from, { text: "Downloading YouTube Video... ⏳" })

    const res = await axios.get(`https://api.agatz.xyz/api/ytdown?url=${url}`)
    const video = res.data.result.video

    await sock.sendMessage(from, {
      video: { url: video },
      caption: "YouTube Downloaded ✓"
    })
  } catch (e) {
    sock.sendMessage(from, { text: "❌ YouTube download failed." })
  }
}
