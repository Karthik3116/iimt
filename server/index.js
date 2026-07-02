require("dotenv").config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

// Security middlewares
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');

const app = express();

// --- SECURITY MIDDLEWARE ---
// 1. Set security HTTP headers
app.use(helmet());

// 2. Restrict CORS (Update FRONTEND_URL in your .env, fallback to '*' for dev)
app.use(cors({
    origin: process.env.FRONTEND_URL || '*', 
    methods: ['GET', 'POST'],
    credentials: true
}));

// 3. Limit body payload to prevent payload-based DDoS
app.use(express.json({ limit: '15kb' }));

// --- EXPRESS 5 COMPATIBILITY FIX ---
// Express 5 makes req.query a read-only getter. Old security packages (xss-clean, 
// express-mongo-sanitize) try to mutate it directly, causing a crash. 
// This middleware unlocks it and makes it writable again before they run.
app.use((req, res, next) => {
    Object.defineProperty(req, 'query', {
        configurable: true,
        enumerable: true,
        writable: true,
        value: req.query
    });
    next();
});

// 4. Data Sanitization against NoSQL query injection
app.use(mongoSanitize()); 

// 5. Data Sanitization against XSS
app.use(xss()); 

// 6. Rate Limiting (Prevents Brute Force & API-level DDoS)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 150, // Limit each IP to 150 requests per `window`
    message: { error: "Too many requests from this IP, please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api', globalLimiter); // Apply to all /api routes

// Stricter rate limit for sensitive routes (Auth & Admin)
const strictLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 15, // Limit each IP to 15 login/admin attempts per hour
    message: { error: "Too many authorization attempts from this IP, please try again after an hour." }
});

// --- 1. MONGODB CONNECTION & SCHEMAS ---
const MONGO_URI = process.env.MONGO_URI;

console.log("Trying to connect with the DB...");
mongoose.connect(MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true, required: true },
    picture: String,
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const feedbackSchema = new mongoose.Schema({
    userEmail: String,
    userName: String,
    message: { type: String, maxlength: 1000 }, 
    createdAt: { type: Date, default: Date.now }
});
const Feedback = mongoose.model('Feedback', feedbackSchema);

// --- 2. GOOGLE AUTH SETUP ---
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

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
            user = new User({ name, email, picture });
            await user.save();
            console.log(`New user registered: ${email}`);
        }
        res.json({ message: 'Login successful', user });
    } catch (error) {
        console.error('Auth Error:', error);
        res.status(401).json({ error: 'Invalid or expired token' });
    }
});

app.post('/api/feedback', async (req, res) => {
    const { email, name, message } = req.body;
    if (!email || !message) return res.status(400).json({ error: "Missing required fields" });
    if (message.length > 1000) return res.status(400).json({ error: "Message too long." });
    
    try {
        const newFeedback = new Feedback({ userEmail: email, userName: name, message });
        await newFeedback.save();
        res.json({ success: true, message: "Feedback submitted successfully." });
    } catch (error) {
        console.error("Feedback Error:", error);
        res.status(500).json({ error: "Server error saving feedback." });
    }
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
app.post('/api/admin/feedbacks', strictLimiter, async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Unauthorized. Incorrect password." });
    }
    try {
        const feedbacks = await Feedback.find().sort({ createdAt: -1 });
        res.json({ success: true, feedbacks });
    } catch (error) {
        res.status(500).json({ error: "Server error fetching feedbacks." });
    }
});

// --- 4. EXCEL PARSING HELPER FUNCTIONS ---
const SHEET_URL = 'https://docs.google.com/spreadsheets/d/17ZoeBXiOHRXK-zni4rUy41syf_dDk72f/export?format=xlsx&gid=55414638';

