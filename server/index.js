require("dotenv").config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cheerio = require('cheerio');
const { google } = require('googleapis'); 
const { chromium } = require('playwright');

// Security middlewares
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const app = express();

// --- SECURITY MIDDLEWARE ---

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json({ limit: '15kb' }));
app.use(express.urlencoded({ extended: true, limit: '15kb' }));

app.use((req, res, next) => {
    Object.defineProperty(req, 'query', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: req.query
    });
    next();
});

app.use(mongoSanitize());
app.use(xss());

const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,
    message: { error: "Too many requests from this IP, please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', globalLimiter);

const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 15,
    message: { error: "Too many authorization attempts from this IP, please try again after an hour." }
});

// --- 1. MONGODB CONNECTION & SCHEMAS ---
const MONGO_URI = process.env.MONGO_URI;


console.log("Trying to connect with the DB...");
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

const ALL_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    picture: String,
    defaultSection: { type: String, enum: ALL_SECTIONS, default: 'A' },
    defaultTerm: { type: String, enum: ['Term-I', 'Term-II'], default: 'Term-II' }, 
    lastActive: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
    oltUsername: { type: String, default: '' },
    oltPassword: { type: String, default: '' } 
});
const User = mongoose.model('User', userSchema);

const feedbackSchema = new mongoose.Schema({
    userEmail: String,
    userName: String,
    message: { type: String, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

const todoSchema = new mongoose.Schema({
    userEmail: { type: String, required: true, index: true },
    date: { type: String, required: true },
    section: { type: String, required: true },
    subject: { type: String, required: true },
    tasks: [{
        id: String,
        text: String,
        isCompleted: Boolean
    }]
});
todoSchema.index({ userEmail: 1, date: 1, section: 1, subject: 1 }, { unique: true });
const Todo = mongoose.model('Todo', todoSchema);

// --- ANALYTICS & TRAFFIC SCHEMAS ---
const trafficLogSchema = new mongoose.Schema({
    endpoint: String,
    method: String,
    timestamp: { type: Date, default: Date.now, expires: '30d' } 
});
const TrafficLog = mongoose.model('TrafficLog', trafficLogSchema);

const analyticsEventSchema = new mongoose.Schema({
    userEmail: String,
    eventType: String, 
    eventName: String, 
    metadata: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now, expires: '90d' } 
});
const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// --- MHE WATCHER SNAPSHOT SCHEMA (remembers last known assignment state across restarts) ---
const mheSnapshotSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    hash: { type: String, default: '' },
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    notifiedRecipients: { type: [String], default: [] },   // who already got the "added to watch list" email
    passedNotified: { type: [String], default: [] },       // "<assignment>|<dueDate>" keys we already emailed as "due date passed"
    passedInit: { type: Boolean, default: false },         // false on old snapshots -> silently seed passedNotified once (no spam)
    updatedAt: { type: Date, default: Date.now }
});
const MheSnapshot = mongoose.model('MheSnapshot', mheSnapshotSchema);

// --- MHE WATCHER HISTORY (every detected state change is kept for 180 days) ---
const mheHistorySchema = new mongoose.Schema({
    key: { type: String, required: true, index: true },
    hash: String,
    data: { type: mongoose.Schema.Types.Mixed, default: [] },
    diff: { type: mongoose.Schema.Types.Mixed, default: null },
    emailSent: { type: Boolean, default: false },
    kind: { type: String, default: 'change' },   // 'baseline' | 'welcome' | 'change'
    createdAt: { type: Date, default: Date.now, expires: '180d' }
});
const MheStateHistory = mongoose.model('MheStateHistory', mheHistorySchema);

// --- ENCRYPTION LOGIC FOR CREDENTIALS ---
const ALGORITHM = 'aes-256-cbc';

const CANDIDATE_SECRETS = [
    process.env.JWT_SECRET || 'iimtrichy_fallback_secret',
    'iimtrichy_fallback_secret',
].filter((v, i, arr) => v && arr.indexOf(v) === i); 

const CANDIDATE_KEYS = CANDIDATE_SECRETS.map(secret => crypto.scryptSync(secret, 'salt', 32));
const ENCRYPTION_KEY = CANDIDATE_KEYS[0]; 

function encryptText(text) {
    if (!text) return '';
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
}

function decryptWithKey(text, key) {
    const parts = text.split(':');
    if (parts.length !== 2) throw new Error('Malformed ciphertext');
    const iv = Buffer.from(parts[0], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(parts[1], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

function decryptTextDetailed(text) {
    if (!text) return { plaintext: '', migrated: false };
    let lastErr = null;
    for (let i = 0; i < CANDIDATE_KEYS.length; i++) {
        try {
            const plaintext = decryptWithKey(text, CANDIDATE_KEYS[i]);
            return { plaintext, migrated: i > 0 };
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error('Unable to decrypt with any known key');
}

function decryptText(text) {
    try {
        return decryptTextDetailed(text).plaintext;
    } catch (err) {
        return '';
    }
}

// --- 2. GOOGLE AUTH SETUP ---
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

// --- AUTHENTICATION & TRAFFIC MIDDLEWARE ---
app.use((req, res, next) => {
    if (req.path.startsWith('/api') && !req.path.includes('/admin') && !req.path.includes('/analytics') && !req.path.includes('/attendance/progress')) {
        TrafficLog.create({ endpoint: req.path, method: req.method }).catch(() => {});
    }
    next();
});

const authenticateUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized Access.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        User.findByIdAndUpdate(decoded.id, { lastActive: new Date() }).catch(() => {});
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
    }
};

// --- 3. AUTHENTICATION & CORE ROUTES ---
app.get("/", async (req, res) => {
    return res.json("Backend is running blazingly fast 🚀");
});

app.post('/api/auth/google', strictLimiter, async (req, res) => {
    const { token } = req.body;
    try {
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { email, name, picture } = payload;

        if (!email.endsWith('@iimtrichy.ac.in')) {
            return res.status(403).json({ error: 'Access denied. Please use your @iimtrichy.ac.in email.' });
        }

        let user = await User.findOne({ email });
        if (!user) {
            user = new User({ name, email, picture, lastActive: new Date() });
            await user.save();
            console.log(`New user registered: ${email}`);
            AnalyticsEvent.create({ userEmail: email, eventType: 'auth', eventName: 'new_signup' }).catch(()=>{});
        } else {
            user.lastActive = new Date();
            await user.save();
            AnalyticsEvent.create({ userEmail: email, eventType: 'auth', eventName: 'app_opened' }).catch(()=>{});
        }

        const sessionToken = jwt.sign(
            { id: user._id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '60d' }
        );

        const userObj = user.toObject();
        userObj.hasOltCreds = !!(userObj.oltUsername && userObj.oltPassword);
        delete userObj.oltPassword;

        res.json({ message: 'Login successful', user: userObj, token: sessionToken });
    } catch (error) {
        console.error('Auth Error:', error);
        res.status(401).json({ error: 'Invalid or expired Google token' });
    }
});

app.get('/api/user/me', authenticateUser, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-__v');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        
        const userObj = user.toObject();
        userObj.hasOltCreds = !!(userObj.oltUsername && userObj.oltPassword);
        delete userObj.oltPassword;
        
        res.json({ user: userObj });
    } catch (error) {
        res.status(500).json({ error: 'Server error fetching profile.' });
    }
});

app.post('/api/user/section', authenticateUser, async (req, res) => {
    const { section } = req.body;
    if (!section || !ALL_SECTIONS.includes(String(section).toUpperCase())) {
        return res.status(400).json({ error: 'Invalid section.' });
    }
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { defaultSection: String(section).toUpperCase() },
            { returnDocument: 'after' } 
        ).select('-__v');
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Server error saving section preference.' });
    }
});

app.post('/api/user/term', authenticateUser, async (req, res) => {
    const { term } = req.body;
    if (!term || !['Term-I', 'Term-II'].includes(term)) {
        return res.status(400).json({ error: 'Invalid term.' });
    }
    try {
        const user = await User.findByIdAndUpdate(
            req.user.id,
            { defaultTerm: term },
            { returnDocument: 'after' } 
        ).select('-__v');
        res.json({ success: true, user });
    } catch (error) {
        res.status(500).json({ error: 'Server error saving term preference.' });
    }
});

app.post('/api/user/olt-credentials', authenticateUser, async (req, res) => {
    try {
        const { username, password } = req.body;
        await User.findByIdAndUpdate(req.user.id, {
            oltUsername: username,
            oltPassword: encryptText(password)
        });
        AnalyticsEvent.create({ userEmail: req.user.email, eventType: 'action', eventName: 'save_olt_creds' }).catch(()=>{});
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to save credentials' });
    }
});

app.post('/api/feedback', authenticateUser, async (req, res) => {
    const { message } = req.body;
    const email = req.user.email;
    const name = req.user.name;

    if (!message) return res.status(400).json({ error: "Missing required fields" });
    if (message.length > 1000) return res.status(400).json({ error: "Message too long." });

    try {
        const newFeedback = new Feedback({ userEmail: email, userName: name, message });
        await newFeedback.save();
        AnalyticsEvent.create({ userEmail: email, eventType: 'action', eventName: 'submit_feedback' }).catch(()=>{});
        res.json({ success: true, message: "Feedback submitted successfully." });
    } catch (error) {
        console.error("Feedback Error:", error);
        res.status(500).json({ error: "Server error saving feedback." });
    }
});

