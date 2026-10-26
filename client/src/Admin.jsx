import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  Lock, LayoutDashboard, Activity, Users, TrendingUp, CheckCircle2,
  MessageSquare, LogOut, Loader2, X, Calendar, Clock, Search, BarChart3,
  AlertCircle, ArrowUpRight, ArrowDownRight, Zap, Radio, Mail, Hexagon, Brain,
  Sparkles, Flame, Target, Layers, RefreshCw, Send, Play, ShieldAlert, GitBranch,
  Moon, Sun, UserPlus, Repeat
} from 'lucide-react';

const API_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE_URL) ||
  (typeof process !== 'undefined' && process.env && process.env.REACT_APP_API_BASE_URL) ||
  'http://localhost:5000';

/* ============================================================================
   1. SMALL HELPERS
============================================================================ */
const IST_MS = 5.5 * 3600 * 1000;
const DAY_MS = 86400000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const median = (a) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sum = (a) => a.reduce((s, x) => s + x, 0);
const lerp = (a, b, t) => a + (b - a) * t;

const istDate = (sec) => new Date(sec * 1000 + IST_MS); // read with getUTC*()
const dayKeyOfMs = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);
const wdOfKey = (key) => new Date(key + 'T00:00:00Z').getUTCDay();
const dayStartSec = (key) => (Date.parse(key + 'T00:00:00Z') - IST_MS) / 1000;

