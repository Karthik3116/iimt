import React from 'react';
import { ClipboardCheck, AlertCircle, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react';
import CredentialForm from './CredentialForm';
import { trackEvent } from './config';

function AttendanceTab({
  hasOltCreds,
  showCredsForm,
  setShowCredsForm,
  saveCredentials,
  attendanceData,
  setAttendanceData,
  attendanceError,
  attendanceFetchedSection,
  isFetchingAttendance,
  fetchAttendance,
  fetchProgress,
  expandedSubject,
  setExpandedSubject,
  term,
  setTerm,
  section,
  setSettingsSectionDraft,
  setShowSettingsModal
}) {
  if (!hasOltCreds || showCredsForm) {
    return (
      <CredentialForm
        onSubmit={saveCredentials}
        onCancel={() => {
          setShowCredsForm(false);
          trackEvent(
            'action',
            'cancel_creds_form'
          );
        }}
        hasCreds={hasOltCreds}
      />
    );
  }

  if (!attendanceData && !isFetchingAttendance) {
    return (
      <div className="empty-state">
        <ClipboardCheck
          size={48}
          color="var(--accent-gold)"
          style={{
            opacity: 0.5,
            marginBottom: '1rem'
          }}
        />

        <h3>View Your Attendance</h3>

        <p>
          Sync your live attendance directly from the OLT portal.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Term:</span>
              <select
                value={term}
                onChange={(e) => {
                  setTerm(e.target.value);
                  trackEvent('action', 'change_term', { to: e.target.value });
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #ddd',
                  background: '#fff',
                  color: '#333',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="Term-I">Term-I</option>
                <option value="Term-II">Term-II</option>
              </select>
          </div>
          
          <div>
              <button
                className="btn-submit"
                onClick={fetchAttendance}
              >
                Fetch Now
              </button>

              <button
                className="btn-cancel"
                onClick={() => {
                  setShowCredsForm(true);
                  trackEvent(
                    'button_click',
                    'update_creds'
                  );
                }}
                style={{
                  marginLeft: '10px'
                }}
              >
                Update Credentials
              </button>
          </div>
        </div>
      </div>
    );
  }

  if (isFetchingAttendance) {
    const total = fetchProgress.total || 8;
    const step = Math.min(
      fetchProgress.step || 0,
      total
    );

    const pct = Math.round(
      (step / total) * 100
    );

    return (
      <div className="attendance-fetch-progress">
        <div
          className="fetch-progress-ring"
          style={{ '--pct': pct }}
        >
          <span className="fetch-progress-ring-label">
            {pct}%
          </span>
        </div>

        <div className="fetch-progress-message">
          {fetchProgress.message ||
            'Connecting to OLT Portal…'}
        </div>

        <div className="fetch-progress-bar-track">
          <div
            className="fetch-progress-bar-fill"
            style={{ width: `${pct}%` }}
          />
        </div>

        <div className="fetch-progress-steps">
          {Array.from({ length: total }).map(
            (_, i) => (
              <span
                key={i}
                className={`fetch-progress-dot ${
                  i < step ? 'done' : ''
                } ${
                  i === step ? 'current' : ''
                }`}
              />
            )
          )}
        </div>
      </div>
    );
  }

  let overallAttended = 0;
  let overallTotal = 0;

  Object.values(
    attendanceData || {}
  ).forEach(sub => {
    if (sub.notStarted) return;
    overallAttended += sub.attended;
    overallTotal += sub.total;
  });

  const overallPercentage =
    overallTotal > 0
      ? (
          (overallAttended / overallTotal) *
          100
        ).toFixed(1)
      : 0;

  const subjectCount =
    Object.keys(attendanceData || {}).length;

  const noRecordsMatched =
    subjectCount === 0 ||
    overallTotal === 0;

  const sectionMismatch =
    attendanceFetchedSection &&
    attendanceFetchedSection !== section;

  if (noRecordsMatched) {
    return (
      <div className="attendance-container">
        <div className="creds-card mismatch-card">
          <AlertCircle
            size={40}
            color="var(--accent-gold)"
            style={{
              marginBottom: '1rem'
            }}
          />

          <h3>
            No Attendance Records Found
          </h3>

          {sectionMismatch ? (
            <p
              style={{
                color: '#666',
                fontSize: '0.9rem',
                marginBottom: '1.5rem'
              }}
            >
              We fetched attendance for{' '}
              <strong>
                Section {attendanceFetchedSection}
              </strong>
              , but you're currently browsing{' '}
              <strong>
                Section {section}
              </strong>
              . Attendance is always fetched for your actual class section. If that's still{' '}
              {attendanceFetchedSection}, switch the timetable section back below. Otherwise, your OLT credentials may need updating.
            </p>
          ) : (
            <p
              style={{
                color: '#666',
                fontSize: '0.9rem',
                marginBottom: '1.5rem'
              }}
            >
              We couldn't match your roll number in Section{' '}
              {attendanceFetchedSection ||
                section}'s attendance records for {term}. This can happen if you recently browsed a different timetable section, selected a term with no scheduled classes, or if your saved OLT credentials have changed.
            </p>
          )}

          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'center'
            }}
          >
            {sectionMismatch && (
              <button
                className="btn-submit"
                onClick={() => {
                  setSettingsSectionDraft(
                    attendanceFetchedSection
                  );
                  setShowSettingsModal(true);
                  trackEvent(
                    'action',
                    'fix_section_mismatch'
                  );
                }}
              >
                Switch back to Section{' '}
                {attendanceFetchedSection}
              </button>
            )}

            <button
              className="btn-cancel"
              onClick={() => setAttendanceData(null)}
            >
              Go Back
            </button>

            <button
              className="btn-cancel"
              onClick={() =>
                setShowCredsForm(true)
              }
            >
              Update Credentials
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="attendance-container">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          marginBottom: '10px'
        }}
      >
        <h2
          className="view-title"
          style={{ margin: 0 }}
        >
          Attendance Overview
        </h2>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setAttendanceData(null);
              trackEvent('action', 'change_term', { to: e.target.value });
            }}
            style={{
              padding: '7px 12px',
              borderRadius: '8px',
              border: '1px solid #ddd',
              background: '#fff',
              color: '#333',
              fontSize: '0.85rem',
              fontWeight: '600',
              outline: 'none',
              cursor: 'pointer'
            }}
            disabled={isFetchingAttendance}
          >
            <option value="Term-I">Term-I</option>
            <option value="Term-II">Term-II</option>
          </select>
          
          <button
            onClick={fetchAttendance}
            className="nav-btn"
            style={{
              margin: 0,
              padding: '8px 12px',
              border: '1px solid #ddd'
            }}
          >
            <RefreshCw size={14} />
            Sync
          </button>
        </div>
      </div>

      {attendanceError && (
        <div
          style={{
            background: '#fff1f0',
            color: '#d32f2f',
            padding: '12px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertCircle size={18} />

          {attendanceError}

          <button
            onClick={() =>
              setShowCredsForm(true)
            }
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: '#d32f2f',
              textDecoration: 'underline',
              cursor: 'pointer'
            }}
          >
            Update Credentials
          </button>
        </div>
      )}

      <div className="attendance-summary-card">
        <div className="summary-stat">
          <div className="value">
            {overallAttended} / {overallTotal}
          </div>

          <div className="label">
            Total Classes
          </div>
        </div>

        <div className="summary-stat">
          <div
            className="value"
            style={{
              color:
                overallPercentage < 80
                  ? '#ff4d4f'
                  : '#4caf50'
            }}
          >
            {overallPercentage}%
          </div>

          <div className="label">
            Overall Avg
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        {Object.entries(
          attendanceData || {}
        ).map(([subject, data], idx) => {
          const isExp =
            expandedSubject === subject;

          const notStarted =
            data.notStarted ||
            (
              !data.total &&
              (data.classes || []).length === 0
            );

          const pct = notStarted
            ? 0
            : parseFloat(data.percentage) || 0;

          const color = notStarted
            ? '#9aa0a6'
            : pct >= 80
              ? '#4caf50'
              : pct >= 75
                ? '#faad14'
                : '#ff4d4f';

          return (
            <div
              key={idx}
              className="subject-card"
            >
              <div
                className="subject-header"
                onClick={() => {
                  setExpandedSubject(
                    isExp ? null : subject
                  );

                  trackEvent(
                    'action',
                    isExp
                      ? 'collapse_attendance'
                      : 'expand_attendance'
                  );
                }}
              >
                <div className="subject-title">
                  {subject}
                </div>

                <div className="subject-stats">
                  {notStarted ? (
                    <span
                      style={{
                        color: '#9aa0a6',
                        fontWeight: 'bold',
                        fontSize: '0.85rem',
                        background: 'rgba(154,160,166,0.15)',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Not started
                    </span>
                  ) : (
                    <>
                      <span
                        style={{
                          fontWeight: 'bold',
                          color: '#444'
                        }}
                      >
                        {data.attended}/
                        {data.total}
                      </span>

                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: color
                          }}
                        />
                      </div>

                      <span
                        style={{
                          color,
                          fontWeight: 'bold',
                          width: '45px',
                          textAlign: 'right'
                        }}
                      >
                        {data.percentage}%
                      </span>
                    </>
                  )}

                  {isExp ? (
                    <ChevronUp
                      size={16}
                      color="#888"
                    />
                  ) : (
                    <ChevronDown
                      size={16}
                      color="#888"
                    />
                  )}
                </div>
              </div>

              <div
                className={`class-list ${
                  isExp ? 'expanded' : ''
                }`}
              >
                {(data.classes || []).map(
                  (cls, cIdx) => (
                    <div
                      key={cIdx}
                      className="class-row"
                    >
                      <span
                        style={{
                          width: '40px'
                        }}
                      >
                        {cls.class}
                      </span>

                      <span
                        style={{
                          flex: 1
                        }}
                      >
                        {cls.date}
                      </span>

                      <span
                        style={{
                          flex: 1
                        }}
                      >
                        {cls.time}
                      </span>

                      <span
                        className={`status-badge status-${cls.status.toLowerCase()}`}
                      >
                        {cls.status}
                      </span>
                    </div>
                  )
                )}

                {(data.classes || []).length === 0 && (
                  <div
                    style={{
                      textAlign: 'center',
                      color: '#888',
                      padding: '10px'
                    }}
                  >
                    {notStarted
                      ? "Classes haven't started yet."
                      : 'No records found.'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default AttendanceTab;