const getCellText = (cell) => {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    if (typeof cell.value === 'object') {
        if (cell.type === ExcelJS.ValueType.Date || cell.value instanceof Date) {
            return cell.value.toISOString();
        }
        if (cell.value.richText) {
            return cell.value.richText.map(rt => rt.text).join('');
        }
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
    for (let i = 0; i < letters.length; i++) {
        col = col * 26 + (letters.charCodeAt(i) - 64);
    }
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

// --- 5. CORE EXTRACTION LOGIC ---
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
            if (found) {
                headerRowIdx = r;
                break;
            }
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

            if (c1.includes('sessions') || c2.includes('credits') || c1 === '20' || c1.includes('actual teaching') ||
                t1.includes('sessions') || t1.includes('credits') || t1 === '20' || t1.includes('actual teaching')) {
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

    const summaryData = { headers: [], rows: [] };
    if (summaryStartIndex !== -1) {
        let actualTeachingCol = -1;
        let minDistance = 9999;

        sheet.getRow(summaryStartIndex).eachCell((cell, colNum) => {
            const cellText = getCellText(cell).toLowerCase();
            if (cellText.includes('actual teaching')) {
                const dist = Math.abs(colNum - targetCol);
                if (dist < minDistance) {
                    minDistance = dist;
                    actualTeachingCol = colNum;
                }
            }
        });

        if (actualTeachingCol !== -1) {
            summaryData.headers = ['Subject', 'Credits', 'Sessions', 'Actual Teaching', 'Pre-Mid', 'Post-Mid', 'Guest Speaker', 'Total'];

            sheet.eachRow((row, rowNumber) => {
                if (rowNumber > summaryStartIndex) {
                    const sessions = getCellText(row.getCell(1));
                    const credits = getCellText(row.getCell(2));
                    const subject = getCellText(row.getCell(actualTeachingCol - 1)); 
                    const actualTeaching = getCellText(row.getCell(actualTeachingCol));
                    const preMid = getCellText(row.getCell(actualTeachingCol + 1));
                    const postMid = getCellText(row.getCell(actualTeachingCol + 2));
                    const guestSpeaker = getCellText(row.getCell(actualTeachingCol + 3));
                    const total = getCellText(row.getCell(actualTeachingCol + 4));

                    if (subject && subject.trim() !== '' && !subject.toLowerCase().includes('class cancelled') && !subject.toLowerCase().includes('make up session')) {
                        summaryData.rows.push([subject, credits, sessions, actualTeaching, preMid, postMid, guestSpeaker, total]);
                    }
                }
            });
        }
    }

    return { timetable, summary: summaryData };
};


// --- 6. BACKGROUND POLLING & IN-MEMORY CACHE ---
let globalCache = {};
let lastFetchTime = 0;
let isFetching = false;
let activeFetchPromise = null;

const CACHE_TTL_MS = 5 * 60 * 1000; 
const ALL_SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const updateCache = async () => {
    if (isFetching) return activeFetchPromise;
    isFetching = true;

    activeFetchPromise = (async () => {
        try {
            console.log("[Cache] Downloading and parsing Excel sheet...");
            const response = await axios.get(SHEET_URL, { responseType: 'arraybuffer' });
            
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.load(response.data);
            
            const newCache = {};
            
            for (const sec of ALL_SECTIONS) {
                const data = extractSectionData(workbook, sec);
                if (data) newCache[sec] = data;
            }

            globalCache = newCache;
            lastFetchTime = Date.now();
            console.log("[Cache] Successfully updated all sections in memory.");
            return globalCache;

        } catch (error) {
            console.error("[Cache Error] Failed to fetch or parse Excel data:", error);
            throw error;
        } finally {
            isFetching = false;
        }
    })();

    return activeFetchPromise;
};


// --- 7. TIMETABLE API ---
app.get('/api/timetable/:section', async (req, res) => {
    const section = req.params.section.toUpperCase();
    const forceRefresh = req.query.force === 'true';

    try {
        if (!forceRefresh && globalCache[section] && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
            return res.json(globalCache[section]);
        }
        await updateCache();
        if (globalCache[section]) {
            return res.json(globalCache[section]);
        } else {
            return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
        }
    } catch (error) {
        if (globalCache[section]) {
            console.log(`[Fallback] Served stale cache for Section ${section} due to network error.`);
            return res.json(globalCache[section]);
        }
        res.status(500).json({ error: 'Failed to fetch timetable data' });
    }
});


// --- 8. SELF-PING & DAEMON ---
const PING_URL = "https://iimt-7iy6.onrender.com";
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

const PING_INTERVAL_MS = 240000; // 4 mins
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    updateCache().catch(console.error);
    setInterval(updateCache, CACHE_TTL_MS); 
    setInterval(pingServer, PING_INTERVAL_MS); 
});