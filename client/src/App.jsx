import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { GoogleOAuthProvider, GoogleLogin, googleLogout } from '@react-oauth/google';
import { Clock, User as UserIcon, Info, Calendar, Table2, CalendarSync, LogOut, RefreshCw } from 'lucide-react';
import './App.css';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

// REPLACE THIS STRING WITH YOUR ACTUAL GOOGLE CLIENT ID
const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com'; 

function App() {
  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState('timetable');
  const [section, setSection] = useState('A');
  
  // NEW: State object to cache downloaded sections
  const [cache, setCache] = useState({}); 
  
  const [scheduleData, setScheduleData] = useState([]);
  const [summaryData, setSummaryData] = useState({ headers: [], rows: [] });
  
  const [selectedDate, setSelectedDate] = useState('');
  const [minDate, setMinDate] = useState('');
  const [maxDate, setMaxDate] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getTodayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const getFallbackAvatar = (name) => {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'User')}&background=dba315&color=fff`;
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('iimt_user');
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  // Triggers whenever the selected section changes
  useEffect(() => {
    if (user) fetchTimetable(section);
  }, [section, user]);

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      setAuthError('');
      const res = await axios.post('http://localhost:5000/api/auth/google', {
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
    setCache({}); // Clear memory cache on logout
  };

  // Separated date logic so we can reuse it whether data comes from API or Cache
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

  // UPDATED: Now supports local caching and a forceSync override
  const fetchTimetable = async (sec, forceSync = false) => {
    // If not forcing a sync and we already have the data in cache, load instantly
    if (!forceSync && cache[sec]) {
      setScheduleData(cache[sec].timetable);
      setSummaryData(cache[sec].summary);
      applyDateLogic(cache[sec].timetable);
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const res = await axios.get(`http://localhost:5000/api/timetable/${sec}`);
      const data = res.data.timetable;
      const summary = res.data.summary;
      
      // Update UI state
      setScheduleData(data);
      setSummaryData(summary);
      applyDateLogic(data);
      
      // Update local cache object
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

  // Manual Sync Button Handler
  const handleSyncData = () => {
    // Clears the entire cache object so everything forces a re-download next time a tab is clicked
    setCache({}); 
    // Force refresh the current viewing tab immediately
    fetchTimetable(section, true);
  };

  const handleResetDate = () => {
    setSelectedDate(getTodayIST());
  };

  const currentDayData = scheduleData.find(d => d.isoDate === selectedDate);

  const formatHeaderDate = (isoDate, dayString) => {
    if (!isoDate) return 'Timetable';
    const dateObj = new Date(isoDate);
    const formatted = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return `${dayString}, ${formatted}`;
  };

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

  // --- MAIN DASHBOARD SCREEN ---
  return (
    <div className="dashboard-layout">
      <aside className="sidebar">
        <div className="brand-title">IIM Trichy</div>
        <div className="brand-subtitle">PGPM Term-I</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <img 
              src={user.picture || getFallbackAvatar(user.name)} 
              alt="Profile" 
              onError={(e) => {
                e.target.onerror = null; // Prevents infinite loop if fallback fails
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
            {/* NEW: Sync Button */}
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
        {loading && <div className="loader">Connecting to database...</div>}
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
                      onChange={(e) => setSelectedDate(e.target.value)}
                      disabled={!minDate}
                    />
                  </div>
                </div>

                <section className="timetable-section">
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
  );
}

export default App;