const fmtNum = (n) => Number(n || 0).toLocaleString('en-IN');
const fmtPct = (n, d = 0) => `${(n || 0).toFixed(d)}%`;
const fmtHour = (h) => {
  const s = ((h % 24) + 24) % 24;
  return `${s % 12 === 0 ? 12 : s % 12} ${s >= 12 ? 'PM' : 'AM'}`;
};
const fmtDay = (key) => new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtDayLong = (key) => new Date(key + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtDur = (sec) => (sec < 60 ? `${Math.max(1, Math.round(sec))}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${(sec / 3600).toFixed(1)}h`);
const fmtClock = (sec) => {
  const d = istDate(sec);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const prettyName = (n) => String(n || '').replace(/^tab[_-]?/i, '').replace(/[_-]+/g, ' ').trim() || 'unknown';
const cap = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
const timeAgo = (date) => {
  if (!date) return 'Never';
  const s = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};
const initials = (name) => String(name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const pctDelta = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);

const SEGMENTS = {
  Champions: { color: '#2FBF71', desc: 'Daily, deep, multi-session users: the core of the platform.' },
  Regulars: { color: '#4C8DF6', desc: 'Steady weekly users with healthy session depth.' },
  Casual: { color: '#F5A524', desc: 'Occasional, usually single-purpose visits.' },
  Drifting: { color: '#F2542D', desc: 'Used to show up, but activity has faded.' },
  Dormant: { color: '#A3B1AE', desc: 'Registered, but no activity in this window.' }
};
const SEV = {
  alert: { color: '#F2542D', label: 'Alert', rank: 0 },
  warn: { color: '#F5A524', label: 'Watch', rank: 1 },
  good: { color: '#2FBF71', label: 'Positive', rank: 2 },
  info: { color: '#4C8DF6', label: 'Insight', rank: 3 }
};

/* colour ramp used by the heat-maps (pale mint -> lime -> amber -> red) */
const HEAT_STOPS = [[0, '#E3F2EA'], [0.4, '#A5E26B'], [0.7, '#F7B538'], [1, '#F2542D']];
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const heatColor = (v) => {
  const t = Math.sqrt(clamp(v, 0, 1));
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    if (t <= HEAT_STOPS[i][0]) {
      const [t0, c0] = HEAT_STOPS[i - 1], [t1, c1] = HEAT_STOPS[i];
      const k = (t - t0) / (t1 - t0 || 1);
      const a = hexRgb(c0), b = hexRgb(c1);
      return `rgb(${a.map((x, j) => Math.round(lerp(x, b[j], k))).join(',')})`;
    }
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
};
const EMPTY_CELL = '#EAF0EE';

/* smooth (Catmull-Rom -> cubic bezier) path through points */
function curve(pts, move = true, yMin = -Infinity, yMax = Infinity) {
  if (!pts.length) return '';
  const cy = (y) => Math.min(yMax, Math.max(yMin, y));
  let d = `${move ? 'M' : 'L'}${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = cy(p1[1] + (p2[1] - p0[1]) / 6);
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = cy(p2[1] - (p3[1] - p1[1]) / 6);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/* ============================================================================
   2. THE PATTERN ENGINE
   Pure statistics that run in the browser (no external AI service):
   sessionisation, seasonal-trend forecasting, robust anomaly detection (MAD),
   k-means user segmentation, churn-risk scoring, Markov journey model,
   association lift, cohort retention, lexicon sentiment.
============================================================================ */
function linreg(y) {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: y[0] || 0, r2: 0 };
  const xm = (n - 1) / 2;
  const ym = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xm, dy = y[i] - ym;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, intercept: ym - slope * xm, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

function seasonIndex(series, keys) {
  const sums = new Array(7).fill(0), cnt = new Array(7).fill(0);
  series.forEach((v, i) => { const wd = wdOfKey(keys[i]); sums[wd] += v; cnt[wd]++; });
  const overall = mean(series) || 1;
  return sums.map((s, wd) => {
    if (!cnt[wd]) return 1;
    const raw = s / cnt[wd] / overall;
    const w = Math.min(1, cnt[wd] / 3); // shrink towards 1 when we have few samples
    return Math.max(0.25, 1 + (raw - 1) * w);
  });
}

function kmeans(points, k, iters = 30) {
  const order = points.map((p, i) => ({ i, s: sum(p) })).sort((a, b) => a.s - b.s);
  let cents = [];
  for (let j = 0; j < k; j++) {
    const q = Math.floor(((j + 0.5) / k) * order.length);
    cents.push([...points[order[Math.min(q, order.length - 1)].i]]);
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    points.forEach((p, i) => {
      let best = 0, bd = Infinity;
      cents.forEach((c, j) => {
        let d = 0;
        for (let x = 0; x < p.length; x++) d += (p[x] - c[x]) ** 2;
        if (d < bd) { bd = d; best = j; }
      });
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    });
    cents = cents.map((c, j) => {
      const members = points.filter((_, i) => assign[i] === j);
      if (!members.length) return c;
      return c.map((_, x) => mean(members.map((m) => m[x])));
    });
    if (!moved) break;
  }
  return { assign, cents };
}

const DAYPARTS = [
  { k: 'Night owl', icon: 'moon', hours: [22, 23, 0, 1, 2, 3, 4] },
  { k: 'Early bird', icon: 'sun', hours: [5, 6, 7, 8, 9, 10] },
  { k: 'Afternoon', icon: 'sun', hours: [11, 12, 13, 14, 15, 16] },
  { k: 'Evening', icon: 'moon', hours: [17, 18, 19, 20, 21] }
];
const daypartOf = (hist) => {
  const scored = DAYPARTS.map((d) => ({ ...d, v: sum(d.hours.map((h) => hist[h])) }));
  scored.sort((a, b) => b.v - a.v);
  return scored[0].v ? scored[0].k : null;
};

const POS_WORDS = ['good', 'great', 'love', 'awesome', 'nice', 'helpful', 'useful', 'amazing', 'excellent', 'best', 'easy', 'fast', 'thanks', 'thank', 'perfect', 'cool', 'smooth', 'clean', 'works', 'super', 'handy'];
const NEG_WORDS = ['bad', 'slow', 'bug', 'bugs', 'broken', 'crash', 'error', 'issue', 'issues', 'problem', 'problems', 'hate', 'worst', 'confusing', 'difficult', 'lag', 'laggy', 'fail', 'failed', 'wrong', 'missing', 'stuck', 'cant', 'unable', 'doesnt', 'hard', 'incorrect', 'not'];
const STOP = new Set('the a an and or but to of in on for with is are was were be been it this that i we you my our your me can could would should will just also very too so at as by from have has had do does did not no yes if then than there their its it\'s im ive please app website site'.split(' '));

function analyzeFeedback(feedbacks) {
  const items = (feedbacks || []).map((f) => {
    const words = String(f.message || '').toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
    const clean = words.map((w) => w.replace(/'/g, ''));
    const pos = clean.filter((w) => POS_WORDS.includes(w)).length;
    const neg = clean.filter((w) => NEG_WORDS.includes(w) && w !== 'not').length + (clean.includes('not') && clean.some((w) => ['working', 'loading', 'opening', 'showing', 'updating'].includes(w)) ? 1 : 0);
    const score = pos - neg;
    return { ...f, score, sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral', words: clean };
  });
  const counts = new Map();
  items.forEach((it) => new Set(it.words).forEach((w) => {
    if (w.length > 3 && !STOP.has(w) && !POS_WORDS.includes(w)) counts.set(w, (counts.get(w) || 0) + 1);
  }));
  const topics = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word, count]) => ({ word, count }));
  return {
    items,
    pos: items.filter((i) => i.sentiment === 'positive').length,
    neg: items.filter((i) => i.sentiment === 'negative').length,
    neu: items.filter((i) => i.sentiment === 'neutral').length,
    topics
  };
}

function analyze(ins, dbUsers, feedbacks) {
  const N = ins.days || 30;
  const nowMs = Date.now();
  const dayKeys = [];
  for (let i = N - 1; i >= 0; i--) dayKeys.push(dayKeyOfMs(nowMs - i * DAY_MS));
  const dayIdx = new Map(dayKeys.map((k, i) => [k, i]));
  const todayI = N - 1;
  const complete = N - 1; // today is partial, so models train on days 0..N-2

  const nameMeta = (ins.names || []).map((s) => {
    const p = String(s).split('|');
    const type = p[0];
    const name = p.slice(1).join('|');
    return { type, name, label: prettyName(name), key: s };
  });
  const isAuth = (n) => nameMeta[n] && nameMeta[n].type === 'auth';
  const isSignup = (n) => nameMeta[n] && nameMeta[n].name === 'new_signup';
  const userInfo = new Map((dbUsers || []).map((u) => [u.email, u]));

  const evPerDay = new Array(N).fill(0);
  const dauSets = Array.from({ length: N }, () => new Set());
  const signups = new Array(N).fill(0);
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const hourTotals = new Array(24).fill(0);
  const dayHour = Array.from({ length: N }, () => new Array(24).fill(0));
  const featureStats = new Map();
  const userMap = new Map();

  for (const [t, u, n] of ins.events || []) {
    const email = ins.users[u];
    const meta = nameMeta[n];
    if (!meta) continue;
    const d = istDate(t);
    const di = dayIdx.get(d.toISOString().slice(0, 10));
    if (di === undefined) continue;
    const h = d.getUTCHours();
    evPerDay[di]++;
    dauSets[di].add(email);
    grid[d.getUTCDay()][h]++;
    hourTotals[h]++;
    dayHour[di][h]++;
    if (isSignup(n)) signups[di]++;
    if (!isAuth(n)) {
      const fs = featureStats.get(n) || { n, count: 0, users: new Set() };
      fs.count++; fs.users.add(email);
      featureStats.set(n, fs);
    }
    let us = userMap.get(email);
    if (!us) {
      us = { email, events: 0, hist: new Array(24).fill(0), dayCounts: new Array(N).fill(0), names: new Map(), evs: [], first: t, last: t };
      userMap.set(email, us);
    }
    us.events++; us.hist[h]++; us.dayCounts[di]++; us.last = t;
    us.evs.push([t, n]);
    if (!isAuth(n)) us.names.set(n, (us.names.get(n) || 0) + 1);
  }
  const dau = dauSets.map((s) => s.size);
  const totalEvents = sum(evPerDay);
  const hasData = totalEvents > 0;

  /* ---- sessions ---- */
  const SESSION_GAP = 1800;
  const sessions = [];
  userMap.forEach((us) => {
    us.sessions = [];
    let cur = null;
    for (const [t, n] of us.evs) {
      if (!cur || t - cur.end > SESSION_GAP) {
        cur = { email: us.email, start: t, end: t, items: [[t, n]] };
        us.sessions.push(cur);
        sessions.push(cur);
      } else { cur.end = t; cur.items.push([t, n]); }
    }
  });
  const sessDur = sessions.map((s) => s.end - s.start);
  const sessionStats = {
    total: sessions.length,
    medianDur: median(sessDur),
    medianEvents: median(sessions.map((s) => s.items.length)),
    bounce: sessions.length ? sessions.filter((s) => s.items.length === 1).length / sessions.length : 0,
    buckets: [
      { label: '< 1 min', v: sessDur.filter((d) => d < 60).length },
      { label: '1–5 min', v: sessDur.filter((d) => d >= 60 && d < 300).length },
      { label: '5–15 min', v: sessDur.filter((d) => d >= 300 && d < 900).length },
      { label: '15–30 min', v: sessDur.filter((d) => d >= 900 && d < 1800).length },
      { label: '30+ min', v: sessDur.filter((d) => d >= 1800).length }
    ]
  };

  /* ---- per-user features, recency, churn risk ---- */
  const users = [...userMap.values()];
  users.forEach((u) => {
    u.activeIdx = u.dayCounts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    u.activeDays = u.activeIdx.length;
    u.recency = N - 1 - u.activeIdx[u.activeIdx.length - 1];
    u.sessionCount = u.sessions.length;
    const gaps = [];
    for (let i = 1; i < u.activeIdx.length; i++) gaps.push(u.activeIdx[i] - u.activeIdx[i - 1]);
    u.avgGap = gaps.length ? mean(gaps) : null;
    const gap = u.avgGap == null ? 3 : Math.max(1, u.avgGap);
    u.risk = clamp((u.recency - gap) / (gap * 2 + 4), 0, 1) * 100;
    u.riskConfident = u.activeDays >= 3;
    u.daypart = daypartOf(u.hist);
    u.topNames = [...u.names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => ({ label: nameMeta[n].label, c }));
    u.avgSession = u.sessions.length ? mean(u.sessions.map((s) => s.end - s.start)) : 0;
  });

  /* ---- k-means segmentation ---- */
  const segOf = new Map();
  let segments = [];
  if (users.length) {
    const raw = users.map((u) => [Math.log1p(u.events), u.activeDays, 1 - u.recency / Math.max(1, N - 1), Math.log1p(u.sessionCount)]);
    const mins = raw[0].map((_, x) => Math.min(...raw.map((r) => r[x])));
    const maxs = raw[0].map((_, x) => Math.max(...raw.map((r) => r[x])));
    const pts = raw.map((r) => r.map((v, x) => (maxs[x] > mins[x] ? (v - mins[x]) / (maxs[x] - mins[x]) : 0)));
    const k = Math.min(4, users.length);
    const { assign, cents } = kmeans(pts, k);
    const ranking = cents.map((c, j) => ({ j, s: sum(c) })).sort((a, b) => b.s - a.s).map((r) => r.j);
    const labelsByK = { 1: ['Regulars'], 2: ['Champions', 'Casual'], 3: ['Champions', 'Regulars', 'Casual'], 4: ['Champions', 'Regulars', 'Casual', 'Drifting'] };
    const labelOfCluster = {};
    ranking.forEach((j, r) => { labelOfCluster[j] = labelsByK[k][r]; });
    users.forEach((u, i) => { u.segment = labelOfCluster[assign[i]]; segOf.set(u.email, u.segment); });
  }
  (dbUsers || []).forEach((u) => { if (!segOf.has(u.email)) segOf.set(u.email, 'Dormant'); });
  const totalUsersAll = (dbUsers || []).length || users.length;
  segments = Object.keys(SEGMENTS).map((name) => {
    const members = name === 'Dormant' ? (dbUsers || []).filter((u) => !userMap.has(u.email)) : users.filter((u) => u.segment === name);
    return {
      name,
      count: members.length,
      share: totalUsersAll ? (members.length / totalUsersAll) * 100 : 0,
      eventShare: totalEvents && name !== 'Dormant' ? (sum(members.map((m) => m.events)) / totalEvents) * 100 : 0,
      avgEvents: name === 'Dormant' ? 0 : mean(members.map((m) => m.events)),
      avgActiveDays: name === 'Dormant' ? 0 : mean(members.map((m) => m.activeDays)),
      avgSessions: name === 'Dormant' ? 0 : mean(members.map((m) => m.sessionCount)),
      avgRecency: name === 'Dormant' ? null : mean(members.map((m) => m.recency)),
      members
    };
  }).filter((s) => s.count > 0);

  /* ---- trend, seasonality, forecast ---- */
  const keysC = dayKeys.slice(0, complete);
  const dauC = dau.slice(0, complete);
  const evC = evPerDay.slice(0, complete);
  const dauIdx = seasonIndex(dauC, keysC);
  const evIdx = seasonIndex(evC, keysC);
  const m = Math.min(21, dauC.length);
  const des = dauC.slice(-m).map((v, i) => v / dauIdx[wdOfKey(keysC[keysC.length - m + i])]);
  const reg = linreg(des);
  const resid = dauC.slice(-m).map((v, i) => v - (reg.intercept + reg.slope * i) * dauIdx[wdOfKey(keysC[keysC.length - m + i])]);
  const sd = stdev(resid);
  const forecastPoints = [];
  for (let off = 2; off <= 8; off++) {
    const key = dayKeyOfMs(nowMs - DAY_MS + off * DAY_MS);
    const v = Math.max(0, (reg.intercept + reg.slope * (m - 1 + off)) * dauIdx[wdOfKey(key)]);
    forecastPoints.push({ key, v, lo: Math.max(0, v - 1.28 * sd), hi: v + 1.28 * sd });
  }
  const levelNow = mean(des.slice(-7)) || 1;
  const slopePct = (reg.slope / levelNow) * 100;
  const trend = { slope: reg.slope, slopePct, r2: reg.r2, dir: slopePct > 2 && reg.r2 > 0.25 ? 'up' : slopePct < -2 && reg.r2 > 0.25 ? 'down' : 'flat' };
  const expectedToday = Math.max(0, (reg.intercept + reg.slope * m) * dauIdx[wdOfKey(dayKeys[todayI])]);

  /* ---- anomalies (robust z-score on weekday-adjusted daily events) ---- */
  const adj = evC.map((v, i) => v / evIdx[wdOfKey(keysC[i])]);
  const med = median(adj);
  const mad = median(adj.map((v) => Math.abs(v - med)));
  const scale = mad * 1.4826 || stdev(adj) || 1;
  const anomalies = adj.map((v, i) => {
    const expected = med * evIdx[wdOfKey(keysC[i])];
    return { i, key: keysC[i], value: evC[i], expected, ratio: expected ? evC[i] / expected : 0, z: (v - med) / scale };
  }).filter((a) => Math.abs(a.z) >= 2.8 && Math.max(a.value, a.expected) >= 15).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));

  /* ---- rhythm: peak + quiet windows, weekday strength, dayparts ---- */
  const winSum = (start, len) => sum(Array.from({ length: len }, (_, i) => hourTotals[(start + i) % 24]));
  let peakStart = 0, quietStart = 0;
  for (let h = 0; h < 24; h++) {
    if (winSum(h, 3) > winSum(peakStart, 3)) peakStart = h;
    if (winSum(h, 2) < winSum(quietStart, 2)) quietStart = h;
  }
  const peak = { start: peakStart, share: totalEvents ? winSum(peakStart, 3) / totalEvents : 0 };
  const quiet = { start: quietStart, share: totalEvents ? winSum(quietStart, 2) / totalEvents : 0 };
  const wdStrength = evIdx.map((v, wd) => ({ wd, v }));
  const bestWd = [...wdStrength].sort((a, b) => b.v - a.v)[0];
  const worstWd = [...wdStrength].sort((a, b) => a.v - b.v)[0];
  const chrono = DAYPARTS.map((d) => ({ k: d.k, icon: d.icon, v: users.filter((u) => u.events >= 5 && u.daypart === d.k).length }));

  /* ---- Markov journey model + association lift ---- */
  const trans = new Map(), outTot = new Map(), startCnt = new Map(), exitCnt = new Map(), occ = new Map(), single = new Map(), pair = new Map();
  let seqSessions = 0;
  for (const s of sessions) {
    const seq = [];
    for (const [, n] of s.items) { if (isAuth(n)) continue; if (seq[seq.length - 1] !== n) seq.push(n); }
    if (!seq.length) continue;
    seqSessions++;
    startCnt.set(seq[0], (startCnt.get(seq[0]) || 0) + 1);
    exitCnt.set(seq[seq.length - 1], (exitCnt.get(seq[seq.length - 1]) || 0) + 1);
    seq.forEach((n) => occ.set(n, (occ.get(n) || 0) + 1));
    for (let i = 0; i < seq.length - 1; i++) {
      const key = `${seq[i]}>${seq[i + 1]}`;
      trans.set(key, (trans.get(key) || 0) + 1);
      outTot.set(seq[i], (outTot.get(seq[i]) || 0) + 1);
    }
    const uniq = [...new Set(seq)].sort((a, b) => a - b);
    uniq.forEach((n) => single.set(n, (single.get(n) || 0) + 1));
    for (let a = 0; a < uniq.length; a++) for (let b = a + 1; b < uniq.length; b++) {
      const key = `${uniq[a]}&${uniq[b]}`;
      pair.set(key, (pair.get(key) || 0) + 1);
    }
  }
  const lab = (n) => nameMeta[n].label;
  const edges = [...trans.entries()].map(([k, c]) => {
    const [a, b] = k.split('>').map(Number);
    return { from: a, to: b, count: c, prob: c / outTot.get(a), fromLabel: lab(a), toLabel: lab(b) };
  }).filter((e) => e.count >= 2).sort((a, b) => b.count - a.count);
  const startTop = [...startCnt.entries()].sort((a, b) => b[1] - a[1]);
  const path = [];
  if (startTop.length) {
    let cur = startTop[0][0];
    const seen = new Set([cur]);
    path.push({ n: cur, label: lab(cur), prob: startTop[0][1] / seqSessions });
    for (let step = 0; step < 5; step++) {
      const nxt = edges.filter((e) => e.from === cur && !seen.has(e.to)).sort((a, b) => b.prob - a.prob)[0];
      if (!nxt) break;
      path.push({ n: nxt.to, label: nxt.toLabel, prob: nxt.prob });
      seen.add(nxt.to); cur = nxt.to;
    }
  }
  const exits = [...exitCnt.entries()].filter(([n]) => occ.get(n) >= 5).map(([n, c]) => ({ n, label: lab(n), rate: c / occ.get(n), occ: occ.get(n) })).sort((a, b) => b.rate - a.rate).slice(0, 4);
  const starts = startTop.slice(0, 4).map(([n, c]) => ({ label: lab(n), share: c / Math.max(1, seqSessions) }));
  const affinity = [...pair.entries()].map(([k, c]) => {
    const [a, b] = k.split('&').map(Number);
    const lift = (c * seqSessions) / (single.get(a) * single.get(b));
    const conf = Math.max(c / single.get(a), c / single.get(b));
    return { a: lab(a), b: lab(b), count: c, lift, conf };
  }).filter((p) => p.count >= 3 && p.lift >= 1.15).sort((a, b) => b.lift * Math.log(b.count + 1) - a.lift * Math.log(a.count + 1)).slice(0, 8);

  /* ---- cohorts (weekly signup cohorts, retention by week) ---- */
  const weekOf = (ms) => Math.floor((Math.floor((ms + IST_MS) / DAY_MS) - 4) / 7);
  const curWeek = weekOf(nowMs);
  const userWeeks = new Map();
  users.forEach((u) => {
    const set = new Set();
    u.evs.forEach(([t]) => set.add(weekOf(t * 1000)));
    userWeeks.set(u.email, set);
  });
  const cohorts = [];
  for (let w = curWeek - 4; w <= curWeek; w++) {
    const members = (dbUsers || []).filter((u) => u.createdAt && weekOf(new Date(u.createdAt).getTime()) === w);
    if (!members.length) continue;
    const cells = [0, 1, 2, 3, 4].map((k) => {
      if (w + k > curWeek) return null;
      const active = members.filter((u) => userWeeks.get(u.email) && userWeeks.get(u.email).has(w + k)).length;
      return { pct: (active / members.length) * 100, n: active };
    });
    const startMs = (w * 7 + 4) * DAY_MS - IST_MS;
    cohorts.push({ label: fmtDay(dayKeyOfMs(startMs)), size: members.length, cells });
  }
  const w1 = cohorts.filter((c) => c.cells[1]).map((c) => c.cells[1].pct);

  /* ---- sections + OLT effect ---- */
  const secMap = new Map();
  (dbUsers || []).forEach((u) => {
    const s = u.defaultSection || '—';
    const e = secMap.get(s) || { section: s, users: 0, active7: 0, events: 0, olt: 0 };
    e.users++;
    const us = userMap.get(u.email);
    if (us) { e.events += us.events; if (us.recency < 7) e.active7++; }
    if (u.oltUsername) e.olt++;
    secMap.set(s, e);
  });
  const sections = [...secMap.values()].sort((a, b) => a.section.localeCompare(b.section));
  const oltUsersAct = users.filter((u) => userInfo.get(u.email) && userInfo.get(u.email).oltUsername);
  const noOltAct = users.filter((u) => !(userInfo.get(u.email) && userInfo.get(u.email).oltUsername));
  const oltLinked = (dbUsers || []).filter((u) => u.oltUsername).length;
  const oltEffect = oltUsersAct.length >= 3 && noOltAct.length >= 3 ? mean(oltUsersAct.map((u) => u.events)) / Math.max(0.1, mean(noOltAct.map((u) => u.events))) : null;

  /* ---- KPIs ---- */
  const last7 = (arr) => sum(arr.slice(-7));
  const prev7 = (arr) => sum(arr.slice(-14, -7));
  const usersIn = (from, to) => { const s = new Set(); for (let i = Math.max(0, from); i < to; i++) dauSets[i].forEach((e) => s.add(e)); return s.size; };
  const wau = usersIn(N - 7, N), wauPrev = usersIn(N - 14, N - 7), mau = usersIn(0, N);
  const delta = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null);
  const kpi = {
    totalUsers: (dbUsers || []).length,
    activeToday: dau[todayI],
    activeYesterday: dau[todayI - 1] || 0,
    wau, wauDelta: delta(wau, wauPrev),
    mau,
    stickiness: mau ? (mean(dau.slice(-8, -1)) / mau) * 100 : 0,
    events7: last7(evPerDay), eventsDelta: delta(last7(evPerDay), prev7(evPerDay)),
    signups7: last7(signups), signupsDelta: delta(last7(signups), prev7(signups)),
    oltRate: (dbUsers || []).length ? (oltLinked / dbUsers.length) * 100 : 0,
    medianSession: sessionStats.medianDur
  };

  /* ---- funnel, radar and overall health score ---- */
  const funnel = [
    { label: 'Registered', v: totalUsersAll },
    { label: 'Active 30d', v: users.length },
    { label: 'Returning', v: users.filter((u) => u.activeDays >= 2).length },
    { label: 'Habitual', v: users.filter((u) => u.activeDays >= 8).length }
  ];
  const radar = [
    { label: 'Reach', value: totalUsersAll ? clamp((users.length / totalUsersAll) * 100, 0, 100) : 0, hint: 'Active in 30d / registered' },
    { label: 'Stickiness', value: clamp((kpi.stickiness / 30) * 100, 0, 100), hint: 'DAU/MAU against a 30% goal' },
    { label: 'Depth', value: clamp((sessionStats.medianEvents / 6) * 100, 0, 100), hint: 'Median actions per session against 6' },
    { label: 'Retention', value: users.length ? (funnel[2].v / users.length) * 100 : 0, hint: 'Active users who came back on another day' },
    { label: 'Adoption', value: clamp(kpi.oltRate, 0, 100), hint: 'Users with OLT linked' }
  ];
  const health = Math.round(mean(radar.map((r) => r.value)));
  const healthLabel = health >= 70 ? 'Optimal' : health >= 50 ? 'Healthy' : health >= 30 ? 'Needs care' : 'At risk';
  const weakest = [...radar].sort((a, b) => a.value - b.value)[0];

  /* ---- at-risk list + power users ---- */
  const atRisk = users.filter((u) => u.riskConfident && u.risk >= 45).sort((a, b) => b.risk - a.risk);
  const powerUsers = [...users].sort((a, b) => b.events - a.events).slice(0, 6);
  const champs = segments.find((s) => s.name === 'Champions');
  const fb = analyzeFeedback(feedbacks);

  /* ---- top events for overview ---- */
  const topEvents = [...featureStats.values()].sort((a, b) => b.count - a.count).slice(0, 8).map((f) => ({ label: nameMeta[f.n].label, type: nameMeta[f.n].type, count: f.count, users: f.users.size }));

  /* ---- insight generator ---- */
  const insights = [];
  const volConf = clamp(totalEvents / 1500, 0.15, 1);
  const add = (severity, tag, title, body, conf) => insights.push({ id: insights.length, severity, tag, title, body, confidence: Math.round(clamp(conf, 5, 99)) });

  if (!hasData) {
    add('warn', 'Data', 'The engine has nothing to learn from yet', 'No behaviour events were returned for this window. Check that /api/admin/insights is deployed and that the frontend is sending analytics events.', 30);
  } else {
    if (totalEvents < 300) add('info', 'Data', 'Low data volume: confidence is reduced', `Only ${fmtNum(totalEvents)} events in ${N} days. Patterns below are directional, not conclusive.`, 40);
    if (ins.truncated) add('warn', 'Data', 'The model saw only the newest events', `${fmtNum(ins.totalInWindow)} events exist in this window; the newest ${fmtNum(totalEvents)} were analysed.`, 90);

    add('info', 'Rhythm', `Usage peaks ${fmtHour(peak.start)}–${fmtHour(peak.start + 3)} IST`, `${fmtPct(peak.share * 100)} of all activity lands in this 3-hour window. Post announcements and deadlines shortly before it for maximum visibility.`, 55 + volConf * 35);
    add('info', 'Rhythm', `Quietest window: ${fmtHour(quiet.start)}–${fmtHour(quiet.start + 2)} IST`, `Only ${fmtPct(quiet.share * 100, 1)} of traffic. This is the safest slot for deploys, restarts and heavy scrapes.`, 50 + volConf * 35);

    if (worstWd && bestWd && worstWd.v > 0 && bestWd.v / worstWd.v >= 1.4 && complete >= 14) {
      add('info', 'Seasonality', `${WD_FULL[bestWd.wd]} is ${(bestWd.v / worstWd.v).toFixed(1)}× busier than ${WD_FULL[worstWd.wd]}`, 'Weekday seasonality is strong enough that daily numbers should be compared with the same weekday, which is how the forecast and anomaly detector adjust.', 45 + volConf * 40);
    }
    if (complete >= 10) {
      if (trend.dir === 'up') add('good', 'Trend', `Daily active users are growing ~${trend.slopePct.toFixed(1)}% per day`, `Seasonality-adjusted trend over the last ${m} days (R² ${trend.r2.toFixed(2)}). Expected next week: ~${Math.round(mean(forecastPoints.map((p) => p.v)))} users/day.`, 40 + trend.r2 * 55);
      else if (trend.dir === 'down') add('warn', 'Trend', `Daily active users are shrinking ~${Math.abs(trend.slopePct).toFixed(1)}% per day`, `Seasonality-adjusted trend over the last ${m} days (R² ${trend.r2.toFixed(2)}). Expected next week: ~${Math.round(mean(forecastPoints.map((p) => p.v)))} users/day.`, 40 + trend.r2 * 55);
      else add('info', 'Trend', 'Daily active users are stable', `No statistically meaningful slope over ${m} days (R² ${trend.r2.toFixed(2)}). Expect ~${Math.round(mean(forecastPoints.map((p) => p.v)))} users/day next week.`, 45 + (1 - trend.r2) * 30);
    }
    anomalies.filter((a) => a.i >= N - 15).slice(0, 2).forEach((a) => {
      add(a.z > 0 ? 'good' : 'alert', 'Anomaly', `${fmtDayLong(a.key)}: activity was ${a.z > 0 ? a.ratio.toFixed(1) + '× above' : (a.ratio ? (1 / a.ratio).toFixed(1) + '× below' : 'far below')} normal`, `${fmtNum(a.value)} events vs ~${fmtNum(Math.round(a.expected))} expected for a ${WD_FULL[wdOfKey(a.key)]} (robust z = ${a.z.toFixed(1)}).${a.z > 0 ? ' Check what shipped or was announced that day.' : ' Check for downtime, a bad deploy, or an exam/holiday effect.'}`, 55 + Math.min(40, Math.abs(a.z) * 8));
    });
    if (atRisk.length) add(atRisk.length >= 5 ? 'alert' : 'warn', 'Churn', `${atRisk.length} engaged user${atRisk.length > 1 ? 's have' : ' has'} gone quiet beyond their normal rhythm`, `Starting with ${atRisk.slice(0, 3).map((u) => (userInfo.get(u.email) || {}).name || u.email).join(', ')}. Each is measured against their own usual gap between visits, not a global threshold.`, 60 + clamp(atRisk.length * 3, 0, 25));
    if (champs && users.length >= 8) add('info', 'Segments', `${fmtPct(champs.share)} of users (Champions) generate ${fmtPct(champs.eventShare)} of activity`, 'k-means clustering on volume, frequency, recency and session depth. Retaining this group matters disproportionately.', 55 + volConf * 35);
    if (path.length >= 3) add('info', 'Journey', `Most common journey: ${path.map((p) => p.label).join(' → ')}`, `Built from a Markov model over ${fmtNum(seqSessions)} sessions. Each arrow is the most probable next action.`, 40 + volConf * 45);
    if (exits[0] && exits[0].rate >= 0.5) add('warn', 'Journey', `"${cap(exits[0].label)}" is where ${fmtPct(exits[0].rate * 100)} of sessions end`, 'High exit rate on a screen can mean it is the natural goal (good) or a dead end (bad). Check whether it offers a next step.', 40 + volConf * 40);
    if (affinity[0]) add('info', 'Affinity', `"${cap(affinity[0].a)}" and "${cap(affinity[0].b)}" are used together ${affinity[0].lift.toFixed(1)}× more than chance`, `${fmtNum(affinity[0].count)} sessions contain both. Consider surfacing one from the other.`, 40 + volConf * 40);
    if (oltEffect && oltEffect >= 1.3) add('good', 'Adoption', `Users with OLT linked are ${oltEffect.toFixed(1)}× more active`, `${fmtPct(kpi.oltRate)} of all users have linked OLT. Nudging the rest is the cheapest engagement lever.`, 50 + volConf * 35);
    if (sessionStats.total >= 20 && sessionStats.bounce > 0.5) add('warn', 'Sessions', `${fmtPct(sessionStats.bounce * 100)} of sessions are single-action visits`, `Median session is ${fmtDur(sessionStats.medianDur)}. Many visits are quick lookups (timetable/attendance), which may be fine, but it caps depth.`, 50 + volConf * 35);
    if (kpi.signupsDelta != null && Math.abs(kpi.signupsDelta) >= 30 && kpi.signups7 >= 3) add(kpi.signupsDelta > 0 ? 'good' : 'warn', 'Growth', `Signups ${kpi.signupsDelta > 0 ? 'up' : 'down'} ${Math.abs(kpi.signupsDelta).toFixed(0)}% week over week`, `${kpi.signups7} new users in the last 7 days.`, 55);
    if (w1.length) add(mean(w1) >= 50 ? 'good' : 'info', 'Retention', `Average week-1 retention is ${fmtPct(mean(w1))}`, `Across ${w1.length} signup cohort${w1.length > 1 ? 's' : ''} with a complete second week.`, 40 + Math.min(40, w1.length * 10));
    if (fb.items.length >= 5 && fb.neg / fb.items.length > 0.3) add('warn', 'Feedback', `${fmtPct((fb.neg / fb.items.length) * 100)} of feedback reads negative`, `Recurring words: ${fb.topics.slice(0, 4).map((t) => t.word).join(', ') || 'n/a'}.`, 45 + clamp(fb.items.length, 0, 40));
  }
  insights.sort((a, b) => SEV[a.severity].rank - SEV[b.severity].rank || b.confidence - a.confidence);

  /* ---- "ask the engine" canned reasoning ---- */
  const nm = (u) => (userInfo.get(u.email) || {}).name || u.email;
  const qa = hasData ? [
    { q: 'When should I send an announcement?', a: `Aim for ${fmtHour(peak.start - 1)}–${fmtHour(peak.start)} IST, just before the peak window (${fmtHour(peak.start)}–${fmtHour(peak.start + 3)}). ${WD_FULL[bestWd.wd]} is the strongest day.` },
    { q: 'When is the safest time to deploy?', a: `${fmtHour(quiet.start)}–${fmtHour(quiet.start + 2)} IST carries only ${fmtPct(quiet.share * 100, 1)} of traffic. Avoid ${WD_FULL[bestWd.wd]} evenings.` },
    { q: 'Who is about to churn?', a: atRisk.length ? `${atRisk.slice(0, 5).map((u) => `${nm(u)} (${Math.round(u.risk)}% risk, quiet ${u.recency}d vs usual ${u.avgGap ? u.avgGap.toFixed(1) : '?'}d gap)`).join('; ')}.` : 'Nobody with an established pattern is currently overdue. Good.' },
    { q: 'What will traffic look like next week?', a: `~${Math.round(mean(forecastPoints.map((p) => p.v)))} active users/day (80% band ${Math.round(mean(forecastPoints.map((p) => p.lo)))}–${Math.round(mean(forecastPoints.map((p) => p.hi)))}); trend is ${trend.dir === 'up' ? 'rising' : trend.dir === 'down' ? 'falling' : 'flat'}. Busiest expected day: ${fmtDayLong(forecastPoints.slice().sort((a, b) => b.v - a.v)[0].key)}.` },
    { q: 'What do users do first?', a: starts.length ? `${starts.map((s) => `${cap(s.label)} (${fmtPct(s.share * 100)})`).join(', ')} are the most common opening actions.` : 'Not enough session data yet.' },
    { q: 'Which features go together?', a: affinity.length ? affinity.slice(0, 3).map((p) => `${cap(p.a)} + ${cap(p.b)} (${p.lift.toFixed(1)}× lift)`).join('; ') + '.' : 'No pair is used together more than chance yet.' },
    { q: 'Who are my power users?', a: powerUsers.length ? `${powerUsers.slice(0, 5).map((u) => `${nm(u)} (${fmtNum(u.events)} events)`).join(', ')}.` : 'No activity yet.' }
  ] : [];

  return {
    N, dayKeys, hasData, totalEvents, evPerDay, dau, signups, grid, hourTotals, dayHour, nameMeta, userMap, users, segOf, segments,
    sessions, sessionStats, trend, forecast: { points: forecastPoints, expectedToday, sd }, anomalies, peak, quiet, evIdx, bestWd, worstWd, chrono,
    edges: edges.slice(0, 10), path, exits, starts, affinity, seqSessions, cohorts, sections, oltEffect, kpi, atRisk, powerUsers, topEvents,
    insights, qa, fb, userInfo, todayI, funnel, radar, health, healthLabel, weakest
  };
}

/* ============================================================================
   3. STYLES
============================================================================ */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Manrope:wght@600;700;800&display=swap');

/* The admin lives in its own fixed, self-scrolling viewport so it keeps working
   even if the host app sets overflow:hidden on html/body/#root. */
.ap{--ink:#0E1116;--ink2:#2B323B;--mute:#68757D;--faint:#9AA7AD;--line:rgba(14,17,22,.08);--card:rgba(255,255,255,.74);
 --g1:#9BE15D;--g2:#F5A524;--g3:#F2542D;--blue:#4C8DF6;--green:#2FBF71;--red:#F2542D;--amber:#F5A524;--purple:#8B7CF6;
 --ease:cubic-bezier(.16,1,.3,1);
 position:fixed;inset:0;z-index:1;display:flex;overflow:hidden;
 font-family:'Inter',system-ui,sans-serif;color:var(--ink);font-size:14px;line-height:1.45;
 background:radial-gradient(900px 600px at 8% -5%,#DDF1EA 0,transparent 60%),radial-gradient(800px 600px at 100% 5%,#FDEFE0 0,transparent 55%),radial-gradient(900px 700px at 55% 115%,#D9EAF3 0,transparent 60%),#EDF2F0}
.ap *{box-sizing:border-box}
.ap button{font-family:inherit;cursor:pointer}
.ap h1,.ap h2,.ap h3,.ap .num{font-family:'Manrope','Inter',sans-serif}
.ap ::-webkit-scrollbar{width:10px;height:10px}.ap ::-webkit-scrollbar-thumb{background:rgba(14,17,22,.16);border-radius:10px;border:3px solid transparent;background-clip:content-box}
.ap ::-webkit-scrollbar-thumb:hover{background:rgba(14,17,22,.3);background-clip:content-box;border:3px solid transparent}

/* ambient aurora */
.ap-aurora{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.ap-aurora i{position:absolute;border-radius:50%;filter:blur(70px);opacity:.55;animation:ap-drift 26s ease-in-out infinite}
.ap-aurora i:nth-child(1){width:520px;height:520px;background:#c9f1d6;left:12%;top:8%}
.ap-aurora i:nth-child(2){width:460px;height:460px;background:#ffe2c2;right:6%;top:30%;animation-delay:-9s}
.ap-aurora i:nth-child(3){width:520px;height:520px;background:#cfe6f7;left:40%;bottom:-12%;animation-delay:-17s}
@keyframes ap-drift{0%,100%{transform:translate(0,0) scale(1)}33%{transform:translate(60px,-40px) scale(1.12)}66%{transform:translate(-50px,50px) scale(.94)}}

@keyframes ap-rise{from{opacity:0;transform:translateY(22px) scale(.985)}to{opacity:1;transform:none}}
@keyframes ap-fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes ap-spin{to{transform:rotate(360deg)}}
@keyframes ap-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ap-halo{0%{transform:scale(.6);opacity:.6}100%{transform:scale(2.4);opacity:0}}
@keyframes ap-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes ap-grow{from{opacity:0;transform:scale(.25)}to{opacity:1;transform:scale(1)}}
@keyframes ap-growy{from{opacity:0;transform:scaleY(.1)}to{opacity:1;transform:scaleY(1)}}
@keyframes ap-bar{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes ap-slide{from{opacity:0;transform:translateX(-14px)}to{opacity:1;transform:none}}
@keyframes ap-modal{from{opacity:0;transform:translateY(30px) scale(.96)}to{opacity:1;transform:none}}
.ap-spin{animation:ap-spin 1s linear infinite}
.ap-draw{stroke-dasharray:1;stroke-dashoffset:0;animation:ap-draw 1.6s var(--ease) both}
.ap-grow{animation:ap-grow 1.1s var(--ease) both}
.ap-growy{transform-origin:center;transform-box:fill-box;animation:ap-growy 1.1s var(--ease) both}
.ap-bar{transform-origin:bottom;transform-box:fill-box;animation:ap-bar .9s var(--ease) both}
.ap-halo{transform-origin:center;transform-box:fill-box;animation:ap-halo 2.2s ease-out infinite}

/* ---- shell: floating rail + self-scrolling main ---- */
.ap-railwrap{flex:0 0 96px;position:relative;z-index:40}
.ap-rail{position:absolute;left:16px;top:16px;bottom:16px;width:64px;border-radius:32px;background:linear-gradient(180deg,#171B21,#0E1116);padding:14px 10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 50px -18px rgba(14,17,22,.55);transition:width .45s var(--ease)}
.ap-rail:hover{width:232px}
.ap-logo{display:flex;align-items:center;gap:12px;height:44px;padding:0 6px;margin-bottom:18px;color:#fff;font-family:Manrope,sans-serif;font-weight:800;white-space:nowrap}
.ap-logo .mk{flex:0 0 40px;height:40px;border-radius:13px;background:linear-gradient(135deg,var(--g1),var(--g2));display:grid;place-items:center;color:#0E1116}
.ap-ni{display:flex;align-items:center;gap:14px;width:100%;height:46px;padding:0 11px;border-radius:23px;border:0;background:transparent;color:#9AA7AD;font-weight:600;font-size:13.5px;white-space:nowrap;margin-bottom:6px;transition:background .25s,color .25s,transform .25s var(--ease)}
.ap-ni svg{flex:0 0 20px}
.ap-ni span{opacity:0;transform:translateX(-8px);transition:opacity .3s,transform .4s var(--ease)}
.ap-rail:hover .ap-ni span{opacity:1;transform:none}
.ap-ni:hover{color:#fff;background:rgba(255,255,255,.08)}
.ap-ni.on{background:#fff;color:#0E1116}
.ap-ni .tg{margin-left:auto;font-size:9.5px;font-weight:800;letter-spacing:.7px;background:linear-gradient(135deg,var(--g1),var(--g2));color:#0E1116;padding:2px 7px;border-radius:99px}
.ap-rail-foot{margin-top:auto}
.ap-main{flex:1;min-width:0;height:100%;overflow-y:auto;overflow-x:hidden;scroll-behavior:smooth;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
.ap-bar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;padding:18px 32px 14px 8px;background:linear-gradient(180deg,rgba(237,242,240,.94) 40%,rgba(237,242,240,0));backdrop-filter:blur(8px)}
.ap-crumb{font-size:13px;color:var(--mute);white-space:nowrap}.ap-crumb b{color:var(--ink);font-weight:700}
.ap-sbox{position:relative;flex:1;max-width:420px;margin:0 auto 0 18px}
.ap-sbox svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--faint)}
.ap-sbox input{width:100%;height:44px;padding:0 16px 0 42px;border-radius:22px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.7);backdrop-filter:blur(10px);font-size:13.5px;outline:none;transition:box-shadow .25s,background .25s}
.ap-sbox input:focus{background:#fff;box-shadow:0 0 0 4px rgba(155,225,93,.35)}
.ap-bar .r{display:flex;gap:10px;align-items:center}
.ap-page{padding:6px 32px 80px 8px;max-width:1560px;animation:ap-fade .6s var(--ease) both}
.ap-hd{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;flex-wrap:wrap;margin:6px 0 26px}
.ap-hd h1{margin:0;font-size:46px;line-height:1.05;font-weight:800;letter-spacing:-1.2px}
.ap-hd p{margin:8px 0 0;color:var(--mute);font-size:15px;font-weight:500}
.ap-hstats{display:flex;gap:30px;flex-wrap:wrap}
.ap-hstat .lb{font-size:13px;color:var(--mute);font-weight:600;margin-bottom:4px}
.ap-hstat .v{display:flex;align-items:center;gap:8px;font-family:Manrope,sans-serif;font-weight:800;font-size:25px;letter-spacing:-.5px}
.ap-hstat .v small{font-size:13px;color:var(--mute);font-weight:700}
.ap-pillv{background:#fff;border-radius:99px;padding:5px 11px;font-size:12.5px;font-weight:700;font-family:Inter,sans-serif;box-shadow:0 4px 12px -4px rgba(31,64,60,.2);letter-spacing:0}

/* buttons / chips */
.ap-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:42px;padding:0 18px;border-radius:21px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.75);color:var(--ink2);font-weight:700;font-size:13px;transition:transform .25s var(--ease),box-shadow .25s,background .2s}
.ap-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 10px 22px -10px rgba(31,64,60,.35);background:#fff}
.ap-btn:disabled{opacity:.55;cursor:not-allowed}
.ap-btn.dark{background:var(--ink);color:#fff;border-color:var(--ink)}
.ap-btn.dark:hover:not(:disabled){background:#1d232c}
.ap-btn.block{width:100%;height:50px;font-size:15px;border-radius:25px}
.ap-chip{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 13px;border-radius:17px;font-size:12.5px;font-weight:700;background:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.9);color:var(--ink2);white-space:nowrap}
.ap-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(47,191,113,.2);animation:ap-pulse 2s infinite}
.ap-seg{display:inline-flex;background:rgba(14,17,22,.06);border-radius:99px;padding:4px;gap:2px}
.ap-seg button{border:0;background:transparent;height:30px;padding:0 13px;border-radius:99px;font-size:12.5px;font-weight:700;color:var(--mute);transition:all .3s var(--ease)}
.ap-seg button.on{background:var(--ink);color:#fff;box-shadow:0 6px 14px -6px rgba(14,17,22,.6)}
.ap-pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center}
.ap-pill{height:38px;padding:0 16px;border-radius:19px;border:1px solid rgba(255,255,255,.9);background:rgba(255,255,255,.7);color:var(--mute);font-weight:700;font-size:13px;transition:all .3s var(--ease);display:inline-flex;align-items:center;gap:7px}
.ap-pill:hover{color:var(--ink);background:#fff;transform:translateY(-1px)}
.ap-pill.on{background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:0 10px 20px -10px rgba(14,17,22,.6)}
.ap-alert{display:flex;gap:9px;align-items:center;padding:12px 15px;border-radius:16px;font-weight:600;font-size:13px;margin:12px 0}
.ap-alert.err{background:rgba(242,84,45,.12);color:#b0381b}.ap-alert.warn{background:rgba(245,165,36,.16);color:#8a5a06}
.ap-input{width:100%;height:48px;padding:0 16px;border:1px solid rgba(14,17,22,.1);border-radius:16px;font-size:15px;outline:none;background:#fff;transition:box-shadow .25s,border-color .25s}
.ap-input:focus{border-color:var(--g1);box-shadow:0 0 0 5px rgba(155,225,93,.3)}
select.ap-input{width:auto;height:42px;font-size:13px;font-weight:600;border-radius:21px;padding:0 14px}
.ap-badge{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:12px;font-size:11.5px;font-weight:700;white-space:nowrap}

/* cards + grid */
.ap-12{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:20px;margin-bottom:20px}
.c3{grid-column:span 3}.c4{grid-column:span 4}.c5{grid-column:span 5}.c6{grid-column:span 6}.c7{grid-column:span 7}.c8{grid-column:span 8}.c12{grid-column:span 12}
.ap-grid{display:grid;gap:20px}.ap-2{grid-template-columns:repeat(auto-fit,minmax(380px,1fr))}.ap-3{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.ap-panel{background:var(--card);backdrop-filter:blur(20px) saturate(1.25);border:1px solid rgba(255,255,255,.9);border-radius:30px;padding:24px;min-width:0;box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 26px 60px -30px rgba(31,64,60,.28);transition:transform .45s var(--ease),box-shadow .45s var(--ease);animation:ap-rise .9s var(--ease) both}
.ap-panel:hover{transform:translateY(-4px);box-shadow:0 1px 0 rgba(255,255,255,.9) inset,0 34px 70px -28px rgba(31,64,60,.34)}
.ap-12>.ap-panel:nth-child(2){animation-delay:.07s}.ap-12>.ap-panel:nth-child(3){animation-delay:.14s}.ap-12>.ap-panel:nth-child(4){animation-delay:.21s}.ap-12>.ap-panel:nth-child(5){animation-delay:.28s}.ap-12>.ap-panel:nth-child(6){animation-delay:.35s}
.ap-grid>.ap-panel:nth-child(2){animation-delay:.08s}.ap-grid>.ap-panel:nth-child(3){animation-delay:.16s}.ap-grid>.ap-panel:nth-child(4){animation-delay:.24s}
.ap-panel.dark{background:linear-gradient(160deg,#1A1F26,#0E1116);color:#fff;border-color:rgba(255,255,255,.06);box-shadow:0 30px 60px -28px rgba(14,17,22,.7)}
.ap-ph{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.ap-ph h3{margin:0;font-size:17px;font-weight:800;letter-spacing:-.2px;display:flex;align-items:center;gap:9px}
.ap-ph .sub{font-size:12.5px;color:var(--mute);margin-top:4px;font-weight:500}
.ap-panel.dark .sub{color:#8f9ba3}
.ap-empty{text-align:center;padding:36px 16px;color:var(--mute)}.ap-empty b{display:block;color:var(--ink2);margin-bottom:5px;font-size:15px}
.ap-note{font-size:12px;color:var(--mute);margin-top:14px}

/* gauge + leaders */
.ap-gauge{position:relative;margin:0 auto}
.ap-gauge .ct{position:absolute;inset:0;display:grid;place-items:center;text-align:center;pointer-events:none}
.ap-gauge .ct.half{align-items:end;padding-bottom:6px}
.ap-gauge .big{font-family:Manrope,sans-serif;font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1}
.ap-gauge .cap{font-size:12px;color:var(--mute);font-weight:600;margin-top:5px}
.ap-gauge-row{display:flex;gap:26px;align-items:center;flex-wrap:wrap;justify-content:center}
.ap-leaders{flex:1;min-width:190px;display:grid;gap:15px}
.ap-lead{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700}
.ap-lead i{width:10px;height:10px;border-radius:50%;flex:0 0 10px}
.ap-lead .ln{flex:1;border-bottom:2px dotted rgba(14,17,22,.2);height:1px;transform:translateY(3px)}
.ap-lead .vv{font-family:Manrope,sans-serif;font-weight:800}

/* bars */
.ap-bar-row{display:grid;grid-template-columns:120px 1fr 54px;gap:12px;align-items:center;margin-bottom:11px;font-size:13px}
.ap-bar-row .nm{font-weight:600;text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-track{height:10px;border-radius:99px;background:rgba(14,17,22,.07);overflow:hidden}
.ap-fill{height:100%;border-radius:99px;transform-origin:left;animation:ap-slide .9s var(--ease) both}
.ap-bar-row .n{text-align:right;color:var(--mute);font-weight:700;font-variant-numeric:tabular-nums}
.ap-panel.dark .ap-track{background:rgba(255,255,255,.1)}

/* tickers */
.ap-tick{display:flex;justify-content:space-between;align-items:flex-end;gap:12px}
.ap-tick .lb{font-size:12px;letter-spacing:.7px;text-transform:uppercase;font-weight:700;color:var(--mute)}
.ap-tick .vl{font-family:Manrope,sans-serif;font-size:34px;font-weight:800;letter-spacing:-1px;line-height:1.1;margin:6px 0 8px}
.up{color:#17935a;font-weight:800;display:inline-flex;align-items:center;gap:2px;font-size:13px}.dn{color:#d6401d;font-weight:800;display:inline-flex;align-items:center;gap:2px;font-size:13px}

/* hero chart */
.ap-chartwrap{position:relative}
.ap-tip{position:absolute;top:-6px;transform:translateX(-50%);background:var(--ink);color:#fff;padding:8px 12px;border-radius:14px;font-size:12px;font-weight:600;white-space:nowrap;pointer-events:none;box-shadow:0 14px 30px -10px rgba(14,17,22,.5);transition:left .12s ease}
.ap-tip b{display:block;font-size:12.5px;margin-bottom:2px}
.ap-legend{display:flex;gap:16px;font-size:12px;color:var(--mute);font-weight:600;flex-wrap:wrap}.ap-legend span{display:inline-flex;align-items:center;gap:6px}.ap-legend i{width:10px;height:10px;border-radius:3px;display:inline-block}

/* insights */
.ap-insight{display:grid;grid-template-columns:5px 1fr;gap:15px;background:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.95);border-radius:20px;padding:16px 18px;margin-bottom:12px;transition:transform .35s var(--ease),box-shadow .35s;animation:ap-rise .8s var(--ease) both}
.ap-insight:hover{transform:translateX(4px);box-shadow:0 16px 30px -18px rgba(31,64,60,.4)}
.ap-insight .bar{border-radius:5px}.ap-insight h4{margin:0 0 4px;font-size:14.5px;font-weight:800}.ap-insight p{margin:0;color:var(--ink2);font-size:13px}
.ap-insight .meta{display:flex;gap:8px;align-items:center;margin-bottom:7px;flex-wrap:wrap}
.ap-conf{display:inline-flex;gap:7px;align-items:center;font-size:11.5px;color:var(--mute);font-weight:700}
.ap-conf i{display:block;width:56px;height:5px;background:rgba(14,17,22,.08);border-radius:9px;overflow:hidden}.ap-conf i b{display:block;height:100%;background:linear-gradient(90deg,var(--g1),var(--g2),var(--g3));border-radius:9px}
.ap-q{height:36px;padding:0 15px;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#dfe6ea;font-size:12.5px;font-weight:600;transition:all .3s var(--ease)}
.ap-q:hover{background:rgba(255,255,255,.16)}.ap-q.on{background:linear-gradient(135deg,var(--g1),var(--g2));border-color:transparent;color:#0E1116}
.ap-answer{margin-top:16px;padding:16px 18px;border-radius:20px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);font-size:14px;color:#f1f5f7;min-height:56px;animation:ap-fade .5s var(--ease) both}

/* heatmap / strips / lanes */
.ap-heat{display:grid;grid-template-columns:36px repeat(24,minmax(0,1fr));gap:4px;align-items:center}
.ap-heat .c{aspect-ratio:1/1;border-radius:7px;min-height:14px;transition:transform .2s var(--ease)}.ap-heat .c:hover{transform:scale(1.35);position:relative;z-index:2}
.ap-heat .l{font-size:11px;color:var(--mute);font-weight:700}.ap-heat .hl{font-size:10px;color:var(--faint);text-align:center}
.ap-strip{display:grid;grid-template-columns:86px repeat(24,minmax(0,1fr)) 56px;gap:3px;align-items:center;padding:4px 8px;border-radius:14px;cursor:pointer;border:1px solid transparent;transition:background .25s,border-color .25s}
.ap-strip:hover{background:rgba(255,255,255,.8)}.ap-strip.on{background:#fff;border-color:rgba(14,17,22,.12);box-shadow:0 10px 24px -14px rgba(31,64,60,.4)}
.ap-strip .c{height:20px;border-radius:6px}.ap-strip .d{font-size:12px;font-weight:700}.ap-strip .t{font-size:12px;color:var(--mute);text-align:right;font-weight:800}
.ap-lane{display:grid;grid-template-columns:150px 1fr;gap:12px;align-items:center;margin-bottom:7px}
.ap-lane .who{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}
.ap-lane .rail{position:relative;height:22px;background:rgba(14,17,22,.05);border-radius:11px}
.ap-lane .seg{position:absolute;top:3px;bottom:3px;border-radius:8px;min-width:5px;animation:ap-slide .8s var(--ease) both;transform-origin:left}
.ap-axis{display:grid;grid-template-columns:150px 1fr;gap:12px}.ap-axis .ax{display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint);margin-top:6px}
.ap-stream{max-height:380px;overflow:auto;border-radius:20px;background:rgba(255,255,255,.6)}
.ap-ev{display:grid;grid-template-columns:54px 1fr auto;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(14,17,22,.06);font-size:13px;align-items:center;animation:ap-slide .5s var(--ease) both}
.ap-ev:last-child{border-bottom:0}.ap-ev .tm{color:var(--mute);font-variant-numeric:tabular-nums;font-weight:700}

/* tables / users */
.ap-table{width:100%;border-collapse:collapse;font-size:13px}
.ap-table th{text-align:left;font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:var(--mute);padding:10px 14px;font-weight:700;white-space:nowrap}
.ap-table td{padding:13px 14px;border-top:1px solid rgba(14,17,22,.06);vertical-align:middle}
.ap-table tr.row{cursor:pointer;transition:background .2s}.ap-table tr.row:hover{background:rgba(255,255,255,.9)}
.ap-avatar{width:38px;height:38px;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,var(--g1),var(--g2));color:#0E1116;display:grid;place-items:center;font-weight:800;font-size:12.5px;flex-shrink:0}
.ap-user{display:flex;gap:11px;align-items:center;min-width:0}.ap-user .nm{font-weight:700}.ap-user .em{font-size:12px;color:var(--mute)}
.ap-meter{width:72px;height:8px;border-radius:99px;background:rgba(14,17,22,.08);overflow:hidden;display:inline-block;vertical-align:middle}.ap-meter i{display:block;height:100%;border-radius:99px;transition:width .8s var(--ease)}
.ap-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
.ap-search{position:relative;flex:1;min-width:220px;max-width:340px}.ap-search svg{position:absolute;left:15px;top:50%;transform:translateY(-50%);color:var(--faint)}.ap-search input{padding-left:42px;height:42px;border-radius:21px;font-size:13.5px}

/* journeys + segments */
.ap-flow{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}
.ap-node{background:#fff;border-radius:20px;padding:14px 18px;min-width:130px;box-shadow:0 14px 30px -18px rgba(31,64,60,.4);animation:ap-rise .8s var(--ease) both}
.ap-node b{display:block;text-transform:capitalize;font-size:14px}.ap-node span{font-size:12px;color:var(--mute);font-weight:600}
.ap-arrow{display:flex;align-items:center;color:var(--faint);font-weight:800;font-size:18px}
.ap-segbar{display:flex;height:18px;border-radius:99px;overflow:hidden;margin-bottom:16px;background:rgba(14,17,22,.07)}
.ap-segbar div{transition:width 1s var(--ease)}
.ap-card{border-radius:22px;padding:18px;background:rgba(255,255,255,.8);border:1px solid rgba(255,255,255,.95)}
.ap-card h4{margin:0 0 3px;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:800}
.ap-card p{margin:0 0 12px;font-size:12px;color:var(--mute)}
.ap-card dl{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;margin:0;font-size:12px}.ap-card dt{color:var(--mute)}.ap-card dd{margin:0;font-weight:800;text-align:right}
.ap-cohort td{text-align:center;font-weight:800;font-size:12.5px;padding:9px}.ap-cohort td.k{text-align:left}

/* live list */
.ap-live{display:flex;align-items:center;gap:12px;padding:11px 0;border-top:1px solid rgba(14,17,22,.06);animation:ap-slide .6s var(--ease) both}
.ap-live:first-child{border-top:0}.ap-live .tx{flex:1;min-width:0}.ap-live .tx b{display:block;font-size:13.5px}.ap-live .tx span{font-size:12px;color:var(--mute);text-transform:capitalize}
.ap-live .tm{font-size:11.5px;color:var(--mute);font-weight:700;text-align:right}

/* modal */
.ap-ov{position:fixed;inset:0;background:rgba(14,17,22,.55);backdrop-filter:blur(10px);z-index:100;display:grid;place-items:center;padding:20px;animation:ap-fade .25s ease both}
.ap-modal{background:linear-gradient(180deg,#F8FBFA,#EEF4F2);border-radius:34px;width:100%;max-width:1000px;max-height:92vh;overflow:auto;box-shadow:0 40px 90px -20px rgba(0,0,0,.5);animation:ap-modal .6s var(--ease) both;overscroll-behavior:contain}
.ap-mh{display:flex;justify-content:space-between;gap:16px;padding:26px 30px;position:sticky;top:0;background:rgba(248,251,250,.92);backdrop-filter:blur(12px);z-index:2;border-bottom:1px solid rgba(14,17,22,.06)}
.ap-mb{padding:26px 30px 32px;display:grid;gap:22px}
.ap-x{width:42px;height:42px;border-radius:50%;border:1px solid rgba(14,17,22,.1);background:#fff;display:grid;place-items:center;color:var(--mute);transition:all .3s var(--ease)}.ap-x:hover{color:#fff;background:var(--ink);transform:rotate(90deg)}
.ap-prof{padding:18px 20px;border-radius:22px;background:linear-gradient(135deg,rgba(155,225,93,.28),rgba(245,165,36,.2));font-size:14px;color:var(--ink2)}
.ap-sess{border-left:3px solid var(--g1);padding:9px 0 9px 16px;margin-left:6px;position:relative}
.ap-sess::before{content:'';position:absolute;left:-8px;top:15px;width:13px;height:13px;border-radius:50%;background:#fff;border:3px solid var(--g2)}
.ap-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.ap-tag{font-size:11px;padding:3px 9px;border-radius:9px;background:rgba(14,17,22,.06);color:var(--ink2);font-weight:700;text-transform:capitalize}
.ap-fb{padding:16px 18px;border-radius:20px;margin-bottom:12px;background:rgba(255,255,255,.85);border-left:5px solid;animation:ap-rise .7s var(--ease) both}
.ap-fb header{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;font-size:12.5px}.ap-fb p{margin:0;color:var(--ink2)}

/* login */
.ap-login{position:relative;z-index:1;width:100%;height:100%;overflow:auto;display:grid;place-items:center;padding:28px}
.ap-login-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:60px;max-width:1080px;width:100%;align-items:center}
.ap-hero h1{font-size:58px;line-height:1.02;margin:0 0 16px;font-weight:800;letter-spacing:-2px}
.ap-hero p{color:var(--mute);font-size:17px;margin:0 0 28px;max-width:470px}
.ap-hero ul{padding:0;margin:0;display:grid;gap:14px}.ap-hero li{list-style:none;display:flex;gap:13px;align-items:center;font-weight:600}
.ap-hero .ic{width:42px;height:42px;border-radius:14px;background:#fff;display:grid;place-items:center;color:#0E1116;box-shadow:0 10px 22px -12px rgba(31,64,60,.5)}
.ap-login-card{background:rgba(255,255,255,.82);backdrop-filter:blur(24px);border:1px solid #fff;border-radius:36px;padding:42px;box-shadow:0 40px 80px -30px rgba(31,64,60,.4);animation:ap-rise 1s var(--ease) both}
.ap-login-card h2{margin:18px 0 6px;font-size:28px;font-weight:800}

@media(max-width:1280px){.c3{grid-column:span 6}.c4{grid-column:span 6}.c5,.c7,.c8{grid-column:span 12}}
@media(max-width:900px){
 .ap{flex-direction:column}
 .ap-railwrap{flex:0 0 auto}
 .ap-rail{position:relative;left:auto;top:auto;bottom:auto;width:auto;margin:10px;height:60px;border-radius:30px;flex-direction:row;padding:8px;gap:4px;overflow-x:auto}
 .ap-rail:hover{width:auto}.ap-logo,.ap-rail-foot{display:none}.ap-ni{width:auto;margin:0;flex:0 0 auto}.ap-ni span{opacity:1;transform:none}.ap-ni .tg{display:none}
 .ap-bar{padding:10px 16px}.ap-crumb,.ap-bar .ap-chip{display:none}.ap-page{padding:6px 16px 80px}
 .ap-hd h1{font-size:34px}.ap-login-grid{grid-template-columns:1fr}.ap-hero{display:none}.ap-2{grid-template-columns:1fr}
 .c3,.c4,.c5,.c6,.c7,.c8{grid-column:span 12}
 .ap-bar-row{grid-template-columns:90px 1fr 44px}.ap-lane,.ap-axis{grid-template-columns:96px 1fr}.ap-strip{grid-template-columns:60px repeat(24,minmax(0,1fr)) 38px}
}
@media(prefers-reduced-motion:reduce){.ap *,.ap *::before{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
`;

/* ============================================================================
   4. VISUAL PRIMITIVES
============================================================================ */
const GRAD = 'linear-gradient(90deg,#9BE15D,#F5A524,#F2542D)';

function CountUp({ value, format = (v) => fmtNum(Math.round(v)), dur = 1100 }) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const to = Number(value) || 0;
    const from = prev.current;
    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || from === to) { setV(to); prev.current = to; return undefined; }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick); else prev.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, dur]);
  return <>{format(v)}</>;
}

