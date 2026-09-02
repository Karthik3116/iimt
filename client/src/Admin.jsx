import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Lock, LayoutDashboard, Activity, Users, MousePointer2, 
  TrendingUp, Globe, CheckCircle2, MessageSquare, LogOut, Loader2, Server
} from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const adminStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

  :root {
    --admin-primary: #0F172A;
    --admin-secondary: #1E293B;
    --admin-accent: #DBA315;
    --admin-accent-light: rgba(219, 163, 21, 0.15);
    --admin-bg: #F8FAFC;
    --admin-card: #FFFFFF;
    --admin-text-main: #0F172A;
    --admin-text-muted: #64748B;
    --admin-border: #E2E8F0;
    --admin-success: #10B981;
    --admin-danger: #EF4444;
  }

  .admin-wrapper {
    font-family: 'Inter', sans-serif;
    color: var(--admin-text-main);
    box-sizing: border-box;
  }

  .admin-wrapper * {
    box-sizing: border-box;
  }

  /* --- LOGIN SCREEN --- */
  .admin-login-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, var(--admin-primary), var(--admin-secondary));
    position: relative;
    overflow: hidden;
  }
  
  .admin-login-screen::before {
    content: '';
    position: absolute;
    width: 600px;
    height: 600px;
    background: var(--admin-accent);
    filter: blur(150px);
    opacity: 0.15;
    border-radius: 50%;
    top: -200px;
    right: -100px;
  }

  .admin-login-card {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    padding: 3rem 2.5rem;
    border-radius: 24px;
    box-shadow: 0 20px 40px rgba(0,0,0,0.2);
    width: 100%;
    max-width: 420px;
    text-align: center;
    z-index: 10;
    border: 1px solid rgba(255,255,255,0.2);
    transform: translateY(0);
    animation: floatIn 0.5s ease-out;
  }

  @keyframes floatIn {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .admin-login-card h2 {
    font-size: 1.75rem;
    font-weight: 800;
    margin: 1rem 0 2rem;
    color: var(--admin-primary);
  }

  .admin-input-group {
    position: relative;
    margin-bottom: 1.5rem;
  }

  .admin-login-input {
    width: 100%;
    padding: 14px 16px;
    border-radius: 12px;
    border: 2px solid var(--admin-border);
    font-size: 1rem;
    transition: all 0.2s;
    background: #fff;
    outline: none;
  }

  .admin-login-input:focus {
    border-color: var(--admin-accent);
    box-shadow: 0 0 0 4px var(--admin-accent-light);
  }

  .admin-btn {
    width: 100%;
    padding: 14px;
    background: var(--admin-accent);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .admin-btn:hover {
    background: #c59212;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(219, 163, 21, 0.3);
  }

  .admin-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
    transform: none;
  }

  /* --- DASHBOARD LAYOUT --- */
  .admin-layout {
    display: flex;
    height: 100vh;
    background: var(--admin-bg);
    overflow: hidden;
  }

  .admin-sidebar {
    width: 280px;
    background: var(--admin-primary);
    color: white;
    display: flex;
    flex-direction: column;
    padding: 2rem 1.5rem;
    transition: all 0.3s;
    z-index: 20;
  }

  .admin-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.5rem;
    font-weight: 800;
    color: white;
    margin-bottom: 3rem;
  }

  .admin-brand .icon-wrap {
    background: var(--admin-accent);
    padding: 8px;
    border-radius: 10px;
    display: flex;
  }

  .admin-nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .admin-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    border-radius: 12px;
    color: #94A3B8;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
    background: transparent;
    text-align: left;
    font-size: 0.95rem;
  }

  .admin-nav-item:hover {
    background: rgba(255,255,255,0.05);
    color: white;
  }

  .admin-nav-item.active {
    background: var(--admin-accent);
    color: white;
    box-shadow: 0 4px 12px rgba(219, 163, 21, 0.2);
  }

  .admin-logout {
    margin-top: auto;
    padding: 14px 16px;
    background: rgba(239, 68, 68, 0.1);
    color: #FCA5A5;
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 12px;
    cursor: pointer;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: all 0.2s;
  }

  .admin-logout:hover {
    background: rgba(239, 68, 68, 0.2);
    color: white;
  }

  .admin-main {
    flex: 1;
    overflow-y: auto;
    padding: 2.5rem 3rem;
    position: relative;
    scroll-behavior: smooth;
  }

  .admin-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 2.5rem;
    animation: fadeSlideDown 0.4s ease-out;
  }

  @keyframes fadeSlideDown {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .admin-title {
    font-size: 2rem;
    font-weight: 800;
    color: var(--admin-primary);
    margin: 0 0 0.25rem 0;
  }

  .admin-subtitle {
    color: var(--admin-text-muted);
    font-weight: 500;
    font-size: 0.95rem;
    margin: 0;
  }

  /* --- STATS GRID --- */
  .admin-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .stat-card {
    background: var(--admin-card);
    padding: 1.5rem;
    border-radius: 20px;
    border: 1px solid var(--admin-border);
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02);
    display: flex;
    align-items: center;
    gap: 1.25rem;
    transition: transform 0.2s, box-shadow 0.2s;
    animation: fadeInUp 0.5s ease-out backwards;
  }

  .stat-card:hover {
    transform: translateY(-3px);
    box-shadow: 0 10px 15px -3px rgba(0,0,0,0.05);
  }

  .stat-card:nth-child(1) { animation-delay: 0.1s; }
  .stat-card:nth-child(2) { animation-delay: 0.2s; }
  .stat-card:nth-child(3) { animation-delay: 0.3s; }
  .stat-card:nth-child(4) { animation-delay: 0.4s; }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(15px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .stat-icon {
    width: 54px;
    height: 54px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stat-icon.gold { background: var(--admin-accent-light); color: var(--admin-accent); }
  .stat-icon.blue { background: rgba(59, 130, 246, 0.15); color: #3B82F6; }
  .stat-icon.green { background: rgba(16, 185, 129, 0.15); color: var(--admin-success); }
  .stat-icon.purple { background: rgba(139, 92, 246, 0.15); color: #8B5CF6; }

  .stat-info { flex: 1; }
  
  .stat-label {
    font-size: 0.85rem;
    color: var(--admin-text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 800;
    color: var(--admin-text-main);
    line-height: 1.1;
  }

  /* --- CHARTS & CONTAINERS --- */
  .chart-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .admin-panel {
    background: var(--admin-card);
    padding: 1.75rem;
    border-radius: 20px;
    border: 1px solid var(--admin-border);
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--admin-primary);
    margin-bottom: 2rem;
  }

  /* Custom CSS Chart Refinements */
  .css-chart-wrapper {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    height: 200px;
    padding: 10px 0 0 0;
    border-bottom: 2px solid var(--admin-border);
    position: relative;
  }

  .css-chart-bar-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    width: 12%;
    height: 100%;
    position: relative;
    group: hover;
  }

  .css-chart-bar {
    width: 100%;
    border-radius: 6px 6px 0 0;
    transition: height 0.8s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
    cursor: pointer;
  }

  .css-chart-bar.gold {
    background: linear-gradient(180deg, var(--admin-accent) 0%, rgba(219,163,21,0.4) 100%);
  }

  .css-chart-bar.green {
    background: linear-gradient(180deg, var(--admin-success) 0%, rgba(16,185,129,0.4) 100%);
  }

  .css-chart-bar::after {
    content: attr(data-tooltip);
    position: absolute;
    top: -40px;
    left: 50%;
    transform: translateX(-50%) translateY(10px);
    background: var(--admin-primary);
    color: white;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: all 0.2s ease;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    z-index: 10;
  }

  .css-chart-bar:hover::after {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  .css-chart-label {
    margin-top: 12px;
    font-size: 0.8rem;
    color: var(--admin-text-muted);
    font-weight: 600;
  }

  /* --- LISTS & TABLES --- */
  .list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    border-radius: 12px;
    background: var(--admin-bg);
    margin-bottom: 8px;
    transition: all 0.2s;
    border: 1px solid transparent;
  }

  .list-row:hover {
    background: #fff;
    border-color: var(--admin-border);
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02);
    transform: scale(1.01);
  }

  .list-name {
    font-weight: 600;
    color: var(--admin-primary);
  }

  .list-badge {
    background: var(--admin-accent-light);
    color: #b7860b;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 700;
  }

  /* --- USER CARDS --- */
  .user-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1rem;
  }

  .user-card {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    background: #fff;
    border-radius: 16px;
    border: 1px solid var(--admin-border);
    transition: all 0.2s;
  }

  .user-card:hover {
    border-color: var(--admin-accent);
    box-shadow: 0 4px 12px var(--admin-accent-light);
  }

  .user-avatar {
    width: 48px;
    height: 48px;
    border-radius: 14px;
    object-fit: cover;
    background: var(--admin-bg);
  }

  .user-info {
    flex: 1;
    min-width: 0;
  }

  .user-name {
    font-weight: 700;
    color: var(--admin-primary);
    font-size: 1rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .user-meta {
    font-size: 0.85rem;
    color: var(--admin-text-muted);
    margin-top: 4px;
  }

  .user-status {
    text-align: right;
  }

  .status-time {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--admin-primary);
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }

  .status-label {
    font-size: 0.75rem;
    color: var(--admin-text-muted);
    text-transform: uppercase;
    margin-top: 4px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--admin-success);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
    70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
    100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
  }

  /* --- FEEDBACK CARDS --- */
  .feedback-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .feedback-card {
    background: #FFFAF0;
    border: 1px solid #FEF08A;
    border-left: 4px solid var(--admin-accent);
    padding: 1.25rem;
    border-radius: 12px;
  }

  .fb-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .fb-name { font-weight: 700; color: var(--admin-primary); }
  .fb-date { font-size: 0.8rem; color: #9CA3AF; font-weight: 500;}
  .fb-msg { font-size: 0.95rem; color: #4B5563; line-height: 1.5; margin: 0; }

  @media (max-width: 768px) {
    .admin-layout { flex-direction: column; overflow: auto; }
    .admin-sidebar { width: 100%; padding: 1.5rem; flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-items: center; }
    .admin-brand { margin-bottom: 0; }
    .admin-nav { flex-direction: row; width: 100%; margin-top: 1rem; overflow-x: auto; padding-bottom: 5px; }
    .admin-logout { margin-top: 1rem; width: 100%; justify-content: center; }
    .admin-main { padding: 1.5rem; }
  }
`;

function AdminPortal() {
  const [password, setPassword] = useState('');
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminTab, setAdminTab] = useState('overview');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Update clock
  useEffect(() => {
    if (!authData) return;
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, [authData]);

  const handleLogin = async (e) => {
    e.preventDefault(); 
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/data`, { password });
      setAuthData(res.data); 
      setError('');
    } catch(err) { 
      setError('Invalid Password or Access Denied'); 
    } finally { 
      setLoading(false); 
    }
  };

  const timeAgo = (date) => {
    if (!date) return "Never";
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr${hours !== 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days !== 1 ? 's' : ''} ago`;
  };

  const formatNum = (num) => num.toLocaleString('en-US');

  if (!authData) {
    return (
      <div className="admin-wrapper admin-login-screen">
        <style>{adminStyles}</style>
        <div className="admin-login-card">
          <div style={{ display: 'inline-flex', background: 'var(--admin-accent-light)', padding: '1rem', borderRadius: '20px', marginBottom: '1rem' }}>
            <Lock size={40} color="var(--admin-accent)" />
          </div>
          <h2>Admin Secure Access</h2>
          <form onSubmit={handleLogin}>
            <div className="admin-input-group">
              <input 
                type="password" 
                className="admin-login-input"
                placeholder="Enter Administrator Password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                autoFocus
              />
            </div>
            <button type="submit" className="admin-btn" disabled={loading || !password}>
              {loading ? <Loader2 size={20} className="lucide-spin" /> : 'Authenticate'}
            </button>
          </form>
          {error && (
            <div style={{ color: 'var(--admin-danger)', background: '#FEE2E2', padding: '10px', borderRadius: '8px', marginTop: '1rem', fontWeight: 600, fontSize: '0.9rem' }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  const { analytics, users, feedbacks } = authData;

  const maxDau = analytics.dau.length > 0 ? Math.max(...analytics.dau.map(d => d.count)) : 1;
  const maxTraffic = analytics.traffic.length > 0 ? Math.max(...analytics.traffic.map(d => d.hits)) : 1;

  return (
    <div className="admin-wrapper admin-layout">
      <style>{adminStyles}</style>
      
      {/* SIDEBAR */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="icon-wrap"><LayoutDashboard size={24} color="#fff" /></div>
          Dashboard
        </div>
        
        <div className="admin-nav">
          <button className={`admin-nav-item ${adminTab === 'overview' ? 'active' : ''}`} onClick={() => setAdminTab('overview')}>
            <Activity size={20} /> Platform Analytics
          </button>
          <button className={`admin-nav-item ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>
            <Users size={20} /> Users & Feedback
          </button>
        </div>
        
        <button className="admin-logout" onClick={() => setAuthData(null)}>
          <LogOut size={20} /> Secure Logout
        </button>
      </aside>

      {/* MAIN CONTENT */}
      <main className="admin-main">
        <div className="admin-header">
          <div>
            <h1 className="admin-title">
              {adminTab === 'overview' ? 'Platform Overview' : 'User Management'}
            </h1>
            <p className="admin-subtitle">
              Live data as of {currentTime.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </p>
          </div>
        </div>

        {adminTab === 'overview' && (
          <div className="fade-in-section">
            {/* STATS */}
            <div className="admin-stats-grid">
              <div className="stat-card">
                <div className="stat-icon gold"><Users size={28} /></div>
                <div className="stat-info">
                  <div className="stat-label">Total Registered Users</div>
                  <div className="stat-value">{formatNum(users.length)}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon blue"><Activity size={28} /></div>
                <div className="stat-info">
                  <div className="stat-label">Active Today</div>
                  <div className="stat-value">{formatNum(analytics.dau.slice(-1)[0]?.count || 0)}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon purple"><Server size={28} /></div>
                <div className="stat-info">
                  <div className="stat-label">API Requests (24h)</div>
                  <div className="stat-value">{formatNum(analytics.traffic.slice(-1)[0]?.hits || 0)}</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon green"><CheckCircle2 size={28} /></div>
                <div className="stat-info">
                  <div className="stat-label">OLT Setups Completed</div>
                  <div className="stat-value">{formatNum(analytics.oltUsersCount || users.filter(u => u.oltUsername).length)}</div>
                </div>
              </div>
            </div>

            {/* CHARTS */}
            <div className="chart-grid">
              <div className="admin-panel">
                <h3 className="panel-header"><TrendingUp size={20}/> Daily Active Users (7D)</h3>
                <div className="css-chart-wrapper">
                  {analytics.dau.length === 0 ? <p style={{color: 'var(--admin-text-muted)', margin: 'auto'}}>No data collected yet</p> : 
                    analytics.dau.map((d, i) => {
                      const heightPct = Math.max((d.count / maxDau) * 100, 4); // min 4% height
                      return (
                        <div className="css-chart-bar-container" key={i}>
                          <div className="css-chart-bar gold" style={{height: `${heightPct}%`}} data-tooltip={`${formatNum(d.count)} Users`}></div>
                          <div className="css-chart-label">{d.date.split('-').slice(1).join('/')}</div>
                        </div>
                      )
                    })
                  }
                </div>
              </div>

              <div className="admin-panel">
                <h3 className="panel-header"><Globe size={20}/> Server Traffic (API Hits)</h3>
                <div className="css-chart-wrapper">
                  {analytics.traffic.length === 0 ? <p style={{color: 'var(--admin-text-muted)', margin: 'auto'}}>No data collected yet</p> : 
                    analytics.traffic.map((d, i) => {
                      const heightPct = Math.max((d.hits / maxTraffic) * 100, 4);
                      return (
                        <div className="css-chart-bar-container" key={i}>
                          <div className="css-chart-bar green" style={{height: `${heightPct}%`}} data-tooltip={`${formatNum(d.hits)} Requests`}></div>
                          <div className="css-chart-label">{d.date.split('-').slice(1).join('/')}</div>
                        </div>
                      )
                    })
                  }
                </div>
              </div>
            </div>

            {/* LISTS */}
            <div className="chart-grid">
              <div className="admin-panel">
                <h3 className="panel-header"><MousePointer2 size={20}/> Popular Features</h3>
                <div>
                  {analytics.features.length === 0 ? <p style={{color: 'var(--admin-text-muted)'}}>No interaction data</p> : 
                    analytics.features.map(f => (
                      <div className="list-row" key={f._id}>
                        <div className="list-name">{f._id.replace('tab_', '').toUpperCase()}</div>
                        <div className="list-badge">{formatNum(f.clicks)} views</div>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div className="admin-panel">
                <h3 className="panel-header"><MousePointer2 size={20}/> Top Button Clicks</h3>
                <div>
                  {analytics.interactions.length === 0 ? <p style={{color: 'var(--admin-text-muted)'}}>No interaction data</p> : 
                    analytics.interactions.map(f => (
                      <div className="list-row" key={f._id}>
                        <div className="list-name" style={{textTransform: 'capitalize'}}>{f._id.replace(/_/g, ' ')}</div>
                        <div className="list-badge" style={{background: '#F1F5F9', color: 'var(--admin-primary)'}}>{formatNum(f.count)} taps</div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          </div>
        )}

        {adminTab === 'users' && (
          <div className="fade-in-section chart-grid" style={{ gridTemplateColumns: '2fr 1fr', alignItems: 'start' }}>
            {/* USER DATABASE */}
            <div className="admin-panel">
              <h3 className="panel-header"><Users size={20}/> Active User Database</h3>
              <div className="user-grid">
                {users.map(u => {
                  const timeAgoStr = timeAgo(u.lastActive);
                  const isOnline = timeAgoStr === "Just now" || timeAgoStr.includes("min");
                  
                  return (
                    <div key={u._id} className="user-card">
                      <img src={u.picture || `https://ui-avatars.com/api/?name=${u.name}&background=dba315&color=fff`} className="user-avatar" alt={u.name}/>
                      <div className="user-info">
                        <div className="user-name" title={u.name}>{u.name}</div>
                        <div className="user-meta">{u.email} &middot; Sec {u.defaultSection}</div>
                      </div>
                      <div className="user-status">
                        <div className="status-time">
                          {isOnline && <span className="dot"></span>}
                          {timeAgoStr}
                        </div>
                        <div className="status-label">Last Seen</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* FEEDBACK */}
            <div className="admin-panel">
              <h3 className="panel-header"><MessageSquare size={20}/> Recent Feedback</h3>
              <div className="feedback-list">
                {feedbacks.length === 0 ? <p style={{color: 'var(--admin-text-muted)'}}>No feedback submitted yet.</p> : 
                  feedbacks.map(f => (
                    <div key={f._id} className="feedback-card">
                      <div className="fb-header">
                        <span className="fb-name">{f.userName}</span>
                        <span className="fb-date">
                          {new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      <p className="fb-msg">"{f.message}"</p>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default AdminPortal;