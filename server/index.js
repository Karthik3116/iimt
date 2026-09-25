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
const { google } = require('googleapis'); // Added for Google Drive API

// Security middlewares
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const app = express();

// --- SECURITY MIDDLEWARE ---

// Fix for express-rate-limit X-Forwarded-For warning behind proxies (like Render)
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
    defaultTerm: { type: String, enum: ['Term-I', 'Term-II'], default: 'Term-II' }, // Added Term Preference
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

// --- NEW: ANALYTICS & TRAFFIC SCHEMAS ---
const trafficLogSchema = new mongoose.Schema({
    endpoint: String,
    method: String,
    timestamp: { type: Date, default: Date.now, expires: '30d' } // Auto-delete after 30 days
});
const TrafficLog = mongoose.model('TrafficLog', trafficLogSchema);

const analyticsEventSchema = new mongoose.Schema({
    userEmail: String,
    eventType: String, // e.g., 'click', 'view', 'action', 'auth'
    eventName: String, // e.g., 'tab_attendance', 'btn_sync', 'login'
    metadata: mongoose.Schema.Types.Mixed,
    timestamp: { type: Date, default: Date.now, expires: '90d' } // Auto-delete after 90 days
});
const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// --- ENCRYPTION LOGIC FOR CREDENTIALS ---
const ALGORITHM = 'aes-256-cbc';

const CANDIDATE_SECRETS = [
    process.env.JWT_SECRET || 'iimtrichy_fallback_secret',
    'iimtrichy_fallback_secret',
].filter((v, i, arr) => v && arr.indexOf(v) === i); // dedupe + drop falsy

const CANDIDATE_KEYS = CANDIDATE_SECRETS.map(secret => crypto.scryptSync(secret, 'salt', 32));
const ENCRYPTION_KEY = CANDIDATE_KEYS[0]; // primary key: used for all new/re- encryption

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
            { returnDocument: 'after' } // FIXED deprecation warning
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
            { returnDocument: 'after' } // FIXED deprecation warning
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
                { upsert: true, returnDocument: 'after' } // Already using the right parameter here
            );
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Error saving todos:", error);
        res.status(500).json({ error: "Server error saving tasks." });
    }
});


// ============================================================
// OLT SCRAPING ENGINE (Fully replicating the Python logic)
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
        "Business Ethics", //
        "Corporate Finance", //
        "Information Systems for Managers", //
        "Macro Economics for Managers", //
        "Macro Organizational Behaviour", //
        "Marketing Management-II", //
        "Operations Research for Managers", //
        "The Entrepreneurial Manager" //
    ]
};

