import React from 'react';
import { BookOpen, AlertCircle, RefreshCw, Clock3 } from 'lucide-react';

function AssignmentsTab({
  mheUsername,
  setMheUsername,
  mhePassword,
  setMhePassword,
  mheSectionId,
  setMheSectionId,
  assignments,
  assignmentsError,
  isFetchingAssignments,
  fetchMcGrawAssignments
}) {
  return (
    <div className="assignments-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h2 className="view-title" style={{ margin: 0 }}>McGraw Hill Connect Assignments</h2>
      </div>

      <div className="creds-card">
        <BookOpen size={40} color="var(--accent-gold)" style={{ marginBottom: '0.5rem' }} />
        <h3>Extract McGraw Hill Connect Assignments</h3>
        <p style={{ color: '#666', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
          Enter your credentials and your class section ID to automatically fetch all upcoming assignments due from Oct 11, 2026 onwards.
        </p>

        <div className="input-group">
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>McGraw Hill Username / Email</label>
          <input
            type="email"
            placeholder="e.g. student@iimtrichy.ac.in"
            value={mheUsername}
            onChange={(e) => setMheUsername(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>McGraw Hill Password</label>
          <input
            type="password"
            placeholder="Enter your McGraw Hill password"
            value={mhePassword}
            onChange={(e) => setMhePassword(e.target.value)}
          />
        </div>

        <div className="input-group">
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Class Section ID</label>
          <input
            type="text"
            placeholder="e.g. 15829471"
            value={mheSectionId}
            onChange={(e) => setMheSectionId(e.target.value)}
          />
        </div>

        {assignmentsError && (
          <div style={{ background: '#fff1f0', color: '#d32f2f', padding: '10px 14px', borderRadius: '8px', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{assignmentsError}</span>
          </div>
        )}

        <button
          className="btn-submit"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
          onClick={fetchMcGrawAssignments}
          disabled={isFetchingAssignments}
        >
          {isFetchingAssignments ? (
            <>
              <RefreshCw size={18} className="spinning" />
              <span>Launching Browser Automation Scraper...</span>
            </>
          ) : (
            <>
              <BookOpen size={18} />
              <span>Extract Assignments</span>
            </>
          )}
        </button>
      </div>

      {assignments && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#333' }}>
              Assignments ({assignments.length})
            </h3>
          </div>

          {assignments.length === 0 ? (
            <div className="empty-state">No upcoming assignments found due after Oct 11, 2026.</div>
          ) : (
            <div className="assignments-grid">
              {assignments.map((item, idx) => {
                const isSubmitted = item.status === 'SUBMITTED' || item.status === 'COMPLETED';
                return (
                  <div key={idx} className="assignment-card">
                    <div>
                      <div className="assignment-title">{item.name}</div>
                      <div className="assignment-meta">
                        <Clock3 size={15} color="var(--accent-gold)" />
                        <span>Due: {item.dueDate}</span>
                      </div>
                    </div>
                    <div>
                      <span className={`assignment-status-tag ${isSubmitted ? 'status-completed' : 'status-pending'}`}>
                        {item.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AssignmentsTab;