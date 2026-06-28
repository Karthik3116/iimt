const express = require('express');
const cors = require('cors');
const axios = require('axios');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json()); 

// --- 1. MONGODB CONNECTION & SCHEMA ---
// Use environment variable for security in production
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

// --- 2. GOOGLE AUTH SETUP ---
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com'; 
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// --- 3. AUTHENTICATION ROUTE ---
app.post('/api/auth/google', async (req, res) => {
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

// --- 5. TIMETABLE API ---
app.get('/api/timetable/:section', async (req, res) => {
    try {
        const { section } = req.params;
        const response = await axios.get(SHEET_URL, { responseType: 'arraybuffer' });
        
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(response.data);
        
        let targetCol = null;
        let targetSheet = null;
        let headerRowIdx = -1;

        // TWO-PASS ROBUST SCANNER
        for (const sheet of workbook.worksheets) {
            
            // Pass 1: Explicit Section Title Targeting (Overcomes merged/crammed cells)
            sheet.eachRow((row, rowNum) => {
                if (targetCol) return;
                row.eachCell((cell, colNum) => {
                    if (targetCol) return;
                    const text = getCellText(cell).toUpperCase().replace(/\s+/g, ' ');
                    const secRegex = new RegExp(`SECTION\\s*[-|]?\\s*${section.toUpperCase()}\\b`);
                    
                    if (secRegex.test(text)) {
                        targetSheet = sheet;
                        // Is "Day and Date" jammed in the exact same cell?
                        if (text.includes('DAY AND DATE') || text.includes('DAY & DATE')) {
                            targetCol = colNum;
                            headerRowIdx = rowNum;
                        } else {
                            // Search the immediate rows below for the header
                            for (let r = rowNum; r <= Math.min(rowNum + 5, sheet.rowCount); r++) {
                                const sRow = sheet.getRow(r);
                                if (!sRow) continue;
                                for (let c = Math.max(1, colNum - 2); c <= colNum + 5; c++) {
                                    const sText = getCellText(sRow.getCell(c)).toUpperCase().replace(/\s+/g, ' ');
                                    if (sText.includes('DAY AND DATE') || sText.includes('DAY & DATE')) {
                                        targetCol = c;
                                        headerRowIdx = r;
                                        break;
                                    }
                                }
                                if (targetCol) break;
                            }
                        }
                    }
                });
            });

            // Pass 2: Sequential Fallback (If Section Titles were deleted/missing)
            if (!targetCol) {
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
                        targetSheet = sheet;
                        headerRowIdx = sheetHeaderRowIdx;
                    }
                }
            }
            if (targetCol) break; 
        }

        if (!targetCol || !targetSheet) return res.status(404).json({ error: `Section ${section} not found in ERP data.` });
        const sheet = targetSheet;

        // Find the exact row containing Time Slots dynamically
        let timeHeaderRowIdx = headerRowIdx;
        const r1 = sheet.getRow(headerRowIdx);
        const r2 = sheet.getRow(headerRowIdx + 1);
        const r3 = sheet.getRow(headerRowIdx + 2);
        
        const countTimes = (r) => {
            if (!r) return 0;
            let count = 0;
            for(let c = targetCol + 1; c <= targetCol + 10; c++) {
                const txt = getCellText(r.getCell(c)).toLowerCase();
                if (txt.includes('am') || txt.includes('pm') || txt.includes(':00') || txt.includes(':30')) count++;
            }
            return count;
        };

        if (countTimes(r1) < 2) {
            if (countTimes(r2) >= 2) timeHeaderRowIdx = headerRowIdx + 1;
            else if (countTimes(r3) >= 2) timeHeaderRowIdx = headerRowIdx + 2;
        }

        // Calculate Column Span Safely
        let colsSpan = 1;
        for (let c = targetCol + 1; c <= sheet.columnCount; c++) {
            const hText = getCellText(sheet.getCell(headerRowIdx, c)).toUpperCase().replace(/\s+/g, ' ');
            const tText = getCellText(sheet.getCell(timeHeaderRowIdx, c)).toUpperCase().replace(/\s+/g, ' ');
            
            // Stop parsing if we bleed into the next section
            if (hText.includes('DAY AND DATE') || hText.includes('DAY & DATE') || 
                tText.includes('DAY AND DATE') || tText.includes('DAY & DATE')) {
                break;
            }
            colsSpan++;
            if (colsSpan > 12) break; // Hard limit safeguard
        }

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

            // Summary Detection
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
                    const monthMap = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
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

        // Summary Extraction
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

        res.json({ timetable, summary: summaryData });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch timetable data' });
    }
});

// Render assigns the port dynamically using process.env.PORT
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));