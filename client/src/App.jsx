import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import { Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, RefreshCw, ChevronLeft, ChevronRight, Hand } from 'lucide-react';
import './App.css';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// REPLACE THIS STRING WITH YOUR ACTUAL GOOGLE CLIENT ID
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

// Handles dynamic routing for local dev vs Vercel Production
const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'https://your-render-backend-url.onrender.com';
// const API_BASE_URL = "http://localhost:5000"
// Minimum horizontal finger travel (px) before a touch gesture counts as a swipe
const SWIPE_THRESHOLD = 40;

// How many times (across sessions/logins) the swipe tutorial should be shown
const SWIPE_HINT_MAX_SHOWS = 3;
const SWIPE_HINT_STORAGE_KEY = 'iimt_swipe_hint_shown_count';
const SWIPE_HINT_AUTO_DISMISS_MS = 3200;

function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('timetable');
  const [section, setSection] = useState('A');

  const [cache, setCache] = useState({});

  const [scheduleData, setScheduleData] = useState([]);
  const [summaryData, setSummaryData] = useState({ headers: [], rows: [] });

  const [selectedDate, setSelectedDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [maxDate, setMaxDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // --- SWIPE NAVIGATION & ANIMATION STATE ---
  const [daySwipeAnim, setDaySwipeAnim] = useState('fade-in');
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  // --- SWIPE TUTORIAL (first 3 logins) ---
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hintHandledThisSession = useRef(false);
  const hintDismissTimer = useRef(null);

  const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const getFallbackAvatar = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('iimt_user');
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  useEffect(() => {
    if (user) fetchTimetable(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, user]);

  // Show the swipe tutorial the first 3 times the user logs in / opens the app
  useEffect(() => {
    if (!user || hintHandledThisSession.current) return;
    hintHandledThisSession.current = true;

    const shownCount = parseInt(localStorage.getItem(SWIPE_HINT_STORAGE_KEY) || '0', 10);

    if (shownCount < SWIPE_HINT_MAX_SHOWS) {
      localStorage.setItem(SWIPE_HINT_STORAGE_KEY, String(shownCount + 1));
      // Small delay so it appears after the dashboard has settled in, not mid-transition
      const openTimer = setTimeout(() => {
        setShowSwipeHint(true);
        hintDismissTimer.current = setTimeout(() => setShowSwipeHint(false), SWIPE_HINT_AUTO_DISMISS_MS);
      }, 400);
      return () => clearTimeout(openTimer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    return () => {
      if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current);
    };
  }, []);

  const dismissSwipeHint = () => {
    if (hintDismissTimer.current) clearTimeout(hintDismissTimer.current);
    setShowSwipeHint(false);
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setAuthError('');
      const res = await axios.post(`${API_BASE_URL}/api/auth/google`, {
        token: credentialResponse.credential
      });

      const loggedInUser = res.data.user;
      setUser(loggedInUser);
      localStorage.setItem('iimt_user', JSON.stringify(loggedInUser));
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Authentication failed. Please try again.');
    }
  };

  const handleLogout = () => {
    googleLogout();
    setUser(null);
    localStorage.removeItem('iimt_user');
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

  const fetchTimetable = async (sec, forceSync = false) => {
    if (!forceSync && cache[sec]) {
      setScheduleData(cache[sec].timetable);
      setSummaryData(cache[sec].summary);
      applyDateLogic(cache[sec].timetable);
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await axios.get(`${API_BASE_URL}/api/timetable/${sec}?force=${forceSync}`);
      const data = res.data.timetable;
      const summary = res.data.summary;

      setScheduleData(data);
      setSummaryData(summary);
      applyDateLogic(data);

      setCache(prevCache => ({
        ...prevCache,
        [sec]: { timetable: data, summary: summary }
      }));

    } catch (err) {
      console.error(err);
      setError('System Error: Unable to fetch ERP data.');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncData = () => {
    setCache({});
    fetchTimetable(section, true);
  };

  const handleResetDate = () => {
    setDaySwipeAnim('fade-in');
    setSelectedDate(getTodayIST());
  };

  const currentDayData = scheduleData.find(d => d.isoDate === selectedDate);

  const formatHeaderDate = (isoDate, dayString) => {
    if (!isoDate) return 'Timetable';
    const dateObj = new Date(isoDate);
    const formatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${dayString}, ${formatted}`;
  };

  // --- SWIPE GESTURE HANDLERS ---
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

    // Only activate drag tracking if the swipe is mostly horizontal
    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      // 0.45 adds a physical "weight" to the drag
      let resistance = 0.45;

      // Add extreme heavy rubber-banding if dragging past available calendar dates
      if (deltaX < 0 && (!maxDate || selectedDate >= maxDate)) resistance = 0.08;
      if (deltaX > 0 && (!minDate || selectedDate <= minDate)) resistance = 0.08;

      setDragX(deltaX * resistance);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);

    if (Math.abs(dragX) > SWIPE_THRESHOLD) {
      goToDay(dragX < 0 ? 'next' : 'prev');
    }

    // Snaps back to 0. If date changed, React remounts the inner div seamlessly.
    setDragX(0);
  };

  // CSS injection to handle responsive layout and premium animations
  const injectedStyles = `
    /* --- MOBILE RESPONSIVENESS FIXES --- */
    @media (max-width: 768px) {
      .dashboard-layout {
        min-height: 100dvh;
      }
      .main-content {
        padding-bottom: 120px !important;
      }
      .timetable-section {
        padding-bottom: env(safe-area-inset-bottom, 40px);
      }
      .mobile-swipe-hint {
        display: flex !important;
      }
      .swipe-tutorial-overlay {
        display: flex !important;
      }
    }

    /* --- SATISFYING LOADER ANIMATION --- */
    .satisfying-loader-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 60vh;
      gap: 1.5rem;
      width: 100%;
    }
    .dot-wave { display: flex; gap: 12px; }
    .dot-wave .dot {
      width: 16px; height: 16px; border-radius: 50%;
      background-color: var(--accent-gold, #dba315);
      animation: smooth-wave 1.4s ease-in-out infinite;
      box-shadow: 0 4px 10px rgba(219, 163, 21, 0.3);
    }
    .dot-wave .dot:nth-child(1) { animation-delay: 0s; }
    .dot-wave .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot-wave .dot:nth-child(3) { animation-delay: 0.3s; }

    @keyframes smooth-wave {
      0%, 100% { transform: translateY(0) scale(0.8); opacity: 0.3; }
      50% { transform: translateY(-14px) scale(1.1); opacity: 1; }
    }

    .loading-text {
      color: var(--text-secondary, #888); font-size: 1.05rem; font-weight: 500;
      letter-spacing: 0.5px; animation: pulse-text 2s ease-in-out infinite;
    }
    @keyframes pulse-text {
      0%, 100% { opacity: 0.5; } 50% { opacity: 1; }
    }

    /* --- PREMIUM SWIPE NAVIGATION (Mobile Only) --- */
    .mobile-swipe-hint {
      display: none;
      align-items: center; justify-content: center; gap: 6px;
      color: var(--text-secondary, #888); font-size: 0.78rem;
      opacity: 0.65; margin: 0 0 0.75rem 0; user-select: none;
    }

    .timetable-section {
      touch-action: pan-y; /* Crucial: Allows vertical scroll while capturing horizontal swipes */
      overflow-x: hidden;  /* Prevents scrollbar flash during animation */
    }

    .day-anim-wrapper {
      width: 100%;
      will-change: transform, opacity;
    }

    /* Custom Apple-like fluid spring curves */
    @keyframes premiumSlideInRight {
      from { transform: translateX(45px) scale(0.98); opacity: 0; }
      to   { transform: translateX(0) scale(1); opacity: 1; }
    }
    @keyframes premiumSlideInLeft {
      from { transform: translateX(-45px) scale(0.98); opacity: 0; }
      to   { transform: translateX(0) scale(1); opacity: 1; }
    }
    @keyframes premiumFadeIn {
      from { transform: translateY(12px) scale(0.99); opacity: 0; }
      to   { transform: translateY(0) scale(1); opacity: 1; }
    }

    .swipe-left { animation: premiumSlideInRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .swipe-right { animation: premiumSlideInLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .fade-in { animation: premiumFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

    /* --- FIRST-TIME SWIPE TUTORIAL OVERLAY (mobile onboarding pattern) --- */
    .swipe-tutorial-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 15, 15, 0.6);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
      z-index: 9999;
      display: none; /* only shown on mobile, see media query above */
      align-items: center;
      justify-content: center;
      animation: tutorialOverlayFade 0.35s ease forwards;
      -webkit-tap-highlight-color: transparent;
    }
    @keyframes tutorialOverlayFade {
      from { opacity: 0; }
      to   { opacity: 1; }
    }

    .swipe-tutorial-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.1rem;
      padding: 2rem 1.5rem;
      animation: tutorialCardPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
    }
    @keyframes tutorialCardPop {
      from { opacity: 0; transform: translateY(10px) scale(0.95); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }

    .swipe-tutorial-track {
      position: relative;
      width: 130px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Faint directional guide chevrons either side of the hand */
    .swipe-tutorial-track::before,
    .swipe-tutorial-track::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 34px;
      height: 3px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-50%);
      animation: tutorialTrackPulse 1.6s ease-in-out infinite;
    }
    .swipe-tutorial-track::before { left: 0; }
    .swipe-tutorial-track::after { right: 0; animation-delay: 0.3s; }
    @keyframes tutorialTrackPulse {
      0%, 100% { opacity: 0.15; }
      50% { opacity: 0.5; }
    }

    .swipe-tutorial-hand {
      color: #fff;
      filter: drop-shadow(0 6px 14px rgba(0, 0, 0, 0.45));
      animation: tutorialHandSwipe 1.6s ease-in-out infinite;
    }
    @keyframes tutorialHandSwipe {
      0%   { transform: translateX(38px) rotate(-6deg); opacity: 0; }
      14%  { opacity: 1; }
      50%  { transform: translateX(-38px) rotate(6deg); opacity: 1; }
      68%  { opacity: 0; }
      100% { transform: translateX(38px) rotate(-6deg); opacity: 0; }
    }

    .swipe-tutorial-text {
      color: #fff;
      font-size: 0.95rem;
      font-weight: 600;
      letter-spacing: 0.2px;
      text-align: center;
    }

    .swipe-tutorial-dismiss {
      color: rgba(255, 255, 255, 0.55);
      font-size: 0.75rem;
      font-weight: 500;
      margin-top: 0.15rem;
    }
  `;

  // --- LOGIN SCREEN ---
  if (!user) {
    return (
      <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
        <div className="login-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
          <div className="login-card" style={{ padding: '3rem', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'center', minWidth: '320px' }}>
            <h1 style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem' }}>IIM Trichy</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>PGPM Term-I Portal</p>
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={() => setAuthError('Google Login Failed')}
              useOneTap
            />
            {authError && <div style={{ color: 'var(--color-cancelled)', marginTop: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>{authError}</div>}
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>*Requires @iimtrichy.ac.in email address</p>
          </div>
        </div>
      </GoogleOAuthProvider>
    );
  }

  // Calculate dynamic inline styles for the real-time finger drag tracking
  const dragStyle = {
    transform: `translateX(${dragX}px) scale(${1 - Math.abs(dragX) / 3000})`,
    opacity: 1 - Math.abs(dragX) / 500,
    // Snap back fluidly when finger is released, otherwise stick to finger 1:1 instantly
    transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
  };

  // --- MAIN DASHBOARD SCREEN ---
  return (
    <>
      <style>{injectedStyles}</style>

      {/* First-time swipe tutorial (shown for first 3 logins only, mobile only) */}
      {showSwipeHint && (
        <div
          className="swipe-tutorial-overlay"
          onClick={dismissSwipeHint}
          onTouchStart={dismissSwipeHint}
          role="button"
          aria-label="Dismiss swipe tutorial"
        >
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
              <img
                src={user.picture || getFallbackAvatar(user.name)}
                alt="Profile"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = getFallbackAvatar(user.name);
                }}
                style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div style={{ overflow: 'hidden' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{user.name}</div>
              </div>
          </div>

          <div className="nav-menu">
            <button
              className={`nav-btn ${activeTab === 'timetable' ? 'active' : ''}`}
              onClick={() => setActiveTab('timetable')}
            >
              <Calendar size={18} />
              Timetable
            </button>
            <button
              className={`nav-btn ${activeTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              <Table2 size={18} />
              Summary Table
            </button>
          </div>

          <div className="section-selector-container">
            <span className="section-label">Select Section</span>
            <div className="sec-grid">
              {SECTIONS.map((sec) => (
                <button
                  key={sec}
                  className={`section-btn ${section === sec ? 'active' : ''}`}
                  onClick={() => setSection(sec)}
                >
                  {sec}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                  onClick={handleSyncData}
                  className="nav-btn"
                  style={{ width: '100%', color: 'var(--text-secondary)' }}
                  disabled={loading}
              >
                  <RefreshCw size={18} />
                  {loading ? 'Syncing...' : 'Sync Data'}
              </button>
              <button onClick={handleLogout} className="nav-btn" style={{ width: '100%', color: 'var(--color-cancelled)' }}>
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
              <div className="loading-text">Connecting to database...</div>
            </div>
          )}

          {error && <div className="empty-state" style={{color: '#eb3223'}}>{error}</div>}

          {!loading && !error && (
            <>
              {activeTab === 'timetable' && (
                <>
                  <div className="top-toolbar">
                    <h2 className="view-title">
                      {currentDayData
                        ? formatHeaderDate(currentDayData.isoDate, currentDayData.day)
                        : formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}
                    </h2>
                    <div className="legend">
                      <div className="legend-item">
                        <div className="legend-color" style={{ background: 'var(--color-makeup)' }}></div>
                        Make-up
                      </div>
                      <div className="legend-item">
                        <div className="legend-color" style={{ background: 'var(--color-cancelled)' }}></div>
                        Cancelled
                      </div>
                    </div>
                    <div className="date-picker-group">
                      <button
                        onClick={handleResetDate}
                        className="nav-btn"
                        style={{ padding: '0.6rem', border: '1px solid var(--border-color)', margin: '0' }}
                        title="Snap back to Today"
                      >
                        <CalendarSync size={18} color="var(--accent-gold)" />
                      </button>
                      <input
                        type="date"
                        className="date-input"
                        value={selectedDate}
                        min={minDate}
                        max={maxDate}
                        onChange={(e) => {
                          setDaySwipeAnim('fade-in');
                          setSelectedDate(e.target.value);
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
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                  >
                    <div
                      key={selectedDate}
                      className={`day-anim-wrapper ${daySwipeAnim || ''}`}
                      onAnimationEnd={() => setDaySwipeAnim(null)}
                    >
                      {/* Inner drag surface handles real-time finger tracking */}
                      <div className="day-drag-surface" style={dragStyle}>
                        {!currentDayData && selectedDate && (
                          <div className="empty-state">No classes scheduled for {formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}. Enjoy your day!</div>
                        )}

                        {currentDayData && currentDayData.classes.map((cls, idx) => {
                          const cardStyle = cls.color ? {
                            borderLeftColor: cls.color,
                            backgroundColor: `${cls.color}10`
                          } : {};

                          return (
                            <div key={idx} className="class-card" style={cardStyle}>
                              {cls.status && (
                                <div className="status-pill" style={{ backgroundColor: cls.color }}>
                                  {cls.status}
                                </div>
                              )}
                              <div className="time-badge" style={{ color: cls.color || 'var(--text-secondary)'}}>
                                {cls.time.includes('Remarks') ? <Info size={18} /> : <Clock size={18} />}
                                <span>{cls.time}</span>
                              </div>
                              <div className="class-details">
                                <div className="subject-name">{cls.subject}</div>
                                {cls.prof && (
                                  <div className="prof-badge" style={cls.color ? { color: cls.color, borderColor: `${cls.color}50` } : {}}>
                                    <UserIcon size={14} />
                                    {cls.prof}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </section>
                </>
              )}

              {activeTab === 'summary' && (
                <>
                  <div className="top-toolbar">
                    <h2 className="view-title">Section {section} Academic Overview</h2>
                  </div>
                  {summaryData.headers.length > 0 ? (
                    <div className="table-container" style={{ overflowX: 'auto' }}>
                      <table className="erp-table" style={{ minWidth: '900px' }}>
                        <thead>
                          <tr>
                            {summaryData.headers.map((header, idx) => (
                              <th key={idx}>{header}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {summaryData.rows.map((row, rowIdx) => (
                            <tr key={rowIdx}>
                              {row.map((cell, cellIdx) => (
                                <td key={cellIdx}>
                                  {cellIdx === 0 ? <strong>{cell}</strong> : cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                     <div className="empty-state">No summary data available.</div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>
    </>
  );
}

export default App;

// import React, { useState, useEffect, useRef } from 'react';
// import axios from 'axios';
// import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
// import { Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
// import './App.css';

// const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// // REPLACE THIS STRING WITH YOUR ACTUAL GOOGLE CLIENT ID
// const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

// // Handles dynamic routing for local dev vs Vercel Production
// const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'https://your-render-backend-url.onrender.com';
// // const API_BASE_URL = "http://localhost:5000"
// // Minimum horizontal finger travel (px) before a touch gesture counts as a swipe
// const SWIPE_THRESHOLD = 40;

// function App() {
//   const [user, setUser] = useState(null);
//   const [authError, setAuthError] = useState('');

//   const [activeTab, setActiveTab] = useState('timetable');
//   const [section, setSection] = useState('A');

//   const [cache, setCache] = useState({});

//   const [scheduleData, setScheduleData] = useState([]);
//   const [summaryData, setSummaryData] = useState({ headers: [], rows: [] });

//   const [selectedDate, setSelectedDate] = useState('');
//   const [minDate, setMinDate] = useState('');
//   const [maxDate, setMaxDate] = useState('');

//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState('');

//   // --- SWIPE NAVIGATION & ANIMATION STATE ---
//   const [daySwipeAnim, setDaySwipeAnim] = useState('fade-in'); 
//   const [dragX, setDragX] = useState(0);
//   const [isDragging, setIsDragging] = useState(false);
  
//   const touchStartX = useRef(0);
//   const touchStartY = useRef(0);

//   const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

//   const getFallbackAvatar = (name) => {
//     return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;
//   };

//   useEffect(() => {
//     const storedUser = localStorage.getItem('iimt_user');
//     if (storedUser) setUser(JSON.parse(storedUser));
//   }, []);

//   useEffect(() => {
//     if (user) fetchTimetable(section);
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [section, user]);

//   const handleGoogleSuccess = async (credentialResponse) => {
//     try {
//       setAuthError('');
//       const res = await axios.post(`${API_BASE_URL}/api/auth/google`, {
//         token: credentialResponse.credential
//       });

//       const loggedInUser = res.data.user;
//       setUser(loggedInUser);
//       localStorage.setItem('iimt_user', JSON.stringify(loggedInUser));
//     } catch (err) {
//       setAuthError(err.response?.data?.error || 'Authentication failed. Please try again.');
//     }
//   };

//   const handleLogout = () => {
//     googleLogout();
//     setUser(null);
//     localStorage.removeItem('iimt_user');
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

//   const fetchTimetable = async (sec, forceSync = false) => {
//     if (!forceSync && cache[sec]) {
//       setScheduleData(cache[sec].timetable);
//       setSummaryData(cache[sec].summary);
//       applyDateLogic(cache[sec].timetable);
//       return;
//     }

//     setLoading(true);
//     setError('');

//     try {
//       const res = await axios.get(`${API_BASE_URL}/api/timetable/${sec}?force=${forceSync}`);
//       const data = res.data.timetable;
//       const summary = res.data.summary;

//       setScheduleData(data);
//       setSummaryData(summary);
//       applyDateLogic(data);

//       setCache(prevCache => ({
//         ...prevCache,
//         [sec]: { timetable: data, summary: summary }
//       }));

//     } catch (err) {
//       console.error(err);
//       setError('System Error: Unable to fetch ERP data.');
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleSyncData = () => {
//     setCache({});
//     fetchTimetable(section, true);
//   };

//   const handleResetDate = () => {
//     setDaySwipeAnim('fade-in');
//     setSelectedDate(getTodayIST());
//   };

//   const currentDayData = scheduleData.find(d => d.isoDate === selectedDate);

//   const formatHeaderDate = (isoDate, dayString) => {
//     if (!isoDate) return 'Timetable';
//     const dateObj = new Date(isoDate);
//     const formatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
//     return `${dayString}, ${formatted}`;
//   };

//   // --- SWIPE GESTURE HANDLERS ---
//   const shiftIsoDate = (isoDate, days) => {
//     const d = new Date(`${isoDate}T00:00:00`);
//     d.setDate(d.getDate() + days);
//     return d.toLocaleDateString('en-CA');
//   };

//   const goToDay = (direction) => {
//     if (!selectedDate) return;
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

//     // Only activate drag tracking if the swipe is mostly horizontal
//     if (Math.abs(deltaX) > Math.abs(deltaY)) {
//       // 0.45 adds a physical "weight" to the drag
//       let resistance = 0.45; 
      
//       // Add extreme heavy rubber-banding if dragging past available calendar dates
//       if (deltaX < 0 && (!maxDate || selectedDate >= maxDate)) resistance = 0.08;
//       if (deltaX > 0 && (!minDate || selectedDate <= minDate)) resistance = 0.08;

//       setDragX(deltaX * resistance);
//     }
//   };

//   const handleTouchEnd = () => {
//     setIsDragging(false);
    
//     if (Math.abs(dragX) > SWIPE_THRESHOLD) {
//       goToDay(dragX < 0 ? 'next' : 'prev');
//     }
    
//     // Snaps back to 0. If date changed, React remounts the inner div seamlessly.
//     setDragX(0); 
//   };

//   // CSS injection to handle responsive layout and premium animations
//   const injectedStyles = `
//     /* --- MOBILE RESPONSIVENESS FIXES --- */
//     @media (max-width: 768px) {
//       .dashboard-layout {
//         min-height: 100dvh;
//       }
//       .main-content {
//         padding-bottom: 120px !important;
//       }
//       .timetable-section {
//         padding-bottom: env(safe-area-inset-bottom, 40px);
//       }
//       .mobile-swipe-hint {
//         display: flex !important;
//       }
//     }

//     /* --- SATISFYING LOADER ANIMATION --- */
//     .satisfying-loader-container {
//       display: flex;
//       flex-direction: column;
//       align-items: center;
//       justify-content: center;
//       height: 60vh;
//       gap: 1.5rem;
//       width: 100%;
//     }
//     .dot-wave { display: flex; gap: 12px; }
//     .dot-wave .dot {
//       width: 16px; height: 16px; border-radius: 50%;
//       background-color: var(--accent-gold, #dba315);
//       animation: smooth-wave 1.4s ease-in-out infinite;
//       box-shadow: 0 4px 10px rgba(219, 163, 21, 0.3);
//     }
//     .dot-wave .dot:nth-child(1) { animation-delay: 0s; }
//     .dot-wave .dot:nth-child(2) { animation-delay: 0.15s; }
//     .dot-wave .dot:nth-child(3) { animation-delay: 0.3s; }

//     @keyframes smooth-wave {
//       0%, 100% { transform: translateY(0) scale(0.8); opacity: 0.3; }
//       50% { transform: translateY(-14px) scale(1.1); opacity: 1; }
//     }

//     .loading-text {
//       color: var(--text-secondary, #888); font-size: 1.05rem; font-weight: 500;
//       letter-spacing: 0.5px; animation: pulse-text 2s ease-in-out infinite;
//     }
//     @keyframes pulse-text {
//       0%, 100% { opacity: 0.5; } 50% { opacity: 1; }
//     }

//     /* --- PREMIUM SWIPE NAVIGATION (Mobile Only) --- */
//     .mobile-swipe-hint {
//       display: none; 
//       align-items: center; justify-content: center; gap: 6px;
//       color: var(--text-secondary, #888); font-size: 0.78rem;
//       opacity: 0.65; margin: 0 0 0.75rem 0; user-select: none;
//     }
    
//     .timetable-section {
//       touch-action: pan-y; /* Crucial: Allows vertical scroll while capturing horizontal swipes */
//       overflow-x: hidden;  /* Prevents scrollbar flash during animation */
//     }

//     .day-anim-wrapper {
//       width: 100%;
//       will-change: transform, opacity;
//     }

//     /* Custom Apple-like fluid spring curves */
//     @keyframes premiumSlideInRight {
//       from { transform: translateX(45px) scale(0.98); opacity: 0; }
//       to   { transform: translateX(0) scale(1); opacity: 1; }
//     }
//     @keyframes premiumSlideInLeft {
//       from { transform: translateX(-45px) scale(0.98); opacity: 0; }
//       to   { transform: translateX(0) scale(1); opacity: 1; }
//     }
//     @keyframes premiumFadeIn {
//       from { transform: translateY(12px) scale(0.99); opacity: 0; }
//       to   { transform: translateY(0) scale(1); opacity: 1; }
//     }

//     .swipe-left { animation: premiumSlideInRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
//     .swipe-right { animation: premiumSlideInLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
//     .fade-in { animation: premiumFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
//   `;

//   // --- LOGIN SCREEN ---
//   if (!user) {
//     return (
//       <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
//         <div className="login-wrapper" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
//           <div className="login-card" style={{ padding: '3rem', background: '#fff', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', textAlign: 'center', minWidth: '320px' }}>
//             <h1 style={{ color: 'var(--accent-gold)', marginBottom: '0.5rem' }}>IIM Trichy</h1>
//             <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>PGPM Term-I Portal</p>
//             <GoogleLogin
//               onSuccess={handleGoogleSuccess}
//               onError={() => setAuthError('Google Login Failed')}
//               useOneTap
//             />
//             {authError && <div style={{ color: 'var(--color-cancelled)', marginTop: '1rem', fontSize: '0.9rem', fontWeight: 'bold' }}>{authError}</div>}
//             <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>*Requires @iimtrichy.ac.in email address</p>
//           </div>
//         </div>
//       </GoogleOAuthProvider>
//     );
//   }

//   // Calculate dynamic inline styles for the real-time finger drag tracking
//   const dragStyle = {
//     transform: `translateX(${dragX}px) scale(${1 - Math.abs(dragX) / 3000})`,
//     opacity: 1 - Math.abs(dragX) / 500,
//     // Snap back fluidly when finger is released, otherwise stick to finger 1:1 instantly
//     transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)',
//   };

//   // --- MAIN DASHBOARD SCREEN ---
//   return (
//     <>
//       <style>{injectedStyles}</style>
//       <div className="dashboard-layout">
//         <aside className="sidebar">
//           <div className="brand-title">IIM Trichy</div>
//           <div className="brand-subtitle">PGPM Term-I</div>

//           <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
//               <img
//                 src={user.picture || getFallbackAvatar(user.name)}
//                 alt="Profile"
//                 onError={(e) => {
//                   e.target.onerror = null;
//                   e.target.src = getFallbackAvatar(user.name);
//                 }}
//                 style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
//               />
//               <div style={{ overflow: 'hidden' }}>
//                   <div style={{ fontSize: '0.85rem', fontWeight: 'bold', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{user.name}</div>
//               </div>
//           </div>

//           <div className="nav-menu">
//             <button
//               className={`nav-btn ${activeTab === 'timetable' ? 'active' : ''}`}
//               onClick={() => setActiveTab('timetable')}
//             >
//               <Calendar size={18} />
//               Timetable
//             </button>
//             <button
//               className={`nav-btn ${activeTab === 'summary' ? 'active' : ''}`}
//               onClick={() => setActiveTab('summary')}
//             >
//               <Table2 size={18} />
//               Summary Table
//             </button>
//           </div>

//           <div className="section-selector-container">
//             <span className="section-label">Select Section</span>
//             <div className="sec-grid">
//               {SECTIONS.map((sec) => (
//                 <button
//                   key={sec}
//                   className={`section-btn ${section === sec ? 'active' : ''}`}
//                   onClick={() => setSection(sec)}
//                 >
//                   {sec}
//                 </button>
//               ))}
//             </div>
//           </div>

//           <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
//               <button
//                   onClick={handleSyncData}
//                   className="nav-btn"
//                   style={{ width: '100%', color: 'var(--text-secondary)' }}
//                   disabled={loading}
//               >
//                   <RefreshCw size={18} />
//                   {loading ? 'Syncing...' : 'Sync Data'}
//               </button>
//               <button onClick={handleLogout} className="nav-btn" style={{ width: '100%', color: 'var(--color-cancelled)' }}>
//                   <LogOut size={18} />
//                   Sign Out
//               </button>
//           </div>
//         </aside>

//         <main className="main-content">
//           {loading && (
//             <div className="satisfying-loader-container">
//               <div className="dot-wave">
//                 <div className="dot"></div>
//                 <div className="dot"></div>
//                 <div className="dot"></div>
//               </div>
//               <div className="loading-text">Connecting to database...</div>
//             </div>
//           )}

//           {error && <div className="empty-state" style={{color: '#eb3223'}}>{error}</div>}

//           {!loading && !error && (
//             <>
//               {activeTab === 'timetable' && (
//                 <>
//                   <div className="top-toolbar">
//                     <h2 className="view-title">
//                       {currentDayData
//                         ? formatHeaderDate(currentDayData.isoDate, currentDayData.day)
//                         : formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}
//                     </h2>
//                     <div className="legend">
//                       <div className="legend-item">
//                         <div className="legend-color" style={{ background: 'var(--color-makeup)' }}></div>
//                         Make-up
//                       </div>
//                       <div className="legend-item">
//                         <div className="legend-color" style={{ background: 'var(--color-cancelled)' }}></div>
//                         Cancelled
//                       </div>
//                     </div>
//                     <div className="date-picker-group">
//                       <button
//                         onClick={handleResetDate}
//                         className="nav-btn"
//                         style={{ padding: '0.6rem', border: '1px solid var(--border-color)', margin: '0' }}
//                         title="Snap back to Today"
//                       >
//                         <CalendarSync size={18} color="var(--accent-gold)" />
//                       </button>
//                       <input
//                         type="date"
//                         className="date-input"
//                         value={selectedDate}
//                         min={minDate}
//                         max={maxDate}
//                         onChange={(e) => {
//                           setDaySwipeAnim('fade-in');
//                           setSelectedDate(e.target.value);
//                         }}
//                         disabled={!minDate}
//                       />
//                     </div>
//                   </div>

//                   <div className="mobile-swipe-hint">
//                     <ChevronLeft size={14} />
//                     Swipe to change day
//                     <ChevronRight size={14} />
//                   </div>

//                   <section
//                     className="timetable-section"
//                     onTouchStart={handleTouchStart}
//                     onTouchMove={handleTouchMove}
//                     onTouchEnd={handleTouchEnd}
//                   >
//                     <div
//                       key={selectedDate}
//                       className={`day-anim-wrapper ${daySwipeAnim || ''}`}
//                       onAnimationEnd={() => setDaySwipeAnim(null)}
//                     >
//                       {/* Inner drag surface handles real-time finger tracking */}
//                       <div className="day-drag-surface" style={dragStyle}>
//                         {!currentDayData && selectedDate && (
//                           <div className="empty-state">No classes scheduled for {formatHeaderDate(selectedDate, new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short' }))}. Enjoy your day!</div>
//                         )}

//                         {currentDayData && currentDayData.classes.map((cls, idx) => {
//                           const cardStyle = cls.color ? {
//                             borderLeftColor: cls.color,
//                             backgroundColor: `${cls.color}10`
//                           } : {};

//                           return (
//                             <div key={idx} className="class-card" style={cardStyle}>
//                               {cls.status && (
//                                 <div className="status-pill" style={{ backgroundColor: cls.color }}>
//                                   {cls.status}
//                                 </div>
//                               )}
//                               <div className="time-badge" style={{ color: cls.color || 'var(--text-secondary)'}}>
//                                 {cls.time.includes('Remarks') ? <Info size={18} /> : <Clock size={18} />}
//                                 <span>{cls.time}</span>
//                               </div>
//                               <div className="class-details">
//                                 <div className="subject-name">{cls.subject}</div>
//                                 {cls.prof && (
//                                   <div className="prof-badge" style={cls.color ? { color: cls.color, borderColor: `${cls.color}50` } : {}}>
//                                     <UserIcon size={14} />
//                                     {cls.prof}
//                                   </div>
//                                 )}
//                               </div>
//                             </div>
//                           )
//                         })}
//                       </div>
//                     </div>
//                   </section>
//                 </>
//               )}

//               {activeTab === 'summary' && (
//                 <>
//                   <div className="top-toolbar">
//                     <h2 className="view-title">Section {section} Academic Overview</h2>
//                   </div>
//                   {summaryData.headers.length > 0 ? (
//                     <div className="table-container" style={{ overflowX: 'auto' }}>
//                       <table className="erp-table" style={{ minWidth: '900px' }}>
//                         <thead>
//                           <tr>
//                             {summaryData.headers.map((header, idx) => (
//                               <th key={idx}>{header}</th>
//                             ))}
//                           </tr>
//                         </thead>
//                         <tbody>
//                           {summaryData.rows.map((row, rowIdx) => (
//                             <tr key={rowIdx}>
//                               {row.map((cell, cellIdx) => (
//                                 <td key={cellIdx}>
//                                   {cellIdx === 0 ? <strong>{cell}</strong> : cell}
//                                 </td>
//                               ))}
//                             </tr>
//                           ))}
//                         </tbody>
//                       </table>
//                     </div>
//                   ) : (
//                      <div className="empty-state">No summary data available.</div>
//                   )}
//                 </>
//               )}
//             </>
//           )}
//         </main>
//       </div>
//     </>
//   );
// }

// export default App;