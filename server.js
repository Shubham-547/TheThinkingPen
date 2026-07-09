import express from "express";
import cookieParser from "cookie-parser";
import { generateState, generateCodeVerifier, Google } from "arctic";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import multer from "multer";
import helmet from "helmet";
import fs from "fs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "..", ".env") });
const publicDir = path.join(__dirname, "..", "..", "public");

// "private" folder — yahan rakhi file (content-detail.html) express.static se KABHI serve nahi hoti.
// Sirf hamara guarded route (neeche) hi, server-side verification ke baad, isse seedhi padh kar bhej sakta hai.
const privateDir = path.join(__dirname, "..", "..", "private");
fs.mkdirSync(privateDir, { recursive: true });

// Upload folders ensure karna (agar exist nahi karte to bana dena)
fs.mkdirSync(path.join(publicDir, "uploads"), { recursive: true });
fs.mkdirSync(path.join(publicDir, "uploads", "content"), { recursive: true });

const app = express();

// 🔧 TOGGLE: development ke liye false rakho, host/production karte waqt true kar dena
const OTP_ENABLED = false;
app.use(express.json());
app.use(cookieParser());
app.use(helmet({ contentSecurityPolicy: false }));

// Multer Storage Setup for Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(publicDir, "uploads"));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage, 
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'), false);
        }
    }
});

// Content (Hero/Cards) Upload Setup — images AND videos allowed, bigger size limit
const contentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(publicDir, "uploads", "content"));
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'content-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const contentUpload = multer({
    storage: contentStorage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — video files ke liye zyada space
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image or video files are allowed!'), false);
        }
    }
});

// Database Connection
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