// ============================================================
// ATTENDANCE FETCH PROGRESS TRACKING (in-memory, per-user)
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
        
        const PROGRAM = "PGPM 2026-28", TERM_VAL = term;
        if (state['ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName'] !== PROGRAM) {
            await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName', PROGRAM);
        }
            
        if (state['ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo'] !== TERM_VAL) {
            await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo', TERM_VAL);
        }

        const results = {};
        for (let i = 0; i < subjects.length; i++) {
            const subject = subjects[i];
            setAttendanceProgress(userId, 2 + i, `Fetching ${subject} (${i + 1}/${subjects.length})…`, 'in_progress', totalSteps);

            await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSubjectName', subject);
            const sectionResHtml = await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSection', section);
            
            const attendanceData = extractAttendance(sectionResHtml, username);
            if (attendanceData) {
                results[subject] = attendanceData;
            }
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
// 6. BACKGROUND POLLING & IN-MEMORY CACHE
// ============================================================

let globalCache = {};
let lastFetchTime = 0;
let isFetching = false;
let activeFetchPromise = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

const updateCache = async () => {
    if (isFetching) return activeFetchPromise;
    isFetching = true;

    activeFetchPromise = (async () => {
        try {
            console.log("[Cache] Downloading Term-II Excel sheet via Apps Script Bridge...");
            
            const bridgeUrl = "https://script.google.com/macros/s/AKfycbzqdMacopeFnXZmc9MgnN2cdTyZjIqCbMyDUQvx6VAMounnDswc88hmu5vOmhLZSmTfgw/exec";
            const response = await axios.get(bridgeUrl, { responseType: 'text' });
            
            const buffer = Buffer.from(response.data, 'base64');

            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(buffer);

            const newCache = {};
            for (const sec of ALL_SECTIONS) {
                const data = extractSectionData(workbook, sec);
                if (data) newCache[sec] = data;
            }

            globalCache = newCache;
            lastFetchTime = Date.now();
            console.log("[Cache] Successfully updated all Term-II sections in memory.");
            return globalCache;
        } catch (error) {
            console.error("[Cache Error] Failed to fetch or parse Excel data from Bridge:", error.message);
            throw error;
        } finally {
            isFetching = false;
        }
    })();

    return activeFetchPromise;
};

app.get('/api/timetable/:section', authenticateUser, async (req, res) => {
    const section = req.params.section.toUpperCase();
    const forceRefresh = req.query.force === 'true';

    const buildMeta = () => ({
        lastFetchTime,
        nextRefreshTime: lastFetchTime + CACHE_TTL_MS,
        cacheTTLMs: CACHE_TTL_MS
    });

    try {
        if (!forceRefresh && globalCache[section] && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
            return res.json({ ...globalCache[section], meta: buildMeta() });
        }
        await updateCache(); // Triggers on-demand parsing instead of continuous background parsing
        if (globalCache[section]) {
            return res.json({ ...globalCache[section], meta: buildMeta() });
        } else {
            return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
        }
    } catch (error) {
        if (globalCache[section]) {
            console.log(`[Fallback] Served stale cache for Section ${section} due to network error.`);
            return res.json({ ...globalCache[section], meta: buildMeta() });
        }
        res.status(500).json({ error: 'Failed to fetch timetable data' });
    }
});

// ============================================================
// 8. SELF-PING & DAEMON
// ============================================================

const PORT = process.env.PORT || 5000;
// Set this to your external production URL (e.g., https://your-app.onrender.com)
// to ensure external traffic keeps the instance awake.
const PING_URL = process.env.PING_URL || `https://iimt-backend.onrender.com`;
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
    
    // 1. Initialize cache once on startup
    updateCache().catch(console.error);
    
    // ❌ REMOVED: setInterval(updateCache, CACHE_TTL_MS);
    // Caching is now lazy/on-demand via the /api/timetable endpoint to prevent OOM crashes.

    // 2. Keep the instance awake using external public URL ping
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
// const { google } = require('googleapis'); // Added for Google Drive API

// // Security middlewares
// const helmet = require('helmet');
// const rateLimit = require('express-rate-limit');
// const mongoSanitize = require('express-mongo-sanitize');
// const xss = require('xss-clean');

// const app = express();

// // --- SECURITY MIDDLEWARE ---

// // Fix for express-rate-limit X-Forwarded-For warning behind proxies (like Render)
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
//     defaultTerm: { type: String, enum: ['Term-I', 'Term-II'], default: 'Term-II' }, // Added Term Preference
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
//     timestamp: { type: Date, default: Date.now, expires: '30d' } // Auto-delete after 30 days
// });
// const TrafficLog = mongoose.model('TrafficLog', trafficLogSchema);

// const analyticsEventSchema = new mongoose.Schema({
//     userEmail: String,
//     eventType: String, // e.g., 'click', 'view', 'action', 'auth'
//     eventName: String, // e.g., 'tab_attendance', 'btn_sync', 'login'
//     metadata: mongoose.Schema.Types.Mixed,
//     timestamp: { type: Date, default: Date.now, expires: '90d' } // Auto-delete after 90 days
// });
// const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

// // --- ENCRYPTION LOGIC FOR CREDENTIALS ---
// const ALGORITHM = 'aes-256-cbc';

// const CANDIDATE_SECRETS = [
//     process.env.JWT_SECRET || 'iimtrichy_fallback_secret',
//     'iimtrichy_fallback_secret',
// ].filter((v, i, arr) => v && arr.indexOf(v) === i); // dedupe + drop falsy

// const CANDIDATE_KEYS = CANDIDATE_SECRETS.map(secret => crypto.scryptSync(secret, 'salt', 32));
// const ENCRYPTION_KEY = CANDIDATE_KEYS[0]; // primary key: used for all new/re- encryption

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
//             { returnDocument: 'after' } // FIXED deprecation warning
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
//             { returnDocument: 'after' } // FIXED deprecation warning
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
//                 { upsert: true, returnDocument: 'after' } // Already using the right parameter here
//             );
//         }
//         res.json({ success: true });
//     } catch (error) {
//         console.error("Error saving todos:", error);
//         res.status(500).json({ error: "Server error saving tasks." });
//     }
// });


// // ============================================================
// // OLT SCRAPING ENGINE (Fully replicating the Python logic)
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
//         "Business Ethics", //
//         "Corporate Finance", //
//         "Information Systems for Managers", //
//         "Macro Economics for Managers", //
//         "Macro Organizational Behaviour", //
//         "Marketing Management-II", //
//         "Operations Research for Managers", //
//         "The Entrepreneurial Manager" //
//     ]
// };

// // ============================================================
// // ATTENDANCE FETCH PROGRESS TRACKING (in-memory, per-user)
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
        
//         const PROGRAM = "PGPM 2026-28", TERM_VAL = term;
//         if (state['ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName'] !== PROGRAM) {
//             await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListProgramName', PROGRAM);
//         }
            
//         if (state['ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo'] !== TERM_VAL) {
//             await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListTermNo', TERM_VAL);
//         }

//         const results = {};
//         for (let i = 0; i < subjects.length; i++) {
//             const subject = subjects[i];
//             setAttendanceProgress(userId, 2 + i, `Fetching ${subject} (${i + 1}/${subjects.length})…`, 'in_progress', totalSteps);

//             await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSubjectName', subject);
//             const sectionResHtml = await dropdownPostback(client, state, 'ctl00$Main$AttendanceReport$ProgTermSubSec1$DropDownListSection', section);
            
//             const attendanceData = extractAttendance(sectionResHtml, username);
//             if (attendanceData) {
//                 results[subject] = attendanceData;
//             }
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
// // 6. BACKGROUND POLLING & IN-MEMORY CACHE
// // ============================================================

// let globalCache = {};
// let lastFetchTime = 0;
// let isFetching = false;
// let activeFetchPromise = null;
// const CACHE_TTL_MS = 5 * 60 * 1000;

// const updateCache = async () => {
//     if (isFetching) return activeFetchPromise;
//     isFetching = true;

//     activeFetchPromise = (async () => {
//         try {
//             console.log("[Cache] Downloading Term-II Excel sheet via Apps Script Bridge...");
            
//             const bridgeUrl = "https://script.google.com/macros/s/AKfycbzqdMacopeFnXZmc9MgnN2cdTyZjIqCbMyDUQvx6VAMounnDswc88hmu5vOmhLZSmTfgw/exec";
//             const response = await axios.get(bridgeUrl, { responseType: 'text' });
            
//             const buffer = Buffer.from(response.data, 'base64');

//             const workbook = new ExcelJS.Workbook();
//             await workbook.xlsx.load(buffer);

//             const newCache = {};
//             for (const sec of ALL_SECTIONS) {
//                 const data = extractSectionData(workbook, sec);
//                 if (data) newCache[sec] = data;
//             }

//             globalCache = newCache;
//             lastFetchTime = Date.now();
//             console.log("[Cache] Successfully updated all Term-II sections in memory.");
//             return globalCache;
//         } catch (error) {
//             console.error("[Cache Error] Failed to fetch or parse Excel data from Bridge:", error.message);
//             throw error;
//         } finally {
//             isFetching = false;
//         }
//     })();

//     return activeFetchPromise;
// };

// app.get('/api/timetable/:section', authenticateUser, async (req, res) => {
//     const section = req.params.section.toUpperCase();
//     const forceRefresh = req.query.force === 'true';

//     const buildMeta = () => ({
//         lastFetchTime,
//         nextRefreshTime: lastFetchTime + CACHE_TTL_MS,
//         cacheTTLMs: CACHE_TTL_MS
//     });

//     try {
//         if (!forceRefresh && globalCache[section] && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         }
//         await updateCache();
//         if (globalCache[section]) {
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         } else {
//             return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
//         }
//     } catch (error) {
//         if (globalCache[section]) {
//             console.log(`[Fallback] Served stale cache for Section ${section} due to network error.`);
//             return res.json({ ...globalCache[section], meta: buildMeta() });
//         }
//         res.status(500).json({ error: 'Failed to fetch timetable data' });
//     }
// });

// // ============================================================
// // 8. SELF-PING & DAEMON
// // ============================================================

// const PORT = process.env.PORT || 5000;
// // FIX: Force explicitly binding loopback IPv4 instead of 'localhost' to prevent Node.js 18+ from 
// // resolving to ::1 (IPv6) which leads to ECONNREFUSED errors.
// const PING_URL = process.env.PING_URL || `http://127.0.0.1:${PORT}`;
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
//     updateCache().catch(console.error);
//     setInterval(updateCache, CACHE_TTL_MS);
//     setInterval(pingServer, PING_INTERVAL_MS);
// });
