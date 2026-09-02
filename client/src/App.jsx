import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import { 
  Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, 
  RefreshCw, ChevronLeft, ChevronRight, Hand, MessageSquare, Lock, ListTodo, 
  Settings, Download, Share, ClipboardCheck, ChevronDown, ChevronUp, AlertCircle, 
  Eye, EyeOff, X, Sparkles, Activity, Users, MousePointer2, LayoutDashboard 
} from 'lucide-react';
import { TodoModal, TodoSummaryBar } from './TodoWidgets';
import { Analytics } from '@vercel/analytics/react';

// Import modularized Admin component
import AdminPortal from './Admin';

import './App.css';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const SWIPE_THRESHOLD = 40;
const SWIPE_HINT_MAX_SHOWS = 3;
const SWIPE_HINT_STORAGE_KEY = 'iimt_swipe_hint_shown_count';
const SWIPE_HINT_AUTO_DISMISS_MS = 3200;
const SECTION_STORAGE_KEY = 'iimt_section';

const BANNER_STORAGE_KEY = 'iimt_attendance_banner_dismissed';
const BANNER_START_KEY = 'iimt_attendance_banner_start';

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

// Analytics tracker helper
export const trackEvent = (eventType, eventName, metadata = {}) => {
  const token = localStorage.getItem('iimt_token');
  if (!token) return;
  axios.post(`${API_BASE_URL}/api/analytics`, { eventType, eventName, metadata }, {
    headers: { Authorization: `Bearer ${token}` }
  }).catch(() => {});
};