pool.getConnection()
    .then(async (conn) => {
        console.log("✅ MySQL connected successfully.");
        conn.release();

        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS otp_verifications (
                    email VARCHAR(190) PRIMARY KEY,
                    otp_hash VARCHAR(255) NOT NULL,
                    attempts INT NOT NULL DEFAULT 0,
                    verified TINYINT NOT NULL DEFAULT 0,
                    verify_token VARCHAR(64) DEFAULT NULL,
                    token_expires_at DATETIME DEFAULT NULL,
                    otp_expires_at DATETIME NOT NULL,
                    last_sent_at DATETIME NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                )
            `);
            console.log("✅ otp_verifications table ready.");

            try {
                const [cols] = await pool.query(`SHOW COLUMNS FROM otp_verifications`);
                const colNames = cols.map(c => c.Field);
                const hasEmail = colNames.includes('email');
                const hasMobile = colNames.includes('mobile');

                if (!hasEmail && hasMobile) {
                    console.log("⚠️  Purana 'mobile' based otp_verifications table mila — naye 'email' schema mein migrate kiya ja raha hai...");
                    await pool.query(`DROP TABLE otp_verifications`);
                    await pool.query(`
                        CREATE TABLE otp_verifications (
                            email VARCHAR(190) PRIMARY KEY,
                            otp_hash VARCHAR(255) NOT NULL,
                            attempts INT NOT NULL DEFAULT 0,
                            verified TINYINT NOT NULL DEFAULT 0,
                            verify_token VARCHAR(64) DEFAULT NULL,
                            token_expires_at DATETIME DEFAULT NULL,
                            otp_expires_at DATETIME NOT NULL,
                            last_sent_at DATETIME NOT NULL,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        )
                    `);
                    console.log("✅ otp_verifications table migrate ho gaya (mobile → email).");
                }
            } catch (migErr) {
                console.error("❌ otp_verifications auto-migration failed:", migErr.message);
            }
        } catch (e) {
            console.error("❌ otp_verifications table create failed:", e.message);
        }

        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS account_submissions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    content_type VARCHAR(20) NOT NULL,
                    first_name VARCHAR(100) NOT NULL,
                    surname VARCHAR(100) DEFAULT NULL,
                    age INT NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    address VARCHAR(255) NOT NULL,
                    email VARCHAR(190) NOT NULL,
                    password_hash VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("✅ account_submissions table ready.");
        } catch (e) {
            console.error("❌ account_submissions table create failed:", e.message);
        }

        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS content_submissions (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    content_type VARCHAR(20) NOT NULL,
                    author_name VARCHAR(150) NOT NULL,
                    author_email VARCHAR(190) DEFAULT NULL,
                    author_age INT DEFAULT NULL,
                    author_role VARCHAR(50) DEFAULT NULL,
                    website_id VARCHAR(20) DEFAULT NULL,
                    title VARCHAR(255) NOT NULL,
                    description TEXT,
                    content_html LONGTEXT NOT NULL,
                    cover_media_url VARCHAR(500) DEFAULT NULL,
                    cover_media_type VARCHAR(10) DEFAULT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    reviewed_at TIMESTAMP NULL DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log("✅ content_submissions table ready.");

            const [csCols] = await pool.query(`SHOW COLUMNS FROM content_submissions`);
            const csColNames = csCols.map(c => c.Field);
            if (!csColNames.includes('status')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending'`);
                console.log("✅ content_submissions: 'status' column add ho gaya.");
            }
            if (!csColNames.includes('reviewed_at')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN reviewed_at TIMESTAMP NULL DEFAULT NULL`);
                console.log("✅ content_submissions: 'reviewed_at' column add ho gaya.");
            }
            if (!csColNames.includes('author_email')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN author_email VARCHAR(190) DEFAULT NULL`);
                console.log("✅ content_submissions: 'author_email' column add ho gaya.");
            }
            if (!csColNames.includes('author_age')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN author_age INT DEFAULT NULL`);
                console.log("✅ content_submissions: 'author_age' column add ho gaya.");
            }
            if (!csColNames.includes('author_role')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN author_role VARCHAR(50) DEFAULT NULL`);
                console.log("✅ content_submissions: 'author_role' column add ho gaya.");
            }
            if (!csColNames.includes('website_id')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN website_id VARCHAR(20) DEFAULT NULL`);
                console.log("✅ content_submissions: 'website_id' column add ho gaya.");
            }
        } catch (e) {
            console.error("❌ content_submissions table create/migrate failed:", e.message);
        }

        // ===== card_type column add karna post_likes / post_comments / post_reports mein =====
        // Isse type (article/poem/story) hamesha snapshot ke roop mein save hoga,
        // aur baad mein content delete/edit hone par bhi "Unknown" nahi dikhega.
        const tablesToMigrate = ['post_likes', 'post_comments', 'post_reports'];
        for (const tbl of tablesToMigrate) {
            try {
                const [cols] = await pool.query(`SHOW COLUMNS FROM ${tbl}`);
                const colNames = cols.map(c => c.Field);
                if (!colNames.includes('card_type')) {
                    await pool.query(`ALTER TABLE ${tbl} ADD COLUMN card_type VARCHAR(20) DEFAULT NULL`);
                    console.log(`✅ ${tbl}: 'card_type' column add ho gaya.`);
                }
            } catch (e) {
                console.error(`⚠️ ${tbl}: 'card_type' column check/add skip (table shayad exist nahi karti):`, e.message);
            }
        }

        // ===== One-time backfill: purani entries ke liye card_type home_cards se fill karo =====
        try {
            const cardIdCol = { post_likes: 'post_id', post_comments: 'card_id', post_reports: 'card_id' };
            for (const tbl of tablesToMigrate) {
                const col = cardIdCol[tbl];
                await pool.query(`
                    UPDATE ${tbl} t
                    JOIN home_cards hc ON t.${col} = hc.card_id
                    SET t.card_type = hc.badge_text
                    WHERE t.card_type IS NULL AND hc.badge_text IS NOT NULL AND hc.badge_text <> ''
                `);
            }
            console.log("✅ card_type backfill (likes/comments/reports) complete.");
        } catch (e) {
            console.error("⚠️ card_type backfill skip:", e.message);
        }
        // ===== unique_id (content_submissions), linked_content_id (home_cards), hero_read_target (site_settings) =====
        try {
            const [csCols] = await pool.query(`SHOW COLUMNS FROM content_submissions`);
            const csColNames = csCols.map(c => c.Field);
            if (!csColNames.includes('unique_id')) {
                await pool.query(`ALTER TABLE content_submissions ADD COLUMN unique_id VARCHAR(12) DEFAULT NULL`);
                console.log("✅ content_submissions: 'unique_id' column add ho gaya.");
            }
        } catch (e) { console.error("⚠️ content_submissions unique_id migrate skip:", e.message); }

        try {
            const [hcCols] = await pool.query(`SHOW COLUMNS FROM home_cards`);
            const hcColNames = hcCols.map(c => c.Field);
            if (!hcColNames.includes('linked_content_id')) {
                await pool.query(`ALTER TABLE home_cards ADD COLUMN linked_content_id VARCHAR(30) DEFAULT NULL`);
                console.log("✅ home_cards: 'linked_content_id' column add ho gaya.");
            }
        } catch (e) { console.error("⚠️ home_cards linked_content_id migrate skip:", e.message); }

        try {
            const [ssCols] = await pool.query(`SHOW COLUMNS FROM site_settings`);
            const ssColNames = ssCols.map(c => c.Field);
            if (!ssColNames.includes('hero_read_target')) {
                await pool.query(`ALTER TABLE site_settings ADD COLUMN hero_read_target VARCHAR(30) DEFAULT NULL`);
                console.log("✅ site_settings: 'hero_read_target' column add ho gaya.");
            }
        } catch (e) { console.error("⚠️ site_settings hero_read_target migrate skip:", e.message); }
    })
    .catch((err) => console.error("❌ MySQL FAILED:", err.message));

// Har naye Article/Poem/Story ke liye unique 12-digit ID generate karta hai (DB mein duplicate check ke sath)
async function generateUnique12DigitId() {
    for (let attempt = 0; attempt < 10; attempt++) {
        let id = '';
        for (let i = 0; i < 12; i++) id += Math.floor(Math.random() * 10);
        const [existing] = await pool.query('SELECT id FROM content_submissions WHERE unique_id = ?', [id]);
        if (existing.length === 0) return id;
    }
    // Fallback (bahut hi rare case): timestamp-based
    return (Date.now() % 1000000000000).toString().padStart(12, '0');
}

let cachedTransporter = null;
async function getMailTransporter() {
    if (cachedTransporter) return cachedTransporter;
    const nodemailerModule = await import("nodemailer");
    cachedTransporter = nodemailerModule.default.createTransport({
        service: "gmail",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
    return cachedTransporter;
}

async function sendEmailOtp(toEmail, otp) {
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpUser && smtpPass) {
        try {
            const transporter = await getMailTransporter();
            await transporter.sendMail({
                from: `"WriteVerse" <${smtpUser}>`,
                to: toEmail,
                subject: "Your WriteVerse Verification Code",
                text: `Your WriteVerse verification code is ${otp}. It will expire in 5 minutes. Do not share this code with anyone.`,
                html: `<p>Your WriteVerse verification code is <b>${otp}</b>.</p><p>It will expire in 5 minutes. Do not share this code with anyone.</p>`
            });
            return true;
        } catch (e) {
            console.error("❌ Email OTP send failed:", e.message);
            return false;
        }
    } else {
        console.log(`📧 [DEV MODE] OTP for ${toEmail}: ${otp}  (Real email bhejne ke liye .env mein SMTP_USER, SMTP_PASS set karo aur "npm install nodemailer" karo)`);
        return true;
    }
}

const google = new Google(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "http://localhost:3000/login/google/callback"
);

async function generateUniqueId() {
    let id;
    let taken = true;
    while (taken) {
        const digitLength = 10 + Math.floor(Math.random() * 3);
        const min = Math.pow(10, digitLength - 1);
        const max = Math.pow(10, digitLength) - 1;
        id = String(Math.floor(min + Math.random() * (max - min)));
        const [rows] = await pool.query('SELECT id FROM users WHERE uniqueId = ?', [id]);
        taken = rows.length > 0;
    }
    return id;
}

function setSessionCookie(res, user) {
    res.cookie("session_id", user.uniqueId, {
        httpOnly: true, 
        secure: process.env.NODE_ENV === "production", 
        sameSite: "lax", 
        maxAge: 1000 * 60 * 60 * 24 * 30
    });
}

function clearSessionCookie(res) {
    res.clearCookie("session_id");
}

async function logHistory(adminUsername, section, cardId, oldValue, newValue) {
    try {
        await pool.query(
            'INSERT INTO content_history (admin_username, section, card_id, old_value, new_value) VALUES (?, ?, ?, ?, ?)',
            [adminUsername, section, cardId || null, oldValue ?? null, newValue ?? null]
        );
    } catch (error) {
        console.error("History log failed:", error.message);
    }
}

const EXT_BY_MIME = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/ogg": ".ogv"
};

async function downloadMediaFromUrl(url, allowedPrefix) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("URL se file download nahi ho payi.");
    }
    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim();

    if (!contentType.startsWith(allowedPrefix)) {
        const err = new Error(allowedPrefix === 'image/' ? "WRONG_TYPE_NOT_IMAGE" : "WRONG_TYPE_NOT_VIDEO");
        throw err;
    }

    const arrBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrBuffer);

    if (buffer.length > 20 * 1024 * 1024) {
        throw new Error("File 20MB se bada hai, allowed nahi hai.");
    }

    const ext = EXT_BY_MIME[contentType] || (allowedPrefix === 'image/' ? '.jpg' : '.mp4');
    const filename = 'content-' + Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    const filePath = path.join(publicDir, "uploads", "content", filename);
    fs.writeFileSync(filePath, buffer);

    return "/uploads/content/" + filename;
}

const OTP_TTL_MS       = 5 * 60 * 1000;
const OTP_COOLDOWN_MS  = 60 * 1000;
const TOKEN_TTL_MS     = 15 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const CONTENT_ACCESS_SECRET = process.env.CONTENT_ACCESS_SECRET || crypto.randomBytes(32).toString("hex");
const CONTENT_ACCESS_COOKIE = "wv_content_access";
const CONTENT_ACCESS_TTL_MS = 10 * 60 * 1000;

function createContentAccessToken(email) {
    const expiresAt = Date.now() + CONTENT_ACCESS_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ email, exp: expiresAt })).toString("base64url");
    const signature = crypto.createHmac("sha256", CONTENT_ACCESS_SECRET).update(payload).digest("hex");
    return `${payload}.${signature}`;
}

function verifyContentAccessToken(token) {
    try {
        if (!token || typeof token !== "string" || !token.includes(".")) return null;
        const [payload, signature] = token.split(".");
        const expectedSig = crypto.createHmac("sha256", CONTENT_ACCESS_SECRET).update(payload).digest("hex");

        const sigBuf = Buffer.from(signature, "hex");
        const expectedBuf = Buffer.from(expectedSig, "hex");
        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return null;
        }

        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (!data.exp || Date.now() > data.exp) return null;

        return data;
    } catch (e) {
        return null;
    }
}

function requireContentAccess(req, res, next) {
    const token = req.cookies ? req.cookies[CONTENT_ACCESS_COOKIE] : null;
    const verified = verifyContentAccessToken(token);

    if (!verified) {
        return res.redirect("/account-setup.html?access=denied");
    }
    next();
}

function isValidGmail(email) {
    return typeof email === "string" && /^[^\s@]+@gmail\.com$/i.test(email.trim());
}

app.post('/api/otp/send', async (req, res) => {
    try {
        const { email } = req.body;
        if (!isValidGmail(email)) {
            return res.status(400).json({ success: false, message: "Valid Gmail address daalein." });
        }
        const cleanEmail = email.trim().toLowerCase();

        const [existingRows] = await pool.query('SELECT last_sent_at FROM otp_verifications WHERE email = ?', [cleanEmail]);

        if (existingRows.length > 0) {
            const lastSentAt = new Date(existingRows[0].last_sent_at).getTime();
            const elapsed = Date.now() - lastSentAt;
            if (elapsed < OTP_COOLDOWN_MS) {
                const secondsLeft = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
                return res.status(429).json({
                    success: false,
                    secondsLeft,
                    message: `Please wait ${secondsLeft}s before requesting another OTP.`
                });
            }
        }

        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const otpHash = await bcrypt.hash(otp, 10);
        const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
        const now = new Date();

        await pool.query(
            `INSERT INTO otp_verifications (email, otp_hash, attempts, verified, verify_token, token_expires_at, otp_expires_at, last_sent_at)
             VALUES (?, ?, 0, 0, NULL, NULL, ?, ?)
             ON DUPLICATE KEY UPDATE
                otp_hash = VALUES(otp_hash),
                attempts = 0,
                verified = 0,
                verify_token = NULL,
                token_expires_at = NULL,
                otp_expires_at = VALUES(otp_expires_at),
                last_sent_at = VALUES(last_sent_at)`,
            [cleanEmail, otpHash, otpExpiresAt, now]
        );

        const emailSent = await sendEmailOtp(cleanEmail, otp);
        if (!emailSent) {
            return res.status(500).json({ success: false, message: "OTP email bhejne mein dikkat hui, dobara try karein." });
        }

        res.json({ success: true, message: "OTP bhej diya gaya hai." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error — OTP send nahi ho paya." });
    }
});

app.post('/api/otp/verify', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!isValidGmail(email) || !otp || !/^[0-9]{6}$/.test(otp)) {
            return res.status(400).json({ success: false, message: "Invalid email ya OTP format." });
        }
        const cleanEmail = email.trim().toLowerCase();

        const [rows] = await pool.query('SELECT * FROM otp_verifications WHERE email = ?', [cleanEmail]);
        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: "Pehle OTP request karein." });
        }
        const record = rows[0];

        if (new Date(record.otp_expires_at).getTime() < Date.now()) {
            return res.status(400).json({ success: false, message: "OTP expire ho gaya hai, naya OTP request karein." });
        }
        if (record.attempts >= MAX_OTP_ATTEMPTS) {
            return res.status(429).json({ success: false, message: "Bahut zyada galat attempts. Naya OTP request karein." });
        }

        const isMatch = await bcrypt.compare(otp, record.otp_hash);

        if (!isMatch) {
            await pool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE email = ?', [cleanEmail]);
            return res.status(400).json({ success: false, message: "Wrong OTP" });
        }

        const verifyToken = crypto.randomBytes(32).toString("hex");
        const tokenExpiresAt = new Date(Date.now() + TOKEN_TTL_MS);

        await pool.query(
            `UPDATE otp_verifications
             SET verified = 1, verify_token = ?, token_expires_at = ?, otp_hash = ''
             WHERE email = ?`,
            [verifyToken, tokenExpiresAt, cleanEmail]
        );

        res.json({ success: true, token: verifyToken, message: "Gmail verified." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error — OTP verify nahi ho paya." });
    }
});

app.post('/api/content/submit', contentUpload.single('coverMedia'), async (req, res) => {
    try {
        const { type, author, title, description, content, coverMediaType } = req.body;

        if (!author || String(author).trim() === "") {
            return res.status(400).json({ success: false, message: "Author name required hai." });
        }
        if (!title || String(title).trim() === "") {
            return res.status(400).json({ success: false, message: "Title required hai." });
        }
        if (!content || String(content).trim() === "") {
            return res.status(400).json({ success: false, message: "Content khaali nahi ho sakta." });
        }

        let authorEmail = null;
        let websiteId = null;
        try {
            const sessionId = req.cookies.session_id;
            if (sessionId) {
                const [userRows] = await pool.query('SELECT email, uniqueId FROM users WHERE uniqueId = ?', [sessionId]);
                if (userRows.length > 0) {
                    authorEmail = userRows[0].email;
                    websiteId = userRows[0].uniqueId;
                }
            }
        } catch (e) { }

        let authorAge = null;
        let authorRole = null;
        try {
            const accessToken = req.cookies ? req.cookies[CONTENT_ACCESS_COOKIE] : null;
            const verified = verifyContentAccessToken(accessToken);
            if (verified && verified.email) {
                const [acctRows] = await pool.query(
                    'SELECT age, role FROM account_submissions WHERE email = ? ORDER BY id DESC LIMIT 1',
                    [verified.email]
                );
                if (acctRows.length > 0) {
                    authorAge = acctRows[0].age;
                    authorRole = acctRows[0].role;
                }
                if (!websiteId) {
                    const [userByEmail] = await pool.query('SELECT uniqueId, email FROM users WHERE email = ?', [verified.email]);
                    if (userByEmail.length > 0) {
                        websiteId = userByEmail[0].uniqueId;
                        if (!authorEmail) authorEmail = userByEmail[0].email;
                    }
                }
            }
        } catch (e) { }

        let coverMediaUrl = null;
        if (req.file) {
            coverMediaUrl = "/uploads/content/" + req.file.filename;
        }

        const [insertResult] = await pool.query(
            `INSERT INTO content_submissions
                (content_type, author_name, author_email, author_age, author_role, website_id, title, description, content_html, cover_media_url, cover_media_type, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [
                type || 'story',
                String(author).trim(),
                authorEmail,
                authorAge,
                authorRole,
                websiteId,
                String(title).trim(),
                description ? String(description).trim() : null,
                content,
                coverMediaUrl,
                coverMediaUrl ? (coverMediaType || null) : null
            ]
        );

        res.json({
            success: true,
            message: "Content saved successfully.",
            submissionId: insertResult.insertId
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error — content save nahi ho paya." });
    }
});

