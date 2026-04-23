const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const pino = require('pino');
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    delay
} = require('@whiskeysockets/baileys');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Fix PayloadTooLargeError
app.use(express.static(path.join(__dirname, '../client')));

// Multi-session storage
const sessions = new Map();

io.on('connection', (socket) => {
    const clientId = socket.handshake.query.clientId;
    if (!clientId) return;

    socket.join(clientId);
    // console.log(`[SOCKET] Client connected: ${clientId}`);

    const session = sessions.get(clientId);
    if (session) {
        socket.emit('status', { status: session.waStatus });
        if (session.currentQR) {
            socket.emit('qr', session.currentQR);
        }
    } else {
        socket.emit('status', { status: 'disconnected' });
    }
});

// CLI Spinner UI Utility
class Spinner {
    constructor() {
        this.timer = null;
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.i = 0;
        this.text = '';
    }
    start(text) {
        this.text = text;
        this.timer = setInterval(() => {
            process.stdout.write(`\r\x1b[36m${this.frames[this.i]}\x1b[0m ${this.text}`);
            this.i = (this.i + 1) % this.frames.length;
        }, 100);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            process.stdout.write('\r\x1b[K');
        }
    }
    succeed(text) {
        this.stop();
        console.log(`\x1b[32m[✓]\x1b[0m ${text || this.text}`);
    }
    info(text) {
        this.stop();
        console.log(`\x1b[34m[i]\x1b[0m ${text}`);
    }
    fail(text) {
        this.stop();
        console.log(`\x1b[31m[x]\x1b[0m ${text}`);
    }
}

const spinner = new Spinner();

function sendLog(clientId, msg, type = 'info') {
    io.to(clientId).emit('log', { message: msg, type });
}

function updateStatus(clientId, status) {
    const session = sessions.get(clientId) || {};
    session.waStatus = status;
    sessions.set(clientId, session);
    io.to(clientId).emit('status', { status });
}

