import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';
import {
  Lock, LayoutDashboard, Activity, Users, TrendingUp, TrendingDown, CheckCircle2,
  MessageSquare, LogOut, Loader2, X, Calendar, Clock, Search, BarChart3,
  AlertCircle, ArrowUpRight, ArrowDownRight, Zap, Radio, Mail, Hexagon, Brain,
  Sparkles, Flame, Target, Layers, RefreshCw, Send, Play, ShieldAlert, GitBranch,
  Moon, Sun, Globe, UserPlus, Repeat
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

const SEGMENTS = {
  Champions: { color: '#10B981', desc: 'Daily, deep, multi-session users: the core of the platform.' },
  Regulars: { color: '#3B82F6', desc: 'Steady weekly users with healthy session depth.' },
  Casual: { color: '#F59E0B', desc: 'Occasional, usually single-purpose visits.' },
  Drifting: { color: '#EF4444', desc: 'Used to show up, but activity has faded.' },
  Dormant: { color: '#94A3B8', desc: 'Registered, but no activity in this window.' }
};
const SEV = {
  alert: { color: '#EF4444', label: 'Alert', rank: 0 },
  warn: { color: '#F59E0B', label: 'Watch', rank: 1 },
  good: { color: '#10B981', label: 'Positive', rank: 2 },
  info: { color: '#3B82F6', label: 'Insight', rank: 3 }
};

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
  const usersIn = (from, to) => { const s = new Set(); for (let i = from; i < to; i++) dauSets[i].forEach((e) => s.add(e)); return s.size; };
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
    insights, qa, fb, userInfo, todayI
  };
}

/* ============================================================================
   3. STYLES
============================================================================ */
const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Poppins:wght@600;700;800&display=swap');
.ap{--bg:#F5F7FB;--card:#fff;--ink:#0F172A;--ink2:#334155;--mute:#64748B;--faint:#94A3B8;--line:#E5E9F2;--gold:#DBA315;--gold-soft:rgba(219,163,21,.12);--blue:#3B82F6;--green:#10B981;--red:#EF4444;--amber:#F59E0B;--purple:#8B5CF6;--navy:#0B1220;
 font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;font-size:14px;line-height:1.45}