app.post('/api/account-setup/submit', async (req, res) => {
    try {
        const { type, firstName, surname, age, role, address, email, password, token } = req.body;

        if (!isValidGmail(email) || !token) {
            return res.status(400).json({ success: false, message: "Invalid request." });
        }
        const cleanEmail = email.trim().toLowerCase();

        const [rows] = await pool.query('SELECT * FROM otp_verifications WHERE email = ?', [cleanEmail]);
        if (rows.length === 0) {
            return res.status(403).json({ success: false, message: "Email verified nahi hai." });
        }
        const record = rows[0];

        const tokenValid =
            record.verified === 1 &&
            record.verify_token &&
            record.verify_token === token &&
            record.token_expires_at &&
            new Date(record.token_expires_at).getTime() > Date.now();

        if (!tokenValid) {
            return res.status(403).json({ success: false, message: "Security check fail ho gaya — dobara OTP verify karein." });
        }

        const ageNum = parseInt(age, 10);
        if (!firstName || String(firstName).trim() === "") {
            return res.status(400).json({ success: false, message: "First Name required hai." });
        }
        if (isNaN(ageNum) || ageNum < 3 || ageNum > 100) {
            return res.status(400).json({ success: false, message: "Enter your valid age" });
        }
        if (!role || String(role).trim() === "") {
            return res.status(400).json({ success: false, message: "Role required hai." });
        }
        if (!address || String(address).trim() === "") {
            return res.status(400).json({ success: false, message: "Address required hai." });
        }
        if (!password || String(password).length < 6) {
            return res.status(400).json({ success: false, message: "Password kam se kam 6 characters ka hona chahiye." });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        const [insertResult] = await pool.query(
            `INSERT INTO account_submissions
                (content_type, first_name, surname, age, role, address, email, password_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
                type || 'poem',
                String(firstName).trim(),
                surname ? String(surname).trim() : null,
                ageNum,
                role,
                String(address).trim(),
                cleanEmail,
                passwordHash
            ]
        );

        const accessToken = createContentAccessToken(cleanEmail);
        res.cookie(CONTENT_ACCESS_COOKIE, accessToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: CONTENT_ACCESS_TTL_MS
        });

        res.json({
            success: true,
            message: "Confirmed. Data saved successfully.",
            submissionId: insertResult.insertId,
            redirectTo: "/content-detail.html"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error — data save nahi ho paya." });
    }
});

app.get('/api/user/profile-data', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });

    try {
        const [rows] = await pool.query('SELECT username, uniqueId, avatar_url, email, registrationDate FROM users WHERE uniqueId = ?', [sessionId]);
        if (rows.length === 0) return res.status(404).json({ success: false });
        
        res.json({ 
            success: true, 
            username: rows[0].username, 
            databaseId: rows[0].uniqueId, 
            avatarUrl: rows[0].avatar_url,
            email: rows[0].email,
            joinedDate: rows[0].registrationDate
        });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/user/update-avatar', upload.single('avatar'), async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId || !req.file) return res.status(400).json({ success: false });

    try {
        const publicRelativePath = "/uploads/" + req.file.filename;
        await pool.query('UPDATE users SET avatar_url = ? WHERE uniqueId = ?', [publicRelativePath, sessionId]);
        await pool.query('INSERT INTO user_avatar_history (user_uniqueId, action, avatar_url) VALUES (?, ?, ?)', [sessionId, 'UPLOAD', publicRelativePath]);

        res.json({ success: true, newAvatarUrl: publicRelativePath });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/user/remove-avatar', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });

    try {
        await pool.query('UPDATE users SET avatar_url = NULL WHERE uniqueId = ?', [sessionId]);
        await pool.query('INSERT INTO user_avatar_history (user_uniqueId, action, avatar_url) VALUES (?, ?, NULL)', [sessionId, 'REMOVE']);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ success: true });
});

app.get("/", (req, res) => res.sendFile(path.join(publicDir, "1.html")));

app.get("/content-detail.html", OTP_ENABLED ? requireContentAccess : (req, res, next) => next(), (req, res) => {
    res.sendFile(path.join(privateDir, "content-detail.html"));
});

app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) return res.json({ success: false, redirect: "register", message: "Email not registered." });
        if (!users[0].password) return res.json({ success: false, message: "Use Google Login." });
        
        const match = await bcrypt.compare(password, users[0].password);
        if (!match) return res.json({ success: false, message: "Incorrect password." });

        setSessionCookie(res, users[0]);
        res.json({ success: true, redirect: "newfile.html" });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post("/api/register", async (req, res) => {
    const { username, email, password } = req.body;
    try {
        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(400).json({ success: false, message: "Email already registered." });

        const hashedPassword = await bcrypt.hash(password, 12);
        const uniqueId = await generateUniqueId();
        await pool.query('INSERT INTO users (uniqueId, username, email, password, loginMethod) VALUES (?, ?, ?, ?, ?)', [uniqueId, username, email, hashedPassword, "Email"]);
        res.json({ success: true, message: "Registered successfully." });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get("/login/google", async (req, res) => {
    const state = generateState();
    const codeVerifier = generateCodeVerifier();
    res.cookie("oauth_state", state, { httpOnly: true, maxAge: 600000 });
    res.cookie("oauth_code_verifier", codeVerifier, { httpOnly: true, maxAge: 600000 });
    res.redirect(google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]).toString());
});

app.get("/login/google/callback", async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies.oauth_state;
    const storedCodeVerifier = req.cookies.oauth_code_verifier;

    if (!code || state !== storedState) return res.redirect("/?error=auth_failed");

    try {
        const tokens = await google.validateAuthorizationCode(code, storedCodeVerifier);
        const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.accessToken()}` } });
        const userData = await userResponse.json();
        
        const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [userData.email]);
        if (existing.length > 0) {
            if (!existing[0].avatar_url && userData.picture) {
                await pool.query('UPDATE users SET avatar_url = ? WHERE id = ?', [userData.picture, existing[0].id]);
                existing[0].avatar_url = userData.picture;
            }
            setSessionCookie(res, existing[0]);
            return res.redirect("/newfile.html");
        }
        
        const uniqueId = await generateUniqueId();
        await pool.query('INSERT INTO users (uniqueId, username, email, loginMethod, avatar_url) VALUES (?, ?, ?, ?, ?)', [uniqueId, userData.name, userData.email, "Google", userData.picture]);
        setSessionCookie(res, { uniqueId });
        return res.redirect("/newfile.html");
    } catch (error) { return res.redirect("/?error=auth_failed"); }
});