async function connectToWhatsApp(clientId) {
    if (!clientId) return;
    
    // spinner.info(`[${clientId}] Menghubungkan ke WhatsApp...`);
    
    const sessionDir = path.join(__dirname, '../sessions', clientId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    let sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop')
    });

    // Store socket in session
    const currentSession = sessions.get(clientId) || { waStatus: 'disconnected', currentQR: null };
    currentSession.sock = sock;
    sessions.set(clientId, currentSession);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // spinner.info(`[${clientId}] Generate QR Code...`);
            try {
                const qrUrl = await QRCode.toDataURL(qr);
                const session = sessions.get(clientId);
                if (session) {
                    session.currentQR = qrUrl;
                    io.to(clientId).emit('qr', qrUrl);
                }
            } catch (err) {
                // console.error('Failed to generate QR data url', err);
            }
        }

        if (connection === 'close') {
            updateStatus(clientId, 'disconnected');
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            const reason = lastDisconnect?.error?.message || 'Unknown Reason';
            
            sendLog(clientId, `Koneksi terputus: ${reason}. Reconnecting: ${shouldReconnect}`, 'error');
            
            if (shouldReconnect) {
                // Clear QR on disconnect to avoid confusion
                const session = sessions.get(clientId);
                if (session) session.currentQR = null;
                
                sendLog(clientId, 'Mencoba menyambung kembali dalam 5 detik...', 'info');
                setTimeout(() => connectToWhatsApp(clientId), 5000);
            } else {
                sendLog(clientId, 'Sesi Invalid / Logout. Silakan reset sesi.', 'error');
                // Cleanup session folder if logged out
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
                const session = sessions.get(clientId);
                if (session) {
                    session.sock = null;
                    session.currentQR = null;
                }
            }
        } else if (connection === 'open') {
            updateStatus(clientId, 'connected');
            sendLog(clientId, 'WhatsApp terhubung!', 'success');
            const session = sessions.get(clientId);
            if (session) {
                session.currentQR = null;
                io.to(clientId).emit('qr', null);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Format Phone Number Helper
function formatNumber(number) {
    let str = number.toString().trim();

    // Jika mulai dengan '00', itu format call international, anggap sebagai kode negara
    if (str.startsWith('00')) {
        str = str.substring(2);
    } 
    // Jika mulai dengan '0' biasa, asumsikan itu format lokal Indonesia -> 62
    else if (str.startsWith('0')) {
        str = '62' + str.substring(1);
    }

    // Ekstrak semua angka (membuang +, spasi, - dll)
    let formatted = str.replace(/\D/g, '');
    
    if (!formatted.endsWith('@s.whatsapp.net')) {
        formatted += '@s.whatsapp.net';
    }
    return formatted;
}

// Random Delay (Speed up: 300ms - 800ms)
const randomDelay = () => Math.floor(Math.random() * (800 - 300 + 1) + 300);

// API Endpoints

app.post('/check', async (req, res) => {
    const { number, clientId } = req.body;
    const session = sessions.get(clientId);

    if (!session || session.waStatus !== 'connected' || !session.sock) {
        return res.status(500).json({ status: false, message: 'WhatsApp is not connected' });
    }

    if (!number) return res.status(400).json({ status: false, message: 'Number is required' });

    try {
        const jid = formatNumber(number);
        const [result] = await session.sock.onWhatsApp(jid);

        if (result && result.exists) {
            let bio = null;
            let business = null;
            let verified = false;

            try {
                const status = await session.sock.fetchStatus(jid);
                bio = status?.status || null;
            } catch (e) {}

            try {
                business = await session.sock.getBusinessProfile(jid);
                if (business) {
                    // Check for verification
                    // In Baileys, business profiles might have verifiedLevel
                    // 0: Not verified, 1: Verified (sometimes 2/3 for official)
                    verified = business.verifiedLevel > 0;
                }
            } catch (e) {}

            const responseData = { 
                number: number, 
                exists: true, 
                jid: result.jid,
                bio: bio,
                isBusiness: !!business,
                isVerified: verified,
                businessDetails: business
            };

            sendLog(clientId, `[SATUAN] ${number} -> AKTIF ${bio ? `(Bio: ${bio})` : ''}`, 'success');
            io.to(clientId).emit('check_result', responseData);
            res.json(responseData);
        } else {
            sendLog(clientId, `[SATUAN] ${number} -> TIDAK AKTIF`, 'error');
            io.to(clientId).emit('check_result', { number: number, exists: false });
            res.json({ exists: false, jid: null, number: number });
        }
    } catch (error) {
        // console.error(error);
        sendLog(clientId, `[SATUAN] Error cek ${number}`, 'error');
        res.status(500).json({ status: false, message: 'Server error check WhatsApp' });
    }
});

app.post('/check-bulk', async (req, res) => {
    const { numbers, clientId } = req.body;
    const session = sessions.get(clientId);

    if (!session || session.waStatus !== 'connected' || !session.sock) {
        return res.status(500).json({ status: false, message: 'WhatsApp is not connected' });
    }

    if (!numbers || !Array.isArray(numbers)) {
        return res.status(400).json({ status: false, message: 'Numbers strictly requires an array' });
    }

    sendLog(clientId, `Mulai mengecek batch ${numbers.length} nomor...`, 'info');
    res.socket.setTimeout(0);
    
    // Reset stop flag for new session
    session.isStopping = false;

    let results = [];
    for (let i = 0; i < numbers.length; i++) {
        // Check if stop was requested
        if (session.isStopping) {
            sendLog(clientId, `Pengecekan dihentikan oleh user. (${i}/${numbers.length} selesai)`, 'error');
            session.isStopping = false; // Reset for next time
            break;
        }

        const num = numbers[i];
        try {
            const jid = formatNumber(num);
            const [waReq] = await session.sock.onWhatsApp(jid);
            
            if (waReq && waReq.exists) {
                let bio = null;
                let business = null;
                let verified = false;

                try {
                    const status = await session.sock.fetchStatus(jid);
                    bio = status?.status || null;
                } catch (e) {}

                try {
                    business = await session.sock.getBusinessProfile(jid);
                    if (business) {
                        verified = business.verifiedLevel > 0;
                    }
                } catch (e) {}

                const resultItem = { 
                    number: num, 
                    exists: true, 
                    jid: waReq.jid,
                    bio: bio,
                    isBusiness: !!business,
                    isVerified: verified
                };

                results.push(resultItem);
                sendLog(clientId, `[BATCH ${i+1}/${numbers.length}] ✅ ${num} AKTIF ${bio ? `(Bio: ${bio})` : ''}`, 'success');
                io.to(clientId).emit('check_result', resultItem);
            } else {
                results.push({ number: num, exists: false, jid: null });
                sendLog(clientId, `[BATCH ${i+1}/${numbers.length}] ❌ ${num} TIDAK AKTIF`, 'error');
                io.to(clientId).emit('check_result', { number: num, exists: false });
            }
        } catch (e) {
            results.push({ number: num, exists: false, error: true });
            sendLog(clientId, `[BATCH ${i+1}/${numbers.length}] 🛑 ${num} ERROR Pengecekan`, 'error');
        }

        if (i < numbers.length - 1) {
            const waitTime = randomDelay();
            await delay(waitTime);
        }
    }

    sendLog(clientId, `Batch selesai! Total dicek: ${results.length}`, 'success');
    res.json(results);
});

app.post('/stop', (req, res) => {
    const { clientId } = req.body;
    const session = sessions.get(clientId);
    
    if (session) {
        session.isStopping = true;
        sendLog(clientId, 'Mengirim perintah STOP...', 'info');
        res.json({ status: true });
    } else {
        res.status(404).json({ status: false, message: 'Session not found' });
    }
});

app.post('/logout', async (req, res) => {
    const { clientId } = req.body;
    const session = sessions.get(clientId);

    try {
        updateStatus(clientId, 'disconnected');
        sendLog(clientId, 'Logging out and deleting session...', 'info');

        if (session && session.sock) {
            try {
                session.sock.end();
            } catch (e) {
                // console.log('Error ending socket:', e.message);
            }
            session.sock = null;
        }

        const sessionPath = path.join(__dirname, '../sessions', clientId);
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
            // console.log(`[${clientId}] Session deleted.`);
        }

        res.json({ status: true, message: 'Logged out successfully' });

        // Restart to show new QR
        setTimeout(() => connectToWhatsApp(clientId), 1500);

    } catch (error) {
        // console.error('Logout error:', error);
        res.status(500).json({ status: false, message: 'Failed to logout' });
    }
});

app.post('/init', (req, res) => {
    const { clientId } = req.body;
    if (!clientId) return res.status(400).send('Client ID is required');
    
    if (!sessions.has(clientId)) {
        connectToWhatsApp(clientId);
    }
    res.json({ status: true });
});

// Start Server
const PORT = process.env.PORT || 3005;
server.listen(PORT, async () => {
    // console.log(`\x1b[36m[*] Server running at http://localhost:${PORT}\x1b[0m`);
    
    // Auto-reconnect existing sessions
    const sessionsDir = path.join(__dirname, '../sessions');
    if (fs.existsSync(sessionsDir)) {
        const dirs = fs.readdirSync(sessionsDir);
        for (const clientId of dirs) {
            // console.log(`[*] Restoring session: ${clientId}`);
            connectToWhatsApp(clientId);
        }
    }
});