app.post('/api/analytics', authenticateUser, async (req, res) => {
    const { eventType, eventName, metadata } = req.body;
    try {
        await AnalyticsEvent.create({
            userEmail: req.user.email,
            eventType: eventType || 'interaction',
            eventName: eventName || 'unknown',
            metadata: metadata || {}
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to log event' });
    }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
app.post('/api/admin/data', strictLimiter, async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized. Incorrect password." });
    }
    try {
        const feedbacks = await Feedback.find().sort({ createdAt: -1 });
        const users = await User.find().sort({ lastActive: -1 }).select('-__v -oltPassword');
        
        const oltUsersCount = await User.countDocuments({ oltUsername: { $exists: true, $ne: '' } });

        const dauData = await AnalyticsEvent.aggregate([
            { $match: { timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, uniqueUsers: { $addToSet: "$userEmail" } } },
            { $project: { date: "$_id", count: { $size: "$uniqueUsers" } } },
            { $sort: { date: 1 } }
        ]);

        const trafficData = await TrafficLog.aggregate([
            { $match: { timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
            { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, hits: { $sum: 1 } } },
            { $project: { date: "$_id", hits: 1 } },
            { $sort: { date: 1 } }
        ]);

        const featureUsage = await AnalyticsEvent.aggregate([
            { $match: { eventType: 'tab_click' } },
            { $group: { _id: "$eventName", clicks: { $sum: 1 } } },
            { $sort: { clicks: -1 } }
        ]);

        const interactions = await AnalyticsEvent.aggregate([
            { $match: { eventType: 'button_click' } },
            { $group: { _id: "$eventName", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.json({ 
            success: true, 
            feedbacks, 
            users,
            analytics: { 
                dau: dauData, 
                traffic: trafficData, 
                features: featureUsage, 
                interactions, 
                oltUsersCount 
            }
        });
    } catch (error) {
        console.error("Admin Error:", error);
        res.status(500).json({ error: "Server error fetching admin data." });
    }
});

app.post('/api/admin/user-details', strictLimiter, async (req, res) => {
    const { password, email } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized. Incorrect password." });
    }
    
    try {
        const user = await User.findOne({ email }).select('-__v -oltPassword');
        if (!user) return res.status(404).json({ error: "User not found" });

        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
        const activityRaw = await AnalyticsEvent.aggregate([
            { $match: { userEmail: email, timestamp: { $gte: sevenDaysAgo } } },
            { $group: { 
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: "Asia/Kolkata" } }, 
                count: { $sum: 1 } 
            }},
            { $sort: { _id: 1 } }
        ]);

        const recentEventsRaw = await AnalyticsEvent.find({ userEmail: email })
            .sort({ timestamp: -1 })
            .limit(150);

        res.json({ 
            success: true, 
            user, 
            activityRaw, 
            recentEventsRaw 
        });
    } catch (error) {
        console.error("User Details Error:", error);
        res.status(500).json({ error: "Server error fetching user details." });
    }
});

app.get('/api/todos', authenticateUser, async (req, res) => {
    try {
        const todos = await Todo.find({ userEmail: req.user.email });
        const formattedTodos = {};
        todos.forEach(t => {
            if (!formattedTodos[t.date]) formattedTodos[t.date] = {};
            if (!formattedTodos[t.date][t.section]) formattedTodos[t.date][t.section] = {};
            formattedTodos[t.date][t.section][t.subject] = t.tasks;
        });
        res.json(formattedTodos);
    } catch (error) {
        console.error("Error fetching todos:", error);
        res.status(500).json({ error: "Server error fetching tasks." });
    }
});

app.post('/api/todos', authenticateUser, async (req, res) => {
    const { date, section, subject, tasks } = req.body;
    const email = req.user.email;

    if (!date || !section || !subject || !Array.isArray(tasks)) {
        return res.status(400).json({ error: "Invalid data format." });
    }

    try {
        if (tasks.length === 0) {
            await Todo.deleteOne({ userEmail: email, date, section, subject });
        } else {
            await Todo.findOneAndUpdate(
                { userEmail: email, date, section, subject },
                { tasks },
                { upsert: true, returnDocument: 'after' } 
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Error saving todos:", error);
        res.status(500).json({ error: "Server error saving tasks." });
    }
});


// ============================================================
// MCGRAW HILL ASSIGNMENTS SCRAPER
//  - resilient login (single-step or two-step, fill/type fallback, cookie banner)
//  - captures the assignments API response, with a direct re-request fallback
//  - whole scrape is retried (not for wrong passwords)
//  - every assignment carries due-date info: dueAt (ISO), isPastDue, dueLabel, timeRemainingMs
// ============================================================

let mheScrapeBusy = false;
const MHE_MIN_DUE_DATE = process.env.MHE_MIN_DUE_DATE || '2026-10-11';

const MHE_DONE_KEYS = ['SUBMITTED', 'COMPLETE', 'COMPLETED', 'GRADED', 'DONE'];
const MHE_URGENT_MS = 24 * 60 * 60 * 1000; // "due soon" highlight = less than 24h left

// ---------- due-date helpers ----------

// Turn whatever MHE gave us ("2026-10-20T18:29:00Z", "2026-10-20 18:29", ...) into a timestamp (ms).
// Values without a timezone are treated as UTC (the API returns UTC).
function mheParseDue(item) {
    if (!item) return null;
    const raw = item.dueAt || item.dueDate;
    if (!raw || raw === 'No due date') return null;
    let s = String(raw).trim().replace(' ', 'T');
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z';
    const ts = Date.parse(s);
    return isNaN(ts) ? null : ts;
}

function mheNormalizeDueIso(raw) {
    const ts = mheParseDue({ dueDate: raw });
    return ts === null ? '' : new Date(ts).toISOString();
}

function mheFormatRemaining(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `${d}d ${h}h left`;
    if (h > 0) return `${h}h ${m}m left`;
    return `${Math.max(m, 1)}m left`;
}

function mheFormatIST(ts) {
    return new Date(ts).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }) + ' IST';
}

function mheIsDone(status) {
    return MHE_DONE_KEYS.includes(String(status || '').toUpperCase().replace(/[_\s-]/g, ''));
}

// { hasDue, isPast, ts, label, urgent }
function mheDueInfo(item, now = Date.now()) {
    const ts = mheParseDue(item);
    if (ts === null) return { hasDue: false, isPast: false, ts: null, label: 'No due date', urgent: false };
    const diff = ts - now;
    if (diff <= 0) return { hasDue: true, isPast: true, ts, label: 'Due date passed', urgent: false };
    return { hasDue: true, isPast: false, ts, label: mheFormatRemaining(diff), urgent: diff < MHE_URGENT_MS };
}

// Adds the fields the frontend / emails need. Keeps every original field untouched.
function mheEnrich(item, now = Date.now()) {
    const info = mheDueInfo(item, now);
    return {
        ...item,
        dueAt: info.ts ? new Date(info.ts).toISOString() : '',
        dueTimestamp: info.ts,
        isPastDue: info.isPast,
        dueLabel: info.label,                       // "Due date passed" | "2d 5h left" | "No due date"
        timeRemainingMs: info.hasDue && !info.isPast ? info.ts - now : 0
    };
}

async function scrapeMheOnce({ username, password, sectionId, userEmail }) {
    let browser;
    try {
        const launchOptions = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--disable-blink-features=AutomationControlled'
            ]
        };
        // Optional proxy if Render's IP gets blocked, e.g. MHE_PROXY=http://user:pass@host:port
        if (process.env.MHE_PROXY) launchOptions.proxy = { server: process.env.MHE_PROXY };

        browser = await chromium.launch(launchOptions);

        const context = await browser.newContext({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport: { width: 1920, height: 1080 },
            locale: 'en-US',
            timezoneId: 'Asia/Kolkata'
        });

        // Save memory/bandwidth: skip heavy assets
        await context.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) return route.abort();
            return route.continue();
        });

        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        const page = await context.newPage();
        page.setDefaultTimeout(60000);

        // --- Context-level listeners: catch the API call from any frame/page ---
        let rawApiData = null;
        let resolveCaptured;
        const captured = new Promise(r => { resolveCaptured = r; });
        const seenApiUrls = [];
        let savedRequest = null; // remembered so we can re-request the API ourselves if the body was unreadable

        const pickPayload = (json) => {
            if (!json || typeof json !== 'object') return null;
            if (Array.isArray(json.sectionAssignments)) return json;
            if (json.data && Array.isArray(json.data.sectionAssignments)) return json.data;
            return null;
        };

        context.on('request', (req) => {
            try {
                if (req.url().includes('studentAssignments')) {
                    const { host, 'content-length': _cl, cookie, connection, ...headers } = req.headers();
                    savedRequest = { url: req.url(), headers };
                }
            } catch (e) { /* ignore */ }
        });

        context.on('response', async (response) => {
            try {
                const url = response.url();
                if (/assignment/i.test(url)) seenApiUrls.push(`${response.status()} ${url.substring(0, 140)}`);
                if (rawApiData) return;
                if (!/studentAssignments/i.test(url)) return;
                if (response.status() !== 200) return;

                const payload = pickPayload(JSON.parse(await response.text()));
                if (payload) {
                    rawApiData = payload;
                    resolveCaptured(true);
                }
            } catch (e) {
                // body can be unavailable if the page navigated; fallbacks below handle it
            }
        });

        // --- LOGIN (fill first, keystroke typing as fallback; handles 1-step and 2-step forms) ---
        username = String(username || '').trim();
        password = String(password || '');
        console.log(`[MHE] ${userEmail} logging in... (user len=${username.length}, pass len=${password.length})`);

        const emailLoc = () => page.locator("input[type='email'], input[name='email'], input#email, input[autocomplete='username']").first();
        const passLoc = () => page.locator("input[type='password']").first();
        const submitLoc = () => page.locator("button:has-text('Sign In'), button:has-text('Log In'), button:has-text('Login'), button[type='submit']").first();
        const nextLoc = () => page.locator("button:has-text('Continue'), button:has-text('Next')").first();

        const tryLogin = async (mode) => {
            await page.goto("https://accounts.mheducation.com/login", { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

            // Cookie banner can sit on top of the form
            await page.click('#onetrust-accept-btn-handler', { timeout: 2500 }).catch(() => {});

            await emailLoc().waitFor({ state: 'visible', timeout: 25000 });

            const setValue = async (loc, val) => {
                await loc.click();
                await loc.fill('');
                if (mode === 'fill') await loc.fill(val);
                else if (typeof loc.pressSequentially === 'function') await loc.pressSequentially(val, { delay: 90 });
                else await loc.type(val, { delay: 90 });
            };

            await setValue(emailLoc(), username);

            // Two-step login: password box only appears after "Continue/Next"
            if (!(await passLoc().isVisible().catch(() => false))) {
                if (await nextLoc().isVisible().catch(() => false)) await nextLoc().click();
                else await emailLoc().press('Enter').catch(() => {});
                await passLoc().waitFor({ state: 'visible', timeout: 15000 });
            }

            await setValue(passLoc(), password);

            const emailOk = (await emailLoc().inputValue().catch(() => username)) === username;
            const passOk = (await passLoc().inputValue().catch(() => password)) === password;
            console.log(`[MHE] mode=${mode} fieldsMatchInput: email=${emailOk}, password=${passOk}`);

            if (await submitLoc().isVisible().catch(() => false)) await submitLoc().click();
            else await passLoc().press('Enter');

            // Poll up to 25s: success = left /login, failure = error text shown
            for (let i = 0; i < 25; i++) {
                await page.waitForTimeout(1000);
                if (!page.url().includes('/login')) return { ok: true };
                const body = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ');
                if (/do not match any accounts|incorrect (email|password)|invalid (email|password|credentials)/i.test(body)) {
                    return { ok: false, reason: 'BAD_CREDS', emailOk, passOk };
                }
                if (/captcha|verify you are (a )?human/i.test(body)) {
                    return { ok: false, reason: 'CAPTCHA', emailOk, passOk };
                }
            }
            return { ok: false, reason: 'NO_REDIRECT', emailOk, passOk };
        };

        let result;
        try {
            result = await tryLogin('fill');
        } catch (e) {
            result = { ok: false, reason: 'LOGIN_ERROR', message: e.message };
        }
        if (!result.ok && result.reason !== 'BAD_CREDS') {
            console.log(`[MHE] fill mode failed (${result.reason}${result.message ? ': ' + result.message : ''}), retrying with typed input...`);
            try {
                result = await tryLogin('type');
            } catch (e) {
                result = { ok: false, reason: 'LOGIN_ERROR', message: e.message };
            }
        }

        if (!result.ok) {
            const err = new Error(
                result.reason === 'BAD_CREDS'
                    ? "McGraw Hill rejected the email/password. Please re-check them (try logging in at accounts.mheducation.com first)."
                    : "McGraw Hill login did not complete (possible captcha or bot-block on the server IP)."
            );
            err.code = result.reason;
            err.debug = { afterLoginUrl: page.url(), ...result };
            throw err;
        }

        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(2000);
        console.log(`[MHE] After login URL: ${page.url()}`);

        // --- FETCH CLASS PAGE ---
        const classUrl = `https://newconnect.mheducation.com/student/class/section/${sectionId}`;
        console.log(`[MHE] Opening ${classUrl}`);

        await page.goto(classUrl, { waitUntil: "domcontentloaded" }).catch(e => {
            console.log("[MHE] goto warning:", e.message);
        });

        const waitForCapture = (ms) => Promise.race([
            captured,
            new Promise(r => setTimeout(() => r(false), ms))
        ]);

        let ok = await waitForCapture(40000);

        if (!ok) {
            console.log("[MHE] No payload yet, reloading once...");
            await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
            ok = await waitForCapture(30000);
        }

        // Fallback: we saw the request but could not read the body -> call the same API ourselves (cookies are shared)
        if ((!ok || !rawApiData) && savedRequest) {
            try {
                console.log("[MHE] Re-requesting assignments API directly...");
                const apiRes = await context.request.get(savedRequest.url, { headers: savedRequest.headers, timeout: 30000 });
                if (apiRes.ok()) {
                    const payload = pickPayload(await apiRes.json());
                    if (payload) { rawApiData = payload; ok = true; }
                }
            } catch (e) {
                console.log("[MHE] Direct API fallback failed:", e.message);
            }
        }

        if (!ok || !rawApiData) {
            let bodySnippet = '';
            try {
                bodySnippet = (await page.innerText('body')).replace(/\s+/g, ' ').substring(0, 300);
            } catch (e) {}
            const err = new Error("Logged in, but the assignments data never loaded. Check your Section ID.");
            err.debug = {
                finalUrl: page.url(),
                title: await page.title().catch(() => ''),
                bodySnippet,
                seenApiUrls: seenApiUrls.slice(0, 10)
            };
            throw err;
        }

        // --- PARSE ---
        const courseDetails = {};
        for (const a of rawApiData.sectionAssignments || []) {
            courseDetails[a.id] = {
                name: a.name || 'Unknown',
                due: a.endDateTime || ''
            };
        }

        const list = [];
        for (const s of rawApiData.studentAssignments || []) {
            const details = courseDetails[s.sectionAssignment];
            if (!details) continue;

            const dueClean = details.due ? details.due.replace("T", " ").substring(0, 16) : 'No due date';
            if (dueClean === 'No due date' || dueClean >= MHE_MIN_DUE_DATE) {
                list.push({
                    status: s.status || 'UNKNOWN',
                    dueDate: dueClean,                              // same format as before (hash/diff stay compatible)
                    dueAt: mheNormalizeDueIso(details.due),         // full ISO timestamp for countdowns
                    name: details.name
                });
            }
        }

        list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        return list;
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// Retries the whole scrape (fresh browser each time). Wrong passwords are never retried.
async function scrapeMheAssignments(opts, attempts = 2) {
    let lastErr;
    for (let i = 1; i <= attempts; i++) {
        try {
            return await scrapeMheOnce(opts);
        } catch (err) {
            lastErr = err;
            if (err.code === 'BAD_CREDS') throw err;
            console.warn(`[MHE] Scrape attempt ${i}/${attempts} failed: ${err.message}`);
            if (i < attempts) await new Promise(r => setTimeout(r, 5000 * i));
        }
    }
    throw lastErr;
}


app.post('/api/assignments/fetch', authenticateUser, async (req, res) => {
    const { mheUsername, mhePassword, sectionId } = req.body;

    if (!mheUsername || !mhePassword || !sectionId) {
        return res.status(400).json({ error: "Missing McGraw Hill credentials or sectionId" });
    }

    if (mheScrapeBusy) {
        return res.status(429).json({ error: "Another fetch is in progress. Please try again in about a minute." });
    }

    mheScrapeBusy = true;
    try {
        const list = await scrapeMheAssignments({
            username: mheUsername,
            password: mhePassword,
            sectionId: String(sectionId).trim(),
            userEmail: req.user.email
        }, 2);
        const now = Date.now();
        const data = list.map(item => mheEnrich(item, now));
        return res.status(200).json({ success: true, count: data.length, serverTime: new Date(now).toISOString(), data });
    } catch (error) {
        console.error(`[MHE] Error for ${req.user.email}: ${error.message}`, error.debug || '');
        const status = error.code === 'BAD_CREDS' ? 400 : 500;
        return res.status(status).json({
            error: error.message,
            debug: error.debug || undefined   // remove once it works
        });
    } finally {
        mheScrapeBusy = false;
    }
});

// ============================================================
// MCGRAW HILL BACKGROUND WATCHER
// Runs the same scrape as the "Assignments" tab on a schedule using
// credentials from environment variables, compares the result with the
// last saved snapshot (stored in MongoDB so it survives restarts) and
// emails the recipients when ANYTHING changes:
//   - new assignment            - removed assignment
//   - status change             - due date change
//   - due date has PASSED while the assignment is still not submitted
// Every assignment in the email shows "Due date passed" or the remaining time.
//
// Required env vars (set on Render / in .env):
//   MHE_WATCH_USERNAME     e.g. kartheek.p26030@iimtrichy.ac.in
//   MHE_WATCH_PASSWORD     your McGraw Hill password
//   MHE_WATCH_SECTION_ID   e.g. 157468169
//   BREVO_API_KEY          mail is sent over HTTPS via Brevo (works on Render FREE)
//   MAIL_FROM_EMAIL        a sender you verified inside Brevo
// Optional:
//   MHE_WATCH_RECIPIENTS        comma separated (default: kartheek.p26030@iimtrichy.ac.in,sasank.p26036@iimtrichy.ac.in)
//   MHE_WATCH_ENABLED           "false" switches the watcher off
//   MHE_WATCH_NOTIFY_FIRST_RUN  "false" disables the one-time welcome / watch-list email
//   MHE_WATCH_INTERVAL_MIN      minutes between checks (default 30)
//   MAIL_FROM_NAME              display name (default: IIMT Assignment Watcher)
// ============================================================

const MHE_WATCH_ENABLED = process.env.MHE_WATCH_ENABLED !== 'false';
const MHE_WATCH_USERNAME = process.env.MHE_WATCH_USERNAME || '';
const MHE_WATCH_PASSWORD = process.env.MHE_WATCH_PASSWORD || '';
const MHE_WATCH_SECTION_ID = process.env.MHE_WATCH_SECTION_ID || '';
const MHE_WATCH_RECIPIENTS = (process.env.MHE_WATCH_RECIPIENTS || 'kartheek.p26030@iimtrichy.ac.in,sasank.p26036@iimtrichy.ac.in')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
// ON by default: every recipient gets a one-time "you've been added to the watch list" email with the current status.
const MHE_WATCH_WELCOME_ENABLED = process.env.MHE_WATCH_NOTIFY_FIRST_RUN !== 'false';

const MHE_WATCH_INTERVAL_MIN = Math.max(5, parseInt(process.env.MHE_WATCH_INTERVAL_MIN || '30', 10) || 30);
const MHE_WATCH_INTERVAL_MS = MHE_WATCH_INTERVAL_MIN * 60 * 1000;
const MHE_WATCH_BUSY_RETRY_MS = 5 * 60 * 1000;      // if a user scrape is running, retry in 5 min
const MHE_WATCH_INITIAL_DELAY_MS = 90 * 1000;       // let the server + Excel cache settle first
const MHE_WATCH_FAILURE_ALERT_AFTER = 3;            // email one alert after N consecutive failures
const MHE_WATCH_RETRY_AFTER_FAIL_MS = 10 * 60 * 1000; // after a failed run, try again in 10 min

let mheWatchConsecutiveFailures = 0;
let mheWatchFailureAlertSent = false;

// In-memory status, readable through POST /api/admin/mhe-watch/status
const mheWatchStatus = {
    running: false,
    runs: 0,
    lastRunAt: null,
    lastOutcome: 'never',
    lastTrigger: null,
    lastDurationMs: null,
    lastError: null,
    nextRunAt: null
};

const MHE_WATCH_SNAPSHOT_KEY = `mhe-watch:${MHE_WATCH_SECTION_ID}`;

// ------------------------------------------------------------
// MAIL DELIVERY (Brevo HTTPS API)
// ------------------------------------------------------------
function mheMailProviderName() {
    if (process.env.BREVO_API_KEY) return 'brevo-api';
    return 'none';
}

async function sendMheMail(subject, htmlContent, textContent, recipients) {
    // If no specific recipients are passed (e.g., failure alerts), fall back to the default list
    const targetRecipients = (recipients && recipients.length > 0) ? recipients : MHE_WATCH_RECIPIENTS;
    const toArray = targetRecipients.map(email => ({ email }));

    if (!process.env.BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY is not set, cannot send email.');
    }

    let lastDetail = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await axios.post(
                'https://api.brevo.com/v3/smtp/email',
                {
                    sender: {
                        name: process.env.MAIL_FROM_NAME || "IIMT Assignment Watcher",
                        email: process.env.MAIL_FROM_EMAIL || "copypasteenbl@gmail.com" // must be a verified Brevo sender
                    },
                    to: toArray,
                    subject,
                    htmlContent,
                    textContent
                },
                {
                    headers: {
                        'api-key': process.env.BREVO_API_KEY,
                        'Content-Type': 'application/json',
                        'accept': 'application/json'
                    },
                    timeout: 20000
                }
            );
            console.log('[MHE-Watch] Email sent via Brevo. Message ID:', response.data && response.data.messageId);
            return true;
        } catch (error) {
            const status = error.response && error.response.status;
            lastDetail = error.response ? `HTTP ${status} ${JSON.stringify(error.response.data)}` : error.message;
            console.error(`[MHE-Watch] Brevo send attempt ${attempt}/3 failed: ${lastDetail}`);
            // 4xx (except 429) = a config / payload problem, retrying will not help
            if (status && status < 500 && status !== 429) break;
            if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    throw new Error(`Brevo API send failed: ${lastDetail}`);
}

// Logged once at startup so problems are visible immediately
async function verifyMailProvider() {
    if (!process.env.BREVO_API_KEY) {
        console.error('[MHE-Watch] Mail provider check FAILED: BREVO_API_KEY is not set.');
        return;
    }
    try {
        await axios.get('https://api.brevo.com/v3/account', {
            headers: { 'api-key': process.env.BREVO_API_KEY, accept: 'application/json' },
            timeout: 15000
        });
        console.log('[MHE-Watch] Mail provider check OK: Brevo API key is valid.');
    } catch (err) {
        const detail = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
        console.error(`[MHE-Watch] Mail provider check FAILED (brevo-api): ${detail}`);
    }
}


const escapeHtml = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Turn the list into a stable map keyed by assignment name (duplicates get #2, #3...)
function mheListToMap(list) {
    const map = new Map();
    const seen = {};
    for (const item of list || []) {
        const baseKey = String(item.name || 'Unknown').trim();
        seen[baseKey] = (seen[baseKey] || 0) + 1;
        const key = seen[baseKey] > 1 ? `${baseKey} #${seen[baseKey]}` : baseKey;
        map.set(key, { name: baseKey, status: item.status, dueDate: item.dueDate, dueAt: item.dueAt || '' });
    }
    return map;
}

// NOTE: the hash only looks at name + status + dueDate (same as before), so deploying this version
// does NOT look like a "change" to the already-saved snapshot.
function mheHashList(list) {
    const normalized = Array.from(mheListToMap(list).entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, v]) => [key, v.status, v.dueDate]);
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function mheComputeDiff(oldList, newList) {
    const oldMap = mheListToMap(oldList);
    const newMap = mheListToMap(newList);

    const added = [];
    const removed = [];
    const statusChanged = [];
    const dueChanged = [];

    for (const [key, n] of newMap.entries()) {
        const o = oldMap.get(key);
        if (!o) {
            added.push(n);
            continue;
        }
        if (o.status !== n.status) statusChanged.push({ name: key, from: o.status, to: n.status, dueDate: n.dueDate, dueAt: n.dueAt });
        if (o.dueDate !== n.dueDate) dueChanged.push({ name: key, from: o.dueDate, to: n.dueDate, toAt: n.dueAt, status: n.status });
    }
    for (const [key, o] of oldMap.entries()) {
        if (!newMap.has(key)) removed.push(o);
    }

    return { added, removed, statusChanged, dueChanged, nowPassed: [] };
}

// Assignments whose due date has passed and which are not submitted yet.
// passKey includes the due date, so if the deadline is extended and later passes again, we notify again.
function mhePassedItems(list, now = Date.now()) {
    const out = [];
    for (const [key, v] of mheListToMap(list).entries()) {
        if (mheIsDone(v.status)) continue;
        if (!mheDueInfo(v, now).isPast) continue;
        out.push({ passKey: `${key}|${v.dueDate}`, item: { ...v, name: key } });
    }
    return out;
}

// ------------------------------------------------------------
// EMAIL TEMPLATE HELPERS (inline styles only, so Gmail renders them correctly)
// ------------------------------------------------------------
function mheStatusKey(status) {
    return String(status || 'UNKNOWN').toUpperCase().replace(/[_\s-]/g, '');
}

function mheStatusLabel(status) {
    const key = mheStatusKey(status);
    const map = {
        NOTSTARTED: 'NOT STARTED',
        INPROGRESS: 'IN PROGRESS',
        NOTSUBMITTED: 'NOT SUBMITTED',
        PASTDUE: 'PAST DUE'
    };
    return map[key] || String(status || 'UNKNOWN').toUpperCase().replace(/_/g, ' ');
}

function mheStatusColors(status) {
    const key = mheStatusKey(status);
    if (['SUBMITTED', 'COMPLETE', 'COMPLETED', 'GRADED', 'DONE'].includes(key)) return { bg: '#dcfce7', fg: '#166534' };   // green
    if (['INPROGRESS', 'STARTED', 'OPEN'].includes(key)) return { bg: '#dbeafe', fg: '#1e40af' };                          // blue
    if (['NOTSTARTED', 'PENDING', 'NOTSUBMITTED', 'UNKNOWN'].includes(key)) return { bg: '#fef3c7', fg: '#92400e' };       // amber
    if (['OVERDUE', 'LATE', 'PASTDUE', 'MISSED'].includes(key)) return { bg: '#fee2e2', fg: '#991b1b' };                   // red
    return { bg: '#e5e7eb', fg: '#374151' };                                                                               // grey
}

function mheBadge(status) {
    const c = mheStatusColors(status);
    return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:12px;font-weight:700;">${escapeHtml(mheStatusLabel(status))}</span>`;
}

// "Due date passed" (red)  |  "5h 20m left" (amber if < 24h, else blue)  |  "No due date" (grey)
function mheDueBadge(item) {
    const info = mheDueInfo(item);
    let bg = '#e5e7eb', fg = '#374151', text = info.label;
    if (info.isPast) { bg = '#fee2e2'; fg = '#991b1b'; text = 'DUE DATE PASSED'; }
    else if (info.hasDue && info.urgent) { bg = '#fef3c7'; fg = '#92400e'; text = info.label.toUpperCase(); }
    else if (info.hasDue) { bg = '#dbeafe'; fg = '#1e40af'; text = info.label.toUpperCase(); }
    return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:700;">${escapeHtml(text)}</span>`;
}

// Human readable due date in IST (falls back to the raw string)
function mheDueDisplay(item) {
    const ts = mheParseDue(item);
    if (ts !== null) return mheFormatIST(ts);
    return (item && item.dueDate) || 'No due date';
}

function mheDueText(item) {
    const info = mheDueInfo(item);
    return info.isPast ? 'DUE DATE PASSED' : info.label;
}

function mheCard(accent, mainHtml, subHtml) {
    return `<div style="border-left:4px solid ${accent};background:#f9fafb;border-radius:6px;padding:10px 14px;margin-bottom:8px;">` +
        `<div style="font-size:14px;font-weight:600;color:#111827;">${mainHtml}</div>` +
        `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${subHtml}</div>` +
        `</div>`;
}

function mheSection(title, accent, cardsHtml) {
    return `<tr><td style="padding:20px 28px 0 28px;">` +
        `<div style="font-size:14px;font-weight:700;color:${accent};margin-bottom:10px;">${title}</div>` +
        `${cardsHtml}</td></tr>`;
}

function mheChips(items) {
    const cells = items.filter(i => i.count > 0).map(i =>
        `<td style="padding-right:8px;"><div style="background:${i.bg};color:${i.fg};border-radius:8px;padding:8px 16px;text-align:center;">` +
        `<div style="font-size:20px;font-weight:700;">${i.count}</div>` +
        `<div style="font-size:11px;font-weight:600;">${i.label}</div></div></td>`
    ).join('');
    if (!cells) return '';
    return `<tr><td style="padding:22px 28px 0 28px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
}

function mheListTable(list) {
    const rows = (list || []).map((i, idx) =>
        `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">` +
        `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">${escapeHtml(i.name)}</td>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#4b5563;">` +
            `<div style="white-space:nowrap;margin-bottom:4px;">${escapeHtml(mheDueDisplay(i))}</div>${mheDueBadge(i)}</td>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${mheBadge(i.status)}</td>` +
        `</tr>`
    ).join('');

    const body = rows || `<tr><td colspan="3" style="padding:14px;font-size:13px;color:#6b7280;text-align:center;">No assignments</td></tr>`;

    return `<tr><td style="padding:24px 28px 8px 28px;">` +
        `<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:10px;">📋 All assignments (${(list || []).length})</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">` +
        `<tr style="background:#eef2ff;">` +
        `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;">ASSIGNMENT</td>` +
        `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;">DUE / TIME LEFT</td>` +
        `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;text-align:right;">STATUS</td></tr>` +
        `${body}</table></td></tr>`;
}

function mheEmailShell({ headerTitle, headerSub, headerColor, bodyRows }) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;">` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">` +
        `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
        `<tr><td bgcolor="${headerColor}" style="background:${headerColor};padding:26px 28px;">` +
        `<div style="font-size:11px;color:#c7d2fe;letter-spacing:1.5px;font-weight:700;">MCGRAW HILL CONNECT</div>` +
        `<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">${headerTitle}</div>` +
        `<div style="font-size:12px;color:#e0e7ff;margin-top:6px;">${headerSub}</div>` +
        `</td></tr>` +
        `${bodyRows}` +
        `<tr><td style="padding:22px 28px;text-align:center;font-size:11px;color:#9ca3af;">Sent automatically by IIMT Assignment Watcher · checks every ${MHE_WATCH_INTERVAL_MIN} min · times shown in IST</td></tr>` +
        `</table></td></tr></table></body></html>`;
}

function mheBuildChangeEmail(diff, newList) {
    const { added, removed, statusChanged, dueChanged } = diff;
    const nowPassed = diff.nowPassed || [];
    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    let body = mheChips([
        { label: 'NEW', count: added.length, bg: '#dcfce7', fg: '#166534' },
        { label: 'STATUS', count: statusChanged.length, bg: '#dbeafe', fg: '#1e40af' },
        { label: 'DUE DATE', count: dueChanged.length, bg: '#fef3c7', fg: '#92400e' },
        { label: 'DUE PASSED', count: nowPassed.length, bg: '#fee2e2', fg: '#991b1b' },
        { label: 'REMOVED', count: removed.length, bg: '#fee2e2', fg: '#991b1b' }
    ]);

    const textParts = [];

    if (added.length) {
        body += mheSection('🆕 New assignments', '#16a34a', added.map(a =>
            mheCard('#16a34a', escapeHtml(a.name), `Due ${escapeHtml(mheDueDisplay(a))} &nbsp;·&nbsp; ${mheDueBadge(a)} &nbsp;·&nbsp; ${mheBadge(a.status)}`)).join(''));
        textParts.push(`NEW ASSIGNMENTS (${added.length})\n` + added.map(a => `- ${a.name} | due ${mheDueDisplay(a)} (${mheDueText(a)}) | ${mheStatusLabel(a.status)}`).join('\n'));
    }
    if (nowPassed.length) {
        body += mheSection('⏰ Due date passed (not submitted)', '#b91c1c', nowPassed.map(p =>
            mheCard('#b91c1c', escapeHtml(p.name), `Was due ${escapeHtml(mheDueDisplay(p))} &nbsp;·&nbsp; ${mheDueBadge(p)} &nbsp;·&nbsp; ${mheBadge(p.status)}`)).join(''));
        textParts.push(`DUE DATE PASSED (${nowPassed.length})\n` + nowPassed.map(p => `- ${p.name} | was due ${mheDueDisplay(p)} | ${mheStatusLabel(p.status)}`).join('\n'));
    }
    if (statusChanged.length) {
        body += mheSection('🔄 Status changes', '#2563eb', statusChanged.map(s =>
            mheCard('#2563eb', escapeHtml(s.name), `${mheBadge(s.from)} &nbsp;→&nbsp; ${mheBadge(s.to)} &nbsp;·&nbsp; Due ${escapeHtml(mheDueDisplay(s))} &nbsp;·&nbsp; ${mheDueBadge(s)}`)).join(''));
        textParts.push(`STATUS CHANGES (${statusChanged.length})\n` + statusChanged.map(s => `- ${s.name}: ${mheStatusLabel(s.from)} -> ${mheStatusLabel(s.to)} (due ${mheDueDisplay(s)}, ${mheDueText(s)})`).join('\n'));
    }
    if (dueChanged.length) {
        body += mheSection('📅 Due date changes', '#d97706', dueChanged.map(d => {
            const oldItem = { dueDate: d.from };
            const newItem = { dueDate: d.to, dueAt: d.toAt };
            return mheCard('#d97706', escapeHtml(d.name),
                `<s style="color:#9ca3af;">${escapeHtml(mheDueDisplay(oldItem))}</s> &nbsp;→&nbsp; <b style="color:#92400e;">${escapeHtml(mheDueDisplay(newItem))}</b> &nbsp;·&nbsp; ${mheDueBadge(newItem)}`);
        }).join(''));
        textParts.push(`DUE DATE CHANGES (${dueChanged.length})\n` + dueChanged.map(d => `- ${d.name}: ${mheDueDisplay({ dueDate: d.from })} -> ${mheDueDisplay({ dueDate: d.to, dueAt: d.toAt })} (${mheDueText({ dueDate: d.to, dueAt: d.toAt })})`).join('\n'));
    }
    if (removed.length) {
        body += mheSection('🗑️ Removed assignments', '#dc2626', removed.map(r =>
            mheCard('#dc2626', escapeHtml(r.name), `Was due ${escapeHtml(mheDueDisplay(r))} &nbsp;·&nbsp; ${mheBadge(r.status)}`)).join(''));
        textParts.push(`REMOVED ASSIGNMENTS (${removed.length})\n` + removed.map(r => `- ${r.name} | was due ${mheDueDisplay(r)} | ${mheStatusLabel(r.status)}`).join('\n'));
    }

    body += mheListTable(newList);

    const total = added.length + removed.length + statusChanged.length + dueChanged.length + nowPassed.length;

    const html = mheEmailShell({
        headerTitle: `${total} update${total === 1 ? '' : 's'} detected`,
        headerSub: `${escapeHtml(stamp)} (IST)`,
        headerColor: '#4f46e5',
        bodyRows: body
    });

    const text =
        `McGraw Hill assignments updated (${stamp} IST)\n\n` +
        textParts.join('\n\n') +
        `\n\nCURRENT LIST (${(newList || []).length})\n` +
        (newList || []).map(i => `- ${i.name} | due ${mheDueDisplay(i)} | ${mheDueText(i)} | ${mheStatusLabel(i.status)}`).join('\n');

    const bits = [];
    if (added.length) bits.push(`${added.length} new`);
    if (nowPassed.length) bits.push(`${nowPassed.length} due date passed`);
    if (statusChanged.length) bits.push(`${statusChanged.length} status`);
    if (dueChanged.length) bits.push(`${dueChanged.length} due date`);
    if (removed.length) bits.push(`${removed.length} removed`);

    return { subject: `📚 MHE update: ${bits.join(', ')}`, html, text, total };
}

function mheBuildWelcomeEmail(list, recipients) {
    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const items = list || [];

    // Count assignments per status for the colored summary chips
    const counts = {};
    items.forEach(i => {
        const k = mheStatusKey(i.status);
        if (!counts[k]) counts[k] = { status: i.status, count: 0 };
        counts[k].count++;
    });
    const statusChips = Object.values(counts).map(c => {
        const col = mheStatusColors(c.status);
        return { label: mheStatusLabel(c.status), count: c.count, bg: col.bg, fg: col.fg };
    });
    const passedCount = items.filter(i => mheDueInfo(i).isPast).length;
    const chips = mheChips([
        ...statusChips,
        { label: 'DUE PASSED', count: passedCount, bg: '#fee2e2', fg: '#991b1b' }
    ]);

    const watchList = (recipients && recipients.length ? recipients : MHE_WATCH_RECIPIENTS)
        .map(r => `<span style="display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:3px 10px;font-size:12px;margin:2px 4px 2px 0;">${escapeHtml(r)}</span>`)
        .join('');

    let body =
        `<tr><td style="padding:22px 28px 0 28px;font-size:14px;color:#374151;line-height:1.6;">` +
        `Hi 👋 You’ve been added to the <b>McGraw Hill assignment watch list</b>.<br>` +
        `We check McGraw Hill Connect every ${MHE_WATCH_INTERVAL_MIN} minutes and email you as soon as an assignment is added, removed, its status or due date changes, or a due date passes.` +
        `</td></tr>` +
        `<tr><td style="padding:14px 28px 0 28px;font-size:12px;color:#6b7280;">Watch list:<br>${watchList}</td></tr>` +
        `<tr><td style="padding:22px 28px 0 28px;font-size:14px;font-weight:700;color:#111827;">📊 Current status</td></tr>` +
        chips +
        mheListTable(items);

    const html = mheEmailShell({
        headerTitle: 'You’re on the watch list 🔔',
        headerSub: `Status as of ${escapeHtml(stamp)} (IST)`,
        headerColor: '#059669',
        bodyRows: body
    });

    const text =
        `You've been added to the McGraw Hill assignment watch list (${stamp} IST)\n` +
        `You'll get an email whenever an assignment is added, removed, its status / due date changes, or a due date passes.\n\n` +
        `CURRENT STATUS (${items.length})\n` +
        (items.length ? items.map(i => `- ${i.name} | due ${mheDueDisplay(i)} | ${mheDueText(i)} | ${mheStatusLabel(i.status)}`).join('\n') : '- No assignments');

    return { subject: `🔔 You’ve been added to the MHE assignment watch list (${items.length} tracked)`, html, text };
}

function mheBuildFailureEmail(failures, errMessage) {
    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const body =
        `<tr><td style="padding:22px 28px 8px 28px;">` +
        mheCard('#dc2626', `Failed ${failures} times in a row`, `Last error: ${escapeHtml(errMessage)}`) +
        `<div style="font-size:13px;color:#4b5563;line-height:1.5;margin-top:8px;">Check the McGraw Hill password / section ID, or whether the server IP is being blocked.</div>` +
        `</td></tr>`;

    return {
        subject: '⚠️ MHE watcher is failing',
        html: mheEmailShell({
            headerTitle: 'Watcher needs attention ⚠️',
            headerSub: `${escapeHtml(stamp)} (IST)`,
            headerColor: '#dc2626',
            bodyRows: body
        }),
        text: `The McGraw Hill watcher failed ${failures} times in a row.\nLast error: ${errMessage}`
    };
}

// Returns 'busy' | 'skipped' | 'failed' | 'ok'
async function runMheWatcherOnce(opts = {}) {
    if (!MHE_WATCH_USERNAME || !MHE_WATCH_PASSWORD || !MHE_WATCH_SECTION_ID) {
        console.log('[MHE-Watch] MHE_WATCH_USERNAME / MHE_WATCH_PASSWORD / MHE_WATCH_SECTION_ID not set. Watcher idle.');
        return 'skipped';
    }

    // Share the same lock as the manual "Assignments" tab so two Chromium instances never run together (OOM safety)
    if (mheScrapeBusy) {
        console.log('[MHE-Watch] Another scrape is running, will retry shortly.');
        return 'busy';
    }

    const markSuccess = () => {
        mheWatchConsecutiveFailures = 0;
        mheWatchFailureAlertSent = false;
        mheWatchStatus.lastError = null;
    };

    mheScrapeBusy = true;
    try {
        console.log('[MHE-Watch] Run started - fetching assignments...');
        const list = await scrapeMheAssignments({
            username: MHE_WATCH_USERNAME,
            password: MHE_WATCH_PASSWORD,
            sectionId: String(MHE_WATCH_SECTION_ID).trim(),
            userEmail: `watcher:${MHE_WATCH_USERNAME}`
        }, 3);
        console.log(`[MHE-Watch] Scrape OK (${list.length} assignments).`);

        const now = Date.now();
        const newHash = mheHashList(list);
        const previous = await MheSnapshot.findOne({ key: MHE_WATCH_SNAPSHOT_KEY });

        // Safety net: an empty result after we tracked assignments is almost certainly a bad page load,
        // not "everything was deleted". Treat it as a failure (retried in 10 min) instead of spamming a change mail.
        const prevCount = previous && Array.isArray(previous.data) ? previous.data.length : 0;
        if (list.length === 0 && prevCount > 0) {
            throw new Error(`Scrape returned 0 assignments but ${prevCount} were being tracked - ignoring this run as a bad page load.`);
        }

        // ---- Who still needs the "you've been added to the watch list" email? ----
        const alreadyNotified = opts.resendWelcome
            ? new Set()
            : new Set(((previous && previous.notifiedRecipients) || []).map(r => String(r).toLowerCase()));
        const newRecipients = MHE_WATCH_WELCOME_ENABLED
            ? MHE_WATCH_RECIPIENTS.filter(r => !alreadyNotified.has(r.toLowerCase()))
            : [];
        const notifiedNow = Array.from(new Set([...alreadyNotified, ...newRecipients.map(r => r.toLowerCase())]));

        // Currently overdue + not submitted (used for the "due date passed" notifications)
        const currentPassed = mhePassedItems(list, now);
        const currentPassedKeys = currentPassed.map(p => p.passKey);

        // 1) Save the baseline IMMEDIATELY (never depends on email working)
        if (!previous) {
            await MheSnapshot.findOneAndUpdate(
                { key: MHE_WATCH_SNAPSHOT_KEY },
                {
                    key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, notifiedRecipients: [],
                    passedNotified: currentPassedKeys, passedInit: true, updatedAt: new Date()
                },
                { upsert: true, returnDocument: 'after' }
            );
            await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff: null, emailSent: false, kind: 'baseline' })
                .catch(e => console.error('[MHE-Watch] History save failed:', e.message));
            console.log(`[MHE-Watch] Baseline saved to MongoDB (${list.length} assignments).`);
        }

        // 2) Welcome mail (with the current status). If it fails we remember that and retry on the next run.
        let mailError = null;
        if (newRecipients.length) {
            try {
                const welcome = mheBuildWelcomeEmail(list, newRecipients);
                await sendMheMail(welcome.subject, welcome.html, welcome.text, newRecipients);
                await MheSnapshot.updateOne({ key: MHE_WATCH_SNAPSHOT_KEY }, { notifiedRecipients: notifiedNow });
                await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff: null, emailSent: true, kind: 'welcome' })
                    .catch(e => console.error('[MHE-Watch] History save failed:', e.message));
                console.log(`[MHE-Watch] Welcome email sent to ${newRecipients.join(', ')}`);
            } catch (err) {
                mailError = err;
                console.error(`[MHE-Watch] Welcome email FAILED: ${err.message}`);
            }
        }

        // First run -> baseline is already saved, done
        if (!previous) {
            if (mailError) throw mailError;
            markSuccess();
            return 'ok';
        }

        // ---- What is new since the last successful run? ----
        // Old snapshots (saved before this feature existed) silently seed the "already passed" list once, so you
        // are not flooded with mails for deadlines that passed days ago.
        const seeding = !previous.passedInit;
        const alreadyPassed = new Set(seeding ? currentPassedKeys : (previous.passedNotified || []));
        const nowPassed = currentPassed.filter(p => !alreadyPassed.has(p.passKey)).map(p => p.item);
        const dataChanged = previous.hash !== newHash;

        // Nothing to report
        if (!dataChanged && nowPassed.length === 0) {
            console.log(`[MHE-Watch] No change (${list.length} assignments).`);
            await MheSnapshot.updateOne(
                { key: MHE_WATCH_SNAPSHOT_KEY },
                { updatedAt: new Date(), passedNotified: currentPassedKeys, passedInit: true }
            );
            if (mailError) throw mailError;
            markSuccess();
            return 'ok';
        }

        // 3) Something changed -> build diff, send mail FIRST, only then save the new snapshot (so a failed mail is retried).
        //    Freshly welcomed recipients already received the up-to-date list, so they are skipped here.
        const diff = mheComputeDiff(previous.data, list);
        diff.nowPassed = nowPassed;
        const changeRecipients = MHE_WATCH_RECIPIENTS.filter(r => !newRecipients.includes(r));
        let changeMailSent = false;
        if (changeRecipients.length) {
            const mail = mheBuildChangeEmail(diff, list);
            if (mail.total > 0) {
                await sendMheMail(mail.subject, mail.html, mail.text, changeRecipients);
                changeMailSent = true;
                console.log(`[MHE-Watch] Change detected (${mail.subject}), email sent to ${changeRecipients.join(', ')}`);
            }
        }

        await MheSnapshot.findOneAndUpdate(
            { key: MHE_WATCH_SNAPSHOT_KEY },
            { hash: newHash, data: list, passedNotified: currentPassedKeys, passedInit: true, updatedAt: new Date() },
            { upsert: true, returnDocument: 'after' }
        );
        await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff, emailSent: changeMailSent, kind: 'change' })
            .catch(e => console.error('[MHE-Watch] History save failed:', e.message));

        if (mailError) throw mailError;
        markSuccess();
        return 'ok';
    } catch (error) {
        mheWatchConsecutiveFailures++;
        mheWatchStatus.lastError = error.message;
        console.error(`[MHE-Watch] Run failed (${mheWatchConsecutiveFailures} in a row): ${error.message}`, error.debug || '');

        // One-time alert if the watcher keeps failing (bad password, captcha, blocked IP...)
        if (mheWatchConsecutiveFailures >= MHE_WATCH_FAILURE_ALERT_AFTER && !mheWatchFailureAlertSent) {
            try {
                const failMail = mheBuildFailureEmail(mheWatchConsecutiveFailures, error.message);
                await sendMheMail(failMail.subject, failMail.html, failMail.text);
                mheWatchFailureAlertSent = true;
            } catch (mailErr) {
                console.error('[MHE-Watch] Could not send failure alert:', mailErr.message);
            }
        }
        return 'failed';
    } finally {
        mheScrapeBusy = false;
    }
}