app.get("/newfile.html", async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.redirect("/");
    try {
        const [rows] = await pool.query('SELECT id FROM users WHERE uniqueId = ?', [sessionId]);
        if (rows.length === 0) { clearSessionCookie(res); return res.redirect("/"); }
        res.sendFile(path.join(publicDir, "newfile.html")); 
    } catch (error) { return res.redirect("/"); }
});

app.use(express.static(publicDir));

function isHardcodedSuperAdmin(user) {
    if (!user || !user.username || !user.email) return false;
    return user.username.toLowerCase().trim() === "shubham" &&
           user.email.toLowerCase().trim() === "personal.shubham1872@gmail.com";
}

async function requireAdmin(req, res, next) {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false, message: "Login required" });

    try {
        const [rows] = await pool.query('SELECT username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: "User not found" });
        }

        const currentUser = rows[0];

        if (isHardcodedSuperAdmin(currentUser) || currentUser.role === 'admin') {
            req.currentUser = currentUser;
            next();
        } else {
            return res.status(403).json({ success: false, message: "Forbidden: Access Denied! Hackers stay away." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
}

async function requireSuperAdmin(req, res, next) {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false, message: "Login required" });

    try {
        const [rows] = await pool.query('SELECT username, email FROM users WHERE uniqueId = ?', [sessionId]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: "User not found" });
        }

        if (isHardcodedSuperAdmin(rows[0])) {
            next();
        } else {
            return res.status(403).json({ success: false, message: "Forbidden: Only the Super Admin can do this." });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
}

app.get('/api/user/check-admin', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) {
        return res.json({ isAdmin: false, isSuperAdmin: false, message: "No session found" });
    }

    try {
        const [rows] = await pool.query('SELECT username, email, role FROM users WHERE uniqueId = ?', [sessionId]);

        if (rows.length > 0) {
            const user = rows[0];
            const superAdmin = isHardcodedSuperAdmin(user);
            const admin = superAdmin || user.role === 'admin';
            return res.json({ isAdmin: admin, isSuperAdmin: superAdmin });
        }
        res.json({ isAdmin: false, isSuperAdmin: false });
    } catch (error) {
        res.json({ isAdmin: false, isSuperAdmin: false, error: error.message });
    }
});