function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  const [activeTab, setActiveTab] = useState('timetable');

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

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsSectionDraft, setSettingsSectionDraft] = useState(section);
  const [settingsStatus, setSettingsStatus] = useState('');

  const [syncMeta, setSyncMeta] = useState({ lastFetchTime: null, nextRefreshTime: null, cacheTTLMs: null });
  const [nowTick, setNowTick] = useState(Date.now());

  const [todos, setTodos] = useState({});
  const [activeTodoClass, setActiveTodoClass] = useState(null);

  const [isReloading, setIsReloading] = useState(false);

  // --- ATTENDANCE STATE ---
  const [hasOltCreds, setHasOltCreds] = useState(false);
  const [showOltPopup, setShowOltPopup] = useState(false);
  const [attendanceData, setAttendanceData] = useState(null);
  const [isFetchingAttendance, setIsFetchingAttendance] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [showCredsForm, setShowCredsForm] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [expandedSubject, setExpandedSubject] = useState(null);
  const [attendanceFetchedSection, setAttendanceFetchedSection] = useState(null);
  const [fetchProgress, setFetchProgress] = useState({ step: 0, total: 8, message: '', status: 'idle' });
  const progressPollRef = useRef(null);
  const isFirstSectionRender = useRef(true);

  const [showFeatureBanner, setShowFeatureBanner] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    const isStandalone = ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIOSDevice && !isStandalone) {
      setIsIOS(true);
      setIsInstallable(true);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsInstallable(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', () => {
      setIsInstallable(false);
      setDeferredPrompt(null);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Persistent 5-Day OLT setup popup
  useEffect(() => {
    if (user && hasOltCreds === false) {
      const dismissed = sessionStorage.getItem('olt_popup_dismissed');
      if (!dismissed) {
        const timer = setTimeout(() => {
          setShowOltPopup(true);
          trackEvent('view', 'olt_setup_popup');
        }, 2500); // 2.5 second delay before popping up
        return () => clearTimeout(timer);
      }
    }
  }, [user, hasOltCreds]);

  // Feature Banner 5-Day Logic
  useEffect(() => {
    if (!user) return;
    const dismissed = localStorage.getItem(BANNER_STORAGE_KEY);
    if (dismissed === 'true') return;

    let startTime = localStorage.getItem(BANNER_START_KEY);
    if (!startTime) {
      startTime = Date.now().toString();
      localStorage.setItem(BANNER_START_KEY, startTime);
    }

    const elapsedDays = (Date.now() - parseInt(startTime, 10)) / (1000 * 60 * 60 * 24);
    if (elapsedDays < 5) {
      setShowFeatureBanner(true);
    } else {
      setShowFeatureBanner(false);
    }
  }, [user]);

  const dismissFeatureBanner = () => {
    localStorage.setItem(BANNER_STORAGE_KEY, 'true');
    setShowFeatureBanner(false);
    trackEvent('action', 'dismiss_feature_banner');
  };

  const handleShareApp = async () => {
    trackEvent('button_click', 'share_app');
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'IIM Trichy PGPM Portal',
          text: 'Check out this awesome app to track your live timetable and OLT attendance in one place!',
          url: window.location.origin,
        });
      } catch (err) {
        console.log('Share canceled or failed', err);
      }
    } else {
      navigator.clipboard.writeText(window.location.origin);
      alert('App link copied to clipboard!');
    }
  };

  const handleInstallClick = async () => {
    trackEvent('button_click', 'install_app');
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

  const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const getFallbackAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;

  const fetchUserTodos = async (token) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/todos`, { headers: { Authorization: `Bearer ${token}` } });
      setTodos(res.data);
    } catch (err) { console.error("Failed to fetch todos", err); }
  };

  const fetchUserProfile = async (token) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/user/me`, { headers: { Authorization: `Bearer ${token}` } });
      const savedSection = res.data?.user?.defaultSection;
      setHasOltCreds(res.data?.user?.hasOltCreds || false);
      if (savedSection && SECTIONS.includes(savedSection)) {
        setSection(savedSection);
        localStorage.setItem(SECTION_STORAGE_KEY, savedSection);
      }
    } catch (err) { console.error("Failed to fetch user profile", err); }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('iimt_user');
    const storedToken = localStorage.getItem('iimt_token');
    if (storedUser && storedToken) {
      setUser(JSON.parse(storedUser));
      fetchUserTodos(storedToken);
      fetchUserProfile(storedToken);
    } else {
      localStorage.removeItem('iimt_user');
      localStorage.removeItem('iimt_token');
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(SECTION_STORAGE_KEY, section);
    setSettingsSectionDraft(section);
    if (user) {
      const token = localStorage.getItem('iimt_token');
      axios.post(`${API_BASE_URL}/api/user/section`, { section }, { headers: { Authorization: `Bearer ${token}` } })
        .catch(err => console.error("Failed to save section", err));
    }
  }, [section, user]);

  useEffect(() => {
    if (isFirstSectionRender.current) {
      isFirstSectionRender.current = false;
      return;
    }
    setAttendanceData(null);
    setAttendanceFetchedSection(null);
    setAttendanceError('');
    setOtpRequired(false);
  }, [section]);

  const stopProgressPolling = () => {
    if (progressPollRef.current) {
      clearInterval(progressPollRef.current);
      progressPollRef.current = null;
    }
  };

  const startProgressPolling = () => {
    stopProgressPolling();
    const token = localStorage.getItem('iimt_token');
    progressPollRef.current = setInterval(async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/attendance/progress`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.data) setFetchProgress(res.data);
      } catch (err) { }
    }, 500);
  };

  useEffect(() => {
    return () => stopProgressPolling();
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    trackEvent('tab_click', `tab_${tab}`);
  };

  const handleUpdateTodos = async (date, sec, subject, newTodoList) => {
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

    try {
      trackEvent('action', 'update_todo');
      const token = localStorage.getItem('iimt_token');
      await axios.post(`${API_BASE_URL}/api/todos`,
        { date, section: sec, subject, tasks: newTodoList },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) { console.error("Failed to sync todo", err); }
  };

  useEffect(() => {
    if (user) fetchTimetable(section);
  }, [section, user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) fetchTimetable(section, false, true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [user, section]);

  useEffect(() => {
    if (!user || !syncMeta.nextRefreshTime) return;
    const interval = setInterval(() => {
      setNowTick(Date.now());
      if (Date.now() >= syncMeta.nextRefreshTime) {
        fetchTimetable(section, false, true);
      }
    }, 15000);
    return () => clearInterval(interval);
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

      setUser(res.data.user);
      setHasOltCreds(res.data.user.hasOltCreds);
      localStorage.setItem('iimt_user', JSON.stringify(res.data.user));
      localStorage.setItem('iimt_token', res.data.token);

      fetchUserTodos(res.data.token);
      fetchUserProfile(res.data.token);
    } catch (err) {
      if (err.response?.status === 429) setAuthError(err.response.data.error || 'Too many attempts. Try again later.');
      else setAuthError(err.response?.data?.error || 'Authentication failed. Please try again.');
    }
  };

  const handleLogout = () => {
    trackEvent('auth', 'logout');
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

  const fetchAttendance = async () => {
    trackEvent('button_click', 'fetch_attendance');
    setIsFetchingAttendance(true);
    setAttendanceError('');
    setOtpRequired(false);
    setFetchProgress({ step: 0, total: 8, message: 'Connecting to OLT portal…', status: 'in_progress' });
    const sectionAtFetchTime = section;
    startProgressPolling();
    try {
      const token = localStorage.getItem('iimt_token');
      const res = await axios.post(`${API_BASE_URL}/api/attendance/fetch`, {}, { headers: { Authorization: `Bearer ${token}` }});
      if (res.data.requiresOtp) {
          setOtpRequired(true);
      } else {
          setAttendanceData(res.data.results);
          setAttendanceFetchedSection(res.data.section || sectionAtFetchTime);
      }
    } catch (err) {
      setAttendanceError(err.response?.data?.error || 'Failed to fetch attendance from OLT.');
    } finally {
      setIsFetchingAttendance(false);
      stopProgressPolling();
    }
  };

  const verifyOtp = async (otp) => {
    trackEvent('button_click', 'submit_otp');
    setIsFetchingAttendance(true);
    setAttendanceError('');
    const sectionAtFetchTime = section;
    startProgressPolling();
    try {
      const token = localStorage.getItem('iimt_token');
      const res = await axios.post(`${API_BASE_URL}/api/attendance/verify-otp`, { otp }, { headers: { Authorization: `Bearer ${token}` }});
      setAttendanceData(res.data.results);
      setAttendanceFetchedSection(res.data.section || sectionAtFetchTime);
      setOtpRequired(false);
    } catch (err) {
      setAttendanceError(err.response?.data?.error || 'Invalid OTP');
    } finally {
      setIsFetchingAttendance(false);
      stopProgressPolling();
    }
  };

  const saveCredentials = async (username, password) => {
    try {
      const token = localStorage.getItem('iimt_token');
      await axios.post(`${API_BASE_URL}/api/user/olt-credentials`, { username, password }, { headers: { Authorization: `Bearer ${token}` }});
      setHasOltCreds(true);
      setShowCredsForm(false);
      fetchAttendance();
    } catch (err) { alert('Failed to securely save credentials.'); }
  };

  const handleSyncData = () => {
    trackEvent('button_click', 'manual_sync_timetable');
    setCache({});
    fetchTimetable(section, true, false);
  };

  const handleResetDate = () => {
    trackEvent('button_click', 'reset_date_today');
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

  const saveSectionSetting = () => {
    trackEvent('action', 'save_section_setting', { section: settingsSectionDraft });
    setSettingsStatus('Saved!');
    setSection(settingsSectionDraft);
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

  const formatClockTime = (ts) => {
    if (!ts) return '--:--';
    return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  };

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
    trackEvent('action', `swipe_day_${direction}`);
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

      .admin-dashboard-layout { flex-direction: column !important; overflow: auto !important; }
      .admin-sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid #e2e8f0; flex: none !important; max-height: 350px;}
      
      .feature-banner-actions { flex-direction: column; width: 100%; }
      .feature-banner-actions button { width: 100%; justify-content: center; }

      .mobile-refresh-fab { display: flex !important; }
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
    .modal-content textarea, .todo-input-form input { color: #333 !important; background-color: #fff !important; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
    .modal-content { background: white; padding: 2rem; border-radius: 16px; width: 90%; max-width: 400px; display: flex; flex-direction: column; gap: 1rem; color: #333; box-shadow: 0 10px 40px rgba(0,0,0,0.2); animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes popIn { 0% { opacity: 0; transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
    .modal-content textarea { width: 100%; height: 100px; padding: 10px; border-radius: 8px; border: 1px solid #ccc; font-family: inherit; resize: none; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .btn-submit { background: var(--accent-gold); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .btn-submit:disabled { background: #d0b875; cursor: not-allowed; }
    .btn-cancel { background: #eee; color: #333; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .btn-cancel:disabled { background: #f5f5f5; color: #999; cursor: not-allowed; }
    .btn-text { background: none; border: none; color: #888; font-weight: 500; cursor: pointer; padding: 8px; width: 100%; text-decoration: underline; }

    /* --- OLT POPUP GLOW --- */
    .olt-glow-modal { background: linear-gradient(to bottom, #fff, #fefdf9); border: 1px solid var(--accent-gold); box-shadow: 0 0 20px rgba(219, 163, 21, 0.2); text-align: center; }
    .olt-glow-modal h3 { color: var(--accent-gold); font-size: 1.4rem; margin: 0;}

    /* --- SETTINGS MODAL --- */
    .settings-section-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .settings-section-btn { padding: 10px 0; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; color: #333; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    .settings-section-btn.active { background: var(--accent-gold); border-color: var(--accent-gold); color: #fff; }
    .settings-status-text { font-size: 0.85rem; color: var(--accent-gold); font-weight: 600; }

    /* --- FEATURE BANNER --- */
    .feature-banner { background: linear-gradient(135deg, rgba(219, 163, 21, 0.12), rgba(219, 163, 21, 0.04)); border: 1px solid rgba(219, 163, 21, 0.25); border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 10px; color: var(--text-primary, #fff); box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .feature-banner-header { display: flex; justify-content: space-between; align-items: flex-start; }
    .feature-banner-title { font-size: 1.1rem; font-weight: 700; color: var(--accent-gold); display: flex; align-items: center; gap: 8px; margin: 0; }
    .feature-banner-text { font-size: 0.9rem; color: #d0d0d0; margin: 0; line-height: 1.5; }
    .feature-banner-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; }
    .btn-banner-primary { background: var(--accent-gold); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; transition: background 0.2s;}
    .btn-banner-primary:hover { background: #c59212; }
    .btn-banner-secondary { background: rgba(255,255,255,0.05); color: #ddd; border: 1px solid rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 8px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; transition: all 0.2s;}
    .btn-banner-secondary:hover { background: rgba(255,255,255,0.1); color: #fff;}
    .btn-banner-close { background: none; border: none; color: #888; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;}
    .btn-banner-close:hover { background: rgba(255,255,255,0.1); color: #fff;}

    /* --- LIVE DATA BANNER --- */
    .live-data-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; background: rgba(76, 175, 80, 0.08); border: 1px solid rgba(76, 175, 80, 0.25); color: #2f6b32; border-radius: 10px; padding: 8px 14px; font-size: 0.82rem; margin-bottom: 1rem; }
    .live-data-dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; box-shadow: 0 0 0 rgba(76, 175, 80, 0.5); animation: liveDotPulse 1.8s infinite; flex-shrink: 0; }
    @keyframes liveDotPulse { 0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5); } 70% { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); } 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); } }
    .live-data-banner strong { font-weight: 700; }
    .live-data-meta { color: #4a7a4c; opacity: 0.85; }

    /* --- SESSION NUMBER BADGE --- */
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

    /* --- MOBILE REFRESH FAB --- */
    .mobile-refresh-fab { display: none; position: fixed; bottom: 85px; right: 20px; z-index: 900; background: white; color: var(--accent-gold); width: 50px; height: 50px; border-radius: 50%; border: 1px solid rgba(219,163,21,0.3); align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.15); cursor: pointer; }
    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    /* --- ADMIN PORTAL DASHBOARD LAYOUT & CHARTS (REVAMPED) --- */
    .admin-container-fluid { font-family: 'Inter', system-ui, sans-serif; color: #0f172a; height: 100vh; background: #f8fafc; }
    .admin-login { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #f8fafc; }
    .admin-login-box { background: white; padding: 3rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; width: 90%; max-width: 400px; }
    .admin-login input { padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #cbd5e1; width: 100%; color: #0f172a; background: #fff; box-sizing: border-box; }
    .admin-login button { background: var(--accent-gold); color: white; padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; width: 100%; transition: opacity 0.2s; }
    .admin-login button:hover { opacity: 0.9; }
    
    .admin-dashboard-layout { display: flex; height: 100vh; overflow: hidden; background: #f8fafc; }
    .admin-sidebar { width: 280px; background: #ffffff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; box-shadow: 2px 0 10px rgba(0,0,0,0.02); z-index: 10; }
    
    .admin-tabs { display: flex; flex-direction: column; gap: 8px; margin-top: 1.5rem; }
    .admin-tab { background: transparent; border: none; padding: 14px 20px; font-size: 0.95rem; font-weight: 600; color: #64748b; cursor: pointer; border-radius: 10px; transition: all 0.2s ease; text-align: left; display: flex; align-items: center; }
    .admin-tab.active { background: rgba(219,163,21,0.1); color: var(--accent-gold); }
    .admin-tab:hover:not(.active) { background: #f1f5f9; color: #0f172a; }

    .admin-main-content { flex: 1; overflow-y: auto; padding: 2.5rem; }
    .admin-header-title { font-size: 1.75rem; font-weight: 700; color: #0f172a; margin: 0 0 1.5rem 0; }
    
    /* Stats grid */
    .admin-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .admin-stat-card { background: #ffffff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .admin-stat-card .label { font-size: 0.85rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .admin-stat-card .value { font-size: 2.2rem; font-weight: 800; color: #0f172a; }
    .admin-stat-card .value.gold { color: var(--accent-gold); }

    /* CSS Charts */
    .admin-charts-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 24px; margin-bottom: 30px; }
    @media (max-width: 768px) { .admin-charts-container { grid-template-columns: 1fr; } }
    .admin-chart-box { background: #ffffff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .admin-chart-box h3 { margin: 0 0 20px 0; font-size: 1.1rem; color: #0f172a; display: flex; align-items: center; gap: 10px; font-weight: 700; }
    
    .css-bar-chart { display: flex; align-items: flex-end; justify-content: space-around; height: 220px; padding-top: 30px; border-bottom: 2px solid #f1f5f9; }
    .css-bar-group { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 10px; width: 12%; height: 100%; }
    .css-bar { width: 100%; background: var(--accent-gold); border-radius: 6px 6px 0 0; position: relative; min-height: 4px; transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
    .css-bar.green { background: #10b981; }
    .css-bar:hover::after { content: attr(data-val); position: absolute; top: -32px; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; z-index: 10; }
    .css-bar-label { font-size: 0.75rem; color: #64748b; font-weight: 500; text-align: center; }

    /* Lists */
    .interaction-list { display: flex; flex-direction: column; gap: 12px; }
    .interaction-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; transition: background 0.2s; }
    .interaction-row:hover { background: #f1f5f9; }
    .interaction-row-name { font-weight: 600; font-size: 0.95rem; color: #334155; display: flex; align-items: center; gap: 8px;}
    .interaction-row-count { background: #ffffff; color: var(--accent-gold); padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);}

    /* User Database Cards */
    .active-user-card { display: flex; align-items: center; gap: 15px; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; background: #ffffff; margin-bottom: 12px; transition: all 0.2s ease;}
    .active-user-card:hover { border-color: #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); transform: translateY(-1px); }
    .active-user-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #f1f5f9; }
    .active-user-info { flex: 1; overflow: hidden; }
    .active-user-name { font-weight: 700; font-size: 1rem; color: #0f172a; margin-bottom: 4px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
    .active-user-email { font-size: 0.85rem; color: #64748b; display: flex; align-items: center; gap: 6px; }
    .active-user-time { text-align: right; }
    .active-user-time-val { font-size: 0.9rem; font-weight: 600; color: #334155; }
    .active-user-time-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
    .online-indicator { display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 6px; box-shadow: 0 0 0 2px #d1fae5; }
    
    /* Feedback Cards */
    .feedback-card { background: #fefce8; padding: 20px; margin-bottom: 16px; border-radius: 12px; border: 1px solid #fef08a; border-left: 5px solid var(--accent-gold); color: #0f172a; box-shadow: 0 2px 4px rgba(0,0,0,0.02);}
    .feedback-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .feedback-name { font-weight: 700; font-size: 1rem; color: #0f172a; }
    .feedback-time { font-size: 0.8rem; color: #854d0e; font-weight: 500; }
    .feedback-msg { margin: 0; font-size: 0.95rem; color: #334155; white-space: pre-wrap; line-height: 1.5; }

    /* --- ATTENDANCE UI --- */
    .attendance-container { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.2rem; }
    .creds-card { background: white; color: #333; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; }
    .creds-card h3 { color: #111; margin-top: 0; margin-bottom: 0.5rem; }
    .input-group { display: flex; flex-direction: column; gap: 8px; text-align: left; margin-bottom: 1rem; color: #333; }
    .input-group input { padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; color: #333; background: #fff; }
    .input-group input:focus { outline: none; border-color: var(--accent-gold); }
    .attendance-summary-card { background: linear-gradient(135deg, #1e1e1e, #2d2d2d); color: white; padding: 1.5rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
    .summary-stat { text-align: center; }
    .summary-stat .value { font-size: 1.8rem; font-weight: bold; color: var(--accent-gold); }
    .summary-stat .label { font-size: 0.8rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; color: #eee; }
    .subject-card { background: white; color: #333; border-radius: 10px; border: 1px solid #eee; overflow: hidden; transition: all 0.2s; }
    .subject-header { padding: 1rem 1.2rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #fafafa; border-bottom: 1px solid transparent; }
    .subject-header:hover { background: #f0f0f0; }
    .subject-title { font-weight: 700; font-size: 0.95rem; flex: 1; color: #111; }
    .subject-stats { display: flex; align-items: center; gap: 15px; font-size: 0.9rem; color: #444; }
    .progress-bar { width: 60px; height: 6px; background: #ddd; border-radius: 3px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; }
    .class-list { padding: 0 1.2rem; max-height: 0; overflow: hidden; transition: max-height 0.3s ease; background: #fff; }
    .class-list.expanded { max-height: 500px; padding: 1rem 1.2rem; overflow-y: auto; border-top: 1px solid #eee; }
    .class-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 0.85rem; color: #444; }
    .class-row:last-child { border-bottom: none; }
    .status-badge { padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
    .status-p { background: rgba(76, 175, 80, 0.1); color: #2e7d32; }
    .status-a { background: rgba(244, 67, 54, 0.1); color: #d32f2f; }
    .mismatch-card { max-width: 460px; margin: 3rem auto; }

    /* --- LIVE ATTENDANCE FETCH PROGRESS (calm, low-stress) --- */
    .attendance-fetch-progress { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 55vh; gap: 1.5rem; width: 100%; max-width: 360px; margin: 0 auto; }
    .fetch-progress-ring { --pct: 0; position: relative; width: 108px; height: 108px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: conic-gradient(var(--accent-gold, #dba315) calc(var(--pct) * 1%), rgba(219, 163, 21, 0.12) 0); transition: background 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
    .fetch-progress-ring::before { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: var(--bg-primary, #fff); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04); }
    .fetch-progress-ring-label { position: relative; z-index: 1; font-size: 1.3rem; font-weight: 700; color: var(--accent-gold, #dba315); letter-spacing: 0.3px; }
    .fetch-progress-message { color: var(--text-primary, #333); font-size: 0.98rem; font-weight: 500; text-align: center; min-height: 1.4em; transition: opacity 0.3s ease; letter-spacing: 0.1px; }
    .fetch-progress-bar-track { width: 100%; height: 6px; border-radius: 4px; background: rgba(219, 163, 21, 0.12); overflow: hidden; }
    .fetch-progress-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--accent-gold, #dba315), #eccb6b); transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
    .fetch-progress-steps { display: flex; gap: 6px; }
    .fetch-progress-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(219, 163, 21, 0.2); transition: background 0.4s ease, transform 0.4s ease; }
    .fetch-progress-dot.done { background: var(--accent-gold, #dba315); }
    .fetch-progress-dot.current { background: var(--accent-gold, #dba315); animation: fetchDotPulse 1.1s ease-in-out infinite; }
    @keyframes fetchDotPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.6; } }
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

  const renderAttendanceTab = () => {
    if (!hasOltCreds || showCredsForm) {
      return <CredentialForm onSubmit={saveCredentials} onCancel={() => {setShowCredsForm(false); trackEvent('action', 'cancel_creds_form');}} hasCreds={hasOltCreds} />;
    }

    if (otpRequired) {
      return <OTPForm onSubmit={verifyOtp} isLoading={isFetchingAttendance} />;
    }

    if (!attendanceData && !isFetchingAttendance) {
      return (
        <div className="empty-state">
          <ClipboardCheck size={48} color="var(--accent-gold)" style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <h3>View Your Attendance</h3>
          <p>Sync your live attendance directly from the OLT portal.</p>
          <button className="btn-submit" onClick={fetchAttendance} style={{ marginTop: '1rem' }}>Fetch Now</button>
          <button className="btn-cancel" onClick={() => {setShowCredsForm(true); trackEvent('button_click', 'update_creds');}} style={{ marginTop: '1rem', marginLeft: '10px' }}>Update Credentials</button>
        </div>
      );
    }

    if (isFetchingAttendance) {
      const total = fetchProgress.total || 8;
      const step = Math.min(fetchProgress.step || 0, total);
      const pct = Math.round((step / total) * 100);
      return (
        <div className="attendance-fetch-progress">
          <div className="fetch-progress-ring" style={{ '--pct': pct }}>
            <span className="fetch-progress-ring-label">{pct}%</span>
          </div>
          <div className="fetch-progress-message">{fetchProgress.message || 'Connecting to OLT Portal…'}</div>
          <div className="fetch-progress-bar-track">
            <div className="fetch-progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="fetch-progress-steps">
            {Array.from({ length: total }).map((_, i) => (
              <span key={i} className={`fetch-progress-dot ${i < step ? 'done' : ''} ${i === step ? 'current' : ''}`} />
            ))}
          </div>
        </div>
      );
    }

    let overallAttended = 0;
    let overallTotal = 0;
    Object.values(attendanceData || {}).forEach(sub => {
      overallAttended += sub.attended;
      overallTotal += sub.total;
    });
    const overallPercentage = overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : 0;

    const subjectCount = Object.keys(attendanceData || {}).length;
    const noRecordsMatched = subjectCount === 0 || overallTotal === 0;
    const sectionMismatch = attendanceFetchedSection && attendanceFetchedSection !== section;

    if (noRecordsMatched) {
      return (
        <div className="attendance-container">
          <div className="creds-card mismatch-card">
            <AlertCircle size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
            <h3>No Attendance Records Found</h3>
            {sectionMismatch ? (
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                We fetched attendance for <strong>Section {attendanceFetchedSection}</strong>, but you're currently browsing <strong>Section {section}</strong>. Attendance is always fetched for your actual class section — if that's still {attendanceFetchedSection}, switch the timetable section back below. Otherwise, your OLT credentials may need updating.
              </p>
            ) : (
              <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                We couldn't match your roll number in Section {attendanceFetchedSection || section}'s attendance records. This can happen if you recently browsed a different timetable section, or if your saved OLT credentials have changed.
              </p>
            )}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
              {sectionMismatch && (
                <button className="btn-submit" onClick={() => { setSettingsSectionDraft(attendanceFetchedSection); setShowSettingsModal(true); trackEvent('action', 'fix_section_mismatch'); }}>
                  Switch back to Section {attendanceFetchedSection}
                </button>
              )}
              <button className="btn-cancel" onClick={fetchAttendance}>Try Again</button>
              <button className="btn-cancel" onClick={() => setShowCredsForm(true)}>Update Credentials</button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="attendance-container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
           <h2 className="view-title" style={{ margin: 0 }}>Attendance Overview</h2>
           <div>
             <button onClick={fetchAttendance} className="nav-btn" style={{ margin: 0, padding: '8px 12px', border: '1px solid #ddd' }}><RefreshCw size={14}/> Sync</button>
           </div>
        </div>

        {attendanceError && (
          <div style={{ background: '#fff1f0', color: '#d32f2f', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={18} /> {attendanceError}
            <button onClick={() => setShowCredsForm(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#d32f2f', textDecoration: 'underline', cursor: 'pointer' }}>Update Credentials</button>
          </div>
        )}

        <div className="attendance-summary-card">
          <div className="summary-stat">
            <div className="value">{overallAttended} / {overallTotal}</div>
            <div className="label">Total Classes</div>
          </div>
          <div className="summary-stat">
            <div className="value" style={{ color: overallPercentage < 80 ? '#ff4d4f' : '#4caf50' }}>{overallPercentage}%</div>
            <div className="label">Overall Avg</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(attendanceData || {}).map(([subject, data], idx) => {
            const isExp = expandedSubject === subject;
            const pct = parseFloat(data.percentage);
            const color = pct >= 80 ? '#4caf50' : (pct >= 75 ? '#faad14' : '#ff4d4f');
            
            return (
              <div key={idx} className="subject-card">
                <div className="subject-header" onClick={() => {setExpandedSubject(isExp ? null : subject); trackEvent('action', isExp ? 'collapse_attendance' : 'expand_attendance');}}>
                  <div className="subject-title">{subject}</div>
                  <div className="subject-stats">
                    <span style={{ fontWeight: 'bold', color: '#444' }}>{data.attended}/{data.total}</span>
                    <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }}></div></div>
                    <span style={{ color, fontWeight: 'bold', width: '45px', textAlign: 'right' }}>{data.percentage}%</span>
                    {isExp ? <ChevronUp size={16} color="#888"/> : <ChevronDown size={16} color="#888"/>}
                  </div>
                </div>
                
                <div className={`class-list ${isExp ? 'expanded' : ''}`}>
                  {data.classes.map((cls, cIdx) => (
                    <div key={cIdx} className="class-row">
                      <span style={{ width: '40px' }}>{cls.class}</span>
                      <span style={{ flex: 1 }}>{cls.date}</span>
                      <span style={{ flex: 1 }}>{cls.time}</span>
                      <span className={`status-badge status-${cls.status.toLowerCase()}`}>{cls.status}</span>
                    </div>
                  ))}
                  {data.classes.length === 0 && <div style={{ textAlign: 'center', color: '#888', padding: '10px' }}>No records found.</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{injectedStyles}</style>

      {/* --- LIVE ATTENDANCE POPUP FOR NEW USERS --- */}
      {showOltPopup && (
        <div className="modal-overlay">
          <div className="modal-content olt-glow-modal">
            <ClipboardCheck size={48} color="var(--accent-gold)" style={{ margin: '0 auto' }} />
            <h3>Unlock Live Attendance</h3>
            <p style={{ fontSize: '0.95rem', color: '#666', margin: '0 0 10px 0', lineHeight: '1.4' }}>
              You can now track your live class attendance and view detailed class-by-class status directly inside the app!
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button className="btn-submit" onClick={() => { setShowOltPopup(false); handleTabChange('attendance'); }}>Setup OLT Account Now</button>
              <button className="btn-text" onClick={() => { setShowOltPopup(false); sessionStorage.setItem('olt_popup_dismissed', '1'); trackEvent('action', 'dismiss_olt_popup'); }}>Remind me later</button>
            </div>
          </div>
        </div>
      )}

      {/* --- MOBILE FLOATING REFRESH BUTTON --- */}
      {activeTab === 'timetable' && (
        <button 
          className="mobile-refresh-fab" 
          onClick={() => { 
            setIsReloading(true); 
            trackEvent('button_click', 'mobile_fab_reload'); 
            setTimeout(() => window.location.reload(), 150); 
          }}
        >
          <RefreshCw size={22} className={isReloading ? 'spinning' : ''} />
        </button>
      )}

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

      {showSettingsModal && (
        <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: 0 }}>Settings</h3>
            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>Choose your section. This is saved to your account and remembered next time you log in.</p>
            <div className="settings-section-grid">
              {SECTIONS.map(sec => (
                <button key={sec} className={`settings-section-btn ${settingsSectionDraft === sec ? 'active' : ''}`} onClick={() => setSettingsSectionDraft(sec)}>{sec}</button>
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
            <button className={`nav-btn ${activeTab === 'timetable' ? 'active' : ''}`} onClick={() => handleTabChange('timetable')}><Calendar size={18} /> Timetable</button>
            <button className={`nav-btn ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => handleTabChange('summary')}><Table2 size={18} /> Summary Table</button>
            <button className={`nav-btn ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => handleTabChange('attendance')}><ClipboardCheck size={18} /> Attendance {(!hasOltCreds && !sessionStorage.getItem('olt_popup_dismissed')) && <span style={{width: 8, height: 8, background: 'red', borderRadius: '50%', marginLeft: '5px'}}></span>}</button>
          </div>

          {activeTab !== 'attendance' && (
            <div className="section-selector-container">
              <span className="section-label">Select Section</span>
              <div className="sec-grid">
                {SECTIONS.map((sec) => (
                  <button key={sec} className={`section-btn ${section === sec ? 'active' : ''}`} onClick={() => { setSection(sec); trackEvent('action', 'change_section', { to: sec }); }}>{sec}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isInstallable && (
                <button onClick={handleInstallClick} className="nav-btn" style={{ width: '100%', color: 'var(--accent-gold)', fontWeight: 'bold' }}>
                  <Download size={18} /> Install App
                </button>
              )}
              <button onClick={() => { setSettingsSectionDraft(section); setShowSettingsModal(true); trackEvent('button_click', 'open_settings'); }} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><Settings size={18} /> Settings</button>
              <button onClick={() => { setShowFeedbackModal(true); trackEvent('button_click', 'open_feedback'); }} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><MessageSquare size={18} /> Provide Feedback</button>
              {activeTab === 'timetable' && <button onClick={handleSyncData} className="nav-btn desktop-only" style={{ width: '100%', color: 'var(--text-secondary)' }} disabled={loading}><RefreshCw size={18} /> {loading ? 'Syncing...' : 'Sync Data'}</button>}
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
              {/* --- 5-DAY FEATURE BANNER --- */}
              {showFeatureBanner && activeTab !== 'attendance' && (
                <div className="feature-banner fade-in">
                  <div className="feature-banner-header">
                    <h3 className="feature-banner-title">
                      <Sparkles size={18} fill="currentColor" /> 
                      New: Live OLT Attendance
                    </h3>
                    <button className="btn-banner-close" onClick={dismissFeatureBanner} aria-label="Close">
                      <X size={18} />
                    </button>
                  </div>
                  <p className="feature-banner-text">
                    You can now track your live class attendance and view detailed class-by-class status directly from the OLT portal!
                  </p>
                  <div className="feature-banner-actions">
                    <button className="btn-banner-primary" onClick={() => handleTabChange('attendance')}>
                      <ClipboardCheck size={16} /> Check it out
                    </button>
                    <button className="btn-banner-secondary" onClick={handleShareApp}>
                      <Share size={16} /> Share App
                    </button>
                    <button className="btn-banner-secondary" onClick={() => {setShowFeedbackModal(true); trackEvent('button_click', 'banner_feedback');}}>
                      <MessageSquare size={16} /> Give Feedback
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'attendance' && renderAttendanceTab()}

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
                      <input type="date" className="date-input" value={selectedDate} min={minDate} max={maxDate} onChange={(e) => { setDaySwipeAnim('fade-in'); setSelectedDate(e.target.value); trackEvent('action', 'pick_date'); }} disabled={!minDate} />
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

                                <button className="add-task-btn" onClick={() => { setActiveTodoClass({ subject: cls.subject, date: selectedDate, section }); trackEvent('button_click', 'open_todo_modal'); }}>
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

function CredentialForm({ onSubmit, onCancel, hasCreds }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="creds-card">
      <Lock size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
      <h3>{hasCreds ? 'Update' : 'Link'} OLT Account</h3>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Your credentials are encrypted and stored securely to sync your attendance.</p>
      
      <div className="input-group">
        <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Roll Number</label>
        <input type="text" placeholder="e.g. 2601030" value={user} onChange={e => setUser(e.target.value)} />
      </div>
      <div className="input-group" style={{ position: 'relative' }}>
        <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Password</label>
        <input type={showPass ? 'text' : 'password'} placeholder="Date of birth (DDMMYYYY)" value={pass} onChange={e => setPass(e.target.value)} />
        <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: '10px', top: '34px', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
          {showPass ? <EyeOff size={18}/> : <Eye size={18}/>}
        </button>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginTop: '1.5rem' }}>
        {hasCreds && <button className="btn-cancel" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>}
        <button className="btn-submit" style={{ flex: 1 }} disabled={!user || !pass} onClick={() => onSubmit(user, pass)}>Securely Save</button>
      </div>
    </div>
  );
}

function OTPForm({ onSubmit, isLoading }) {
  const [otp, setOtp] = useState('');
  return (
    <div className="creds-card">
      <AlertCircle size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
      <h3>Two-Factor Authentication</h3>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Open your Google Authenticator app and enter the 6-digit code for OLT.</p>
      
      <div className="input-group">
        <input type="text" placeholder="000000" maxLength={6} style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '5px' }} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} disabled={isLoading} />
      </div>
      
      <button className="btn-submit" style={{ width: '100%', marginTop: '1rem' }} disabled={otp.length !== 6 || isLoading} onClick={() => onSubmit(otp)}>
        {isLoading ? 'Verifying...' : 'Verify & Continue'}
      </button>
    </div>
  );
}

export default App;

// import React, { useState, useEffect, useRef } from 'react';
// import axios from 'axios';
// import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
// import { 
//   Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, 
//   RefreshCw, ChevronLeft, ChevronRight, Hand, MessageSquare, Lock, ListTodo, 
//   Settings, Download, Share, ClipboardCheck, ChevronDown, ChevronUp, AlertCircle, 
//   Eye, EyeOff, X, Sparkles, Activity, Users, MousePointer2, LayoutDashboard 
// } from 'lucide-react';
// import { TodoModal, TodoSummaryBar } from './TodoWidgets';
// import { Analytics } from '@vercel/analytics/react';

// import './App.css';

// const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
// const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

// const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

// const SWIPE_THRESHOLD = 40;
// const SWIPE_HINT_MAX_SHOWS = 3;
// const SWIPE_HINT_STORAGE_KEY = 'iimt_swipe_hint_shown_count';
// const SWIPE_HINT_AUTO_DISMISS_MS = 3200;
// const SECTION_STORAGE_KEY = 'iimt_section';

// const BANNER_STORAGE_KEY = 'iimt_attendance_banner_dismissed';
// const BANNER_START_KEY = 'iimt_attendance_banner_start';

// axios.interceptors.response.use(
//   (response) => response,
//   (error) => {
//     if (error.response?.status === 401 && window.location.pathname !== '/admin') {
//       googleLogout();
//       localStorage.removeItem('iimt_user');
//       localStorage.removeItem('iimt_token');
//       window.location.reload();
//     }
//     return Promise.reject(error);
//   }
// );

// // Analytics tracker helper
// export const trackEvent = (eventType, eventName, metadata = {}) => {
//   const token = localStorage.getItem('iimt_token');
//   if (!token) return;
//   axios.post(`${API_BASE_URL}/api/analytics`, { eventType, eventName, metadata }, {
//     headers: { Authorization: `Bearer ${token}` }
//   }).catch(() => {});
// };

// function App() {
//   const [user, setUser] = useState(null);
//   const [authError, setAuthError] = useState('');
//   const [activeTab, setActiveTab] = useState('timetable');

//   const [section, setSection] = useState(() => {
//     const stored = localStorage.getItem(SECTION_STORAGE_KEY);
//     return stored && SECTIONS.includes(stored) ? stored : 'A';
//   });

//   const [cache, setCache] = useState({});
//   const [scheduleData, setScheduleData] = useState([]);
//   const [summaryData, setSummaryData] = useState({ headers: [], rows: [] });

//   const [selectedDate, setSelectedDate] = useState('');
//   const [minDate, setMinDate] = useState('');
//   const [maxDate, setMaxDate] = useState('');

//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');

//   const [daySwipeAnim, setDaySwipeAnim] = useState('fade-in');
//   const [dragX, setDragX] = useState(0);
//   const [isDragging, setIsDragging] = useState(false);
//   const touchStartX = useRef(0);
//   const touchStartY = useRef(0);

//   const [showSwipeHint, setShowSwipeHint] = useState(false);
//   const hintHandledThisSession = useRef(false);
//   const hintDismissTimer = useRef(null);

//   const [showFeedbackModal, setShowFeedbackModal] = useState(false);
//   const [feedbackText, setFeedbackText] = useState('');
//   const [feedbackStatus, setFeedbackStatus] = useState('');
//   const [isSubmitting, setIsSubmitting] = useState(false);

//   const [showSettingsModal, setShowSettingsModal] = useState(false);
//   const [settingsSectionDraft, setSettingsSectionDraft] = useState(section);
//   const [settingsStatus, setSettingsStatus] = useState('');

//   const [syncMeta, setSyncMeta] = useState({ lastFetchTime: null, nextRefreshTime: null, cacheTTLMs: null });
//   const [nowTick, setNowTick] = useState(Date.now());

//   const [todos, setTodos] = useState({});
//   const [activeTodoClass, setActiveTodoClass] = useState(null);

//   const [isReloading, setIsReloading] = useState(false);

//   // --- ATTENDANCE STATE ---
//   const [hasOltCreds, setHasOltCreds] = useState(false);
//   const [showOltPopup, setShowOltPopup] = useState(false);
//   const [attendanceData, setAttendanceData] = useState(null);
//   const [isFetchingAttendance, setIsFetchingAttendance] = useState(false);
//   const [attendanceError, setAttendanceError] = useState('');
//   const [showCredsForm, setShowCredsForm] = useState(false);
//   const [otpRequired, setOtpRequired] = useState(false);
//   const [expandedSubject, setExpandedSubject] = useState(null);
//   const [attendanceFetchedSection, setAttendanceFetchedSection] = useState(null);
//   const [fetchProgress, setFetchProgress] = useState({ step: 0, total: 8, message: '', status: 'idle' });
//   const progressPollRef = useRef(null);
//   const isFirstSectionRender = useRef(true);

//   const [showFeatureBanner, setShowFeatureBanner] = useState(false);

//   const [deferredPrompt, setDeferredPrompt] = useState(null);
//   const [isInstallable, setIsInstallable] = useState(false);
//   const [isIOS, setIsIOS] = useState(false);
//   const [showIOSPrompt, setShowIOSPrompt] = useState(false);

//   useEffect(() => {
//     const userAgent = window.navigator.userAgent.toLowerCase();
//     const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
//     const isStandalone = ('standalone' in window.navigator) && (window.navigator.standalone);

//     if (isIOSDevice && !isStandalone) {
//       setIsIOS(true);
//       setIsInstallable(true);
//     }

//     const handleBeforeInstallPrompt = (e) => {
//       e.preventDefault();
//       setDeferredPrompt(e);
//       setIsInstallable(true);
//     };

//     window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
//     window.addEventListener('appinstalled', () => {
//       setIsInstallable(false);
//       setDeferredPrompt(null);
//     });

//     return () => {
//       window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
//     };
//   }, []);

//   // Persistent 5-Day OLT setup popup
//   useEffect(() => {
//     if (user && hasOltCreds === false) {
//       const dismissed = sessionStorage.getItem('olt_popup_dismissed');
//       if (!dismissed) {
//         const timer = setTimeout(() => {
//           setShowOltPopup(true);
//           trackEvent('view', 'olt_setup_popup');
//         }, 2500); // 2.5 second delay before popping up
//         return () => clearTimeout(timer);
//       }
//     }
//   }, [user, hasOltCreds]);

//   // Feature Banner 5-Day Logic
//   useEffect(() => {
//     if (!user) return;
//     const dismissed = localStorage.getItem(BANNER_STORAGE_KEY);
//     if (dismissed === 'true') return;

//     let startTime = localStorage.getItem(BANNER_START_KEY);
//     if (!startTime) {
//       startTime = Date.now().toString();
//       localStorage.setItem(BANNER_START_KEY, startTime);
//     }

//     const elapsedDays = (Date.now() - parseInt(startTime, 10)) / (1000 * 60 * 60 * 24);
//     if (elapsedDays < 5) {
//       setShowFeatureBanner(true);
//     } else {
//       setShowFeatureBanner(false);
//     }
//   }, [user]);

//   const dismissFeatureBanner = () => {
//     localStorage.setItem(BANNER_STORAGE_KEY, 'true');
//     setShowFeatureBanner(false);
//     trackEvent('action', 'dismiss_feature_banner');
//   };

//   const handleShareApp = async () => {
//     trackEvent('button_click', 'share_app');
//     if (navigator.share) {
//       try {
//         await navigator.share({
//           title: 'IIM Trichy PGPM Portal',
//           text: 'Check out this awesome app to track your live timetable and OLT attendance in one place!',
//           url: window.location.origin,
//         });
//       } catch (err) {
//         console.log('Share canceled or failed', err);
//       }
//     } else {
//       navigator.clipboard.writeText(window.location.origin);
//       alert('App link copied to clipboard!');
//     }
//   };

//   const handleInstallClick = async () => {
//     trackEvent('button_click', 'install_app');
//     if (isIOS) {
//       setShowIOSPrompt(true);
//       return;
//     }
//     if (!deferredPrompt) return;

//     deferredPrompt.prompt();
//     const { outcome } = await deferredPrompt.userChoice;
//     if (outcome === 'accepted') {
//       setIsInstallable(false);
//       setDeferredPrompt(null);
//     }
//   };

//   const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
//   const getFallbackAvatar = (name) => `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;

//   const fetchUserTodos = async (token) => {
//     try {
//       const res = await axios.get(`${API_BASE_URL}/api/todos`, { headers: { Authorization: `Bearer ${token}` } });
//       setTodos(res.data);
//     } catch (err) { console.error("Failed to fetch todos", err); }
//   };

//   const fetchUserProfile = async (token) => {
//     try {
//       const res = await axios.get(`${API_BASE_URL}/api/user/me`, { headers: { Authorization: `Bearer ${token}` } });
//       const savedSection = res.data?.user?.defaultSection;
//       setHasOltCreds(res.data?.user?.hasOltCreds || false);
//       if (savedSection && SECTIONS.includes(savedSection)) {
//         setSection(savedSection);
//         localStorage.setItem(SECTION_STORAGE_KEY, savedSection);
//       }
//     } catch (err) { console.error("Failed to fetch user profile", err); }
//   };

//   useEffect(() => {
//     const storedUser = localStorage.getItem('iimt_user');
//     const storedToken = localStorage.getItem('iimt_token');
//     if (storedUser && storedToken) {
//       setUser(JSON.parse(storedUser));
//       fetchUserTodos(storedToken);
//       fetchUserProfile(storedToken);
//     } else {
//       localStorage.removeItem('iimt_user');
//       localStorage.removeItem('iimt_token');
//     }
//   }, []);

//   useEffect(() => {
//     localStorage.setItem(SECTION_STORAGE_KEY, section);
//     setSettingsSectionDraft(section);
//     if (user) {
//       const token = localStorage.getItem('iimt_token');
//       axios.post(`${API_BASE_URL}/api/user/section`, { section }, { headers: { Authorization: `Bearer ${token}` } })
//         .catch(err => console.error("Failed to save section", err));
//     }
//   }, [section, user]);

//   useEffect(() => {
//     if (isFirstSectionRender.current) {
//       isFirstSectionRender.current = false;
//       return;
//     }
//     setAttendanceData(null);
//     setAttendanceFetchedSection(null);
//     setAttendanceError('');
//     setOtpRequired(false);
//   }, [section]);

//   const stopProgressPolling = () => {
//     if (progressPollRef.current) {
//       clearInterval(progressPollRef.current);
//       progressPollRef.current = null;
//     }
//   };

//   const startProgressPolling = () => {
//     stopProgressPolling();
//     const token = localStorage.getItem('iimt_token');
//     progressPollRef.current = setInterval(async () => {
//       try {
//         const res = await axios.get(`${API_BASE_URL}/api/attendance/progress`, { headers: { Authorization: `Bearer ${token}` } });
//         if (res.data) setFetchProgress(res.data);
//       } catch (err) { }
//     }, 500);
//   };

//   useEffect(() => {
//     return () => stopProgressPolling();
//   }, []);

//   const handleTabChange = (tab) => {
//     setActiveTab(tab);
//     trackEvent('tab_click', `tab_${tab}`);
//   };

//   const handleUpdateTodos = async (date, sec, subject, newTodoList) => {
//     setTodos(prev => {
//       const updated = { ...prev };
//       if (!updated[date]) updated[date] = {};
//       if (!updated[date][sec]) updated[date][sec] = {};
//       updated[date][sec][subject] = newTodoList;

//       if (newTodoList.length === 0) delete updated[date][sec][subject];
//       if (Object.keys(updated[date][sec] || {}).length === 0) delete updated[date][sec];
//       if (Object.keys(updated[date] || {}).length === 0) delete updated[date];

//       return updated;
//     });

//     try {
//       trackEvent('action', 'update_todo');
//       const token = localStorage.getItem('iimt_token');
//       await axios.post(`${API_BASE_URL}/api/todos`,
//         { date, section: sec, subject, tasks: newTodoList },
//         { headers: { Authorization: `Bearer ${token}` } }
//       );
//     } catch (err) { console.error("Failed to sync todo", err); }
//   };

//   useEffect(() => {
//     if (user) fetchTimetable(section);
//   }, [section, user]);

//   useEffect(() => {
//     const handleVisibilityChange = () => {
//       if (document.visibilityState === 'visible' && user) fetchTimetable(section, false, true);
//     };
//     document.addEventListener('visibilitychange', handleVisibilityChange);
//     return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
//   }, [user, section]);

//   useEffect(() => {
//     if (!user || !syncMeta.nextRefreshTime) return;
//     const interval = setInterval(() => {
//       setNowTick(Date.now());
//       if (Date.now() >= syncMeta.nextRefreshTime) {
//         fetchTimetable(section, false, true);
//       }
//     }, 15000);
//     return () => clearInterval(interval);
//   }, [user, section, syncMeta.nextRefreshTime]);

//   useEffect(() => {
//     if (!user || hintHandledThisSession.current) return;
//     hintHandledThisSession.current = true;
//     const shownCount = parseInt(localStorage.getItem(SWIPE_HINT_STORAGE_KEY) || '0', 10);

//     if (shownCount < SWIPE_HINT_MAX_SHOWS) {
//       localStorage.setItem(SWIPE_HINT_STORAGE_KEY, String(shownCount + 1));
//       const openTimer = setTimeout(() => {
//         setShowSwipeHint(true);
//         hintDismissTimer.current = setTimeout(() => setShowSwipeHint(false), SWIPE_HINT_AUTO_DISMISS_MS);
//       }, 400);
//       return () => clearTimeout(openTimer);
//     }
//   }, [user]);

//   useEffect(() => {
//     return () => { if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current); };
//   }, []);

//   const dismissSwipeHint = () => {
//     if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current);
//     setShowSwipeHint(false);
//   };

//   const handleGoogleSuccess = async (credentialResponse) => {
//     try {
//       setAuthError('');
//       const res = await axios.post(`${API_BASE_URL}/api/auth/google`, { token: credentialResponse.credential });

//       setUser(res.data.user);
//       setHasOltCreds(res.data.user.hasOltCreds);
//       localStorage.setItem('iimt_user', JSON.stringify(res.data.user));
//       localStorage.setItem('iimt_token', res.data.token);

//       fetchUserTodos(res.data.token);
//       fetchUserProfile(res.data.token);
//     } catch (err) {
//       if (err.response?.status === 429) setAuthError(err.response.data.error || 'Too many attempts. Try again later.');
//       else setAuthError(err.response?.data?.error || 'Authentication failed. Please try again.');
//     }
//   };

//   const handleLogout = () => {
//     trackEvent('auth', 'logout');
//     googleLogout();
//     setUser(null);
//     setTodos({});
//     localStorage.removeItem('iimt_user');
//     localStorage.removeItem('iimt_token');
//     setCache({});
//   };

//   const applyDateLogic = (data) => {
//     const validDates = data.map(d => d.isoDate).filter(Boolean);
//     if (validDates.length > 0) {
//       validDates.sort();
//       let min = validDates[0];
//       let max = validDates[validDates.length - 1];
//       const todayIST = getTodayIST();

//       if (todayIST < min) min = todayIST;
//       if (todayIST > max) max = todayIST;

//       setMinDate(min);
//       setMaxDate(max);
//       setSelectedDate(todayIST);
//     } else {
//       setMinDate('');
//       setMaxDate('');
//       setSelectedDate('');
//     }
//   };

//   const fetchTimetable = async (sec, forceBackendSync = false, isBackgroundRefresh = false) => {
//     if (!forceBackendSync && !isBackgroundRefresh && cache[sec]) {
//       setScheduleData(cache[sec].timetable);
//       setSummaryData(cache[sec].summary);
//       if (cache[sec].meta) setSyncMeta(cache[sec].meta);
//       applyDateLogic(cache[sec].timetable);
//       return;
//     }
//     if (!isBackgroundRefresh) { setLoading(true); setError(''); }

//     try {
//       const token = localStorage.getItem('iimt_token');
//       const res = await axios.get(`${API_BASE_URL}/api/timetable/${sec}?force=${forceBackendSync}`, {
//         headers: { Authorization: `Bearer ${token}` }
//       });

//       const data = res.data.timetable;
//       const summary = res.data.summary;
//       const meta = res.data.meta;

//       setScheduleData(data);
//       setSummaryData(summary);
//       if (meta) setSyncMeta(meta);

//       if (!isBackgroundRefresh) applyDateLogic(data);
//       setCache(prevCache => ({ ...prevCache, [sec]: { timetable: data, summary: summary, meta } }));
//     } catch (err) {
//       if (err.response?.status === 429) {
//           if (!isBackgroundRefresh) setError('Server busy: Rate limit exceeded. Try again in a few minutes.');
//       } else if (err.response?.status !== 401) {
//           if (!isBackgroundRefresh) setError('System Error: Unable to fetch ERP data.');
//       }
//     } finally {
//       if (!isBackgroundRefresh) setLoading(false);
//     }
//   };

//   const fetchAttendance = async () => {
//     trackEvent('button_click', 'fetch_attendance');
//     setIsFetchingAttendance(true);
//     setAttendanceError('');
//     setOtpRequired(false);
//     setFetchProgress({ step: 0, total: 8, message: 'Connecting to OLT portal…', status: 'in_progress' });
//     const sectionAtFetchTime = section;
//     startProgressPolling();
//     try {
//       const token = localStorage.getItem('iimt_token');
//       const res = await axios.post(`${API_BASE_URL}/api/attendance/fetch`, {}, { headers: { Authorization: `Bearer ${token}` }});
//       if (res.data.requiresOtp) {
//           setOtpRequired(true);
//       } else {
//           setAttendanceData(res.data.results);
//           setAttendanceFetchedSection(res.data.section || sectionAtFetchTime);
//       }
//     } catch (err) {
//       setAttendanceError(err.response?.data?.error || 'Failed to fetch attendance from OLT.');
//     } finally {
//       setIsFetchingAttendance(false);
//       stopProgressPolling();
//     }
//   };

//   const verifyOtp = async (otp) => {
//     trackEvent('button_click', 'submit_otp');
//     setIsFetchingAttendance(true);
//     setAttendanceError('');
//     const sectionAtFetchTime = section;
//     startProgressPolling();
//     try {
//       const token = localStorage.getItem('iimt_token');
//       const res = await axios.post(`${API_BASE_URL}/api/attendance/verify-otp`, { otp }, { headers: { Authorization: `Bearer ${token}` }});
//       setAttendanceData(res.data.results);
//       setAttendanceFetchedSection(res.data.section || sectionAtFetchTime);
//       setOtpRequired(false);
//     } catch (err) {
//       setAttendanceError(err.response?.data?.error || 'Invalid OTP');
//     } finally {
//       setIsFetchingAttendance(false);
//       stopProgressPolling();
//     }
//   };

//   const saveCredentials = async (username, password) => {
//     try {
//       const token = localStorage.getItem('iimt_token');
//       await axios.post(`${API_BASE_URL}/api/user/olt-credentials`, { username, password }, { headers: { Authorization: `Bearer ${token}` }});
//       setHasOltCreds(true);
//       setShowCredsForm(false);
//       fetchAttendance();
//     } catch (err) { alert('Failed to securely save credentials.'); }
//   };

//   const handleSyncData = () => {
//     trackEvent('button_click', 'manual_sync_timetable');
//     setCache({});
//     fetchTimetable(section, true, false);
//   };

//   const handleResetDate = () => {
//     trackEvent('button_click', 'reset_date_today');
//     setDaySwipeAnim('fade-in');
//     setSelectedDate(getTodayIST());
//   };

//   const submitFeedback = async () => {
//     if (!feedbackText.trim()) return;
//     setIsSubmitting(true);
//     setFeedbackStatus('Sending...');
//     try {
//       const token = localStorage.getItem('iimt_token');
//       await axios.post(`${API_BASE_URL}/api/feedback`, { message: feedbackText }, {
//         headers: { Authorization: `Bearer ${token}` }
//       });

//       setFeedbackStatus('Sent! Thank you.');
//       setTimeout(() => {
//         setShowFeedbackModal(false);
//         setFeedbackText('');
//         setFeedbackStatus('');
//         setIsSubmitting(false);
//       }, 2000);
//     } catch (error) {
//       setIsSubmitting(false);
//       if (error.response?.status === 429) setFeedbackStatus('Rate limited. Please wait.');
//       else setFeedbackStatus('Failed to send.');
//     }
//   };

//   const saveSectionSetting = () => {
//     trackEvent('action', 'save_section_setting', { section: settingsSectionDraft });
//     setSettingsStatus('Saved!');
//     setSection(settingsSectionDraft);
//     setTimeout(() => {
//       setShowSettingsModal(false);
//       setSettingsStatus('');
//     }, 700);
//   };

//   const currentDayData = scheduleData.find(d => d.isoDate === selectedDate);
//   const formatHeaderDate = (isoDate, dayString) => {
//     if (!isoDate) return 'Timetable';
//     const dateObj = new Date(isoDate);
//     const formatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
//     return `${dayString}, ${formatted}`;
//   };

//   const formatClockTime = (ts) => {
//     if (!ts) return '--:--';
//     return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
//   };

//   const minutesToNextRefresh = () => {
//     if (!syncMeta.nextRefreshTime) return null;
//     const diffMs = syncMeta.nextRefreshTime - nowTick;
//     return Math.max(0, Math.ceil(diffMs / 60000));
//   };

//   const shiftIsoDate = (isoDate, days) => {
//     const d = new Date(`${isoDate}T00:00:00`);
//     d.setDate(d.getDate() + days);
//     return d.toLocaleDateString('en-CA');
//   };

//   const goToDay = (direction) => {
//     if (!selectedDate) return;
//     trackEvent('action', `swipe_day_${direction}`);
//     const delta = direction === 'next' ? 1 : -1;
//     const newDate = shiftIsoDate(selectedDate, delta);

//     if (direction === 'next' && maxDate && newDate > maxDate) return;
//     if (direction === 'prev' && minDate && newDate < minDate) return;

//     setDaySwipeAnim(direction === 'next' ? 'swipe-left' : 'swipe-right');
//     setSelectedDate(newDate);
//   };

//   const handleTouchStart = (e) => {
//     touchStartX.current = e.touches[0].clientX;
//     touchStartY.current = e.touches[0].clientY;
//     setIsDragging(true);
//     setDragX(0);
//   };

//   const handleTouchMove = (e) => {
//     if (!isDragging) return;
//     const deltaX = e.touches[0].clientX - touchStartX.current;
//     const deltaY = e.touches[0].clientY - touchStartY.current;

//     if (Math.abs(deltaX) > Math.abs(deltaY)) {
//       let resistance = 0.45;
//       if (deltaX < 0 && (!maxDate || selectedDate >= maxDate)) resistance = 0.08;
//       if (deltaX > 0 && (!minDate || selectedDate <= minDate)) resistance = 0.08;
//       setDragX(deltaX * resistance);
//     }
//   };

//   const handleTouchEnd = () => {
//     setIsDragging(false);
//     if (Math.abs(dragX) > SWIPE_THRESHOLD) goToDay(dragX < 0 ? 'next' : 'prev');
//     setDragX(0);
//   };

//   const hasTasksToday = todos[selectedDate]?.[section] && Object.keys(todos[selectedDate][section]).length > 0;

//   const injectedStyles = `
//     /* --- MOBILE RESPONSIVENESS FIXES --- */
//     @media (max-width: 768px) {
//       .dashboard-layout { min-height: 100dvh; }
//       .main-content { padding-bottom: ${hasTasksToday ? '160px' : '120px'} !important; transition: padding-bottom 0.3s ease;}
//       .timetable-section { padding-bottom: env(safe-area-inset-bottom, 40px); }
//       .mobile-swipe-hint { display: flex !important; }
//       .swipe-tutorial-overlay { display: flex !important; }

//       .admin-dashboard-layout { flex-direction: column !important; overflow: auto !important; }
//       .admin-sidebar { width: 100% !important; border-right: none !important; border-bottom: 1px solid #e2e8f0; flex: none !important; max-height: 350px;}
      
//       .feature-banner-actions { flex-direction: column; width: 100%; }
//       .feature-banner-actions button { width: 100%; justify-content: center; }

//       .mobile-refresh-fab { display: flex !important; }
//     }

//     /* --- SATISFYING LOADER ANIMATION --- */
//     .satisfying-loader-container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 60vh; gap: 1.5rem; width: 100%; }
//     .dot-wave { display: flex; gap: 12px; }
//     .dot-wave .dot { width: 16px; height: 16px; border-radius: 50%; background-color: var(--accent-gold, #dba315); animation: smooth-wave 1.4s ease-in-out infinite; box-shadow: 0 4px 10px rgba(219, 163, 21, 0.3); }
//     .dot-wave .dot:nth-child(1) { animation-delay: 0s; }
//     .dot-wave .dot:nth-child(2) { animation-delay: 0.15s; }
//     .dot-wave .dot:nth-child(3) { animation-delay: 0.3s; }
//     @keyframes smooth-wave {
//       0%, 100% { transform: translateY(0) scale(0.8); opacity: 0.3; }
//       50% { transform: translateY(-14px) scale(1.1); opacity: 1; }
//     }
//     .loading-text { color: var(--text-secondary, #888); font-size: 1.05rem; font-weight: 500; letter-spacing: 0.5px; animation: pulse-text 2s ease-in-out infinite; }
//     @keyframes pulse-text { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

//     /* --- PREMIUM SWIPE NAVIGATION --- */
//     .mobile-swipe-hint { display: none; align-items: center; justify-content: center; gap: 6px; color: var(--text-secondary, #888); font-size: 0.78rem; opacity: 0.65; margin: 0 0 0.75rem 0; user-select: none; }
//     .timetable-section { touch-action: pan-y; overflow-x: hidden; }
//     .day-anim-wrapper { width: 100%; will-change: transform, opacity; }

//     @keyframes premiumSlideInRight { from { transform: translateX(45px) scale(0.98); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
//     @keyframes premiumSlideInLeft { from { transform: translateX(-45px) scale(0.98); opacity: 0; } to { transform: translateX(0) scale(1); opacity: 1; } }
//     @keyframes premiumFadeIn { from { transform: translateY(12px) scale(0.99); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
//     .swipe-left { animation: premiumSlideInRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
//     .swipe-right { animation: premiumSlideInLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
//     .fade-in { animation: premiumFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

//     /* --- TUTORIAL OVERLAY --- */
//     .swipe-tutorial-overlay { position: fixed; inset: 0; background: rgba(15, 15, 15, 0.6); backdrop-filter: blur(3px); z-index: 9999; display: none; align-items: center; justify-content: center; animation: tutorialOverlayFade 0.35s ease forwards; -webkit-tap-highlight-color: transparent; }
//     @keyframes tutorialOverlayFade { from { opacity: 0; } to { opacity: 1; } }
//     .swipe-tutorial-card { display: flex; flex-direction: column; align-items: center; gap: 1.1rem; padding: 2rem 1.5rem; animation: tutorialCardPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
//     @keyframes tutorialCardPop { from { opacity: 0; transform: translateY(10px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
//     .swipe-tutorial-track { position: relative; width: 130px; height: 64px; display: flex; align-items: center; justify-content: center; }
//     .swipe-tutorial-track::before, .swipe-tutorial-track::after { content: ''; position: absolute; top: 50%; width: 34px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); transform: translateY(-50%); animation: tutorialTrackPulse 1.6s ease-in-out infinite; }
//     .swipe-tutorial-track::before { left: 0; }
//     .swipe-tutorial-track::after { right: 0; animation-delay: 0.3s; }
//     @keyframes tutorialTrackPulse { 0%, 100% { opacity: 0.15; } 50% { opacity: 0.5; } }
//     .swipe-tutorial-hand { color: #fff; filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45)); animation: tutorialHandSwipe 1.6s ease-in-out infinite; }
//     @keyframes tutorialHandSwipe { 0% { transform: translateX(38px) rotate(-6deg); opacity: 0; } 14% { opacity: 1; } 50% { transform: translateX(-38px) rotate(6deg); opacity: 1; } 68% { opacity: 0; } 100% { transform: translateX(38px) rotate(-6deg); opacity: 0; } }
//     .swipe-tutorial-text { color: #fff; font-size: 0.95rem; font-weight: 600; letter-spacing: 0.2px; text-align: center; }
//     .swipe-tutorial-dismiss { color: rgba(255, 255, 255, 0.55); font-size: 0.75rem; font-weight: 500; margin-top: 0.15rem; }

//     /* --- FIX: FORCED TEXT VISIBILITY ON ALL INPUTS & TEXTAREAS --- */
//     .modal-content textarea, .todo-input-form input { color: #333 !important; background-color: #fff !important; }
//     .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); z-index: 1000; display: flex; align-items: center; justify-content: center; }
//     .modal-content { background: white; padding: 2rem; border-radius: 16px; width: 90%; max-width: 400px; display: flex; flex-direction: column; gap: 1rem; color: #333; box-shadow: 0 10px 40px rgba(0,0,0,0.2); animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
//     @keyframes popIn { 0% { opacity: 0; transform: scale(0.95); } 100% { opacity: 1; transform: scale(1); } }
//     .modal-content textarea { width: 100%; height: 100px; padding: 10px; border-radius: 8px; border: 1px solid #ccc; font-family: inherit; resize: none; }
//     .modal-actions { display: flex; justify-content: flex-end; gap: 10px; }
//     .btn-submit { background: var(--accent-gold); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
//     .btn-submit:disabled { background: #d0b875; cursor: not-allowed; }
//     .btn-cancel { background: #eee; color: #333; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; }
//     .btn-cancel:disabled { background: #f5f5f5; color: #999; cursor: not-allowed; }
//     .btn-text { background: none; border: none; color: #888; font-weight: 500; cursor: pointer; padding: 8px; width: 100%; text-decoration: underline; }

//     /* --- OLT POPUP GLOW --- */
//     .olt-glow-modal { background: linear-gradient(to bottom, #fff, #fefdf9); border: 1px solid var(--accent-gold); box-shadow: 0 0 20px rgba(219, 163, 21, 0.2); text-align: center; }
//     .olt-glow-modal h3 { color: var(--accent-gold); font-size: 1.4rem; margin: 0;}

//     /* --- SETTINGS MODAL --- */
//     .settings-section-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
//     .settings-section-btn { padding: 10px 0; border-radius: 8px; border: 1px solid #ddd; background: #fafafa; color: #333; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
//     .settings-section-btn.active { background: var(--accent-gold); border-color: var(--accent-gold); color: #fff; }
//     .settings-status-text { font-size: 0.85rem; color: var(--accent-gold); font-weight: 600; }

//     /* --- FEATURE BANNER --- */
//     .feature-banner { background: linear-gradient(135deg, rgba(219, 163, 21, 0.12), rgba(219, 163, 21, 0.04)); border: 1px solid rgba(219, 163, 21, 0.25); border-radius: 12px; padding: 1.25rem; margin-bottom: 1.5rem; display: flex; flex-direction: column; gap: 10px; color: var(--text-primary, #fff); box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
//     .feature-banner-header { display: flex; justify-content: space-between; align-items: flex-start; }
//     .feature-banner-title { font-size: 1.1rem; font-weight: 700; color: var(--accent-gold); display: flex; align-items: center; gap: 8px; margin: 0; }
//     .feature-banner-text { font-size: 0.9rem; color: #d0d0d0; margin: 0; line-height: 1.5; }
//     .feature-banner-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 5px; }
//     .btn-banner-primary { background: var(--accent-gold); color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; transition: background 0.2s;}
//     .btn-banner-primary:hover { background: #c59212; }
//     .btn-banner-secondary { background: rgba(255,255,255,0.05); color: #ddd; border: 1px solid rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 8px; font-weight: 500; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.85rem; transition: all 0.2s;}
//     .btn-banner-secondary:hover { background: rgba(255,255,255,0.1); color: #fff;}
//     .btn-banner-close { background: none; border: none; color: #888; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; border-radius: 50%; transition: all 0.2s;}
//     .btn-banner-close:hover { background: rgba(255,255,255,0.1); color: #fff;}

//     /* --- LIVE DATA BANNER --- */
//     .live-data-banner { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; background: rgba(76, 175, 80, 0.08); border: 1px solid rgba(76, 175, 80, 0.25); color: #2f6b32; border-radius: 10px; padding: 8px 14px; font-size: 0.82rem; margin-bottom: 1rem; }
//     .live-data-dot { width: 8px; height: 8px; border-radius: 50%; background: #4caf50; box-shadow: 0 0 0 rgba(76, 175, 80, 0.5); animation: liveDotPulse 1.8s infinite; flex-shrink: 0; }
//     @keyframes liveDotPulse { 0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5); } 70% { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); } 100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); } }
//     .live-data-banner strong { font-weight: 700; }
//     .live-data-meta { color: #4a7a4c; opacity: 0.85; }

//     /* --- SESSION NUMBER BADGE --- */
//     .session-badge { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.3px; color: var(--accent-gold); background: rgba(219, 163, 21, 0.12); border: 1px solid rgba(219, 163, 21, 0.3); border-radius: 6px; padding: 2px 8px; margin-top: 6px; display: inline-block; }

//     /* --- TO-DO WIDGET STYLES --- */
//     .class-header-flex { display: flex; justify-content: space-between; align-items: flex-start; }
//     .add-task-btn { background: rgba(219, 163, 21, 0.1); border: 1px solid rgba(219, 163, 21, 0.3); border-radius: 8px; padding: 6px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--accent-gold); position: relative; transition: all 0.2s ease; }
//     .add-task-btn:hover { background: rgba(219, 163, 21, 0.2); }
//     .task-indicator { position: absolute; top: -3px; right: -3px; background: red; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid white; }
//     .todo-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 2000; display: flex; align-items: flex-end; justify-content: center; animation: fadeOverlay 0.3s ease; }
//     @keyframes fadeOverlay { from { opacity: 0; } to { opacity: 1; } }
//     .todo-bottom-sheet { background: white; width: 100%; max-width: 600px; border-radius: 20px 20px 0 0; padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; box-shadow: 0 -4px 20px rgba(0,0,0,0.15); animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; max-height: 80vh; color: #333; }
//     @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
//     .todo-sheet-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee; padding-bottom: 1rem; }
//     .todo-subject { margin: 0; font-size: 1.2rem; color: #333; }
//     .todo-date { margin: 4px 0 0 0; font-size: 0.85rem; color: #888; }
//     .todo-close-btn { background: none; border: none; padding: 4px; cursor: pointer; color: #666; border-radius: 50%; display: flex; }
//     .todo-close-btn:hover { background: #f5f5f5; }
//     .todo-list-container { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 4px 0; }
//     .todo-empty { text-align: center; color: #aaa; font-style: italic; padding: 2rem 0; font-size: 0.9rem; }
//     .todo-item { display: flex; align-items: center; gap: 12px; background: #f9f9f9; padding: 12px; border-radius: 8px; border: 1px solid #eee; transition: all 0.2s; color: #333;}
//     .todo-item.completed { opacity: 0.6; }
//     .todo-item.completed .todo-text { text-decoration: line-through; color: #888; }
//     .todo-check-btn { background: none; border: none; padding: 0; cursor: pointer; display: flex; align-items: center; }
//     .todo-text { flex: 1; font-size: 0.95rem; word-break: break-word; }
//     .todo-delete-btn { background: none; border: none; color: #ff4d4f; padding: 6px; cursor: pointer; border-radius: 6px; display: flex; }
//     .todo-delete-btn:hover { background: #fff1f0; }
//     .todo-input-form { display: flex; gap: 8px; padding-top: 10px; border-top: 1px solid #eee; }
//     .todo-input-form input { flex: 1; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; outline: none; }
//     .todo-input-form input:focus { border-color: var(--accent-gold); }
//     .todo-input-form button { background: var(--accent-gold); color: white; border: none; padding: 0 16px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
//     .todo-input-form button:disabled { background: #e0c88b; cursor: not-allowed; }
//     .todo-summary-bar { position: fixed; bottom: 0; left: 0; width: 100%; background: white; box-shadow: 0 -4px 12px rgba(0,0,0,0.1); border-radius: 16px 16px 0 0; z-index: 100; display: flex; flex-direction: column; transition: max-height 0.3s ease; max-height: 60px; overflow: hidden; color: #333; }
//     @media (min-width: 769px) { .todo-summary-bar { width: calc(100% - 260px); left: 260px; } }
//     .todo-summary-bar.expanded { max-height: 40vh; }
//     .todo-summary-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; cursor: pointer; background: white; user-select: none; }
//     .todo-summary-info { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; color: #333; }
//     .todo-summary-list { padding: 0 1.5rem 1.5rem 1.5rem; overflow-y: auto; display: flex; flex-direction: column; gap: 1rem; }
//     .todo-summary-subject-group { background: #fcfcfc; border: 1px solid #eee; border-radius: 8px; padding: 10px; cursor: pointer; }
//     .todo-summary-subject-title { font-size: 0.8rem; font-weight: 700; color: #666; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
//     .todo-summary-item { display: flex; align-items: flex-start; gap: 8px; font-size: 0.9rem; margin-bottom: 6px; }
//     .todo-summary-item:last-child { margin-bottom: 0; }
//     .todo-summary-item.completed { opacity: 0.5; text-decoration: line-through; }
//     .todo-summary-text { flex: 1; word-break: break-word; line-height: 1.4; margin-top: -1px; }

//     /* --- MOBILE REFRESH FAB --- */
//     .mobile-refresh-fab { display: none; position: fixed; bottom: 85px; right: 20px; z-index: 900; background: white; color: var(--accent-gold); width: 50px; height: 50px; border-radius: 50%; border: 1px solid rgba(219,163,21,0.3); align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(0,0,0,0.15); cursor: pointer; }
//     .spinning { animation: spin 1s linear infinite; }
//     @keyframes spin { 100% { transform: rotate(360deg); } }

//     /* --- ADMIN PORTAL DASHBOARD LAYOUT & CHARTS (REVAMPED) --- */
//     .admin-container-fluid { font-family: 'Inter', system-ui, sans-serif; color: #0f172a; height: 100vh; background: #f8fafc; }
//     .admin-login { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; background: #f8fafc; }
//     .admin-login-box { background: white; padding: 3rem; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.05); text-align: center; width: 90%; max-width: 400px; }
//     .admin-login input { padding: 12px; margin-bottom: 12px; border-radius: 8px; border: 1px solid #cbd5e1; width: 100%; color: #0f172a; background: #fff; box-sizing: border-box; }
//     .admin-login button { background: var(--accent-gold); color: white; padding: 12px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; width: 100%; transition: opacity 0.2s; }
//     .admin-login button:hover { opacity: 0.9; }
    
//     .admin-dashboard-layout { display: flex; height: 100vh; overflow: hidden; background: #f8fafc; }
//     .admin-sidebar { width: 280px; background: #ffffff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; box-shadow: 2px 0 10px rgba(0,0,0,0.02); z-index: 10; }
    
//     .admin-tabs { display: flex; flex-direction: column; gap: 8px; margin-top: 1.5rem; }
//     .admin-tab { background: transparent; border: none; padding: 14px 20px; font-size: 0.95rem; font-weight: 600; color: #64748b; cursor: pointer; border-radius: 10px; transition: all 0.2s ease; text-align: left; display: flex; align-items: center; }
//     .admin-tab.active { background: rgba(219,163,21,0.1); color: var(--accent-gold); }
//     .admin-tab:hover:not(.active) { background: #f1f5f9; color: #0f172a; }

//     .admin-main-content { flex: 1; overflow-y: auto; padding: 2.5rem; }
//     .admin-header-title { font-size: 1.75rem; font-weight: 700; color: #0f172a; margin: 0 0 1.5rem 0; }
    
//     /* Stats grid */
//     .admin-stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
//     .admin-stat-card { background: #ffffff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
//     .admin-stat-card .label { font-size: 0.85rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
//     .admin-stat-card .value { font-size: 2.2rem; font-weight: 800; color: #0f172a; }
//     .admin-stat-card .value.gold { color: var(--accent-gold); }

//     /* CSS Charts */
//     .admin-charts-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(450px, 1fr)); gap: 24px; margin-bottom: 30px; }
//     @media (max-width: 768px) { .admin-charts-container { grid-template-columns: 1fr; } }
//     .admin-chart-box { background: #ffffff; padding: 24px; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
//     .admin-chart-box h3 { margin: 0 0 20px 0; font-size: 1.1rem; color: #0f172a; display: flex; align-items: center; gap: 10px; font-weight: 700; }
    
//     .css-bar-chart { display: flex; align-items: flex-end; justify-content: space-around; height: 220px; padding-top: 30px; border-bottom: 2px solid #f1f5f9; }
//     .css-bar-group { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 10px; width: 12%; height: 100%; }
//     .css-bar { width: 100%; background: var(--accent-gold); border-radius: 6px 6px 0 0; position: relative; min-height: 4px; transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
//     .css-bar.green { background: #10b981; }
//     .css-bar:hover::after { content: attr(data-val); position: absolute; top: -32px; left: 50%; transform: translateX(-50%); background: #1e293b; color: white; padding: 4px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; z-index: 10; }
//     .css-bar-label { font-size: 0.75rem; color: #64748b; font-weight: 500; text-align: center; }

//     /* Lists */
//     .interaction-list { display: flex; flex-direction: column; gap: 12px; }
//     .interaction-row { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; transition: background 0.2s; }
//     .interaction-row:hover { background: #f1f5f9; }
//     .interaction-row-name { font-weight: 600; font-size: 0.95rem; color: #334155; display: flex; align-items: center; gap: 8px;}
//     .interaction-row-count { background: #ffffff; color: var(--accent-gold); padding: 4px 12px; border-radius: 20px; font-weight: 700; font-size: 0.85rem; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);}

//     /* User Database Cards */
//     .active-user-card { display: flex; align-items: center; gap: 15px; padding: 16px; border-radius: 12px; border: 1px solid #e2e8f0; background: #ffffff; margin-bottom: 12px; transition: all 0.2s ease;}
//     .active-user-card:hover { border-color: #cbd5e1; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); transform: translateY(-1px); }
//     .active-user-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid #f1f5f9; }
//     .active-user-info { flex: 1; overflow: hidden; }
//     .active-user-name { font-weight: 700; font-size: 1rem; color: #0f172a; margin-bottom: 4px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
//     .active-user-email { font-size: 0.85rem; color: #64748b; display: flex; align-items: center; gap: 6px; }
//     .active-user-time { text-align: right; }
//     .active-user-time-val { font-size: 0.9rem; font-weight: 600; color: #334155; }
//     .active-user-time-label { font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px; }
//     .online-indicator { display: inline-block; width: 8px; height: 8px; background: #10b981; border-radius: 50%; margin-right: 6px; box-shadow: 0 0 0 2px #d1fae5; }
    
//     /* Feedback Cards */
//     .feedback-card { background: #fefce8; padding: 20px; margin-bottom: 16px; border-radius: 12px; border: 1px solid #fef08a; border-left: 5px solid var(--accent-gold); color: #0f172a; box-shadow: 0 2px 4px rgba(0,0,0,0.02);}
//     .feedback-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
//     .feedback-name { font-weight: 700; font-size: 1rem; color: #0f172a; }
//     .feedback-time { font-size: 0.8rem; color: #854d0e; font-weight: 500; }
//     .feedback-msg { margin: 0; font-size: 0.95rem; color: #334155; white-space: pre-wrap; line-height: 1.5; }

//     /* --- ATTENDANCE UI --- */
//     .attendance-container { max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.2rem; }
//     .creds-card { background: white; color: #333; border-radius: 12px; padding: 2rem; box-shadow: 0 4px 15px rgba(0,0,0,0.05); text-align: center; }
//     .creds-card h3 { color: #111; margin-top: 0; margin-bottom: 0.5rem; }
//     .input-group { display: flex; flex-direction: column; gap: 8px; text-align: left; margin-bottom: 1rem; color: #333; }
//     .input-group input { padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; color: #333; background: #fff; }
//     .input-group input:focus { outline: none; border-color: var(--accent-gold); }
//     .attendance-summary-card { background: linear-gradient(135deg, #1e1e1e, #2d2d2d); color: white; padding: 1.5rem; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 15px rgba(0,0,0,0.1); }
//     .summary-stat { text-align: center; }
//     .summary-stat .value { font-size: 1.8rem; font-weight: bold; color: var(--accent-gold); }
//     .summary-stat .label { font-size: 0.8rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 1px; color: #eee; }
//     .subject-card { background: white; color: #333; border-radius: 10px; border: 1px solid #eee; overflow: hidden; transition: all 0.2s; }
//     .subject-header { padding: 1rem 1.2rem; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: #fafafa; border-bottom: 1px solid transparent; }
//     .subject-header:hover { background: #f0f0f0; }
//     .subject-title { font-weight: 700; font-size: 0.95rem; flex: 1; color: #111; }
//     .subject-stats { display: flex; align-items: center; gap: 15px; font-size: 0.9rem; color: #444; }
//     .progress-bar { width: 60px; height: 6px; background: #ddd; border-radius: 3px; overflow: hidden; }
//     .progress-fill { height: 100%; border-radius: 3px; }
//     .class-list { padding: 0 1.2rem; max-height: 0; overflow: hidden; transition: max-height 0.3s ease; background: #fff; }
//     .class-list.expanded { max-height: 500px; padding: 1rem 1.2rem; overflow-y: auto; border-top: 1px solid #eee; }
//     .class-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed #eee; font-size: 0.85rem; color: #444; }
//     .class-row:last-child { border-bottom: none; }
//     .status-badge { padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 0.75rem; }
//     .status-p { background: rgba(76, 175, 80, 0.1); color: #2e7d32; }
//     .status-a { background: rgba(244, 67, 54, 0.1); color: #d32f2f; }
//     .mismatch-card { max-width: 460px; margin: 3rem auto; }

//     /* --- LIVE ATTENDANCE FETCH PROGRESS (calm, low-stress) --- */
//     .attendance-fetch-progress { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 55vh; gap: 1.5rem; width: 100%; max-width: 360px; margin: 0 auto; }
//     .fetch-progress-ring { --pct: 0; position: relative; width: 108px; height: 108px; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: conic-gradient(var(--accent-gold, #dba315) calc(var(--pct) * 1%), rgba(219, 163, 21, 0.12) 0); transition: background 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
//     .fetch-progress-ring::before { content: ''; position: absolute; inset: 8px; border-radius: 50%; background: var(--bg-primary, #fff); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04); }
//     .fetch-progress-ring-label { position: relative; z-index: 1; font-size: 1.3rem; font-weight: 700; color: var(--accent-gold, #dba315); letter-spacing: 0.3px; }
//     .fetch-progress-message { color: var(--text-primary, #333); font-size: 0.98rem; font-weight: 500; text-align: center; min-height: 1.4em; transition: opacity 0.3s ease; letter-spacing: 0.1px; }
//     .fetch-progress-bar-track { width: 100%; height: 6px; border-radius: 4px; background: rgba(219, 163, 21, 0.12); overflow: hidden; }
//     .fetch-progress-bar-fill { height: 100%; border-radius: 4px; background: linear-gradient(90deg, var(--accent-gold, #dba315), #eccb6b); transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1); }
//     .fetch-progress-steps { display: flex; gap: 6px; }
//     .fetch-progress-dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(219, 163, 21, 0.2); transition: background 0.4s ease, transform 0.4s ease; }
//     .fetch-progress-dot.done { background: var(--accent-gold, #dba315); }
//     .fetch-progress-dot.current { background: var(--accent-gold, #dba315); animation: fetchDotPulse 1.1s ease-in-out infinite; }
//     @keyframes fetchDotPulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.6; } }
//   `;

//   if (window.location.pathname === '/admin') {
//     return <AdminPortal injectedStyles={injectedStyles} />;
//   }

//   if (!user) {
//     return (
//       <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
//         <div className="login-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
//           <div className="login-card" style={{ padding: '3rem', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'center', minWidth: '320px' }}>
//             <h1 style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem' }}>IIM Trichy</h1>
//             <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>PGPM Term-I Portal</p>
//             <GoogleLogin onSuccess={handleGoogleSuccess} onError={() => setAuthError('Google Login Failed')} useOneTap />
//             {authError && <div style={{ color: 'var(--color-cancelled)', marginTop: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>{authError}</div>}
//             <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>*Requires @iimtrichy.ac.in email address</p>
//           </div>
//         </div>
//       </GoogleOAuthProvider>
//     );
//   }

//   const dragStyle = {
//     transform: `translateX(${dragX}px) scale(${1 - Math.abs(dragX) / 3000})`,
//     opacity: 1 - Math.abs(dragX) / 500,
//     transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
//   };

//   const nextRefreshMins = minutesToNextRefresh();

//   const renderAttendanceTab = () => {
//     if (!hasOltCreds || showCredsForm) {
//       return <CredentialForm onSubmit={saveCredentials} onCancel={() => {setShowCredsForm(false); trackEvent('action', 'cancel_creds_form');}} hasCreds={hasOltCreds} />;
//     }

//     if (otpRequired) {
//       return <OTPForm onSubmit={verifyOtp} isLoading={isFetchingAttendance} />;
//     }

//     if (!attendanceData && !isFetchingAttendance) {
//       return (
//         <div className="empty-state">
//           <ClipboardCheck size={48} color="var(--accent-gold)" style={{ opacity: 0.5, marginBottom: '1rem' }} />
//           <h3>View Your Attendance</h3>
//           <p>Sync your live attendance directly from the OLT portal.</p>
//           <button className="btn-submit" onClick={fetchAttendance} style={{ marginTop: '1rem' }}>Fetch Now</button>
//           <button className="btn-cancel" onClick={() => {setShowCredsForm(true); trackEvent('button_click', 'update_creds');}} style={{ marginTop: '1rem', marginLeft: '10px' }}>Update Credentials</button>
//         </div>
//       );
//     }

//     if (isFetchingAttendance) {
//       const total = fetchProgress.total || 8;
//       const step = Math.min(fetchProgress.step || 0, total);
//       const pct = Math.round((step / total) * 100);
//       return (
//         <div className="attendance-fetch-progress">
//           <div className="fetch-progress-ring" style={{ '--pct': pct }}>
//             <span className="fetch-progress-ring-label">{pct}%</span>
//           </div>
//           <div className="fetch-progress-message">{fetchProgress.message || 'Connecting to OLT Portal…'}</div>
//           <div className="fetch-progress-bar-track">
//             <div className="fetch-progress-bar-fill" style={{ width: `${pct}%` }} />
//           </div>
//           <div className="fetch-progress-steps">
//             {Array.from({ length: total }).map((_, i) => (
//               <span key={i} className={`fetch-progress-dot ${i < step ? 'done' : ''} ${i === step ? 'current' : ''}`} />
//             ))}
//           </div>
//         </div>
//       );
//     }

//     let overallAttended = 0;
//     let overallTotal = 0;
//     Object.values(attendanceData || {}).forEach(sub => {
//       overallAttended += sub.attended;
//       overallTotal += sub.total;
//     });
//     const overallPercentage = overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : 0;

//     const subjectCount = Object.keys(attendanceData || {}).length;
//     const noRecordsMatched = subjectCount === 0 || overallTotal === 0;
//     const sectionMismatch = attendanceFetchedSection && attendanceFetchedSection !== section;

//     if (noRecordsMatched) {
//       return (
//         <div className="attendance-container">
//           <div className="creds-card mismatch-card">
//             <AlertCircle size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
//             <h3>No Attendance Records Found</h3>
//             {sectionMismatch ? (
//               <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
//                 We fetched attendance for <strong>Section {attendanceFetchedSection}</strong>, but you're currently browsing <strong>Section {section}</strong>. Attendance is always fetched for your actual class section — if that's still {attendanceFetchedSection}, switch the timetable section back below. Otherwise, your OLT credentials may need updating.
//               </p>
//             ) : (
//               <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
//                 We couldn't match your roll number in Section {attendanceFetchedSection || section}'s attendance records. This can happen if you recently browsed a different timetable section, or if your saved OLT credentials have changed.
//               </p>
//             )}
//             <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
//               {sectionMismatch && (
//                 <button className="btn-submit" onClick={() => { setSettingsSectionDraft(attendanceFetchedSection); setShowSettingsModal(true); trackEvent('action', 'fix_section_mismatch'); }}>
//                   Switch back to Section {attendanceFetchedSection}
//                 </button>
//               )}
//               <button className="btn-cancel" onClick={fetchAttendance}>Try Again</button>
//               <button className="btn-cancel" onClick={() => setShowCredsForm(true)}>Update Credentials</button>
//             </div>
//           </div>
//         </div>
//       );
//     }

//     return (
//       <div className="attendance-container">
//         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
//            <h2 className="view-title" style={{ margin: 0 }}>Attendance Overview</h2>
//            <div>
//              <button onClick={fetchAttendance} className="nav-btn" style={{ margin: 0, padding: '8px 12px', border: '1px solid #ddd' }}><RefreshCw size={14}/> Sync</button>
//            </div>
//         </div>

//         {attendanceError && (
//           <div style={{ background: '#fff1f0', color: '#d32f2f', padding: '12px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
//             <AlertCircle size={18} /> {attendanceError}
//             <button onClick={() => setShowCredsForm(true)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#d32f2f', textDecoration: 'underline', cursor: 'pointer' }}>Update Credentials</button>
//           </div>
//         )}

//         <div className="attendance-summary-card">
//           <div className="summary-stat">
//             <div className="value">{overallAttended} / {overallTotal}</div>
//             <div className="label">Total Classes</div>
//           </div>
//           <div className="summary-stat">
//             <div className="value" style={{ color: overallPercentage < 80 ? '#ff4d4f' : '#4caf50' }}>{overallPercentage}%</div>
//             <div className="label">Overall Avg</div>
//           </div>
//         </div>

//         <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
//           {Object.entries(attendanceData || {}).map(([subject, data], idx) => {
//             const isExp = expandedSubject === subject;
//             const pct = parseFloat(data.percentage);
//             const color = pct >= 80 ? '#4caf50' : (pct >= 75 ? '#faad14' : '#ff4d4f');
            
//             return (
//               <div key={idx} className="subject-card">
//                 <div className="subject-header" onClick={() => {setExpandedSubject(isExp ? null : subject); trackEvent('action', isExp ? 'collapse_attendance' : 'expand_attendance');}}>
//                   <div className="subject-title">{subject}</div>
//                   <div className="subject-stats">
//                     <span style={{ fontWeight: 'bold', color: '#444' }}>{data.attended}/{data.total}</span>
//                     <div className="progress-bar"><div className="progress-fill" style={{ width: `${pct}%`, background: color }}></div></div>
//                     <span style={{ color, fontWeight: 'bold', width: '45px', textAlign: 'right' }}>{data.percentage}%</span>
//                     {isExp ? <ChevronUp size={16} color="#888"/> : <ChevronDown size={16} color="#888"/>}
//                   </div>
//                 </div>
                
//                 <div className={`class-list ${isExp ? 'expanded' : ''}`}>
//                   {data.classes.map((cls, cIdx) => (
//                     <div key={cIdx} className="class-row">
//                       <span style={{ width: '40px' }}>{cls.class}</span>
//                       <span style={{ flex: 1 }}>{cls.date}</span>
//                       <span style={{ flex: 1 }}>{cls.time}</span>
//                       <span className={`status-badge status-${cls.status.toLowerCase()}`}>{cls.status}</span>
//                     </div>
//                   ))}
//                   {data.classes.length === 0 && <div style={{ textAlign: 'center', color: '#888', padding: '10px' }}>No records found.</div>}
//                 </div>
//               </div>
//             );
//           })}
//         </div>
//       </div>
//     );
//   };

//   return (
//     <>
//       <style>{injectedStyles}</style>

//       {/* --- LIVE ATTENDANCE POPUP FOR NEW USERS --- */}
//       {showOltPopup && (
//         <div className="modal-overlay">
//           <div className="modal-content olt-glow-modal">
//             <ClipboardCheck size={48} color="var(--accent-gold)" style={{ margin: '0 auto' }} />
//             <h3>Unlock Live Attendance</h3>
//             <p style={{ fontSize: '0.95rem', color: '#666', margin: '0 0 10px 0', lineHeight: '1.4' }}>
//               You can now track your live class attendance and view detailed class-by-class status directly inside the app!
//             </p>
//             <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
//               <button className="btn-submit" onClick={() => { setShowOltPopup(false); handleTabChange('attendance'); }}>Setup OLT Account Now</button>
//               <button className="btn-text" onClick={() => { setShowOltPopup(false); sessionStorage.setItem('olt_popup_dismissed', '1'); trackEvent('action', 'dismiss_olt_popup'); }}>Remind me later</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {/* --- MOBILE FLOATING REFRESH BUTTON --- */}
//       {activeTab === 'timetable' && (
//         <button 
//           className="mobile-refresh-fab" 
//           onClick={() => { 
//             setIsReloading(true); 
//             trackEvent('button_click', 'mobile_fab_reload'); 
//             setTimeout(() => window.location.reload(), 150); 
//           }}
//         >
//           <RefreshCw size={22} className={isReloading ? 'spinning' : ''} />
//         </button>
//       )}

//       {showIOSPrompt && (
//         <div className="modal-overlay" onClick={() => setShowIOSPrompt(false)}>
//           <div className="modal-content" onClick={e => e.stopPropagation()}>
//             <h3 style={{ margin: 0 }}>Install on iOS</h3>
//             <p style={{ fontSize: '0.95rem', color: '#666', margin: '10px 0', lineHeight: '1.5' }}>
//               To install this app on your iPhone or iPad:<br/><br/>
//               1. Tap the <strong>Share</strong> button <Share size={16} style={{display: 'inline', verticalAlign: 'middle', margin: '0 2px'}}/> at the bottom of Safari.<br/>
//               2. Scroll down and select <strong>"Add to Home Screen"</strong>.
//             </p>
//             <div className="modal-actions">
//               <button className="btn-submit" onClick={() => setShowIOSPrompt(false)}>Got it</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {showFeedbackModal && (
//         <div className="modal-overlay" onClick={() => !isSubmitting && setShowFeedbackModal(false)}>
//           <div className="modal-content" onClick={e => e.stopPropagation()}>
//             <h3 style={{ margin: 0 }}>Submit Feedback</h3>
//             <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>Report an issue or suggest a feature.</p>
//             <textarea placeholder="Type your message here... (max 1000 chars)" maxLength={1000} value={feedbackText} onChange={e => setFeedbackText(e.target.value)} disabled={isSubmitting} />
//             {feedbackStatus && <div style={{fontSize: '0.85rem', color: 'var(--accent-gold)'}}>{feedbackStatus}</div>}
//             <div className="modal-actions">
//               <button className="btn-cancel" disabled={isSubmitting} onClick={() => setShowFeedbackModal(false)}>Cancel</button>
//               <button className="btn-submit" disabled={isSubmitting || !feedbackText.trim()} onClick={submitFeedback}>Submit</button>
//             </div>
//           </div>
//         </div>
//       )}

//       {showSettingsModal && (
//         <div className="modal-overlay" onClick={() => setShowSettingsModal(false)}>
//           <div className="modal-content" onClick={e => e.stopPropagation()}>
//             <h3 style={{ margin: 0 }}>Settings</h3>
//             <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>Choose your section. This is saved to your account and remembered next time you log in.</p>
//             <div className="settings-section-grid">
//               {SECTIONS.map(sec => (
//                 <button key={sec} className={`settings-section-btn ${settingsSectionDraft === sec ? 'active' : ''}`} onClick={() => setSettingsSectionDraft(sec)}>{sec}</button>
//               ))}
//             </div>
//             {settingsStatus && <div className="settings-status-text">{settingsStatus}</div>}
//             <div className="modal-actions">
//               <button className="btn-cancel" onClick={() => setShowSettingsModal(false)}>Cancel</button>
//               <button className="btn-submit" onClick={saveSectionSetting}>Save</button>
//             </div>
//           </div>
//         </div>
//       )}

//       <TodoModal
//         isOpen={!!activeTodoClass}
//         onClose={() => setActiveTodoClass(null)}
//         activeClass={activeTodoClass}
//         todos={todos}
//         onUpdate={handleUpdateTodos}
//       />

//       {showSwipeHint && (
//         <div className="swipe-tutorial-overlay" onClick={dismissSwipeHint} onTouchStart={dismissSwipeHint} role="button">
//           <div className="swipe-tutorial-card">
//             <div className="swipe-tutorial-track">
//               <Hand size={40} className="swipe-tutorial-hand" strokeWidth={1.75} />
//             </div>
//             <div className="swipe-tutorial-text">Swipe left or right to change day</div>
//             <div className="swipe-tutorial-dismiss">Tap anywhere to dismiss</div>
//           </div>
//         </div>
//       )}

//       <div className="dashboard-layout">
//         <aside className="sidebar">
//           <div className="brand-title">IIM Trichy</div>
//           <div className="brand-subtitle">PGPM Term-I</div>

//           <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
//               <img src={user.picture || getFallbackAvatar(user.name)} alt="Profile" onError={(e) => { e.target.onerror = null; e.target.src = getFallbackAvatar(user.name); }} style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
//               <div style={{ overflow: 'hidden' }}>
//                   <div style={{ fontSize: '0.85rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{user.name}</div>
//               </div>
//           </div>

//           <div className="nav-menu">
//             <button className={`nav-btn ${activeTab === 'timetable' ? 'active' : ''}`} onClick={() => handleTabChange('timetable')}><Calendar size={18} /> Timetable</button>
//             <button className={`nav-btn ${activeTab === 'summary' ? 'active' : ''}`} onClick={() => handleTabChange('summary')}><Table2 size={18} /> Summary Table</button>
//             <button className={`nav-btn ${activeTab === 'attendance' ? 'active' : ''}`} onClick={() => handleTabChange('attendance')}><ClipboardCheck size={18} /> Attendance {(!hasOltCreds && !sessionStorage.getItem('olt_popup_dismissed')) && <span style={{width: 8, height: 8, background: 'red', borderRadius: '50%', marginLeft: '5px'}}></span>}</button>
//           </div>

//           {activeTab !== 'attendance' && (
//             <div className="section-selector-container">
//               <span className="section-label">Select Section</span>
//               <div className="sec-grid">
//                 {SECTIONS.map((sec) => (
//                   <button key={sec} className={`section-btn ${section === sec ? 'active' : ''}`} onClick={() => { setSection(sec); trackEvent('action', 'change_section', { to: sec }); }}>{sec}</button>
//                 ))}
//               </div>
//             </div>
//           )}

//           <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
//               {isInstallable && (
//                 <button onClick={handleInstallClick} className="nav-btn" style={{ width: '100%', color: 'var(--accent-gold)', fontWeight: 'bold' }}>
//                   <Download size={18} /> Install App
//                 </button>
//               )}
//               <button onClick={() => { setSettingsSectionDraft(section); setShowSettingsModal(true); trackEvent('button_click', 'open_settings'); }} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><Settings size={18} /> Settings</button>
//               <button onClick={() => { setShowFeedbackModal(true); trackEvent('button_click', 'open_feedback'); }} className="nav-btn" style={{ width: '100%', color: 'var(--text-secondary)' }}><MessageSquare size={18} /> Provide Feedback</button>
//               {activeTab === 'timetable' && <button onClick={handleSyncData} className="nav-btn desktop-only" style={{ width: '100%', color: 'var(--text-secondary)' }} disabled={loading}><RefreshCw size={18} /> {loading ? 'Syncing...' : 'Sync Data'}</button>}
//               <button onClick={handleLogout} className="nav-btn" style={{ width: '100%', color: 'var(--color-cancelled)' }}><LogOut size={18} /> Sign Out</button>
//           </div>
//         </aside>

//         <main className="main-content">
//           {loading && (
//             <div className="satisfying-loader-container">
//               <div className="dot-wave"><div className="dot"></div><div className="dot"></div><div className="dot"></div></div>
//               <div className="loading-text">Connecting to database...</div>
//             </div>
//           )}

//           {error && <div className="empty-state" style={{color: '#eb3223'}}>{error}</div>}

//           {!loading && !error && (
//             <>
//               {/* --- 5-DAY FEATURE BANNER --- */}
//               {showFeatureBanner && activeTab !== 'attendance' && (
//                 <div className="feature-banner fade-in">
//                   <div className="feature-banner-header">
//                     <h3 className="feature-banner-title">
//                       <Sparkles size={18} fill="currentColor" /> 
//                       New: Live OLT Attendance
//                     </h3>
//                     <button className="btn-banner-close" onClick={dismissFeatureBanner} aria-label="Close">
//                       <X size={18} />
//                     </button>
//                   </div>
//                   <p className="feature-banner-text">
//                     You can now track your live class attendance and view detailed class-by-class status directly from the OLT portal!
//                   </p>
//                   <div className="feature-banner-actions">
//                     <button className="btn-banner-primary" onClick={() => handleTabChange('attendance')}>
//                       <ClipboardCheck size={16} /> Check it out
//                     </button>
//                     <button className="btn-banner-secondary" onClick={handleShareApp}>
//                       <Share size={16} /> Share App
//                     </button>
//                     <button className="btn-banner-secondary" onClick={() => {setShowFeedbackModal(true); trackEvent('button_click', 'banner_feedback');}}>
//                       <MessageSquare size={16} /> Give Feedback
//                     </button>
//                   </div>
//                 </div>
//               )}

//               {activeTab === 'attendance' && renderAttendanceTab()}

//               {activeTab === 'timetable' && (
//                 <>
//                   <div className="live-data-banner">
//                     <span className="live-data-dot" />
//                     <span><strong>Live data</strong> — synced directly from Excel, no need to refresh manually.</span>
//                     <span className="live-data-meta">
//                       Last synced {formatClockTime(syncMeta.lastFetchTime)} IST
//                       {nextRefreshMins !== null && ` · Next auto-sync in ~${nextRefreshMins} min (at ${formatClockTime(syncMeta.nextRefreshTime)} IST)`}
//                     </span>
//                   </div>

//                   <div className="top-toolbar">
//                     <h2 className="view-title">
//                       {currentDayData ? formatHeaderDate(currentDayData.isoDate, currentDayData.day) : formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}
//                     </h2>
//                     <div className="legend">
//                       <div className="legend-item"><div className="legend-color" style={{ background: 'var(--color-makeup)' }}></div>Make-up</div>
//                       <div className="legend-item"><div className="legend-color" style={{ background: 'var(--color-cancelled)' }}></div>Cancelled</div>
//                     </div>
//                     <div className="date-picker-group">
//                       <button onClick={handleResetDate} className="nav-btn" style={{ padding: '0.6rem', border: '1px solid var(--border-color)', margin: '0' }} title="Snap back to Today"><CalendarSync size={18} color="var(--accent-gold)" /></button>
//                       <input type="date" className="date-input" value={selectedDate} min={minDate} max={maxDate} onChange={(e) => { setDaySwipeAnim('fade-in'); setSelectedDate(e.target.value); trackEvent('action', 'pick_date'); }} disabled={!minDate} />
//                     </div>
//                   </div>

//                   <div className="mobile-swipe-hint">
//                     <ChevronLeft size={14} /> Swipe to change day <ChevronRight size={14} />
//                   </div>

//                   <section className="timetable-section" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
//                     <div key={selectedDate} className={`day-anim-wrapper ${daySwipeAnim || ''}`} onAnimationEnd={() => setDaySwipeAnim(null)}>
//                       <div className="day-drag-surface" style={dragStyle}>
//                         {!currentDayData && selectedDate && (
//                           <div className="empty-state">No classes scheduled for {formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}. Enjoy your day!</div>
//                         )}

//                         {currentDayData && currentDayData.classes.map((cls, idx) => {
//                           const cardStyle = cls.color ? { borderLeftColor: cls.color, backgroundColor: `${cls.color}10` } : {};
//                           const hasTodos = todos[selectedDate]?.[section]?.[cls.subject]?.length > 0;
//                           const isRemark = cls.time?.toLowerCase().includes('remarks');

//                           return (
//                             <div key={idx} className="class-card" style={cardStyle}>
//                               {cls.status && (
//                                 <div className="status-pill" style={{ backgroundColor: cls.color }}>{cls.status}</div>
//                               )}

//                               <div className="class-header-flex">
//                                 <div className="time-badge" style={{ color: cls.color || 'var(--text-secondary)'}}>
//                                   {cls.time.includes('Remarks') ? <Info size={18} /> : <Clock size={18} />}
//                                   <span>{cls.time}</span>
//                                 </div>

//                                 <button className="add-task-btn" onClick={() => { setActiveTodoClass({ subject: cls.subject, date: selectedDate, section }); trackEvent('button_click', 'open_todo_modal'); }}>
//                                   <ListTodo size={16} />
//                                   {hasTodos && <span className="task-indicator" />}
//                                 </button>
//                               </div>

//                               <div className="class-details">
//                                 <div className="subject-name">{cls.subject}</div>
//                                 {cls.prof && (
//                                   <div className="prof-badge" style={cls.color ? { color: cls.color, borderColor: `${cls.color}50` } : {}}>
//                                     <UserIcon size={14} /> {cls.prof}
//                                   </div>
//                                 )}
//                                 {!isRemark && cls.sessionNumber && (
//                                   <div className="session-badge">Session {cls.sessionNumber}</div>
//                                 )}
//                               </div>
//                             </div>
//                           )
//                         })}
//                       </div>
//                     </div>
//                   </section>

//                   <TodoSummaryBar
//                     date={selectedDate}
//                     section={section}
//                     todos={todos}
//                     onOpenClass={(subject) => setActiveTodoClass({ subject, date: selectedDate, section })}
//                   />
//                 </>
//               )}

//               {activeTab === 'summary' && (
//                 <>
//                   <div className="top-toolbar"><h2 className="view-title">Section {section} Academic Overview</h2></div>
//                   {summaryData.headers.length > 0 ? (
//                     <div className="table-container" style={{ overflowX: 'auto' }}>
//                       <table className="erp-table" style={{ minWidth: '900px' }}>
//                         <thead><tr>{summaryData.headers.map((header, idx) => <th key={idx}>{header}</th>)}</tr></thead>
//                         <tbody>
//                           {summaryData.rows.map((row, rowIdx) => (
//                             <tr key={rowIdx}>{row.map((cell, cellIdx) => <td key={cellIdx}>{cellIdx === 0 ? <strong>{cell}</strong> : cell}</td>)}</tr>
//                           ))}
//                         </tbody>
//                       </table>
//                     </div>
//                   ) : <div className="empty-state">No summary data available.</div>}
//                 </>
//               )}
//             </>
//           )}
//         </main>
//       </div>
//       <Analytics />
//     </>
//   );
// }

// function CredentialForm({ onSubmit, onCancel, hasCreds }) {
//   const [user, setUser] = useState('');
//   const [pass, setPass] = useState('');
//   const [showPass, setShowPass] = useState(false);

//   return (
//     <div className="creds-card">
//       <Lock size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
//       <h3>{hasCreds ? 'Update' : 'Link'} OLT Account</h3>
//       <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Your credentials are encrypted and stored securely to sync your attendance.</p>
      
//       <div className="input-group">
//         <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Roll Number</label>
//         <input type="text" placeholder="e.g. 2601030" value={user} onChange={e => setUser(e.target.value)} />
//       </div>
//       <div className="input-group" style={{ position: 'relative' }}>
//         <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Password</label>
//         <input type={showPass ? 'text' : 'password'} placeholder="Date of birth (DDMMYYYY)" value={pass} onChange={e => setPass(e.target.value)} />
//         <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: '10px', top: '34px', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}>
//           {showPass ? <EyeOff size={18}/> : <Eye size={18}/>}
//         </button>
//       </div>

//       <div style={{ display: 'flex', gap: '10px', marginTop: '1.5rem' }}>
//         {hasCreds && <button className="btn-cancel" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>}
//         <button className="btn-submit" style={{ flex: 1 }} disabled={!user || !pass} onClick={() => onSubmit(user, pass)}>Securely Save</button>
//       </div>
//     </div>
//   );
// }

// function OTPForm({ onSubmit, isLoading }) {
//   const [otp, setOtp] = useState('');
//   return (
//     <div className="creds-card">
//       <AlertCircle size={40} color="var(--accent-gold)" style={{ marginBottom: '1rem' }} />
//       <h3>Two-Factor Authentication</h3>
//       <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Open your Google Authenticator app and enter the 6-digit code for OLT.</p>
      
//       <div className="input-group">
//         <input type="text" placeholder="000000" maxLength={6} style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '5px' }} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} disabled={isLoading} />
//       </div>
      
//       <button className="btn-submit" style={{ width: '100%', marginTop: '1rem' }} disabled={otp.length !== 6 || isLoading} onClick={() => onSubmit(otp)}>
//         {isLoading ? 'Verifying...' : 'Verify & Continue'}
//       </button>
//     </div>
//   );
// }

// // ==========================================
// // ADMIN DASHBOARD COMPONENT WITH CHARTS
// // ==========================================
// function AdminPortal({ injectedStyles }) {
//   const [password, setPassword] = useState('');
//   const [authData, setAuthData] = useState(null);
//   const [error, setError] = useState('');
//   const [loading, setLoading] = useState(false);
//   const [adminTab, setAdminTab] = useState('overview');

//   const handleLogin = async (e) => {
//     e.preventDefault(); 
//     setLoading(true);
//     try {
//       const res = await axios.post(`${API_BASE_URL}/api/admin/data`, { password });
//       setAuthData(res.data); 
//       setError('');
//     } catch(err) { 
//       setError('Invalid Password or Rate Limited'); 
//     }
//     finally { 
//       setLoading(false); 
//     }
//   };

//   const timeAgo = (date) => {
//     if (!date) return "Never";
//     const seconds = Math.floor((new Date() - new Date(date)) / 1000);
//     if (seconds < 60) return "Just now";
//     const minutes = Math.floor(seconds / 60);
//     if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
//     const hours = Math.floor(minutes / 60);
//     if (hours < 24) return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
//     const days = Math.floor(hours / 24);
//     return `${days} day${days !== 1 ? 's' : ''} ago`;
//   };

//   if (!authData) return (
//     <div className="admin-login">
//       <div className="admin-login-box">
//         <Lock size={48} color="var(--accent-gold)" style={{marginBottom: '1rem'}} />
//         <h2 style={{color: '#0f172a', margin: '0 0 1.5rem 0'}}>Admin Portal</h2>
//         <form onSubmit={handleLogin} style={{display: 'flex', flexDirection: 'column'}}>
//           <input type="password" placeholder="Admin Password" value={password} onChange={e=>setPassword(e.target.value)} />
//           <button type="submit">{loading ? 'Verifying...' : 'Login'}</button>
//         </form>
//         {error && <p style={{color: '#ef4444', fontSize: '0.9rem', marginTop: '1rem', fontWeight: 500}}>{error}</p>}
//       </div>
//     </div>
//   );

//   const { analytics, users, feedbacks } = authData;

//   // Extremely safe chart calculations to prevent NaN if arrays are empty
//   const maxDau = analytics.dau.length > 0 ? Math.max(...analytics.dau.map(d => d.count)) : 1;
//   const maxTraffic = analytics.traffic.length > 0 ? Math.max(...analytics.traffic.map(d => d.hits)) : 1;

//   return (
//     <>
//       <style>{injectedStyles}</style>
//       <div className="admin-dashboard-layout">
//         <aside className="admin-sidebar" style={{ padding: '1.5rem' }}>
//            <h2 style={{ color: 'var(--accent-gold)', margin: '0 0 2rem 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
//              <LayoutDashboard size={24}/> Admin
//            </h2>
//            <div className="admin-tabs">
//              <button className={`admin-tab ${adminTab === 'overview' ? 'active' : ''}`} onClick={() => setAdminTab('overview')}>
//                <Activity size={18} style={{marginRight: 10, verticalAlign:'middle'}}/> Analytics
//              </button>
//              <button className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>
//                <Users size={18} style={{marginRight: 10, verticalAlign:'middle'}}/> Users & Feedback
//              </button>
//            </div>
           
//            <div style={{marginTop: 'auto', paddingTop: '2rem'}}>
//              <button onClick={() => setAuthData(null)} style={{width: '100%', padding: '12px', border: 'none', background: '#fee2e2', color: '#b91c1c', borderRadius: '10px', cursor: 'pointer', fontWeight: 700}}>
//                Logout
//              </button>
//            </div>
//         </aside>

//         <main className="admin-main-content">
//           {adminTab === 'overview' && (
//              <div>
//                 <h2 className="admin-header-title">Dashboard Overview</h2>
                
//                 <div className="admin-stats-grid">
//                    <div className="admin-stat-card">
//                      <div className="label">Total Users</div>
//                      <div className="value gold">{users.length}</div>
//                    </div>
//                    <div className="admin-stat-card">
//                      <div className="label">Active Today</div>
//                      <div className="value">{analytics.dau.slice(-1)[0]?.count || 0}</div>
//                    </div>
//                    <div className="admin-stat-card">
//                      <div className="label">API Hits Today</div>
//                      <div className="value">{analytics.traffic.slice(-1)[0]?.hits || 0}</div>
//                    </div>
//                    <div className="admin-stat-card">
//                      <div className="label">OLT Setup Completes</div>
//                      <div className="value">{analytics.oltUsersCount || users.filter(u => u.oltUsername).length}</div>
//                    </div>
//                 </div>

//                 <div className="admin-charts-container">
//                    <div className="admin-chart-box">
//                       <h3><Activity size={18}/> Daily Active Users (7 Days)</h3>
//                       <div className="css-bar-chart">
//                         {analytics.dau.length === 0 ? <p style={{color: '#64748b', alignSelf:'center'}}>No data</p> : 
//                          analytics.dau.map((d, i) => (
//                           <div className="css-bar-group" key={i}>
//                              <div className="css-bar" style={{height: `${(d.count / maxDau) * 100}%`}} data-val={d.count}></div>
//                              <div className="css-bar-label">{d.date.split('-').slice(1).join('/')}</div>
//                           </div>
//                         ))}
//                       </div>
//                    </div>

//                    <div className="admin-chart-box">
//                       <h3><Activity size={18}/> Server Traffic (API Hits)</h3>
//                       <div className="css-bar-chart">
//                         {analytics.traffic.length === 0 ? <p style={{color: '#64748b', alignSelf:'center'}}>No data</p> : 
//                          analytics.traffic.map((d, i) => (
//                           <div className="css-bar-group" key={i}>
//                              <div className="css-bar green" style={{height: `${(d.hits / maxTraffic) * 100}%`}} data-val={d.hits}></div>
//                              <div className="css-bar-label">{d.date.split('-').slice(1).join('/')}</div>
//                           </div>
//                         ))}
//                       </div>
//                    </div>
//                 </div>

//                 <div className="admin-charts-container">
//                   <div className="admin-chart-box">
//                      <h3><MousePointer2 size={18}/> Feature Usage</h3>
//                      <div className="interaction-list">
//                        {analytics.features.length === 0 ? <p style={{color: '#64748b'}}>No data</p> : analytics.features.map(f => (
//                          <div className="interaction-row" key={f._id}>
//                            <div className="interaction-row-name">{f._id.replace('tab_', '').toUpperCase()}</div>
//                            <div className="interaction-row-count">{f.clicks} views</div>
//                          </div>
//                        ))}
//                      </div>
//                   </div>
//                   <div className="admin-chart-box">
//                      <h3><MousePointer2 size={18}/> Top Button Interactions</h3>
//                      <div className="interaction-list">
//                        {analytics.interactions.length === 0 ? <p style={{color: '#64748b'}}>No data</p> : analytics.interactions.map(f => (
//                          <div className="interaction-row" key={f._id}>
//                            <div className="interaction-row-name">{f._id.replace(/_/g, ' ')}</div>
//                            <div className="interaction-row-count" style={{background: '#f1f5f9', color: '#0f172a'}}>{f.count} taps</div>
//                          </div>
//                        ))}
//                      </div>
//                   </div>
//                 </div>
//              </div>
//           )}

//           {adminTab === 'users' && (
//              <div style={{display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap'}}>
//                 <div className="admin-chart-box" style={{flex: 1, minWidth: '320px', padding: '24px 0'}}>
//                   <h3 style={{margin: '0 24px 20px 24px'}}>User Database</h3>
//                   <div style={{display: 'flex', flexDirection: 'column', padding: '0 24px'}}>
//                      {users.map(u => {
//                         const timeAgoStr = timeAgo(u.lastActive);
//                         const isOnline = timeAgoStr === "Just now" || timeAgoStr.includes("min");
                        
//                         return (
//                           <div key={u._id} className="active-user-card">
//                              <img src={u.picture || `https://ui-avatars.com/api/?name=${u.name}&background=dba315&color=fff`} className="active-user-avatar" alt=""/>
//                              <div className="active-user-info">
//                                <div className="active-user-name">{u.name}</div>
//                                <div className="active-user-email">{u.email} &middot; Sec {u.defaultSection}</div>
//                              </div>
//                              <div className="active-user-time">
//                                 <div className="active-user-time-val">{isOnline && <span className="online-indicator"></span>}{timeAgoStr}</div>
//                                 <div className="active-user-time-label">Last Active</div>
//                              </div>
//                           </div>
//                         )
//                      })}
//                   </div>
//                 </div>

//                 <div className="admin-chart-box" style={{width: '100%', maxWidth: '420px', padding: '24px'}}>
//                   <h3 style={{marginTop: 0}}>Recent Feedback</h3>
//                   {feedbacks.length === 0 ? <p style={{color: '#64748b'}}>No feedback yet.</p> : feedbacks.map(f => (
//                      <div key={f._id} className="feedback-card">
//                         <div className="feedback-header">
//                           <div className="feedback-name">{f.userName}</div>
//                           <div className="feedback-time">{new Date(f.createdAt).toLocaleString()}</div>
//                         </div>
//                         <p className="feedback-msg">{f.message}</p>
//                      </div>
//                   ))}
//                 </div>
//              </div>
//           )}
//         </main>
//       </div>
//     </>
//   );
// }

// export default App;