const polar = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const arcPath = (cx, cy, r, a0, a1) => {
  const [sx, sy] = polar(cx, cy, r, a0);
  const [ex, ey] = polar(cx, cy, r, a1);
  return `M${sx},${sy} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${ex},${ey}`;
};

/* 270deg gauge (full) or 180deg gauge (half) with animated gradient fill + knob */
function ArcGauge({ value, half = false, size = 230, stroke = 16, children, id = 'g', stops = ['#C8E63B', '#F5A524', '#F2542D'] }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const t = setTimeout(() => setShown(clamp(value, 0, 100)), 120); return () => clearTimeout(t); }, [value]);
  const a0 = half ? 180 : 135, a1 = half ? 360 : 405;
  const r = 80, cx = 100, cy = 100;
  const d = arcPath(cx, cy, r, a0, a1);
  const rot = a0 + (a1 - a0) * (shown / 100);
  const vbH = half ? 118 : 200;
  return (
    <div className="ap-gauge" style={{ width: size, height: (size * vbH) / 200 }}>
      <svg viewBox={`0 0 200 ${vbH}`} width="100%" height="100%" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={`ag-${id}`} gradientUnits="userSpaceOnUse" x1="20" y1={half ? 100 : 170} x2="180" y2={half ? 100 : 40}>
            <stop offset="0" stopColor={stops[0]} /><stop offset=".55" stopColor={stops[1]} /><stop offset="1" stopColor={stops[2]} />
          </linearGradient>
        </defs>
        <path d={d} fill="none" stroke="rgba(14,17,22,.08)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={d} fill="none" stroke={`url(#ag-${id})`} strokeWidth={stroke} strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.max(0.01, shown)} 100`} style={{ transition: 'stroke-dasharray 1.5s cubic-bezier(.16,1,.3,1)' }} />
        <g style={{ transformOrigin: `${cx}px ${cy}px`, transform: `rotate(${rot}deg)`, transition: 'transform 1.5s cubic-bezier(.16,1,.3,1)' }}>
          <circle cx={cx + r} cy={cy} r={stroke / 2 + 3} fill="#fff" stroke="rgba(14,17,22,.12)" strokeWidth="1.5" />
          <circle cx={cx + r} cy={cy} r={stroke / 4} fill="#0E1116" />
        </g>
      </svg>
      <div className={`ct ${half ? 'half' : ''}`}><div>{children}</div></div>
    </div>
  );
}

