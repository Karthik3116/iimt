import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
// Added Download and Share icons for the install prompts
import { Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, RefreshCw, ChevronLeft, ChevronRight, Hand, MessageSquare, Lock, ListTodo, Settings, Download, Share } from 'lucide-react';
import { TodoModal, TodoSummaryBar } from './TodoWidgets';
import { Analytics } from '@vercel/analytics/react';

import './App.css';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';
// const API_BASE_URL =  'http://localhost:5000';

const SWIPE_THRESHOLD = 40;
const SWIPE_HINT_MAX_SHOWS = 3;
const SWIPE_HINT_STORAGE_KEY = 'iimt_swipe_hint_shown_count';
const SWIPE_HINT_AUTO_DISMISS_MS = 3200;
const SECTION_STORAGE_KEY = 'iimt_section'; // NEW: persists the student's last-picked section

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && window.location.pathname !== '/admin') {
      googleLogout();
      localStorage.removeItem('iimt_user');
      localStorage.removeItem('iimt_token');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('timetable');

  // NEW: initialize section synchronously from localStorage so there's no
  // flash/glitch of the wrong section's timetable before the saved value loads.
  const [section, setSection] = useState(() => {
    const stored = localStorage.getItem(SECTION_STORAGE_KEY);
    return stored && SECTIONS.includes(stored) ? stored : 'A';
  });

  const [cache, setCache] = useState({});
  const [scheduleData, setScheduleData] = useState([]);
  const [summaryData, setSummaryData] = useState({ headers: [], rows: [] });

  const [selectedDate, setSelectedDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [maxDate, setMaxDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [daySwipeAnim, setDaySwipeAnim] = useState('fade-in');
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hintHandledThisSession = useRef(false);
  const hintDismissTimer = useRef(null);

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // NEW: Settings modal (lets a student change/persist their section)
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsSectionDraft, setSettingsSectionDraft] = useState(section);
  const [settingsStatus, setSettingsStatus] = useState('');

  // NEW: live-sync metadata (when the Excel data was last pulled / will next refresh)
  const [syncMeta, setSyncMeta] = useState({ lastFetchTime: null, nextRefreshTime: null, cacheTTLMs: null });
  const [nowTick, setNowTick] = useState(Date.now()); // ticks so the banner countdown stays live

  // TODO STATE
  const [todos, setTodos] = useState({});
  const [activeTodoClass, setActiveTodoClass] = useState(null);

  // --- PWA INSTALLATION STATE ---
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    // Detect iOS devices for manual install instructions
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIOSDevice && !isStandalone) {
      setIsIOS(true);
      setIsInstallable(true);
    }

    // Capture standard install prompt for Android/Desktop
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Hide button if successfully installed
    window.addEventListener('appinstalled', () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSPrompt(true);
      return;
    }
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstallable(false);
      setDeferredPrompt(null);
    }
  };
  // -----------------------------

  const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const getFallbackAvatar = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;
  };

  const fetchUserTodos = async (token) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/todos`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTodos(res.data);
    } catch (err) {
      console.error("Failed to fetch todos from DB", err);
    }
  };

  // NEW: pull the student's saved section preference from the server and apply it
  const fetchUserProfile = async (token) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/user/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const savedSection = res.data?.user?.defaultSection;
      if (savedSection && SECTIONS.includes(savedSection)) {
        setSection(savedSection);
        localStorage.setItem(SECTION_STORAGE_KEY, savedSection);
      }
    } catch (err) {
      console.error("Failed to fetch user profile", err);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('iimt_user');
    const storedToken = localStorage.getItem('iimt_token');
    if (storedUser && storedToken) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      fetchUserTodos(storedToken);
      fetchUserProfile(storedToken);
    } else {
      localStorage.removeItem('iimt_user');
      localStorage.removeItem('iimt_token');
    }
  }, []);

  // NEW: keep localStorage in sync whenever the section changes, and push the
  // change to the server so it's remembered for this student on any device.
  useEffect(() => {
    localStorage.setItem(SECTION_STORAGE_KEY, section);
    setSettingsSectionDraft(section);
    if (user) {
      const token = localStorage.getItem('iimt_token');
      axios.post(`${API_BASE_URL}/api/user/section`, { section }, {
        headers: { Authorization: `Bearer ${token}` }
      }).catch((err) => console.error("Failed to save section preference", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user]);

  // OPTIMISTIC SYNC LOGIC — todos are now keyed date -> section -> subject
  const handleUpdateTodos = async (date, sec, subject, newTodoList) => {
    // 1. Optimistic Update (UI updates instantly)
    setTodos(prev => {
      const updated = { ...prev };
      if (!updated[date]) updated[date] = {};
      if (!updated[date][sec]) updated[date][sec] = {};
      updated[date][sec][subject] = newTodoList;

      if (newTodoList.length === 0) delete updated[date][sec][subject];
      if (Object.keys(updated[date][sec] || {}).length === 0) delete updated[date][sec];
      if (Object.keys(updated[date] || {}).length === 0) delete updated[date];

      return updated;
    });

    // 2. Background DB Sync
    try {
      const token = localStorage.getItem('iimt_token');
      await axios.post(`${API_BASE_URL}/api/todos`,
        { date, section: sec, subject, tasks: newTodoList },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error("Failed to sync todo update to server", err);
    }
  };

  useEffect(() => {
    if (user) fetchTimetable(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) fetchTimetable(section, false, true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, section]);

  // NEW: auto-refresh once the server's cache TTL window has elapsed, so the
  // page pulls fresh Excel data automatically while it stays open — no manual
  // "Sync Data" click required.
  useEffect(() => {
    if (!user || !syncMeta.nextRefreshTime) return;
    const interval = setInterval(() => {
      setNowTick(Date.now());
      if (Date.now() >= syncMeta.nextRefreshTime) {
        fetchTimetable(section, false, true);
      }
    }, 15000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, section, syncMeta.nextRefreshTime]);

  useEffect(() => {
    if (!user || hintHandledThisSession.current) return;
    hintHandledThisSession.current = true;
    const shownCount = parseInt(localStorage.getItem(SWIPE_HINT_STORAGE_KEY) || '0', 10);

    if (shownCount < SWIPE_HINT_MAX_SHOWS) {
      localStorage.setItem(SWIPE_HINT_STORAGE_KEY, String(shownCount + 1));
      const openTimer = setTimeout(() => {
        setShowSwipeHint(true);
        hintDismissTimer.current = setTimeout(() => setShowSwipeHint(false), SWIPE_HINT_AUTO_DISMISS_MS);
      }, 400);
      return () => clearTimeout(openTimer);
    }
  }, [user]);

  useEffect(() => {
    return () => { if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current); };
  }, []);

  const dismissSwipeHint = () => {
    if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current);
    setShowSwipeHint(false);
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setAuthError('');
      const res = await axios.post(`${API_BASE_URL}/api/auth/google`, { token: credentialResponse.credential });

      const loggedInUser = res.data.user;
      const sessionToken = res.data.token;

      setUser(loggedInUser);
      localStorage.setItem('iimt_user', JSON.stringify(loggedInUser));
      localStorage.setItem('iimt_token', sessionToken);

      // Fetch fresh todos + saved section preference for newly logged in user
      fetchUserTodos(sessionToken);
      fetchUserProfile(sessionToken);

    } catch (err) {
      if (err.response?.status === 429) setAuthError(err.response.data.error || 'Too many attempts. Try again later.');
      else setAuthError(err.response?.data?.error || 'Authentication failed. Please try again.');
    }
  };

  const handleLogout = () => {
    googleLogout();
    setUser(null);
    setTodos({});
    localStorage.removeItem('iimt_user');
    localStorage.removeItem('iimt_token');
    setCache({});
  };

  const applyDateLogic = (data) => {
    const validDates = data.map(d => d.isoDate).filter(Boolean);
    if (validDates.length > 0) {
      validDates.sort();
      let min = validDates[0];
      let max = validDates[validDates.length - 1];
      const todayIST = getTodayIST();

      if (todayIST < min) min = todayIST;
      if (todayIST > max) max = todayIST;

      setMinDate(min);
      setMaxDate(max);
      setSelectedDate(todayIST);
    } else {
      setMinDate('');
      setMaxDate('');
      setSelectedDate('');
    }
  };

  const fetchTimetable = async (sec, forceBackendSync = false, isBackgroundRefresh = false) => {
    if (!forceBackendSync && !isBackgroundRefresh && cache[sec]) {
      setScheduleData(cache[sec].timetable);
      setSummaryData(cache[sec].summary);
      if (cache[sec].meta) setSyncMeta(cache[sec].meta);
      applyDateLogic(cache[sec].timetable);
      return;
    }
    if (!isBackgroundRefresh) { setLoading(true); setError(''); }

    try {
      const token = localStorage.getItem('iimt_token');
      const res = await axios.get(`${API_BASE_URL}/api/timetable/${sec}?force=${forceBackendSync}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const data = res.data.timetable;
      const summary = res.data.summary;
      const meta = res.data.meta;

      setScheduleData(data);
      setSummaryData(summary);
      if (meta) setSyncMeta(meta);

      if (!isBackgroundRefresh) applyDateLogic(data);
      setCache(prevCache => ({ ...prevCache, [sec]: { timetable: data, summary: summary, meta } }));
    } catch (err) {
      if (err.response?.status === 429) {
          if (!isBackgroundRefresh) setError('Server busy: Rate limit exceeded. Try again in a few minutes.');
      } else if (err.response?.status !== 401) {
          if (!isBackgroundRefresh) setError('System Error: Unable to fetch ERP data.');
      }
    } finally {
      if (!isBackgroundRefresh) setLoading(false);
    }
  };

  const handleSyncData = () => {
    setCache({});
    fetchTimetable(section, true, false);
  };

  const handleResetDate = () => {
    setDaySwipeAnim('fade-in');
    setSelectedDate(getTodayIST());
  };

  const submitFeedback = async () => {
    if (!feedbackText.trim()) return;
    setIsSubmitting(true);
    setFeedbackStatus('Sending...');
    try {
      const token = localStorage.getItem('iimt_token');
      await axios.post(`${API_BASE_URL}/api/feedback`, { message: feedbackText }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setFeedbackStatus('Sent! Thank you.');
      setTimeout(() => {
        setShowFeedbackModal(false);
        setFeedbackText('');
        setFeedbackStatus('');
        setIsSubmitting(false);
      }, 2000);
    } catch (error) {
      setIsSubmitting(false);
      if (error.response?.status === 429) setFeedbackStatus('Rate limited. Please wait.');
      else setFeedbackStatus('Failed to send.');
    }
  };

  // NEW: Settings modal save handler
  const saveSectionSetting = () => {
    setSettingsStatus('Saved!');
    setSection(settingsSectionDraft); // triggers persistence effect + timetable refetch
    setTimeout(() => {
      setShowSettingsModal(false);
      setSettingsStatus('');
    }, 700);
  };

  const currentDayData = scheduleData.find(d => d.isoDate === selectedDate);
  const formatHeaderDate = (isoDate, dayString) => {
    if (!isoDate) return 'Timetable';
    const dateObj = new Date(isoDate);
    const formatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${dayString}, ${formatted}`;
  };

  // NEW: format an epoch ms timestamp as a local (IST-friendly) HH:MM time string
  const formatClockTime = (ts) => {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

  // NEW: minutes remaining until the next automatic data refresh
  const minutesToNextRefresh = () => {
    if (!syncMeta.nextRefreshTime) return null;
    const diffMs = syncMeta.nextRefreshTime - nowTick;
    return Math.max(0, Math.ceil(diffMs / 60000));
  };

  const shiftIsoDate = (isoDate, days) => {
    const d = new Date(`${isoDate}T00:00:00`);
    d.setDate(d.getDate() + days);
    return d.toLocaleDateString('en-CA');
  };

  const goToDay = (direction) => {
    if (!selectedDate) return;
    const delta = direction === 'next' ? 1 : -1;
    const newDate = shiftIsoDate(selectedDate, delta);

    if (direction === 'next' && maxDate && newDate > maxDate) return;
    if (direction === 'prev' && minDate && newDate < minDate) return;

    setDaySwipeAnim(direction === 'next' ? 'swipe-left' : 'swipe-right');
    setSelectedDate(newDate);
  };

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    setIsDragging(true);
    setDragX(0);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const deltaX = e.touches[0].clientX - touchStartX.current;
    const deltaY = e.touches[0].clientY - touchStartY.current;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      let resistance = 0.45;
      if (deltaX < 0 && (!maxDate || selectedDate >= maxDate)) resistance = 0.08;
      if (deltaX > 0 && (!minDate || selectedDate <= minDate)) resistance = 0.08;
      setDragX(deltaX * resistance);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (Math.abs(dragX) > SWIPE_THRESHOLD) goToDay(dragX < 0 ? 'next' : 'prev');
    setDragX(0);
  };

  const hasTasksToday = todos[selectedDate]?.[section] && Object.keys(todos[selectedDate][section]).length > 0;

  const injectedStyles = `
    /* --- MOBILE RESPONSIVENESS FIXES --- */
    @media (max-width: 768px) {
      .dashboard-layout { min-height: 100dvh; }
      .main-content { padding-bottom: ${hasTasksToday ? '160px' : '120px'} !important; transition: padding-bottom 0.3s ease;}
      .timetable-section { padding-bottom: env(safe-area-inset-bottom, 40px); }
      .mobile-swipe-hint { display: flex !important; }
      .swipe-tutorial-overlay { display: flex !important; }

      /* Collapse admin sidebar on very small screens */
      .admin-dashboard-layout { flex-direction: column !important; overflow: auto !important; }
      .admin-sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid #eee; flex: none !important; max-height: 350px;}
    }

    /* --- SATISFYING LOADER ANIMATION --- */
    .satisfying-loader-container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; gap: 1.5rem; width: 100%; }
    .dot-wave { display: flex; gap: 12px; }
    .dot-wave .dot { width: 16px; height: 16px; border-radius: 50%; background-color: var(--accent-gold, #dba315); animation: smooth-wave 1.4s ease-in-out infinite; box-shadow: 0 4px 10px rgba(219, 163, 21, 0.3); }
    .dot-wave .dot:nth-child(1) { animation-delay: 0s; }
    .dot-wave .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot-wave .dot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes smooth-wave {
      0%, 100% { transform: translateY(0) scale(0.8); opacity: 0.3; }
      50% { transform: translateY(-14px) scale(1.1); opacity: 1; }
    }
    .loading-text { color: var(--text-secondary, #888); font-size: 1.05rem; font-weight: 500; letter-spacing: 0.5px; animation: pulse-text 2s ease-in-out infinite; }
    @keyframes pulse-text { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

    /* --- PREMIUM SWIPE NAVIGATION --- */
    .mobile-swipe-hint { display: none; align-items: center; justify-content: center; gap: 6px; color: var(--text-secondary, #888); font-size: 0.78rem; opacity: 0.65; margin: 0 0 0.75rem 0; user-select: none; }
    .timetable-section { touch-action: pan-y; overflow-x: hidden; }
    .day-anim-wrapper { width: 100%; will-change: transform, opacity; }

    @keyframes premiumSlideInRight { from { transform: translateX(45px) scale(0.98); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    @keyframes premiumSlideInLeft { from { transform: translateX(-45px) scale(0.98); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
    @keyframes premiumFadeIn { from { transform: translateY(12px) scale(0.99); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
    .swipe-left { animation: premiumSlideInRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .swipe-right { animation: premiumSlideInLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .fade-in { animation: premiumFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

    /* --- TUTORIAL OVERLAY --- */
    .swipe-tutorial-overlay { position: fixed; inset: 0; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(3px); z-index: 9999; display: none; align-items: center; justify-content: center; animation: tutorialOverlayFade 0.35s ease forwards; -webkit-tap-highlight-color: transparent; }
    @keyframes tutorialOverlayFade { from { opacity: 0; } to { opacity: 1; } }
    .swipe-tutorial-card { display: flex; flex-direction: column; align-items: center; gap: 1.1rem; padding: 2rem 1.5rem; animation: tutorialCardPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
    @keyframes tutorialCardPop { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .swipe-tutorial-track { position: relative; width: 130px; height: 64px; display: flex; align-items: center; justify-content: center; }
    .swipe-tutorial-track::before, .swipe-tutorial-track::after { content: ''; position: absolute; top: 50%; width: 34px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); transform: translateY(-50%); animation: tutorialTrackPulse 1.6s ease-in-out infinite; }
    .swipe-tutorial-track::before { left: 0; }
    .swipe-tutorial-track::after { right: 0; animation-delay: 0.3s; }
    @keyframes tutorialTrackPulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.5; } }
    .swipe-tutorial-hand { color: #fff; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45)); animation: tutorialHandSwipe 1.6s ease-in-out infinite; }
    @keyframes tutorialHandSwipe { 0% { transform: translateX(38px) rotate(-6deg); opacity: 0; } 14% { opacity: 1; } 50% { transform: translateX(-38px) rotate(6deg); opacity: 1; } 68% { opacity: 0; } 100% { transform: translateX(38px) rotate(-6deg); opacity: 0; } }
    .swipe-tutorial-text { color: #fff; font-size: 0.95rem; font-weight: 600; letter-spacing: 0.2px; text-align: center; }
    .swipe-tutorial-dismiss { color: rgba(255, 255, 255, 0.55); font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem; }

    /* --- FIX: FORCED TEXT VISIBILITY ON ALL INPUTS & TEXTAREAS --- */
    .modal-content textarea, .admin-login input, .todo-input-form input {
      color: #333 !important;
      background-color: #fff !important;
    }

    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; padding: 2rem; border-radius: 12px; width: 90%; max-width: 400px; display: flex; flex-direction: column; gap: 1rem; color: #333; }
    .modal-content textarea { width: 100%; height: 100px; padding: 10px; border-radius: 8px; border: 1px solid #ccc; font-family: inherit; resize: none; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn-submit { background: var(--accent-gold); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .btn-submit:disabled { background: #d0b875; cursor: not-allowed; }
    .btn-cancel { background: #eee; color: #333; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .btn-cancel:disabled { background: #f5f5f5; color: #999; cursor: not-allowed; }

    /* --- NEW: SETTINGS MODAL --- */
    .settings-section-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .settings-section-btn { padding: 10px 0; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; color: #333; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    .settings-section-btn.active { background: var(--accent-gold); border-color: var(--accent-gold); color: #fff; }
    .settings-status-text { font-size: 0.85rem; color: var(--accent-gold); font-weight: 600; }

    /* --- NEW: LIVE DATA BANNER --- */
    .live-data-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; background: rgba(76, 175, 80, 0.08); border: 1px solid rgba(76, 175, 80, 0.25); color: #2f6b32; border-radius: 10px; padding: 8px 14px; font-size: 0.82rem; margin-bottom: 1rem; }
    .live-data-dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; box-shadow: 0 0 0 rgba(76, 175, 80, 0.5); animation: liveDotPulse 1.8s infinite; flex-shrink: 0; }
    @keyframes liveDotPulse { 0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5); } 70% { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); } 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); } }
    .live-data-banner strong { font-weight: 700; }
    .live-data-meta { color: #4a7a4c; opacity: 0.85; }

    /* --- NEW: SESSION NUMBER BADGE --- */
    .session-badge { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.3px; color: var(--accent-gold); background: rgba(219, 163, 21, 0.12); border: 1px solid rgba(219, 163, 21, 0.3); border-radius: 6px; padding: 2px 8px; margin-top: 6px; display: inline-block; }

    /* --- TO-DO WIDGET STYLES --- */
    .class-header-flex { display: flex; justify-content: space-between; align-items: flex-start; }
    .add-task-btn { background: rgba(219, 163, 21, 0.1); border: 1px solid rgba(219, 163, 21, 0.3); border-radius: 8px; padding: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--accent-gold); position: relative; transition: all 0.2s ease; }
    .add-task-btn:hover { background: rgba(219, 163, 21, 0.2); }
    .task-indicator { position: absolute; top: -3px; right: -3px; background: red; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid white; }

    .todo-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 2000; display: flex; align-items: flex-end; justify-content: center; animation: fadeOverlay 0.3s ease; }
    @keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }

    .todo-bottom-sheet { background: white; width: 100%; max-width: 600px; border-radius: 20px 20px 0 0; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 -4px 20px rgba(0,0,0,0.15); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; max-height: 80vh; color: #333; }
    @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }

    .todo-sheet-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
    .todo-subject { margin: 0; font-size: 1.2rem; color: #333; }
    .todo-date { margin: 4px 0 0 0; font-size: 0.85rem; color: #888; }
    .todo-close-btn { background: none; border: none; padding: 4px; cursor: pointer; color: #666; border-radius: 50%; display: flex; }
    .todo-close-btn:hover { background: #f5f5f5; }

    .todo-list-container { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
    .todo-empty { text-align: center; color: #aaa; font-style: italic; padding: 2rem 0; font-size: 0.9rem; }

    .todo-item { display: flex; align-items: center; gap: 12px; background: #f9f9f9; padding: 12px; border-radius: 8px; border: 1px solid #eee; transition: all 0.2s; color: #333;}
    .todo-item.completed { opacity: 0.6; }
    .todo-item.completed .todo-text { text-decoration: line-through; color: #888; }
    .todo-check-btn { background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; }
    .todo-text { flex: 1; font-size: 0.95rem; word-break: break-word; }
    .todo-delete-btn { background: none; border: none; color: #ff4d4f; padding: 6px; cursor: pointer; border-radius: 6px; display: flex; }
    .todo-delete-btn:hover { background: #fff1f0; }

    .todo-input-form { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
    .todo-input-form input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; outline: none; }
    .todo-input-form input:focus { border-color: var(--accent-gold); }
    .todo-input-form button { background: var(--accent-gold); color: white; border: none; padding: 0 16px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
    .todo-input-form button:disabled { background: #e0c88b; cursor: not-allowed; }

    .todo-summary-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: white; box-shadow: 0 -4px 12px rgba(0,0,0,0.1); border-radius: 16px 16px 0 0; z-index: 100; display: flex; flex-direction: column; transition: max-height 0.3s ease; max-height: 60px; overflow: hidden; color: #333; }
    @media (min-width: 769px) { .todo-summary-bar { width: calc(100% - 260px); left: 260px; } }
    .todo-summary-bar.expanded { max-height: 40vh; }
    .todo-summary-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; cursor: pointer; background: white; user-select: none; }
    .todo-summary-info { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: #333; }
    .todo-summary-list { padding: 0 1.5rem 1.5rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; }
    .todo-summary-subject-group { background: #fcfcfc; border: 1px solid #eee; border-radius: 8px; padding: 10px; cursor: pointer; }
    .todo-summary-subject-title { font-size: 0.8rem; font-weight: 700; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .todo-summary-item { display: flex; align-items: flex-start; gap: 8px; font-size: 0.9rem; margin-bottom: 6px; }
    .todo-summary-item:last-child { margin-bottom: 0; }
    .todo-summary-item.completed { opacity: 0.5; text-decoration: line-through; }
    .todo-summary-text { flex: 1; word-break: break-word; line-height: 1.4; margin-top: -1px; }

    /* --- NEW ADMIN PORTAL DASHBOARD LAYOUT --- */
    .admin-container-fluid { font-family: sans-serif; color: #333; height: 100vh; background: #f5f5f5;}
    .admin-login { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #fff;}
    .admin-login input { padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #ccc; }
    .admin-login button { background: var(--accent-gold); color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; }

    .admin-dashboard-layout { display: flex; height: 100vh; overflow: hidden; }
    .admin-sidebar { width: 300px; background: white; border-right: 1px solid #eee; display: flex; flex-direction: column; }
    .admin-sidebar-header { padding: 1.5rem; border-bottom: 1px solid #eee; }
    .admin-sidebar-content { flex: 1; overflow-y: auto; padding: 1rem; }

    .admin-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #fafafa;}
    .admin-main-header { padding: 1.5rem; border-bottom: 1px solid #eee; background: white; display: flex; justify-content: space-between; align-items: center;}
    .admin-main-content { flex: 1; overflow-y: auto; padding: 1.5rem; }

    .active-user-card { display: flex; align-items: center; gap: 10px; padding: 10px; border-radius: 8px; border: 1px solid #eee; margin-bottom: 8px; transition: background 0.2s;}
    .active-user-card:hover { background: #f9f9f9; }
    .active-user-avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; }
    .active-user-info { flex: 1; overflow: hidden; }
    .active-user-name { font-weight: 600; font-size: 0.9rem; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .active-user-time { font-size: 0.75rem; color: #666; }

    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; }
    .status-dot.online { background: #4caf50; box-shadow: 0 0 5px rgba(76, 175, 80, 0.4); }

    .feedback-card { background: #fff; padding: 15px; margin-bottom: 15px; border-radius: 8px; border-left: 4px solid var(--accent-gold); color: #333; box-shadow: 0 2px 8px rgba(0,0,0,0.05);}
  `;

  if (window.location.pathname === '/admin') {
    return <AdminPortal injectedStyles={injectedStyles} />;
  }

  if (!user) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <div className="login-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
          <div className="login-card" style={{ padding: '3rem', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'center', minWidth: '320px' }}>
            <h1 style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem' }}>IIM Trichy</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>PGPM Term-I Portal</p>
            <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setAuthError('Google Login Failed')} useOneTap />
            {authError && <div style={{ color: 'var(--color-cancelled)', marginTop: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>{authError}</div>}
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>*Requires @iimtrichy.ac.in email address</p>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  const dragStyle = {
    transform: `translateX(${dragX}px) scale(${1 - Math.abs(dragX) / 3000})`,
    opacity: 1 - Math.abs(dragX) / 500,
    transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const nextRefreshMins = minutesToNextRefresh();

  return (
    <>
      <style>{injectedStyles}</style>

      {/* NEW: iOS Install Instructions Modal */}
      {showIOSPrompt && (
        <div className="modal-overlay" onClick={() => setShowIOSPrompt(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Install on iOS</h3>
            <p style={{ fontSize: '0.95rem', color: '#666', margin: '10px 0', lineHeight: '1.5' }}>
              To install this app on your iPhone or iPad:<br/><br/>
              1. Tap the <strong>Share</strong> button <Share size={16} style={{display: 'inline', verticalAlign: 'middle', margin: '0 2px'}}/> at the bottom of Safari.<br/>
              2. Scroll down and select <strong>"Add to Home Screen"</strong>.
            </p>
            <div className="modal-actions">
              <button className="btn-submit" onClick={() => setShowIOSPrompt(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackModal && (
        <div className="modal-overlay" onClick={() => !isSubmitting && setShowFeedbackModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Submit Feedback</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>Report an issue or suggest a feature.</p>
            <textarea placeholder="Type your message here... (max 1000 chars)" maxLength={1000} value={feedbackText} onChange={e => setFeedbackText(e.target.value)} disabled={isSubmitting} />
            {feedbackStatus && <div style={{fontSize: '0.85rem', color: 'var(--accent-gold)'}}>{feedbackStatus}</div>}
            <div className="modal-actions">
              <button className="btn-cancel" disabled={isSubmitting} onClick={() => setShowFeedbackModal(false)}>Cancel</button>
              <button className="btn-submit" disabled={isSubmitting || !feedbackText.trim()} onClick={submitFeedback}>Submit</button>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal — lets a student change & persist their section */}
      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Settings</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>Choose your section. This is saved to your account and remembered next time you log in.</p>
            <div className="settings-section-grid">
              {SECTIONS.map(sec => (
                <button
                  key={sec}
                  className={`settings-section-btn ${settingsSectionDraft === sec ? 'active' : ''}`}
                  onClick={() => setSettingsSectionDraft(sec)}
                >
                  {sec}
                </button>
              ))}
            </div>
            {settingsStatus && <div className="settings-status-text">{settingsStatus}</div>}
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowSettingsModal(false)}>Cancel</button>
              <button className="btn-submit" onClick={saveSectionSetting}>Save</button>
            </div>
          </div>
        </div>
      )}

      <TodoModal
        isOpen={!!activeTodoClass}
        onClose={() => setActiveTodoClass(null)}
        activeClass={activeTodoClass}
        todos={todos}
        onUpdate={handleUpdateTodos}
      />

      {showSwipeHint && (
        <div className="swipe-tutorial-overlay" onClick={dismissSwipeHint} onTouchStart={dismissSwipeHint} role="button">
          <div className="swipe-tutorial-card">
            <div className="swipe-tutorial-track">
              <Hand size={40} className="swipe-tutorial-hand" strokeWidth={1.75} />
            </div>
            <div className="swipe-tutorial-text">Swipe left or right to change day</div>
            <div className="swipe-tutorial-dismiss">Tap anywhere to dismiss</div>
          </div>
        </div>
      )}

      <div className="dashboard-layout">
        <aside className="sidebar">
          <div className="brand-title">IIM Trichy</div>
          <div className="brand-subtitle">PGPM Term-I</div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
              <img src={user.picture || getFallbackAvatar(user.name)} alt="Profile" onError={(e) => { e.target.onerror = null; e.target.src = getFallbackAvatar(user.name); }} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
              <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{user.name}</div>
              </div>
          </div>

          <div className="nav-menu">
            <button className={`nav-btn ${activeTab === 'timetable' ? 'active' : ''}`} onClick={() => setActiveTab('timetable')}><Calendar size={18} /> Timetable</button>
            <button className={`nav-btn ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => setActiveTab('summary')}><Table2 size={18} /> Summary Table</button>
          </div>

          <div className="section-selector-container">
            <span className="section-label">Select Section</span>
            <div className="sec-grid">
              {SECTIONS.map((sec) => (
                <button key={sec} className={`section-btn ${section === sec ? 'active' : ''}`} onClick={() => setSection(sec)}>{sec}</button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isInstallable && (
                <button onClick={handleInstallClick} className="nav-btn" style={{ width: '100%', color: 'var(--accent-gold)', fontWeight: 'bold' }}>
                  <Download size={18} /> Install App
                </button>
              )}
              <button onClick={() => { setSettingsSectionDraft(section); setShowSettingsModal(true); }} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><Settings size={18} /> Settings</button>
              <button onClick={() => setShowFeedbackModal(true)} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><MessageSquare size={18} /> Provide Feedback</button>
              <button onClick={handleSyncData} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }} disabled={loading}><RefreshCw size={18} /> {loading ? 'Syncing...' : 'Sync Data'}</button>
              <button onClick={handleLogout} className="nav-btn" style={{ width: '100%', color: 'var(--color-cancelled)' }}><LogOut size={18} /> Sign Out</button>
          </div>
        </aside>

        <main className="main-content">
          {loading && (
            <div className="satisfying-loader-container">
              <div className="dot-wave"><div className="dot"></div><div className="dot"></div><div className="dot"></div></div>
              <div className="loading-text">Connecting to database...</div>
            </div>
          )}

          {error && <div className="empty-state" style={{color: '#eb3223'}}>{error}</div>}

          {!loading && !error && (
            <>
              {activeTab === 'timetable' && (
                <>
                  <div className="live-data-banner">
                    <span className="live-data-dot" />
                    <span><strong>Live data</strong> — synced directly from Excel, no need to refresh manually.</span>
                    <span className="live-data-meta">
                      Last synced {formatClockTime(syncMeta.lastFetchTime)} IST
                      {nextRefreshMins !== null && ` · Next auto-sync in ~${nextRefreshMins} min (at ${formatClockTime(syncMeta.nextRefreshTime)} IST)`}
                    </span>
                  </div>

                  <div className="top-toolbar">
                    <h2 className="view-title">
                      {currentDayData ? formatHeaderDate(currentDayData.isoDate, currentDayData.day) : formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}
                    </h2>
                    <div className="legend">
                      <div className="legend-item"><div className="legend-color" style={{ background: 'var(--color-makeup)' }}></div>Make-up</div>
                      <div className="legend-item"><div className="legend-color" style={{ background: 'var(--color-cancelled)' }}></div>Cancelled</div>
                    </div>
                    <div className="date-picker-group">
                      <button onClick={handleResetDate} className="nav-btn" style={{ padding: '0.6rem', border: '1px solid var(--border-color)', margin: '0' }} title="Snap back to Today"><CalendarSync size={18} color="var(--accent-gold)" /></button>
                      <input type="date" className="date-input" value={selectedDate} min={minDate} max={maxDate} onChange={(e) => { setDaySwipeAnim('fade-in'); setSelectedDate(e.target.value); }} disabled={!minDate} />
                    </div>
                  </div>

                  <div className="mobile-swipe-hint">
                    <ChevronLeft size={14} /> Swipe to change day <ChevronRight size={14} />
                  </div>

                  <section className="timetable-section" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                    <div key={selectedDate} className={`day-anim-wrapper ${daySwipeAnim || ''}`} onAnimationEnd={() => setDaySwipeAnim(null)}>
                      <div className="day-drag-surface" style={dragStyle}>
                        {!currentDayData && selectedDate && (
                          <div className="empty-state">No classes scheduled for {formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}. Enjoy your day!</div>
                        )}

                        {currentDayData && currentDayData.classes.map((cls, idx) => {
                          const cardStyle = cls.color ? { borderLeftColor: cls.color, backgroundColor: `${cls.color}10` } : {};
                          const hasTodos = todos[selectedDate]?.[section]?.[cls.subject]?.length > 0;
                          const isRemark = cls.time?.toLowerCase().includes('remarks');

                          return (
                            <div key={idx} className="class-card" style={cardStyle}>
                              {cls.status && (
                                <div className="status-pill" style={{ backgroundColor: cls.color }}>{cls.status}</div>
                              )}

                              <div className="class-header-flex">
                                <div className="time-badge" style={{ color: cls.color || 'var(--text-secondary)'}}>
                                  {cls.time.includes('Remarks') ? <Info size={18} /> : <Clock size={18} />}
                                  <span>{cls.time}</span>
                                </div>

                                <button className="add-task-btn" onClick={() => setActiveTodoClass({ subject: cls.subject, date: selectedDate, section })}>
                                  <ListTodo size={16} />
                                  {hasTodos && <span className="task-indicator" />}
                                </button>
                              </div>

                              <div className="class-details">
                                <div className="subject-name">{cls.subject}</div>
                                {cls.prof && (
                                  <div className="prof-badge" style={cls.color ? { color: cls.color, borderColor: `${cls.color}50` } : {}}>
                                    <UserIcon size={14} /> {cls.prof}
                                  </div>
                                )}
                                {!isRemark && cls.sessionNumber && (
                                  <div className="session-badge">Session {cls.sessionNumber}</div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </section>

                  <TodoSummaryBar
                    date={selectedDate}
                    section={section}
                    todos={todos}
                    onOpenClass={(subject) => setActiveTodoClass({ subject, date: selectedDate, section })}
                  />
                </>
              )}

              {activeTab === 'summary' && (
                <>
                  <div className="top-toolbar"><h2 className="view-title">Section {section} Academic Overview</h2></div>
                  {summaryData.headers.length > 0 ? (
                    <div className="table-container" style={{ overflowX: 'auto' }}>
                      <table className="erp-table" style={{ minWidth: '900px' }}>
                        <thead><tr>{summaryData.headers.map((header, idx) => <th key={idx}>{header}</th>)}</tr></thead>
                        <tbody>
                          {summaryData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>{row.map((cell, cellIdx) => <td key={cellIdx}>{cellIdx === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="empty-state">No summary data available.</div>}
                </>
              )}
            </>
          )}
        </main>
      </div>
      <Analytics />
    </>
  );
}

// --- SPLIT-PANE DASHBOARD COMPONENT ---
function AdminPortal({ injectedStyles }) {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);

  const [feedbacks, setFeedbacks] = useState([]);
  const [users, setUsers] = useState([]);

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/data`, { password });
      setFeedbacks(res.data.feedbacks);
      setUsers(res.data.users);
      setAuthenticated(true);
      setError('');
    } catch (err) {
      if (err.response?.status === 429) setError('Rate limit exceeded. Please wait before trying again.');
      else setError('Invalid Password');
    } finally { setIsLoading(false); }
  };

  const timeAgo = (date) => {
    if (!date) return "Never logged in";
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);

    let interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + "d ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + "h ago";
    interval = seconds / 60;
    if (interval > 5) return Math.floor(interval) + "m ago";

    return "Online Now";
  };

  return (
    <>
      <style>{injectedStyles}</style>
      <div className="admin-container-fluid">
        {!authenticated ? (
          <div className="admin-login">
            <Lock size={48} color="var(--accent-gold)" style={{marginBottom: '1rem'}} />
            <h2>Admin Portal</h2>
            <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column', width: '300px', marginTop: '1rem'}}>
              <input type="password" placeholder="Admin Password" value={password} onChange={e => setPassword(e.target.value)} disabled={isLoading} />
              <button type="submit" disabled={isLoading}>{isLoading ? 'Loading...' : 'View Dashboard'}</button>
            </form>
            {error && <p style={{color: 'red'}}>{error}</p>}
          </div>
        ) : (
          <div className="admin-dashboard-layout">

            {/* LEFT SIDEBAR: Active Users */}
            <aside className="admin-sidebar">
              <div className="admin-sidebar-header">
                <h3 style={{margin: 0}}>Active Users</h3>
                <p style={{margin: 0, fontSize: '0.8rem', color: '#666'}}>Total Accounts: {users.length}</p>
              </div>
              <div className="admin-sidebar-content">
                {users.map(u => {
                  const isOnline = timeAgo(u.lastActive) === "Online Now";
                  return (
                    <div key={u._id} className="active-user-card">
                      <img src={u.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=dba315&color=fff`} className="active-user-avatar" alt="Avatar"/>
                      <div className="active-user-info">
                        <div className="active-user-name" title={u.name}>{u.name}</div>
                        <div className="active-user-time">{timeAgo(u.lastActive)} {u.defaultSection ? `· Sec ${u.defaultSection}` : ''}</div>
                      </div>
                      <div className={`status-dot ${isOnline ? 'online' : ''}`}></div>
                    </div>
                  )
                })}
              </div>
            </aside>

            {/* MAIN CONTENT: Feedback */}
            <main className="admin-main">
              <div className="admin-main-header">
                <h2 style={{margin: 0}}>User Feedback</h2>
                <button className="nav-btn" onClick={() => { setAuthenticated(false); setPassword(''); setFeedbacks([]); setUsers([]); }}>Log Out</button>
              </div>
              <div className="admin-main-content">
                {feedbacks.length === 0 ? <p>No feedback available yet.</p> : null}
                {feedbacks.map((f, i) => (
                  <div className="feedback-card" key={i}>
                    <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
                      <strong>{f.userName} ({f.userEmail})</strong><span style={{fontSize: '0.8rem', color: '#666'}}>{new Date(f.createdAt).toLocaleString()}</span>
                    </div>
                    <p style={{margin: 0, whiteSpace: 'pre-wrap'}}>{f.message}</p>
                  </div>
                ))}
              </div>
            </main>

          </div>
        )}
      </div>
    </>
  );
}

export default App;