// Wrapper that records status (used by the schedule AND the manual admin trigger)
async function executeMheWatcherRun(trigger = 'schedule', opts = {}) {
    const started = Date.now();
    mheWatchStatus.running = true;
    mheWatchStatus.lastTrigger = trigger;
    let outcome = 'failed';
    try {
        outcome = await runMheWatcherOnce(opts);
    } catch (e) {
        mheWatchStatus.lastError = e.message;
        console.error('[MHE-Watch] Unexpected error:', e.message);
    } finally {
        mheWatchStatus.running = false;
        mheWatchStatus.lastRunAt = new Date().toISOString();
        mheWatchStatus.lastOutcome = outcome;
        mheWatchStatus.lastDurationMs = Date.now() - started;
        mheWatchStatus.runs++;
        console.log(`[MHE-Watch] Run finished: ${outcome} in ${Math.round((Date.now() - started) / 1000)}s`);
    }
    return outcome;
}

// --- Self-rescheduling loop: never overlaps. Normal interval after a good run, sooner after a busy/failed run ---
const runMheWatcherDaemon = async () => {
    let nextDelay = MHE_WATCH_INTERVAL_MS;
    try {
        const outcome = await executeMheWatcherRun('schedule');
        if (outcome === 'busy') nextDelay = MHE_WATCH_BUSY_RETRY_MS;
        else if (outcome === 'failed') nextDelay = MHE_WATCH_RETRY_AFTER_FAIL_MS;
    } catch (e) {
        console.error('[MHE-Watch] Daemon error:', e.message);
    } finally {
        mheWatchStatus.nextRunAt = new Date(Date.now() + nextDelay).toISOString();
        console.log(`[MHE-Watch] Next run in ${Math.round(nextDelay / 60000)} min.`);
        setTimeout(runMheWatcherDaemon, nextDelay);
    }
};

function startMheWatcher() {
    if (!MHE_WATCH_ENABLED) {
        console.log('[MHE-Watch] Disabled via MHE_WATCH_ENABLED=false');
        return;
    }
    if (!MHE_WATCH_USERNAME || !MHE_WATCH_PASSWORD || !MHE_WATCH_SECTION_ID) {
        console.log('[MHE-Watch] Not started: set MHE_WATCH_USERNAME, MHE_WATCH_PASSWORD and MHE_WATCH_SECTION_ID env vars.');
        return;
    }
    console.log(`[MHE-Watch] Enabled. Mail provider: ${mheMailProviderName()}. First run in ${MHE_WATCH_INITIAL_DELAY_MS / 1000}s, then every ${MHE_WATCH_INTERVAL_MIN} min. Recipients: ${MHE_WATCH_RECIPIENTS.join(', ')}`);
    mheWatchStatus.nextRunAt = new Date(Date.now() + MHE_WATCH_INITIAL_DELAY_MS).toISOString();

    // Check the mail setup right now so a bad config shows up in the logs immediately
    verifyMailProvider();

    setTimeout(runMheWatcherDaemon, MHE_WATCH_INITIAL_DELAY_MS);
}

// ------------------------------------------------------------
// ADMIN ENDPOINTS FOR THE WATCHER (same ADMIN_PASSWORD as the admin dashboard)
//   POST /api/admin/mhe-watch/status      {password}                      -> what is the watcher doing?
//   POST /api/admin/mhe-watch/test-mail   {password}                      -> send a test email right now
//   POST /api/admin/mhe-watch/run         {password, resendWelcome?: true} -> run a check right now
// ------------------------------------------------------------
const mheAdminLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 60,
    message: { error: "Too many watcher admin requests, please try again later." }
});

const mheAdminAuthorized = (req, res) => {
    if (!req.body || req.body.password !== ADMIN_PASSWORD) {
        res.status(401).json({ error: "Unauthorized. Incorrect password." });
        return false;
    }
    return true;
};