function BarList({ rows, color = GRAD, max }) {
  const mx = max || Math.max(...rows.map((r) => r.v), 1);
  if (!rows.length) return <div className="ap-empty">No data yet</div>;
  return rows.map((r, i) => (
    <div className="ap-bar-row" key={`${r.label}-${i}`}>
      <div className="nm" title={r.label}>{r.label}</div>
      <div className="ap-track"><div className="ap-fill" style={{ width: `${clamp((r.v / mx) * 100, 1.5, 100)}%`, background: r.color || color, animationDelay: `${i * 70}ms` }} /></div>
      <div className="n">{r.display != null ? r.display : fmtNum(r.v)}</div>
    </div>
  ));
}

function Spark({ values, color = '#2FBF71', w = 130, h = 48, id = 'sp' }) {
  const n = values.length;
  if (!n) return null;
  const mx = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / Math.max(1, n - 1)) * w, h - 4 - (v / mx) * (h - 10)]);
  const line = curve(pts, true, 2, h - 2);
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <defs><linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".3" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#sp-${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" pathLength="1" className="ap-draw" />
      <circle cx={pts[n - 1][0]} cy={pts[n - 1][1]} r="3.6" fill="#fff" stroke={color} strokeWidth="2.2" />
    </svg>
  );
}

