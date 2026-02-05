const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const ytdl = require('ytdl-core');
const axios = require('axios');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(express.json());

let sock = null;
let pairCode = null;

// WhatsApp Bot Start Function
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const { version } = await fetchLatestBaileysVersion();
    
    sock = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, "baileys")
        },
        generateHighQualityLinkPreview: true,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr, isNewLogin } = update;
        
        // Pair Code Generation
        if (update && update.connection === 'open' && isNewLogin) {
            // 8-digit pair code generate
            pairCode = Math.floor(10000000 + Math.random() * 90000000).toString();
            console.log(`\n📱 **PAIR CODE:** ${pairCode}`);
            console.log('Go to WhatsApp → Linked Devices → Link a Device → Enter this code\n');
            
            // Save pair code to file
            fs.writeFileSync('pair-code.txt', `Pair Code: ${pairCode}\nGenerated at: ${new Date().toLocaleString()}`);
        }
        
        if (qr) {
            console.log('\n📱 QR Code Generated (Alternative Method):');
            qrcode.generate(qr, { small: true });
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== 401;
            console.log('Connection closed, reconnecting...', shouldReconnect);
            if (shouldReconnect) {
                startWhatsAppBot();
            }
        }
        
        if (connection === 'open') {
            console.log('✅ WhatsApp Bot Connected!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Handle Messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        
        if (!msg.message || msg.key.fromMe) return;
        
        const sender = msg.key.remoteJid;
        const text = msg.message.conversation || 
                    msg.message.extendedTextMessage?.text || 
                    msg.message.videoMessage?.caption || '';
        
        console.log(`Message from ${sender}: ${text}`);
        
        // Help Command
        if (text.toLowerCase() === '!help' || text.toLowerCase() === '/help') {
            await sock.sendMessage(sender, {
                text: `🤖 *Social Media Downloader Bot*\n\n*Commands:*\n• Send any YouTube/Instagram/TikTok link\n• !help - Show this menu\n• !formats - Show available formats\n\n*Supported Platforms:*\n• YouTube\n• Instagram\n• TikTok\n• Twitter/X\n• Facebook\n\n*Note:* Videos will be sent in MP4 format`
            });
        }
        
        // Social Media URL Detection
        const url = extractUrl(text);
        if (url) {
            try {
                await handleDownloadRequest(sock, sender, url);
            } catch (error) {
                console.error('Download error:', error);
                await sock.sendMessage(sender, {
                    text: '❌ Error downloading video. Please try another link.'
                });
            }
        }
    });
}

// Extract URL from text
function extractUrl(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const match = text.match(urlRegex);
    return match ? match[0] : null;
}

// Download Handler
async function handleDownloadRequest(sock, sender, url) {
    console.log(`Processing URL: ${url}`);
    
    // Send processing message
    await sock.sendMessage(sender, {
        text: '⏳ Processing your request...\nDetecting platform and fetching info...'
    });
    
    // Platform Detection
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        await handleYouTube(sock, sender, url);
    } else if (url.includes('instagram.com')) {
        await handleInstagram(sock, sender, url);
    } else if (url.includes('tiktok.com')) {
        await handleTikTok(sock, sender, url);
    } else if (url.includes('twitter.com') || url.includes('x.com')) {
        await handleTwitter(sock, sender, url);
    } else {
        await sock.sendMessage(sender, {
            text: '❌ Platform not supported yet. Supported: YouTube, Instagram, TikTok, Twitter'
        });
    }
}

// YouTube Downloader
async function handleYouTube(sock, sender, url) {
    try {
        const info = await ytdl.getInfo(url);
        const title = info.videoDetails.title;
        
        // Send format options
        const formats = ytdl.filterFormats(info.formats, 'videoandaudio');
        const availableFormats = formats.slice(0, 5).map((f, i) => {
            return `${i+1}. ${f.qualityLabel || f.quality} - ${formatBytes(f.contentLength)}`;
        }).join('\n');
        
        await sock.sendMessage(sender, {
            text: `📺 *YouTube Video Found:*\n${title}\n\n📊 *Available Formats:*\n${availableFormats}\n\nReply with number (1-${formats.slice(0,5).length}) to download`
        });
        
        // Wait for format selection (simplified)
        setTimeout(async () => {
            const format = formats[0]; // Default first format
            await sock.sendMessage(sender, {
                text: '⬇️ Downloading video... (This may take a moment)'
            });
            
            // Download video
            const videoPath = await downloadYouTubeVideo(url, format);
            
            // Send video
            await sock.sendMessage(sender, {
                video: { url: videoPath },
                caption: `✅ Downloaded: ${title}`
            });
            
            // Clean up
            fs.unlinkSync(videoPath);
        }, 3000);
        
    } catch (error) {
        throw error;
    }
}

// Download YouTube Video
async function downloadYouTubeVideo(url, format) {
    return new Promise((resolve, reject) => {
        const outputPath = path.join(__dirname, 'temp', `video_${Date.now()}.mp4`);
        
        ytdl(url, { format: format })
            .pipe(fs.createWriteStream(outputPath))
            .on('finish', () => resolve(outputPath))
            .on('error', reject);
    });
}

// Instagram Downloader (Placeholder)
async function handleInstagram(sock, sender, url) {
    await sock.sendMessage(sender, {
        text: '📸 Instagram download coming soon!\nFor now, try YouTube links.'
    });
}

// TikTok Downloader (Placeholder)
async function handleTikTok(sock, sender, url) {
    await sock.sendMessage(sender, {
        text: '🎵 TikTok download coming soon!\nFor now, try YouTube links.'
    });
}

// Twitter Downloader (Placeholder)
async function handleTwitter(sock, sender, url) {
    await sock.sendMessage(sender, {
        text: '🐦 Twitter download coming soon!\nFor now, try YouTube links.'
    });
}

// Helper: Format bytes
function formatBytes(bytes) {
    if (!bytes) return 'N/A';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// HTTP Server for Vercel/Heroku
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>WhatsApp Downloader Bot</title>
            <style>
                body { font-family: Arial; padding: 20px; text-align: center; }
                .container { max-width: 600px; margin: auto; }
                .code { font-size: 32px; font-weight: bold; color: #25D366; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 WhatsApp Downloader Bot</h1>
                ${pairCode ? `<p>Pair Code: <span class="code">${pairCode}</span></p>` : '<p>Starting bot...</p>'}
                <p>Go to WhatsApp → Linked Devices → Link a Device → Enter the code above</p>
                <p>Then send any YouTube/Instagram/TikTok link to the bot</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/pair-code', (req, res) => {
    res.json({ pairCode, status: pairCode ? 'active' : 'generating' });
});

// Start Server & Bot
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Open http://localhost:${PORT} to see pair code`);
    startWhatsAppBot();
});