app.post('/api/admin/mhe-watch/status', mheAdminLimiter, async (req, res) => {
    if (!mheAdminAuthorized(req, res)) return;
    try {
        const snap = await MheSnapshot.findOne({ key: MHE_WATCH_SNAPSHOT_KEY }).select('-__v');
        const now = Date.now();
        res.json({
            success: true,
            enabled: MHE_WATCH_ENABLED,
            mailProvider: mheMailProviderName(),
            recipients: MHE_WATCH_RECIPIENTS,
            sectionId: MHE_WATCH_SECTION_ID,
            intervalMinutes: MHE_WATCH_INTERVAL_MIN,
            consecutiveFailures: mheWatchConsecutiveFailures,
            scrapeBusy: mheScrapeBusy,
            status: mheWatchStatus,
            snapshot: snap ? {
                updatedAt: snap.updatedAt,
                assignments: Array.isArray(snap.data) ? snap.data.length : 0,
                notifiedRecipients: snap.notifiedRecipients,
                data: Array.isArray(snap.data) ? snap.data.map(i => mheEnrich(i, now)) : []
            } : null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/mhe-watch/test-mail', mheAdminLimiter, async (req, res) => {
    if (!mheAdminAuthorized(req, res)) return;
    const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    const html = mheEmailShell({
        headerTitle: 'Test email ✅',
        headerSub: `${escapeHtml(stamp)} (IST)`,
        headerColor: '#4f46e5',
        bodyRows: `<tr><td style="padding:22px 28px;font-size:14px;color:#374151;line-height:1.6;">If you can read this, email delivery from the watcher works (provider: <b>${escapeHtml(mheMailProviderName())}</b>).</td></tr>`
    });
    try {
        await sendMheMail('✅ MHE watcher test email', html, `Test email from the MHE watcher (${stamp} IST). Provider: ${mheMailProviderName()}`);
        res.json({ success: true, provider: mheMailProviderName(), sentTo: MHE_WATCH_RECIPIENTS });
    } catch (error) {
        console.error('[MHE-Watch] Test mail failed:', error.message);
        res.status(500).json({ success: false, provider: mheMailProviderName(), error: error.message });
    }
});

app.post('/api/admin/mhe-watch/run', mheAdminLimiter, async (req, res) => {
    if (!mheAdminAuthorized(req, res)) return;
    if (mheScrapeBusy) {
        return res.status(429).json({ error: 'A scrape is already running. Try again in a minute.' });
    }
    // Fire and forget: the scrape takes a minute or two. Watch the Render logs or call /status.
    executeMheWatcherRun('manual', { resendWelcome: req.body.resendWelcome === true });
    res.status(202).json({ success: true, message: 'Watcher run started. Check the Render logs or call /api/admin/mhe-watch/status.' });
});

// ============================================================
// OLT SCRAPING ENGINE 
// ============================================================

const BASE_URL = "https://olt.iimtrichy.ac.in";
const LOGIN_URL = `${BASE_URL}/Default.aspx`;
const ATTENDANCE_URL = `${BASE_URL}/SubjectAttendance`;

const TERMS = {
    "Term-I": [
        "Business Statistics", 
        "Financial Reporting and Analysis", 
        "Managerial Communication", 
        "Managerial Economics", 
        "Marketing Management -I", 
        "Micro Organizational Behaviour"
    ],
    "Term-II": [
        "Business Ethics", 
        "Corporate Finance", 
        "Information Systems for Managers", 
        "Macro Economics for Managers", 
        "Macro Organizational Behaviour", 
        "Marketing Management-II", 
        "Operations Research for Managers", 
        "The Entrepreneurial Manager" 
    ]
};

const SUBJECT_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSubjectName';
const SECTION_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSection';
const PROGRAM_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName';
const TERM_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo';

// ============================================================
// ATTENDANCE FETCH PROGRESS TRACKING 
// ============================================================
const attendanceProgress = new Map();

function setAttendanceProgress(userId, step, message, status = 'in_progress', total = 8) {
    if (!userId) return;
    const current = attendanceProgress.get(String(userId));
    const progressTotal = total || (current ? current.total : 8);
    attendanceProgress.set(String(userId), {
        step,
        total: progressTotal,
        message,
        status,
        timestamp: Date.now()
    });
}

function clearAttendanceProgressSoon(userId) {
    if (!userId) return;
    setTimeout(() => attendanceProgress.delete(String(userId)), 15000);
}

setInterval(() => {
    const now = Date.now();
    for (const [id, progress] of attendanceProgress.entries()) {
        if (now - progress.timestamp > 10 * 60 * 1000) attendanceProgress.delete(id);
    }
}, 60 * 1000);

app.get('/api/attendance/progress', authenticateUser, (req, res) => {
    const progress = attendanceProgress.get(String(req.user.id)) || {
        step: 0,
        total: 8,
        message: 'Waiting to start…',
        status: 'idle'
    };
    res.json(progress);
});

class OLTClient {
    constructor() {
        this.cookies = {};
        this.client = axios.create({ 
            validateStatus: () => true, 
            maxRedirects: 0,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                "Connection": "keep-alive"
            }
        });
    }
    
    updateCookies(headers) {
        if (headers['set-cookie']) {
            headers['set-cookie'].forEach(c => {
                const cookieStr = c.split(';')[0];
                const eqIndex = cookieStr.indexOf('=');
                if(eqIndex > -1) {
                    const key = cookieStr.substring(0, eqIndex);
                    const val = cookieStr.substring(eqIndex + 1);
                    this.cookies[key] = val;
                }
            });
        }
    }
    
    getCookieStr() {
        return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    }

    async get(url, headers = {}) {
        const res = await this.client.get(url, { headers: { ...headers, 'Cookie': this.getCookieStr() } });
        this.updateCookies(res.headers);
        return res;
    }

    async post(url, data, headers = {}) {
        const res = await this.client.post(url, new URLSearchParams(data).toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': this.getCookieStr(), ...headers }
        });
        this.updateCookies(res.headers);
        return res;
    }
}

function parseFullForm(html) {
    const $ = cheerio.load(html);
    const data = {};

    $('input').each((i, el) => {
        const name = $(el).attr('name');
        if (!name) return;

        const type = ($(el).attr('type') || 'text').toLowerCase();

        if (['submit', 'button', 'reset', 'image'].includes(type)) return;
        if (['checkbox', 'radio'].includes(type) && !$(el).is(':checked')) return;

        data[name] = $(el).attr('value') || '';
    });

    $('select').each((i, el) => {
        const name = $(el).attr('name');

        if (name) {
            data[name] =
                $(el).find('option[selected]').attr('value') ||$(el).find('option').first().attr('value') ||
                '';
        }
    });

    return data;
}

function updateState(state, responseText) {
    const pattern = /(?:^|\|)hiddenField\|([^|]*)\|([^|]*)/g;
    let match;
    while ((match = pattern.exec(responseText)) !== null) {
        state[match[1]] = match[2];
    }
}

async function dropdownPostback(client, state, field, value) {
    const data = { ...state };
    data[field] = value;
    data['ctl00$ToolkitScriptManager1'] = `ctl00$UpdatePanel1|${field}`;
    data['__EVENTTARGET'] = field;
    data['__EVENTARGUMENT'] = '';
    data['__LASTFOCUS'] = '';
    data['__ASYNCPOST'] = 'true';

    const headers = { 
        'Cache-Control': 'no-cache', 
        'X-MicrosoftAjax': 'Delta=true', 
        'X-Requested-With': 'XMLHttpRequest', 
        'Referer': ATTENDANCE_URL 
    };
    const res = await client.post(ATTENDANCE_URL, data, headers);
    updateState(state, res.data);
    state[field] = value;
    return res.data;
}

function extractTableHtml(responseText) {
    const TABLE_ID = "ctl00_Main_AttendanceReport_GridViewAttendanceMerged";
    const marker = `id="${TABLE_ID}"`;
    const position = responseText.indexOf(marker);
    if (position < 0) return null;

    const start = responseText.lastIndexOf("<table", position);
    let end = responseText.indexOf("</table>", position);
    if (start < 0 || end < 0) return null;
    end += "</table>".length;

    return responseText.substring(start, end);
}

// ------------------------------------------------------------
// SUBJECT DROPDOWN HELPERS
// The text shown in the OLT dropdown is not always identical to the
// option "value" the server expects. We read the real options from the
// page and match our subject names against them (case / spacing /
// punctuation / singular-plural tolerant), so subjects like
// "Information Systems for Managers" are posted with the right value.
// ------------------------------------------------------------
function getSubjectOptions(html) {
    if (!html || typeof html !== 'string') return [];
    try {
        const $ = cheerio.load(html);
        const options = [];
        $('select').each((i, el) => {
            const ident = $(el).attr('name') || $(el).attr('id') || '';
            if (!/DropDownListSubjectName$/.test(ident)) return;
            $(el).find('option').each((j, opt) => {
                const value = $(opt).attr('value');
                const text = $(opt).text().replace(/\s+/g, ' ').trim();
                if (value !== undefined && value !== '') options.push({ value, text });
            });
        });
        return options;
    } catch (e) {
        return [];
    }
}

const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const looseName = (s) => normalizeName(s).replace(/s/g, ''); // tolerate system/systems etc.

function resolveSubjectValue(subject, options) {
    if (!options || options.length === 0) return subject;

    const n = normalizeName(subject);
    const l = looseName(subject);

    let hit = options.find(o => normalizeName(o.text) === n || normalizeName(o.value) === n);
    if (!hit) hit = options.find(o => looseName(o.text) === l || looseName(o.value) === l);
    if (!hit) {
        hit = options.find(o => {
            const ot = looseName(o.text);
            return ot.includes(l) || l.includes(ot);
        });
    }
    return hit ? hit.value : subject;
}

// OLT option values can carry a trailing space (e.g. "Information Systems for Managers ").
// Try the resolved value first, then trimmed / trailing-space variants.
function subjectValueCandidates(resolved) {
    const base = String(resolved);
    const list = [base, base.trim(), base.trim() + ' '];
    return list.filter((v, i) => list.indexOf(v) === i);
}

// Placeholder for a subject whose classes have not begun yet
const NOT_STARTED_RESULT = () => ({
    classes: [],
    attended: 0,
    total: 0,
    percentage: null,
    notStarted: true
});

function extractAttendance(html, rollNo) {
    let tableHtml = extractTableHtml(html);
    let $;
    let table;
 
    if (tableHtml) {
        $ = cheerio.load(tableHtml);
        table = $('table').first();
    } else {
        $ = cheerio.load(html);
        table = $('#ctl00_Main_AttendanceReport_GridViewAttendanceMerged');
    }
 
    if (!table || !table.length) return null;
 
    const rows = table.find('tr');
    if (rows.length < 2) return null;
 
    const headerCells = $(rows[0]).find('th');
    const classes = [];
    
    for (let i = 2; i < headerCells.length - 2; i++) {
        const htmlContent = $(headerCells[i]).html() || '';
        const $cell = cheerio.load(htmlContent);$cell('br').replaceWith('\n');
        
        const parts = $cell.text().split('\n').map(s => s.trim()).filter(Boolean);
        
        if (parts.length >= 3) {
            classes.push({ class: parts[0], date: parts[1], time: parts[2] });
        } else {
            const fullText = $cell.text().replace(/\s+/g, ' ').trim();
            const match = fullText.match(/(\d+)\s+(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
            if (match) {
                classes.push({ class: match[1], date: match[2], time: match[3] });
            } else {
                classes.push({ class: fullText, date: '', time: '' });
            }
        }
    }
 
    // Table exists but has no class columns yet => classes haven't started.
    if (classes.length === 0) return NOT_STARTED_RESULT();
 
    let userRow = null;
    for (let i = 1; i < rows.length; i++) {
        const cells = $(rows[i]).find('td');
        const currentRoll = $(cells[0]).text().replace(/\s+/g, ' ').trim();
        if (currentRoll === rollNo.trim()) { 
            userRow = cells; 
            break; 
        }
    }
    if (!userRow) return null;
 
    // Row must have roll + name + one cell per class + attended + total
    if (userRow.length < classes.length + 4) return NOT_STARTED_RESULT();
 
    const attendanceValues = [];
    for (let i = 2; i < userRow.length - 2; i++) {
        const classInfo = classes[i - 2];
        if (!classInfo) break;
        const status = $(userRow[i]).text().replace(/\s+/g, ' ').trim();
        attendanceValues.push({ ...classInfo, status });
    }
 
    const attended = parseInt($(userRow[userRow.length - 2]).text().trim(), 10) || 0;
    const total = parseInt($(userRow[userRow.length - 1]).text().trim(), 10) || 0;
    const percentage = total ? ((attended / total) * 100).toFixed(2) : null;
 
    return { classes: attendanceValues, attended, total, percentage };
}


app.post('/api/attendance/fetch', authenticateUser, async (req, res) => {
    const userId = req.user.id;
    try {
        const user = await User.findById(userId);
        if (!user || !user.oltUsername || !user.oltPassword) {
            return res.status(400).json({ error: 'No credentials saved' });
        }
        
        const username = user.oltUsername;
        const section = user.defaultSection || 'A';
        const term = req.body.term || user.defaultTerm || 'Term-II';
        const subjects = TERMS[term] || TERMS["Term-II"];
        const totalSteps = subjects.length + 2;

        let password;
        try {
            const decrypted = decryptTextDetailed(user.oltPassword);
            password = decrypted.plaintext;
            if (decrypted.migrated) {
                User.findByIdAndUpdate(userId, { oltPassword: encryptText(password) }).catch(() => {});
            }
        } catch (err) {
            setAttendanceProgress(userId, 0, 'Saved credentials could not be read.', 'error', totalSteps);
            clearAttendanceProgressSoon(userId);
            return res.status(400).json({
                error: 'Your saved OLT credentials could not be read. Please re-enter and save them again.',
                needsCredsReset: true
            });
        }

        setAttendanceProgress(userId, 0, 'Connecting to OLT portal…', 'in_progress', totalSteps);

        const client = new OLTClient();
        const initial = await client.get(LOGIN_URL);
        const state = parseFullForm(initial.data);

        state['ctl00$Login1$LoginView1$UserName'] = username;
        state['ctl00$Login1$LoginView1$Password'] = password;
        state['ctl00$Login1$TextBoxIP'] = "";
        state['ctl00$Login1$TextBoxOTP'] = "";
        state['ctl00$ToolkitScriptManager1'] = `ctl00$UpdatePanel1|ctl00$Login1$LoginView1$ButtonLogin`;
        state['__EVENTTARGET'] = 'ctl00$Login1$LoginView1$ButtonLogin';
        state['__EVENTARGUMENT'] = '';
        state['__LASTFOCUS'] = '';
        state['__ASYNCPOST'] = 'true';

        setAttendanceProgress(userId, 1, 'Verifying your credentials…', 'in_progress', totalSteps);
        const loginRes = await client.post(LOGIN_URL, state, { 'X-MicrosoftAjax': 'Delta=true', 'Referer': LOGIN_URL });
        const text = loginRes.data;

        if (!text.includes('pageRedirect||')) {
            setAttendanceProgress(userId, 0, 'Invalid OLT credentials.', 'error', totalSteps);
            clearAttendanceProgressSoon(userId);
            return res.status(400).json({ error: 'Invalid OLT Credentials' });
        }

        return await completeScrape(client, section, username, res, userId, term, subjects, totalSteps);
    } catch (error) {
        console.error(error);
        setAttendanceProgress(userId, 0, 'Error connecting to OLT portal.', 'error', 8);
        clearAttendanceProgressSoon(userId);
        res.status(500).json({ error: 'Error connecting to OLT portal' });
    }
});


async function completeScrape(client, section, username, res, userId, term, subjects, totalSteps) {
    try {
        setAttendanceProgress(userId, 2, 'Loading your attendance report…', 'in_progress', totalSteps);
        const attendanceRes = await client.get(ATTENDANCE_URL, { 'Referer': LOGIN_URL });
        const state = parseFullForm(attendanceRes.data);

        // Keep the most recent HTML that still contains the subject dropdown
        let subjectOptions = getSubjectOptions(attendanceRes.data);
        
        const PROGRAM = "PGPM 2026-28", TERM_VAL = term;
        if (state[PROGRAM_DROPDOWN] !== PROGRAM) {
            const html = await dropdownPostback(client, state, PROGRAM_DROPDOWN, PROGRAM);
            const opts = getSubjectOptions(html);
            if (opts.length) subjectOptions = opts;
        }
            
        if (state[TERM_DROPDOWN] !== TERM_VAL) {
            const html = await dropdownPostback(client, state, TERM_DROPDOWN, TERM_VAL);
            const opts = getSubjectOptions(html);
            if (opts.length) subjectOptions = opts;
        }

        console.log(`[Attendance] ${term} subject options:`, subjectOptions.map(o => `${o.text} => ${o.value}`));
 
        const results = {};
        for (let i = 0; i < subjects.length; i++) {
            const subject = subjects[i];
            setAttendanceProgress(userId, 2 + i, `Fetching ${subject} (${i + 1}/${subjects.length})…`, 'in_progress', totalSteps);

            // Use the value the dropdown actually expects for this subject
            const subjectValue = resolveSubjectValue(subject, subjectOptions);
            if (subjectValue !== subject) {
                console.log(`[Attendance] "${subject}" resolved to dropdown value "${subjectValue}"`);
            }
 
            const candidates = subjectValueCandidates(subjectValue);

            let attendanceData = null;
            for (let attempt = 1; attempt <= candidates.length && !attendanceData; attempt++) {
                try {
                    await dropdownPostback(client, state, SUBJECT_DROPDOWN, candidates[attempt - 1]);
                    const sectionResHtml = await dropdownPostback(client, state, SECTION_DROPDOWN, section);
                    attendanceData = extractAttendance(sectionResHtml, username);

                    if (!attendanceData) {
                        console.warn(`[Attendance] No data for "${subject}" (attempt ${attempt}, value=${JSON.stringify(candidates[attempt - 1])}). Response snippet: ${String(sectionResHtml).replace(/\s+/g, ' ').substring(0, 200)}`);
                    }
                } catch (subjectErr) {
                    console.error(`Subject fetch failed (${subject}, attempt ${attempt}):`, subjectErr.message);
                }
            }
 
            // Always include the subject; if nothing came back, mark as not started
            results[subject] = attendanceData || NOT_STARTED_RESULT();
        }
 
        const hasAnyRecord = Object.values(results).some(sub => sub.total > 0);
        setAttendanceProgress(
            userId,
            totalSteps,
            hasAnyRecord ? 'Done!' : 'Finished, but no matching records were found.',
            'done',
            totalSteps
        );
        clearAttendanceProgressSoon(userId);
 
        res.json({ success: true, results, section, term });
    } catch (error) {
        console.error("Scrape Error:", error);
        setAttendanceProgress(userId, 0, 'Something went wrong while fetching attendance.', 'error', totalSteps);
        clearAttendanceProgressSoon(userId);
        res.status(500).json({ error: 'Failed to extract attendance data' });
    }
}


// ============================================================
// 4. EXCEL PARSING HELPER FUNCTIONS
// ============================================================

const getCellText = (cell) => {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    if (typeof cell.value === 'object') {
        if (cell.type === ExcelJS.ValueType.Date || cell.value instanceof Date) return cell.value.toISOString();
        if (cell.value.richText) return cell.value.richText.map(rt => rt.text).join('');
        if ('formula' in cell.value || 'sharedFormula' in cell.value) {
            let res = cell.value.result;
            if (res !== undefined && res !== null) {
                if (typeof res === 'object') {
                    if (res.error) return res.error.toString();
                    if (res instanceof Date) return res.toISOString();
                    return JSON.stringify(res);
                }
                return res.toString();
            }
            return '';
        }
        if (cell.value.text) return cell.value.text.toString();
        if (cell.value.error) return cell.value.error.toString();
        try { return JSON.stringify(cell.value); } catch (e) { return ''; }
    }
    return cell.value.toString().trim();
};

const getCellColor = (cell) => {
    if (!cell || !cell.fill) return null;
    if (cell.fill.type === 'pattern' && cell.fill.fgColor) {
        const argb = cell.fill.fgColor.argb;
        if (argb && argb !== 'FFFFFFFF' && argb !== '00000000') {
            if (argb.length === 8) return '#' + argb.substring(2);
            if (argb.length === 6) return '#' + argb;
        }
    }
    return null;
};

const colLetterToNumber = (letters) => {
    let col = 0;
    for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
    return col;
};

const parseMergeRange = (rangeStr) => {
    const [start, end] = rangeStr.split(':');
    const m1 = start.match(/^([A-Z]+)(\d+)$/);
    const m2 = (end || start).match(/^([A-Z]+)(\d+)$/);
    if (!m1 || !m2) return null;
    return {
        startCol: colLetterToNumber(m1[1]),
        startRow: parseInt(m1[2], 10),
        endCol: colLetterToNumber(m2[1]),
        endRow: parseInt(m2[2], 10),
    };
};

// ============================================================
// 5. CORE EXTRACTION LOGIC (TIMETABLE)
// ============================================================

const extractSectionData = (workbook, section) => {
    let targetCol = null;
    let sectionEndCol = null;
    let targetSheet = null;
    let headerRowIdx = -1;

    const secRegex = new RegExp(`SECTION\\s*[-|]?\\s*${section.toUpperCase()}\\b`);

    for (const sheet of workbook.worksheets) {
        const merges = (sheet.model && sheet.model.merges) || [];
        for (const rangeStr of merges) {
            const range = parseMergeRange(rangeStr);
            if (!range || range.startRow !== 1) continue;
            const titleCell = sheet.getCell(range.startRow, range.startCol);
            const text = getCellText(titleCell).toUpperCase().replace(/\s+/g, ' ');

            if (secRegex.test(text)) {
                targetSheet = sheet;
                targetCol = range.startCol;
                sectionEndCol = range.endCol;
                break;
            }
        }
        if (targetCol) break;
    }

    if (!targetCol) {
        for (const sheet of workbook.worksheets) {
            let sheetHeaderRowIdx = -1;
            let dayDateCols = [];

            sheet.eachRow((row, rowNumber) => {
                if (sheetHeaderRowIdx !== -1 && rowNumber > sheetHeaderRowIdx) return;
                row.eachCell((cell, colNumber) => {
                    const text = getCellText(cell).toUpperCase().replace(/\s+/g, ' ');
                    if (text.includes('DAY AND DATE') || text.includes('DAY & DATE')) {
                        sheetHeaderRowIdx = rowNumber;
                        dayDateCols.push(colNumber);
                    }
                });
            });

            if (sheetHeaderRowIdx !== -1 && dayDateCols.length > 0) {
                dayDateCols.sort((a, b) => a - b);
                const secIdx = section.toUpperCase().charCodeAt(0) - 65;
                if (secIdx >= 0 && secIdx < dayDateCols.length) {
                    targetCol = dayDateCols[secIdx];
                    sectionEndCol = secIdx + 1 < dayDateCols.length ? dayDateCols[secIdx + 1] - 1 : targetCol + 9;
                    targetSheet = sheet;
                    headerRowIdx = sheetHeaderRowIdx;
                    break;
                }
            }
        }
    }

    if (!targetCol || !targetSheet) return null;
    const sheet = targetSheet;

    if (headerRowIdx === -1) {
        headerRowIdx = 2;
        for (let r = 1; r <= 6; r++) {
            const row = sheet.getRow(r);
            let found = false;
            for (let c = targetCol; c <= sectionEndCol; c++) {
                const text = getCellText(row.getCell(c)).toUpperCase().replace(/\s+/g, ' ');
                if (text.includes('DAY AND DATE') || text.includes('DAY & DATE')) {
                    found = true;
                    break;
                }
            }
            if (found) { headerRowIdx = r; break; }
        }
    }

    let timeHeaderRowIdx = headerRowIdx;
    const countTimes = (r) => {
        if (!r) return 0;
        let count = 0;
        for (let c = targetCol + 1; c <= sectionEndCol; c++) {
            const txt = getCellText(r.getCell(c)).toLowerCase();
            if (txt.includes('am') || txt.includes('pm') || /\d{1,2}:\d{2}/.test(txt)) count++;
        }
        return count;
    };

    const r1 = sheet.getRow(headerRowIdx);
    const r2 = sheet.getRow(headerRowIdx + 1);
    const r3 = sheet.getRow(headerRowIdx + 2);

    if (countTimes(r1) < 2) {
        if (countTimes(r2) >= 2) timeHeaderRowIdx = headerRowIdx + 1;
        else if (countTimes(r3) >= 2) timeHeaderRowIdx = headerRowIdx + 2;
    }

    const colsSpan = sectionEndCol - targetCol + 1;
    const timeHeaders = [];
    for (let c = 0; c < colsSpan; c++) {
        let th = getCellText(sheet.getCell(timeHeaderRowIdx, targetCol + c));
        if (!th) th = getCellText(sheet.getCell(headerRowIdx, targetCol + c));
        timeHeaders.push(th);
    }

    const timetable = [];
    let summaryStartIndex = -1;

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber <= Math.max(headerRowIdx, timeHeaderRowIdx)) return;

        if (summaryStartIndex === -1) {
            const c1 = getCellText(row.getCell(1)).toLowerCase();
            const c2 = getCellText(row.getCell(2)).toLowerCase();
            const t1 = getCellText(row.getCell(targetCol)).toLowerCase();

            if (c1.includes('course') || c2.includes('actual teaching') || c1.includes('actual teaching') ||
                t1.includes('course') || t1.includes('actual teaching')) {
                summaryStartIndex = rowNumber;
            }
        }

        if (summaryStartIndex === -1) {
            const dateStr = getCellText(row.getCell(targetCol)).trim();
            if (!dateStr) return;

            let isoDate = null;
            let dayStrParsed = '';

            const dayMatch = dateStr.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
            const yearMatch = dateStr.match(/(202\d)/);
            const dayExtract = dateStr.match(/\b(\d{1,2})\b/);
            const monthExtract = dateStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);

            if (yearMatch && dayExtract && monthExtract) {
                const dd = dayExtract[1].padStart(2, '0');
                const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
                const mm = monthMap[monthExtract[1].toLowerCase()];
                const yyyy = yearMatch[1];
                isoDate = `${yyyy}-${mm}-${dd}`;
                if (dayMatch) dayStrParsed = dayMatch[1];
            } else {
                const fallbackDate = new Date(dateStr);
                if (!isNaN(fallbackDate.getTime())) {
                    isoDate = fallbackDate.toISOString().split('T')[0];
                    dayStrParsed = fallbackDate.toLocaleDateString('en-US', { weekday: 'short' });
                }
            }

            if (isoDate) {
                const dayStr = getCellText(row.getCell(targetCol + 1));
                const dayEntry = { date: dateStr, day: dayStr || dayStrParsed || 'Day', isoDate, classes: [] };

                for (let c = 2; c < colsSpan; c++) {
                    const cell = row.getCell(targetCol + c);
                    const subjectStr = getCellText(cell);
                    let slotTime = timeHeaders[c] ? timeHeaders[c].replace(/(\r\n|\n|\r)/gm, " ").trim() : 'Event';

                    if (slotTime.toLowerCase() === 'remarks') slotTime = 'Remarks / Event';

                    if (subjectStr !== '') {
                        let subject = subjectStr;
                        let prof = '';
                        const bracketMatch = subjectStr.match(/(.*)\[(.*)\]/);
                        if (bracketMatch) {
                            subject = bracketMatch[1].trim();
                            prof = bracketMatch[2].trim();
                        }

                        const bgColor = getCellColor(cell);
                        let status = null;
                        if (bgColor) {
                            const lowerColor = bgColor.toLowerCase();
                            if (lowerColor.includes('eb3223') || lowerColor.includes('ff0000')) status = 'Cancelled';
                            else if (lowerColor.includes('00b0f0') || lowerColor.includes('00a2e8')) status = 'Make-up Session';
                            else status = 'Special Event';
                        }
                        dayEntry.classes.push({ time: slotTime, subject, prof, raw: subjectStr, color: bgColor, status });
                    }
                }
                if (dayEntry.classes.length > 0) timetable.push(dayEntry);
            }
        }
    });

    timetable.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const subjectSessionCounter = {};
    timetable.forEach(dayEntry => {
        dayEntry.classes.forEach(cls => {
            const isRemark = cls.time && cls.time.toLowerCase().includes('remarks');
            if (isRemark || !cls.subject) return;
            if (cls.status === 'Cancelled') return;

            const key = cls.subject.trim().toLowerCase();
            subjectSessionCounter[key] = (subjectSessionCounter[key] || 0) + 1;
            cls.sessionNumber = subjectSessionCounter[key];
        });
    });

    const summaryData = { headers: [], rows: [] };
    if (summaryStartIndex !== -1) {
        let actualTeachingCol = -1;
        let minDistance = 9999;

        sheet.getRow(summaryStartIndex).eachCell((cell, colNum) => {
            const cellText = getCellText(cell).toLowerCase();
            if (cellText.includes('actual teaching')) {
                const dist = Math.abs(colNum - targetCol);
                if (dist < minDistance) { minDistance = dist; actualTeachingCol = colNum; }
            }
        });

        if (actualTeachingCol !== -1) {
            summaryData.headers = ['Course', 'Actual Teaching', 'Pre-Mid', 'Post-Mid', 'Guest Speaker', 'Total'];
            sheet.eachRow((row, rowNumber) => {
                if (rowNumber > summaryStartIndex) {
                    const course = getCellText(row.getCell(actualTeachingCol - 1));
                    const actualTeaching = getCellText(row.getCell(actualTeachingCol));
                    const preMid = getCellText(row.getCell(actualTeachingCol + 1));
                    const postMid = getCellText(row.getCell(actualTeachingCol + 2));
                    const guestSpeaker = getCellText(row.getCell(actualTeachingCol + 3));
                    const total = getCellText(row.getCell(actualTeachingCol + 4));

                    if (course && course.trim() !== '' && !course.toLowerCase().includes('class cancelled') && !course.toLowerCase().includes('make up session') && !course.toLowerCase().includes('course')) {
                        summaryData.rows.push([course, actualTeaching, preMid, postMid, guestSpeaker, total]);
                    }
                }
            });
        }
    }

    return { timetable, summary: summaryData };
};

// ============================================================
// 6. SAFE RECURSIVE BACKGROUND POLLING (Fixes OOM & Latency)
// ============================================================

let globalCache = {};
let lastFetchTime = 0;
let isFetching = false;
let activeFetchPromise = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

const updateCache = async () => {
    if (isFetching) return activeFetchPromise;
    isFetching = true;

    activeFetchPromise = (async () => {
        let response = null;
        let buffer = null;
        let workbook = null;

        try {
            console.log("[Cache] Downloading Excel sheet...");
            
            const bridgeUrl = "https://script.google.com/macros/s/AKfycbzqdMacopeFnXZmc9MgnN2cdTyZjIqCbMyDUQvx6VAMounnDswc88hmu5vOmhLZSmTfgw/exec";
            response = await axios.get(bridgeUrl, { responseType: 'text' });
            
            buffer = Buffer.from(response.data, 'base64');
            
            // Explicit Memory Clean: Dump large base64 string from RAM immediately
            response.data = null;
            response = null;

            workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);
            
            // Explicit Memory Clean: Dump buffer from RAM immediately after parsing
            buffer = null;

            const newCache = {};
            for (const sec of ALL_SECTIONS) {
                const data = extractSectionData(workbook, sec);
                if (data) newCache[sec] = data;
            }

            // Explicit Memory Clean: Dump the massive workbook tree from RAM immediately
            workbook = null;

            globalCache = newCache;
            lastFetchTime = Date.now();
            console.log("[Cache] Update successful. Memory cleared.");
            return globalCache;
        } catch (error) {
            console.error("[Cache Error] Failed to update:", error.message);
            throw error;
        } finally {
            // Failsafe: Ensure heavy objects are forcefully dereferenced even if extraction crashes
            response = null;
            buffer = null;
            workbook = null;
            
            isFetching = false;
            activeFetchPromise = null; 
        }
    })();

    return activeFetchPromise;
};

// --- SAFE DAEMON: Never overlaps, completely safe from OOM ---
const runBackgroundDaemon = async () => {
    try {
        await updateCache();
    } catch (e) {
        console.error("Daemon error:", e.message);
    } finally {
        // Wait strictly configured time AFTER the previous run finishes and memory is cleared
        setTimeout(runBackgroundDaemon, CACHE_TTL_MS);
    }
};

// --- REFACTORED ENDPOINT: ETag Caching for Massive Bandwidth Savings ---
app.get('/api/timetable/:section', authenticateUser, async (req, res) => {
    const section = req.params.section.toUpperCase();
    const forceRefresh = req.query.force === 'true';

    const buildMeta = () => ({
        lastFetchTime,
        nextRefreshTime: lastFetchTime + CACHE_TTL_MS,
        cacheTTLMs: CACHE_TTL_MS
    });

    try {
        // 1. If user forces a refresh via the Sync button
        if (forceRefresh) {
            await updateCache();
            return res.json({ ...globalCache[section], meta: buildMeta() });
        }

        // 2. Return instantly from RAM, leveraging HTTP ETags to save Bandwidth
        if (globalCache[section]) {
            // Use lastFetchTime as a strict version identifier
            const eTag = `W/"${lastFetchTime}"`;
            res.setHeader('ETag', eTag);
            
            // Let the browser confidently hold this data for 1 minute before even bothering the server again
            res.setHeader('Cache-Control', 'public, max-age=60'); 

            if (req.headers['if-none-match'] === eTag) {
                // Return 304 (Not Modified). This saves transferring the 100kb+ JSON payload entirely.
                return res.status(304).end();
            }

            return res.json({ ...globalCache[section], meta: buildMeta() });
        }

        // 3. First boot only: If server just woke up and RAM is completely empty, user waits.
        console.log(`[Cache] Empty memory. User must wait for initial download.`);
        await updateCache();
        
        if (globalCache[section]) {
            const eTag = `W/"${lastFetchTime}"`;
            res.setHeader('ETag', eTag);
            return res.json({ ...globalCache[section], meta: buildMeta() });
        } else {
            return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
        }

    } catch (error) {
        // Last-resort fallback to serve stale data if background update crashes during a boot
        if (globalCache[section]) {
            return res.json({ ...globalCache[section], meta: buildMeta() });
        }
        res.status(500).json({ error: 'Failed to fetch timetable data' });
    }
});

// ============================================================
// 8. SELF-PING
// ============================================================

const PORT = process.env.PORT || 5000;
// Set this to your external production URL
const PING_URL = process.env.PING_URL || `https://iimt-7iy6.onrender.com`;
let pingCount = 0;

const pingServer = async () => {
    try {
        let resp = await axios.get(PING_URL);
        pingCount++;
        console.log(`[Self-Ping] Count: ${pingCount} | Status: ${resp.data}`);
    } catch (error) {
        console.error(`[Self-Ping Error]:`, error.message);
    }
};

const PING_INTERVAL_MS = 240000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Starts the safe background parsing loop
    runBackgroundDaemon();

    // Starts the McGraw Hill assignment watcher (emails on change / due date passed)
    startMheWatcher();
    
    // Keeps the instance alive
    setInterval(pingServer, PING_INTERVAL_MS);
});

// require("dotenv").config();
// const express = require('express');
// const cors = require('cors');
// const axios = require('axios');
// const ExcelJS = require('exceljs');
// const mongoose = require('mongoose');
// const { OAuth2Client } = require('google-auth-library');
// const jwt = require('jsonwebtoken');
// const crypto = require('crypto');
// const cheerio = require('cheerio');
// const { google } = require('googleapis'); 
// const { chromium } = require('playwright'); // --- NEW: Added Playwright ---
// const nodemailer = require('nodemailer'); // --- NEW: Used by the MHE background watcher to send emails ---

