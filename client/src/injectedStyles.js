export const getInjectedStyles = (hasTasksToday) => `
    /* --- MOBILE RESPONSIVENESS FIXES --- */
    @media (max-width: 768px) {
      .dashboard-layout {
        min-height: 100dvh;
      }

      .main-content {
        padding-bottom: ${hasTasksToday ? '160px' : '120px'} !important;
        transition: padding-bottom 0.3s ease;
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

      .admin-dashboard-layout {
        flex-direction: column !important;
        overflow: auto !important;
      }

      .admin-sidebar {
        width: 100% !important;
        border-right: none !important;
        border-bottom: 1px solid #e2e8f0;
        flex: none !important;
        max-height: 350px;
      }

      .feature-banner-actions {
        flex-direction: column;
        width: 100%;
      }

      .feature-banner-actions button {
        width: 100%;
        justify-content: center;
      }

      .mobile-refresh-fab {
        display: flex !important;
        bottom: calc(112px + env(safe-area-inset-bottom, 0px)) !important;
      }

      /* --- MOBILE ACCOUNT HEADER --- */
      .sidebar {
        display: none !important;
      }

      .dashboard-layout {
        min-height: 100dvh;
        width: 100%;
      }

      .mobile-topbar {
        display: flex !important;
        align-items: center;
        justify-content: space-between;
        position: sticky;
        top: 0;
        width: 100%;
        padding: 12px 16px 10px;
        background: var(--bg-primary, #08111f);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        z-index: 1100;
        box-sizing: border-box;
      }

      .mobile-profile-trigger {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex: 1;
        padding: 0;
        background: transparent;
        border: 0;
        color: var(--text-primary, #fff);
        text-align: left;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }

      .mobile-profile-avatar {
        width: 38px;
        height: 38px;
        flex: 0 0 38px;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(240, 200, 92, 0.65);
      }

      .mobile-profile-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .mobile-profile-name {
        font-size: 0.88rem;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .mobile-profile-section {
        font-size: 0.72rem;
        color: var(--text-secondary, #9aa4b2);
      }

      .mobile-profile-chevron {
        flex: 0 0 auto;
        color: #8d97a7;
        transition: transform 0.2s ease;
      }

      .mobile-profile-trigger.open .mobile-profile-chevron {
        transform: rotate(180deg);
      }

      .mobile-settings-btn {
        width: 40px;
        height: 40px;
        flex: 0 0 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: #c9d0db;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }

      .mobile-settings-btn:active {
        transform: scale(0.96);
      }

      .mobile-profile-menu {
        position: absolute;
        top: calc(100% - 2px);
        left: 12px;
        right: 12px;
        padding: 14px;
        border-radius: 18px;
        background: #121b2a;
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28);
        z-index: 1150;
      }

      .mobile-profile-menu-title {
        font-size: 0.75rem;
        font-weight: 700;
        color: #8f99aa;
        margin-bottom: 9px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .mobile-section-grid {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: 6px;
      }

      .mobile-section-btn {
        min-width: 0;
        height: 38px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.04);
        color: #b5bdca;
        font-size: 0.82rem;
        font-weight: 700;
        cursor: pointer;
      }

      .mobile-section-btn.active {
        background: #f0c85c;
        border-color: #f0c85c;
        color: #171717;
      }

      .mobile-profile-menu-divider {
        height: 1px;
        margin: 13px 0;
        background: rgba(255, 255, 255, 0.07);
      }

      .mobile-profile-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .mobile-profile-action {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 40px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        background: rgba(255, 255, 255, 0.04);
        color: #c7ced9;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
      }

      .mobile-profile-action.danger {
        color: #ef8888;
      }

      .main-content {
        width: 100%;
        padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px)) !important;
        box-sizing: border-box;
      }

      .mobile-bottom-nav {
        display: grid !important;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        align-items: center;
        gap: 4px;
        position: fixed;
        left: 50%;
        bottom: max(12px, env(safe-area-inset-bottom, 12px));
        transform: translateX(-50%);
        width: calc(100% - 20px);
        max-width: 560px;
        min-height: 80px;
        padding: 8px;
        background: #1b2332;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 26px;
        box-shadow:
          0 18px 45px rgba(10, 16, 28, 0.28),
          0 4px 14px rgba(10, 16, 28, 0.18);
        z-index: 1200;
        box-sizing: border-box;
        -webkit-backdrop-filter: blur(18px);
        backdrop-filter: blur(18px);
      }

      .mobile-bottom-nav-btn {
        position: relative;
        min-width: 0;
        min-height: 62px;
        padding: 6px 4px;
        border: 0;
        border-radius: 18px;
        background: transparent;
        color: #aeb5c2;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 4px;
        font-family: inherit;
        font-size: 0.78rem;
        font-weight: 500;
        line-height: 1.1;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
        transition:
          background-color 0.22s ease,
          color 0.22s ease,
          transform 0.22s ease;
      }

      .mobile-bottom-nav-btn svg {
        flex-shrink: 0;
        stroke-width: 1.9;
      }

      .mobile-bottom-nav-btn.active {
        background: #f0c85c;
        color: #171717;
        font-weight: 800;
        transform: translateY(-1px);
        box-shadow: 0 5px 18px rgba(240, 200, 92, 0.2);
      }

      .mobile-bottom-nav-btn:active {
        transform: scale(0.97);
      }

      .mobile-bottom-nav-btn.active:active {
        transform: translateY(-1px) scale(0.97);
      }

      .mobile-bottom-nav-badge {
        position: absolute;
        top: 10px;
        right: 18%;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #e53935;
        border: 2px solid #1b2332;
        box-sizing: content-box;
      }

      .mobile-bottom-nav-btn.active .mobile-bottom-nav-badge {
        border-color: #f0c85c;
      }

      .mobile-refresh-fab {
        bottom: calc(112px + env(safe-area-inset-bottom, 0px)) !important;
      }

      .todo-summary-bar {
        bottom: calc(108px + env(safe-area-inset-bottom, 0px)) !important;
        border-radius: 16px !important;
      }
    }

    .mobile-topbar {
      display: none;
    }

    @media (min-width: 769px) {
      .mobile-topbar {
        display: none !important;
      }

      .mobile-bottom-nav {
        display: none !important;
      }
    }

    /* --- ASSIGNMENTS STYLES --- */
    .assignments-container {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .assignments-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .assignment-card {
      background: #ffffff;
      color: #1e293b;
      border-radius: 12px;
      padding: 1rem 1.25rem;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03);
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s ease;
    }

    .assignment-card:hover {
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.06);
      transform: translateY(-1px);
    }

    .assignment-title {
      font-weight: 700;
      font-size: 1rem;
      color: #0f172a;
      margin-bottom: 6px;
    }

    .assignment-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: #64748b;
    }

    .assignment-status-tag {
      font-size: 0.75rem;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-completed {
      background: #dcfce7;
      color: #15803d;
    }

    .status-pending {
      background: #fef9c3;
      color: #a16207;
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

    .dot-wave {
      display: flex;
      gap: 12px;
    }

    .dot-wave .dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: var(--accent-gold, #dba315);
      animation: smooth-wave 1.4s ease-in-out infinite;
      box-shadow: 0 4px 10px rgba(219, 163, 21, 0.3);
    }

    .dot-wave .dot:nth-child(1) { animation-delay: 0s; }
    .dot-wave .dot:nth-child(2) { animation-delay: 0.15s; }
    .dot-wave .dot:nth-child(3) { animation-delay: 0.3s; }

    @keyframes smooth-wave {
      0%, 100% {
        transform: translateY(0) scale(0.8);
        opacity: 0.3;
      }
      50% {
        transform: translateY(-14px) scale(1.1);
        opacity: 1;
      }
    }

    .loading-text {
      color: var(--text-secondary, #888);
      font-size: 1.05rem;
      font-weight: 500;
      letter-spacing: 0.5px;
      animation: pulse-text 2s ease-in-out infinite;
    }

    @keyframes pulse-text {
      0%, 100% { opacity: 0.5; }
      50% { opacity: 1; }
    }

    /* --- PREMIUM SWIPE NAVIGATION --- */
    .mobile-swipe-hint {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 6px;
      color: var(--text-secondary, #888);
      font-size: 0.78rem;
      opacity: 0.65;
      margin: 0 0 0.75rem 0;
      user-select: none;
    }

    .timetable-section {
      touch-action: pan-y;
      overflow-x: hidden;
    }

    .day-anim-wrapper {
      width: 100%;
      will-change: transform, opacity;
    }

    @keyframes premiumSlideInRight {
      from { transform: translateX(45px) scale(0.98); opacity: 0; }
      to { transform: translateX(0) scale(1); opacity: 1; }
    }

    @keyframes premiumSlideInLeft {
      from { transform: translateX(-45px) scale(0.98); opacity: 0; }
      to { transform: translateX(0) scale(1); opacity: 1; }
    }

    @keyframes premiumFadeIn {
      from { transform: translateY(12px) scale(0.99); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    .swipe-left { animation: premiumSlideInRight 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .swipe-right { animation: premiumSlideInLeft 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .fade-in { animation: premiumFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

    /* --- TUTORIAL OVERLAY --- */
    .swipe-tutorial-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 15, 15, 0.6);
      backdrop-filter: blur(3px);
      z-index: 9999;
      display: none;
      align-items: center;
      justify-content: center;
      animation: tutorialOverlayFade 0.35s ease forwards;
      -webkit-tap-highlight-color: transparent;
    }

    @keyframes tutorialOverlayFade {
      from { opacity: 0; }
      to { opacity: 1; }
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
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .swipe-tutorial-track {
      position: relative;
      width: 130px;
      height: 64px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

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
      0% { transform: translateX(38px) rotate(-6deg); opacity: 0; }
      14% { opacity: 1; }
      50% { transform: translateX(-38px) rotate(6deg); opacity: 1; }
      68% { opacity: 0; }
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

    .modal-content textarea,
    .todo-input-form input {
      color: #333 !important;
      background-color: #fff !important;
    }

    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .modal-content {
      background: white;
      padding: 2rem;
      border-radius: 16px;
      width: 90%;
      max-width: 400px;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      color: #333;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      animation: popIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes popIn {
      0% { opacity: 0; transform: scale(0.95); }
      100% { opacity: 1; transform: scale(1); }
    }

    .modal-content textarea {
      width: 100%;
      height: 100px;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid #ccc;
      font-family: inherit;
      resize: none;
    }

    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-submit {
      background: var(--accent-gold);
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
    }

    .btn-submit:disabled {
      background: #d0b875;
      cursor: not-allowed;
    }

    .btn-cancel {
      background: #eee;
      color: #333;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
    }

    .btn-cancel:disabled {
      background: #f5f5f5;
      color: #999;
      cursor: not-allowed;
    }

    .btn-text {
      background: none;
      border: none;
      color: #888;
      font-weight: 500;
      cursor: pointer;
      padding: 8px;
      width: 100%;
      text-decoration: underline;
    }

    .olt-glow-modal {
      background: linear-gradient(to bottom, #fff, #fefdf9);
      border: 1px solid var(--accent-gold);
      box-shadow: 0 0 20px rgba(219, 163, 21, 0.2);
      text-align: center;
    }

    .olt-glow-modal h3 {
      color: var(--accent-gold);
      font-size: 1.4rem;
      margin: 0;
    }

    .settings-section-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }

    .settings-section-btn {
      padding: 10px 0;
      border-radius: 8px;
      border: 1px solid #ddd;
      background: #fafafa;
      color: #333;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .settings-section-btn.active {
      background: var(--accent-gold);
      border-color: var(--accent-gold);
      color: #fff;
    }

    .settings-status-text {
      font-size: 0.85rem;
      color: var(--accent-gold);
      font-weight: 600;
    }

    .feature-banner {
      background: linear-gradient(
        135deg,
        rgba(219, 163, 21, 0.12),
        rgba(219, 163, 21, 0.04)
      );
      border: 1px solid rgba(219, 163, 21, 0.25);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 10px;
      color: var(--text-primary, #fff);
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    .feature-banner-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .feature-banner-title {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent-gold);
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }

    .feature-banner-text {
      font-size: 0.9rem;
      color: #d0d0d0;
      margin: 0;
      line-height: 1.5;
    }

    .feature-banner-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 5px;
    }

    .btn-banner-primary {
      background: var(--accent-gold);
      color: #fff;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      transition: background 0.2s;
    }

    .btn-banner-primary:hover {
      background: #c59212;
    }

    .btn-banner-secondary {
      background: rgba(255,255,255,0.05);
      color: #ddd;
      border: 1px solid rgba(255,255,255,0.15);
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      transition: all 0.2s;
    }

    .btn-banner-secondary:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }

    .btn-banner-close {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: all 0.2s;
    }

    .btn-banner-close:hover {
      background: rgba(255,255,255,0.1);
      color: #fff;
    }

    .live-data-banner {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      background: rgba(76, 175, 80, 0.08);
      border: 1px solid rgba(76, 175, 80, 0.25);
      color: #2f6b32;
      border-radius: 10px;
      padding: 8px 14px;
      font-size: 0.82rem;
      margin-bottom: 1rem;
    }

    .live-data-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4caf50;
      box-shadow: 0 0 0 rgba(76, 175, 80, 0.5);
      animation: liveDotPulse 1.8s infinite;
      flex-shrink: 0;
    }

    @keyframes liveDotPulse {
      0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.5); }
      70% { box-shadow: 0 0 0 6px rgba(76, 175, 80, 0); }
      100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
    }

    .live-data-banner strong { font-weight: 700; }
    .live-data-meta { color: #4a7a4c; opacity: 0.85; }

    .session-badge {
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0.3px;
      color: var(--accent-gold);
      background: rgba(219, 163, 21, 0.12);
      border: 1px solid rgba(219, 163, 21, 0.3);
      border-radius: 6px;
      padding: 2px 8px;
      margin-top: 6px;
      display: inline-block;
    }

    .class-header-flex {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .add-task-btn {
      background: rgba(219, 163, 21, 0.1);
      border: 1px solid rgba(219, 163, 21, 0.3);
      border-radius: 8px;
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--accent-gold);
      position: relative;
      transition: all 0.2s ease;
    }

    .add-task-btn:hover { background: rgba(219, 163, 21, 0.2); }

    .task-indicator {
      position: absolute;
      top: -3px;
      right: -3px;
      background: red;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: 1.5px solid white;
    }

    .todo-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 2000;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      animation: fadeOverlay 0.3s ease;
    }

    @keyframes fadeOverlay {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .todo-bottom-sheet {
      background: white;
      width: 100%;
      max-width: 600px;
      border-radius: 20px 20px 0 0;
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      box-shadow: 0 -4px 20px rgba(0,0,0,0.15);
      animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      max-height: 80vh;
      color: #333;
    }

    @keyframes slideUp {
      from { transform: translateY(100%); }
      to { transform: translateY(0); }
    }

    .todo-sheet-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #eee;
      padding-bottom: 1rem;
    }

    .todo-subject { margin: 0; font-size: 1.2rem; color: #333; }
    .todo-date { margin: 4px 0 0 0; font-size: 0.85rem; color: #888; }

    .todo-close-btn {
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: #666;
      border-radius: 50%;
      display: flex;
    }

    .todo-close-btn:hover { background: #f5f5f5; }

    .todo-list-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 4px 0;
    }

    .todo-empty {
      text-align: center;
      color: #aaa;
      font-style: italic;
      padding: 2rem 0;
      font-size: 0.9rem;
    }

    .todo-item {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #f9f9f9;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #eee;
      transition: all 0.2s;
      color: #333;
    }

    .todo-item.completed { opacity: 0.6; }
    .todo-item.completed .todo-text { text-decoration: line-through; color: #888; }

    .todo-check-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      display: flex;
      align-items: center;
    }

    .todo-text { flex: 1; font-size: 0.95rem; word-break: break-word; }

    .todo-delete-btn {
      background: none;
      border: none;
      color: #ff4d4f;
      padding: 6px;
      cursor: pointer;
      border-radius: 6px;
      display: flex;
    }

    .todo-delete-btn:hover { background: #fff1f0; }

    .todo-input-form {
      display: flex;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid #eee;
    }

    .todo-input-form input {
      flex: 1;
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
      outline: none;
    }

    .todo-input-form input:focus { border-color: var(--accent-gold); }

    .todo-input-form button {
      background: var(--accent-gold);
      color: white;
      border: none;
      padding: 0 16px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .todo-input-form button:disabled { background: #e0c88b; cursor: not-allowed; }

    .todo-summary-bar {
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      background: white;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
      border-radius: 16px 16px 0 0;
      z-index: 100;
      display: flex;
      flex-direction: column;
      transition: max-height 0.3s ease;
      max-height: 60px;
      overflow: hidden;
      color: #333;
    }

    @media (min-width: 769px) {
      .todo-summary-bar {
        width: calc(100% - 260px);
        left: 260px;
      }
    }

    .todo-summary-bar.expanded { max-height: 40vh; }

    .todo-summary-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.5rem;
      cursor: pointer;
      background: white;
      user-select: none;
    }

    .todo-summary-info {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.95rem;
      color: #333;
    }

    .todo-summary-list {
      padding: 0 1.5rem 1.5rem 1.5rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .todo-summary-subject-group {
      background: #fcfcfc;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
    }

    .todo-summary-subject-title {
      font-size: 0.8rem;
      font-weight: 700;
      color: #666;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .todo-summary-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.9rem;
      margin-bottom: 6px;
    }

    .todo-summary-item:last-child { margin-bottom: 0; }
    .todo-summary-item.completed { opacity: 0.5; text-decoration: line-through; }

    .todo-summary-text {
      flex: 1;
      word-break: break-word;
      line-height: 1.4;
      margin-top: -1px;
    }

    .mobile-refresh-fab {
      display: none;
      position: fixed;
      bottom: 85px;
      right: 20px;
      z-index: 900;
      background: white;
      color: var(--accent-gold);
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: 1px solid rgba(219,163,21,0.3);
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 15px rgba(0,0,0,0.15);
      cursor: pointer;
    }

    .spinning { animation: spin 1s linear infinite; }
    @keyframes spin { 100% { transform: rotate(360deg); } }

    .admin-container-fluid {
      font-family: 'Inter', system-ui, sans-serif;
      color: #0f172a;
      height: 100vh;
      background: #f8fafc;
    }

    .admin-login {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      background: #f8fafc;
    }

    .admin-login-box {
      background: white;
      padding: 3rem;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.05);
      text-align: center;
      width: 90%;
      max-width: 400px;
    }

    .admin-login input {
      padding: 12px;
      margin-bottom: 12px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      width: 100%;
      color: #0f172a;
      background: #fff;
      box-sizing: border-box;
    }

    .admin-login button {
      background: var(--accent-gold);
      color: white;
      padding: 12px 20px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      width: 100%;
      transition: opacity 0.2s;
    }

    .admin-login button:hover { opacity: 0.9; }

    .admin-dashboard-layout {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: #f8fafc;
    }

    .admin-sidebar {
      width: 280px;
      background: #ffffff;
      border-right: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      box-shadow: 2px 0 10px rgba(0,0,0,0.02);
      z-index: 10;
    }

    .admin-tabs {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 1.5rem;
    }

    .admin-tab {
      background: transparent;
      border: none;
      padding: 14px 20px;
      font-size: 0.95rem;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      border-radius: 10px;
      transition: all 0.2s ease;
      text-align: left;
      display: flex;
      align-items: center;
    }

    .admin-tab.active {
      background: rgba(219,163,21,0.1);
      color: var(--accent-gold);
    }

    .admin-tab:hover:not(.active) {
      background: #f1f5f9;
      color: #0f172a;
    }

    .admin-main-content {
      flex: 1;
      overflow-y: auto;
      padding: 2.5rem;
    }

    .admin-header-title {
      font-size: 1.75rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 1.5rem 0;
    }

    .admin-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .admin-stat-card {
      background: #ffffff;
      padding: 24px;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }

    .admin-stat-card .label {
      font-size: 0.85rem;
      color: #64748b;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .admin-stat-card .value {
      font-size: 2.2rem;
      font-weight: 800;
      color: #0f172a;
    }

    .admin-stat-card .value.gold { color: var(--accent-gold); }

    .admin-charts-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
      gap: 24px;
      margin-bottom: 30px;
    }

    @media (max-width: 768px) {
      .admin-charts-container { grid-template-columns: 1fr; }
    }

    .admin-chart-box {
      background: #ffffff;
      padding: 24px;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }

    .admin-chart-box h3 {
      margin: 0 0 20px 0;
      font-size: 1.1rem;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
    }

    .css-bar-chart {
      display: flex;
      align-items: flex-end;
      justify-content: space-around;
      height: 220px;
      padding-top: 30px;
      border-bottom: 2px solid #f1f5f9;
    }

    .css-bar-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      width: 12%;
      height: 100%;
    }

    .css-bar {
      width: 100%;
      background: var(--accent-gold);
      border-radius: 6px 6px 0 0;
      position: relative;
      min-height: 4px;
      transition: height 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .css-bar.green { background: #10b981; }

    .css-bar:hover::after {
      content: attr(data-val);
      position: absolute;
      top: -32px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: white;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      white-space: nowrap;
      z-index: 10;
    }

    .css-bar-label {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 500;
      text-align: center;
    }

    .interaction-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .interaction-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      background: #f8fafc;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
      transition: background 0.2s;
    }

    .interaction-row:hover { background: #f1f5f9; }

    .interaction-row-name {
      font-weight: 600;
      font-size: 0.95rem;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .interaction-row-count {
      background: #ffffff;
      color: var(--accent-gold);
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.85rem;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }

    .active-user-card {
      display: flex;
      align-items: center;
      gap: 15px;
      padding: 16px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      margin-bottom: 12px;
      transition: all 0.2s ease;
    }

    .active-user-card:hover {
      border-color: #cbd5e1;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
      transform: translateY(-1px);
    }

    .active-user-avatar {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid #f1f5f9;
    }

    .active-user-info { flex: 1; overflow: hidden; }

    .active-user-name {
      font-weight: 700;
      font-size: 1rem;
      color: #0f172a;
      margin-bottom: 4px;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
    }

    .active-user-email {
      font-size: 0.85rem;
      color: #64748b;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .active-user-time { text-align: right; }

    .active-user-time-val {
      font-size: 0.9rem;
      font-weight: 600;
      color: #334155;
    }

    .active-user-time-label {
      font-size: 0.75rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }

    .online-indicator {
      display: inline-block;
      width: 8px;
      height: 8px;
      background: #10b981;
      border-radius: 50%;
      margin-right: 6px;
      box-shadow: 0 0 0 2px #d1fae5;
    }

    .feedback-card {
      background: #fefce8;
      padding: 20px;
      margin-bottom: 16px;
      border-radius: 12px;
      border: 1px solid #fef08a;
      border-left: 5px solid var(--accent-gold);
      color: #0f172a;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }

    .feedback-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .feedback-name { font-weight: 700; font-size: 1rem; color: #0f172a; }
    .feedback-time { font-size: 0.8rem; color: #854d0e; font-weight: 500; }

    .feedback-msg {
      margin: 0;
      font-size: 0.95rem;
      color: #334155;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .attendance-container {
      max-width: 800px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 1.2rem;
    }

    .creds-card {
      background: white;
      color: #333;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
      text-align: center;
    }

    .creds-card h3 { color: #111; margin-top: 0; margin-bottom: 0.5rem; }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: left;
      margin-bottom: 1rem;
      color: #333;
    }

    .input-group input {
      padding: 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 1rem;
      color: #333;
      background: #fff;
    }

    .input-group input:focus { outline: none; border-color: var(--accent-gold); }

    .attendance-summary-card {
      background: linear-gradient(135deg, #1e1e1e, #2d2d2d);
      color: white;
      padding: 1.5rem;
      border-radius: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }

    .summary-stat { text-align: center; }

    .summary-stat .value {
      font-size: 1.8rem;
      font-weight: bold;
      color: var(--accent-gold);
    }

    .summary-stat .label {
      font-size: 0.8rem;
      opacity: 0.8;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #eee;
    }

    .subject-card {
      background: white;
      color: #333;
      border-radius: 10px;
      border: 1px solid #eee;
      overflow: hidden;
      transition: all 0.2s;
    }

    .subject-header {
      padding: 1rem 1.2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      background: #fafafa;
      border-bottom: 1px solid transparent;
    }

    .subject-header:hover { background: #f0f0f0; }
    .subject-title { font-weight: 700; font-size: 0.95rem; flex: 1; color: #111; }

    .subject-stats {
      display: flex;
      align-items: center;
      gap: 15px;
      font-size: 0.9rem;
      color: #444;
    }

    .progress-bar {
      width: 60px;
      height: 6px;
      background: #ddd;
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-fill { height: 100%; border-radius: 3px; }

    .class-list {
      padding: 0 1.2rem;
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
      background: #fff;
    }

    .class-list.expanded {
      max-height: 500px;
      padding: 1rem 1.2rem;
      overflow-y: auto;
      border-top: 1px solid #eee;
    }

    .class-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px dashed #eee;
      font-size: 0.85rem;
      color: #444;
    }

    .class-row:last-child { border-bottom: none; }

    .status-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 0.75rem;
    }

    .status-p { background: rgba(76, 175, 80, 0.1); color: #2e7d32; }
    .status-a { background: rgba(244, 67, 54, 0.1); color: #d32f2f; }

    .mismatch-card { max-width: 460px; margin: 3rem auto; }

    .attendance-fetch-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 55vh;
      gap: 1.5rem;
      width: 100%;
      max-width: 360px;
      margin: 0 auto;
    }

    .fetch-progress-ring {
      --pct: 0;
      position: relative;
      width: 108px;
      height: 108px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: conic-gradient(
        var(--accent-gold, #dba315) calc(var(--pct) * 1%),
        rgba(219, 163, 21, 0.12) 0
      );
      transition: background 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .fetch-progress-ring::before {
      content: '';
      position: absolute;
      inset: 8px;
      border-radius: 50%;
      background: var(--bg-primary, #fff);
      box-shadow: inset 0 0 0 1px rgba(0,0,0,0.04);
    }

    .fetch-progress-ring-label {
      position: relative;
      z-index: 1;
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--accent-gold, #dba315);
      letter-spacing: 0.3px;
    }

    .fetch-progress-message {
      color: var(--text-primary, #333);
      font-size: 0.98rem;
      font-weight: 500;
      text-align: center;
      min-height: 1.4em;
      transition: opacity 0.3s ease;
      letter-spacing: 0.1px;
    }

    .fetch-progress-bar-track {
      width: 100%;
      height: 6px;
      border-radius: 4px;
      background: rgba(219, 163, 21, 0.12);
      overflow: hidden;
    }

    .fetch-progress-bar-fill {
      height: 100%;
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        var(--accent-gold, #dba315),
        #eccb6b
      );
      transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .fetch-progress-steps {
      display: flex;
      gap: 6px;
    }

    .fetch-progress-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: rgba(219, 163, 21, 0.2);
      transition: background 0.4s ease, transform 0.4s ease;
    }

    .fetch-progress-dot.done { background: var(--accent-gold, #dba315); }
    .fetch-progress-dot.current {
      background: var(--accent-gold, #dba315);
      animation: fetchDotPulse 1.1s ease-in-out infinite;
    }

    @keyframes fetchDotPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.5); opacity: 0.6; }
    }
  `;