.ap *{box-sizing:border-box}
.ap button{font-family:inherit;cursor:pointer}
.ap ::-webkit-scrollbar{width:8px;height:8px}.ap ::-webkit-scrollbar-thumb{background:#d5dbe7;border-radius:8px}
.ap-spin{animation:ap-spin 1s linear infinite}@keyframes ap-spin{to{transform:rotate(360deg)}}
@keyframes ap-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ap-pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* login */
.ap-login{min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(1200px 600px at 80% -10%,rgba(219,163,21,.22),transparent),radial-gradient(900px 500px at -10% 110%,rgba(59,130,246,.2),transparent),linear-gradient(135deg,#0B1220,#16213a)}
.ap-login-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:56px;max-width:1040px;width:100%;align-items:center}
.ap-hero{color:#fff}.ap-hero h1{font-family:Poppins,sans-serif;font-size:44px;line-height:1.1;margin:0 0 14px;font-weight:800}
.ap-hero p{color:rgba(255,255,255,.72);font-size:16px;margin:0 0 26px;max-width:460px}
.ap-hero li{list-style:none;display:flex;gap:12px;align-items:center;margin-bottom:14px;color:rgba(255,255,255,.88)}
.ap-hero ul{padding:0;margin:0}.ap-hero .ic{width:38px;height:38px;border-radius:11px;background:rgba(219,163,21,.16);border:1px solid rgba(219,163,21,.35);display:grid;place-items:center;color:#f3c64f}
.ap-login-card{background:rgba(255,255,255,.97);border-radius:26px;padding:38px;box-shadow:0 30px 70px rgba(0,0,0,.35);animation:ap-up .6s ease}
.ap-login-card h2{font-family:Poppins,sans-serif;margin:14px 0 4px;font-size:26px}
.ap-input{width:100%;padding:13px 15px;border:2px solid var(--line);border-radius:12px;font-size:15px;outline:none;background:#fff;transition:.2s}
.ap-input:focus{border-color:var(--gold);box-shadow:0 0 0 5px var(--gold-soft)}
.ap-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:11px;border:1px solid var(--line);background:#fff;color:var(--ink2);font-weight:600;font-size:13px;transition:.15s}
.ap-btn:hover:not(:disabled){border-color:var(--gold);color:#8a6508;background:#fffbf0}
.ap-btn:disabled{opacity:.55;cursor:not-allowed}
.ap-btn.primary{background:linear-gradient(135deg,#E4AE1B,#C28F0F);color:#fff;border:0;box-shadow:0 8px 20px rgba(219,163,21,.32)}
.ap-btn.primary:hover:not(:disabled){filter:brightness(1.05);transform:translateY(-1px);color:#fff;background:linear-gradient(135deg,#E4AE1B,#C28F0F)}
.ap-btn.block{width:100%;padding:13px;font-size:15px}
.ap-alert{display:flex;gap:8px;align-items:center;padding:11px 13px;border-radius:11px;font-weight:600;font-size:13px;margin-top:14px}
.ap-alert.err{background:rgba(239,68,68,.1);color:#b91c1c}.ap-alert.warn{background:rgba(245,158,11,.12);color:#92400e}

/* shell */
.ap-shell{display:grid;grid-template-columns:252px 1fr;min-height:100vh}
.ap-side{background:linear-gradient(180deg,#0B1220,#111b30);color:#cbd5e1;padding:22px 14px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow:auto}
.ap-brand{display:flex;align-items:center;gap:11px;color:#fff;font-family:Poppins,sans-serif;font-weight:700;font-size:18px;padding:4px 10px 22px}
.ap-brand .lg{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#E4AE1B,#B98305);display:grid;place-items:center}
.ap-nav-label{font-size:10.5px;letter-spacing:1.2px;text-transform:uppercase;color:#64748b;font-weight:700;padding:8px 12px}
.ap-nav{display:flex;align-items:center;gap:11px;width:100%;padding:11px 12px;border-radius:11px;border:0;background:transparent;color:#a9b6ca;font-weight:600;font-size:13.5px;text-align:left;margin-bottom:3px;transition:.15s;position:relative}
.ap-nav:hover{background:rgba(255,255,255,.07);color:#fff}
.ap-nav.on{background:linear-gradient(135deg,rgba(228,174,27,.95),rgba(194,143,15,.9));color:#fff;box-shadow:0 6px 18px rgba(219,163,21,.28)}
.ap-nav .tag{margin-left:auto;font-size:9.5px;font-weight:800;letter-spacing:.8px;background:rgba(255,255,255,.18);padding:2px 7px;border-radius:99px}
.ap-side-foot{margin-top:auto;padding:12px;border-radius:12px;background:rgba(255,255,255,.05);font-size:12px;color:#8fa0b8}
.ap-side-foot b{color:#e2e8f0}
.ap-logout{margin-top:10px;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:10px;border-radius:11px;border:1px solid rgba(239,68,68,.25);background:rgba(239,68,68,.08);color:#fca5a5;font-weight:600}
.ap-logout:hover{background:rgba(239,68,68,.18);color:#fff}
.ap-main{min-width:0;display:flex;flex-direction:column}
.ap-top{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:14px;padding:16px 28px;background:rgba(245,247,251,.85);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
.ap-top h2{margin:0;font-family:Poppins,sans-serif;font-size:21px}
.ap-top p{margin:2px 0 0;color:var(--mute);font-size:12.5px}
.ap-top .r{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ap-chip{display:inline-flex;align-items:center;gap:6px;padding:6px 11px;border-radius:99px;font-size:12px;font-weight:700;background:#fff;border:1px solid var(--line);color:var(--ink2)}
.ap-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(16,185,129,.16);animation:ap-pulse 2s infinite}
.ap-content{padding:26px 28px 60px;max-width:1500px;width:100%}

/* cards */
.ap-grid{display:grid;gap:18px}
.ap-kpis{grid-template-columns:repeat(auto-fit,minmax(210px,1fr));margin-bottom:20px}
.ap-kpi{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;gap:14px;animation:ap-up .45s ease backwards;transition:.2s}
.ap-kpi:hover{transform:translateY(-3px);box-shadow:0 14px 30px rgba(15,23,42,.08)}
.ap-kpi .ic{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;flex-shrink:0}
.ap-kpi .lb{font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:var(--mute);font-weight:700}
.ap-kpi .vl{font-size:26px;font-weight:800;line-height:1.15;margin:2px 0}
.ap-kpi .sb{font-size:12px;color:var(--mute);display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.up{color:#059669;font-weight:700;display:inline-flex;align-items:center;gap:2px}.dn{color:#dc2626;font-weight:700;display:inline-flex;align-items:center;gap:2px}
.ap-panel{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;min-width:0}
.ap-ph{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.ap-ph h3{margin:0;font-size:15.5px;font-weight:700;display:flex;align-items:center;gap:9px}
.ap-ph .sub{font-size:12px;color:var(--mute);margin-top:3px;font-weight:500}
.ap-2{grid-template-columns:repeat(auto-fit,minmax(420px,1fr))}
.ap-3{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.ap-empty{text-align:center;padding:34px 16px;color:var(--mute)}.ap-empty b{display:block;color:var(--ink2);margin-bottom:4px;font-size:15px}
.ap-pill-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.ap-pill{padding:8px 14px;border-radius:99px;border:1px solid var(--line);background:#fff;color:var(--mute);font-weight:600;font-size:13px;transition:.15s}
.ap-pill:hover{color:#8a6508;border-color:var(--gold)}.ap-pill.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.ap-badge{display:inline-flex;align-items:center;padding:3px 9px;border-radius:99px;font-size:11.5px;font-weight:700;white-space:nowrap}
.ap-bar-row{display:grid;grid-template-columns:130px 1fr 54px;gap:10px;align-items:center;margin-bottom:9px;font-size:13px}
.ap-bar-row .nm{font-weight:600;text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-track{height:9px;border-radius:99px;background:#eef1f7;overflow:hidden}.ap-fill{height:100%;border-radius:99px;transition:width .6s cubic-bezier(.16,1,.3,1)}
.ap-bar-row .n{text-align:right;color:var(--mute);font-weight:700;font-variant-numeric:tabular-nums}
.ap-note{font-size:12px;color:var(--mute);margin-top:12px}

/* insights */
.ap-insight{display:grid;grid-template-columns:4px 1fr;gap:14px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px;animation:ap-up .4s ease backwards}
.ap-insight .bar{border-radius:4px}.ap-insight h4{margin:0 0 4px;font-size:14.5px}.ap-insight p{margin:0;color:var(--ink2);font-size:13px}
.ap-insight .meta{display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.ap-conf{display:inline-flex;gap:6px;align-items:center;font-size:11.5px;color:var(--mute);font-weight:600}
.ap-conf i{display:block;width:54px;height:5px;background:#e8ecf4;border-radius:9px;overflow:hidden}.ap-conf i b{display:block;height:100%;background:linear-gradient(90deg,#60a5fa,#8b5cf6)}
.ap-ask{background:linear-gradient(135deg,#0F172A,#1c2b4a);color:#fff;border:0}
.ap-ask .ap-ph h3{color:#fff}.ap-ask .sub{color:#a9b6ca}
.ap-q{padding:8px 13px;border-radius:99px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:#e2e8f0;font-size:12.5px;font-weight:600;transition:.15s}
.ap-q:hover{background:rgba(255,255,255,.14)}.ap-q.on{background:#E4AE1B;border-color:#E4AE1B;color:#1a1200}
.ap-answer{margin-top:14px;padding:14px 16px;border-radius:13px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);font-size:13.5px;color:#f1f5f9;min-height:52px}

/* heatmap / strips */
.ap-heat{display:grid;grid-template-columns:36px repeat(24,minmax(0,1fr));gap:3px;align-items:center}
.ap-heat .c{aspect-ratio:1/1;border-radius:5px;min-height:14px}.ap-heat .l{font-size:10.5px;color:var(--mute);font-weight:600}
.ap-heat .hl{font-size:10px;color:var(--faint);text-align:center}
.ap-strip{display:grid;grid-template-columns:78px repeat(24,minmax(0,1fr)) 52px;gap:3px;align-items:center;padding:3px 6px;border-radius:9px;cursor:pointer;border:1px solid transparent}
.ap-strip:hover{background:#f6f8fc}.ap-strip.on{background:var(--gold-soft);border-color:rgba(219,163,21,.5)}
.ap-strip .c{height:18px;border-radius:4px}.ap-strip .d{font-size:12px;font-weight:600}.ap-strip .t{font-size:11.5px;color:var(--mute);text-align:right;font-weight:700}
.ap-lane{display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:center;margin-bottom:6px}
.ap-lane .who{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ap-lane .rail{position:relative;height:20px;background:linear-gradient(90deg,#f3f5fa 0,#f3f5fa 100%);border-radius:6px}
.ap-lane .seg{position:absolute;top:2px;bottom:2px;border-radius:5px;min-width:4px}
.ap-axis{display:grid;grid-template-columns:140px 1fr;gap:10px}.ap-axis .ax{display:flex;justify-content:space-between;font-size:10.5px;color:var(--faint);margin-top:4px}
.ap-stream{max-height:360px;overflow:auto;border:1px solid var(--line);border-radius:12px}
.ap-ev{display:grid;grid-template-columns:54px 1fr auto;gap:10px;padding:8px 12px;border-bottom:1px solid #f0f2f8;font-size:12.5px;align-items:center}
.ap-ev:last-child{border-bottom:0}.ap-ev .tm{color:var(--mute);font-variant-numeric:tabular-nums;font-weight:600}

/* tables */
.ap-table{width:100%;border-collapse:collapse;font-size:13px}
.ap-table th{text-align:left;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--mute);padding:10px 12px;border-bottom:1px solid var(--line);font-weight:700;white-space:nowrap}
.ap-table td{padding:11px 12px;border-bottom:1px solid #f0f2f8;vertical-align:middle}
.ap-table tr.row{cursor:pointer;transition:.12s}.ap-table tr.row:hover{background:#f8faff}
.ap-avatar{width:34px;height:34px;border-radius:10px;object-fit:cover;background:var(--gold-soft);color:#8a6508;display:grid;place-items:center;font-weight:800;font-size:12px;flex-shrink:0}
.ap-user{display:flex;gap:10px;align-items:center;min-width:0}.ap-user .nm{font-weight:700}.ap-user .em{font-size:12px;color:var(--mute)}
.ap-meter{width:70px;height:7px;border-radius:99px;background:#eef1f7;overflow:hidden;display:inline-block;vertical-align:middle}.ap-meter i{display:block;height:100%}
.ap-search{position:relative;flex:1;min-width:220px;max-width:340px}.ap-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--faint)}
.ap-search input{padding-left:38px}
.ap-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px}
select.ap-input{width:auto;padding:10px 12px;font-size:13px}

/* journeys */
.ap-flow{display:flex;gap:8px;align-items:stretch;flex-wrap:wrap}
.ap-node{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px 14px;min-width:120px;box-shadow:0 4px 14px rgba(15,23,42,.05)}
.ap-node b{display:block;text-transform:capitalize;font-size:13.5px}.ap-node span{font-size:11.5px;color:var(--mute)}
.ap-arrow{display:flex;align-items:center;color:var(--faint);font-weight:700}
.ap-seg-bar{display:flex;height:16px;border-radius:99px;overflow:hidden;margin-bottom:14px;background:#eef1f7}
.ap-seg-card{border:1px solid var(--line);border-radius:14px;padding:14px;background:#fff}
.ap-seg-card h4{margin:0 0 3px;display:flex;align-items:center;gap:8px;font-size:14.5px}
.ap-seg-card p{margin:0 0 10px;font-size:12px;color:var(--mute)}
.ap-seg-card dl{display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;margin:0;font-size:12px}.ap-seg-card dt{color:var(--mute)}.ap-seg-card dd{margin:0;font-weight:700;text-align:right}
.ap-cohort td{text-align:center;font-weight:700;font-size:12.5px;padding:8px}
.ap-cohort td.k{text-align:left}

/* modal */
.ap-ov{position:fixed;inset:0;background:rgba(11,18,32,.72);backdrop-filter:blur(8px);z-index:100;display:grid;place-items:center;padding:20px;animation:ap-up .2s ease}
.ap-modal{background:#fff;border-radius:24px;width:100%;max-width:980px;max-height:92vh;overflow:auto;box-shadow:0 30px 80px rgba(0,0,0,.4)}
.ap-mh{display:flex;justify-content:space-between;gap:16px;padding:24px 26px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#fff;z-index:2}
.ap-mb{padding:24px 26px;display:grid;gap:22px}
.ap-x{width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:#fff;display:grid;place-items:center;color:var(--mute)}.ap-x:hover{color:var(--red);border-color:var(--red)}
.ap-prof{padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#fff8e1,#eef4ff);border:1px solid #f1e3b3;font-size:13.5px;color:var(--ink2)}
.ap-sess{border-left:3px solid var(--gold);padding:8px 0 8px 14px;margin-left:6px;position:relative}
.ap-sess::before{content:'';position:absolute;left:-7px;top:13px;width:11px;height:11px;border-radius:50%;background:#fff;border:3px solid var(--gold)}
.ap-tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:5px}.ap-tag{font-size:11px;padding:2px 8px;border-radius:7px;background:#f1f4fa;color:var(--ink2);font-weight:600;text-transform:capitalize}
.ap-fb{padding:14px 16px;border:1px solid var(--line);border-left-width:4px;border-radius:13px;margin-bottom:10px;background:#fff}
.ap-fb header{display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:12.5px}.ap-fb p{margin:0;color:var(--ink2)}

@media(max-width:1100px){.ap-shell{grid-template-columns:1fr}.ap-side{position:relative;height:auto;flex-direction:row;overflow:auto;gap:6px;padding:12px}.ap-side .ap-nav-label,.ap-side-foot,.ap-brand span{display:none}.ap-brand{padding:0 8px}.ap-nav{width:auto;white-space:nowrap}.ap-logout{margin:0;width:auto}.ap-login-grid{grid-template-columns:1fr}.ap-hero{display:none}.ap-2{grid-template-columns:1fr}}
@media(max-width:640px){.ap-content{padding:16px}.ap-top{padding:12px 16px}.ap-bar-row{grid-template-columns:90px 1fr 44px}.ap-lane,.ap-axis{grid-template-columns:90px 1fr}.ap-strip{grid-template-columns:56px repeat(24,minmax(0,1fr)) 36px}}
`;

/* ============================================================================
   4. CHART / VISUAL PRIMITIVES
============================================================================ */
const heatColor = (v) => `rgba(219,163,21,${(0.07 + 0.93 * Math.sqrt(clamp(v, 0, 1))).toFixed(3)})`;

function Spark({ values, color = '#DBA315', w = 110, h = 28 }) {
  const mx = Math.max(...values, 1);
  const n = values.length;
  if (!n) return null;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * w},${h - 2 - (v / mx) * (h - 4)}`);
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={pts.join(' ')} />
      <polygon fill={color} opacity="0.12" points={`0,${h} ${pts.join(' ')} ${w},${h}`} />
    </svg>
  );
}

function BarList({ rows, color = '#DBA315', max }) {
  const mx = max || Math.max(...rows.map((r) => r.v), 1);
  if (!rows.length) return <div className="ap-empty">No data yet</div>;
  return rows.map((r, i) => (
    <div className="ap-bar-row" key={`${r.label}-${i}`}>
      <div className="nm" title={r.label}>{r.label}</div>
      <div className="ap-track"><div className="ap-fill" style={{ width: `${(r.v / mx) * 100}%`, background: r.color || color }} /></div>
      <div className="n">{r.display != null ? r.display : fmtNum(r.v)}</div>
    </div>
  ));
}

function ActivityChart({ A }) {
  const [hover, setHover] = useState(null);
  const N = A.N, fc = A.forecast.points, total = N + fc.length;
  const W = 900, H = 300, L = 46, R = 46, T = 14, B = 30;
  const iw = W - L - R, ih = H - T - B;
  const maxE = Math.max(...A.evPerDay, 1) * 1.12;
  const maxD = Math.max(...A.dau, ...fc.map((p) => p.hi), 1) * 1.15;
  const x = (i) => L + (i + 0.5) * (iw / total);
  const bw = Math.max(3, (iw / total) * 0.62);
  const yE = (v) => T + ih - (v / maxE) * ih;
  const yD = (v) => T + ih - (v / maxD) * ih;
  const dauPath = A.dau.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${yD(v)}`).join(' ');
  const fcPath = `M${x(N - 1)},${yD(A.dau[N - 1])} ` + fc.map((p, j) => `L${x(N + j)},${yD(p.v)}`).join(' ');
  const upper = [`${x(N - 1)},${yD(A.dau[N - 1])}`, ...fc.map((p, j) => `${x(N + j)},${yD(p.hi)}`)];
  const lower = [...fc.map((p, j) => `${x(N + j)},${yD(p.lo)}`)].reverse().concat([`${x(N - 1)},${yD(A.dau[N - 1])}`]);
  const anomByI = new Map(A.anomalies.map((a) => [a.i, a]));
  let readout = 'Hover the chart for details';
  if (hover != null) {
    if (hover < N) {
      const a = anomByI.get(hover);
      readout = `${fmtDayLong(A.dayKeys[hover])} · ${fmtNum(A.evPerDay[hover])} events · ${A.dau[hover]} users · ${A.signups[hover]} signups${a ? ` · anomaly (${a.z > 0 ? '+' : ''}${a.z.toFixed(1)}σ)` : ''}${hover === N - 1 ? ' · today so far' : ''}`;
    } else {
      const p = fc[hover - N];
      readout = `Forecast ${fmtDayLong(p.key)} · ~${Math.round(p.v)} users (80% band ${Math.round(p.lo)}–${Math.round(p.hi)})`;
    }
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--mute)', marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><b style={{ color: '#E4AE1B' }}>■</b> Events</span>
        <span><b style={{ color: '#3B82F6' }}>━</b> Active users</span>
        <span><b style={{ color: '#8B5CF6' }}>┅</b> Forecast</span>
        <span><b style={{ color: '#EF4444' }}>●</b> Anomaly</span>
        <span style={{ marginLeft: 'auto', color: 'var(--ink2)', fontWeight: 600 }}>{readout}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((r) => (
          <g key={r}>
            <line x1={L} x2={W - R} y1={T + ih * r} y2={T + ih * r} stroke="#E8ECF4" strokeDasharray="4 4" />
            <text x={L - 8} y={T + ih * r + 4} textAnchor="end" fontSize="10" fill="#94A3B8">{Math.round(maxE * (1 - r))}</text>
            <text x={W - R + 8} y={T + ih * r + 4} fontSize="10" fill="#93B4F8">{Math.round(maxD * (1 - r))}</text>
          </g>
        ))}
        <rect x={x(N)} y={T} width={iw - (x(N) - L) + 4} height={ih} fill="#8B5CF6" opacity="0.045" />
        {A.evPerDay.map((v, i) => (
          <rect key={i} x={x(i) - bw / 2} y={yE(v)} width={bw} height={Math.max(1, T + ih - yE(v))} rx="3" fill="#E4AE1B" opacity={i === N - 1 ? 0.45 : 0.85} />
        ))}
        <polygon points={[...upper, ...lower].join(' ')} fill="#8B5CF6" opacity="0.14" />
        <path d={dauPath} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={fcPath} fill="none" stroke="#8B5CF6" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />
        {A.dau.map((v, i) => <circle key={i} cx={x(i)} cy={yD(v)} r={hover === i ? 5 : 2.6} fill="#fff" stroke="#3B82F6" strokeWidth="2" />)}
        {A.anomalies.map((a) => <circle key={a.i} cx={x(a.i)} cy={yE(a.value) - 9} r="5" fill="#fff" stroke="#EF4444" strokeWidth="2.5" />)}
        {Array.from({ length: total }, (_, i) => i).filter((i) => i % 5 === 0 || i === total - 1).map((i) => (
          <text key={i} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="#94A3B8">{fmtDay(i < N ? A.dayKeys[i] : fc[i - N].key)}</text>
        ))}
        {Array.from({ length: total }, (_, i) => (
          <rect key={i} x={x(i) - iw / total / 2} y={T} width={iw / total} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
    </div>
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
          {grid[wd].map((v, h) => <span key={h} className="c" title={`${WD_FULL[wd]} ${fmtHour(h)}: ${v} events`} style={{ background: v ? heatColor(v / mx) : '#F1F4F9' }} />)}
        </React.Fragment>
      ))}
    </div>
  );
}

function HourBars({ values, color = '#DBA315', h = 70 }) {
  const mx = Math.max(...values, 1);
  return (
    <div>
      <svg viewBox={`0 0 240 ${h}`} style={{ width: '100%', height: h, display: 'block' }} preserveAspectRatio="none">
        {values.map((v, i) => <rect key={i} x={i * 10 + 1} width="8" y={h - 2 - (v / mx) * (h - 6)} height={Math.max(1.5, (v / mx) * (h - 6))} rx="2" fill={color} opacity={v ? 0.9 : 0.25}><title>{`${fmtHour(i)}: ${v}`}</title></rect>)}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--faint)' }}><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
    </div>
  );
}

const Seg = ({ name }) => {
  const c = (SEGMENTS[name] || SEGMENTS.Dormant).color;
  return <span className="ap-badge" style={{ background: `${c}1f`, color: c }}>{name}</span>;
};

const Kpi = ({ icon: Icon, label, value, sub, delta, color = '#DBA315', i = 0 }) => (
  <div className="ap-kpi" style={{ animationDelay: `${i * 60}ms` }}>
    <div className="ic" style={{ background: `${color}1f`, color }}><Icon size={22} /></div>
    <div>
      <div className="lb">{label}</div>
      <div className="vl">{value}</div>
      <div className="sb">
        {delta != null && <span className={delta >= 0 ? 'up' : 'dn'}>{delta >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(delta).toFixed(0)}%</span>}
        {sub}
      </div>
    </div>
  </div>
);

const Panel = ({ title, icon: Icon, sub, right, children, className = '', style }) => (
  <section className={`ap-panel ${className}`} style={style}>
    <div className="ap-ph">
      <div><h3>{Icon && <Icon size={18} color="#C28F0F" />}{title}</h3>{sub && <div className="sub">{sub}</div>}</div>
      {right}
    </div>
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
  overview: ['Platform Overview', 'Health, growth and usage at a glance'],
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
    try { await fetchAll(adminPassword); } catch (err) { setError(err.response?.data?.error || 'Refresh failed.'); } finally { setRefreshing(false); }
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

  const watcherAction = async (kind) => {
    setWatcherBusy(kind); setWatcherMsg('');
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/mhe-watch/${kind}`, { password: adminPassword });
      setWatcherMsg(kind === 'test-mail' ? `Test email sent via ${res.data.provider}.` : res.data.message || 'Started.');
      if (kind === 'run') setTimeout(loadWatcher, 4000);
    } catch (err) { setWatcherMsg(err.response?.data?.error || 'Request failed.'); } finally { setWatcherBusy(''); }
  };

  useEffect(() => { if (A && selectedDay == null) setSelectedDay(A.dayKeys[A.N - 1]); }, [A, selectedDay]);

  /* -------------------------------- LOGIN -------------------------------- */
  if (!data) {
    return (
      <div className="ap">
        <style>{css}</style>
        <div className="ap-login">
          <div className="ap-login-grid">
            <div className="ap-hero">
              <h1>Know your platform before it tells you.</h1>
              <p>A pattern engine that learns rhythms, forecasts demand, flags anomalies and spots users who are drifting away.</p>
              <ul>
                <li><span className="ic"><Brain size={18} /></span>Behavioural pattern detection</li>
                <li><span className="ic"><TrendingUp size={18} /></span>Seasonal forecasting &amp; anomaly alerts</li>
                <li><span className="ic"><Users size={18} /></span>Segments &amp; churn-risk scoring</li>
                <li><span className="ic"><GitBranch size={18} /></span>Session journeys &amp; timelines</li>
              </ul>
            </div>
            <div className="ap-login-card">
              <div style={{ display: 'inline-flex', background: 'var(--gold-soft)', padding: 14, borderRadius: 16 }}><Hexagon size={34} color="#C28F0F" /></div>
              <h2>Admin access</h2>
              <p style={{ color: 'var(--mute)', margin: '0 0 22px' }}>Enter the administrator password to continue.</p>
              <form onSubmit={handleLogin}>
                <input type="password" className="ap-input" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus style={{ marginBottom: 14 }} />
                <button type="submit" className="ap-btn primary block" disabled={loading || !password}>
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

  /* ---------------------------- reusable fragments ---------------------------- */
  const NoData = () => <Panel title="Waiting for behaviour data" icon={AlertCircle}><Empty title="No events to analyse" text={insightsError || 'Once users interact with the app, patterns will appear here.'} /></Panel>;

  const InsightCard = ({ it, i }) => (
    <div className="ap-insight" style={{ animationDelay: `${i * 40}ms` }}>
      <div className="bar" style={{ background: SEV[it.severity].color }} />
      <div>
        <div className="meta">
          <span className="ap-badge" style={{ background: `${SEV[it.severity].color}1f`, color: SEV[it.severity].color }}>{SEV[it.severity].label}</span>
          <span className="ap-badge" style={{ background: '#f1f4fa', color: 'var(--ink2)' }}>{it.tag}</span>
          <span className="ap-conf" title="Statistical confidence in this finding">confidence {it.confidence}% <i><b style={{ width: `${it.confidence}%` }} /></i></span>
        </div>
        <h4>{it.title}</h4>
        <p>{it.body}</p>
      </div>
    </div>
  );

  /* -------------------------------- OVERVIEW -------------------------------- */
  const Overview = () => (
    <>
      <div className="ap-grid ap-kpis">
        <Kpi i={0} icon={Users} label="Total users" value={fmtNum(K.totalUsers)} sub={`${fmtNum(K.mau)} active in 30d`} color="#DBA315" />
        <Kpi i={1} icon={Activity} label="Active today" value={fmtNum(K.activeToday)} sub={`yesterday ${K.activeYesterday}`} color="#3B82F6" />
        <Kpi i={2} icon={Repeat} label="Weekly active" value={fmtNum(K.wau)} delta={K.wauDelta} sub="vs prior 7d" color="#10B981" />
        <Kpi i={3} icon={Flame} label="Stickiness" value={fmtPct(K.stickiness, 1)} sub="avg DAU / MAU" color="#EF4444" />
        <Kpi i={4} icon={Zap} label="Events (7d)" value={fmtNum(K.events7)} delta={K.eventsDelta} sub="vs prior 7d" color="#8B5CF6" />
        <Kpi i={5} icon={UserPlus} label="Signups (7d)" value={fmtNum(K.signups7)} delta={K.signupsDelta} sub="vs prior 7d" color="#F59E0B" />
        <Kpi i={6} icon={CheckCircle2} label="OLT linked" value={fmtPct(K.oltRate)} sub={`${fmtNum(data.users.filter((u) => u.oltUsername).length)} users`} color="#0EA5E9" />
        <Kpi i={7} icon={Clock} label="Median session" value={fmtDur(K.medianSession)} sub={`${fmtNum(A.sessionStats.total)} sessions`} color="#14B8A6" />
      </div>

      {noEvents ? <NoData /> : (
        <>
          <Panel title="Activity, forecast & anomalies" icon={TrendingUp} sub="30 days of events and daily active users, with a seasonality-aware 7-day forecast" style={{ marginBottom: 18 }}>
            <ActivityChart A={A} />
          </Panel>
          <div className="ap-grid ap-2" style={{ marginBottom: 18 }}>
            <Panel title="Top engine headlines" icon={Sparkles} sub="Highest-severity findings from the Pattern Engine" right={<button className="ap-btn" onClick={() => setTab('intel')}>Open engine</button>}>
              {A.insights.slice(0, 4).map((it, i) => <InsightCard key={it.id} it={it} i={i} />)}
            </Panel>
            <Panel title="Most used features" icon={BarChart3} sub="Unique users per feature shown on the right">
              <BarList rows={A.topEvents.map((e) => ({ label: e.label, v: e.count, display: `${fmtNum(e.count)}` }))} />
              <div className="ap-note">Based on tab and action events in the last 30 days.</div>
            </Panel>
          </div>
        </>
      )}
    </>
  );

  /* ------------------------------ PATTERN ENGINE ------------------------------ */
  const Intel = () => {
    if (noEvents) return <NoData />;
    return (
      <>
        <div className="ap-pill-row">
          {[['insights', 'Insights', Sparkles], ['rhythm', 'Rhythm', Clock], ['segments', 'Segments & churn', Users], ['journeys', 'Journeys', GitBranch], ['retention', 'Retention', Repeat]].map(([id, label, Icon]) => (
            <button key={id} className={`ap-pill ${intelTab === id ? 'on' : ''}`} onClick={() => setIntelTab(id)}><Icon size={13} style={{ verticalAlign: -2, marginRight: 6 }} />{label}</button>
          ))}
          <span className="ap-chip" style={{ marginLeft: 'auto' }}><Brain size={13} />{fmtNum(A.totalEvents)} events · {fmtNum(A.users.length)} users · {A.N}d window</span>
        </div>

        {intelTab === 'insights' && (
          <div className="ap-grid" style={{ gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr)' }}>
            <div>
              <Panel title="Ask the engine" icon={Brain} className="ap-ask" sub="Answers are computed from your own data, not canned text" style={{ marginBottom: 18 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {A.qa.map((x, i) => <button key={x.q} className={`ap-q ${qaIdx === i ? 'on' : ''}`} onClick={() => setQaIdx(i)}>{x.q}</button>)}
                </div>
                <div className="ap-answer">{A.qa[qaIdx] && A.qa[qaIdx].a}</div>
              </Panel>
              <Panel title={`Findings (${A.insights.length})`} icon={Sparkles} sub="Ranked by severity, then confidence">
                {A.insights.map((it, i) => <InsightCard key={it.id} it={it} i={i} />)}
              </Panel>
            </div>
            <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
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
                  <div key={a.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f0f2f8' }}>
                    <div><b>{fmtDayLong(a.key)}</b><div style={{ fontSize: 12, color: 'var(--mute)' }}>{fmtNum(a.value)} events vs ~{fmtNum(Math.round(a.expected))} expected</div></div>
                    <span className="ap-badge" style={{ background: a.z > 0 ? '#10B9811f' : '#EF44441f', color: a.z > 0 ? '#059669' : '#dc2626' }}>{a.z > 0 ? '▲' : '▼'} {Math.abs(a.z).toFixed(1)}σ</span>
                  </div>
                )) : <Empty title="Nothing unusual" text="Every recent day sits within its normal range." />}
              </Panel>
            </div>
          </div>
        )}

        {intelTab === 'rhythm' && (
          <div className="ap-grid">
            <Panel title="Weekly rhythm" icon={Clock} sub="Events by weekday and hour (IST). Darker means busier.">
              <Heatmap grid={A.grid} />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
                <span className="ap-chip"><Flame size={13} color="#EF4444" />Peak {fmtHour(A.peak.start)}–{fmtHour(A.peak.start + 3)} · {fmtPct(A.peak.share * 100)}</span>
                <span className="ap-chip"><Moon size={13} color="#3B82F6" />Quiet {fmtHour(A.quiet.start)}–{fmtHour(A.quiet.start + 2)} · {fmtPct(A.quiet.share * 100, 1)}</span>
                <span className="ap-chip"><Calendar size={13} />Best day {WD_FULL[A.bestWd.wd]}</span>
              </div>
            </Panel>
            <div className="ap-grid ap-3">
              <Panel title="Hour of day" icon={Clock} sub="All users, all days"><HourBars values={A.hourTotals} /></Panel>
              <Panel title="Weekday strength" icon={Calendar} sub="Seasonal index (1.0 = average day)">
                <BarList rows={[1, 2, 3, 4, 5, 6, 0].map((wd) => ({ label: WD[wd], v: A.evIdx[wd], display: A.evIdx[wd].toFixed(2), color: A.evIdx[wd] >= 1 ? '#10B981' : '#F59E0B' }))} max={Math.max(...A.evIdx) * 1.1} />
              </Panel>
              <Panel title="Chronotypes" icon={Sun} sub="Users grouped by when they usually show up">
                <BarList rows={A.chrono.map((c) => ({ label: c.k, v: c.v }))} color="#8B5CF6" />
                <div className="ap-note">Only users with at least 5 events.</div>
              </Panel>
              <Panel title="Session length" icon={Layers} sub={`Median ${fmtDur(A.sessionStats.medianDur)} · ${fmtPct(A.sessionStats.bounce * 100)} single-action`}>
                <BarList rows={A.sessionStats.buckets.map((b) => ({ label: b.label, v: b.v }))} color="#14B8A6" />
                <div className="ap-note">A session ends after 30 minutes of inactivity.</div>
              </Panel>
            </div>
          </div>
        )}

        {intelTab === 'segments' && (
          <div className="ap-grid">
            <Panel title="User segments" icon={Users} sub="k-means clustering on volume, active days, recency and session depth">
              <div className="ap-seg-bar">{A.segments.map((s) => <div key={s.name} title={`${s.name}: ${s.count}`} style={{ width: `${s.share}%`, background: SEGMENTS[s.name].color }} />)}</div>
              <div className="ap-grid ap-3">
                {A.segments.map((s) => (
                  <div className="ap-seg-card" key={s.name} style={{ borderTop: `3px solid ${SEGMENTS[s.name].color}` }}>
                    <h4>{s.name}<span className="ap-badge" style={{ background: '#f1f4fa', color: 'var(--ink2)' }}>{s.count} · {fmtPct(s.share)}</span></h4>
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
                        <td><span className="ap-meter"><i style={{ width: `${u.risk}%`, background: u.risk > 75 ? '#EF4444' : '#F59E0B' }} /></span> {Math.round(u.risk)}%</td>
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
                      <div className="ap-node"><b>{p.label}</b><span>{i === 0 ? `${fmtPct(p.prob * 100)} start here` : `${fmtPct(p.prob * 100)} likely`}</span></div>
                    </React.Fragment>
                  ))}
                </div>
              ) : <Empty title="Not enough sessions" text="Journeys appear after a few multi-step sessions." />}
            </Panel>
            <div className="ap-grid ap-2">
              <Panel title="Strongest transitions" icon={Zap} sub="From one action straight to the next">
                <BarList rows={A.edges.map((e) => ({ label: `${e.fromLabel} → ${e.toLabel}`, v: e.prob * 100, display: `${(e.prob * 100).toFixed(0)}%` }))} color="#8B5CF6" max={100} />
              </Panel>
              <Panel title="Feature affinity" icon={Layers} sub="Pairs used together more than chance (lift)">
                {A.affinity.length ? (
                  <table className="ap-table"><thead><tr><th>Pair</th><th>Lift</th><th>Sessions</th></tr></thead>
                    <tbody>{A.affinity.map((p) => <tr key={`${p.a}${p.b}`}><td style={{ textTransform: 'capitalize' }}><b>{p.a}</b> + <b>{p.b}</b></td><td>{p.lift.toFixed(1)}×</td><td>{p.count}</td></tr>)}</tbody></table>
                ) : <Empty title="No strong pairs yet" text="Needs a few more multi-feature sessions." />}
              </Panel>
              <Panel title="Where sessions begin" icon={Play}>
                <BarList rows={A.starts.map((s) => ({ label: s.label, v: s.share * 100, display: fmtPct(s.share * 100) }))} color="#10B981" max={100} />
              </Panel>
              <Panel title="Where sessions end" icon={X} sub="Share of visits to a screen that were the last action">
                <BarList rows={A.exits.map((s) => ({ label: s.label, v: s.rate * 100, display: fmtPct(s.rate * 100) }))} color="#EF4444" max={100} />
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
                        {c.cells.map((cell, k) => <td key={k} style={cell ? { background: `rgba(16,185,129,${(0.08 + cell.pct / 130).toFixed(2)})`, color: cell.pct > 60 ? '#064e3b' : 'var(--ink2)' } : { color: 'var(--faint)' }}>{cell ? `${cell.pct.toFixed(0)}%` : '·'}</td>)}</tr>))}</tbody></table>
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
                  <div style={{ textAlign: 'center', padding: '14px 0' }}>
                    <div style={{ fontSize: 44, fontWeight: 800, color: A.oltEffect >= 1 ? '#059669' : '#dc2626' }}>{A.oltEffect.toFixed(1)}×</div>
                    <div style={{ color: 'var(--mute)' }}>events per user, linked vs not linked</div>
                  </div>
                ) : <Empty title="Not enough users" text="Needs at least 3 active users in each group." />}
              </Panel>
            </div>
          </div>
        )}
      </>
    );
  };

  /* -------------------------------- TIMELINE -------------------------------- */
  const Timeline = () => {
    if (noEvents) return <NoData />;
    const keys = A.dayKeys.slice(-14);
    const mx = Math.max(...A.dayHour.slice(-14).flat(), 1);
    const dIdx = A.dayKeys.indexOf(selectedDay);
    const dayEvents = [];
    const ds = dayStartSec(selectedDay);
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
      <div className="ap-grid">
        <Panel title="Intensity by day and hour" icon={Calendar} sub="Last 14 days, IST. Click a day to inspect it." >
          {keys.map((k) => {
            const di = A.dayKeys.indexOf(k);
            return (
              <div key={k} className={`ap-strip ${selectedDay === k ? 'on' : ''}`} onClick={() => setSelectedDay(k)}>
                <span className="d">{fmtDayLong(k)}</span>
                {A.dayHour[di].map((v, h) => <span key={h} className="c" title={`${fmtDayLong(k)} ${fmtHour(h)}: ${v} events`} style={{ background: v ? heatColor(v / mx) : '#F1F4F9' }} />)}
                <span className="t">{fmtNum(A.evPerDay[di])}</span>
              </div>
            );
          })}
          <div style={{ display: 'grid', gridTemplateColumns: '78px 1fr 52px', gap: 3, padding: '4px 6px' }}>
            <span /><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--faint)' }}><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div><span />
          </div>
        </Panel>

        <Panel title={`Session swimlanes · ${fmtDayLong(selectedDay)}`} icon={GitBranch} sub={`${sess.length} sessions · ${perUser.size} users. Bars are sessions; colour is the user's segment.`}>
          {lanes.length ? (
            <>
              {lanes.map((email) => (
                <div className="ap-lane" key={email}>
                  <div className="who" title={email} onClick={() => setSelectedUser(email)} style={{ cursor: 'pointer' }}>{nameOf(email)}</div>
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
          right={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{typeSet.map((t) => <button key={t} className={`ap-pill ${evFilter === t ? 'on' : ''}`} style={{ padding: '5px 11px', fontSize: 12 }} onClick={() => setEvFilter(t)}>{t.replace(/_/g, ' ')}</button>)}</div>}>
          <div className="ap-stream">
            {shown.length ? shown.map((e, i) => (
              <div className="ap-ev" key={i}>
                <span className="tm">{fmtClock(e.t)}</span>
                <span><b style={{ cursor: 'pointer' }} onClick={() => setSelectedUser(e.email)}>{nameOf(e.email)}</b> <span style={{ color: 'var(--mute)' }}>·</span> <span style={{ textTransform: 'capitalize' }}>{e.meta.label}</span></span>
                <span className="ap-badge" style={{ background: '#f1f4fa', color: 'var(--ink2)' }}>{e.meta.type.replace(/_/g, ' ')}</span>
              </div>
            )) : <Empty title="No events" text="Nothing matches this filter." />}
          </div>
        </Panel>
      </div>
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
        <div className="ap-toolbar">
          <div className="ap-search"><Search size={16} /><input className="ap-input" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
          <select className="ap-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="recent">Sort: last active</option><option value="events">Sort: events</option><option value="risk">Sort: churn risk</option>
          </select>
          {['All', ...Object.keys(SEGMENTS)].map((s) => <button key={s} className={`ap-pill ${segFilter === s ? 'on' : ''}`} onClick={() => setSegFilter(s)}>{s}</button>)}
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
                    <td>{us ? <Spark values={us.dayCounts} color={SEGMENTS[seg].color} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                    <td>{us && us.riskConfident ? <><span className="ap-meter"><i style={{ width: `${us.risk}%`, background: us.risk > 75 ? '#EF4444' : us.risk > 45 ? '#F59E0B' : '#10B981' }} /></span> <span style={{ fontSize: 12 }}>{Math.round(us.risk)}%</span></> : <span style={{ color: 'var(--faint)', fontSize: 12 }}>n/a</span>}</td>
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
    const col = { positive: '#10B981', negative: '#EF4444', neutral: '#94A3B8' };
    return (
      <div className="ap-grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <Panel title={`All feedback (${F.items.length})`} icon={MessageSquare}>
          {F.items.length ? F.items.map((f, i) => (
            <div className="ap-fb" key={f._id || i} style={{ borderLeftColor: col[f.sentiment] }}>
              <header><b>{f.userName || f.userEmail}</b><span style={{ color: 'var(--mute)' }}>{new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · <span style={{ color: col[f.sentiment], fontWeight: 700 }}>{f.sentiment}</span></span></header>
              <p>{f.message}</p>
            </div>
          )) : <Empty title="No feedback yet" text="Messages submitted from the app will show up here." />}
        </Panel>
        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <Panel title="Sentiment" icon={Sparkles} sub="Lexicon-based, directional only">
            <div className="ap-seg-bar">{['positive', 'neutral', 'negative'].map((s) => <div key={s} style={{ width: `${(F[s === 'positive' ? 'pos' : s === 'negative' ? 'neg' : 'neu'] / total) * 100}%`, background: col[s] }} />)}</div>
            <div style={{ display: 'flex', gap: 14, fontSize: 13, flexWrap: 'wrap' }}>
              <span style={{ color: col.positive, fontWeight: 700 }}>{F.pos} positive</span><span style={{ color: col.neutral, fontWeight: 700 }}>{F.neu} neutral</span><span style={{ color: col.negative, fontWeight: 700 }}>{F.neg} negative</span>
            </div>
          </Panel>
          <Panel title="Recurring themes" icon={Target} sub="Most repeated words across messages">
            <BarList rows={F.topics.map((t) => ({ label: t.word, v: t.count }))} color="#8B5CF6" />
          </Panel>
        </div>
      </div>
    );
  };

  /* --------------------------------- WATCHER --------------------------------- */
  const WatcherTab = () => (
    <div className="ap-grid">
      <Panel title="Watcher status" icon={Radio} sub="Hourly McGraw Hill scrape with email alerts for changes and passed due dates"
        right={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="ap-btn" onClick={loadWatcher}><RefreshCw size={14} />Reload</button>
          <button className="ap-btn" disabled={!!watcherBusy} onClick={() => watcherAction('test-mail')}>{watcherBusy === 'test-mail' ? <Loader2 size={14} className="ap-spin" /> : <Send size={14} />}Test email</button>
          <button className="ap-btn primary" disabled={!!watcherBusy} onClick={() => watcherAction('run')}>{watcherBusy === 'run' ? <Loader2 size={14} className="ap-spin" /> : <Play size={14} />}Run check now</button>
        </div>}>
        {watcherMsg && <div className="ap-alert warn" style={{ marginTop: 0, marginBottom: 14 }}><AlertCircle size={16} />{watcherMsg}</div>}
        {watcher ? (
          <div className="ap-grid ap-3">
            {[['Enabled', watcher.enabled ? 'Yes' : 'No'], ['Mail provider', watcher.mailProvider], ['Interval', `${watcher.intervalMinutes || '—'} min`], ['Runs', watcher.status.runs], ['Last outcome', watcher.status.lastOutcome], ['Consecutive failures', watcher.consecutiveFailures], ['Last run', watcher.status.lastRunAt ? timeAgo(watcher.status.lastRunAt) : 'never'], ['Next run', watcher.status.nextRunAt ? new Date(watcher.status.nextRunAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'], ['Recipients', (watcher.recipients || []).length]].map(([k, v]) => (
              <div key={k} className="ap-seg-card"><div style={{ fontSize: 11, color: 'var(--mute)', textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700 }}>{k}</div><div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{String(v)}</div></div>
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
                  <td><span className="ap-badge" style={{ background: a.isPastDue ? '#EF44441f' : '#3B82F61f', color: a.isPastDue ? '#dc2626' : '#2563eb' }}>{a.dueLabel}</span></td>
                  <td><span className="ap-badge" style={{ background: '#f1f4fa', color: 'var(--ink2)' }}>{String(a.status).replace(/_/g, ' ')}</span></td></tr>
              ))}</tbody></table>
          </div>
        </Panel>
      )}
    </div>
  );

  /* ------------------------------- USER MODAL ------------------------------- */
  const UserModal = () => {
    const db = A.userInfo.get(selectedUser) || { email: selectedUser, name: selectedUser };
    const us = A.userMap.get(selectedUser);
    const seg = A.segOf.get(selectedUser) || 'Dormant';
    const freq = us ? (us.activeDays / A.N >= 0.5 ? 'almost daily' : us.activeDays / A.N >= 0.2 ? 'a few times a week' : 'occasionally') : null;
    return (
      <div className="ap-ov" onClick={() => setSelectedUser(null)}>
        <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ap-mh">
            <div className="ap-user" style={{ gap: 16 }}>
              {db.picture ? <img className="ap-avatar" style={{ width: 60, height: 60, borderRadius: 16 }} src={db.picture} alt="" referrerPolicy="no-referrer" /> : <span className="ap-avatar" style={{ width: 60, height: 60, borderRadius: 16, fontSize: 18 }}>{initials(db.name)}</span>}
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{db.name || db.email}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6, alignItems: 'center', color: 'var(--mute)', fontSize: 12.5 }}>
                  <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Mail size={13} />{db.email}</span>
                  <Seg name={seg} />
                  {db.defaultSection && <span className="ap-badge" style={{ background: '#f1f4fa', color: 'var(--ink2)' }}>Section {db.defaultSection}</span>}
                  <span className="ap-badge" style={{ background: db.oltUsername ? '#10B9811f' : '#EF44441f', color: db.oltUsername ? '#059669' : '#dc2626' }}>{db.oltUsername ? 'OLT linked' : 'No OLT'}</span>
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
                  <div className="ap-seg-card"><div className="lb" style={{ fontSize: 11, color: 'var(--mute)', fontWeight: 700, textTransform: 'uppercase' }}>Events</div><div style={{ fontSize: 24, fontWeight: 800 }}>{fmtNum(us.events)}</div></div>
                  <div className="ap-seg-card"><div style={{ fontSize: 11, color: 'var(--mute)', fontWeight: 700, textTransform: 'uppercase' }}>Sessions</div><div style={{ fontSize: 24, fontWeight: 800 }}>{us.sessionCount}</div></div>
                  <div className="ap-seg-card"><div style={{ fontSize: 11, color: 'var(--mute)', fontWeight: 700, textTransform: 'uppercase' }}>Churn risk</div><div style={{ fontSize: 24, fontWeight: 800 }}>{us.riskConfident ? `${Math.round(us.risk)}%` : 'n/a'}</div></div>
                </div>
                <div className="ap-grid ap-2">
                  <Panel title="30-day activity" icon={Calendar}>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${A.N},1fr)`, gap: 3 }}>
                      {us.dayCounts.map((c, i) => <span key={i} title={`${fmtDayLong(A.dayKeys[i])}: ${c} events`} style={{ height: 30, borderRadius: 4, background: c ? heatColor(c / Math.max(...us.dayCounts)) : '#F1F4F9' }} />)}
                    </div>
                  </Panel>
                  <Panel title="Hours they're active" icon={Clock}><HourBars values={us.hist} color="#3B82F6" /></Panel>
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
      <div className="ap-shell">
        <aside className="ap-side">
          <div className="ap-brand"><div className="lg"><LayoutDashboard size={20} color="#fff" /></div><span>Control Room</span></div>
          <div className="ap-nav-label">Workspace</div>
          {TABS.map((t) => (
            <button key={t.id} className={`ap-nav ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              <t.icon size={18} />{t.label}{t.tag && <span className="tag">{t.tag}</span>}
            </button>
          ))}
          <div className="ap-side-foot">
            <div><b>{fmtNum(A.totalEvents)}</b> events modelled</div>
            <div style={{ marginTop: 4 }}>Refreshed {loadedAt ? timeAgo(loadedAt) : '—'}</div>
          </div>
          <button className="ap-logout" onClick={logout}><LogOut size={16} />Logout</button>
        </aside>
        <main className="ap-main">
          <div className="ap-top">
            <div><h2>{title}</h2><p>{subtitle}</p></div>
            <div className="r">
              <span className="ap-chip"><span className="ap-dot" />Live · {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              <button className="ap-btn" onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'ap-spin' : ''} />Refresh</button>
            </div>
          </div>
          <div className="ap-content">
            {insightsError && <div className="ap-alert warn" style={{ marginTop: 0, marginBottom: 18 }}><AlertCircle size={16} />{insightsError}</div>}
            {error && <div className="ap-alert err" style={{ marginTop: 0, marginBottom: 18 }}><AlertCircle size={16} />{error}</div>}
            {/* called as functions (not <Components/>) so inputs keep focus between renders */}
            {tab === 'overview' && Overview()}
            {tab === 'intel' && Intel()}
            {tab === 'timeline' && Timeline()}
            {tab === 'users' && UsersTab()}
            {tab === 'feedback' && FeedbackTab()}
            {tab === 'watcher' && WatcherTab()}
          </div>
        </main>
      </div>
      {selectedUser && UserModal()}
    </div>
  );
}

export { analyze };
export default AdminPortal;