// // Security middlewares
// const helmet = require('helmet');
// const rateLimit = require('express-rate-limit');
// const mongoSanitize = require('express-mongo-sanitize');
// const xss = require('xss-clean');

// const app = express();

// // --- SECURITY MIDDLEWARE ---

// app.set('trust proxy', 1);

// app.use(helmet());
// app.use(cors({
//     origin: process.env.FRONTEND_URL || '*',
//     methods: ['GET', 'POST'],
//     credentials: true
// }));
// app.use(express.json({ limit: '15kb' }));
// app.use(express.urlencoded({ extended: true, limit: '15kb' }));

// app.use((req, res, next) => {
//     Object.defineProperty(req, 'query', {
//         configurable: true,
//         enumerable: true,
//         writable: true,
//         value: req.query
//     });
//     next();
// });

// app.use(mongoSanitize());
// app.use(xss());

// const globalLimiter = rateLimit({
//     windowMs: 15 * 60 * 1000,
//     max: 150,
//     message: { error: "Too many requests from this IP, please try again after 15 minutes." },
//     standardHeaders: true,
//     legacyHeaders: false,
// });
// app.use('/api', globalLimiter);

// const strictLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000,
//     max: 15,
//     message: { error: "Too many authorization attempts from this IP, please try again after an hour." }
// });

// // --- 1. MONGODB CONNECTION & SCHEMAS ---
// const MONGO_URI = process.env.MONGO_URI;


// console.log("Trying to connect with the DB...");
// mongoose.connect(MONGO_URI)
//     .then(() => console.log('Connected to MongoDB'))
//     .catch((err) => console.error('MongoDB connection error:', err));

// const ALL_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// const userSchema = new mongoose.Schema({
//     name: String,
//     email: { type: String, unique: true, required: true },
//     picture: String,
//     defaultSection: { type: String, enum: ALL_SECTIONS, default: 'A' },
//     defaultTerm: { type: String, enum: ['Term-I', 'Term-II'], default: 'Term-II' }, 
//     lastActive: { type: Date, default: Date.now },
//     createdAt: { type: Date, default: Date.now },
//     oltUsername: { type: String, default: '' },
//     oltPassword: { type: String, default: '' } 
// });
// const User = mongoose.model('User', userSchema);

// const feedbackSchema = new mongoose.Schema({
//     userEmail: String,
//     userName: String,
//     message: { type: String, maxlength: 1000 },
//     createdAt: { type: Date, default: Date.now }
// });
// const Feedback = mongoose.model('Feedback', feedbackSchema);

// const todoSchema = new mongoose.Schema({
//     userEmail: { type: String, required: true, index: true },
//     date: { type: String, required: true },
//     section: { type: String, required: true },
//     subject: { type: String, required: true },
//     tasks: [{
//         id: String,
//         text: String,
//         isCompleted: Boolean
//     }]
// });
// todoSchema.index({ userEmail: 1, date: 1, section: 1, subject: 1 }, { unique: true });
// const Todo = mongoose.model('Todo', todoSchema);

// // --- NEW: ANALYTICS & TRAFFIC SCHEMAS ---
// const trafficLogSchema = new mongoose.Schema({
//     endpoint: String,
//     method: String,
//     timestamp: { type: Date, default: Date.now, expires: '30d' } 
// });
// const TrafficLog = mongoose.model('TrafficLog', trafficLogSchema);

// const analyticsEventSchema = new mongoose.Schema({
//     userEmail: String,
//     eventType: String, 
//     eventName: String, 
//     metadata: mongoose.Schema.Types.Mixed,
//     timestamp: { type: Date, default: Date.now, expires: '90d' } 
// });
// const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// // --- NEW: MHE WATCHER SNAPSHOT SCHEMA (remembers last known assignment state across restarts) ---
// const mheSnapshotSchema = new mongoose.Schema({
//     key: { type: String, required: true, unique: true },
//     hash: { type: String, default: '' },
//     data: { type: mongoose.Schema.Types.Mixed, default: [] },
//     notifiedRecipients: { type: [String], default: [] },   // who already got the "added to watch list" email
//     updatedAt: { type: Date, default: Date.now }
// });
// const MheSnapshot = mongoose.model('MheSnapshot', mheSnapshotSchema);

// // --- NEW: MHE WATCHER HISTORY (every detected state change is kept for 180 days) ---
// const mheHistorySchema = new mongoose.Schema({
//     key: { type: String, required: true, index: true },
//     hash: String,
//     data: { type: mongoose.Schema.Types.Mixed, default: [] },
//     diff: { type: mongoose.Schema.Types.Mixed, default: null },
//     emailSent: { type: Boolean, default: false },
//     kind: { type: String, default: 'change' },   // 'baseline' | 'welcome' | 'change'
//     createdAt: { type: Date, default: Date.now, expires: '180d' }
// });
// const MheStateHistory = mongoose.model('MheStateHistory', mheHistorySchema);

// // --- ENCRYPTION LOGIC FOR CREDENTIALS ---
// const ALGORITHM = 'aes-256-cbc';

// const CANDIDATE_SECRETS = [
//     process.env.JWT_SECRET || 'iimtrichy_fallback_secret',
//     'iimtrichy_fallback_secret',
// ].filter((v, i, arr) => v && arr.indexOf(v) === i); 

// const CANDIDATE_KEYS = CANDIDATE_SECRETS.map(secret => crypto.scryptSync(secret, 'salt', 32));
// const ENCRYPTION_KEY = CANDIDATE_KEYS[0]; 

// function encryptText(text) {
//     if (!text) return '';
//     const iv = crypto.randomBytes(16);
//     const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
//     let encrypted = cipher.update(text, 'utf8', 'hex');
//     encrypted += cipher.final('hex');
//     return `${iv.toString('hex')}:${encrypted}`;
// }

// function decryptWithKey(text, key) {
//     const parts = text.split(':');
//     if (parts.length !== 2) throw new Error('Malformed ciphertext');
//     const iv = Buffer.from(parts[0], 'hex');
//     const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
//     let decrypted = decipher.update(parts[1], 'hex', 'utf8');
//     decrypted += decipher.final('utf8');
//     return decrypted;
// }

// function decryptTextDetailed(text) {
//     if (!text) return { plaintext: '', migrated: false };
//     let lastErr = null;
//     for (let i = 0; i < CANDIDATE_KEYS.length; i++) {
//         try {
//             const plaintext = decryptWithKey(text, CANDIDATE_KEYS[i]);
//             return { plaintext, migrated: i > 0 };
//         } catch (err) {
//             lastErr = err;
//         }
//     }
//     throw lastErr || new Error('Unable to decrypt with any known key');
// }

// function decryptText(text) {
//     try {
//         return decryptTextDetailed(text).plaintext;
//     } catch (err) {
//         return '';
//     }
// }

// // --- 2. GOOGLE AUTH SETUP ---
// const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';
// const client = new OAuth2Client(GOOGLE_CLIENT_ID);
// const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_do_not_use_in_prod';

// // --- AUTHENTICATION & TRAFFIC MIDDLEWARE ---
// app.use((req, res, next) => {
//     if (req.path.startsWith('/api') && !req.path.includes('/admin') && !req.path.includes('/analytics') && !req.path.includes('/attendance/progress')) {
//         TrafficLog.create({ endpoint: req.path, method: req.method }).catch(() => {});
//     }
//     next();
// });

// const authenticateUser = (req, res, next) => {
//     const authHeader = req.headers.authorization;
//     if (!authHeader || !authHeader.startsWith('Bearer ')) {
//         return res.status(401).json({ error: 'Unauthorized Access.' });
//     }
//     const token = authHeader.split(' ')[1];
//     try {
//         const decoded = jwt.verify(token, JWT_SECRET);
//         req.user = decoded;
//         User.findByIdAndUpdate(decoded.id, { lastActive: new Date() }).catch(() => {});
//         next();
//     } catch (error) {
//         return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
//     }
// };

// // --- 3. AUTHENTICATION & CORE ROUTES ---
// app.get("/", async (req, res) => {
//     return res.json("Backend is running blazingly fast 🚀");
// });

// app.post('/api/auth/google', strictLimiter, async (req, res) => {
//     const { token } = req.body;
//     try {
//         const ticket = await client.verifyIdToken({
//             idToken: token,
//             audience: GOOGLE_CLIENT_ID,
//         });
//         const payload = ticket.getPayload();
//         const { email, name, picture } = payload;

//         if (!email.endsWith('@iimtrichy.ac.in')) {
//             return res.status(403).json({ error: 'Access denied. Please use your @iimtrichy.ac.in email.' });
//         }

//         let user = await User.findOne({ email });
//         if (!user) {
//             user = new User({ name, email, picture, lastActive: new Date() });
//             await user.save();
//             console.log(`New user registered: ${email}`);
//             AnalyticsEvent.create({ userEmail: email, eventType: 'auth', eventName: 'new_signup' }).catch(()=>{});
//         } else {
//             user.lastActive = new Date();
//             await user.save();
//             AnalyticsEvent.create({ userEmail: email, eventType: 'auth', eventName: 'app_opened' }).catch(()=>{});
//         }

//         const sessionToken = jwt.sign(
//             { id: user._id, email: user.email, name: user.name },
//             JWT_SECRET,
//             { expiresIn: '60d' }
//         );

//         const userObj = user.toObject();
//         userObj.hasOltCreds = !!(userObj.oltUsername && userObj.oltPassword);
//         delete userObj.oltPassword;

//         res.json({ message: 'Login successful', user: userObj, token: sessionToken });
//     } catch (error) {
//         console.error('Auth Error:', error);
//         res.status(401).json({ error: 'Invalid or expired Google token' });
//     }
// });

// app.get('/api/user/me', authenticateUser, async (req, res) => {
//     try {
//         const user = await User.findById(req.user.id).select('-__v');
//         if (!user) return res.status(404).json({ error: 'User not found.' });
        
//         const userObj = user.toObject();
//         userObj.hasOltCreds = !!(userObj.oltUsername && userObj.oltPassword);
//         delete userObj.oltPassword;
        
//         res.json({ user: userObj });
//     } catch (error) {
//         res.status(500).json({ error: 'Server error fetching profile.' });
//     }
// });

// app.post('/api/user/section', authenticateUser, async (req, res) => {
//     const { section } = req.body;
//     if (!section || !ALL_SECTIONS.includes(String(section).toUpperCase())) {
//         return res.status(400).json({ error: 'Invalid section.' });
//     }
//     try {
//         const user = await User.findByIdAndUpdate(
//             req.user.id,
//             { defaultSection: String(section).toUpperCase() },
//             { returnDocument: 'after' } 
//         ).select('-__v');
//         res.json({ success: true, user });
//     } catch (error) {
//         res.status(500).json({ error: 'Server error saving section preference.' });
//     }
// });

// app.post('/api/user/term', authenticateUser, async (req, res) => {
//     const { term } = req.body;
//     if (!term || !['Term-I', 'Term-II'].includes(term)) {
//         return res.status(400).json({ error: 'Invalid term.' });
//     }
//     try {
//         const user = await User.findByIdAndUpdate(
//             req.user.id,
//             { defaultTerm: term },
//             { returnDocument: 'after' } 
//         ).select('-__v');
//         res.json({ success: true, user });
//     } catch (error) {
//         res.status(500).json({ error: 'Server error saving term preference.' });
//     }
// });

// app.post('/api/user/olt-credentials', authenticateUser, async (req, res) => {
//     try {
//         const { username, password } = req.body;
//         await User.findByIdAndUpdate(req.user.id, {
//             oltUsername: username,
//             oltPassword: encryptText(password)
//         });
//         AnalyticsEvent.create({ userEmail: req.user.email, eventType: 'action', eventName: 'save_olt_creds' }).catch(()=>{});
//         res.json({ success: true });
//     } catch (error) {
//         res.status(500).json({ error: 'Failed to save credentials' });
//     }
// });

// app.post('/api/feedback', authenticateUser, async (req, res) => {
//     const { message } = req.body;
//     const email = req.user.email;
//     const name = req.user.name;

//     if (!message) return res.status(400).json({ error: "Missing required fields" });
//     if (message.length > 1000) return res.status(400).json({ error: "Message too long." });

//     try {
//         const newFeedback = new Feedback({ userEmail: email, userName: name, message });
//         await newFeedback.save();
//         AnalyticsEvent.create({ userEmail: email, eventType: 'action', eventName: 'submit_feedback' }).catch(()=>{});
//         res.json({ success: true, message: "Feedback submitted successfully." });
//     } catch (error) {
//         console.error("Feedback Error:", error);
//         res.status(500).json({ error: "Server error saving feedback." });
//     }
// });

// app.post('/api/analytics', authenticateUser, async (req, res) => {
//     const { eventType, eventName, metadata } = req.body;
//     try {
//         await AnalyticsEvent.create({
//             userEmail: req.user.email,
//             eventType: eventType || 'interaction',
//             eventName: eventName || 'unknown',
//             metadata: metadata || {}
//         });
//         res.json({ success: true });
//     } catch (error) {
//         res.status(500).json({ error: 'Failed to log event' });
//     }
// });

// const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// app.post('/api/admin/data', strictLimiter, async (req, res) => {
//     const { password } = req.body;
//     if (password !== ADMIN_PASSWORD) {
//         return res.status(401).json({ error: "Unauthorized. Incorrect password." });
//     }
//     try {
//         const feedbacks = await Feedback.find().sort({ createdAt: -1 });
//         const users = await User.find().sort({ lastActive: -1 }).select('-__v -oltPassword');
        
//         const oltUsersCount = await User.countDocuments({ oltUsername: { $exists: true, $ne: '' } });

//         const dauData = await AnalyticsEvent.aggregate([
//             { $match: { timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
//             { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, uniqueUsers: { $addToSet: "$userEmail" } } },
//             { $project: { date: "$_id", count: { $size: "$uniqueUsers" } } },
//             { $sort: { date: 1 } }
//         ]);

//         const trafficData = await TrafficLog.aggregate([
//             { $match: { timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
//             { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } }, hits: { $sum: 1 } } },
//             { $project: { date: "$_id", hits: 1 } },
//             { $sort: { date: 1 } }
//         ]);

//         const featureUsage = await AnalyticsEvent.aggregate([
//             { $match: { eventType: 'tab_click' } },
//             { $group: { _id: "$eventName", clicks: { $sum: 1 } } },
//             { $sort: { clicks: -1 } }
//         ]);

//         const interactions = await AnalyticsEvent.aggregate([
//             { $match: { eventType: 'button_click' } },
//             { $group: { _id: "$eventName", count: { $sum: 1 } } },
//             { $sort: { count: -1 } },
//             { $limit: 10 }
//         ]);

//         res.json({ 
//             success: true, 
//             feedbacks, 
//             users,
//             analytics: { 
//                 dau: dauData, 
//                 traffic: trafficData, 
//                 features: featureUsage, 
//                 interactions, 
//                 oltUsersCount 
//             }
//         });
//     } catch (error) {
//         console.error("Admin Error:", error);
//         res.status(500).json({ error: "Server error fetching admin data." });
//     }
// });

// app.post('/api/admin/user-details', strictLimiter, async (req, res) => {
//     const { password, email } = req.body;
//     if (password !== ADMIN_PASSWORD) {
//         return res.status(401).json({ error: "Unauthorized. Incorrect password." });
//     }
    
//     try {
//         const user = await User.findOne({ email }).select('-__v -oltPassword');
//         if (!user) return res.status(404).json({ error: "User not found" });

//         const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        
//         const activityRaw = await AnalyticsEvent.aggregate([
//             { $match: { userEmail: email, timestamp: { $gte: sevenDaysAgo } } },
//             { $group: { 
//                 _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp", timezone: "Asia/Kolkata" } }, 
//                 count: { $sum: 1 } 
//             }},
//             { $sort: { _id: 1 } }
//         ]);

//         const recentEventsRaw = await AnalyticsEvent.find({ userEmail: email })
//             .sort({ timestamp: -1 })
//             .limit(150);

//         res.json({ 
//             success: true, 
//             user, 
//             activityRaw, 
//             recentEventsRaw 
//         });
//     } catch (error) {
//         console.error("User Details Error:", error);
//         res.status(500).json({ error: "Server error fetching user details." });
//     }
// });

// app.get('/api/todos', authenticateUser, async (req, res) => {
//     try {
//         const todos = await Todo.find({ userEmail: req.user.email });
//         const formattedTodos = {};
//         todos.forEach(t => {
//             if (!formattedTodos[t.date]) formattedTodos[t.date] = {};
//             if (!formattedTodos[t.date][t.section]) formattedTodos[t.date][t.section] = {};
//             formattedTodos[t.date][t.section][t.subject] = t.tasks;
//         });
//         res.json(formattedTodos);
//     } catch (error) {
//         console.error("Error fetching todos:", error);
//         res.status(500).json({ error: "Server error fetching tasks." });
//     }
// });

// app.post('/api/todos', authenticateUser, async (req, res) => {
//     const { date, section, subject, tasks } = req.body;
//     const email = req.user.email;

//     if (!date || !section || !subject || !Array.isArray(tasks)) {
//         return res.status(400).json({ error: "Invalid data format." });
//     }

//     try {
//         if (tasks.length === 0) {
//             await Todo.deleteOne({ userEmail: email, date, section, subject });
//         } else {
//             await Todo.findOneAndUpdate(
//                 { userEmail: email, date, section, subject },
//                 { tasks },
//                 { upsert: true, returnDocument: 'after' } 
//             );
//         }
//         res.json({ success: true });
//     } catch (error) {
//         console.error("Error saving todos:", error);
//         res.status(500).json({ error: "Server error saving tasks." });
//     }
// });


// // ============================================================
// // MCGRAW HILL ASSIGNMENTS SCRAPER (DYNAMIC TIMEOUT & RETRY)
// // ============================================================

// let mheScrapeBusy = false;
// const MHE_MIN_DUE_DATE = process.env.MHE_MIN_DUE_DATE || '2026-10-11';

// async function scrapeMheAssignments({ username, password, sectionId, userEmail }) {
//     let browser;
//     try {
//         const launchOptions = {
//             headless: true,
//             args: [
//                 '--no-sandbox',
//                 '--disable-setuid-sandbox',
//                 '--disable-dev-shm-usage',
//                 '--disable-gpu',
//                 '--no-zygote',
//                 '--disable-blink-features=AutomationControlled'
//             ]
//         };
//         // Optional proxy if Render's IP gets blocked, e.g. MHE_PROXY=http://user:pass@host:port
//         if (process.env.MHE_PROXY) launchOptions.proxy = { server: process.env.MHE_PROXY };

//         browser = await chromium.launch(launchOptions);

//         const context = await browser.newContext({
//             userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
//             viewport: { width: 1920, height: 1080 },
//             locale: 'en-US',
//             timezoneId: 'Asia/Kolkata'
//         });

//         // Save memory/bandwidth: skip heavy assets
//         await context.route('**/*', (route) => {
//             const type = route.request().resourceType();
//             if (['image', 'font', 'media'].includes(type)) return route.abort();
//             return route.continue();
//         });

//         await context.addInitScript(() => {
//             Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
//         });

//         const page = await context.newPage();
//         page.setDefaultTimeout(60000);

//         // --- Context-level listener: catches the API call from any frame/page ---
//         let rawApiData = null;
//         let resolveCaptured;
//         const captured = new Promise(r => { resolveCaptured = r; });
//         const seenApiUrls = [];

//         context.on('response', async (response) => {
//             try {
//                 const url = response.url();
//                 if (/assignment/i.test(url)) seenApiUrls.push(`${response.status()} ${url.substring(0, 140)}`);
//                 if (rawApiData) return;
//                 if (!url.includes('studentAssignments')) return;
//                 if (response.status() !== 200) return;

//                 const text = await response.text();
//                 const json = JSON.parse(text);
//                 if (json && json.sectionAssignments) {
//                     rawApiData = json;
//                     resolveCaptured(true);
//                 }
//             } catch (e) {
//                 // body can be unavailable if the page navigated; we retry below
//             }
//         });

//         // --- LOGIN (fill first, keystroke typing as fallback) ---
//         username = String(username || '').trim();
//         password = String(password || '');
//         console.log(`[MHE] ${userEmail} logging in... (user len=${username.length}, pass len=${password.length})`);

//         const emailSel = "input[type='email']";
//         const passSel = "input[type='password']";

//         const tryLogin = async (mode) => {
//             await page.goto("https://accounts.mheducation.com/login", { waitUntil: "domcontentloaded" });
//             await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
//             await page.waitForSelector(emailSel, { timeout: 25000 });

//             for (const [sel, val] of [[emailSel, username], [passSel, password]]) {
//                 await page.click(sel);
//                 await page.fill(sel, '');
//                 if (mode === 'fill') await page.fill(sel, val);
//                 else await page.type(sel, val, { delay: 90 });
//             }

//             const emailOk = (await page.inputValue(emailSel)) === username;
//             const passOk = (await page.inputValue(passSel)) === password;
//             console.log(`[MHE] mode=${mode} fieldsMatchInput: email=${emailOk}, password=${passOk}`);

//             await page.click("button:has-text('Sign In')");

//             // Poll up to 25s: success = left /login, failure = error text shown
//             for (let i = 0; i < 25; i++) {
//                 await page.waitForTimeout(1000);
//                 if (!page.url().includes('/login')) return { ok: true };
//                 const body = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ');
//                 if (/do not match any accounts/i.test(body)) {
//                     return { ok: false, reason: 'BAD_CREDS', emailOk, passOk };
//                 }
//             }
//             return { ok: false, reason: 'NO_REDIRECT', emailOk, passOk };
//         };

//         let result = await tryLogin('fill');
//         if (!result.ok) {
//             console.log(`[MHE] fill mode failed (${result.reason}), retrying with typed input...`);
//             result = await tryLogin('type');
//         }

//         if (!result.ok) {
//             const err = new Error(
//                 result.reason === 'BAD_CREDS'
//                     ? "McGraw Hill rejected the email/password. Please re-check them (try logging in at accounts.mheducation.com first)."
//                     : "McGraw Hill login did not complete (possible captcha or bot-block on the server IP)."
//             );
//             err.code = result.reason;
//             err.debug = { afterLoginUrl: page.url(), ...result };
//             throw err;
//         }

//         await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
//         await page.waitForTimeout(2000);
//         console.log(`[MHE] After login URL: ${page.url()}`);

//         // --- FETCH CLASS PAGE ---
//         const classUrl = `https://newconnect.mheducation.com/student/class/section/${sectionId}`;
//         console.log(`[MHE] Opening ${classUrl}`);

//         await page.goto(classUrl, { waitUntil: "domcontentloaded" }).catch(e => {
//             console.log("[MHE] goto warning:", e.message);
//         });

//         const waitForCapture = (ms) => Promise.race([
//             captured,
//             new Promise(r => setTimeout(() => r(false), ms))
//         ]);

//         let ok = await waitForCapture(40000);

//         if (!ok) {
//             console.log("[MHE] No payload yet, reloading once...");
//             await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
//             ok = await waitForCapture(30000);
//         }

//         if (!ok || !rawApiData) {
//             let bodySnippet = '';
//             try {
//                 bodySnippet = (await page.innerText('body')).replace(/\s+/g, ' ').substring(0, 300);
//             } catch (e) {}
//             const err = new Error("Logged in, but the assignments data never loaded. Check your Section ID.");
//             err.debug = {
//                 finalUrl: page.url(),
//                 title: await page.title().catch(() => ''),
//                 bodySnippet,
//                 seenApiUrls: seenApiUrls.slice(0, 10)
//             };
//             throw err;
//         }

//         // --- PARSE ---
//         const courseDetails = {};
//         for (const a of rawApiData.sectionAssignments || []) {
//             courseDetails[a.id] = {
//                 name: a.name || 'Unknown',
//                 due: a.endDateTime || ''
//             };
//         }

//         const list = [];
//         for (const s of rawApiData.studentAssignments || []) {
//             const details = courseDetails[s.sectionAssignment];
//             if (!details) continue;

