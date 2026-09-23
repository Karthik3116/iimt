import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Lock, LayoutDashboard, Activity, Users, MousePointer2,
  TrendingUp, Globe, CheckCircle2, MessageSquare, LogOut, Loader2, Server,
  X, Calendar, Clock, ArrowRight, UserCircle, Download, Filter, Search,
  BarChart3, LineChart, PieChart, Settings, Bell, Eye, EyeOff,
  MapPin, Zap, AlertCircle, ChevronRight, ArrowUpRight, ArrowDownRight,
  MoreVertical, Star, Radio, Trash2, Mail, Phone, Badge, Hexagon,
  Menu, Home, Briefcase, AreaChart, TrendingDown
} from 'lucide-react';

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

const adminStyles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Poppins:wght@600;700;800&display=swap');

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :root {
    --primary: #0F172A;
    --secondary: #1E293B;
    --accent: #DBA315;
    --accent-light: rgba(219, 163, 21, 0.1);
    --accent-lighter: rgba(219, 163, 21, 0.05);
    --bg: #F8FAFC;
    --card: #FFFFFF;
    --text-main: #0F172A;
    --text-muted: #64748B;
    --text-light: #94A3B8;
    --border: #E2E8F0;
    --success: #10B981;
    --success-light: rgba(16, 185, 129, 0.1);
    --danger: #EF4444;
    --danger-light: rgba(239, 68, 68, 0.1);
    --warning: #F59E0B;
    --warning-light: rgba(245, 158, 11, 0.1);
    --info: #3B82F6;
    --info-light: rgba(59, 130, 246, 0.1);
    --purple: #8B5CF6;
    --purple-light: rgba(139, 92, 246, 0.1);
    --glass-bg: rgba(255, 255, 255, 0.7);
    --glass-border: rgba(255, 255, 255, 0.2);
  }

  html, body {
    background: var(--bg);
    color: var(--text-main);
    font-family: 'Inter', sans-serif;
  }

  .admin-wrapper {
    font-family: 'Inter', sans-serif;
    color: var(--text-main);
  }

  /* --- SCROLLBAR --- */
  ::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  ::-webkit-scrollbar-track {
    background: transparent;
  }

  ::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }

  ::-webkit-scrollbar-thumb:hover {
    background: var(--text-light);
  }

  /* --- GLASSMORPHISM EFFECT --- */
  .glass-effect {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    border: 1px solid var(--glass-border);
    box-shadow: 0 8px 32px rgba(31, 38, 135, 0.1);
  }

  /* --- LOGIN SCREEN --- */
  .admin-login-screen {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, var(--primary) 0%, #1a273d 50%, var(--secondary) 100%);
    position: relative;
    overflow: hidden;
    perspective: 1000px;
  }

  .admin-login-screen::before {
    content: '';
    position: absolute;
    width: 800px;
    height: 800px;
    background: radial-gradient(circle, var(--accent), transparent);
    opacity: 0.1;
    border-radius: 50%;
    top: -300px;
    right: -200px;
    animation: drift 20s infinite ease-in-out;
  }

  .admin-login-screen::after {
    content: '';
    position: absolute;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, var(--info), transparent);
    opacity: 0.06;
    border-radius: 50%;
    bottom: -200px;
    left: -100px;
    animation: drift 25s infinite ease-in-out reverse;
  }

  @keyframes drift {
    0%, 100% { transform: translate(0, 0); }
    50% { transform: translate(30px, -30px); }
  }

  .admin-login-container {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4rem;
    z-index: 10;
    width: 100%;
    max-width: 1100px;
    padding: 2rem;
    align-items: center;
  }

  .admin-login-welcome {
    color: white;
  }

  .admin-login-welcome h1 {
    font-size: 3.5rem;
    font-weight: 900;
    margin-bottom: 1.5rem;
    line-height: 1.1;
    font-family: 'Poppins', sans-serif;
  }

  .admin-login-welcome p {
    font-size: 1.1rem;
    color: rgba(255, 255, 255, 0.8);
    margin-bottom: 2.5rem;
    line-height: 1.7;
  }

  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .feature-item {
    display: flex;
    align-items: center;
    gap: 1.2rem;
    color: rgba(255, 255, 255, 0.85);
    font-size: 1rem;
  }

  .feature-icon {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(219, 163, 21, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid rgba(219, 163, 21, 0.3);
  }

  .admin-login-card {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(30px);
    padding: 3.5rem;
    border-radius: 32px;
    box-shadow: 0 25px 60px rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.4);
    animation: slideInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideInUp {
    from {
      opacity: 0;
      transform: translateY(50px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .admin-login-card h2 {
    font-size: 2.2rem;
    font-weight: 800;
    margin-bottom: 0.5rem;
    color: var(--primary);
    font-family: 'Poppins', sans-serif;
  }

  .admin-login-card .login-subtitle {
    color: var(--text-muted);
    margin-bottom: 2rem;
    font-size: 0.95rem;
  }

  .admin-input-group {
    position: relative;
    margin-bottom: 1.5rem;
  }

  .admin-input-group label {
    display: block;
    font-weight: 600;
    color: var(--text-main);
    margin-bottom: 0.6rem;
    font-size: 0.9rem;
  }

  .admin-login-input {
    width: 100%;
    padding: 14px 18px;
    border-radius: 14px;
    border: 2px solid var(--border);
    font-size: 1rem;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    background: #fff;
    outline: none;
    font-family: 'Inter', sans-serif;
  }

  .admin-login-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 6px var(--accent-light);
  }

  .admin-btn {
    width: 100%;
    padding: 14px 18px;
    background: linear-gradient(135deg, var(--accent) 0%, #c59212 100%);
    color: white;
    border: none;
    border-radius: 14px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    box-shadow: 0 8px 20px rgba(219, 163, 21, 0.3);
  }

  .admin-btn:hover:not(:disabled) {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(219, 163, 21, 0.4);
  }

  .admin-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* --- DASHBOARD LAYOUT --- */
  .admin-layout {
    display: grid;
    grid-template-columns: 280px 1fr;
    height: 100vh;
    background: linear-gradient(135deg, var(--bg) 0%, #f1f5f9 100%);
    overflow: hidden;
  }

  /* --- SIDEBAR --- */
  .admin-sidebar {
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(30, 41, 59, 0.95) 100%);
    backdrop-filter: blur(20px);
    color: white;
    display: flex;
    flex-direction: column;
    padding: 2rem 1.5rem;
    overflow-y: auto;
    border-right: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .admin-brand {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 1.4rem;
    font-weight: 900;
    color: white;
    margin-bottom: 2.5rem;
    font-family: 'Poppins', sans-serif;
  }

  .admin-brand .icon-wrap {
    background: linear-gradient(135deg, var(--accent), #c59212);
    padding: 10px;
    border-radius: 12px;
    display: flex;
    box-shadow: 0 4px 15px rgba(219, 163, 21, 0.3);
  }

  .admin-sidebar-section {
    margin-bottom: 2.5rem;
  }

  .sidebar-section-label {
    font-size: 0.7rem;
    font-weight: 800;
    color: rgba(148, 163, 184, 0.6);
    text-transform: uppercase;
    letter-spacing: 1.2px;
    margin-bottom: 1rem;
    padding: 0 12px;
  }

  .admin-nav {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .admin-nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 12px;
    color: rgba(148, 163, 184, 0.8);
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    border: none;
    background: transparent;
    text-align: left;
    font-size: 0.95rem;
    position: relative;
  }

  .admin-nav-item:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }

  .admin-nav-item.active {
    background: linear-gradient(135deg, var(--accent), rgba(219, 163, 21, 0.8));
    color: white;
    box-shadow: 0 4px 15px rgba(219, 163, 21, 0.3);
  }

  .admin-nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    background: white;
    border-radius: 0 4px 4px 0;
  }

  .admin-logout {
    margin-top: auto;
    padding: 12px 14px;
    background: rgba(239, 68, 68, 0.1);
    color: #FCA5A5;
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 12px;
    cursor: pointer;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: center;
    transition: all 0.2s;
    width: 100%;
  }

  .admin-logout:hover {
    background: rgba(239, 68, 68, 0.2);
    color: white;
    border-color: rgba(239, 68, 68, 0.4);
  }

  /* --- MAIN AREA --- */
  .admin-main {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    scroll-behavior: smooth;
  }

  /* --- TOPBAR --- */
  .admin-topbar {
    background: var(--glass-bg);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--glass-border);
    padding: 1.5rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
    position: sticky;
    top: 0;
    z-index: 15;
  }

  .topbar-left {
    display: flex;
    align-items: center;
    gap: 2rem;
  }

  .topbar-search {
    position: relative;
    width: 300px;
  }

  .topbar-search input {
    width: 100%;
    padding: 10px 14px 10px 40px;
    border: 2px solid var(--border);
    border-radius: 10px;
    font-size: 0.95rem;
    transition: all 0.2s;
    background: var(--card);
  }

  .topbar-search input:focus {
    outline: none;
    border-color: var(--accent);
    background: white;
    box-shadow: 0 0 0 4px var(--accent-light);
  }

  .topbar-search svg {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }

  .topbar-right {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .topbar-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 8px 14px;
    border-radius: 10px;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 0.9rem;
  }

  .topbar-btn:hover {
    background: var(--accent-lighter);
    color: var(--accent);
  }

  .topbar-user {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: var(--card);
    border-radius: 10px;
    cursor: pointer;
    border: 1px solid var(--border);
  }

  .topbar-user-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent), #c59212);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: 0.85rem;
  }

  /* --- CONTENT AREA --- */
  .admin-content {
    padding: 2.5rem;
    flex: 1;
    overflow-y: auto;
  }

  .admin-header {
    margin-bottom: 2.5rem;
    animation: fadeSlideDown 0.4s ease-out;
  }

  @keyframes fadeSlideDown {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .admin-title {
    font-size: 2.2rem;
    font-weight: 900;
    color: var(--primary);
    margin: 0 0 0.5rem 0;
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: 'Poppins', sans-serif;
  }

  .admin-subtitle {
    color: var(--text-muted);
    font-weight: 500;
    font-size: 0.95rem;
    margin: 0;
  }

  /* --- ACTION BAR --- */
  .action-bar {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .filter-group {
    display: flex;
    gap: 0.5rem;
  }

  .filter-btn {
    padding: 10px 16px;
    background: var(--card);
    border: 2px solid var(--border);
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .filter-btn:hover,
  .filter-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-lighter);
  }

  /* --- STATS GRID --- */
  .admin-stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .stat-card {
    background: var(--card);
    backdrop-filter: blur(10px);
    padding: 1.75rem;
    border-radius: 20px;
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    display: flex;
    align-items: flex-start;
    gap: 1.5rem;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    animation: fadeInUp 0.5s ease-out backwards;
  }

  .stat-card:hover {
    transform: translateY(-8px);
    box-shadow: 0 16px 32px rgba(0, 0, 0, 0.1);
    border-color: var(--accent-light);
  }

  .stat-card:nth-child(1) { animation-delay: 0.1s; }
  .stat-card:nth-child(2) { animation-delay: 0.2s; }
  .stat-card:nth-child(3) { animation-delay: 0.3s; }
  .stat-card:nth-child(4) { animation-delay: 0.4s; }
  .stat-card:nth-child(5) { animation-delay: 0.5s; }
  .stat-card:nth-child(6) { animation-delay: 0.6s; }

  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .stat-icon {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .stat-icon.gold { background: var(--accent-light); color: var(--accent); }
  .stat-icon.blue { background: var(--info-light); color: var(--info); }
  .stat-icon.green { background: var(--success-light); color: var(--success); }
  .stat-icon.purple { background: var(--purple-light); color: var(--purple); }
  .stat-icon.danger { background: var(--danger-light); color: var(--danger); }
  .stat-icon.warning { background: var(--warning-light); color: var(--warning); }

  .stat-info {
    flex: 1;
  }

  .stat-label {
    font-size: 0.85rem;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 0.5rem;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 900;
    color: var(--text-main);
    line-height: 1;
    margin-bottom: 0.5rem;
  }

  .stat-change {
    font-size: 0.9rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stat-change.positive {
    color: var(--success);
  }

  .stat-change.negative {
    color: var(--danger);
  }

  /* --- CHART GRID --- */
  .chart-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
    gap: 1.5rem;
    margin-bottom: 2.5rem;
  }

  .admin-panel {
    background: var(--card);
    backdrop-filter: blur(10px);
    padding: 2rem;
    border-radius: 20px;
    border: 1px solid var(--border);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .admin-panel:hover {
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
    border-color: var(--accent-light);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .panel-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.2rem;
    font-weight: 700;
    color: var(--text-main);
    margin: 0;
  }

  .panel-actions {
    display: flex;
    gap: 0.5rem;
  }

  .panel-action-btn {
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .panel-action-btn:hover {
    background: var(--accent-lighter);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* --- CSS BAR CHART --- */
  .css-chart-wrapper {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    height: 220px;
    padding: 20px 0 10px;
    border-bottom: 2px solid var(--border);
    position: relative;
    gap: 8px;
  }

  .css-chart-bar-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    flex: 1;
    min-width: 0;
    height: 100%;
    position: relative;
  }

  .css-chart-bar {
    width: 100%;
    border-radius: 8px 8px 0 0;
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    position: relative;
    cursor: pointer;
    min-height: 4px;
  }

  .css-chart-bar.gold {
    background: linear-gradient(180deg, var(--accent) 0%, rgba(219, 163, 21, 0.3) 100%);
  }

  .css-chart-bar.green {
    background: linear-gradient(180deg, var(--success) 0%, rgba(16, 185, 129, 0.3) 100%);
  }

  .css-chart-bar.blue {
    background: linear-gradient(180deg, var(--info) 0%, rgba(59, 130, 246, 0.3) 100%);
  }

  .css-chart-bar:hover {
    filter: brightness(1.1);
  }

  .css-chart-bar::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--primary);
    color: white;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 700;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: all 0.2s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    z-index: 10;
  }

  .css-chart-bar:hover::after {
    opacity: 1;
    transform: translateX(-50%) translateY(-4px);
  }

  .css-chart-label {
    margin-top: 12px;
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 600;
    text-align: center;
  }

  /* --- LIST STYLES --- */
  .list-container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .list-header {
    display: grid;
    grid-template-columns: 1fr 100px;
    gap: 1rem;
    padding: 0 16px;
    margin-bottom: 1rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .list-row {
    display: grid;
    grid-template-columns: 1fr 100px;
    gap: 1rem;
    align-items: center;
    padding: 14px 16px;
    border-radius: 12px;
    background: var(--bg);
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid transparent;
  }

  .list-row:hover {
    background: white;
    border-color: var(--border);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    transform: translateX(4px);
  }

  .list-name {
    font-weight: 600;
    color: var(--text-main);
    text-transform: capitalize;
  }

  .list-badge {
    background: var(--accent-light);
    color: var(--accent);
    padding: 6px 12px;
    border-radius: 20px;
    font-size: 0.85rem;
    font-weight: 700;
    text-align: center;
  }

  /* --- USER GRID --- */
  .user-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
  }

  .user-card {
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    background: var(--card);
    border-radius: 18px;
    border: 1px solid var(--border);
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }

  .user-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    background: linear-gradient(90deg, var(--accent), var(--info), var(--success));
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .user-card:hover {
    border-color: var(--accent);
    box-shadow: 0 16px 32px var(--accent-light);
    transform: translateY(-8px);
  }

  .user-card:hover::before {
    transform: scaleX(1);
  }

  .user-card-header {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 1.5rem;
    justify-content: space-between;
  }

  .user-avatar {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    object-fit: cover;
    background: var(--bg);
    border: 2px solid var(--border);
  }

  .user-status-badge {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 0 3px var(--success-light);
    animation: pulse 2s infinite;
  }

  .user-info {
    flex: 1;
  }

  .user-name {
    font-weight: 700;
    color: var(--text-main);
    font-size: 1.05rem;
    margin-bottom: 4px;
  }

  .user-email {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .user-meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 4px;
  }

  .user-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .user-action-btn {
    flex: 1;
    padding: 10px;
    border: 1px solid var(--border);
    background: var(--bg);
    border-radius: 10px;
    cursor: pointer;
    font-weight: 600;
    color: var(--text-muted);
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 0.9rem;
  }

  .user-action-btn:hover {
    border-color: var(--accent);
    background: var(--accent-lighter);
    color: var(--accent);
  }

  /* --- FEEDBACK CARDS --- */
  .feedback-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .feedback-card {
    background: linear-gradient(135deg, #FFFAF0 0%, #FEF9E7 100%);
    border: 1px solid #FEF08A;
    border-left: 4px solid var(--accent);
    padding: 1.5rem;
    border-radius: 14px;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .feedback-card:hover {
    box-shadow: 0 8px 20px rgba(219, 163, 21, 0.15);
    border-left-color: #c59212;
    transform: translateX(4px);
  }

  .fb-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .fb-name {
    font-weight: 700;
    color: var(--text-main);
    font-size: 0.95rem;
  }

  .fb-date {
    font-size: 0.8rem;
    color: #9CA3AF;
    font-weight: 500;
  }

  .fb-msg {
    font-size: 0.95rem;
    color: #4B5563;
    line-height: 1.6;
    margin: 0;
    font-weight: 500;
  }

  /* --- MODAL --- */
  .admin-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(15, 23, 42, 0.8);
    backdrop-filter: blur(12px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: modalFadeIn 0.2s ease;
    padding: 2rem;
  }

  @keyframes modalFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .admin-modal {
    background: var(--card);
    width: 100%;
    max-width: 1100px;
    max-height: 90vh;
    border-radius: 28px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    animation: modalSlideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    border: 1px solid var(--border);
  }

  @keyframes modalSlideUp {
    from {
      transform: translateY(50px) scale(0.95);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .admin-modal-header {
    padding: 2rem;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .admin-modal-user {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    flex: 1;
  }

  .admin-modal-user img {
    width: 72px;
    height: 72px;
    border-radius: 16px;
    object-fit: cover;
    border: 2px solid var(--border);
  }

  .modal-user-info h2 {
    margin: 0 0 8px 0;
    font-size: 1.6rem;
    color: var(--text-main);
  }

  .modal-user-meta {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    font-size: 0.9rem;
    color: var(--text-muted);
  }

  .modal-user-meta span {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .admin-modal-close {
    background: var(--bg);
    border: 2px solid var(--border);
    border-radius: 50%;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-muted);
    transition: all 0.2s;
    flex-shrink: 0;
  }

  .admin-modal-close:hover {
    background: var(--danger-light);
    color: var(--danger);
    border-color: var(--danger);
  }

  .admin-modal-body {
    padding: 2rem;
    overflow-y: auto;
    flex: 1;
  }

  .modal-section {
    margin-bottom: 2.5rem;
  }

  .modal-section:last-child {
    margin-bottom: 0;
  }

  .modal-section-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-main);
    margin-bottom: 1.5rem;
  }

  /* --- SVG CHART --- */
  .svg-chart-container {
    width: 100%;
    height: 240px;
    position: relative;
    background: var(--bg);
    border-radius: 16px;
    border: 1px solid var(--border);
    padding: 1.5rem;
  }

  .svg-chart {
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .svg-grid-line { stroke: var(--border); stroke-width: 1; stroke-dasharray: 4 4; }
  .svg-area { fill: url(#goldGradient); opacity: 0.35; }
  .svg-line { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .svg-point { fill: white; stroke: var(--accent); stroke-width: 3; transition: all 0.2s; cursor: pointer; }
  .svg-point:hover { r: 7; fill: var(--accent); }
  .svg-text { fill: var(--text-muted); font-size: 12px; font-weight: 600; font-family: 'Inter'; text-anchor: middle; }

  /* --- TIMELINE --- */
  .timeline-container {
    position: relative;
    padding-left: 2.5rem;
  }

  .timeline-container::before {
    content: '';
    position: absolute;
    left: 8px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: linear-gradient(180deg, var(--accent), transparent);
  }

  .timeline-day-group {
    margin-bottom: 2.5rem;
  }

  .timeline-day-header {
    font-size: 0.9rem;
    font-weight: 700;
    color: var(--text-main);
    background: var(--accent-lighter);
    padding: 8px 14px;
    border-radius: 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 1rem;
    border: 1px solid var(--accent-light);
  }

  .timeline-item {
    position: relative;
    padding-bottom: 1.5rem;
  }

  .timeline-item::before {
    content: '';
    position: absolute;
    left: -2rem;
    top: 8px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    border: 3px solid white;
    box-shadow: 0 0 0 2px var(--border);
    z-index: 1;
  }

  .timeline-item.open-event::before {
    background: var(--success);
  }

  .timeline-content {
    background: var(--bg);
    padding: 1.25rem;
    border-radius: 12px;
    border: 1px solid var(--border);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
  }

  .timeline-time {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .timeline-action {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-main);
  }

  /* --- EMPTY STATE --- */
  .empty-state {
    text-align: center;
    padding: 3rem 2rem;
    color: var(--text-muted);
  }

  .empty-state-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .empty-state-text {
    font-size: 1.1rem;
    margin-bottom: 0.5rem;
    font-weight: 600;
  }

  .empty-state-subtext {
    font-size: 0.9rem;
    color: var(--text-light);
  }

  /* --- ANIMATIONS --- */
  .lucide-spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* --- RESPONSIVE --- */
  @media (max-width: 1400px) {
    .chart-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 1024px) {
    .admin-layout { grid-template-columns: 1fr; }
    .admin-sidebar { flex-direction: row; overflow-x: auto; padding: 1rem; }
    .admin-brand { margin-bottom: 0; }
    .admin-nav { flex-direction: row; }
    .sidebar-section-label { display: none; }
    .admin-logout { margin-top: 0; width: auto; }
  }

  @media (max-width: 768px) {
    .admin-content { padding: 1.5rem; }
    .admin-title { font-size: 1.75rem; }
    .topbar-search { display: none; }
    .admin-stats-grid { grid-template-columns: repeat(2, 1fr); }
    .stat-card { flex-direction: column; text-align: center; }
    .user-grid { grid-template-columns: 1fr; }
    .admin-login-container { grid-template-columns: 1fr; }
    .admin-login-welcome { display: none; }
    .admin-modal { max-height: 95vh; }
  }
`;

// SVG Line Chart Component
const CustomLineChart = ({ data = [] }) => {
  if (!data || data.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📊</div>
        <div className="empty-state-text">No data available</div>
      </div>
    );
  }

  const svgHeight = 160;
  const svgWidth = 800;
  const paddingX = 50;
  const paddingY = 30;
  const effectiveWidth = svgWidth - paddingX * 2;
  const effectiveHeight = svgHeight - paddingY * 2;

  const maxVal = Math.max(...data.map(d => d.count || 0), 5);
  const points = data.map((d, i) => {
    const x = paddingX + (i / Math.max(data.length - 1, 1)) * effectiveWidth;
    const y = paddingY + effectiveHeight - ((d.count / maxVal) * effectiveHeight);
    return {
      x,
      y,
      dateLabel: new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' }),
      val: d.count
    };
  });

  const pathD = `M ${points[0].x},${points[0].y} ` + points.slice(1).map(p => `L ${p.x},${p.y}`).join(' ');
  const areaD = `${pathD} L ${points[points.length - 1].x},${svgHeight} L ${points[0].x},${svgHeight} Z`;

  return (
    <svg viewBox={`0 0 ${svgWidth} ${svgHeight + 40}`} className="svg-chart">
      <defs>
        <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.6" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
        <line
          key={`grid-${i}`}
          x1={paddingX}
          y1={paddingY + effectiveHeight * ratio}
          x2={svgWidth - paddingX}
          y2={paddingY + effectiveHeight * ratio}
          className="svg-grid-line"
        />
      ))}

      <path d={areaD} className="svg-area" />
      <path d={pathD} className="svg-line" />

      {points.map((p, i) => (
        <g key={`point-${i}`}>
          <circle cx={p.x} cy={p.y} r="4" className="svg-point">
            <title>{p.val} activities</title>
          </circle>
          <text x={p.x} y={svgHeight + 20} className="svg-text">
            {p.dateLabel}
          </text>
          {p.val > 0 && (
            <text x={p.x} y={p.y - 16} className="svg-text" style={{ fill: 'var(--accent)', fontWeight: '700' }}>
              {p.val}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
};

// StatCard Component
const StatCard = ({ icon: Icon, label, value, change, color = 'gold' }) => (
  <div className="stat-card">
    <div className={`stat-icon ${color}`}>
      <Icon size={28} />
    </div>
    <div className="stat-info">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {change !== undefined && (
        <div className={`stat-change ${change >= 0 ? 'positive' : 'negative'}`}>
          {change >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          {Math.abs(change)}% vs yesterday
        </div>
      )}
    </div>
  </div>
);

// FeatureList Component
const FeatureList = ({ title, icon: Icon, items = [] }) => (
  <div className="admin-panel">
    <div className="panel-header">
      <h3 className="panel-title">
        <Icon size={20} color="var(--accent)" />
        {title}
      </h3>
      <div className="panel-actions">
        <button className="panel-action-btn" title="Download">
          <Download size={16} />
        </button>
      </div>
    </div>
    {items.length === 0 ? (
      <div className="empty-state">
        <div className="empty-state-subtext">No data available</div>
      </div>
    ) : (
      <div className="list-container">
        <div className="list-header">
          <span>Name</span>
          <span>Count</span>
        </div>
        {items.map((item, idx) => (
          <div key={`item-${idx}`} className="list-row">
            <div className="list-name">{item.name || 'Unknown'}</div>
            <div className="list-badge">{(item.count || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Main Admin Portal Component
function AdminPortal() {
  const [password, setPassword] = useState('');
  const [authData, setAuthData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [adminTab, setAdminTab] = useState('overview');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUserEmail, setSelectedUserEmail] = useState(null);
  const [userDetailsData, setUserDetailsData] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [filterActive, setFilterActive] = useState('all');

  useEffect(() => {
    if (!authData) return;
    const timer = setInterval(() => setCurrentTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, [authData]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/data`, { password });
      setAuthData(res.data);
      setPassword('');
    } catch (err) {
      setError('Invalid password or access denied. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserDetails = async (email) => {
    setSelectedUserEmail(email);
    setLoadingDetails(true);
    setUserDetailsData(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/admin/user-details`, { password, email });

      const rawActivity = res.data.activityRaw || [];
      const sevenDaysActivity = [];
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
        const found = rawActivity.find(a => a._id === iso);
        sevenDaysActivity.push({ date: iso, count: found ? found.count : 0 });
      }

      const events = res.data.recentEventsRaw || [];
      const groupedEvents = {};
      events.forEach(ev => {
        const dateObj = new Date(ev.timestamp);
        const dateKey = dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        if (!groupedEvents[dateKey]) groupedEvents[dateKey] = [];
        groupedEvents[dateKey].push(ev);
      });

      setUserDetailsData({
        user: res.data.user,
        activityPattern: sevenDaysActivity,
        groupedEvents
      });
    } catch (err) {
      console.error(err);
      setError('Failed to fetch user details');
    } finally {
      setLoadingDetails(false);
    }
  };

  const timeAgo = (date) => {
    if (!date) return 'Never';
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatNum = (num) => (num ? num.toLocaleString('en-US') : '0');

  // Filter users - Fixed to avoid dependency issues
  const filteredUsers = authData?.users
    ?.filter(u =>
      (u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())) &&
      (filterActive === 'all' || (filterActive === 'online' && timeAgo(u.lastActive) === 'Just now'))
    ) || [];

  const dayName = currentTime.toLocaleDateString('en-US', { weekday: 'long' });
  const monthDay = currentTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (!authData) {
    return (
      <div className="admin-wrapper admin-login-screen">
        <style>{adminStyles}</style>
        <div className="admin-login-container">
          <div className="admin-login-welcome">
            <h1>Welcome Back</h1>
            <p>Access your secure admin dashboard to monitor platform analytics, manage users, and review feedback.</p>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon">
                  <BarChart3 size={18} />
                </div>
                <span>Real-time analytics dashboard</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <Users size={18} />
                </div>
                <span>Complete user management</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <Activity size={18} />
                </div>
                <span>Advanced activity tracking</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">
                  <Lock size={18} />
                </div>
                <span>Secure encrypted access</span>
              </div>
            </div>
          </div>

          <div className="admin-login-card">
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'inline-flex', background: 'var(--accent-light)', padding: '1rem', borderRadius: '18px' }}>
                <Hexagon size={44} color="var(--accent)" />
              </div>
            </div>
            <h2>Admin Access</h2>
            <p className="login-subtitle">Enter your administrator password to continue</p>
            <form onSubmit={handleLogin}>
              <div className="admin-input-group">
                <label>Password</label>
                <input
                  type="password"
                  className="admin-login-input"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              <button type="submit" className="admin-btn" disabled={loading || !password}>
                {loading ? (
                  <>
                    <Loader2 size={20} className="lucide-spin" />
                    Authenticating...
                  </>
                ) : (
                  <>
                    <Lock size={20} />
                    Unlock Dashboard
                  </>
                )}
              </button>
            </form>
            {error && (
              <div style={{
                color: 'var(--danger)',
                background: 'var(--danger-light)',
                padding: '12px',
                borderRadius: '10px',
                marginTop: '1.5rem',
                fontWeight: 600,
                fontSize: '0.9rem',
                display: 'flex',
                gap: '8px',
                alignItems: 'center'
              }}>
                <AlertCircle size={18} />
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const { analytics = {}, users = [], feedbacks = [] } = authData;
  const dau = analytics.dau || [];
  const traffic = analytics.traffic || [];
  const features = analytics.features || [];
  const interactions = analytics.interactions || [];

  const maxDau = dau.length > 0 ? Math.max(...dau.map(d => d.count || 0)) : 1;
  const maxTraffic = traffic.length > 0 ? Math.max(...traffic.map(d => d.hits || 0)) : 1;

  return (
    <div className="admin-wrapper admin-layout">
      <style>{adminStyles}</style>

      {/* MODAL */}
      {selectedUserEmail && (
        <div className="admin-modal-overlay" onClick={() => setSelectedUserEmail(null)}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            {loadingDetails ? (
              <div style={{ padding: '4rem', textAlign: 'center' }}>
                <Loader2 size={48} color="var(--accent)" className="lucide-spin" style={{ margin: '0 auto', marginBottom: '1rem' }} />
                <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>Loading Profile...</h3>
              </div>
            ) : userDetailsData ? (
              <>
                <div className="admin-modal-header">
                  <div className="admin-modal-user">
                    <img
                      src={userDetailsData.user.picture || `https://ui-avatars.com/api/?name=${userDetailsData.user.name}&background=dba315&color=fff`}
                      alt={userDetailsData.user.name}
                    />
                    <div className="modal-user-info">
                      <h2>{userDetailsData.user.name}</h2>
                      <div className="modal-user-meta">
                        <span><Mail size={14} /> {userDetailsData.user.email}</span>
                        <span><Badge size={14} /> Section {userDetailsData.user.defaultSection}</span>
                        <span style={{ color: userDetailsData.user.oltUsername ? 'var(--success)' : 'var(--danger)' }}>
                          <Radio size={14} /> {userDetailsData.user.oltUsername ? 'OLT Linked' : 'No OLT'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button className="admin-modal-close" onClick={() => setSelectedUserEmail(null)}>
                    <X size={20} />
                  </button>
                </div>

                <div className="admin-modal-body">
                  <div className="modal-section">
                    <h3 className="modal-section-title">
                      <TrendingUp size={20} color="var(--accent)" />
                      7-Day Activity Pattern
                    </h3>
                    <div className="svg-chart-container">
                      <CustomLineChart data={userDetailsData.activityPattern} />
                    </div>
                  </div>

                  <div className="modal-section">
                    <h3 className="modal-section-title">
                      <Clock size={20} color="var(--accent)" />
                      Session History
                    </h3>
                    {Object.keys(userDetailsData.groupedEvents).length === 0 ? (
                      <div className="empty-state">
                        <div className="empty-state-icon">🕐</div>
                        <div className="empty-state-text">No activity history</div>
                      </div>
                    ) : (
                      <div className="timeline-container">
                        {Object.entries(userDetailsData.groupedEvents).map(([dateLabel, events]) => (
                          <div key={dateLabel} className="timeline-day-group">
                            <div className="timeline-day-header">
                              <Calendar size={14} />
                              {dateLabel}
                            </div>
                            {events.map((ev, idx) => (
                              <div key={`${dateLabel}-${idx}`} className={`timeline-item ${ev.eventName === 'login' || ev.eventName === 'app_opened' ? 'open-event' : ''}`}>
                                <div className="timeline-content">
                                  <div className="timeline-time">
                                    <Clock size={12} />
                                    {new Date(ev.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                  <div className="timeline-action">
                                    {ev.eventName === 'login' || ev.eventName === 'app_opened' ? '🚀 Session Started' : ev.eventName.replace(/_/g, ' ')}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>
                Failed to load user details
              </div>
            )}
          </div>
        </div>
      )}

      {/* SIDEBAR */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <div className="icon-wrap">
            <LayoutDashboard size={24} color="#fff" />
          </div>
          Dashboard
        </div>

        <div className="admin-sidebar-section">
          <div className="sidebar-section-label">Main</div>
          <div className="admin-nav">
            <button
              className={`admin-nav-item ${adminTab === 'overview' ? 'active' : ''}`}
              onClick={() => setAdminTab('overview')}
            >
              <BarChart3 size={20} />
              Platform Overview
            </button>
            <button
              className={`admin-nav-item ${adminTab === 'users' ? 'active' : ''}`}
              onClick={() => setAdminTab('users')}
            >
              <Users size={20} />
              Users
            </button>
            <button
              className={`admin-nav-item ${adminTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setAdminTab('analytics')}
            >
              <LineChart size={20} />
              Analytics
            </button>
          </div>
        </div>

        <div className="admin-sidebar-section">
          <div className="sidebar-section-label">Settings</div>
          <div className="admin-nav">
            <button className="admin-nav-item">
              <Settings size={20} />
              Configuration
            </button>
          </div>
        </div>

        <button className="admin-logout" onClick={() => setAuthData(null)}>
          <LogOut size={20} />
          Logout
        </button>
      </aside>

      {/* MAIN CONTENT */}
      <div className="admin-main">
        {/* TOPBAR */}
        <div className="admin-topbar">
          <div className="topbar-left">
            <div>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '1.3rem', color: 'var(--text-main)', fontWeight: 700 }}>
                {adminTab === 'overview' && 'Platform Overview'}
                {adminTab === 'users' && 'User Management'}
                {adminTab === 'analytics' && 'Detailed Analytics'}
              </h2>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 500 }}>
                {dayName}, {monthDay}
              </p>
            </div>
            {adminTab === 'users' && (
              <div className="topbar-search">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="topbar-right">
            <button className="topbar-btn">
              <Bell size={18} />
              Notifications
            </button>
            <div className="topbar-user">
              <div className="topbar-user-avatar">A</div>
              <span style={{ fontWeight: 600 }}>Admin</span>
            </div>
          </div>
        </div>

        {/* CONTENT */}
        <div className="admin-content">
          {adminTab === 'overview' && (
            <>
              {/* STATS */}
              <div className="admin-stats-grid">
                <StatCard
                  icon={Users}
                  label="Total Users"
                  value={formatNum(users.length)}
                  change={12}
                  color="gold"
                />
                <StatCard
                  icon={Activity}
                  label="Active Today"
                  value={formatNum(dau[dau.length - 1]?.count || 0)}
                  change={8}
                  color="blue"
                />
                <StatCard
                  icon={Globe}
                  label="API Requests (24h)"
                  value={formatNum(traffic[traffic.length - 1]?.hits || 0)}
                  change={-5}
                  color="green"
                />
                <StatCard
                  icon={CheckCircle2}
                  label="OLT Setups"
                  value={formatNum(users.filter(u => u.oltUsername).length)}
                  change={3}
                  color="purple"
                />
                <StatCard
                  icon={MessageSquare}
                  label="Feedback"
                  value={formatNum(feedbacks.length)}
                  color="warning"
                />
                <StatCard
                  icon={Zap}
                  label="Avg Response"
                  value="124ms"
                  color="danger"
                />
              </div>

              {/* CHARTS */}
              <div className="chart-grid">
                <div className="admin-panel">
                  <div className="panel-header">
                    <h3 className="panel-title">
                      <TrendingUp size={20} color="var(--accent)" />
                      Daily Active Users
                    </h3>
                    <div className="panel-actions">
                      <button className="panel-action-btn" title="Download">
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="css-chart-wrapper">
                    {dau.length === 0 ? (
                      <div className="empty-state">No data</div>
                    ) : (
                      dau.map((d, i) => {
                        const heightPct = Math.max((d.count / maxDau) * 100, 5);
                        return (
                          <div className="css-chart-bar-container" key={`dau-${i}`}>
                            <div
                              className="css-chart-bar gold"
                              style={{ height: `${heightPct}%` }}
                              data-tooltip={`${formatNum(d.count)}`}
                            ></div>
                            <div className="css-chart-label">{d.date.split('-').slice(1).join('/')}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="admin-panel">
                  <div className="panel-header">
                    <h3 className="panel-title">
                      <Globe size={20} color="var(--info)" />
                      Server Traffic
                    </h3>
                    <div className="panel-actions">
                      <button className="panel-action-btn" title="Download">
                        <Download size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="css-chart-wrapper">
                    {traffic.length === 0 ? (
                      <div className="empty-state">No data</div>
                    ) : (
                      traffic.map((d, i) => {
                        const heightPct = Math.max((d.hits / maxTraffic) * 100, 5);
                        return (
                          <div className="css-chart-bar-container" key={`traffic-${i}`}>
                            <div
                              className="css-chart-bar green"
                              style={{ height: `${heightPct}%` }}
                              data-tooltip={`${formatNum(d.hits)}`}
                            ></div>
                            <div className="css-chart-label">{d.date.split('-').slice(1).join('/')}</div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* LISTS */}
              <div className="chart-grid">
                <FeatureList
                  title="Popular Features"
                  icon={MousePointer2}
                  items={features.map(f => ({
                    name: f._id?.replace('tab_', '').toUpperCase() || 'Unknown',
                    count: f.clicks || 0
                  }))}
                />
                <FeatureList
                  title="Top Button Clicks"
                  icon={Zap}
                  items={interactions.map(f => ({
                    name: f._id?.replace(/_/g, ' ') || 'Unknown',
                    count: f.count || 0
                  }))}
                />
              </div>
            </>
          )}

          {adminTab === 'users' && (
            <>
              <div className="action-bar">
                <div className="filter-group">
                  <button
                    className={`filter-btn ${filterActive === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterActive('all')}
                  >
                    All Users ({users.length})
                  </button>
                  <button
                    className={`filter-btn ${filterActive === 'online' ? 'active' : ''}`}
                    onClick={() => setFilterActive('online')}
                  >
                    <Radio size={14} />
                    Online
                  </button>
                </div>
              </div>

              {filteredUsers.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">👤</div>
                  <div className="empty-state-text">No users found</div>
                  <div className="empty-state-subtext">Try adjusting your search or filter</div>
                </div>
              ) : (
                <>
                  <div className="user-grid">
                    {filteredUsers.map(u => {
                      const timeAgoStr = timeAgo(u.lastActive);
                      const isOnline = timeAgoStr === 'Just now';

                      return (
                        <div key={u._id} className="user-card" onClick={() => fetchUserDetails(u.email)}>
                          <div className="user-card-header">
                            <img
                              src={u.picture || `https://ui-avatars.com/api/?name=${u.name}&background=dba315&color=fff`}
                              alt={u.name}
                              className="user-avatar"
                            />
                            {isOnline && <div className="user-status-badge"></div>}
                          </div>
                          <div className="user-info">
                            <div className="user-name">{u.name}</div>
                            <div className="user-email">{u.email}</div>
                            <div className="user-meta-item">
                              <MapPin size={14} />
                              Section {u.defaultSection}
                            </div>
                            <div className="user-meta-item">
                              <Clock size={14} />
                              {timeAgoStr}
                            </div>
                          </div>
                          <div className="user-actions">
                            <button className="user-action-btn">
                              <Eye size={16} />
                              View
                            </button>
                            <button className="user-action-btn">
                              <MoreVertical size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* FEEDBACK */}
                  <div style={{ marginTop: '3rem' }}>
                    <div className="admin-panel">
                      <div className="panel-header">
                        <h3 className="panel-title">
                          <MessageSquare size={20} color="var(--accent)" />
                          Recent Feedback ({feedbacks.length})
                        </h3>
                      </div>
                      {feedbacks.length === 0 ? (
                        <div className="empty-state">
                          <div className="empty-state-icon">💬</div>
                          <div className="empty-state-text">No feedback yet</div>
                        </div>
                      ) : (
                        <div className="feedback-list">
                          {feedbacks.slice(0, 5).map((f, idx) => (
                            <div key={`feedback-${idx}`} className="feedback-card">
                              <div className="fb-header">
                                <span className="fb-name">{f.userName}</span>
                                <span className="fb-date">
                                  {new Date(f.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                              <p className="fb-msg">"{f.message}"</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {adminTab === 'analytics' && (
            <>
              <div className="admin-panel">
                <div className="panel-header">
                  <h3 className="panel-title">
                    <LineChart size={20} color="var(--accent)" />
                    Detailed Activity Timeline
                  </h3>
                </div>
                <div className="svg-chart-container">
                  <CustomLineChart data={dau} />
                </div>
              </div>

              <div className="chart-grid">
                <FeatureList
                  title="All Features"
                  icon={BarChart3}
                  items={features.map(f => ({
                    name: f._id?.replace('tab_', '') || 'Unknown',
                    count: f.clicks || 0
                  }))}
                />
                <FeatureList
                  title="User Interactions"
                  icon={MousePointer2}
                  items={interactions.map(f => ({
                    name: f._id?.replace(/_/g, ' ') || 'Unknown',
                    count: f.count || 0
                  }))}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AdminPortal;