function Ticker({ label, value, delta, series, color, id }) {
  return (
    <div className="ap-tick">
      <div>
        <div className="lb">{label}</div>
        <div className="vl"><CountUp value={value} /></div>
        {delta != null ? <span className={delta >= 0 ? 'up' : 'dn'}>{delta >= 0 ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{Math.abs(delta).toFixed(1)}% <span style={{ color: 'var(--mute)', fontWeight: 600 }}>vs prior 7d</span></span> : <span style={{ color: 'var(--mute)', fontSize: 12.5, fontWeight: 600 }}>no prior week yet</span>}
      </div>
      <Spark values={series} color={color} id={id} />
    </div>
  );
}

/* hero chart: capsule bars (events, green up / orange down) + smooth DAU curve + forecast */
function HeroChart({ A }) {
  const [range, setRange] = useState(14);
  const [hover, setHover] = useState(null);
  const N = A.N, fc = A.forecast.points;
  const R = Math.min(range, N);
  const s = N - R;
  const total = R + fc.length;
  const W = 900, H = 330, L = 44, Rr = 44, T = 34, B = 34;
  const iw = W - L - Rr, ih = H - T - B;
  const evs = A.evPerDay.slice(s), dau = A.dau.slice(s), keys = A.dayKeys.slice(s);
  const maxE = Math.max(...evs, 1) * 1.15;
  const maxD = Math.max(...dau, ...fc.map((p) => p.hi), 1) * 1.2;
  const x = (j) => L + (j + 0.5) * (iw / total);
  const yE = (v) => T + ih - (v / maxE) * ih;
  const yD = (v) => T + ih - (v / maxD) * ih;
  const pts = dau.map((v, j) => [x(j), yD(v)]);
  const line = curve(pts, true, T, T + ih);
  const area = `${line} L${x(R - 1)},${T + ih} L${x(0)},${T + ih} Z`;
  const fcPts = [[x(R - 1), yD(dau[R - 1])], ...fc.map((p, j) => [x(R + j), yD(p.v)])];
  const hiPts = [[x(R - 1), yD(dau[R - 1])], ...fc.map((p, j) => [x(R + j), yD(p.hi)])];
  const loPts = [[x(R - 1), yD(dau[R - 1])], ...fc.map((p, j) => [x(R + j), yD(p.lo)])].reverse();
  const band = `${curve(hiPts, true, T, T + ih)} ${curve(loPts, false, T, T + ih)} Z`;
  const bw = clamp((iw / total) * 0.34, 5, 14);
  const anom = new Map(A.anomalies.filter((a) => a.i >= s).map((a) => [a.i - s, a]));
  const lastX = x(R - 1), lastY = yD(dau[R - 1]);
  const endFc = fcPts[fcPts.length - 1];

  let tip = null;
  if (hover != null) {
    if (hover < R) {
      const a = anom.get(hover);
      tip = { title: fmtDayLong(keys[hover]) + (hover === R - 1 ? ' (today so far)' : ''), lines: [`${fmtNum(evs[hover])} events`, `${dau[hover]} active users`, `${A.signups[s + hover]} signups`].concat(a ? [`Anomaly ${a.z > 0 ? '+' : ''}${a.z.toFixed(1)}σ`] : []) };
    } else {
      const p = fc[hover - R];
      tip = { title: `Forecast · ${fmtDayLong(p.key)}`, lines: [`~${Math.round(p.v)} users`, `80% band ${Math.round(p.lo)}–${Math.round(p.hi)}`] };
    }
  }
  const tipLeft = hover != null ? clamp((x(hover) / W) * 100, 12, 88) : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <div className="ap-legend">
          <span><i style={{ background: '#7BD84F' }} />Events up</span>
          <span><i style={{ background: '#F5A524' }} />Events down</span>
          <span><i style={{ background: 'linear-gradient(90deg,#9BE15D,#F2542D)' }} />Active users</span>
          <span><i style={{ background: '#C9B8F5' }} />Forecast</span>
        </div>
        <div className="ap-seg">{[7, 14, 30].map((r) => <button key={r} className={range === r ? 'on' : ''} onClick={() => { setRange(r); setHover(null); }}>{r}D</button>)}</div>
      </div>
      <div className="ap-chartwrap">
        {tip && (
          <div className="ap-tip" style={{ left: `${tipLeft}%` }}><b>{tip.title}</b>{tip.lines.map((l) => <div key={l}>{l}</div>)}</div>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)} key={range}>
          <defs>
            <linearGradient id="hc-stroke" gradientUnits="userSpaceOnUse" x1={L} y1="0" x2={W - Rr} y2="0"><stop offset="0" stopColor="#9BE15D" /><stop offset=".55" stopColor="#F5A524" /><stop offset="1" stopColor="#F2542D" /></linearGradient>
            <linearGradient id="hc-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#F5A524" stopOpacity=".28" /><stop offset="1" stopColor="#9BE15D" stopOpacity="0" /></linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((r) => (
            <g key={r}>
              <line x1={L} x2={W - Rr} y1={T + ih * r} y2={T + ih * r} stroke="rgba(14,17,22,.07)" strokeDasharray="3 6" />
              <text x={L - 10} y={T + ih * r + 4} textAnchor="end" fontSize="10.5" fill="#9AA7AD">{Math.round(maxE * (1 - r))}</text>
              <text x={W - Rr + 10} y={T + ih * r + 4} fontSize="10.5" fill="#E19A2B">{Math.round(maxD * (1 - r))}</text>
            </g>
          ))}
          <rect x={x(R) - iw / total / 2} y={T} width={iw - (x(R) - iw / total / 2 - L)} height={ih} rx="14" fill="#8B7CF6" opacity="0.06" />
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={T - 8} y2={T + ih} stroke="#0E1116" strokeOpacity=".35" strokeDasharray="3 4" />}
          {evs.map((v, j) => {
            const prevV = j > 0 ? evs[j - 1] : A.evPerDay[s - 1] != null ? A.evPerDay[s - 1] : v;
            const up = v >= prevV;
            return <rect key={j} className="ap-bar" style={{ animationDelay: `${j * 25}ms` }} x={x(j) - bw / 2} y={yE(v)} width={bw} height={Math.max(3, T + ih - yE(v))} rx={bw / 2} fill={up ? '#7BD84F' : '#F5A524'} opacity={j === R - 1 ? 0.5 : 0.9} />;
          })}
          <path d={area} fill="url(#hc-area)" style={{ animation: 'ap-fade 1.2s ease both' }} />
          <path d={band} fill="#8B7CF6" opacity=".12" />
          <path d={line} fill="none" stroke="url(#hc-stroke)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" pathLength="1" className="ap-draw" />
          <path d={curve(fcPts, true, T, T + ih)} fill="none" stroke="#8B7CF6" strokeOpacity=".85" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" />
          {[...anom.entries()].map(([j, a]) => <circle key={j} cx={x(j)} cy={yE(a.value) - 12} r="5.5" fill="#fff" stroke="#F2542D" strokeWidth="2.6" />)}
          <g>
            <circle className="ap-halo" cx={lastX} cy={lastY} r="10" fill="#F2542D" opacity=".4" />
            <circle cx={lastX} cy={lastY} r="9" fill="#F2542D" stroke="#fff" strokeWidth="3.5" style={{ filter: 'drop-shadow(0 6px 10px rgba(242,84,45,.45))' }} />
          </g>
          <circle cx={endFc[0]} cy={endFc[1]} r="8" fill="#B7BCC4" stroke="#fff" strokeWidth="3.5" />
          {Array.from({ length: total }, (_, j) => j).filter((j) => j % Math.ceil(total / 8) === 0 || j === total - 1).map((j) => (
            <text key={j} x={x(j)} y={H - 10} textAnchor="middle" fontSize="10.5" fill="#9AA7AD">{fmtDay(j < R ? keys[j] : fc[j - R].key)}</text>
          ))}
          {Array.from({ length: total }, (_, j) => <rect key={`h${j}`} x={x(j) - iw / total / 2} y={T - 10} width={iw / total} height={ih + 10} fill="transparent" onMouseEnter={() => setHover(j)} />)}
        </svg>
      </div>
    </div>
  );
}

/* flowing gradient ribbon funnel (reference: percentage pills over dashed guides) */
function RibbonFunnel({ stages }) {
  const W = 900, H = 262, cy = 128, H0 = 132;
  const n = stages.length;
  const xs = stages.map((_, i) => 70 + (i * (W - 140)) / Math.max(1, n - 1));
  const base = Math.max(stages[0].v, 1);
  const hs = stages.map((s) => Math.max(16, (s.v / base) * H0));
  const layers = [{ k: 1, o: 0.3 }, { k: 0.72, o: 0.55 }, { k: 0.46, o: 0.95 }];
  const build = (k) => {
    const up = [[0, cy - (hs[0] * k) / 2], ...xs.map((x, i) => [x, cy - (hs[i] * k) / 2]), [W, cy - (hs[n - 1] * k) / 2]];
    const lo = [[0, cy + (hs[0] * k) / 2], ...xs.map((x, i) => [x, cy + (hs[i] * k) / 2]), [W, cy + (hs[n - 1] * k) / 2]].reverse();
    return `${curve(up, true, 40, 216)} ${curve(lo, false, 40, 216)} Z`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id="rb-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
          <stop offset="0" stopColor="#8BE05E" /><stop offset=".45" stopColor="#F2C230" /><stop offset=".75" stopColor="#F5882A" /><stop offset="1" stopColor="#F2542D" />
        </linearGradient>
      </defs>
      <g className="ap-growy">
        {layers.map((l, i) => <path key={i} d={build(l.k)} fill="url(#rb-g)" opacity={l.o} />)}
      </g>
      {xs.map((x, i) => (
        <g key={i} style={{ animation: `ap-fade .9s var(--ease) ${0.3 + i * 0.12}s both` }}>
          <line x1={x} x2={x} y1="44" y2="210" stroke="#0E1116" strokeOpacity=".55" strokeWidth="1.6" strokeDasharray="2 5" strokeLinecap="round" />
          <rect x={x - 36} y="6" width="72" height="30" rx="15" fill="#fff" stroke="rgba(14,17,22,.08)" />
          <text x={x} y="26" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#0E1116" fontFamily="Manrope,sans-serif">{fmtPct((stages[i].v / base) * 100)}</text>
          <rect x={x - 36} y="214" width="72" height="30" rx="15" fill="#fff" stroke="rgba(14,17,22,.08)" />
          <text x={x} y="234" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#0E1116" fontFamily="Manrope,sans-serif">{fmtNum(stages[i].v)}</text>
          <text x={x} y="257" textAnchor="middle" fontSize="11" fontWeight="600" fill="#68757D">{stages[i].label}</text>
        </g>
      ))}
    </svg>
  );
}