//             const dueClean = details.due ? details.due.replace("T", " ").substring(0, 16) : 'No due date';
//             if (dueClean === 'No due date' || dueClean >= MHE_MIN_DUE_DATE) {
//                 list.push({ status: s.status || 'UNKNOWN', dueDate: dueClean, name: details.name });
//             }
//         }

//         list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
//         return list;
//     } finally {
//         if (browser) await browser.close().catch(() => {});
//     }
// }


// app.post('/api/assignments/fetch', authenticateUser, async (req, res) => {
//     const { mheUsername, mhePassword, sectionId } = req.body;

//     if (!mheUsername || !mhePassword || !sectionId) {
//         return res.status(400).json({ error: "Missing McGraw Hill credentials or sectionId" });
//     }

//     if (mheScrapeBusy) {
//         return res.status(429).json({ error: "Another fetch is in progress. Please try again in about a minute." });
//     }

//     mheScrapeBusy = true;
//     try {
//         const data = await scrapeMheAssignments({
//             username: mheUsername,
//             password: mhePassword,
//             sectionId: String(sectionId).trim(),
//             userEmail: req.user.email
//         });
//         return res.status(200).json({ success: true, count: data.length, data });
//     } catch (error) {
//         console.error(`[MHE] Error for ${req.user.email}: ${error.message}`, error.debug || '');
//         const status = error.code === 'BAD_CREDS' ? 400 : 500;
//         return res.status(status).json({
//             error: error.message,
//             debug: error.debug || undefined   // remove once it works
//         });
//     } finally {
//         mheScrapeBusy = false;
//     }
// });

// // ============================================================
// // MCGRAW HILL BACKGROUND WATCHER (NEW)
// // Runs the same scrape as the "Assignments" tab once every hour
// // using credentials from environment variables, compares the
// // result with the last saved snapshot (stored in MongoDB so it
// // survives restarts) and emails the recipients ONLY if something
// // changed (new / removed assignment, status change, due date change).
// //
// // Required env vars (set on Render / in .env):
// //   MHE_WATCH_USERNAME     e.g. kartheek.p26030@iimtrichy.ac.in
// //   MHE_WATCH_PASSWORD     your McGraw Hill password
// //   MHE_WATCH_SECTION_ID   e.g. 157468169
// //   MAIL DELIVERY - configure ONE of these:
// //     A) BREVO_API_KEY + MAIL_FROM_EMAIL   sends over HTTPS, works on Render FREE
// //        (MAIL_FROM_EMAIL must be a sender you verified inside Brevo)
// //     B) SMTP_USER + SMTP_PASS             Gmail SMTP with an *App Password*.
// //        Render FREE web services BLOCK SMTP ports (25/465/587), so B needs a paid instance.
// // Optional:
// //   MHE_WATCH_RECIPIENTS   comma separated (default: kartheek.p26030@iimtrichy.ac.in,sasank.p26036@iimtrichy.ac.in)
// //   MHE_WATCH_ENABLED      set to "false" to switch the watcher off
// //   MHE_WATCH_NOTIFY_FIRST_RUN  set to "false" to NOT send the one-time welcome / watch-list email
// //   SMTP_HOST / SMTP_PORT  (default smtp.gmail.com / 465)
// //   MAIL_FROM              custom "From" header (SMTP mode)
// //   MAIL_FROM_NAME         display name used in Brevo mode (default: IIMT Assignment Watcher)
// // ============================================================

// const MHE_WATCH_ENABLED = process.env.MHE_WATCH_ENABLED !== 'false';
// const MHE_WATCH_USERNAME = process.env.MHE_WATCH_USERNAME || '';
// const MHE_WATCH_PASSWORD = process.env.MHE_WATCH_PASSWORD || '';
// const MHE_WATCH_SECTION_ID = process.env.MHE_WATCH_SECTION_ID || '';
// const MHE_WATCH_RECIPIENTS = (process.env.MHE_WATCH_RECIPIENTS || 'kartheek.p26030@iimtrichy.ac.in,sasank.p26036@iimtrichy.ac.in')
//     .split(',')
//     .map(s => s.trim())
//     .filter(Boolean);
// // ON by default: every recipient gets a one-time "you've been added to the watch list" email with the current status.
// // Set MHE_WATCH_NOTIFY_FIRST_RUN=false to disable it.
// const MHE_WATCH_WELCOME_ENABLED = process.env.MHE_WATCH_NOTIFY_FIRST_RUN !== 'false';

// const MHE_WATCH_INTERVAL_MS = 60 * 60 * 1000;       // 1 hour between runs
// const MHE_WATCH_BUSY_RETRY_MS = 5 * 60 * 1000;      // if a user scrape is running, retry in 5 min
// const MHE_WATCH_INITIAL_DELAY_MS = 90 * 1000;       // let the server + Excel cache settle first
// const MHE_WATCH_FAILURE_ALERT_AFTER = 3;            // email one alert after N consecutive failures
// const MHE_WATCH_RETRY_AFTER_FAIL_MS = 10 * 60 * 1000; // after a failed run, try again in 10 min (not a full hour)

// let mheWatchConsecutiveFailures = 0;
// let mheWatchFailureAlertSent = false;

// // In-memory status, readable through POST /api/admin/mhe-watch/status
// const mheWatchStatus = {
//     running: false,
//     runs: 0,
//     lastRunAt: null,
//     lastOutcome: 'never',
//     lastTrigger: null,
//     lastDurationMs: null,
//     lastError: null,
//     nextRunAt: null
// };

// const MHE_WATCH_SNAPSHOT_KEY = `mhe-watch:${MHE_WATCH_SECTION_ID}`;

// // ------------------------------------------------------------
// // MAIL DELIVERY
// //   A) BREVO_API_KEY set  -> sends over HTTPS (works on Render FREE, which blocks SMTP ports)
// //   B) SMTP_USER/SMTP_PASS -> classic SMTP (needs a PAID Render instance, or running locally)
// // ------------------------------------------------------------
// function mheMailProviderName() {
    
//     if (process.env.BREVO_API_KEY) return 'brevo-api';
    
//     return 'none';
// }

// let mailTransporter = null;
// function getMailTransporter() {
//     if (mailTransporter) return mailTransporter;
//     if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;

//     const port = parseInt(process.env.SMTP_PORT || '465', 10);
//     mailTransporter = nodemailer.createTransport({
//         host: process.env.SMTP_HOST || 'smtp.gmail.com',
//         port,
//         secure: port === 465,
//         auth: {
//             user: process.env.SMTP_USER,
//             pass: process.env.SMTP_PASS
//         },
//         // Fail fast instead of hanging ~2 minutes when the port is blocked
//         connectionTimeout: 15000,
//         greetingTimeout: 15000,
//         socketTimeout: 30000
//     });
//     return mailTransporter;
// }

// function mheMailErrorHint(err) {
//     const code = err && err.code;
//     if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) {
//         return ' (Outbound SMTP looks blocked. Render FREE web services block SMTP ports 25/465/587. Set BREVO_API_KEY to send over HTTPS, or upgrade to a paid instance.)';
//     }
//     if (code === 'EAUTH') {
//         return ' (Gmail rejected the login. SMTP_PASS must be a 16-character Gmail App Password and 2-step verification must be on.)';
//     }
//     return '';
// }

// async function sendViaBrevo(recipients, subject, html, text) {
//     const fromEmail = process.env.MAIL_FROM_EMAIL || process.env.SMTP_USER;
//     if (!fromEmail) {
//         throw new Error('MAIL_FROM_EMAIL is not set (use an address you verified as a sender in Brevo).');
//     }
//     try {
//         await axios.post('https://api.brevo.com/v3/smtp/email', {
//             sender: { name: process.env.MAIL_FROM_NAME || 'IIMT Assignment Watcher', email: fromEmail },
//             to: recipients.map(email => ({ email })),
//             subject,
//             htmlContent: html,
//             textContent: text
//         }, {
//             headers: {
//                 'api-key': process.env.BREVO_API_KEY,
//                 'content-type': 'application/json',
//                 accept: 'application/json'
//             },
//             timeout: 20000
//         });
//     } catch (err) {
//         const detail = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
//         throw new Error(`Brevo API send failed: ${detail}`);
//     }
// }



// // Replace your existing sendMheMail function with this:
// // Replace the existing sendMheMail function with this updated version
// async function sendMheMail(subject, htmlContent, textContent, recipients) {
//     // If no specific recipients are passed (e.g., for failure alerts), fallback to the default list
//     const targetRecipients = (recipients && recipients.length > 0) 
//         ? recipients 
//         : MHE_WATCH_RECIPIENTS;

//     // Brevo expects the 'to' field to be an array of objects: [{ email: "..." }]
//     const toArray = targetRecipients.map(email => ({ email }));

//     try {
//         const response = await axios.post(
//             'https://api.brevo.com/v3/smtp/email',
//             {
//                 sender: { 
//                     name: process.env.MAIL_FROM_NAME || "IIMT Assignment Watcher", 
//                     email: process.env.MAIL_FROM_EMAIL || "copypasteenbl@gmail.com" // Your verified sender
//                 },
//                 to: toArray,
//                 subject: subject,
//                 htmlContent: htmlContent,
//                 textContent: textContent
//             },
//             {
//                 headers: {
//                     'api-key': process.env.BREVO_API_KEY,
//                     'Content-Type': 'application/json',
//                     'accept': 'application/json'
//                 }
//             }
//         );

//         console.log('[MHE-Watch] Email sent successfully via Brevo! Message ID:', response.data.messageId);
//         return true;
//     } catch (error) {
//         console.error('[MHE-Watch] Failed to send email via Brevo. Error details:');
//         console.error(error.response ? error.response.data : error.message);
//         throw new Error(`Brevo API send failed: ${error.message}`);
//     }
// }

// // Logged once at startup so problems are visible immediately (not 90 seconds + one scrape later)
// async function verifyMailProvider() {
//     try {
//         await axios.get('https://api.brevo.com/v3/account', {
//             headers: { 
//                 'api-key': process.env.BREVO_API_KEY, 
//                 accept: 'application/json' 
//             },
//             timeout: 15000
//         });
//         console.log('[MHE-Watch] Mail provider check OK: Brevo API key is valid.');
//     } catch (err) {
//         const detail = err.response ? `HTTP ${err.response.status} ${JSON.stringify(err.response.data)}` : err.message;
//         console.error(`[MHE-Watch] Mail provider check FAILED (brevo-api): ${detail}`);
//     }
// }


// const escapeHtml = (s) => String(s === undefined || s === null ? '' : s)
//     .replace(/&/g, '&amp;')
//     .replace(/</g, '&lt;')
//     .replace(/>/g, '&gt;')
//     .replace(/"/g, '&quot;');

// // Turn the list into a stable map keyed by assignment name (duplicates get #2, #3...)
// function mheListToMap(list) {
//     const map = new Map();
//     const seen = {};
//     for (const item of list || []) {
//         const baseKey = String(item.name || 'Unknown').trim();
//         seen[baseKey] = (seen[baseKey] || 0) + 1;
//         const key = seen[baseKey] > 1 ? `${baseKey} #${seen[baseKey]}` : baseKey;
//         map.set(key, { name: baseKey, status: item.status, dueDate: item.dueDate });
//     }
//     return map;
// }

// function mheHashList(list) {
//     const normalized = Array.from(mheListToMap(list).entries())
//         .sort((a, b) => a[0].localeCompare(b[0]))
//         .map(([key, v]) => [key, v.status, v.dueDate]);
//     return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
// }

// function mheComputeDiff(oldList, newList) {
//     const oldMap = mheListToMap(oldList);
//     const newMap = mheListToMap(newList);

//     const added = [];
//     const removed = [];
//     const statusChanged = [];
//     const dueChanged = [];

//     for (const [key, n] of newMap.entries()) {
//         const o = oldMap.get(key);
//         if (!o) {
//             added.push(n);
//             continue;
//         }
//         if (o.status !== n.status) statusChanged.push({ name: key, from: o.status, to: n.status, dueDate: n.dueDate });
//         if (o.dueDate !== n.dueDate) dueChanged.push({ name: key, from: o.dueDate, to: n.dueDate });
//     }
//     for (const [key, o] of oldMap.entries()) {
//         if (!newMap.has(key)) removed.push(o);
//     }

//     return { added, removed, statusChanged, dueChanged };
// }

// // ------------------------------------------------------------
// // EMAIL TEMPLATE HELPERS (inline styles only, so Gmail renders them correctly)
// // ------------------------------------------------------------
// function mheStatusKey(status) {
//     return String(status || 'UNKNOWN').toUpperCase().replace(/[_\s-]/g, '');
// }

// function mheStatusLabel(status) {
//     const key = mheStatusKey(status);
//     const map = {
//         NOTSTARTED: 'NOT STARTED',
//         INPROGRESS: 'IN PROGRESS',
//         NOTSUBMITTED: 'NOT SUBMITTED',
//         PASTDUE: 'PAST DUE'
//     };
//     return map[key] || String(status || 'UNKNOWN').toUpperCase().replace(/_/g, ' ');
// }

// function mheStatusColors(status) {
//     const key = mheStatusKey(status);
//     if (['SUBMITTED', 'COMPLETE', 'COMPLETED', 'GRADED', 'DONE'].includes(key)) return { bg: '#dcfce7', fg: '#166534' };   // green
//     if (['INPROGRESS', 'STARTED', 'OPEN'].includes(key)) return { bg: '#dbeafe', fg: '#1e40af' };                          // blue
//     if (['NOTSTARTED', 'PENDING', 'NOTSUBMITTED', 'UNKNOWN'].includes(key)) return { bg: '#fef3c7', fg: '#92400e' };       // amber
//     if (['OVERDUE', 'LATE', 'PASTDUE', 'MISSED'].includes(key)) return { bg: '#fee2e2', fg: '#991b1b' };                   // red
//     return { bg: '#e5e7eb', fg: '#374151' };                                                                               // grey
// }

// function mheBadge(status) {
//     const c = mheStatusColors(status);
//     return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${c.bg};color:${c.fg};font-size:12px;font-weight:700;">${escapeHtml(mheStatusLabel(status))}</span>`;
// }

// function mheCard(accent, mainHtml, subHtml) {
//     return `<div style="border-left:4px solid ${accent};background:#f9fafb;border-radius:6px;padding:10px 14px;margin-bottom:8px;">` +
//         `<div style="font-size:14px;font-weight:600;color:#111827;">${mainHtml}</div>` +
//         `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${subHtml}</div>` +
//         `</div>`;
// }

// function mheSection(title, accent, cardsHtml) {
//     return `<tr><td style="padding:20px 28px 0 28px;">` +
//         `<div style="font-size:14px;font-weight:700;color:${accent};margin-bottom:10px;">${title}</div>` +
//         `${cardsHtml}</td></tr>`;
// }

// function mheChips(items) {
//     const cells = items.filter(i => i.count > 0).map(i =>
//         `<td style="padding-right:8px;"><div style="background:${i.bg};color:${i.fg};border-radius:8px;padding:8px 16px;text-align:center;">` +
//         `<div style="font-size:20px;font-weight:700;">${i.count}</div>` +
//         `<div style="font-size:11px;font-weight:600;">${i.label}</div></div></td>`
//     ).join('');
//     if (!cells) return '';
//     return `<tr><td style="padding:22px 28px 0 28px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${cells}</tr></table></td></tr>`;
// }

// function mheListTable(list) {
//     const rows = (list || []).map((i, idx) =>
//         `<tr style="background:${idx % 2 === 0 ? '#ffffff' : '#f9fafb'};">` +
//         `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#111827;">${escapeHtml(i.name)}</td>` +
//         `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#4b5563;white-space:nowrap;">${escapeHtml(i.dueDate)}</td>` +
//         `<td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${mheBadge(i.status)}</td>` +
//         `</tr>`
//     ).join('');

//     const body = rows || `<tr><td colspan="3" style="padding:14px;font-size:13px;color:#6b7280;text-align:center;">No assignments</td></tr>`;

//     return `<tr><td style="padding:24px 28px 8px 28px;">` +
//         `<div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:10px;">📋 All assignments (${(list || []).length})</div>` +
//         `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;border-collapse:separate;overflow:hidden;">` +
//         `<tr style="background:#eef2ff;">` +
//         `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;">ASSIGNMENT</td>` +
//         `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;">DUE</td>` +
//         `<td style="padding:10px 12px;font-size:12px;font-weight:700;color:#4338ca;text-align:right;">STATUS</td></tr>` +
//         `${body}</table></td></tr>`;
// }

// function mheEmailShell({ headerTitle, headerSub, headerColor, bodyRows }) {
//     return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;">` +
//         `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;"><tr><td align="center">` +
//         `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">` +
//         `<tr><td bgcolor="${headerColor}" style="background:${headerColor};padding:26px 28px;">` +
//         `<div style="font-size:11px;color:#c7d2fe;letter-spacing:1.5px;font-weight:700;">MCGRAW HILL CONNECT</div>` +
//         `<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">${headerTitle}</div>` +
//         `<div style="font-size:12px;color:#e0e7ff;margin-top:6px;">${headerSub}</div>` +
//         `</td></tr>` +
//         `${bodyRows}` +
//         `<tr><td style="padding:22px 28px;text-align:center;font-size:11px;color:#9ca3af;">Sent automatically by IIMT Assignment Watcher · checks every hour</td></tr>` +
//         `</table></td></tr></table></body></html>`;
// }

// function mheBuildChangeEmail(diff, newList) {
//     const { added, removed, statusChanged, dueChanged } = diff;
//     const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

//     let body = mheChips([
//         { label: 'NEW', count: added.length, bg: '#dcfce7', fg: '#166534' },
//         { label: 'STATUS', count: statusChanged.length, bg: '#dbeafe', fg: '#1e40af' },
//         { label: 'DUE DATE', count: dueChanged.length, bg: '#fef3c7', fg: '#92400e' },
//         { label: 'REMOVED', count: removed.length, bg: '#fee2e2', fg: '#991b1b' }
//     ]);

//     const textParts = [];

//     if (added.length) {
//         body += mheSection('🆕 New assignments', '#16a34a', added.map(a =>
//             mheCard('#16a34a', escapeHtml(a.name), `Due ${escapeHtml(a.dueDate)} &nbsp;·&nbsp; ${mheBadge(a.status)}`)).join(''));
//         textParts.push(`NEW ASSIGNMENTS (${added.length})\n` + added.map(a => `- ${a.name} | due ${a.dueDate} | ${a.status}`).join('\n'));
//     }
//     if (statusChanged.length) {
//         body += mheSection('🔄 Status changes', '#2563eb', statusChanged.map(s =>
//             mheCard('#2563eb', escapeHtml(s.name), `${mheBadge(s.from)} &nbsp;→&nbsp; ${mheBadge(s.to)} &nbsp;·&nbsp; Due ${escapeHtml(s.dueDate)}`)).join(''));
//         textParts.push(`STATUS CHANGES (${statusChanged.length})\n` + statusChanged.map(s => `- ${s.name}: ${s.from} -> ${s.to} (due ${s.dueDate})`).join('\n'));
//     }
//     if (dueChanged.length) {
//         body += mheSection('📅 Due date changes', '#d97706', dueChanged.map(d =>
//             mheCard('#d97706', escapeHtml(d.name), `<s style="color:#9ca3af;">${escapeHtml(d.from)}</s> &nbsp;→&nbsp; <b style="color:#92400e;">${escapeHtml(d.to)}</b>`)).join(''));
//         textParts.push(`DUE DATE CHANGES (${dueChanged.length})\n` + dueChanged.map(d => `- ${d.name}: ${d.from} -> ${d.to}`).join('\n'));
//     }
//     if (removed.length) {
//         body += mheSection('🗑️ Removed assignments', '#dc2626', removed.map(r =>
//             mheCard('#dc2626', escapeHtml(r.name), `Was due ${escapeHtml(r.dueDate)} &nbsp;·&nbsp; ${mheBadge(r.status)}`)).join(''));
//         textParts.push(`REMOVED ASSIGNMENTS (${removed.length})\n` + removed.map(r => `- ${r.name} | was due ${r.dueDate} | ${r.status}`).join('\n'));
//     }

//     body += mheListTable(newList);

//     const total = added.length + removed.length + statusChanged.length + dueChanged.length;

//     const html = mheEmailShell({
//         headerTitle: `${total} update${total === 1 ? '' : 's'} detected`,
//         headerSub: `${escapeHtml(stamp)} (IST)`,
//         headerColor: '#4f46e5',
//         bodyRows: body
//     });

//     const text =
//         `McGraw Hill assignments updated (${stamp} IST)\n\n` +
//         textParts.join('\n\n') +
//         `\n\nCURRENT LIST (${(newList || []).length})\n` +
//         (newList || []).map(i => `- ${i.name} | due ${i.dueDate} | ${i.status}`).join('\n');

//     const bits = [];
//     if (added.length) bits.push(`${added.length} new`);
//     if (statusChanged.length) bits.push(`${statusChanged.length} status`);
//     if (dueChanged.length) bits.push(`${dueChanged.length} due date`);
//     if (removed.length) bits.push(`${removed.length} removed`);

//     return { subject: `📚 MHE update: ${bits.join(', ')}`, html, text };
// }

// function mheBuildWelcomeEmail(list, recipients) {
//     const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
//     const items = list || [];

//     // Count assignments per status for the colored summary chips
//     const counts = {};
//     items.forEach(i => {
//         const k = mheStatusKey(i.status);
//         if (!counts[k]) counts[k] = { status: i.status, count: 0 };
//         counts[k].count++;
//     });
//     const chips = mheChips(Object.values(counts).map(c => {
//         const col = mheStatusColors(c.status);
//         return { label: mheStatusLabel(c.status), count: c.count, bg: col.bg, fg: col.fg };
//     }));

//     const watchList = (recipients && recipients.length ? recipients : MHE_WATCH_RECIPIENTS)
//         .map(r => `<span style="display:inline-block;background:#eef2ff;color:#4338ca;border-radius:999px;padding:3px 10px;font-size:12px;margin:2px 4px 2px 0;">${escapeHtml(r)}</span>`)
//         .join('');

//     let body =
//         `<tr><td style="padding:22px 28px 0 28px;font-size:14px;color:#374151;line-height:1.6;">` +
//         `Hi 👋 You’ve been added to the <b>McGraw Hill assignment watch list</b>.<br>` +
//         `We check McGraw Hill Connect every hour and email you as soon as an assignment is added, removed, or its status or due date changes.` +
//         `</td></tr>` +
//         `<tr><td style="padding:14px 28px 0 28px;font-size:12px;color:#6b7280;">Watch list:<br>${watchList}</td></tr>` +
//         `<tr><td style="padding:22px 28px 0 28px;font-size:14px;font-weight:700;color:#111827;">📊 Current status</td></tr>` +
//         chips +
//         mheListTable(items);

//     const html = mheEmailShell({
//         headerTitle: 'You’re on the watch list 🔔',
//         headerSub: `Status as of ${escapeHtml(stamp)} (IST)`,
//         headerColor: '#059669',
//         bodyRows: body
//     });

//     const text =
//         `You've been added to the McGraw Hill assignment watch list (${stamp} IST)\n` +
//         `You'll get an email whenever an assignment is added, removed, or its status / due date changes.\n\n` +
//         `CURRENT STATUS (${items.length})\n` +
//         (items.length ? items.map(i => `- ${i.name} | due ${i.dueDate} | ${mheStatusLabel(i.status)}`).join('\n') : '- No assignments');

//     return { subject: `🔔 You’ve been added to the MHE assignment watch list (${items.length} tracked)`, html, text };
// }

// function mheBuildFailureEmail(failures, errMessage) {
//     const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
//     const body =
//         `<tr><td style="padding:22px 28px 8px 28px;">` +
//         mheCard('#dc2626', `Failed ${failures} times in a row`, `Last error: ${escapeHtml(errMessage)}`) +
//         `<div style="font-size:13px;color:#4b5563;line-height:1.5;margin-top:8px;">Check the McGraw Hill password / section ID, or whether the server IP is being blocked.</div>` +
//         `</td></tr>`;

