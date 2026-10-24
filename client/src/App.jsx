import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import {
  Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut,
  RefreshCw, ChevronLeft, ChevronRight, Hand, MessageSquare, ListTodo,
  Settings, Download, Share, ClipboardCheck, ChevronDown, X, Sparkles, BookOpen
} from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';

// Modularized pieces
import { TodoModal, TodoSummaryBar } from './TodoWidgets';
import AdminPortal from './Admin';
import AssignmentsTab from './AssignmentsTab';
import AttendanceTab from './AttendanceTab';
import { getInjectedStyles } from './injectedStyles';
import {
  SECTIONS,
  GOOGLE_CLIENT_ID,
  API_BASE_URL,
  SWIPE_THRESHOLD,
  SWIPE_HINT_MAX_SHOWS,
  SWIPE_HINT_STORAGE_KEY,
  SWIPE_HINT_AUTO_DISMISS_MS,
  SECTION_STORAGE_KEY,
  BANNER_STORAGE_KEY,
  BANNER_START_KEY,
  trackEvent
} from './config';

import './App.css';

// Re-exported so other files that import { trackEvent } from './App' keep working
export { trackEvent };



function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');
  
  // Tab state synced with URL route (/assign or /)
  const [activeTab, setActiveTab] = useState(() => {
    return window.location.pathname === '/assign' ? 'assignments' : 'timetable';
  });

  const [section, setSection] = useState(() => {
    const stored = localStorage.getItem(SECTION_STORAGE_KEY);
    return stored && SECTIONS.includes(stored) ? stored : 'A';
  });

  const [term, setTerm] = useState(() => {
    const stored = localStorage.getItem('iimt_term');
    return stored && ['Term-I', 'Term-II'].includes(stored) ? stored : 'Term-II';
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
  const [showMobileMenu, setShowMobileMenu] = useState(false);
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
  const [expandedSubject, setExpandedSubject] = useState(null);
  const [attendanceFetchedSection, setAttendanceFetchedSection] = useState(null);
  const [fetchProgress, setFetchProgress] = useState({ step: 0, total: 8, message: '', status: 'idle' });
  const progressPollRef = useRef(null);
  const isFirstSectionRender = useRef(true);

  // --- MCGRAW HILL ASSIGNMENTS STATE ---
  const [mheUsername, setMheUsername] = useState(() => localStorage.getItem('iimt_mhe_user') || '');
  const [mhePassword, setMhePassword] = useState('');
  const [mheSectionId, setMheSectionId] = useState(() => localStorage.getItem('iimt_mhe_section') || '');
  const [assignments, setAssignments] = useState(null);
  const [isFetchingAssignments, setIsFetchingAssignments] = useState(false);
  const [assignmentsError, setAssignmentsError] = useState('');

  const [showFeatureBanner, setShowFeatureBanner] = useState(false);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);

  // Listen for browser forward/back buttons or manual route navigation
  useEffect(() => {
    const handlePopState = () => {
      if (window.location.pathname === '/assign') {
        setActiveTab('assignments');
      } else if (activeTab === 'assignments') {
        setActiveTab('timetable');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeTab]);

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
        }, 2500);
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
          text: 'Check out this awesome app to track your live timetable, assignments, and OLT attendance in one place!',
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
    } catch (err) {
      console.error("Failed to fetch todos", err);
    }
  };

  const fetchUserProfile = async (token) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/user/me`, { headers: { Authorization: `Bearer ${token}` } });
      const savedSection = res.data?.user?.defaultSection;
      const savedTerm = res.data?.user?.defaultTerm;
      
      setHasOltCreds(res.data?.user?.hasOltCreds || false);
      if (savedSection && SECTIONS.includes(savedSection)) {
        setSection(savedSection);
        localStorage.setItem(SECTION_STORAGE_KEY, savedSection);
      }
      if (savedTerm && ['Term-I', 'Term-II'].includes(savedTerm)) {
        setTerm(savedTerm);
        localStorage.setItem('iimt_term', savedTerm);
      }
    } catch (err) {
      console.error("Failed to fetch user profile", err);
    }
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
      axios.post(
        `${API_BASE_URL}/api/user/section`,
        { section },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(err => console.error("Failed to save section", err));
    }
  }, [section, user]);

  useEffect(() => {
    localStorage.setItem('iimt_term', term);
    
    if (user) {
      const token = localStorage.getItem('iimt_token');
      axios.post(
        `${API_BASE_URL}/api/user/term`,
        { term },
        { headers: { Authorization: `Bearer ${token}` } }
      ).catch(err => console.error("Failed to save term", err));
    }
  }, [term, user]);

  useEffect(() => {
    if (isFirstSectionRender.current) {
      isFirstSectionRender.current = false;
      return;
    }

    setAttendanceData(null);
    setAttendanceFetchedSection(null);
    setAttendanceError('');
  }, [section, term]);

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
        const res = await axios.get(
          `${API_BASE_URL}/api/attendance/progress`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.data) setFetchProgress(res.data);
      } catch (err) {}
    }, 500);
  };

  useEffect(() => {
    return () => stopProgressPolling();
  }, []);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab === 'assignments') {
      window.history.pushState({}, '', '/assign');
    } else if (window.location.pathname === '/assign') {
      window.history.pushState({}, '', '/');
    }
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

      await axios.post(
        `${API_BASE_URL}/api/todos`,
        { date, section: sec, subject, tasks: newTodoList },
        { headers: { Authorization: `Bearer ${token}` } }
      );
    } catch (err) {
      console.error("Failed to sync todo", err);
    }
  };

  useEffect(() => {
    if (user) fetchTimetable(section);
  }, [section, user]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        fetchTimetable(section, false, true);
      }
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

    const shownCount = parseInt(
      localStorage.getItem(SWIPE_HINT_STORAGE_KEY) || '0',
      10
    );

    if (shownCount < SWIPE_HINT_MAX_SHOWS) {
      localStorage.setItem(
        SWIPE_HINT_STORAGE_KEY,
        String(shownCount + 1)
      );

      const openTimer = setTimeout(() => {
        setShowSwipeHint(true);

        hintDismissTimer.current = setTimeout(
          () => setShowSwipeHint(false),
          SWIPE_HINT_AUTO_DISMISS_MS
        );
      }, 400);

      return () => clearTimeout(openTimer);
    }
  }, [user]);

  useEffect(() => {
    return () => {
      if (hintDismissTimer.current) {
        clearTimeout(hintDismissTimer.current);
      }
    };
  }, []);

  const dismissSwipeHint = () => {
    if (hintDismissTimer.current) {
      clearTimeout(hintDismissTimer.current);
    }

    setShowSwipeHint(false);
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setAuthError('');

      const res = await axios.post(
        `${API_BASE_URL}/api/auth/google`,
        { token: credentialResponse.credential }
      );

      setUser(res.data.user);
      setHasOltCreds(res.data.user.hasOltCreds);

      localStorage.setItem(
        'iimt_user',
        JSON.stringify(res.data.user)
      );

      localStorage.setItem(
        'iimt_token',
        res.data.token
      );

      fetchUserTodos(res.data.token);
      fetchUserProfile(res.data.token);
    } catch (err) {
      if (err.response?.status === 429) {
        setAuthError(
          err.response.data.error ||
          'Too many attempts. Try again later.'
        );
      } else {
        setAuthError(
          err.response?.data?.error ||
          'Authentication failed. Please try again.'
        );
      }
    }
  };

  const handleLogout = () => {
    trackEvent('auth', 'logout');

    googleLogout();
    setUser(null);
    setTodos({});

    localStorage.removeItem('iimt_user');
    localStorage.removeItem('iimt_token');
    
    // Clear timetable caches on logout to ensure fresh data on next login
    SECTIONS.forEach(s => localStorage.removeItem(`iimt_timetable_cache_${s}`));

    setCache({});
  };

  const applyDateLogic = (data) => {
    if (!data || data.length === 0) return;
    
    const validDates = data
      .map(d => d.isoDate)
      .filter(Boolean);

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

  const fetchTimetable = async (
    sec,
    forceBackendSync = false,
    isBackgroundRefresh = false
  ) => {
    const localKey = `iimt_timetable_cache_${sec}`;
    
    let hasLocalData = !!cache[sec];

    if (!hasLocalData) {
      const stored = localStorage.getItem(localKey);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setCache(prev => ({ ...prev, [sec]: parsed }));
          setScheduleData(parsed.timetable);
          setSummaryData(parsed.summary);
          if (parsed.meta) setSyncMeta(parsed.meta);
          
          if (!selectedDate) applyDateLogic(parsed.timetable);
          
          hasLocalData = true;
        } catch(e) {
          localStorage.removeItem(localKey);
        }
      }
    }

    const shouldShowLoader = !hasLocalData && !isBackgroundRefresh;

    if (shouldShowLoader) {
      setLoading(true);
      setError('');
    }

    try {
      const token = localStorage.getItem('iimt_token');
      const res = await axios.get(
        `${API_BASE_URL}/api/timetable/${sec}?force=${forceBackendSync}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.data || !res.data.timetable) return;

      const data = res.data.timetable;
      const summary = res.data.summary;
      const meta = res.data.meta;

      if (!hasLocalData || forceBackendSync) {
        applyDateLogic(data);
      }

      setScheduleData(data);
      setSummaryData(summary);
      if (meta) setSyncMeta(meta);

      const cachePayload = { timetable: data, summary, meta };
      
      setCache(prevCache => ({ ...prevCache, [sec]: cachePayload }));
      localStorage.setItem(localKey, JSON.stringify(cachePayload));

    } catch (err) {
      if (shouldShowLoader) {
        if (err.response?.status === 429) {
          setError('Server busy: Rate limit exceeded. Try again in a few minutes.');
        } else if (err.response?.status !== 401) {
          setError('System Error: Unable to fetch ERP data.');
        }
      }
    } finally {
      if (shouldShowLoader) {
        setLoading(false);
      }
    }
  };

  const fetchAttendance = async () => {
    trackEvent('button_click', 'fetch_attendance');

    setIsFetchingAttendance(true);
    setAttendanceError('');

    setFetchProgress({
      step: 0,
      total: 8,
      message: 'Connecting to OLT portal…',
      status: 'in_progress'
    });

    const sectionAtFetchTime = section;

    startProgressPolling();

    try {
      const token = localStorage.getItem('iimt_token');

      const res = await axios.post(
        `${API_BASE_URL}/api/attendance/fetch`,
        { term },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setAttendanceData(res.data.results);

      setAttendanceFetchedSection(
        res.data.section || sectionAtFetchTime
      );
    } catch (err) {
      setAttendanceError(
        err.response?.data?.error ||
        'Failed to fetch attendance from OLT.'
      );

      if (err.response?.data?.needsCredsReset) {
        setShowCredsForm(true);
      }
    } finally {
      setIsFetchingAttendance(false);
      stopProgressPolling();
    }
  };

  const fetchMcGrawAssignments = async () => {
    if (!mheUsername || !mhePassword || !mheSectionId) {
      setAssignmentsError('Please fill in all McGraw Hill credentials and Class Section ID.');
      return;
    }

    trackEvent('button_click', 'fetch_mcgraw_assignments');
    setIsFetchingAssignments(true);
    setAssignmentsError('');

    localStorage.setItem('iimt_mhe_user', mheUsername);
    localStorage.setItem('iimt_mhe_section', mheSectionId);

    try {
      const token = localStorage.getItem('iimt_token');
      const res = await axios.post(
        `${API_BASE_URL}/api/assignments/fetch`,
        {
          mheUsername,
          mhePassword,
          sectionId: mheSectionId
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      if (res.data && res.data.success) {
        setAssignments(res.data.data);
      } else {
        setAssignmentsError('Failed to parse assignments data.');
      }
    } catch (err) {
      setAssignmentsError(
        err.response?.data?.error ||
        'Error scraping assignments. Please check your credentials and Section ID.'
      );
    } finally {
      setIsFetchingAssignments(false);
    }
  };

  const saveCredentials = async (username, password) => {
    try {
      const token = localStorage.getItem('iimt_token');

      await axios.post(
        `${API_BASE_URL}/api/user/olt-credentials`,
        { username, password },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setHasOltCreds(true);
      setShowCredsForm(false);

      fetchAttendance();
    } catch (err) {
      alert('Failed to securely save credentials.');
    }
  };

  const handleSyncData = () => {
    trackEvent('button_click', 'manual_sync_timetable');

    setCache({});
    SECTIONS.forEach(s => localStorage.removeItem(`iimt_timetable_cache_${s}`));
    
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

      await axios.post(
        `${API_BASE_URL}/api/feedback`,
        { message: feedbackText },
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      setFeedbackStatus('Sent! Thank you.');

      setTimeout(() => {
        setShowFeedbackModal(false);
        setFeedbackText('');
        setFeedbackStatus('');
        setIsSubmitting(false);
      }, 2000);
    } catch (error) {
      setIsSubmitting(false);

      if (error.response?.status === 429) {
        setFeedbackStatus('Rate limited. Please wait.');
      } else {
        setFeedbackStatus('Failed to send.');
      }
    }
  };

  const saveSectionSetting = () => {
    trackEvent(
      'action',
      'save_section_setting',
      { section: settingsSectionDraft }
    );

    setSettingsStatus('Saved!');
    setSection(settingsSectionDraft);

    setTimeout(() => {
      setShowSettingsModal(false);
      setSettingsStatus('');
    }, 700);
  };

  const currentDayData = scheduleData.find(
    d => d.isoDate === selectedDate
  );

  const formatHeaderDate = (isoDate, dayString) => {
    if (!isoDate) return 'Timetable';

    const dateObj = new Date(isoDate);

    const formatted = dateObj.toLocaleDateString(
      'en-GB',
      {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }
    );

    return `${dayString}, ${formatted}`;
  };

  const formatClockTime = (ts) => {
    if (!ts) return '--:--';

    return new Date(ts).toLocaleTimeString(
      'en-IN',
      {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata'
      }
    ).toUpperCase();
  };

  const minutesToNextRefresh = () => {
    if (!syncMeta.nextRefreshTime) return null;

    const diffMs =
      syncMeta.nextRefreshTime - nowTick;

    return Math.max(
      0,
      Math.ceil(diffMs / 60000)
    );
  };

  const shiftIsoDate = (isoDate, days) => {
    const d = new Date(`${isoDate}T00:00:00`);

    d.setDate(d.getDate() + days);

    return d.toLocaleDateString('en-CA');
  };

  const goToDay = (direction) => {
    if (!selectedDate) return;

    trackEvent(
      'action',
      `swipe_day_${direction}`
    );

    const delta =
      direction === 'next' ? 1 : -1;

    const newDate =
      shiftIsoDate(selectedDate, delta);

    if (
      direction === 'next' &&
      maxDate &&
      newDate > maxDate
    ) {
      return;
    }

    if (
      direction === 'prev' &&
      minDate &&
      newDate < minDate
    ) {
      return;
    }

    setDaySwipeAnim(
      direction === 'next'
        ? 'swipe-left'
        : 'swipe-right'
    );

    setSelectedDate(newDate);
  };

  const handleTouchStart = (e) => {
    touchStartX.current =
      e.touches[0].clientX;

    touchStartY.current =
      e.touches[0].clientY;

    setIsDragging(true);
    setDragX(0);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;

    const deltaX =
      e.touches[0].clientX -
      touchStartX.current;

    const deltaY =
      e.touches[0].clientY -
      touchStartY.current;

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      let resistance = 0.45;

      if (
        deltaX < 0 &&
        (!maxDate || selectedDate >= maxDate)
      ) {
        resistance = 0.08;
      }

      if (
        deltaX > 0 &&
        (!minDate || selectedDate <= minDate)
      ) {
        resistance = 0.08;
      }

      setDragX(
        deltaX * resistance
      );
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);

    if (
      Math.abs(dragX) >
      SWIPE_THRESHOLD
    ) {
      goToDay(
        dragX < 0
          ? 'next'
          : 'prev'
      );
    }

    setDragX(0);
  };

  const hasTasksToday =
    todos[selectedDate]?.[section] &&
    Object.keys(
      todos[selectedDate][section]
    ).length > 0;

  const injectedStyles = getInjectedStyles(hasTasksToday);

  if (window.location.pathname === '/admin') {
    return <AdminPortal injectedStyles={injectedStyles} />;
  }

  if (!user) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <div
          className="login-wrapper"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: 'var(--bg-primary)'
          }}
        >
          <div
            className="login-card"
            style={{
              padding: '3rem',
              background: '#fff',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              textAlign: 'center',
              minWidth: '320px'
            }}
          >
            <h1
              style={{
                color: 'var(--accent-gold)',
                marginBottom: '0.5rem'
              }}
            >
              IIM Trichy
            </h1>

            <p
              style={{
                color: 'var(--text-secondary)',
                marginBottom: '2rem'
              }}
            >
              PGPM Term-II Portal
            </p>

            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setAuthError('Google Login Failed')}
              useOneTap
            />

            {authError && (
              <div
                style={{
                  color: 'var(--color-cancelled)',
                  marginTop: '1rem',
                  fontSize: '0.9rem',
                  fontWeight: 'bold'
                }}
              >
                {authError}
              </div>
            )}

            <p
              style={{
                marginTop: '1.5rem',
                fontSize: '0.8rem',
                color: 'var(--text-secondary)'
              }}
            >
              *Requires @iimtrichy.ac.in email address
            </p>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  const dragStyle = {
    transform: `translateX(${dragX}px) scale(${1 - Math.abs(dragX) / 3000})`,
    opacity: 1 - Math.abs(dragX) / 500,
    transition: isDragging
      ? 'none'
      : 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  const nextRefreshMins = minutesToNextRefresh();

  return (
    <>
      <style>{injectedStyles}</style>

      {/* --- LIVE ATTENDANCE POPUP FOR NEW USERS --- */}
      {showOltPopup && (
        <div className="modal-overlay">
          <div className="modal-content olt-glow-modal">
            <ClipboardCheck
              size={48}
              color="var(--accent-gold)"
              style={{ margin: '0 auto' }}
            />

            <h3>
              Unlock Live Attendance
            </h3>

            <p
              style={{
                fontSize: '0.95rem',
                color: '#666',
                margin: '0 0 10px 0',
                lineHeight: '1.4'
              }}
            >
              You can now track your live class attendance and view detailed class-by-class status directly inside the app!
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <button
                className="btn-submit"
                onClick={() => {
                  setShowOltPopup(false);
                  handleTabChange('attendance');
                }}
              >
                Setup OLT Account Now
              </button>

              <button
                className="btn-text"
                onClick={() => {
                  setShowOltPopup(false);
                  sessionStorage.setItem(
                    'olt_popup_dismissed',
                    '1'
                  );
                  trackEvent(
                    'action',
                    'dismiss_olt_popup'
                  );
                }}
              >
                Remind me later
              </button>
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

            trackEvent(
              'button_click',
              'mobile_fab_reload'
            );

            setTimeout(
              () => window.location.reload(),
              150
            );
          }}
        >
          <RefreshCw
            size={22}
            className={
              isReloading
                ? 'spinning'
                : ''
            }
          />
        </button>
      )}

      {showIOSPrompt && (
        <div
          className="modal-overlay"
          onClick={() =>
            setShowIOSPrompt(false)
          }
        >
          <div
            className="modal-content"
            onClick={e =>
              e.stopPropagation()
            }
          >
            <h3 style={{ margin: 0 }}>
              Install on iOS
            </h3>

            <p
              style={{
                fontSize: '0.95rem',
                color: '#666',
                margin: '10px 0',
                lineHeight: '1.5'
              }}
            >
              To install this app on your iPhone or iPad:
              <br />
              <br />
              1. Tap the <strong>Share</strong> button{' '}
              <Share
                size={16}
                style={{
                  display: 'inline',
                  verticalAlign: 'middle',
                  margin: '0 2px'
                }}
              />{' '}
              at the bottom of Safari.
              <br />
              2. Scroll down and select{' '}
              <strong>"Add to Home Screen"</strong>.
            </p>

            <div className="modal-actions">
              <button
                className="btn-submit"
                onClick={() =>
                  setShowIOSPrompt(false)
                }
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {showFeedbackModal && (
        <div
          className="modal-overlay"
          onClick={() =>
            !isSubmitting &&
            setShowFeedbackModal(false)
          }
        >
          <div
            className="modal-content"
            onClick={e =>
              e.stopPropagation()
            }
          >
            <h3 style={{ margin: 0 }}>
              Submit Feedback
            </h3>

            <p
              style={{
                fontSize: '0.9rem',
                color: '#666',
                margin: 0
              }}
            >
              Report an issue or suggest a feature.
            </p>

            <textarea
              placeholder="Type your message here... (max 1000 chars)"
              maxLength={1000}
              value={feedbackText}
              onChange={e =>
                setFeedbackText(
                  e.target.value
                )
              }
              disabled={isSubmitting}
            />

            {feedbackStatus && (
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent-gold)'
                }}
              >
                {feedbackStatus}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-cancel"
                disabled={isSubmitting}
                onClick={() =>
                  setShowFeedbackModal(false)
                }
              >
                Cancel
              </button>

              <button
                className="btn-submit"
                disabled={
                  isSubmitting ||
                  !feedbackText.trim()
                }
                onClick={submitFeedback}
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettingsModal && (
        <div
          className="modal-overlay"
          onClick={() =>
            setShowSettingsModal(false)
          }
        >
          <div
            className="modal-content"
            onClick={e =>
              e.stopPropagation()
            }
          >
            <h3 style={{ margin: 0 }}>
              Settings
            </h3>

            <p
              style={{
                fontSize: '0.9rem',
                color: '#666',
                margin: 0
              }}
            >
              Choose your section. This is saved to your account and remembered next time you log in.
            </p>

            <div className="settings-section-grid">
              {SECTIONS.map(sec => (
                <button
                  key={sec}
                  className={`settings-section-btn ${
                    settingsSectionDraft === sec
                      ? 'active'
                      : ''
                  }`}
                  onClick={() =>
                    setSettingsSectionDraft(sec)
                  }
                >
                  {sec}
                </button>
              ))}
            </div>

            {settingsStatus && (
              <div className="settings-status-text">
                {settingsStatus}
              </div>
            )}

            <div className="modal-actions">
              <button
                className="btn-cancel"
                onClick={() =>
                  setShowSettingsModal(false)
                }
              >
                Cancel
              </button>

              <button
                className="btn-submit"
                onClick={saveSectionSetting}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <TodoModal
        isOpen={!!activeTodoClass}
        onClose={() =>
          setActiveTodoClass(null)
        }
        activeClass={activeTodoClass}
        todos={todos}
        onUpdate={handleUpdateTodos}
      />

      {showSwipeHint && (
        <div
          className="swipe-tutorial-overlay"
          onClick={dismissSwipeHint}
          onTouchStart={dismissSwipeHint}
          role="button"
        >
          <div className="swipe-tutorial-card">
            <div className="swipe-tutorial-track">
              <Hand
                size={40}
                className="swipe-tutorial-hand"
                strokeWidth={1.75}
              />
            </div>

            <div className="swipe-tutorial-text">
              Swipe left or right to change day
            </div>

            <div className="swipe-tutorial-dismiss">
              Tap anywhere to dismiss
            </div>
          </div>
        </div>
      )}

      <div className="dashboard-layout">
        <div className="mobile-topbar">
          <button
            type="button"
            className={`mobile-profile-trigger ${showMobileMenu ? 'open' : ''}`}
            onClick={() => setShowMobileMenu(prev => !prev)}
            aria-label="Profile and section selector"
            aria-expanded={showMobileMenu}
          >
            <img
              className="mobile-profile-avatar"
              src={user.picture || getFallbackAvatar(user.name)}
              alt="Profile"
              onError={e => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = getFallbackAvatar(user.name);
              }}
            />

            <span className="mobile-profile-copy">
              <span className="mobile-profile-name">{user.name}</span>
              <span className="mobile-profile-section">Section {section}</span>
            </span>

            <ChevronDown size={18} className="mobile-profile-chevron" />
          </button>

          <button
            type="button"
            className="mobile-settings-btn"
            onClick={() => {
              setSettingsSectionDraft(section);
              setShowSettingsModal(true);
              setShowMobileMenu(false);
              trackEvent('button_click', 'open_settings');
            }}
            aria-label="Open settings"
          >
            <Settings size={19} />
          </button>

          {showMobileMenu && (
            <div className="mobile-profile-menu">
              <div className="mobile-profile-menu-title">
                Select Section
              </div>

              <div className="mobile-section-grid">
                {SECTIONS.map(sec => (
                  <button
                    key={sec}
                    type="button"
                    className={`mobile-section-btn ${section === sec ? 'active' : ''}`}
                    onClick={() => {
                      setSection(sec);
                      setShowMobileMenu(false);
                      trackEvent('action', 'change_section', { to: sec });
                    }}
                  >
                    {sec}
                  </button>
                ))}
              </div>

              <div className="mobile-profile-menu-divider" />

              <div className="mobile-profile-actions">
                <button
                  type="button"
                  className="mobile-profile-action"
                  onClick={() => {
                    setSettingsSectionDraft(section);
                    setShowSettingsModal(true);
                    setShowMobileMenu(false);
                    trackEvent('button_click', 'open_settings');
                  }}
                >
                  <Settings size={16} />
                  Settings
                </button>

                <button
                  type="button"
                  className="mobile-profile-action"
                  onClick={() => {
                    setShowFeedbackModal(true);
                    setShowMobileMenu(false);
                    trackEvent('button_click', 'open_feedback');
                  }}
                >
                  <MessageSquare size={16} />
                  Feedback
                </button>

                <button
                  type="button"
                  className="mobile-profile-action"
                  onClick={() => {
                    if (isInstallable) {
                      handleInstallClick();
                      setShowMobileMenu(false);
                    }
                  }}
                  disabled={!isInstallable}
                  style={!isInstallable ? { opacity: 0.45, cursor: 'default' } : undefined}
                >
                  <Download size={16} />
                  Install
                </button>

                <button
                  type="button"
                  className="mobile-profile-action danger"
                  onClick={() => {
                    setShowMobileMenu(false);
                    handleLogout();
                  }}
                >
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="sidebar">
          <div className="brand-title">
            IIM Trichy
          </div>

          <div className="brand-subtitle">
            PGPM Term-II
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '1rem',
              marginTop: '1rem',
              background:
                'rgba(255,255,255,0.05)',
              borderRadius: '8px'
            }}
          >
            <img
              src={
                user.picture ||
                getFallbackAvatar(user.name)
              }
              alt="Profile"
              onError={e => {
                e.target.onerror = null;
                e.target.src =
                  getFallbackAvatar(
                    user.name
                  );
              }}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                objectFit: 'cover'
              }}
            />

            <div
              style={{
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis'
                }}
              >
                {user.name}
              </div>
            </div>
          </div>

          <div className="nav-menu">
            <button
              className={`nav-btn ${
                activeTab === 'timetable'
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                handleTabChange('timetable')
              }
            >
              <Calendar size={18} />
              Timetable
            </button>

            <button
              className={`nav-btn ${
                activeTab === 'assignments'
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                handleTabChange('assignments')
              }
            >
              <BookOpen size={18} />
              Assignments
            </button>

            <button
              className={`nav-btn ${
                activeTab === 'summary'
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                handleTabChange('summary')
              }
            >
              <Table2 size={18} />
              Summary Table
            </button>

            <button
              className={`nav-btn ${
                activeTab === 'attendance'
                  ? 'active'
                  : ''
              }`}
              onClick={() =>
                handleTabChange(
                  'attendance'
                )
              }
            >
              <ClipboardCheck size={18} />
              Attendance

              {(
                !hasOltCreds &&
                !sessionStorage.getItem(
                  'olt_popup_dismissed'
                )
              ) && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: 'red',
                    borderRadius: '50%',
                    marginLeft: '5px'
                  }}
                />
              )}
            </button>
          </div>

          {activeTab !== 'attendance' && activeTab !== 'assignments' && (
            <div className="section-selector-container">
              <span className="section-label">
                Select Section
              </span>

              <div className="sec-grid">
                {SECTIONS.map(sec => (
                  <button
                    key={sec}
                    className={`section-btn ${
                      section === sec
                        ? 'active'
                        : ''
                    }`}
                    onClick={() => {
                      setSection(sec);

                      trackEvent(
                        'action',
                        'change_section',
                        { to: sec }
                      );
                    }}
                  >
                    {sec}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: 'auto',
              paddingTop: '2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            {isInstallable && (
              <button
                onClick={handleInstallClick}
                className="nav-btn"
                style={{
                  width: '100%',
                  color: 'var(--accent-gold)',
                  fontWeight: 'bold'
                }}
              >
                <Download size={18} />
                Install App
              </button>
            )}

            <button
              onClick={() => {
                setSettingsSectionDraft(
                  section
                );
                setShowSettingsModal(true);
                trackEvent(
                  'button_click',
                  'open_settings'
                );
              }}
              className="nav-btn"
              style={{
                width: '100%',
                color: 'var(--text-secondary)'
              }}
            >
              <Settings size={18} />
              Settings
            </button>

            <button
              onClick={() => {
                setShowFeedbackModal(true);
                trackEvent(
                  'button_click',
                  'open_feedback'
                );
              }}
              className="nav-btn"
              style={{
                width: '100%',
                color: 'var(--text-secondary)'
              }}
            >
              <MessageSquare size={18} />
              Provide Feedback
            </button>

            {activeTab === 'timetable' && (
              <button
                onClick={handleSyncData}
                className="nav-btn desktop-only"
                style={{
                  width: '100%',
                  color: 'var(--text-secondary)'
                }}
                disabled={loading}
              >
                <RefreshCw size={18} />
                {loading
                  ? 'Syncing...'
                  : 'Sync Data'}
              </button>
            )}

            <button
              onClick={handleLogout}
              className="nav-btn"
              style={{
                width: '100%',
                color: 'var(--color-cancelled)'
              }}
            >
              <LogOut size={18} />
              Sign Out
            </button>
          </div>
        </aside>

        <main className="main-content">
          {loading && (
            <div className="satisfying-loader-container">
              <div className="dot-wave">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
              </div>

              <div className="loading-text">
                Connecting to database...
              </div>
            </div>
          )}

          {error && (
            <div
              className="empty-state"
              style={{ color: '#eb3223' }}
            >
              {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* --- 5-DAY FEATURE BANNER --- */}
              {showFeatureBanner &&
                activeTab !== 'attendance' && (
                  <div className="feature-banner fade-in">
                    <div className="feature-banner-header">
                      <h3 className="feature-banner-title">
                        <Sparkles
                          size={18}
                          fill="currentColor"
                        />
                        New: Live OLT Attendance
                      </h3>

                      <button
                        className="btn-banner-close"
                        onClick={
                          dismissFeatureBanner
                        }
                        aria-label="Close"
                      >
                        <X size={18} />
                      </button>
                    </div>

                    <p className="feature-banner-text">
                      You can now track your live class attendance and view detailed class-by-class status directly from the OLT portal!
                    </p>

                    <div className="feature-banner-actions">
                      <button
                        className="btn-banner-primary"
                        onClick={() =>
                          handleTabChange(
                            'attendance'
                          )
                        }
                      >
                        <ClipboardCheck size={16} />
                        Check it out
                      </button>

                      <button
                        className="btn-banner-secondary"
                        onClick={
                          handleShareApp
                        }
                      >
                        <Share size={16} />
                        Share App
                      </button>

                      <button
                        className="btn-banner-secondary"
                        onClick={() => {
                          setShowFeedbackModal(
                            true
                          );

                          trackEvent(
                            'button_click',
                            'banner_feedback'
                          );
                        }}
                      >
                        <MessageSquare size={16} />
                        Give Feedback
                      </button>
                    </div>
                  </div>
                )}

              {activeTab === 'assignments' && (
                <AssignmentsTab
                  mheUsername={mheUsername}
                  setMheUsername={setMheUsername}
                  mhePassword={mhePassword}
                  setMhePassword={setMhePassword}
                  mheSectionId={mheSectionId}
                  setMheSectionId={setMheSectionId}
                  assignments={assignments}
                  assignmentsError={assignmentsError}
                  isFetchingAssignments={isFetchingAssignments}
                  fetchMcGrawAssignments={fetchMcGrawAssignments}
                />
              )}

              {activeTab === 'attendance' && (
                <AttendanceTab
                  hasOltCreds={hasOltCreds}
                  showCredsForm={showCredsForm}
                  setShowCredsForm={setShowCredsForm}
                  saveCredentials={saveCredentials}
                  attendanceData={attendanceData}
                  setAttendanceData={setAttendanceData}
                  attendanceError={attendanceError}
                  attendanceFetchedSection={attendanceFetchedSection}
                  isFetchingAttendance={isFetchingAttendance}
                  fetchAttendance={fetchAttendance}
                  fetchProgress={fetchProgress}
                  expandedSubject={expandedSubject}
                  setExpandedSubject={setExpandedSubject}
                  term={term}
                  setTerm={setTerm}
                  section={section}
                  setSettingsSectionDraft={setSettingsSectionDraft}
                  setShowSettingsModal={setShowSettingsModal}
                />
              )}

              {activeTab === 'timetable' && (
                <>
                  <div className="live-data-banner">
                    <span className="live-data-dot" />

                    <span>
                      <strong>
                        Live data
                      </strong>{' '}
                      synced directly from Excel, no need to refresh manually.
                    </span>

                    <span className="live-data-meta">
                      {loading ? (
                        'Syncing live data...'
                      ) : syncMeta.lastFetchTime ? (
                        <>
                          Last synced {formatClockTime(syncMeta.lastFetchTime)} IST
                          {nextRefreshMins !== null && (
                            <> &middot; Next auto-sync in ~{nextRefreshMins} min (at {formatClockTime(syncMeta.nextRefreshTime)} IST)</>
                          )}
                        </>
                      ) : (
                        'Waiting for sync...'
                      )}
                    </span>
                  </div>

                  <div className="top-toolbar">
                    <h2 className="view-title">
                      {currentDayData
                        ? formatHeaderDate(
                            currentDayData.isoDate,
                            currentDayData.day
                          )
                        : formatHeaderDate(
                            selectedDate,
                            new Date(
                              selectedDate
                            ).toLocaleDateString(
                              'en-US',
                              {
                                weekday:
                                  'short'
                              }
                            )
                          )}
                    </h2>

                    <div className="legend">
                      <div className="legend-item">
                        <div
                          className="legend-color"
                          style={{
                            background:
                              'var(--color-makeup)'
                          }}
                        ></div>
                        Make-up
                      </div>

                      <div className="legend-item">
                        <div
                          className="legend-color"
                          style={{
                            background:
                              'var(--color-cancelled)'
                          }}
                        ></div>
                        Cancelled
                      </div>
                    </div>

                    <div className="date-picker-group">
                      <button
                        onClick={
                          handleResetDate
                        }
                        className="nav-btn"
                        style={{
                          padding: '0.6rem',
                          border:
                            '1px solid var(--border-color)',
                          margin: '0'
                        }}
                        title="Snap back to Today"
                      >
                        <CalendarSync
                          size={18}
                          color="var(--accent-gold)"
                        />
                      </button>

                      <input
                        type="date"
                        className="date-input"
                        value={selectedDate}
                        min={minDate}
                        max={maxDate}
                        onChange={e => {
                          setDaySwipeAnim(
                            'fade-in'
                          );

                          setSelectedDate(
                            e.target.value
                          );

                          trackEvent(
                            'action',
                            'pick_date'
                          );
                        }}
                        disabled={!minDate}
                      />
                    </div>
                  </div>

                  <div className="mobile-swipe-hint">
                    <ChevronLeft size={14} />
                    Swipe to change day
                    <ChevronRight size={14} />
                  </div>

                  <section
                    className="timetable-section"
                    onTouchStart={
                      handleTouchStart
                    }
                    onTouchMove={
                      handleTouchMove
                    }
                    onTouchEnd={
                      handleTouchEnd
                    }
                  >
                    <div
                      key={selectedDate}
                      className={`day-anim-wrapper ${
                        daySwipeAnim || ''
                      }`}
                      onAnimationEnd={() =>
                        setDaySwipeAnim(null)
                      }
                    >
                      <div
                        className="day-drag-surface"
                        style={dragStyle}
                      >
                        {!currentDayData &&
                          selectedDate && (
                            <div className="empty-state">
                              No classes scheduled for{' '}
                              {formatHeaderDate(
                                selectedDate,
                                new Date(
                                  selectedDate
                                ).toLocaleDateString(
                                  'en-US',
                                  {
                                    weekday:
                                      'short'
                                  }
                                )
                              )}
                              . Enjoy your day!
                            </div>
                          )}

                        {currentDayData &&
                          currentDayData.classes.map(
                            (cls, idx) => {
                              const cardStyle =
                                cls.color
                                  ? {
                                      borderLeftColor:
                                        cls.color,
                                      backgroundColor:
                                        `${cls.color}10`
                                    }
                                  : {};

                              const hasTodos =
                                todos[
                                  selectedDate
                                ]?.[section]?.[
                                  cls.subject
                                ]?.length > 0;

                              const isRemark =
                                cls.time
                                  ?.toLowerCase()
                                  .includes(
                                    'remarks'
                                  );

                              return (
                                <div
                                  key={idx}
                                  className="class-card"
                                  style={
                                    cardStyle
                                  }
                                >
                                  {cls.status && (
                                    <div
                                      className="status-pill"
                                      style={{
                                        backgroundColor:
                                          cls.color
                                      }}
                                    >
                                      {cls.status}
                                    </div>
                                  )}

                                  <div className="class-header-flex">
                                    <div
                                      className="time-badge"
                                      style={{
                                        color:
                                          cls.color ||
                                          'var(--text-secondary)'
                                      }}
                                    >
                                      {cls.time.includes(
                                        'Remarks'
                                      ) ? (
                                        <Info
                                          size={18}
                                        />
                                      ) : (
                                        <Clock
                                          size={18}
                                        />
                                      )}

                                      <span>
                                        {cls.time}
                                      </span>
                                    </div>

                                    <button
                                      className="add-task-btn"
                                      onClick={() => {
                                        setActiveTodoClass(
                                          {
                                            subject:
                                              cls.subject,
                                            date:
                                              selectedDate,
                                            section
                                          }
                                        );

                                        trackEvent(
                                          'button_click',
                                          'open_todo_modal'
                                        );
                                      }}
                                    >
                                      <ListTodo
                                        size={16}
                                      />

                                      {hasTodos && (
                                        <span className="task-indicator" />
                                      )}
                                    </button>
                                  </div>

                                  <div className="class-details">
                                    <div className="subject-name">
                                      {cls.subject}
                                    </div>

                                    {cls.prof && (
                                      <div
                                        className="prof-badge"
                                        style={
                                          cls.color
                                            ? {
                                                color:
                                                  cls.color,
                                                borderColor:
                                                  `${cls.color}50`
                                              }
                                            : {}
                                        }
                                      >
                                        <UserIcon
                                          size={14}
                                        />
                                        {cls.prof}
                                      </div>
                                    )}

                                    {!isRemark &&
                                      cls.sessionNumber && (
                                        <div className="session-badge">
                                          Session{' '}
                                          {
                                            cls.sessionNumber
                                          }
                                        </div>
                                      )}
                                  </div>
                                </div>
                              );
                            }
                          )}
                      </div>
                    </div>
                  </section>

                  <TodoSummaryBar
                    date={selectedDate}
                    section={section}
                    todos={todos}
                    onOpenClass={subject =>
                      setActiveTodoClass({
                        subject,
                        date: selectedDate,
                        section
                      })
                    }
                  />
                </>
              )}

              {activeTab === 'summary' && (
                <>
                  <div className="top-toolbar">
                    <h2 className="view-title">
                      Section {section}{' '}
                      Academic Overview
                    </h2>
                  </div>

                  {summaryData.headers.length >
                  0 ? (
                    <div
                      className="table-container"
                      style={{
                        overflowX: 'auto'
                      }}
                    >
                      <table
                        className="erp-table"
                        style={{
                          minWidth: '900px'
                        }}
                      >
                        <thead>
                          <tr>
                            {summaryData.headers.map(
                              (header, idx) => (
                                <th key={idx}>
                                  {header}
                                </th>
                              )
                            )}
                          </tr>
                        </thead>

                        <tbody>
                          {summaryData.rows.map(
                            (row, rowIdx) => (
                              <tr key={rowIdx}>
                                {row.map(
                                  (
                                    cell,
                                    cellIdx
                                  ) => (
                                    <td
                                      key={
                                        cellIdx
                                      }
                                    >
                                      {cellIdx ===
                                      0 ? (
                                        <strong>
                                          {cell}
                                        </strong>
                                      ) : (
                                        cell
                                      )}
                                    </td>
                                  )
                                )}
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty-state">
                      No summary data available.
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>

        {/* --- MOBILE BOTTOM NAVIGATION --- */}
        <nav
          className="mobile-bottom-nav"
          aria-label="Primary navigation"
        >
          <button
            type="button"
            className={`mobile-bottom-nav-btn ${
              activeTab === 'timetable'
                ? 'active'
                : ''
            }`}
            onClick={() =>
              handleTabChange('timetable')
            }
            aria-label="Timetable"
            aria-current={
              activeTab === 'timetable'
                ? 'page'
                : undefined
            }
          >
            <Calendar size={24} />
            <span>Timetable</span>
          </button>

          <button
            type="button"
            className={`mobile-bottom-nav-btn ${
              activeTab === 'assignments'
                ? 'active'
                : ''
            }`}
            onClick={() =>
              handleTabChange('assignments')
            }
            aria-label="Assignments"
            aria-current={
              activeTab === 'assignments'
                ? 'page'
                : undefined
            }
          >
            <BookOpen size={24} />
            <span>Assign</span>
          </button>

          <button
            type="button"
            className={`mobile-bottom-nav-btn ${
              activeTab === 'summary'
                ? 'active'
                : ''
            }`}
            onClick={() =>
              handleTabChange('summary')
            }
            aria-label="Summary"
            aria-current={
              activeTab === 'summary'
                ? 'page'
                : undefined
            }
          >
            <Table2 size={24} />
            <span>Summary</span>
          </button>

          <button
            type="button"
            className={`mobile-bottom-nav-btn ${
              activeTab === 'attendance'
                ? 'active'
                : ''
            }`}
            onClick={() =>
              handleTabChange(
                'attendance'
              )
            }
            aria-label="Attendance"
            aria-current={
              activeTab === 'attendance'
                ? 'page'
                : undefined
            }
          >
            <ClipboardCheck size={24} />
            <span>Attendance</span>

            {(
              !hasOltCreds &&
              !sessionStorage.getItem(
                'olt_popup_dismissed'
              )
            ) && (
              <span
                className="mobile-bottom-nav-badge"
                aria-hidden="true"
              />
            )}
          </button>
        </nav>
      </div>

      <Analytics />
    </>
  );
}

export default App;

