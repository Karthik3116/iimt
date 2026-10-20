import axios from 'axios';
import { googleLogout } from '@react-oauth/google';

export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
export const GOOGLE_CLIENT_ID = '22723173918-29qq25jdlpd7kmoeuk8682p0if6vm4gb.apps.googleusercontent.com';

export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:5000';

export const SWIPE_THRESHOLD = 40;
export const SWIPE_HINT_MAX_SHOWS = 3;
export const SWIPE_HINT_STORAGE_KEY = 'iimt_swipe_hint_shown_count';
export const SWIPE_HINT_AUTO_DISMISS_MS = 3200;
export const SECTION_STORAGE_KEY = 'iimt_section';

export const BANNER_STORAGE_KEY = 'iimt_attendance_banner_dismissed';
export const BANNER_START_KEY = 'iimt_attendance_banner_start';

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