//     return {
//         subject: '⚠️ MHE watcher is failing',
//         html: mheEmailShell({
//             headerTitle: 'Watcher needs attention ⚠️',
//             headerSub: `${escapeHtml(stamp)} (IST)`,
//             headerColor: '#dc2626',
//             bodyRows: body
//         }),
//         text: `The McGraw Hill watcher failed ${failures} times in a row.\nLast error: ${errMessage}`
//     };
// }

// // Returns 'busy' | 'skipped' | 'failed' | 'ok'
// async function runMheWatcherOnce(opts = {}) {
//     if (!MHE_WATCH_USERNAME || !MHE_WATCH_PASSWORD || !MHE_WATCH_SECTION_ID) {
//         console.log('[MHE-Watch] MHE_WATCH_USERNAME / MHE_WATCH_PASSWORD / MHE_WATCH_SECTION_ID not set. Watcher idle.');
//         return 'skipped';
//     }

//     // Share the same lock as the manual "Assignments" tab so two Chromium instances never run together (OOM safety)
//     if (mheScrapeBusy) {
//         console.log('[MHE-Watch] Another scrape is running, will retry shortly.');
//         return 'busy';
//     }

//     const markSuccess = () => {
//         mheWatchConsecutiveFailures = 0;
//         mheWatchFailureAlertSent = false;
//         mheWatchStatus.lastError = null;
//     };

//     mheScrapeBusy = true;
//     try {
//         console.log('[MHE-Watch] Run started - fetching assignments...');
//         const list = await scrapeMheAssignments({
//             username: MHE_WATCH_USERNAME,
//             password: MHE_WATCH_PASSWORD,
//             sectionId: String(MHE_WATCH_SECTION_ID).trim(),
//             userEmail: `watcher:${MHE_WATCH_USERNAME}`
//         });
//         console.log(`[MHE-Watch] Scrape OK (${list.length} assignments).`);

//         const newHash = mheHashList(list);
//         const previous = await MheSnapshot.findOne({ key: MHE_WATCH_SNAPSHOT_KEY });

//         // ---- Who still needs the "you've been added to the watch list" email? ----
//         // Works for the very first run AND for any recipient added to MHE_WATCH_RECIPIENTS later.
//         const alreadyNotified = opts.resendWelcome
//             ? new Set()
//             : new Set(((previous && previous.notifiedRecipients) || []).map(r => String(r).toLowerCase()));
//         const newRecipients = MHE_WATCH_WELCOME_ENABLED
//             ? MHE_WATCH_RECIPIENTS.filter(r => !alreadyNotified.has(r.toLowerCase()))
//             : [];
//         const notifiedNow = Array.from(new Set([...alreadyNotified, ...newRecipients.map(r => r.toLowerCase())]));

//         // 1) Save the baseline IMMEDIATELY (never depends on email working)
//         if (!previous) {
//             await MheSnapshot.findOneAndUpdate(
//                 { key: MHE_WATCH_SNAPSHOT_KEY },
//                 { key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, notifiedRecipients: [], updatedAt: new Date() },
//                 { upsert: true, returnDocument: 'after' }
//             );
//             await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff: null, emailSent: false, kind: 'baseline' })
//                 .catch(e => console.error('[MHE-Watch] History save failed:', e.message));
//             console.log(`[MHE-Watch] Baseline saved to MongoDB (${list.length} assignments).`);
//         } else {
//             await MheSnapshot.updateOne({ key: MHE_WATCH_SNAPSHOT_KEY }, { updatedAt: new Date() });
//         }

//         // 2) Welcome mail (with the current status). If it fails we remember that and retry on the next run.
//         let mailError = null;
//         if (newRecipients.length) {
//             try {
//                 const welcome = mheBuildWelcomeEmail(list, newRecipients);
//                 await sendMheMail(welcome.subject, welcome.html, welcome.text, newRecipients);
//                 await MheSnapshot.updateOne({ key: MHE_WATCH_SNAPSHOT_KEY }, { notifiedRecipients: notifiedNow });
//                 await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff: null, emailSent: true, kind: 'welcome' })
//                     .catch(e => console.error('[MHE-Watch] History save failed:', e.message));
//                 console.log(`[MHE-Watch] Welcome email sent to ${newRecipients.join(', ')}`);
//             } catch (err) {
//                 mailError = err;
//                 console.error(`[MHE-Watch] Welcome email FAILED: ${err.message}`);
//             }
//         }

//         // First run, or nothing changed -> done
//         if (!previous || previous.hash === newHash) {
//             if (previous) console.log(`[MHE-Watch] No change (${list.length} assignments).`);
//             if (mailError) throw mailError;
//             markSuccess();
//             return 'ok';
//         }

//         // 3) Changed -> build diff, send mail FIRST, only then save the new snapshot (so a failed mail is retried).
//         //    Freshly welcomed recipients already received the up-to-date list, so they are skipped here.
//         const diff = mheComputeDiff(previous.data, list);
//         const changeRecipients = MHE_WATCH_RECIPIENTS.filter(r => !newRecipients.includes(r));
//         if (changeRecipients.length) {
//             const mail = mheBuildChangeEmail(diff, list);
//             await sendMheMail(mail.subject, mail.html, mail.text, changeRecipients);
//             console.log(`[MHE-Watch] Change detected, email sent to ${changeRecipients.join(', ')}`);
//         }

//         await MheSnapshot.findOneAndUpdate(
//             { key: MHE_WATCH_SNAPSHOT_KEY },
//             { hash: newHash, data: list, updatedAt: new Date() },
//             { upsert: true, returnDocument: 'after' }
//         );
//         await MheStateHistory.create({ key: MHE_WATCH_SNAPSHOT_KEY, hash: newHash, data: list, diff, emailSent: changeRecipients.length > 0, kind: 'change' })
//             .catch(e => console.error('[MHE-Watch] History save failed:', e.message));

//         if (mailError) throw mailError;
//         markSuccess();
//         return 'ok';
//     } catch (error) {
//         mheWatchConsecutiveFailures++;
//         mheWatchStatus.lastError = error.message;
//         console.error(`[MHE-Watch] Run failed (${mheWatchConsecutiveFailures} in a row): ${error.message}`, error.debug || '');

//         // One-time alert if the watcher keeps failing (bad password, captcha, blocked IP...)
//         if (mheWatchConsecutiveFailures >= MHE_WATCH_FAILURE_ALERT_AFTER && !mheWatchFailureAlertSent) {
//             try {
//                 const failMail = mheBuildFailureEmail(mheWatchConsecutiveFailures, error.message);
//                 await sendMheMail(failMail.subject, failMail.html, failMail.text);
//                 mheWatchFailureAlertSent = true;
//             } catch (mailErr) {
//                 console.error('[MHE-Watch] Could not send failure alert:', mailErr.message);
//             }
//         }
//         return 'failed';
//     } finally {
//         mheScrapeBusy = false;
//     }
// }

// // Wrapper that records status (used by the schedule AND the manual admin trigger)
// async function executeMheWatcherRun(trigger = 'schedule', opts = {}) {
//     const started = Date.now();
//     mheWatchStatus.running = true;
//     mheWatchStatus.lastTrigger = trigger;
//     let outcome = 'failed';
//     try {
//         outcome = await runMheWatcherOnce(opts);
//     } catch (e) {
//         mheWatchStatus.lastError = e.message;
//         console.error('[MHE-Watch] Unexpected error:', e.message);
//     } finally {
//         mheWatchStatus.running = false;
//         mheWatchStatus.lastRunAt = new Date().toISOString();
//         mheWatchStatus.lastOutcome = outcome;
//         mheWatchStatus.lastDurationMs = Date.now() - started;
//         mheWatchStatus.runs++;
//         console.log(`[MHE-Watch] Run finished: ${outcome} in ${Math.round((Date.now() - started) / 1000)}s`);
//     }
//     return outcome;
// }

// // --- Self-rescheduling loop: never overlaps. 1 hr after a good run, sooner after a busy/failed run ---
// const runMheWatcherDaemon = async () => {
//     let nextDelay = MHE_WATCH_INTERVAL_MS;
//     try {
//         const outcome = await executeMheWatcherRun('schedule');
//         if (outcome === 'busy') nextDelay = MHE_WATCH_BUSY_RETRY_MS;
//         else if (outcome === 'failed') nextDelay = MHE_WATCH_RETRY_AFTER_FAIL_MS;
//     } catch (e) {
//         console.error('[MHE-Watch] Daemon error:', e.message);
//     } finally {
//         mheWatchStatus.nextRunAt = new Date(Date.now() + nextDelay).toISOString();
//         console.log(`[MHE-Watch] Next run in ${Math.round(nextDelay / 60000)} min.`);
//         setTimeout(runMheWatcherDaemon, nextDelay);
//     }
// };

// function startMheWatcher() {
//     if (!MHE_WATCH_ENABLED) {
//         console.log('[MHE-Watch] Disabled via MHE_WATCH_ENABLED=false');
//         return;
//     }
//     if (!MHE_WATCH_USERNAME || !MHE_WATCH_PASSWORD || !MHE_WATCH_SECTION_ID) {
//         console.log('[MHE-Watch] Not started: set MHE_WATCH_USERNAME, MHE_WATCH_PASSWORD and MHE_WATCH_SECTION_ID env vars.');
//         return;
//     }
//     console.log(`[MHE-Watch] Enabled. Mail provider: ${mheMailProviderName()}. First run in ${MHE_WATCH_INITIAL_DELAY_MS / 1000}s, then every ${MHE_WATCH_INTERVAL_MS / 60000} min. Recipients: ${MHE_WATCH_RECIPIENTS.join(', ')}`);
//     mheWatchStatus.nextRunAt = new Date(Date.now() + MHE_WATCH_INITIAL_DELAY_MS).toISOString();

//     // Check the mail setup right now so a bad config shows up in the logs immediately
//     verifyMailProvider();

//     setTimeout(runMheWatcherDaemon, MHE_WATCH_INITIAL_DELAY_MS);
// }

// // ------------------------------------------------------------
// // ADMIN ENDPOINTS FOR THE WATCHER (same ADMIN_PASSWORD as the admin dashboard)
// //   POST /api/admin/mhe-watch/status      {password}                      -> what is the watcher doing?
// //   POST /api/admin/mhe-watch/test-mail   {password}                      -> send a test email right now
// //   POST /api/admin/mhe-watch/run         {password, resendWelcome?: true} -> run a check right now
// // ------------------------------------------------------------
// const mheAdminLimiter = rateLimit({
//     windowMs: 60 * 60 * 1000,
//     max: 60,
//     message: { error: "Too many watcher admin requests, please try again later." }
// });

// const mheAdminAuthorized = (req, res) => {
//     if (!req.body || req.body.password !== ADMIN_PASSWORD) {
//         res.status(401).json({ error: "Unauthorized. Incorrect password." });
//         return false;
//     }
//     return true;
// };

// app.post('/api/admin/mhe-watch/status', mheAdminLimiter, async (req, res) => {
//     if (!mheAdminAuthorized(req, res)) return;
//     try {
//         const snap = await MheSnapshot.findOne({ key: MHE_WATCH_SNAPSHOT_KEY }).select('-__v');
//         res.json({
//             success: true,
//             enabled: MHE_WATCH_ENABLED,
//             mailProvider: mheMailProviderName(),
//             recipients: MHE_WATCH_RECIPIENTS,
//             sectionId: MHE_WATCH_SECTION_ID,
//             consecutiveFailures: mheWatchConsecutiveFailures,
//             scrapeBusy: mheScrapeBusy,
//             status: mheWatchStatus,
//             snapshot: snap ? {
//                 updatedAt: snap.updatedAt,
//                 assignments: Array.isArray(snap.data) ? snap.data.length : 0,
//                 notifiedRecipients: snap.notifiedRecipients,
//                 data: snap.data
//             } : null
//         });
//     } catch (error) {
//         res.status(500).json({ error: error.message });
//     }
// });

// app.post('/api/admin/mhe-watch/test-mail', mheAdminLimiter, async (req, res) => {
//     if (!mheAdminAuthorized(req, res)) return;
//     const stamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
//     const html = mheEmailShell({
//         headerTitle: 'Test email ✅',
//         headerSub: `${escapeHtml(stamp)} (IST)`,
//         headerColor: '#4f46e5',
//         bodyRows: `<tr><td style="padding:22px 28px;font-size:14px;color:#374151;line-height:1.6;">If you can read this, email delivery from the watcher works (provider: <b>${escapeHtml(mheMailProviderName())}</b>).</td></tr>`
//     });
//     try {
//         await sendMheMail('✅ MHE watcher test email', html, `Test email from the MHE watcher (${stamp} IST). Provider: ${mheMailProviderName()}`);
//         res.json({ success: true, provider: mheMailProviderName(), sentTo: MHE_WATCH_RECIPIENTS });
//     } catch (error) {
//         console.error('[MHE-Watch] Test mail failed:', error.message);
//         res.status(500).json({ success: false, provider: mheMailProviderName(), error: error.message });
//     }
// });

// app.post('/api/admin/mhe-watch/run', mheAdminLimiter, async (req, res) => {
//     if (!mheAdminAuthorized(req, res)) return;
//     if (mheScrapeBusy) {
//         return res.status(429).json({ error: 'A scrape is already running. Try again in a minute.' });
//     }
//     // Fire and forget: the scrape takes a minute or two. Watch the Render logs or call /status.
//     executeMheWatcherRun('manual', { resendWelcome: req.body.resendWelcome === true });
//     res.status(202).json({ success: true, message: 'Watcher run started. Check the Render logs or call /api/admin/mhe-watch/status.' });
// });

// // ============================================================
// // OLT SCRAPING ENGINE 
// // ============================================================

// const BASE_URL = "https://olt.iimtrichy.ac.in";
// const LOGIN_URL = `${BASE_URL}/Default.aspx`;
// const ATTENDANCE_URL = `${BASE_URL}/SubjectAttendance`;

// const TERMS = {
//     "Term-I": [
//         "Business Statistics", 
//         "Financial Reporting and Analysis", 
//         "Managerial Communication", 
//         "Managerial Economics", 
//         "Marketing Management -I", 
//         "Micro Organizational Behaviour"
//     ],
//     "Term-II": [
//         "Business Ethics", 
//         "Corporate Finance", 
//         "Information Systems for Managers", 
//         "Macro Economics for Managers", 
//         "Macro Organizational Behaviour", 
//         "Marketing Management-II", 
//         "Operations Research for Managers", 
//         "The Entrepreneurial Manager" 
//     ]
// };

// const SUBJECT_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSubjectName';
// const SECTION_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSection';
// const PROGRAM_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName';
// const TERM_DROPDOWN = 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo';

// // ============================================================
// // ATTENDANCE FETCH PROGRESS TRACKING 
// // ============================================================
// const attendanceProgress = new Map();

// function setAttendanceProgress(userId, step, message, status = 'in_progress', total = 8) {
//     if (!userId) return;
//     const current = attendanceProgress.get(String(userId));
//     const progressTotal = total || (current ? current.total : 8);
//     attendanceProgress.set(String(userId), {
//         step,
//         total: progressTotal,
//         message,
//         status,
//         timestamp: Date.now()
//     });
// }

// function clearAttendanceProgressSoon(userId) {
//     if (!userId) return;
//     setTimeout(() => attendanceProgress.delete(String(userId)), 15000);
// }

// setInterval(() => {
//     const now = Date.now();
//     for (const [id, progress] of attendanceProgress.entries()) {
//         if (now - progress.timestamp > 10 * 60 * 1000) attendanceProgress.delete(id);
//     }
// }, 60 * 1000);

// app.get('/api/attendance/progress', authenticateUser, (req, res) => {
//     const progress = attendanceProgress.get(String(req.user.id)) || {
//         step: 0,
//         total: 8,
//         message: 'Waiting to start…',
//         status: 'idle'
//     };
//     res.json(progress);
// });

// class OLTClient {
//     constructor() {
//         this.cookies = {};
//         this.client = axios.create({ 
//             validateStatus: () => true, 
//             maxRedirects: 0,
//             headers: {
//                 "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
//                 "Accept-Language": "en-US,en;q=0.9",
//                 "Connection": "keep-alive"
//             }
//         });
//     }
    
//     updateCookies(headers) {
//         if (headers['set-cookie']) {
//             headers['set-cookie'].forEach(c => {
//                 const cookieStr = c.split(';')[0];
//                 const eqIndex = cookieStr.indexOf('=');
//                 if(eqIndex > -1) {
//                     const key = cookieStr.substring(0, eqIndex);
//                     const val = cookieStr.substring(eqIndex + 1);
//                     this.cookies[key] = val;
//                 }
//             });
//         }
//     }
    
//     getCookieStr() {
//         return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
//     }

//     async get(url, headers = {}) {
//         const res = await this.client.get(url, { headers: { ...headers, 'Cookie': this.getCookieStr() } });
//         this.updateCookies(res.headers);
//         return res;
//     }

//     async post(url, data, headers = {}) {
//         const res = await this.client.post(url, new URLSearchParams(data).toString(), {
//             headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': this.getCookieStr(), ...headers }
//         });
//         this.updateCookies(res.headers);
//         return res;
//     }
// }

// function parseFullForm(html) {
//     const $ = cheerio.load(html);
//     const data = {};

//     $('input').each((i, el) => {
//         const name = $(el).attr('name');
//         if (!name) return;

//         const type = ($(el).attr('type') || 'text').toLowerCase();

//         if (['submit', 'button', 'reset', 'image'].includes(type)) return;
//         if (['checkbox', 'radio'].includes(type) && !$(el).is(':checked')) return;

//         data[name] = $(el).attr('value') || '';
//     });

//     $('select').each((i, el) => {
//         const name = $(el).attr('name');

//         if (name) {
//             data[name] =
//                 $(el).find('option[selected]').attr('value') ||$(el).find('option').first().attr('value') ||
//                 '';
//         }
//     });

//     return data;
// }

// function updateState(state, responseText) {
//     const pattern = /(?:^|\|)hiddenField\|([^|]*)\|([^|]*)/g;
//     let match;
//     while ((match = pattern.exec(responseText)) !== null) {
//         state[match[1]] = match[2];
//     }
// }

// async function dropdownPostback(client, state, field, value) {
//     const data = { ...state };
//     data[field] = value;
//     data['ctl00$ToolkitScriptManager1'] = `ctl00$UpdatePanel1|${field}`;
//     data['__EVENTTARGET'] = field;
//     data['__EVENTARGUMENT'] = '';
//     data['__LASTFOCUS'] = '';
//     data['__ASYNCPOST'] = 'true';

//     const headers = { 
//         'Cache-Control': 'no-cache', 
//         'X-MicrosoftAjax': 'Delta=true', 
//         'X-Requested-With': 'XMLHttpRequest', 
//         'Referer': ATTENDANCE_URL 
//     };
//     const res = await client.post(ATTENDANCE_URL, data, headers);
//     updateState(state, res.data);
//     state[field] = value;
//     return res.data;
// }

// function extractTableHtml(responseText) {
//     const TABLE_ID = "ctl00_Main_AttendanceReport_GridViewAttendanceMerged";
//     const marker = `id="${TABLE_ID}"`;
//     const position = responseText.indexOf(marker);
//     if (position < 0) return null;

//     const start = responseText.lastIndexOf("<table", position);
//     let end = responseText.indexOf("</table>", position);
//     if (start < 0 || end < 0) return null;
//     end += "</table>".length;

//     return responseText.substring(start, end);
// }

// // ------------------------------------------------------------
// // SUBJECT DROPDOWN HELPERS
// // The text shown in the OLT dropdown is not always identical to the
// // option "value" the server expects. We read the real options from the
// // page and match our subject names against them (case / spacing /
// // punctuation / singular-plural tolerant), so subjects like
// // "Information Systems for Managers" are posted with the right value.
// // ------------------------------------------------------------
// function getSubjectOptions(html) {
//     if (!html || typeof html !== 'string') return [];
//     try {
//         const $ = cheerio.load(html);
//         const options = [];
//         $('select').each((i, el) => {
//             const ident = $(el).attr('name') || $(el).attr('id') || '';
//             if (!/DropDownListSubjectName$/.test(ident)) return;
//             $(el).find('option').each((j, opt) => {
//                 const value = $(opt).attr('value');
//                 const text = $(opt).text().replace(/\s+/g, ' ').trim();
//                 if (value !== undefined && value !== '') options.push({ value, text });
//             });
//         });
//         return options;
//     } catch (e) {
//         return [];
//     }
// }

// const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// const looseName = (s) => normalizeName(s).replace(/s/g, ''); // tolerate system/systems etc.

// function resolveSubjectValue(subject, options) {
//     if (!options || options.length === 0) return subject;

//     const n = normalizeName(subject);
//     const l = looseName(subject);

//     let hit = options.find(o => normalizeName(o.text) === n || normalizeName(o.value) === n);
//     if (!hit) hit = options.find(o => looseName(o.text) === l || looseName(o.value) === l);
//     if (!hit) {
//         hit = options.find(o => {
//             const ot = looseName(o.text);
//             return ot.includes(l) || l.includes(ot);
//         });
//     }
//     return hit ? hit.value : subject;
// }

// // OLT option values can carry a trailing space (e.g. "Information Systems for Managers ").
// // Try the resolved value first, then trimmed / trailing-space variants.
// function subjectValueCandidates(resolved) {
//     const base = String(resolved);
//     const list = [base, base.trim(), base.trim() + ' '];
//     return list.filter((v, i) => list.indexOf(v) === i);
// }

// // Placeholder for a subject whose classes have not begun yet
// const NOT_STARTED_RESULT = () => ({
//     classes: [],
//     attended: 0,
//     total: 0,
//     percentage: null,
//     notStarted: true
// });

// function extractAttendance(html, rollNo) {
//     let tableHtml = extractTableHtml(html);
//     let $;
//     let table;
 
//     if (tableHtml) {
//         $ = cheerio.load(tableHtml);
//         table = $('table').first();
//     } else {
//         $ = cheerio.load(html);
//         table = $('#ctl00_Main_AttendanceReport_GridViewAttendanceMerged');
//     }
 
//     if (!table || !table.length) return null;
 
//     const rows = table.find('tr');
//     if (rows.length < 2) return null;
 
//     const headerCells = $(rows[0]).find('th');
//     const classes = [];
    
//     for (let i = 2; i < headerCells.length - 2; i++) {
//         const htmlContent = $(headerCells[i]).html() || '';
//         const $cell = cheerio.load(htmlContent);$cell('br').replaceWith('\n');
        
//         const parts = $cell.text().split('\n').map(s => s.trim()).filter(Boolean);
        
//         if (parts.length >= 3) {
//             classes.push({ class: parts[0], date: parts[1], time: parts[2] });
//         } else {
//             const fullText = $cell.text().replace(/\s+/g, ' ').trim();
//             const match = fullText.match(/(\d+)\s+(\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
//             if (match) {
//                 classes.push({ class: match[1], date: match[2], time: match[3] });
//             } else {
//                 classes.push({ class: fullText, date: '', time: '' });
//             }
//         }
//     }
 
//     // Table exists but has no class columns yet => classes haven't started.
//     if (classes.length === 0) return NOT_STARTED_RESULT();
 
//     let userRow = null;
//     for (let i = 1; i < rows.length; i++) {
//         const cells = $(rows[i]).find('td');
//         const currentRoll = $(cells[0]).text().replace(/\s+/g, ' ').trim();
//         if (currentRoll === rollNo.trim()) { 
//             userRow = cells; 
//             break; 
//         }
//     }
//     if (!userRow) return null;
 
//     // Row must have roll + name + one cell per class + attended + total
//     if (userRow.length < classes.length + 4) return NOT_STARTED_RESULT();
 
//     const attendanceValues = [];
//     for (let i = 2; i < userRow.length - 2; i++) {
//         const classInfo = classes[i - 2];
//         if (!classInfo) break;
//         const status = $(userRow[i]).text().replace(/\s+/g, ' ').trim();
//         attendanceValues.push({ ...classInfo, status });
//     }
 
//     const attended = parseInt($(userRow[userRow.length - 2]).text().trim(), 10) || 0;
//     const total = parseInt($(userRow[userRow.length - 1]).text().trim(), 10) || 0;
//     const percentage = total ? ((attended / total) * 100).toFixed(2) : null;
 
//     return { classes: attendanceValues, attended, total, percentage };
// }