app.post('/api/admin/admins/make', requireSuperAdmin, async (req, res) => {
    const { username, email } = req.body;
    if (!username || !email) return res.status(400).json({ success: false, message: "Username and email required" });

    try {
        const [rows] = await pool.query('SELECT id, role FROM users WHERE LOWER(username) = LOWER(?) AND LOWER(email) = LOWER(?)', [username.trim(), email.trim()]);
        if (rows.length === 0) {
            return res.json({ success: false, message: "No registered user matches that username + email." });
        }
        if (rows[0].role === 'admin') {
            return res.json({ success: false, message: "User is already an admin." });
        }
        await pool.query('UPDATE users SET role = "admin" WHERE id = ?', [rows[0].id]);
        res.json({ success: true, message: "User promoted to admin successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post('/api/admin/admins/remove', requireSuperAdmin, async (req, res) => {
    const { uniqueId } = req.body;
    if (!uniqueId) return res.status(400).json({ success: false, message: "uniqueId required" });

    try {
        const [rows] = await pool.query('SELECT username, email FROM users WHERE uniqueId = ?', [uniqueId]);
        if (rows.length === 0) return res.json({ success: false, message: "User not found" });

        if (isHardcodedSuperAdmin(rows[0])) {
            return res.json({ success: false, message: "Cannot remove the Super Admin." });
        }

        await pool.query('UPDATE users SET role = "user" WHERE uniqueId = ?', [uniqueId]);
        res.json({ success: true, message: "Admin access removed." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.get('/api/admin/admins/list', requireSuperAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT username, email, uniqueId FROM users WHERE role = 'admin' ORDER BY username ASC");
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error" });
    }
});

const VALID_PAGES = ['home', 'article', 'poem', 'story'];

app.get('/api/content/cards', async (req, res) => {
    const page = VALID_PAGES.includes(req.query.page) ? req.query.page : 'home';
    try {
        const [rows] = await pool.query(
            `SELECT hc.*,
                    CASE WHEN cs.id IS NOT NULL THEN CONCAT(cs.content_type, '-', cs.id) ELSE NULL END AS linked_target_card_id
             FROM home_cards hc
             LEFT JOIN content_submissions cs ON cs.unique_id = hc.linked_content_id
             WHERE hc.is_draft = 0 AND hc.page = ?
             ORDER BY hc.id ASC`,
            [page]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// Public site-wide search — newfile.html ke header search bar ke liye
// (Home/Article/Poem/Story sabhi mein published content ke andar title/description/author search karta hai)
app.get('/api/content/search', async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    try {
        const like = `%${q}%`;
        const [rows] = await pool.query(
            `SELECT card_id, page, badge_text, title, description, author_name, image_url, media_type
             FROM home_cards
             WHERE is_draft = 0
               AND page IN ('article','poem','story')
               AND (title LIKE ? OR description LIKE ? OR author_name LIKE ?)
             ORDER BY id DESC
             LIMIT 30`,
            [like, like, like]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Search failed.' });
    }
});

app.get('/api/admin/submissions/stats', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) AS total,
                SUM(status = 'pending')  AS pending,
                SUM(status = 'approved') AS approved,
                SUM(status = 'rejected') AS rejected
            FROM content_submissions
        `);
        const r = rows[0];
        res.json({
            success: true,
            total: r.total || 0,
            pending: r.pending || 0,
            approved: r.approved || 0,
            rejected: r.rejected || 0
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get('/api/admin/submissions', requireAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.max(1, parseInt(req.query.limit, 10) || 10);
        const offset = (page - 1) * limit;

        const type = (req.query.type || '').trim();
        const status = (req.query.status || '').trim();
        const search = (req.query.search || '').trim();
        const date = (req.query.date || '').trim();
        const dateRange = (req.query.dateRange || '').trim();

        let where = [];
        let params = [];

        if (type && type !== 'all') { where.push('content_type = ?'); params.push(type); }
        if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
        if (search) {
            where.push('(title LIKE ? OR author_name LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
        if (date) { where.push('DATE(created_at) = ?'); params.push(date); }
        if (dateRange === 'today') { where.push('DATE(created_at) = CURDATE()'); }
        else if (dateRange === 'week') { where.push('created_at >= (NOW() - INTERVAL 7 DAY)'); }
        else if (dateRange === 'month') { where.push('created_at >= (NOW() - INTERVAL 30 DAY)'); }

        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS cnt FROM content_submissions ${whereSql}`,
            params
        );
        const totalCount = countRows[0].cnt;

        const [rows] = await pool.query(
            `SELECT id, content_type, author_name, author_email, title, description,
                    cover_media_url, cover_media_type, status, created_at, reviewed_at, unique_id
             FROM content_submissions
             ${whereSql}
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            success: true,
            data: rows,
            page,
            limit,
            totalCount,
            totalPages: Math.max(1, Math.ceil(totalCount / limit))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM content_submissions WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Not found." });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/admin/submissions/:id/approve', requireAdmin, async (req, res) => {
    try {
        await pool.query(
            `UPDATE content_submissions SET status = 'approved', reviewed_at = NOW() WHERE id = ?`,
            [req.params.id]
        );
        res.json({ success: true, message: "Submission approved." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.post('/api/admin/submissions/:id/reject', requireAdmin, async (req, res) => {
    try {
        await pool.query(
            `UPDATE content_submissions SET status = 'rejected', reviewed_at = NOW() WHERE id = ?`,
            [req.params.id]
        );
        res.json({ success: true, message: "Submission rejected." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// Article/Poem/Story admin list — "Remove" (3-dot menu) action
app.delete('/api/admin/submissions/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM content_submissions WHERE id = ?`,
            [req.params.id]
        );
        res.json({ success: true, message: "Removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// ════════════════ DYNAMIC ROUTE FIX (ARTICLE, POEM, STORY) ════════════════
// "Add New Content" (Admin panel se) — Frontend (req.body.type) read karega
app.post('/api/admin/articles/create', requireAdmin, async (req, res) => {
    try {
        // Frontend se jo bhi type aayega (article, poem, ya story), wo backend padhega.
        const type = req.body.type || 'article';
        const validTypes = ['article', 'poem', 'story'];
        const finalType = validTypes.includes(type) ? type : 'article';

        const uniqueId = await generateUnique12DigitId();

        const [insertResult] = await pool.query(
            `INSERT INTO content_submissions
                (content_type, author_name, author_email, author_age, author_role, website_id, title, description, content_html, cover_media_url, cover_media_type, status, unique_id, created_at)
             VALUES (?, '', NULL, NULL, NULL, NULL, '', '', '', NULL, NULL, 'approved', ?, NOW())`,
            [finalType, uniqueId]
        );

        const contentId = insertResult.insertId;
        const cardId = finalType + '-' + contentId; // Example: poem-12, story-15, ya article-20

        // Yahan 'page' column me finalType ja raha hai taaki frontend me sahi tab me show ho sake.
        await pool.query(
            `INSERT INTO home_cards (card_id, page, badge_text, title, description, image_url, author_name, media_type, is_draft)
             VALUES (?, ?, "", "", "", NULL, "", "image", 1)`,
            [cardId, finalType]
        );

        res.json({
            success: true,
            message: "New " + finalType + " created successfully.",
            id: contentId,
            unique_id: uniqueId
        });
    } catch (error) {
        console.error("Admin create content error:", error.message);
        res.status(500).json({ success: false, message: "Server error — content create nahi ho paya." });
    }
});

function capitalizeFirstLetter(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Home page card ko kisi Article/Poem/Story se attach karna (12-digit unique ID se)
app.post('/api/admin/cards/link-content', requireAdmin, async (req, res) => {
    const { card_id, unique_id } = req.body;
    if (!card_id) return res.status(400).json({ success: false, message: "card_id required" });

    try {
        const [cardRows] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [card_id]);
        if (cardRows.length === 0) return res.status(404).json({ success: false, message: "Card not found" });

        if (!unique_id || !unique_id.trim()) {
            await pool.query('UPDATE home_cards SET linked_content_id=NULL WHERE card_id=?', [card_id]);
            return res.json({ success: true, message: "Link removed.", linked_content_id: null });
        }

        const cleanId = unique_id.trim();
        const [contentRows] = await pool.query('SELECT id, content_type, title FROM content_submissions WHERE unique_id = ?', [cleanId]);
        if (contentRows.length === 0) return res.status(404).json({ success: false, message: "Is ID ka koi Article/Poem/Story nahi mila." });

        await pool.query('UPDATE home_cards SET linked_content_id=? WHERE card_id=?', [cleanId, card_id]);
        res.json({ success: true, message: `Card attached to "${contentRows[0].title || 'Untitled'}".`, linked_content_id: cleanId });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

// Hero "Read Now" button ko kisi Article/Poem/Story se attach karna (12-digit unique ID se)
app.post('/api/admin/hero/current-content', requireAdmin, async (req, res) => {
    const { unique_id } = req.body;
    try {
        if (!unique_id || !unique_id.trim()) {
            await pool.query('UPDATE site_settings SET hero_read_target=NULL WHERE id=1');
            return res.json({ success: true, message: "Current content cleared.", hero_read_target: null });
        }

        const cleanId = unique_id.trim();
        const [contentRows] = await pool.query('SELECT id, content_type, title FROM content_submissions WHERE unique_id = ?', [cleanId]);
        if (contentRows.length === 0) return res.status(404).json({ success: false, message: "Is ID ka koi Article/Poem/Story nahi mila." });

        const target = contentRows[0];
        const [rows] = await pool.query('SELECT hero_read_target FROM site_settings WHERE id=1');
        const oldVal = rows[0] ? rows[0].hero_read_target : null;

        await pool.query('UPDATE site_settings SET hero_read_target=? WHERE id=1', [cleanId]);
        await logHistory(req.currentUser.username, 'hero_read_target', null, oldVal, cleanId + ' (' + target.title + ')');

        res.json({ success: true, message: "Current content set — Read Now button ab isse connect hai.", hero_read_target: cleanId, title: target.title });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});
// ════════════════ END DYNAMIC ROUTE FIX ════════════════

app.get('/api/admin/cards/by-article/:articleId', requireAdmin, async (req, res) => {
    const articleId = parseInt(req.params.articleId, 10);
    if (!articleId) return res.status(400).json({ success: false, message: "Invalid article id" });

    const cardId = 'article-' + articleId;
    try {
        const [existing] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [cardId]);
        if (existing.length > 0) {
            return res.json({ success: true, data: existing[0] });
        }

        await pool.query(
            `INSERT INTO home_cards (card_id, page, badge_text, title, description, image_url, author_name, media_type, is_draft)
             VALUES (?, 'article', "", "", "", NULL, "", "image", 1)`,
            [cardId]
        );
        const [created] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [cardId]);
        res.json({ success: true, data: created[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// 12-digit unique ID se Article/Poem/Story ka preview data laana (Home page ke "attach" widgets ke liye)
app.get('/api/admin/content/lookup/:uniqueId', requireAdmin, async (req, res) => {
    const uid = (req.params.uniqueId || '').trim();
    if (!uid) return res.status(400).json({ success: false, message: "ID required" });
    try {
        const [rows] = await pool.query(
            `SELECT id, content_type, author_name, title, description, cover_media_url, cover_media_type
             FROM content_submissions WHERE unique_id = ?`,
            [uid]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Is ID ka koi Article/Poem/Story nahi mila." });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error." });
    }
});

// Home page ke "Current Content" box se seedha Article/Poem/Story ke Author/Title/Description/Cover edit-save karna
// (content_html ko touch nahi karta — us content ka page/body content jaisa hai waisa hi rehta hai)
app.post('/api/admin/content/quick-update', requireAdmin, contentUpload.single('file'), async (req, res) => {
    const { unique_id, author_name, title, description, content_html, media_type, image_url } = req.body;
    const uid = (unique_id || '').trim();
    if (!uid) return res.status(400).json({ success: false, message: "Pehle ek valid Content ID daalo." });

    const authorClean = (author_name || '').trim();
    const titleClean = (title || '').trim();
    const descClean = (description || '').trim();
    if (!authorClean) return res.status(400).json({ success: false, message: "Author Name compulsory hai." });
    if (!titleClean) return res.status(400).json({ success: false, message: "Title compulsory hai." });
    if (!descClean) return res.status(400).json({ success: false, message: "Description compulsory hai." });

    try {
        const [rows] = await pool.query('SELECT * FROM content_submissions WHERE unique_id = ?', [uid]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Is ID ka koi Article/Poem/Story nahi mila." });
        const old = rows[0];

        let newPath = old.cover_media_url;
        let newMediaType = old.cover_media_type;

        if (req.file) {
            const requiredPrefix = (media_type === 'video') ? 'video/' : 'image/';
            if (!req.file.mimetype.startsWith(requiredPrefix)) {
                fs.unlink(req.file.path, () => {});
                return res.status(400).json({ success: false, message: `Sirf ${media_type} file allow hai.` });
            }
            newPath = "/uploads/content/" + req.file.filename;
            newMediaType = media_type;
        } else if (image_url) {
            try {
                const requiredPrefix = (media_type === 'video') ? 'video/' : 'image/';
                newPath = await downloadMediaFromUrl(image_url, requiredPrefix);
                newMediaType = media_type;
            } catch (err) {
                return res.status(400).json({ success: false, message: "URL se media load nahi ho paya." });
            }
        }

        // content_html bhi is box se aa sakta hai (Main Content Page section); agar nahi bheja gaya to purana hi rehne do
        const newContentHtml = (content_html !== undefined) ? content_html : old.content_html;
        const contentHtmlClean = (newContentHtml || '').replace(/<p>\s*<\/p>/gi, '').trim();
        if (!newPath && !contentHtmlClean) {
            return res.status(400).json({ success: false, message: "Cover Page ya Content Box mein se kam se kam ek bharna compulsory hai." });
        }

        await pool.query(
            `UPDATE content_submissions SET author_name=?, title=?, description=?, content_html=?, cover_media_url=?, cover_media_type=? WHERE id=?`,
            [authorClean, titleClean, descClean, newContentHtml || '', newPath, newMediaType, old.id]
        );

        const cardId = old.content_type + '-' + old.id;
        const [cardRows] = await pool.query('SELECT card_id FROM home_cards WHERE card_id = ?', [cardId]);
        if (cardRows.length > 0) {
            await pool.query(
                `UPDATE home_cards SET title=?, description=?, author_name=?, image_url=?, media_type=? WHERE card_id=?`,
                [titleClean, descClean, authorClean, newPath, newMediaType, cardId]
            );
        }

        if (old.title !== titleClean) await logHistory(req.currentUser.username, 'card_title', cardId, old.title, titleClean);
        if (old.description !== descClean) await logHistory(req.currentUser.username, 'card_description', cardId, old.description, descClean);
        if (old.author_name !== authorClean) await logHistory(req.currentUser.username, 'card_author', cardId, old.author_name, authorClean);

        res.json({
            success: true,
            message: "Current Content updated.",
            data: { author_name: authorClean, title: titleClean, description: descClean, cover_media_url: newPath, cover_media_type: newMediaType, content_type: old.content_type }
        });
    } catch (error) {
        console.error("Quick update error:", error.message);
        res.status(500).json({ success: false, message: "Server error." });
    }
});

app.get('/api/admin/cards/all', requireAdmin, async (req, res) => {
    const page = VALID_PAGES.includes(req.query.page) ? req.query.page : 'home';
    try {
        const [rows] = await pool.query('SELECT * FROM home_cards WHERE page = ? ORDER BY id ASC', [page]);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/cards/create', requireAdmin, async (req, res) => {
    const page = VALID_PAGES.includes(req.body.page) ? req.body.page : 'home';
    try {
        const cardId = page + '-card-' + Date.now();
        await pool.query(
            'INSERT INTO home_cards (card_id, page, badge_text, title, description, image_url, author_name, media_type, is_draft) VALUES (?, ?, "", "", "", NULL, "", "image", 1)',
            [cardId, page]
        );
        await logHistory(req.currentUser.username, 'card_created', cardId, null, 'New draft card created');
        res.json({ success: true, message: "Naya card draft mein add ho gaya. Data fill karke save karo.", card_id: cardId });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.post('/api/admin/cards/text', requireAdmin, async (req, res) => {
    const { card_id, badge_text, title, description, author_name } = req.body;
    if (!card_id) return res.status(400).json({ success: false, message: "card_id required" });

    try {
        const [existingRows] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [card_id]);
        if (existingRows.length === 0) return res.status(404).json({ success: false, message: "Card not found" });
        const old = existingRows[0];

        const willHaveMedia = old.image_url;
        const isComplete = !!(willHaveMedia && badge_text && title && description && author_name);

        await pool.query(
            'UPDATE home_cards SET badge_text=?, title=?, description=?, author_name=?, is_draft=? WHERE card_id=?',
            [badge_text, title, description, author_name, isComplete ? 0 : 1, card_id]
        );

        if (old.title !== title) await logHistory(req.currentUser.username, 'card_title', card_id, old.title, title);
        if (old.description !== description) await logHistory(req.currentUser.username, 'card_description', card_id, old.description, description);
        if (old.author_name !== author_name) await logHistory(req.currentUser.username, 'card_author', card_id, old.author_name, author_name);
        if (old.badge_text !== badge_text) await logHistory(req.currentUser.username, 'card_type', card_id, old.badge_text, badge_text);

        res.json({ success: true, message: isComplete ? "Card updated and published!" : "Card saved as draft — image/video upload karke complete karo." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.post('/api/admin/cards/media', requireAdmin, contentUpload.single('file'), async (req, res) => {
    const { card_id, media_type, image_url } = req.body;
    if (!card_id) return res.status(400).json({ success: false, message: "card_id required" });
    if (media_type !== 'image' && media_type !== 'video') return res.status(400).json({ success: false, message: "media_type must be image or video" });
    if (!req.file && !image_url) return res.status(400).json({ success: false, message: "File upload karo ya URL paste karo." });

    try {
        const [existingRows] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [card_id]);
        if (existingRows.length === 0) return res.status(404).json({ success: false, message: "Card not found" });
        const old = existingRows[0];

        const requiredPrefix = media_type === 'video' ? 'video/' : 'image/';
        let newPath;

        if (req.file) {
            if (!req.file.mimetype.startsWith(requiredPrefix)) {
                fs.unlink(req.file.path, () => {});
                const msg = media_type === 'video'
                    ? "Ye video nahi hai, sirf video file upload ho sakti hai."
                    : "Ye image nahi hai, sirf image file upload ho sakti hai.";
                return res.status(400).json({ success: false, message: msg });
            }
            newPath = "/uploads/content/" + req.file.filename;
        } else {
            try {
                newPath = await downloadMediaFromUrl(image_url, requiredPrefix);
            } catch (err) {
                if (err.message === "WRONG_TYPE_NOT_IMAGE") return res.status(400).json({ success: false, message: "Ye URL image nahi hai, sirf image allowed hai." });
                if (err.message === "WRONG_TYPE_NOT_VIDEO") return res.status(400).json({ success: false, message: "Ye URL video nahi hai, sirf video allowed hai." });
                return res.status(400).json({ success: false, message: "URL se file load nahi ho payi. Sahi URL daalo." });
            }
        }

        const isComplete = !!(old.badge_text && old.title && old.description && old.author_name);

        await pool.query(
            'UPDATE home_cards SET image_url=?, media_type=?, is_draft=? WHERE card_id=?',
            [newPath, media_type, isComplete ? 0 : 1, card_id]
        );

        await logHistory(req.currentUser.username, 'card_media', card_id, old.image_url, newPath);

        res.json({ success: true, message: isComplete ? "Media updated and card published!" : "Media uploaded — text fields bhi fill karo.", newUrl: newPath });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.post('/api/admin/cards/delete', requireAdmin, async (req, res) => {
    const { card_id } = req.body;
    if (!card_id) return res.status(400).json({ success: false, message: "card_id required" });

    try {
        const [rows] = await pool.query('SELECT * FROM home_cards WHERE card_id = ?', [card_id]);
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Card not found" });
        const old = rows[0];

        await pool.query('DELETE FROM home_cards WHERE card_id = ?', [card_id]);
        await logHistory(req.currentUser.username, 'card_deleted', card_id, old.title || old.card_id, 'Card removed');

        if (old.image_url && old.image_url.startsWith('/uploads/content/')) {
            fs.unlink(path.join(publicDir, old.image_url), () => {});
        }

        res.json({ success: true, message: "Card removed successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.get('/api/content/hero', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM site_settings LIMIT 1');
        const hero = rows[0] || {};
        if (hero.hero_read_target) {
            // Sirf fully published content (home_cards.is_draft = 0) hi "Read Now" ke liye valid maana jayega —
            // khali/incomplete draft content abhi bhi khulne nahi dena.
            const [csRows] = await pool.query(
                `SELECT cs.id, cs.content_type
                 FROM content_submissions cs
                 JOIN home_cards hc ON hc.card_id = CONCAT(cs.content_type, '-', cs.id)
                 WHERE cs.unique_id = ? AND hc.is_draft = 0
                   AND cs.author_name <> '' AND cs.title <> '' AND cs.description <> ''`,
                [hero.hero_read_target]
            );
            hero.hero_read_target_card_id = csRows.length ? (csRows[0].content_type + '-' + csRows[0].id) : null;
        } else {
            hero.hero_read_target_card_id = null;
        }
        res.json({ success: true, data: hero });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/admin/hero/text', requireAdmin, async (req, res) => {
    const { hero_title, hero_desc } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM site_settings WHERE id=1');
        const old = rows[0];

        await pool.query('UPDATE site_settings SET hero_title=?, hero_desc=? WHERE id=1', [hero_title, hero_desc]);

        if (old.hero_title !== hero_title) await logHistory(req.currentUser.username, 'hero_title', null, old.hero_title, hero_title);
        if (old.hero_desc !== hero_desc) await logHistory(req.currentUser.username, 'hero_desc', null, old.hero_desc, hero_desc);

        res.json({ success: true, message: "Hero title/description updated!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.post('/api/admin/hero/media', requireAdmin, contentUpload.single('file'), async (req, res) => {
    const { target, image_url } = req.body;
    if (target !== 'bg' && target !== 'logo') {
        return res.status(400).json({ success: false, message: "valid target (bg/logo) required" });
    }
    if (!req.file && !image_url) return res.status(400).json({ success: false, message: "File upload karo ya URL paste karo." });

    try {
        const [rows] = await pool.query('SELECT * FROM site_settings WHERE id=1');
        const old = rows[0];
        const column = target === 'bg' ? 'hero_bg_url' : 'hero_logo_url';
        let newPath;

        if (req.file) {
            if (!req.file.mimetype.startsWith('image/')) {
                fs.unlink(req.file.path, () => {});
                return res.status(400).json({ success: false, message: "Ye image nahi hai, sirf image upload ho sakti hai (video allowed nahi)." });
            }
            newPath = "/uploads/content/" + req.file.filename;
        } else {
            try {
                newPath = await downloadMediaFromUrl(image_url, 'image/');
            } catch (err) {
                if (err.message === "WRONG_TYPE_NOT_IMAGE") return res.status(400).json({ success: false, message: "Ye URL image nahi hai, sirf image allowed hai." });
                return res.status(400).json({ success: false, message: "URL se file load nahi ho payi. Sahi URL daalo." });
            }
        }

        await pool.query(`UPDATE site_settings SET ${column} = ? WHERE id=1`, [newPath]);
        await logHistory(req.currentUser.username, target === 'bg' ? 'hero_bg' : 'hero_logo', null, old[column], newPath);

        res.json({ success: true, message: (target === 'bg' ? "Background" : "Logo") + " updated successfully!", newUrl: newPath });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.get('/api/admin/history', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT ch.*, hc.title AS card_title, hc.badge_text AS card_badge
            FROM content_history ch
            LEFT JOIN home_cards hc ON ch.card_id = hc.card_id
            ORDER BY ch.changed_at DESC
            LIMIT 200
        `);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Database error" });
    }
});

app.get('/api/content/version', async (req, res) => {
    try {
        const [heroRows] = await pool.query('SELECT updated_at FROM site_settings WHERE id=1');
        const [cardRows] = await pool.query('SELECT MAX(updated_at) as latest FROM home_cards WHERE is_draft = 0');

        const heroTime = heroRows[0] ? new Date(heroRows[0].updated_at).getTime() : 0;
        const cardTime = cardRows[0] && cardRows[0].latest ? new Date(cardRows[0].latest).getTime() : 0;

        res.json({ success: true, version: Math.max(heroTime, cardTime) });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/likes-data', requireAdmin, async (req, res) => {
    try {
        const query = `
            SELECT pl.post_id, u.username, u.email, u.uniqueId
            FROM post_likes pl
            JOIN users u ON pl.user_uniqueId = u.uniqueId
            ORDER BY pl.post_id ASC
        `;
        const [rows] = await pool.query(query);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching analytics" });
    }
});

app.get('/api/likes', async (req, res) => {
    try {
        const sessionId = req.cookies.session_id;
        const [totals] = await pool.query('SELECT post_id, COUNT(*) as total FROM post_likes GROUP BY post_id');
        
        let userLikes = [];
        if (sessionId) {
            const [rows] = await pool.query('SELECT post_id FROM post_likes WHERE user_uniqueId = ?', [sessionId]);
            userLikes = rows.map(r => r.post_id);
        }
        res.json({ success: true, totals, userLikes });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.post('/api/like/toggle', async (req, res) => {
    const sessionId = req.cookies.session_id;
    const { post_id } = req.body;
    
    if (!sessionId) return res.json({ success: false, message: "Please Login first to like!" });

    try {
        const [existing] = await pool.query('SELECT id FROM post_likes WHERE post_id = ? AND user_uniqueId = ?', [post_id, sessionId]);
        let isLiked = false;
        
        if (existing.length > 0) {
            await pool.query('DELETE FROM post_likes WHERE id = ?', [existing[0].id]);
        } else {
            // Type (article/poem/story) ko home_cards se snapshot karke save karo,
            // taaki baad mein card delete/edit hone par bhi type "Unknown" na dikhe.
            let cardType = null;
            try {
                const [cardRows] = await pool.query('SELECT badge_text FROM home_cards WHERE card_id = ?', [post_id]);
                if (cardRows.length > 0) cardType = cardRows[0].badge_text;
            } catch (e) { /* ignore */ }
            await pool.query('INSERT INTO post_likes (post_id, user_uniqueId, card_type) VALUES (?, ?, ?)', [post_id, sessionId, cardType]);
            isLiked = true;
        }
        
        const [totals] = await pool.query('SELECT COUNT(*) as total FROM post_likes WHERE post_id = ?', [post_id]);
        res.json({ success: true, newTotal: totals[0].total, liked: isLiked });
    } catch (error) { res.status(500).json({ success: false }); }
});

app.get('/api/comments/:card_id', async (req, res) => {
    const { card_id } = req.params;
    try {
        const [rows] = await pool.query(`
            SELECT 
                pc.id,
                pc.comment_text,
                pc.created_at,
                u.username,
                u.email,
                u.uniqueId,
                u.avatar_url
            FROM post_comments pc
            JOIN users u ON pc.user_uniqueId = u.uniqueId
            WHERE pc.card_id = ?
            ORDER BY pc.created_at DESC
        `, [card_id]);
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to load comments." });
    }
});

app.post('/api/comments/post', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false, message: "Please login to comment." });

    const { card_id, comment_text } = req.body;
    if (!card_id || !comment_text || !comment_text.trim()) {
        return res.status(400).json({ success: false, message: "card_id and comment_text are required." });
    }
    if (comment_text.trim().length > 1000) {
        return res.status(400).json({ success: false, message: "Comment cannot exceed 1000 characters." });
    }

    try {
        const [userRows] = await pool.query('SELECT uniqueId FROM users WHERE uniqueId = ?', [sessionId]);
        if (userRows.length === 0) return res.status(401).json({ success: false, message: "User not found." });

        // Type (article/poem/story) ko home_cards se snapshot karke save karo
        let cardType = null;
        try {
            const [cardRows] = await pool.query('SELECT badge_text FROM home_cards WHERE card_id = ?', [card_id]);
            if (cardRows.length > 0) cardType = cardRows[0].badge_text;
        } catch (e) { /* ignore */ }

        await pool.query(
            'INSERT INTO post_comments (card_id, user_uniqueId, comment_text, card_type) VALUES (?, ?, ?, ?)',
            [card_id, sessionId, comment_text.trim(), cardType]
        );

        const [newComment] = await pool.query(`
            SELECT pc.id, pc.comment_text, pc.created_at,
                   u.username, u.email, u.uniqueId, u.avatar_url
            FROM post_comments pc
            JOIN users u ON pc.user_uniqueId = u.uniqueId
            WHERE pc.id = LAST_INSERT_ID()
        `);

        res.json({ success: true, message: "Comment posted!", comment: newComment[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to post comment." });
    }
});

app.post('/api/comments/delete', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false, message: "Login required." });

    const { comment_id } = req.body;
    if (!comment_id) return res.status(400).json({ success: false, message: "comment_id required." });

    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (userRows.length === 0) return res.status(401).json({ success: false, message: "User not found." });
        const currentUser = userRows[0];

        const [commentRows] = await pool.query('SELECT * FROM post_comments WHERE id = ?', [comment_id]);
        if (commentRows.length === 0) return res.status(404).json({ success: false, message: "Comment not found." });

        const isOwner = commentRows[0].user_uniqueId === sessionId;
        const isAdmin = isHardcodedSuperAdmin(currentUser) || currentUser.role === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: "You can only delete your own comments." });
        }

        await pool.query('DELETE FROM post_comments WHERE id = ?', [comment_id]);
        res.json({ success: true, message: "Comment deleted." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete comment." });
    }
});

app.post('/api/reports/post', async (req, res) => {
    const sessionId = req.cookies.session_id;
    const { card_id, card_title, card_author, reason, report_author } = req.body;

    if (!card_id || !reason || !reason.trim()) {
        return res.status(400).json({ success: false, message: "card_id and reason are required." });
    }

    let user_uniqueId = null;
    let reporter_username = 'Guest';
    let reporter_email = null;

    if (sessionId) {
        try {
            const [rows] = await pool.query('SELECT uniqueId, username, email FROM users WHERE uniqueId = ?', [sessionId]);
            if (rows.length > 0) {
                user_uniqueId    = rows[0].uniqueId;
                reporter_username = rows[0].username;
                reporter_email   = rows[0].email;
            }
        } catch(e) { }
    }

    // Type (article/poem/story) ko home_cards se snapshot karke save karo
    let cardType = null;
    try {
        const [cardRows] = await pool.query('SELECT badge_text FROM home_cards WHERE card_id = ?', [card_id]);
        if (cardRows.length > 0) cardType = cardRows[0].badge_text;
    } catch (e) { /* ignore */ }

    try {
        await pool.query(
            `INSERT INTO post_reports 
             (card_id, card_title, card_author, reason, report_author, user_uniqueId, reporter_username, reporter_email, card_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                card_id,
                card_title  || null,
                card_author || null,
                reason.trim(),
                report_author ? 1 : 0,
                user_uniqueId,
                reporter_username,
                reporter_email,
                cardType
            ]
        );
        res.json({ success: true, message: "Report submitted successfully." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to submit report." });
    }
});

app.get('/api/admin/reports', requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM post_reports ORDER BY created_at DESC LIMIT 200'
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to load reports." });
    }
});

app.get('/api/admin/likes-dashboard', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM post_likes');
        const [typeCounts] = await pool.query(`
            SELECT COALESCE(pl.card_type, hc.badge_text, 'Unknown') as badge_text, COUNT(*) as cnt
            FROM post_likes pl
            LEFT JOIN home_cards hc ON pl.post_id = hc.card_id
            GROUP BY COALESCE(pl.card_type, hc.badge_text, 'Unknown')
        `);
        const [rows] = await pool.query(`
            SELECT pl.id, pl.post_id, pl.created_at,
                   u.username, u.email, u.avatar_url,
                   hc.title as card_title, COALESCE(pl.card_type, hc.badge_text, 'Unknown') as card_type, hc.author_name
            FROM post_likes pl
            JOIN users u ON pl.user_uniqueId = u.uniqueId
            LEFT JOIN home_cards hc ON pl.post_id = hc.card_id
            ORDER BY pl.created_at DESC
            LIMIT 200
        `);
        res.json({ success: true, total, typeCounts, rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load likes data.' });
    }
});

// Admin: ek like remove karna (mobile UI ke 3-dot "Remove" menu ke liye)
app.delete('/api/admin/likes-dashboard/:id', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        await pool.query('DELETE FROM post_likes WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Like removed.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove like.' });
    }
});

app.get('/api/admin/comments-dashboard', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM post_comments');
        const [typeCounts] = await pool.query(`
            SELECT COALESCE(pc.card_type, hc.badge_text, 'Unknown') as badge_text, COUNT(*) as cnt
            FROM post_comments pc
            LEFT JOIN home_cards hc ON pc.card_id = hc.card_id
            GROUP BY COALESCE(pc.card_type, hc.badge_text, 'Unknown')
        `);
        const [rows] = await pool.query(`
            SELECT pc.id, pc.comment_text, pc.created_at, pc.card_id,
                   u.username, u.email, u.avatar_url,
                   hc.title as card_title, COALESCE(pc.card_type, hc.badge_text, 'Unknown') as card_type, hc.author_name
            FROM post_comments pc
            JOIN users u ON pc.user_uniqueId = u.uniqueId
            LEFT JOIN home_cards hc ON pc.card_id = hc.card_id
            ORDER BY pc.created_at DESC
            LIMIT 200
        `);
        res.json({ success: true, total, typeCounts, rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load comments data.' });
    }
});

// Admin: ek comment remove karna (mobile UI ke 3-dot "Remove" menu ke liye)
app.delete('/api/admin/comments-dashboard/:id', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        await pool.query('DELETE FROM post_comments WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Comment removed.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove comment.' });
    }
});

app.get('/api/admin/reports-dashboard', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM post_reports');
        const [typeCounts] = await pool.query(`
            SELECT COALESCE(pr.card_type, hc.badge_text, 'Unknown') as badge_text, COUNT(*) as cnt
            FROM post_reports pr
            LEFT JOIN home_cards hc ON pr.card_id = hc.card_id
            GROUP BY COALESCE(pr.card_type, hc.badge_text, 'Unknown')
        `);
        const [rows] = await pool.query(`
            SELECT pr.id, pr.reason, pr.created_at, pr.card_id,
                   pr.card_title, pr.card_author, pr.reporter_username, pr.reporter_email,
                   COALESCE(pr.card_type, hc.badge_text, 'Unknown') as card_type
            FROM post_reports pr
            LEFT JOIN home_cards hc ON pr.card_id = hc.card_id
            ORDER BY pr.created_at DESC
            LIMIT 200
        `);
        res.json({ success: true, total, typeCounts, rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load reports data.' });
    }
});

// Admin: ek report remove karna (mobile UI ke 3-dot "Remove" menu ke liye)
app.delete('/api/admin/reports-dashboard/:id', async (req, res) => {
    const sessionId = req.cookies.session_id;
    if (!sessionId) return res.status(401).json({ success: false });
    try {
        const [userRows] = await pool.query('SELECT uniqueId, username, email, role FROM users WHERE uniqueId = ?', [sessionId]);
        if (!userRows.length) return res.status(401).json({ success: false });
        const u = userRows[0];
        if (!isHardcodedSuperAdmin(u) && u.role !== 'admin') return res.status(403).json({ success: false });

        await pool.query('DELETE FROM post_reports WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Report removed.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to remove report.' });
    }
});
// ================= 🌟 NEW DYNAMIC CONTENT SAVE FUNCTION 🌟 =================
app.post('/api/admin/dynamic-content/save', requireAdmin, contentUpload.single('file'), async (req, res) => {
    const { id, type, author_name, title, description, content_html, media_type, image_url } = req.body;

    if (!id || !type) return res.status(400).json({ success: false, message: "ID and type required" });

    // ── Mandatory validation ──
    const authorClean = (author_name || '').trim();
    const titleClean = (title || '').trim();
    const descClean = (description || '').trim();
    if (!authorClean) return res.status(400).json({ success: false, message: "Author Name compulsory hai." });
    if (!titleClean) return res.status(400).json({ success: false, message: "Title compulsory hai." });
    if (!descClean) return res.status(400).json({ success: false, message: "Description compulsory hai." });

    try {
        const [existingSub] = await pool.query('SELECT cover_media_url, unique_id FROM content_submissions WHERE id = ?', [id]);
        if (existingSub.length === 0) return res.status(404).json({ success: false, message: "Content not found" });

        let newPath = existingSub[0].cover_media_url;

        // Image/Video upload handle karna
        if (req.file) {
            const requiredPrefix = media_type === 'video' ? 'video/' : 'image/';
            if (!req.file.mimetype.startsWith(requiredPrefix)) {
                fs.unlink(req.file.path, () => {});
                return res.status(400).json({ success: false, message: `Sirf ${media_type} file allow hai.` });
            }
            newPath = "/uploads/content/" + req.file.filename;
        } else if (image_url) {
            try {
                const requiredPrefix = media_type === 'video' ? 'video/' : 'image/';
                newPath = await downloadMediaFromUrl(image_url, requiredPrefix);
            } catch (err) {
                return res.status(400).json({ success: false, message: "URL se media load nahi ho paya." });
            }
        }

        // Cover Page ya Content Box mein se kam se kam ek bharna compulsory hai
        const contentHtmlClean = (content_html || '').replace(/<p>\s*<\/p>/gi, '').trim();
        const hasCover = !!newPath;
        const hasContentBox = !!contentHtmlClean;
        if (!hasCover && !hasContentBox) {
            return res.status(400).json({ success: false, message: "Cover Page ya Content Box mein se kam se kam ek bharna compulsory hai." });
        }

        // 1. Update Content Submissions table (Admin list ke liye)
        await pool.query(
            `UPDATE content_submissions
             SET author_name=?, title=?, description=?, content_html=?, cover_media_url=?, cover_media_type=?, status='approved'
             WHERE id=?`,
            [authorClean, titleClean, descClean, content_html || '', newPath, media_type, id]
        );

        // 2. Update ya Insert Home Cards table (Frontend newfile.html me dikhane ke liye)
        const cardId = type + '-' + id; 
        const badgeText = type.charAt(0).toUpperCase() + type.slice(1); 

        // Smart Check: Pehle dekho ki card database me already hai ya nahi
        const [existingCard] = await pool.query('SELECT card_id FROM home_cards WHERE card_id = ?', [cardId]);
        
        if (existingCard.length > 0) {
            // Agar card pehle se hai toh UPDATE karo
            await pool.query(
                `UPDATE home_cards
                 SET title=?, description=?, author_name=?, image_url=?, media_type=?, badge_text=?, is_draft=0
                 WHERE card_id=?`,
                [titleClean, descClean, authorClean, newPath, media_type, badgeText, cardId]
            );
        } else {
            // FIXED ORDER: Yahan data columns ke mutabik sahi order mein set ho gaya hai
            await pool.query(
                `INSERT INTO home_cards
                 (card_id, page, badge_text, title, description, image_url, author_name, media_type, is_draft)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                [cardId, type, badgeText, titleClean, descClean, newPath, authorClean, media_type]
            );
        }

        await logHistory(req.currentUser.username, 'content_published', cardId, 'Draft', 'Published to Frontend');

        // Jo bhi content abhi save/publish hua hai, wahi Home Page ka "Current Content" ban jayega (auto — koi manual selection nahi chahiye)
        if (existingSub[0].unique_id) {
            await pool.query('UPDATE site_settings SET hero_read_target=? WHERE id=1', [existingSub[0].unique_id]);
        }

        res.json({ success: true, message: "Saved & Published to Frontend!" });
    } catch (err) {
        console.error("Save content error:", err.message);
        res.status(500).json({ success: false, message: "Database error" });
    }
});
// =========================================================================//
// ================= 🌟 NEW PUBLIC READER API 🌟 =================
// Ye API Reader page (index.html) ko Card ID ke basis par poora data (Cover + All Pages) degi
app.get('/api/public/read/:card_id', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT hc.title, hc.author_name, hc.image_url, hc.media_type, cs.content_html 
            FROM home_cards hc
            JOIN content_submissions cs ON hc.card_id = CONCAT(cs.content_type, '-', cs.id)
            WHERE hc.card_id = ?
        `, [req.params.card_id]);
        
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Story not found" });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error("Read API Error:", error);
        res.status(500).json({ success: false });
    }
});

// ================= 🌟 REMOVE CONTENT API 🌟 =================
app.delete("/api/admin/delete/:cardId", requireAdmin, async (req, res) => {
    const { cardId } = req.params;
    try {
        // 1. Card ID se content ka asli database ID nikalna (e.g., 'poem-15' -> id = 15)
        const idParts = cardId.split('-');
        const subId = idParts[1];

        // 2. Main content submissions table se permanently delete karna
        if (subId) {
            await pool.query("DELETE FROM content_submissions WHERE id = ?", [subId]);
        }

        // 3. Frontend card layout table se permanently hatana (newfile.html se section gayab hoga)
        await pool.query("DELETE FROM home_cards WHERE card_id = ?", [cardId]);

        await logHistory(req.currentUser.username, 'card_deleted', cardId, cardId, 'Permanently Removed by Admin');

        res.json({ success: true, message: "Content and card removed successfully from everywhere!" });
    } catch (error) {
        console.error("Delete Error:", error.message);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

app.listen(process.env.PORT || 3000, () => console.log("✅ Server running on http://localhost:3000"));