/* dark radar (reference: Portfolio Structure) */
function Radar({ axes, goal = 60 }) {
  const cx = 170, cy = 150, R = 98;
  const ang = (i) => (-90 + (360 / axes.length) * i) * (Math.PI / 180);
  const pt = (i, v) => [cx + Math.cos(ang(i)) * R * (v / 100), cy + Math.sin(ang(i)) * R * (v / 100)];
  const poly = (vals) => vals.map((v, i) => pt(i, v).join(',')).join(' ');
  return (
    <svg viewBox="0 0 340 300" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {[25, 50, 75, 100].map((lv) => <polygon key={lv} points={poly(axes.map(() => lv))} fill="none" stroke="rgba(255,255,255,.12)" />)}
      {axes.map((a, i) => { const [x, y] = pt(i, 100); return <line key={a.label} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,.12)" />; })}
      <g className="ap-grow" style={{ transformOrigin: `${cx}px ${cy}px` }}>
        <polygon points={poly(axes.map(() => goal))} fill="rgba(245,165,36,.1)" stroke="#F5A524" strokeWidth="1.8" strokeDasharray="5 5" />
        <polygon points={poly(axes.map((a) => a.value))} fill="rgba(155,225,93,.32)" stroke="#9BE15D" strokeWidth="2.4" strokeLinejoin="round" />
        {axes.map((a, i) => { const [x, y] = pt(i, a.value); return <circle key={a.label} cx={x} cy={y} r="4.5" fill="#0E1116" stroke="#9BE15D" strokeWidth="2.4" />; })}
      </g>
      {axes.map((a, i) => {
        const [x, y] = [cx + Math.cos(ang(i)) * (R + 24), cy + Math.sin(ang(i)) * (R + 20)];
        const c = Math.cos(ang(i));
        return <text key={a.label} x={x} y={y + 4} fontSize="11" fontWeight="700" letterSpacing="1" fill="#C9D2D8" textAnchor={Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end'}>{a.label.toUpperCase()}</text>;
      })}
    </svg>
  );
}

function Heatmap({ grid }) {
  const mx = Math.max(...grid.flat(), 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="ap-heat">
      <span />
      {Array.from({ length: 24 }, (_, h) => <span key={h} className="hl">{h % 3 === 0 ? h : ''}</span>)}
      {order.map((wd) => (
        <React.Fragment key={wd}>
          <span className="l">{WD[wd]}</span>
          {grid[wd].map((v, h) => <span key={h} className="c" title={`${WD_FULL[wd]} ${fmtHour(h)}: ${v} events`} style={{ background: v ? heatColor(v / mx) : EMPTY_CELL }} />)}
        </React.Fragment>
      ))}
    </div>
  );
}

function HourBars({ values, h = 84 }) {
  const mx = Math.max(...values, 1);
  return (
    <div>
      <svg viewBox={`0 0 240 ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
        {values.map((v, i) => <rect key={i} className="ap-bar" style={{ animationDelay: `${i * 20}ms` }} x={i * 10 + 1.5} width="7" y={h - 2 - (v / mx) * (h - 6)} height={Math.max(2, (v / mx) * (h - 6))} rx="3.5" fill={heatColor(v / mx)} opacity={v ? 1 : 0.35}><title>{`${fmtHour(i)}: ${v}`}</title></rect>)}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--faint)' }}><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
    </div>
  );
}

const Seg = ({ name }) => {
  const c = (SEGMENTS[name] || SEGMENTS.Dormant).color;
  return <span className="ap-badge" style={{ background: `${c}22`, color: c }}>{name}</span>;
};

const Panel = ({ title, icon: Icon, sub, right, children, className = '', style, dark = false }) => (
  <section className={`ap-panel ${dark ? 'dark' : ''} ${className}`} style={style}>
    {(title || right) && (
      <div className="ap-ph">
        <div><h3>{Icon && <Icon size={18} color={dark ? '#9BE15D' : '#0E1116'} />}{title}</h3>{sub && <div className="sub">{sub}</div>}</div>
        {right}
      </div>
    )}
    {children}
  </section>
);

const Empty = ({ title, text }) => <div className="ap-empty"><b>{title}</b>{text}</div>;

/* ============================================================================
   5. MAIN COMPONENT
============================================================================ */
const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'intel', label: 'Pattern Engine', icon: Brain, tag: 'AI' },
  { id: 'timeline', label: 'Timeline', icon: GitBranch },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  { id: 'watcher', label: 'Assignment Watcher', icon: Radio }
];
const TAB_META = {
  overview: ['Welcome back!', 'Platform statistics and health at a glance'],
  intel: ['Pattern Engine', 'Behavioural models that learn from your event stream'],
  timeline: ['Activity Timeline', 'Day-by-hour intensity, sessions and the raw event stream'],
  users: ['Users', 'Segments, churn risk and individual behaviour'],
  feedback: ['Feedback', 'Sentiment and recurring themes'],
  watcher: ['Assignment Watcher', 'McGraw Hill scraper and email alerts']
};

function AdminPortal() {
  const [password, setPassword] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightsError, setInsightsError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [tab, setTab] = useState('overview');
  const [intelTab, setIntelTab] = useState('insights');
  const [query, setQuery] = useState('');
  const [segFilter, setSegFilter] = useState('All');
  const [sortBy, setSortBy] = useState('recent');
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [evFilter, setEvFilter] = useState('all');
  const [qaIdx, setQaIdx] = useState(0);
  const [watcher, setWatcher] = useState(null);
  const [watcherBusy, setWatcherBusy] = useState('');
  const [watcherMsg, setWatcherMsg] = useState('');
  const mainRef = useRef(null);

  const fetchAll = useCallback(async (pw) => {
    const [d, i] = await Promise.allSettled([
      axios.post(`${API_BASE_URL}/api/admin/data`, { password: pw }),
      axios.post(`${API_BASE_URL}/api/admin/insights`, { password: pw, days: 30 })
    ]);
    if (d.status === 'rejected') throw d.reason;
    setData(d.value.data);
    if (i.status === 'fulfilled') { setInsights(i.value.data); setInsightsError(''); }
    else {
      setInsights(null);
      const st = i.reason && i.reason.response && i.reason.response.status;
      setInsightsError(st === 404 ? 'The /api/admin/insights endpoint was not found. Deploy the updated server.js to enable the Pattern Engine.' : (i.reason && i.reason.response && i.reason.response.data && i.reason.response.data.error) || 'Could not load behaviour data for the Pattern Engine.');
    }
    setLoadedAt(new Date());
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      await fetchAll(password);
      setAdminPassword(password); setPassword('');
    } catch (err) {
      setError(err.response?.status === 429 ? (err.response?.data?.error || 'Too many attempts. Try again later.') : 'Invalid password or access denied.');
    } finally { setLoading(false); }
  };

  const refresh = async () => {
    setRefreshing(true);
    try { await fetchAll(adminPassword); setError(''); } catch (err) { setError(err.response?.data?.error || 'Refresh failed.'); } finally { setRefreshing(false); }
  };

  const logout = () => { setData(null); setInsights(null); setAdminPassword(''); setSelectedUser(null); setTab('overview'); };

  const A = useMemo(() => {
    if (!data) return null;
    return analyze(insights || { days: 30, events: [], names: [], users: [] }, data.users || [], data.feedbacks || []);
  }, [data, insights]);

  const nameOf = useCallback((email) => (A && A.userInfo.get(email) && A.userInfo.get(email).name) || email, [A]);

  const loadWatcher = useCallback(async () => {
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/mhe-watch/status`, { password: adminPassword });
      setWatcher(res.data);
    } catch (err) { setWatcherMsg(err.response?.data?.error || 'Could not load watcher status.'); }
  }, [adminPassword]);

  useEffect(() => { if (tab === 'watcher' && adminPassword) loadWatcher(); }, [tab, adminPassword, loadWatcher]);
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTo({ top: 0 }); }, [tab, intelTab]);
  useEffect(() => { if (A && selectedDay == null) setSelectedDay(A.dayKeys[A.N - 1]); }, [A, selectedDay]);

  const watcherAction = async (kind) => {
    setWatcherBusy(kind); setWatcherMsg('');
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/mhe-watch/${kind}`, { password: adminPassword });
      setWatcherMsg(kind === 'test-mail' ? `Test email sent via ${res.data.provider}.` : res.data.message || 'Started.');
      if (kind === 'run') setTimeout(loadWatcher, 4000);
    } catch (err) { setWatcherMsg(err.response?.data?.error || 'Request failed.'); } finally { setWatcherBusy(''); }
  };

  /* -------------------------------- LOGIN -------------------------------- */
  if (!data) {
    return (
      <div className="ap">
        <style>{css}</style>
        <div className="ap-aurora"><i /><i /><i /></div>
        <div className="ap-login">
          <div className="ap-login-grid">
            <div className="ap-hero">
              <h1>Welcome back!</h1>
              <p>A pattern engine that learns your platform's rhythms, forecasts demand, flags anomalies and spots users who are drifting away.</p>
              <ul>
                <li><span className="ic"><Brain size={19} /></span>Behavioural pattern detection</li>
                <li><span className="ic"><TrendingUp size={19} /></span>Seasonal forecasting &amp; anomaly alerts</li>
                <li><span className="ic"><Users size={19} /></span>Segments &amp; churn-risk scoring</li>
                <li><span className="ic"><GitBranch size={19} /></span>Session journeys &amp; timelines</li>
              </ul>
            </div>
            <div className="ap-login-card">
              <div style={{ display: 'inline-flex', background: 'linear-gradient(135deg,#9BE15D,#F5A524)', padding: 14, borderRadius: 18 }}><Hexagon size={30} color="#0E1116" /></div>
              <h2>Admin access</h2>
              <p style={{ color: 'var(--mute)', margin: '0 0 24px' }}>Enter the administrator password to continue.</p>
              <form onSubmit={handleLogin}>
                <input type="password" className="ap-input" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus style={{ marginBottom: 14 }} />
                <button type="submit" className="ap-btn dark block" disabled={loading || !password}>
                  {loading ? <><Loader2 size={18} className="ap-spin" />Authenticating…</> : <><Lock size={18} />Unlock dashboard</>}
                </button>
              </form>
              {error && <div className="ap-alert err"><AlertCircle size={16} />{error}</div>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const K = A.kpi;
  const [title, subtitle] = TAB_META[tab];
  const noEvents = !A.hasData;
  const oltCount = data.users.filter((u) => u.oltUsername).length;

  /* ---------------------------- reusable fragments ---------------------------- */
  const NoData = ({ className = '' }) => <Panel className={className} title="Waiting for behaviour data" icon={AlertCircle}><Empty title="No events to analyse" text={insightsError || 'Once users interact with the app, patterns will appear here.'} /></Panel>;

  const InsightCard = ({ it, i }) => (
    <div className="ap-insight" style={{ animationDelay: `${i * 60}ms` }}>
      <div className="bar" style={{ background: SEV[it.severity].color }} />
      <div>
        <div className="meta">
          <span className="ap-badge" style={{ background: `${SEV[it.severity].color}22`, color: SEV[it.severity].color }}>{SEV[it.severity].label}</span>
          <span className="ap-badge" style={{ background: 'rgba(14,17,22,.06)', color: 'var(--ink2)' }}>{it.tag}</span>
          <span className="ap-conf" title="Statistical confidence in this finding">confidence {it.confidence}% <i><b style={{ width: `${it.confidence}%` }} /></i></span>
        </div>
        <h4>{it.title}</h4>
        <p>{it.body}</p>
      </div>
    </div>
  );

  /* -------------------------------- OVERVIEW -------------------------------- */
  const recent = insights ? insights.events.slice(-7).reverse() : [];
  const Overview = () => (
    <>
      <div className="ap-hd">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="ap-hstats">
          <div className="ap-hstat"><div className="lb">Active today</div><div className="v"><CountUp value={K.activeToday} /><small>users</small><span className="ap-pillv">{fmtNum(K.wau)} weekly</span></div></div>
          <div className="ap-hstat"><div className="lb">Events (7d)</div><div className="v"><CountUp value={K.events7} /><span className="ap-pillv">{K.eventsDelta == null ? 'new' : `${K.eventsDelta >= 0 ? '+' : ''}${K.eventsDelta.toFixed(0)}%`}</span></div></div>
          <div className="ap-hstat"><div className="lb">Signups (7d)</div><div className="v"><CountUp value={K.signups7} /><span className="ap-pillv">{fmtNum(K.totalUsers)} total</span></div></div>
        </div>
      </div>

      <div className="ap-12">
        <Panel className="c5" title="Community" sub={`${fmtPct(K.totalUsers ? (K.mau / K.totalUsers) * 100 : 0)} of registered users were active in the last 30 days`}>
          <div className="ap-gauge-row">
            <ArcGauge id="com" value={K.totalUsers ? (K.mau / K.totalUsers) * 100 : 0} size={220}>
              <div className="big"><CountUp value={K.totalUsers} /></div><div className="cap">Total users</div>
            </ArcGauge>
            <div className="ap-leaders">
              {A.segments.map((s) => (
                <div className="ap-lead" key={s.name}><i style={{ background: SEGMENTS[s.name].color }} />{s.name}<span className="ln" /><span className="vv"><CountUp value={s.count} /></span></div>
              ))}
              {!A.segments.length && <div style={{ color: 'var(--mute)' }}>No users yet</div>}
            </div>
          </div>
        </Panel>

        {noEvents ? <NoData className="c7" /> : (
          <Panel className="c7" title="Activity, forecast & anomalies" icon={TrendingUp} sub="Capsules are daily events, the curve is daily active users, dotted purple is the 7-day forecast">
            <HeroChart A={A} />
          </Panel>
        )}
      </div>

      <div className="ap-12">
        <Panel className="c4"><Ticker id="dau" label="Daily active users" value={K.activeToday} delta={pctDelta(sum(A.dau.slice(-7)), sum(A.dau.slice(-14, -7)))} series={A.dau.slice(-14)} color="#2FBF71" /></Panel>
        <Panel className="c4"><Ticker id="ev" label="Events (7d)" value={K.events7} delta={K.eventsDelta} series={A.evPerDay.slice(-14)} color="#F5A524" /></Panel>
        <Panel className="c4"><Ticker id="su" label="Signups (7d)" value={K.signups7} delta={K.signupsDelta} series={A.signups.slice(-14)} color="#4C8DF6" /></Panel>
      </div>

      <div className="ap-12">
        <Panel className="c7" title="Engagement funnel" icon={Layers} sub="From registration to habit: share of all registered users at each stage">
          <RibbonFunnel stages={A.funnel} />
        </Panel>
        <Panel className="c5" dark title="Platform structure" icon={Target} sub="Five health dimensions against a 60-point goal"
          right={<span className="ap-chip" style={{ background: 'rgba(255,255,255,.08)', color: '#fff', borderColor: 'transparent' }}><span style={{ color: '#9BE15D' }}>{Math.round(clamp((A.health / 60) * 100, 0, 100))}%</span> of goal</span>}>
          <Radar axes={A.radar} />
          <div style={{ display: 'grid', gap: 9, marginTop: 6 }}>
            {A.radar.map((r) => (
              <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 34px', gap: 10, alignItems: 'center', fontSize: 12.5 }} title={r.hint}>
                <span style={{ color: '#C9D2D8', fontWeight: 600 }}>{r.label}</span>
                <div className="ap-track"><div className="ap-fill" style={{ width: `${clamp(r.value, 1.5, 100)}%`, background: GRAD }} /></div>
                <b style={{ textAlign: 'right' }}>{Math.round(r.value)}</b>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="ap-12">
        <Panel className="c4" title="Health" icon={Activity} right={<a style={{ fontSize: 12.5, color: 'var(--mute)', fontWeight: 700, cursor: 'pointer' }} onClick={() => setTab('intel')}>Explore insights ↗</a>}>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <ArcGauge id="health" half size={250} stroke={22} stops={['#F5A524', '#C8D63B', '#6FC24A']} value={A.health}>
              <div className="big" style={{ fontSize: 40 }}><CountUp value={A.health} format={(v) => `${Math.round(v)}%`} /></div>
              <div className="cap" style={{ letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: 800, color: 'var(--ink)' }}>{A.healthLabel}</div>
            </ArcGauge>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--mute)', fontWeight: 700, padding: '0 14px' }}><span>0%</span><span>100%</span></div>
          <div className="ap-note" style={{ textAlign: 'center' }}>Weakest dimension: <b style={{ color: 'var(--ink)' }}>{A.weakest.label}</b> ({Math.round(A.weakest.value)}). {A.weakest.hint}.</div>
        </Panel>
        <Panel className="c4" title="Most used features" icon={BarChart3} sub="Tab and action events, last 30 days">
          <BarList rows={A.topEvents.map((e) => ({ label: e.label, v: e.count, display: fmtNum(e.count) }))} />
        </Panel>
        <Panel className="c4" title="Live activity" icon={Zap} sub="Newest events">
          {recent.length ? recent.map(([t, u, n], i) => {
            const email = insights.users[u], meta = A.nameMeta[n];
            const col = (SEGMENTS[A.segOf.get(email)] || SEGMENTS.Dormant).color;
            return (
              <div className="ap-live" key={`${t}-${i}`} style={{ animationDelay: `${i * 70}ms` }}>
                <span className="ap-avatar" style={{ width: 36, height: 36, background: `${col}33`, color: col }}>{initials(nameOf(email))}</span>
                <div className="tx"><b>{nameOf(email)}</b><span>{meta.name === 'app_opened' ? 'opened the app' : meta.name === 'new_signup' ? 'signed up' : meta.label}</span></div>
                <div className="tm">{timeAgo(t * 1000)}</div>
              </div>
            );
          }) : <Empty title="Nothing yet" text="Events appear here as they happen." />}
        </Panel>
      </div>

      {!noEvents && (
        <div className="ap-12">
          <Panel className="c12" title="Engine headlines" icon={Sparkles} sub="Highest-severity findings from the Pattern Engine" right={<button className="ap-btn" onClick={() => setTab('intel')}>Open engine</button>}>
            <div className="ap-grid ap-2" style={{ gap: '0 20px' }}>
              {A.insights.slice(0, 4).map((it, i) => <InsightCard key={it.id} it={it} i={i} />)}
            </div>
          </Panel>
        </div>
      )}
    </>
  );

  /* ------------------------------ PATTERN ENGINE ------------------------------ */
  const Intel = () => (
    <>
      <div className="ap-hd"><div><h1>{title}</h1><p>{subtitle}</p></div><span className="ap-chip"><Brain size={14} />{fmtNum(A.totalEvents)} events · {fmtNum(A.users.length)} users · {A.N}d window</span></div>
      {noEvents ? <NoData /> : (
        <>
          <div className="ap-pills">
            {[['insights', 'Insights', Sparkles], ['rhythm', 'Rhythm', Clock], ['segments', 'Segments & churn', Users], ['journeys', 'Journeys', GitBranch], ['retention', 'Retention', Repeat]].map(([id, label, Icon]) => (
              <button key={id} className={`ap-pill ${intelTab === id ? 'on' : ''}`} onClick={() => setIntelTab(id)}><Icon size={14} />{label}</button>
            ))}
          </div>

          {intelTab === 'insights' && (
            <div className="ap-12">
              <div className="c8" style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
                <Panel dark title="Ask the engine" icon={Brain} sub="Answers are computed from your own data, not canned text">
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {A.qa.map((x, i) => <button key={x.q} className={`ap-q ${qaIdx === i ? 'on' : ''}`} onClick={() => setQaIdx(i)}>{x.q}</button>)}
                  </div>
                  <div className="ap-answer" key={qaIdx}>{A.qa[qaIdx] && A.qa[qaIdx].a}</div>
                </Panel>
                <Panel title={`Findings (${A.insights.length})`} icon={Sparkles} sub="Ranked by severity, then confidence">
                  {A.insights.map((it, i) => <InsightCard key={it.id} it={it} i={i} />)}
                </Panel>
              </div>
              <div className="c4" style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
                <Panel title="7-day forecast" icon={TrendingUp} sub={`Trend ${A.trend.dir === 'up' ? '▲ rising' : A.trend.dir === 'down' ? '▼ falling' : '▬ flat'} · R² ${A.trend.r2.toFixed(2)}`}>
                  <table className="ap-table">
                    <thead><tr><th>Day</th><th>Users</th><th>80% band</th></tr></thead>
                    <tbody>
                      <tr><td>Today (so far {A.dau[A.todayI]})</td><td><b>~{Math.round(A.forecast.expectedToday)}</b></td><td>expected</td></tr>
                      {A.forecast.points.map((p) => <tr key={p.key}><td>{fmtDayLong(p.key)}</td><td><b>{Math.round(p.v)}</b></td><td style={{ color: 'var(--mute)' }}>{Math.round(p.lo)}–{Math.round(p.hi)}</td></tr>)}
                    </tbody>
                  </table>
                </Panel>
                <Panel title="Anomalies" icon={ShieldAlert} sub="Robust z-score on weekday-adjusted volume">
                  {A.anomalies.length ? A.anomalies.slice(0, 6).map((a) => (
                    <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderTop: '1px solid rgba(14,17,22,.06)' }}>
                      <div><b>{fmtDayLong(a.key)}</b><div style={{ fontSize: 12, color: 'var(--mute)' }}>{fmtNum(a.value)} events vs ~{fmtNum(Math.round(a.expected))} expected</div></div>
                      <span className="ap-badge" style={{ background: a.z > 0 ? '#2FBF7122' : '#F2542D22', color: a.z > 0 ? '#17935a' : '#d6401d' }}>{a.z > 0 ? '▲' : '▼'} {Math.abs(a.z).toFixed(1)}σ</span>
                    </div>
                  )) : <Empty title="Nothing unusual" text="Every recent day sits within its normal range." />}
                </Panel>
              </div>
            </div>
          )}

          {intelTab === 'rhythm' && (
            <div className="ap-grid">
              <Panel title="Weekly rhythm" icon={Clock} sub="Events by weekday and hour (IST). Warmer means busier.">
                <Heatmap grid={A.grid} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
                  <span className="ap-chip"><Flame size={14} color="#F2542D" />Peak {fmtHour(A.peak.start)}–{fmtHour(A.peak.start + 3)} · {fmtPct(A.peak.share * 100)}</span>
                  <span className="ap-chip"><Moon size={14} color="#4C8DF6" />Quiet {fmtHour(A.quiet.start)}–{fmtHour(A.quiet.start + 2)} · {fmtPct(A.quiet.share * 100, 1)}</span>
                  <span className="ap-chip"><Calendar size={14} />Best day {WD_FULL[A.bestWd.wd]}</span>
                </div>
              </Panel>
              <div className="ap-grid ap-3">
                <Panel title="Hour of day" icon={Clock} sub="All users, all days"><HourBars values={A.hourTotals} /></Panel>
                <Panel title="Weekday strength" icon={Calendar} sub="Seasonal index (1.0 = average day)">
                  <BarList rows={[1, 2, 3, 4, 5, 6, 0].map((wd) => ({ label: WD[wd], v: A.evIdx[wd], display: A.evIdx[wd].toFixed(2), color: A.evIdx[wd] >= 1 ? 'linear-gradient(90deg,#9BE15D,#2FBF71)' : 'linear-gradient(90deg,#F5C24A,#F5A524)' }))} max={Math.max(...A.evIdx) * 1.1} />
                </Panel>
                <Panel title="Chronotypes" icon={Sun} sub="Users grouped by when they usually show up">
                  <BarList rows={A.chrono.map((c) => ({ label: c.k, v: c.v }))} />
                  <div className="ap-note">Only users with at least 5 events.</div>
                </Panel>
                <Panel title="Session length" icon={Layers} sub={`Median ${fmtDur(A.sessionStats.medianDur)} · ${fmtPct(A.sessionStats.bounce * 100)} single-action`}>
                  <BarList rows={A.sessionStats.buckets.map((b) => ({ label: b.label, v: b.v }))} />
                  <div className="ap-note">A session ends after 30 minutes of inactivity.</div>
                </Panel>
              </div>
            </div>
          )}

          {intelTab === 'segments' && (
            <div className="ap-grid">
              <Panel title="User segments" icon={Users} sub="k-means clustering on volume, active days, recency and session depth">
                <div className="ap-segbar">{A.segments.map((s) => <div key={s.name} title={`${s.name}: ${s.count}`} style={{ width: `${s.share}%`, background: SEGMENTS[s.name].color }} />)}</div>
                <div className="ap-grid ap-3">
                  {A.segments.map((s) => (
                    <div className="ap-card" key={s.name} style={{ borderTop: `4px solid ${SEGMENTS[s.name].color}` }}>
                      <h4>{s.name}<span className="ap-badge" style={{ background: 'rgba(14,17,22,.06)', color: 'var(--ink2)' }}>{s.count} · {fmtPct(s.share)}</span></h4>
                      <p>{SEGMENTS[s.name].desc}</p>
                      {s.name !== 'Dormant' && (
                        <dl>
                          <dt>Share of activity</dt><dd>{fmtPct(s.eventShare)}</dd>
                          <dt>Avg events</dt><dd>{s.avgEvents.toFixed(0)}</dd>
                          <dt>Avg active days</dt><dd>{s.avgActiveDays.toFixed(1)}</dd>
                          <dt>Avg sessions</dt><dd>{s.avgSessions.toFixed(1)}</dd>
                          <dt>Last seen</dt><dd>{s.avgRecency.toFixed(1)}d ago</dd>
                        </dl>
                      )}
                    </div>
                  ))}
                </div>
              </Panel>
              <div className="ap-grid ap-2">
                <Panel title="Churn watchlist" icon={ShieldAlert} sub="Users overdue relative to their own visit rhythm (needs 3+ active days)">
                  {A.atRisk.length ? (
                    <table className="ap-table"><thead><tr><th>User</th><th>Quiet</th><th>Usual gap</th><th>Risk</th></tr></thead>
                      <tbody>{A.atRisk.slice(0, 8).map((u) => (
                        <tr key={u.email} className="row" onClick={() => setSelectedUser(u.email)}>
                          <td><b>{nameOf(u.email)}</b></td><td>{u.recency}d</td><td>{u.avgGap ? `${u.avgGap.toFixed(1)}d` : '—'}</td>
                          <td><span className="ap-meter"><i style={{ width: `${u.risk}%`, background: u.risk > 75 ? '#F2542D' : '#F5A524' }} /></span> {Math.round(u.risk)}%</td>
                        </tr>))}</tbody></table>
                  ) : <Empty title="No one overdue" text="Everyone with an established pattern is on schedule." />}
                </Panel>
                <Panel title="Power users" icon={Flame} sub="Highest event volume in the window">
                  <table className="ap-table"><thead><tr><th>User</th><th>Events</th><th>Active days</th><th>Segment</th></tr></thead>
                    <tbody>{A.powerUsers.map((u) => (
                      <tr key={u.email} className="row" onClick={() => setSelectedUser(u.email)}>
                        <td><b>{nameOf(u.email)}</b></td><td>{fmtNum(u.events)}</td><td>{u.activeDays}</td><td><Seg name={u.segment} /></td>
                      </tr>))}</tbody></table>
                </Panel>
              </div>
            </div>
          )}

          {intelTab === 'journeys' && (
            <div className="ap-grid">
              <Panel title="Predicted journey" icon={GitBranch} sub={`Markov model over ${fmtNum(A.seqSessions)} sessions: each step is the most probable next action`}>
                {A.path.length ? (
                  <div className="ap-flow">
                    {A.path.map((p, i) => (
                      <React.Fragment key={`${p.n}-${i}`}>
                        {i > 0 && <div className="ap-arrow">→</div>}
                        <div className="ap-node" style={{ animationDelay: `${i * 120}ms` }}><b>{p.label}</b><span>{i === 0 ? `${fmtPct(p.prob * 100)} start here` : `${fmtPct(p.prob * 100)} likely`}</span></div>
                      </React.Fragment>
                    ))}
                  </div>
                ) : <Empty title="Not enough sessions" text="Journeys appear after a few multi-step sessions." />}
              </Panel>
              <div className="ap-grid ap-2">
                <Panel title="Strongest transitions" icon={Zap} sub="From one action straight to the next">
                  <BarList rows={A.edges.map((e) => ({ label: `${e.fromLabel} → ${e.toLabel}`, v: e.prob * 100, display: `${(e.prob * 100).toFixed(0)}%` }))} max={100} />
                </Panel>
                <Panel title="Feature affinity" icon={Layers} sub="Pairs used together more than chance (lift)">
                  {A.affinity.length ? (
                    <table className="ap-table"><thead><tr><th>Pair</th><th>Lift</th><th>Sessions</th></tr></thead>
                      <tbody>{A.affinity.map((p) => <tr key={`${p.a}${p.b}`}><td style={{ textTransform: 'capitalize' }}><b>{p.a}</b> + <b>{p.b}</b></td><td>{p.lift.toFixed(1)}×</td><td>{p.count}</td></tr>)}</tbody></table>
                  ) : <Empty title="No strong pairs yet" text="Needs a few more multi-feature sessions." />}
                </Panel>
                <Panel title="Where sessions begin" icon={Play}>
                  <BarList rows={A.starts.map((s) => ({ label: s.label, v: s.share * 100, display: fmtPct(s.share * 100) }))} max={100} />
                </Panel>
                <Panel title="Where sessions end" icon={X} sub="Share of visits to a screen that were the last action">
                  <BarList rows={A.exits.map((s) => ({ label: s.label, v: s.rate * 100, display: fmtPct(s.rate * 100) }))} max={100} />
                </Panel>
              </div>
            </div>
          )}

          {intelTab === 'retention' && (
            <div className="ap-grid">
              <Panel title="Weekly signup cohorts" icon={Repeat} sub="% of each cohort active in week N after signing up">
                {A.cohorts.length ? (
                  <div style={{ overflow: 'auto' }}>
                    <table className="ap-table ap-cohort"><thead><tr><th>Cohort (week of)</th><th>Users</th>{[0, 1, 2, 3, 4].map((k) => <th key={k} style={{ textAlign: 'center' }}>W{k}</th>)}</tr></thead>
                      <tbody>{A.cohorts.map((c) => (
                        <tr key={c.label}><td className="k"><b>{c.label}</b></td><td>{c.size}</td>
                          {c.cells.map((cell, k) => <td key={k} style={cell ? { background: heatColor(cell.pct / 100), borderRadius: 10, color: cell.pct > 70 ? '#fff' : 'var(--ink)' } : { color: 'var(--faint)' }}>{cell ? `${cell.pct.toFixed(0)}%` : '·'}</td>)}</tr>))}</tbody></table>
                  </div>
                ) : <Empty title="No recent cohorts" text="Cohorts appear when users sign up within the last five weeks." />}
                <div className="ap-note">Activity data covers {A.N} days, so older cohorts can only show their most recent weeks accurately.</div>
              </Panel>
              <div className="ap-grid ap-2">
                <Panel title="Sections" icon={Layers} sub="Active in the last 7 days / total users">
                  <table className="ap-table"><thead><tr><th>Section</th><th>Users</th><th>Active 7d</th><th>Events/user</th><th>OLT</th></tr></thead>
                    <tbody>{A.sections.map((s) => <tr key={s.section}><td><b>{s.section}</b></td><td>{s.users}</td><td>{s.active7}</td><td>{s.users ? (s.events / s.users).toFixed(1) : 0}</td><td>{s.olt}</td></tr>)}</tbody></table>
                </Panel>
                <Panel title="OLT effect" icon={Target} sub="Do users who linked OLT use the app more?">
                  {A.oltEffect ? (
                    <div style={{ textAlign: 'center', padding: '18px 0' }}>
                      <div className="num" style={{ fontSize: 56, fontWeight: 800, letterSpacing: -2, color: A.oltEffect >= 1 ? '#17935a' : '#d6401d' }}><CountUp value={A.oltEffect} format={(v) => `${v.toFixed(1)}×`} /></div>
                      <div style={{ color: 'var(--mute)', fontWeight: 600 }}>events per user, linked vs not linked</div>
                    </div>
                  ) : <Empty title="Not enough users" text="Needs at least 3 active users in each group." />}
                </Panel>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );

  /* -------------------------------- TIMELINE -------------------------------- */
  const Timeline = () => {
    const keys = A.dayKeys.slice(-14);
    const mx = Math.max(...A.dayHour.slice(-14).flat(), 1);
    const dIdx = A.dayKeys.indexOf(selectedDay);
    const dayEvents = [];
    const ds = dayStartSec(selectedDay || A.dayKeys[A.N - 1]);
    if (dIdx >= 0 && insights) {
      for (const [t, u, n] of insights.events) if (t >= ds && t < ds + 86400) dayEvents.push({ t, email: insights.users[u], meta: A.nameMeta[n] });
    }
    const typeSet = ['all', ...new Set(dayEvents.map((e) => e.meta.type))];
    const shown = dayEvents.filter((e) => evFilter === 'all' || e.meta.type === evFilter).slice().reverse().slice(0, 200);
    const sess = A.sessions.filter((s) => s.start >= ds && s.start < ds + 86400);
    const perUser = new Map();
    sess.forEach((s) => perUser.set(s.email, (perUser.get(s.email) || 0) + s.items.length));
    const lanes = [...perUser.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([e]) => e);
    return (
      <>
        <div className="ap-hd"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
        {noEvents ? <NoData /> : (
          <div className="ap-grid">
            <Panel title="Intensity by day and hour" icon={Calendar} sub="Last 14 days, IST. Click a day to inspect it.">
              {keys.map((k) => {
                const di = A.dayKeys.indexOf(k);
                return (
                  <div key={k} className={`ap-strip ${selectedDay === k ? 'on' : ''}`} onClick={() => setSelectedDay(k)}>
                    <span className="d">{fmtDayLong(k)}</span>
                    {A.dayHour[di].map((v, h) => <span key={h} className="c" title={`${fmtDayLong(k)} ${fmtHour(h)}: ${v} events`} style={{ background: v ? heatColor(v / mx) : EMPTY_CELL }} />)}
                    <span className="t">{fmtNum(A.evPerDay[di])}</span>
                  </div>
                );
              })}
              <div style={{ display: 'grid', gridTemplateColumns: '86px 1fr 56px', gap: 3, padding: '6px 8px 0' }}>
                <span /><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--faint)' }}><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div><span />
              </div>
            </Panel>

            <Panel title={`Session swimlanes · ${fmtDayLong(selectedDay)}`} icon={GitBranch} sub={`${sess.length} sessions · ${perUser.size} users. Bars are sessions; colour is the user's segment.`}>
              {lanes.length ? (
                <>
                  {lanes.map((email) => (
                    <div className="ap-lane" key={email}>
                      <div className="who" title={email} onClick={() => setSelectedUser(email)}>{nameOf(email)}</div>
                      <div className="rail">
                        {sess.filter((s) => s.email === email).map((s, i) => {
                          const left = clamp(((s.start - ds) / 86400) * 100, 0, 100);
                          const w = Math.max(0.5, ((s.end - s.start) / 86400) * 100);
                          return <span key={i} className="seg" title={`${fmtClock(s.start)}–${fmtClock(s.end)} · ${s.items.length} actions`} style={{ left: `${left}%`, width: `${Math.min(w, 100 - left)}%`, background: (SEGMENTS[A.segOf.get(email)] || SEGMENTS.Dormant).color }} />;
                        })}
                      </div>
                    </div>
                  ))}
                  <div className="ap-axis"><span /><div className="ax"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>
                </>
              ) : <Empty title="No sessions that day" text="Pick another day from the grid above." />}
            </Panel>

            <Panel title={`Event stream · ${fmtDayLong(selectedDay)}`} icon={Activity} sub={`${fmtNum(dayEvents.length)} events (newest first, max 200 shown)`}
              right={<div className="ap-seg" style={{ flexWrap: 'wrap' }}>{typeSet.map((t) => <button key={t} className={evFilter === t ? 'on' : ''} onClick={() => setEvFilter(t)}>{t.replace(/_/g, ' ')}</button>)}</div>}>
              <div className="ap-stream">
                {shown.length ? shown.map((e, i) => (
                  <div className="ap-ev" key={i} style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
                    <span className="tm">{fmtClock(e.t)}</span>
                    <span><b style={{ cursor: 'pointer' }} onClick={() => setSelectedUser(e.email)}>{nameOf(e.email)}</b> <span style={{ color: 'var(--mute)' }}>·</span> <span style={{ textTransform: 'capitalize' }}>{e.meta.label}</span></span>
                    <span className="ap-badge" style={{ background: 'rgba(14,17,22,.06)', color: 'var(--ink2)' }}>{e.meta.type.replace(/_/g, ' ')}</span>
                  </div>
                )) : <Empty title="No events" text="Nothing matches this filter." />}
              </div>
            </Panel>
          </div>
        )}
      </>
    );
  };

  /* ---------------------------------- USERS ---------------------------------- */
  const UsersTab = () => {
    const q = query.toLowerCase();
    const rows = data.users.map((u) => ({ db: u, us: A.userMap.get(u.email), seg: A.segOf.get(u.email) || 'Dormant' }))
      .filter((r) => ((r.db.name || '').toLowerCase().includes(q) || (r.db.email || '').toLowerCase().includes(q)) && (segFilter === 'All' || r.seg === segFilter))
      .sort((a, b) => sortBy === 'events' ? (b.us ? b.us.events : 0) - (a.us ? a.us.events : 0) : sortBy === 'risk' ? (b.us && b.us.riskConfident ? b.us.risk : -1) - (a.us && a.us.riskConfident ? a.us.risk : -1) : new Date(b.db.lastActive || 0) - new Date(a.db.lastActive || 0));
    return (
      <>
        <div className="ap-hd"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
        <div className="ap-toolbar">
          <div className="ap-search"><Search size={16} /><input className="ap-input" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <select className="ap-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="recent">Sort: last active</option><option value="events">Sort: events</option><option value="risk">Sort: churn risk</option>
          </select>
          <div className="ap-seg" style={{ flexWrap: 'wrap' }}>{['All', ...Object.keys(SEGMENTS)].map((s) => <button key={s} className={segFilter === s ? 'on' : ''} onClick={() => setSegFilter(s)}>{s}</button>)}</div>
        </div>
        <Panel title={`${rows.length} user${rows.length === 1 ? '' : 's'}`} icon={Users}>
          <div style={{ overflow: 'auto' }}>
            <table className="ap-table">
              <thead><tr><th>User</th><th>Segment</th><th>Sec</th><th>Events</th><th>Active days</th><th>30-day activity</th><th>Churn risk</th><th>Last active</th></tr></thead>
              <tbody>
                {rows.slice(0, 300).map(({ db, us, seg }) => (
                  <tr key={db._id || db.email} className="row" onClick={() => setSelectedUser(db.email)}>
                    <td><div className="ap-user">
                      {db.picture ? <img className="ap-avatar" src={db.picture} alt="" referrerPolicy="no-referrer" /> : <span className="ap-avatar">{initials(db.name)}</span>}
                      <div style={{ minWidth: 0 }}><div className="nm">{db.name || '—'}</div><div className="em">{db.email}</div></div></div></td>
                    <td><Seg name={seg} /></td>
                    <td>{db.defaultSection}</td>
                    <td>{us ? fmtNum(us.events) : 0}</td>
                    <td>{us ? us.activeDays : 0}</td>
                    <td>{us ? <Spark values={us.dayCounts} color={SEGMENTS[seg].color} w={110} h={34} id={`u${db._id || db.email}`} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td>{us && us.riskConfident ? <><span className="ap-meter"><i style={{ width: `${us.risk}%`, background: us.risk > 75 ? '#F2542D' : us.risk > 45 ? '#F5A524' : '#2FBF71' }} /></span> <span style={{ fontSize: 12 }}>{Math.round(us.risk)}%</span></> : <span style={{ color: 'var(--faint)', fontSize: 12 }}>n/a</span>}</td>
                    <td style={{ color: 'var(--mute)', whiteSpace: 'nowrap' }}>{timeAgo(db.lastActive)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 300 && <div className="ap-note">Showing the first 300 matches.</div>}
        </Panel>
      </>
    );
  };

  /* --------------------------------- FEEDBACK --------------------------------- */
  const FeedbackTab = () => {
    const F = A.fb;
    const total = F.items.length || 1;
    const col = { positive: '#2FBF71', negative: '#F2542D', neutral: '#A3B1AE' };
    return (
      <>
        <div className="ap-hd"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
        <div className="ap-12">
          <Panel className="c8" title={`All feedback (${F.items.length})`} icon={MessageSquare}>
            {F.items.length ? F.items.map((f, i) => (
              <div className="ap-fb" key={f._id || i} style={{ borderLeftColor: col[f.sentiment], animationDelay: `${Math.min(i, 10) * 50}ms` }}>
                <header><b>{f.userName || f.userEmail}</b><span style={{ color: 'var(--mute)' }}>{new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · <span style={{ color: col[f.sentiment], fontWeight: 800 }}>{f.sentiment}</span></span></header>
                <p>{f.message}</p>
              </div>
            )) : <Empty title="No feedback yet" text="Messages submitted from the app will show up here." />}
          </Panel>
          <div className="c4" style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
            <Panel title="Sentiment" icon={Sparkles} sub="Lexicon-based, directional only">
              <div className="ap-segbar">{['positive', 'neutral', 'negative'].map((s) => <div key={s} style={{ width: `${(F[s === 'positive' ? 'pos' : s === 'negative' ? 'neg' : 'neu'] / total) * 100}%`, background: col[s] }} />)}</div>
              <div style={{ display: 'flex', gap: 14, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: col.positive, fontWeight: 800 }}>{F.pos} positive</span><span style={{ color: col.neutral, fontWeight: 800 }}>{F.neu} neutral</span><span style={{ color: col.negative, fontWeight: 800 }}>{F.neg} negative</span>
              </div>
            </Panel>
            <Panel title="Recurring themes" icon={Target} sub="Most repeated words across messages">
              <BarList rows={F.topics.map((t) => ({ label: t.word, v: t.count }))} />
            </Panel>
          </div>
        </div>
      </>
    );
  };

  /* --------------------------------- WATCHER --------------------------------- */
  const WatcherTab = () => (
    <>
      <div className="ap-hd"><div><h1>{title}</h1><p>{subtitle}</p></div></div>
      <div className="ap-grid">
        <Panel title="Watcher status" icon={Radio} sub="Scheduled McGraw Hill scrape with email alerts for changes and passed due dates"
          right={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="ap-btn" onClick={loadWatcher}><RefreshCw size={14} />Reload</button>
            <button className="ap-btn" disabled={!!watcherBusy} onClick={() => watcherAction('test-mail')}>{watcherBusy === 'test-mail' ? <Loader2 size={14} className="ap-spin" /> : <Send size={14} />}Test email</button>
            <button className="ap-btn dark" disabled={!!watcherBusy} onClick={() => watcherAction('run')}>{watcherBusy === 'run' ? <Loader2 size={14} className="ap-spin" /> : <Play size={14} />}Run check now</button>
          </div>}>
          {watcherMsg && <div className="ap-alert warn"><AlertCircle size={16} />{watcherMsg}</div>}
          {watcher ? (
            <div className="ap-grid ap-3">
              {[['Enabled', watcher.enabled ? 'Yes' : 'No'], ['Mail provider', watcher.mailProvider], ['Interval', `${watcher.intervalMinutes || '—'} min`], ['Runs', watcher.status.runs], ['Last outcome', watcher.status.lastOutcome], ['Consecutive failures', watcher.consecutiveFailures], ['Last run', watcher.status.lastRunAt ? timeAgo(watcher.status.lastRunAt) : 'never'], ['Next run', watcher.status.nextRunAt ? new Date(watcher.status.nextRunAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'], ['Recipients', (watcher.recipients || []).length]].map(([k, v]) => (
                <div key={k} className="ap-card"><div style={{ fontSize: 11, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '.7px', fontWeight: 700 }}>{k}</div><div className="num" style={{ fontSize: 20, fontWeight: 800, marginTop: 5 }}>{String(v)}</div></div>
              ))}
            </div>
          ) : <Empty title="Loading…" text="Fetching watcher status." />}
          {watcher && watcher.status.lastError && <div className="ap-alert err"><AlertCircle size={16} />Last error: {watcher.status.lastError}</div>}
        </Panel>
        {watcher && watcher.snapshot && (
          <Panel title={`Tracked assignments (${watcher.snapshot.assignments})`} icon={CheckCircle2} sub={`Snapshot updated ${timeAgo(watcher.snapshot.updatedAt)}`}>
            <div style={{ overflow: 'auto' }}>
              <table className="ap-table"><thead><tr><th>Assignment</th><th>Due (IST)</th><th>Time left</th><th>Status</th></tr></thead>
                <tbody>{(watcher.snapshot.data || []).map((a, i) => (
                  <tr key={i}><td><b>{a.name}</b></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{a.dueAt ? new Date(a.dueAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : a.dueDate}</td>
                    <td><span className="ap-badge" style={{ background: a.isPastDue ? '#F2542D22' : '#4C8DF622', color: a.isPastDue ? '#d6401d' : '#2563eb' }}>{a.dueLabel}</span></td>
                    <td><span className="ap-badge" style={{ background: 'rgba(14,17,22,.06)', color: 'var(--ink2)' }}>{String(a.status).replace(/_/g, ' ')}</span></td></tr>
                ))}</tbody></table>
            </div>
          </Panel>
        )}
      </div>
    </>
  );

  /* ------------------------------- USER MODAL ------------------------------- */
  const UserModal = () => {
    const db = A.userInfo.get(selectedUser) || { email: selectedUser, name: selectedUser };
    const us = A.userMap.get(selectedUser);
    const seg = A.segOf.get(selectedUser) || 'Dormant';
    const freq = us ? (us.activeDays / A.N >= 0.5 ? 'almost daily' : us.activeDays / A.N >= 0.2 ? 'a few times a week' : 'occasionally') : null;
    const stat = (label, value) => <div className="ap-card"><div style={{ fontSize: 11, color: 'var(--mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.7px' }}>{label}</div><div className="num" style={{ fontSize: 28, fontWeight: 800, letterSpacing: -1 }}>{value}</div></div>;
    return (
      <div className="ap-ov" onClick={() => setSelectedUser(null)}>
        <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ap-mh">
            <div className="ap-user" style={{ gap: 16 }}>
              {db.picture ? <img className="ap-avatar" style={{ width: 64, height: 64 }} src={db.picture} alt="" referrerPolicy="no-referrer" /> : <span className="ap-avatar" style={{ width: 64, height: 64, fontSize: 20 }}>{initials(db.name)}</span>}
              <div>
                <div className="num" style={{ fontSize: 22, fontWeight: 800 }}>{db.name || db.email}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 7, alignItems: 'center', color: 'var(--mute)', fontSize: 12.5 }}>
                  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Mail size={13} />{db.email}</span>
                  <Seg name={seg} />
                  {db.defaultSection && <span className="ap-badge" style={{ background: 'rgba(14,17,22,.06)', color: 'var(--ink2)' }}>Section {db.defaultSection}</span>}
                  <span className="ap-badge" style={{ background: db.oltUsername ? '#2FBF7122' : '#F2542D22', color: db.oltUsername ? '#17935a' : '#d6401d' }}>{db.oltUsername ? 'OLT linked' : 'No OLT'}</span>
                </div>
              </div>
            </div>
            <button className="ap-x" onClick={() => setSelectedUser(null)}><X size={18} /></button>
          </div>
          <div className="ap-mb">
            {!us ? <Empty title="No activity in the last 30 days" text={`Last seen ${timeAgo(db.lastActive)}. Registered ${db.createdAt ? new Date(db.createdAt).toLocaleDateString() : 'unknown'}.`} /> : (
              <>
                <div className="ap-prof"><b>Behaviour profile:</b> {us.daypart || 'Mixed-hours'} user who shows up {freq} ({us.activeDays} of {A.N} days), averaging {(us.sessionCount / Math.max(1, us.activeDays)).toFixed(1)} sessions per active day with a typical session of {fmtDur(us.avgSession)}.
                  {us.topNames[0] && <> Favourite area: <b style={{ textTransform: 'capitalize' }}>{us.topNames[0].label}</b>.</>}
                  {us.riskConfident ? <> Churn risk is <b>{us.risk < 25 ? 'low' : us.risk < 55 ? 'moderate' : 'high'}</b> ({Math.round(us.risk)}%): last seen {us.recency === 0 ? 'today' : `${us.recency}d ago`} against a usual {us.avgGap ? us.avgGap.toFixed(1) : '?'}d gap.</> : <> Not enough history (3+ active days) to score churn risk.</>}
                </div>
                <div className="ap-grid ap-3">
                  {stat('Events', fmtNum(us.events))}{stat('Sessions', us.sessionCount)}{stat('Churn risk', us.riskConfident ? `${Math.round(us.risk)}%` : 'n/a')}
                </div>
                <div className="ap-grid ap-2">
                  <Panel title="30-day activity" icon={Calendar}>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${A.N},1fr)`, gap: 3 }}>
                      {us.dayCounts.map((c, i) => <span key={i} title={`${fmtDayLong(A.dayKeys[i])}: ${c} events`} style={{ height: 34, borderRadius: 6, background: c ? heatColor(c / Math.max(...us.dayCounts)) : EMPTY_CELL }} />)}
                    </div>
                  </Panel>
                  <Panel title="Hours they're active" icon={Clock}><HourBars values={us.hist} /></Panel>
                </div>
                <Panel title="Favourite areas" icon={BarChart3}>
                  <BarList rows={us.topNames.map((n) => ({ label: n.label, v: n.c }))} />
                </Panel>
                <Panel title="Recent sessions" icon={GitBranch} sub="Newest first. Sessions end after 30 minutes of inactivity.">
                  {us.sessions.slice(-8).reverse().map((s, i) => (
                    <div className="ap-sess" key={i}>
                      <div style={{ fontWeight: 700 }}>{fmtDayLong(dayKeyOfMs(s.start * 1000))} · {fmtClock(s.start)} <span style={{ color: 'var(--mute)', fontWeight: 600 }}>({fmtDur(s.end - s.start)}, {s.items.length} action{s.items.length > 1 ? 's' : ''})</span></div>
                      <div className="ap-tags">{s.items.slice(0, 12).map(([, n], j) => <span key={j} className="ap-tag">{A.nameMeta[n].name === 'app_opened' ? 'opened app' : A.nameMeta[n].label}</span>)}{s.items.length > 12 && <span className="ap-tag">+{s.items.length - 12}</span>}</div>
                    </div>
                  ))}
                </Panel>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  /* --------------------------------- RENDER --------------------------------- */
  return (
    <div className="ap">
      <style>{css}</style>
      <div className="ap-aurora"><i /><i /><i /></div>

      <div className="ap-railwrap">
        <nav className="ap-rail">
          <div className="ap-logo"><div className="mk"><LayoutDashboard size={20} /></div><span>Control Room</span></div>
          {TABS.map((t) => (
            <button key={t.id} className={`ap-ni ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)} title={t.label}>
              <t.icon size={20} /><span>{t.label}</span>{t.tag && <b className="tg">{t.tag}</b>}
            </button>
          ))}
          <div className="ap-rail-foot">
            <button className="ap-ni" onClick={logout} title="Logout"><LogOut size={20} /><span>Logout</span></button>
          </div>
        </nav>
      </div>

      <main className="ap-main" ref={mainRef}>
        <div className="ap-bar">
          <div className="ap-crumb">Control room / <b>{TABS.find((t) => t.id === tab).label}</b></div>
          <div className="ap-sbox">
            <Search size={16} />
            <input placeholder="Search users, then press Enter" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setTab('users'); }} />
          </div>
          <div className="r">
            <span className="ap-chip"><span className="ap-dot" />Updated {loadedAt ? timeAgo(loadedAt) : '—'}</span>
            <button className="ap-btn dark" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'ap-spin' : ''} />Refresh</button>
          </div>
        </div>
        <div className="ap-page" key={`${tab}`}>
          {insightsError && <div className="ap-alert warn"><AlertCircle size={16} />{insightsError}</div>}
          {error && <div className="ap-alert err"><AlertCircle size={16} />{error}</div>}
          {/* called as functions (not <Components/>) so inputs keep focus between renders */}
          {tab === 'overview' && Overview()}
          {tab === 'intel' && Intel()}
          {tab === 'timeline' && Timeline()}
          {tab === 'users' && UsersTab()}
          {tab === 'feedback' && FeedbackTab()}
          {tab === 'watcher' && WatcherTab()}
        </div>
      </main>
      {selectedUser && UserModal()}
    </div>
  );
}

export { analyze };
export default AdminPortal;