// app.post('/api/attendance/fetch', authenticateUser, async (req, res) => {
//     const userId = req.user.id;
//     try {
//         const user = await User.findById(userId);
//         if (!user || !user.oltUsername || !user.oltPassword) {
//             return res.status(400).json({ error: 'No credentials saved' });
//         }
        
//         const username = user.oltUsername;
//         const section = user.defaultSection || 'A';
//         const term = req.body.term || user.defaultTerm || 'Term-II';
//         const subjects = TERMS[term] || TERMS["Term-II"];
//         const totalSteps = subjects.length + 2;

//         let password;
//         try {
//             const decrypted = decryptTextDetailed(user.oltPassword);
//             password = decrypted.plaintext;
//             if (decrypted.migrated) {
//                 User.findByIdAndUpdate(userId, { oltPassword: encryptText(password) }).catch(() => {});
//             }
//         } catch (err) {
//             setAttendanceProgress(userId, 0, 'Saved credentials could not be read.', 'error', totalSteps);
//             clearAttendanceProgressSoon(userId);
//             return res.status(400).json({
//                 error: 'Your saved OLT credentials could not be read. Please re-enter and save them again.',
//                 needsCredsReset: true
//             });
//         }

//         setAttendanceProgress(userId, 0, 'Connecting to OLT portal…', 'in_progress', totalSteps);

//         const client = new OLTClient();
//         const initial = await client.get(LOGIN_URL);
//         const state = parseFullForm(initial.data);

//         state['ctl00$Login1$LoginView1$UserName'] = username;
//         state['ctl00$Login1$LoginView1$Password'] = password;
//         state['ctl00$Login1$TextBoxIP'] = "";
//         state['ctl00$Login1$TextBoxOTP'] = "";
//         state['ctl00$ToolkitScriptManager1'] = `ctl00$UpdatePanel1|ctl00$Login1$LoginView1$ButtonLogin`;
//         state['__EVENTTARGET'] = 'ctl00$Login1$LoginView1$ButtonLogin';
//         state['__EVENTARGUMENT'] = '';
//         state['__LASTFOCUS'] = '';
//         state['__ASYNCPOST'] = 'true';

//         setAttendanceProgress(userId, 1, 'Verifying your credentials…', 'in_progress', totalSteps);
//         const loginRes = await client.post(LOGIN_URL, state, { 'X-MicrosoftAjax': 'Delta=true', 'Referer': LOGIN_URL });
//         const text = loginRes.data;

//         if (!text.includes('pageRedirect||')) {
//             setAttendanceProgress(userId, 0, 'Invalid OLT credentials.', 'error', totalSteps);
//             clearAttendanceProgressSoon(userId);
//             return res.status(400).json({ error: 'Invalid OLT Credentials' });
//         }

//         return await completeScrape(client, section, username, res, userId, term, subjects, totalSteps);
//     } catch (error) {
//         console.error(error);
//         setAttendanceProgress(userId, 0, 'Error connecting to OLT portal.', 'error', 8);
//         clearAttendanceProgressSoon(userId);
//         res.status(500).json({ error: 'Error connecting to OLT portal' });
//     }
// });


// async function completeScrape(client, section, username, res, userId, term, subjects, totalSteps) {
//     try {
//         setAttendanceProgress(userId, 2, 'Loading your attendance report…', 'in_progress', totalSteps);
//         const attendanceRes = await client.get(ATTENDANCE_URL, { 'Referer': LOGIN_URL });
//         const state = parseFullForm(attendanceRes.data);

//         // Keep the most recent HTML that still contains the subject dropdown
//         let subjectOptions = getSubjectOptions(attendanceRes.data);
        
//         const PROGRAM = "PGPM 2026-28", TERM_VAL = term;
//         if (state[PROGRAM_DROPDOWN] !== PROGRAM) {
//             const html = await dropdownPostback(client, state, PROGRAM_DROPDOWN, PROGRAM);
//             const opts = getSubjectOptions(html);
//             if (opts.length) subjectOptions = opts;
//         }
            
//         if (state[TERM_DROPDOWN] !== TERM_VAL) {
//             const html = await dropdownPostback(client, state, TERM_DROPDOWN, TERM_VAL);
//             const opts = getSubjectOptions(html);
//             if (opts.length) subjectOptions = opts;
//         }

//         console.log(`[Attendance] ${term} subject options:`, subjectOptions.map(o => `${o.text} => ${o.value}`));
 
//         const results = {};
//         for (let i = 0; i < subjects.length; i++) {
//             const subject = subjects[i];
//             setAttendanceProgress(userId, 2 + i, `Fetching ${subject} (${i + 1}/${subjects.length})…`, 'in_progress', totalSteps);

//             // Use the value the dropdown actually expects for this subject
//             const subjectValue = resolveSubjectValue(subject, subjectOptions);
//             if (subjectValue !== subject) {
//                 console.log(`[Attendance] "${subject}" resolved to dropdown value "${subjectValue}"`);
//             }
 
//             const candidates = subjectValueCandidates(subjectValue);

//             let attendanceData = null;
//             for (let attempt = 1; attempt <= candidates.length && !attendanceData; attempt++) {
//                 try {
//                     await dropdownPostback(client, state, SUBJECT_DROPDOWN, candidates[attempt - 1]);
//                     const sectionResHtml = await dropdownPostback(client, state, SECTION_DROPDOWN, section);
//                     attendanceData = extractAttendance(sectionResHtml, username);

//                     if (!attendanceData) {
//                         console.warn(`[Attendance] No data for "${subject}" (attempt ${attempt}, value=${JSON.stringify(candidates[attempt - 1])}). Response snippet: ${String(sectionResHtml).replace(/\s+/g, ' ').substring(0, 200)}`);
//                     }
//                 } catch (subjectErr) {
//                     console.error(`Subject fetch failed (${subject}, attempt ${attempt}):`, subjectErr.message);
//                 }
//             }
 
//             // Always include the subject; if nothing came back, mark as not started
//             results[subject] = attendanceData || NOT_STARTED_RESULT();
//         }
 
//         const hasAnyRecord = Object.values(results).some(sub => sub.total > 0);
//         setAttendanceProgress(
//             userId,
//             totalSteps,
//             hasAnyRecord ? 'Done!' : 'Finished, but no matching records were found.',
//             'done',
//             totalSteps
//         );
//         clearAttendanceProgressSoon(userId);
 
//         res.json({ success: true, results, section, term });
//     } catch (error) {
//         console.error("Scrape Error:", error);
//         setAttendanceProgress(userId, 0, 'Something went wrong while fetching attendance.', 'error', totalSteps);
//         clearAttendanceProgressSoon(userId);
//         res.status(500).json({ error: 'Failed to extract attendance data' });
//     }
// }


// // ============================================================
// // 4. EXCEL PARSING HELPER FUNCTIONS
// // ============================================================

// const getCellText = (cell) => {
//     if (!cell || cell.value === null || cell.value === undefined) return '';
//     if (typeof cell.value === 'object') {
//         if (cell.type === ExcelJS.ValueType.Date || cell.value instanceof Date) return cell.value.toISOString();
//         if (cell.value.richText) return cell.value.richText.map(rt => rt.text).join('');
//         if ('formula' in cell.value || 'sharedFormula' in cell.value) {
//             let res = cell.value.result;
//             if (res !== undefined && res !== null) {
//                 if (typeof res === 'object') {
//                     if (res.error) return res.error.toString();
//                     if (res instanceof Date) return res.toISOString();
//                     return JSON.stringify(res);
//                 }
//                 return res.toString();
//             }
//             return '';
//         }
//         if (cell.value.text) return cell.value.text.toString();
//         if (cell.value.error) return cell.value.error.toString();
//         try { return JSON.stringify(cell.value); } catch (e) { return ''; }
//     }
//     return cell.value.toString().trim();
// };

// const getCellColor = (cell) => {
//     if (!cell || !cell.fill) return null;
//     if (cell.fill.type === 'pattern' && cell.fill.fgColor) {
//         const argb = cell.fill.fgColor.argb;
//         if (argb && argb !== 'FFFFFFFF' && argb !== '00000000') {
//             if (argb.length === 8) return '#' + argb.substring(2);
//             if (argb.length === 6) return '#' + argb;
//         }
//     }
//     return null;
// };

// const colLetterToNumber = (letters) => {
//     let col = 0;
//     for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
//     return col;
// };

// const parseMergeRange = (rangeStr) => {
//     const [start, end] = rangeStr.split(':');
//     const m1 = start.match(/^([A-Z]+)(\d+)$/);
//     const m2 = (end || start).match(/^([A-Z]+)(\d+)$/);
//     if (!m1 || !m2) return null;
//     return {
//         startCol: colLetterToNumber(m1[1]),
//         startRow: parseInt(m1[2], 10),
//         endCol: colLetterToNumber(m2[1]),
//         endRow: parseInt(m2[2], 10),
//     };
// };

// // ============================================================
// // 5. CORE EXTRACTION LOGIC (TIMETABLE)
// // ============================================================

// const extractSectionData = (workbook, section) => {
//     let targetCol = null;
//     let sectionEndCol = null;
//     let targetSheet = null;
//     let headerRowIdx = -1;

//     const secRegex = new RegExp(`SECTION\\s*[-|]?\\s*${section.toUpperCase()}\\b`);

//     for (const sheet of workbook.worksheets) {
//         const merges = (sheet.model && sheet.model.merges) || [];
//         for (const rangeStr of merges) {
//             const range = parseMergeRange(rangeStr);
//             if (!range || range.startRow !== 1) continue;
//             const titleCell = sheet.getCell(range.startRow, range.startCol);
//             const text = getCellText(titleCell).toUpperCase().replace(/\s+/g, ' ');

//             if (secRegex.test(text)) {
//                 targetSheet = sheet;
//                 targetCol = range.startCol;
//                 sectionEndCol = range.endCol;
//                 break;
//             }
//         }
//         if (targetCol) break;
//     }

//     if (!targetCol) {
//         for (const sheet of workbook.worksheets) {
//             let sheetHeaderRowIdx = -1;
//             let dayDateCols = [];

//             sheet.eachRow((row, rowNumber) => {
//                 if (sheetHeaderRowIdx !== -1 && rowNumber > sheetHeaderRowIdx) return;
//                 row.eachCell((cell, colNumber) => {
//                     const text = getCellText(cell).toUpperCase().replace(/\s+/g, ' ');
//                     if (text.includes('DAY AND DATE') || text.includes('DAY & DATE')) {
//                         sheetHeaderRowIdx = rowNumber;
//                         dayDateCols.push(colNumber);
//                     }
//                 });
//             });

//             if (sheetHeaderRowIdx !== -1 && dayDateCols.length > 0) {
//                 dayDateCols.sort((a, b) => a - b);
//                 const secIdx = section.toUpperCase().charCodeAt(0) - 65;
//                 if (secIdx >= 0 && secIdx < dayDateCols.length) {
//                     targetCol = dayDateCols[secIdx];
//                     sectionEndCol = secIdx + 1 < dayDateCols.length ? dayDateCols[secIdx + 1] - 1 : targetCol + 9;
//                     targetSheet = sheet;
//                     headerRowIdx = sheetHeaderRowIdx;
//                     break;
//                 }
//             }
//         }
//     }

//     if (!targetCol || !targetSheet) return null;
//     const sheet = targetSheet;

//     if (headerRowIdx === -1) {
//         headerRowIdx = 2;
//         for (let r = 1; r <= 6; r++) {
//             const row = sheet.getRow(r);
//             let found = false;
//             for (let c = targetCol; c <= sectionEndCol; c++) {
//                 const text = getCellText(row.getCell(c)).toUpperCase().replace(/\s+/g, ' ');
//                 if (text.includes('DAY AND DATE') || text.includes('DAY & DATE')) {
//                     found = true;
//                     break;
//                 }
//             }
//             if (found) { headerRowIdx = r; break; }
//         }
//     }

//     let timeHeaderRowIdx = headerRowIdx;
//     const countTimes = (r) => {
//         if (!r) return 0;
//         let count = 0;
//         for (let c = targetCol + 1; c <= sectionEndCol; c++) {
//             const txt = getCellText(r.getCell(c)).toLowerCase();
//             if (txt.includes('am') || txt.includes('pm') || /\d{1,2}:\d{2}/.test(txt)) count++;
//         }
//         return count;
//     };

//     const r1 = sheet.getRow(headerRowIdx);
//     const r2 = sheet.getRow(headerRowIdx + 1);
//     const r3 = sheet.getRow(headerRowIdx + 2);

//     if (countTimes(r1) < 2) {
//         if (countTimes(r2) >= 2) timeHeaderRowIdx = headerRowIdx + 1;
//         else if (countTimes(r3) >= 2) timeHeaderRowIdx = headerRowIdx + 2;
//     }

//     const colsSpan = sectionEndCol - targetCol + 1;
//     const timeHeaders = [];
//     for (let c = 0; c < colsSpan; c++) {
//         let th = getCellText(sheet.getCell(timeHeaderRowIdx, targetCol + c));
//         if (!th) th = getCellText(sheet.getCell(headerRowIdx, targetCol + c));
//         timeHeaders.push(th);
//     }

//     const timetable = [];
//     let summaryStartIndex = -1;

//     sheet.eachRow((row, rowNumber) => {
//         if (rowNumber <= Math.max(headerRowIdx, timeHeaderRowIdx)) return;

//         if (summaryStartIndex === -1) {
//             const c1 = getCellText(row.getCell(1)).toLowerCase();
//             const c2 = getCellText(row.getCell(2)).toLowerCase();
//             const t1 = getCellText(row.getCell(targetCol)).toLowerCase();

//             if (c1.includes('course') || c2.includes('actual teaching') || c1.includes('actual teaching') ||
//                 t1.includes('course') || t1.includes('actual teaching')) {
//                 summaryStartIndex = rowNumber;
//             }
//         }

//         if (summaryStartIndex === -1) {
//             const dateStr = getCellText(row.getCell(targetCol)).trim();
//             if (!dateStr) return;

//             let isoDate = null;
//             let dayStrParsed = '';

//             const dayMatch = dateStr.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
//             const yearMatch = dateStr.match(/(202\d)/);
//             const dayExtract = dateStr.match(/\b(\d{1,2})\b/);
//             const monthExtract = dateStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);

//             if (yearMatch && dayExtract && monthExtract) {
//                 const dd = dayExtract[1].padStart(2, '0');
//                 const monthMap = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
//                 const mm = monthMap[monthExtract[1].toLowerCase()];
//                 const yyyy = yearMatch[1];
//                 isoDate = `${yyyy}-${mm}-${dd}`;
//                 if (dayMatch) dayStrParsed = dayMatch[1];
//             } else {
//                 const fallbackDate = new Date(dateStr);
//                 if (!isNaN(fallbackDate.getTime())) {
//                     isoDate = fallbackDate.toISOString().split('T')[0];
//                     dayStrParsed = fallbackDate.toLocaleDateString('en-US', { weekday: 'short' });
//                 }
//             }

//             if (isoDate) {
//                 const dayStr = getCellText(row.getCell(targetCol + 1));
//                 const dayEntry = { date: dateStr, day: dayStr || dayStrParsed || 'Day', isoDate, classes: [] };

//                 for (let c = 2; c < colsSpan; c++) {
//                     const cell = row.getCell(targetCol + c);
//                     const subjectStr = getCellText(cell);
//                     let slotTime = timeHeaders[c] ? timeHeaders[c].replace(/(\r\n|\n|\r)/gm, " ").trim() : 'Event';

//                     if (slotTime.toLowerCase() === 'remarks') slotTime = 'Remarks / Event';

//                     if (subjectStr !== '') {
//                         let subject = subjectStr;
//                         let prof = '';
//                         const bracketMatch = subjectStr.match(/(.*)\[(.*)\]/);
//                         if (bracketMatch) {
//                             subject = bracketMatch[1].trim();
//                             prof = bracketMatch[2].trim();
//                         }

//                         const bgColor = getCellColor(cell);
//                         let status = null;
//                         if (bgColor) {
//                             const lowerColor = bgColor.toLowerCase();
//                             if (lowerColor.includes('eb3223') || lowerColor.includes('ff0000')) status = 'Cancelled';
//                             else if (lowerColor.includes('00b0f0') || lowerColor.includes('00a2e8')) status = 'Make-up Session';
//                             else status = 'Special Event';
//                         }
//                         dayEntry.classes.push({ time: slotTime, subject, prof, raw: subjectStr, color: bgColor, status });
//                     }
//                 }
//                 if (dayEntry.classes.length > 0) timetable.push(dayEntry);
//             }
//         }
//     });

//     timetable.sort((a, b) => a.isoDate.localeCompare(b.isoDate));
//     const subjectSessionCounter = {};
//     timetable.forEach(dayEntry => {
//         dayEntry.classes.forEach(cls => {
//             const isRemark = cls.time && cls.time.toLowerCase().includes('remarks');
//             if (isRemark || !cls.subject) return;
//             if (cls.status === 'Cancelled') return;

//             const key = cls.subject.trim().toLowerCase();
//             subjectSessionCounter[key] = (subjectSessionCounter[key] || 0) + 1;
//             cls.sessionNumber = subjectSessionCounter[key];
//         });
//     });

//     const summaryData = { headers: [], rows: [] };
//     if (summaryStartIndex !== -1) {
//         let actualTeachingCol = -1;
//         let minDistance = 9999;

//         sheet.getRow(summaryStartIndex).eachCell((cell, colNum) => {
//             const cellText = getCellText(cell).toLowerCase();
//             if (cellText.includes('actual teaching')) {
//                 const dist = Math.abs(colNum - targetCol);
//                 if (dist < minDistance) { minDistance = dist; actualTeachingCol = colNum; }
//             }
//         });

//         if (actualTeachingCol !== -1) {
//             summaryData.headers = ['Course', 'Actual Teaching', 'Pre-Mid', 'Post-Mid', 'Guest Speaker', 'Total'];
//             sheet.eachRow((row, rowNumber) => {
//                 if (rowNumber > summaryStartIndex) {
//                     const course = getCellText(row.getCell(actualTeachingCol - 1));
//                     const actualTeaching = getCellText(row.getCell(actualTeachingCol));
//                     const preMid = getCellText(row.getCell(actualTeachingCol + 1));
//                     const postMid = getCellText(row.getCell(actualTeachingCol + 2));
//                     const guestSpeaker = getCellText(row.getCell(actualTeachingCol + 3));
//                     const total = getCellText(row.getCell(actualTeachingCol + 4));

//                     if (course && course.trim() !== '' && !course.toLowerCase().includes('class cancelled') && !course.toLowerCase().includes('make up session') && !course.toLowerCase().includes('course')) {
//                         summaryData.rows.push([course, actualTeaching, preMid, postMid, guestSpeaker, total]);
//                     }
//                 }
//             });
//         }
//     }

//     return { timetable, summary: summaryData };
// };

// // ============================================================
// // 6. SAFE RECURSIVE BACKGROUND POLLING (Fixes OOM & Latency)
// // ============================================================

// let globalCache = {};
// let lastFetchTime = 0;
// let isFetching = false;
// let activeFetchPromise = null;
// const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// const updateCache = async () => {
//     if (isFetching) return activeFetchPromise;
//     isFetching = true;

//     activeFetchPromise = (async () => {
//         let response = null;
//         let buffer = null;
//         let workbook = null;

//         try {
//             console.log("[Cache] Downloading Excel sheet...");
            
//             const bridgeUrl = "https://script.google.com/macros/s/AKfycbzqdMacopeFnXZmc9MgnN2cdTyZjIqCbMyDUQvx6VAMounnDswc88hmu5vOmhLZSmTfgw/exec";
//             response = await axios.get(bridgeUrl, { responseType: 'text' });
            
//             buffer = Buffer.from(response.data, 'base64');
            
//             // Explicit Memory Clean: Dump large base64 string from RAM immediately
//             response.data = null;
//             response = null;

//             workbook = new ExcelJS.Workbook();
//             await workbook.xlsx.load(buffer);
            
//             // Explicit Memory Clean: Dump buffer from RAM immediately after parsing
//             buffer = null;

//             const newCache = {};
//             for (const sec of ALL_SECTIONS) {
//                 const data = extractSectionData(workbook, sec);
//                 if (data) newCache[sec] = data;
//             }

//             // Explicit Memory Clean: Dump the massive workbook tree from RAM immediately
//             workbook = null;

//             globalCache = newCache;
//             lastFetchTime = Date.now();
//             console.log("[Cache] Update successful. Memory cleared.");
//             return globalCache;
//         } catch (error) {
//             console.error("[Cache Error] Failed to update:", error.message);
//             throw error;
//         } finally {
//             // Failsafe: Ensure heavy objects are forcefully dereferenced even if extraction crashes
//             response = null;
//             buffer = null;
//             workbook = null;
            
//             isFetching = false;
//             activeFetchPromise = null; 
//         }
//     })();

//     return activeFetchPromise;
// };

// // --- SAFE DAEMON: Never overlaps, completely safe from OOM ---
// const runBackgroundDaemon = async () => {
//     try {
//         await updateCache();
//     } catch (e) {
//         console.error("Daemon error:", e.message);
//     } finally {
//         // Wait strictly configured time AFTER the previous run finishes and memory is cleared
//         setTimeout(runBackgroundDaemon, CACHE_TTL_MS);
//     }
// };

// // --- REFACTORED ENDPOINT: ETag Caching for Massive Bandwidth Savings ---
// app.get('/api/timetable/:section', authenticateUser, async (req, res) => {
//     const section = req.params.section.toUpperCase();
//     const forceRefresh = req.query.force === 'true';

//     const buildMeta = () => ({
//         lastFetchTime,
//         nextRefreshTime: lastFetchTime + CACHE_TTL_MS,
//         cacheTTLMs: CACHE_TTL_MS
//     });

//     try {
//         // 1. If user forces a refresh via the Sync button
//         if (forceRefresh) {
//             await updateCache();
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         }

//         // 2. Return instantly from RAM, leveraging HTTP ETags to save Bandwidth
//         if (globalCache[section]) {
//             // Use lastFetchTime as a strict version identifier
//             const eTag = `W/"${lastFetchTime}"`;
//             res.setHeader('ETag', eTag);
            
//             // Let the browser confidently hold this data for 1 minute before even bothering the server again
//             res.setHeader('Cache-Control', 'public, max-age=60'); 

//             if (req.headers['if-none-match'] === eTag) {
//                 // Return 304 (Not Modified). This saves transferring the 100kb+ JSON payload entirely.
//                 return res.status(304).end();
//             }

//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         }

//         // 3. First boot only: If server just woke up and RAM is completely empty, user waits.
//         console.log(`[Cache] Empty memory. User must wait for initial download.`);
//         await updateCache();
        
//         if (globalCache[section]) {
//             const eTag = `W/"${lastFetchTime}"`;
//             res.setHeader('ETag', eTag);
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         } else {
//             return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
//         }

//     } catch (error) {
//         // Last-resort fallback to serve stale data if background update crashes during a boot
//         if (globalCache[section]) {
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         }
//         res.status(500).json({ error: 'Failed to fetch timetable data' });
//     }
// });

// // ============================================================
// // 8. SELF-PING
// // ============================================================

// const PORT = process.env.PORT || 5000;
// // Set this to your external production URL
// const PING_URL = process.env.PING_URL || `https://iimt-7iy6.onrender.com`;
// let pingCount = 0;

// const pingServer = async () => {
//     try {
//         let resp = await axios.get(PING_URL);
//         pingCount++;
//         console.log(`[Self-Ping] Count: ${pingCount} | Status: ${resp.data}`);
//     } catch (error) {
//         console.error(`[Self-Ping Error]:`, error.message);
//     }
// };

// const PING_INTERVAL_MS = 240000;

// app.listen(PORT, () => {
//     console.log(`Server running on port ${PORT}`);
    
//     // Starts the safe background parsing loop
//     runBackgroundDaemon();

//     // NEW: Starts the hourly McGraw Hill assignment watcher (emails on change)
//     startMheWatcher();
    
//     // Keeps the instance alive
//     setInterval(pingServer, PING_INTERVAL_MS);
// });



