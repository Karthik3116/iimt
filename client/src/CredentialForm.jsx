import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

function CredentialForm({
  onSubmit,
  onCancel,
  hasCreds
}) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);

  return (
    <div className="creds-card">
      <Lock
        size={40}
        color="var(--accent-gold)"
        style={{
          marginBottom: '1rem'
        }}
      />

      <h3>
        {hasCreds ? 'Update' : 'Link'} OLT Account
      </h3>

      <p
        style={{
          color: '#666',
          fontSize: '0.9rem',
          marginBottom: '1.5rem'
        }}
      >
        Your credentials are encrypted and stored securely to sync your attendance.
      </p>

      <div className="input-group">
        <label
          style={{
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          Roll Number
        </label>

        <input
          type="text"
          placeholder="e.g. 2601030"
          value={user}
          onChange={e =>
            setUser(e.target.value)
          }
        />
      </div>

      <div
        className="input-group"
        style={{
          position: 'relative'
        }}
      >
        <label
          style={{
            fontSize: '0.85rem',
            fontWeight: 600
          }}
        >
          Password
        </label>

        <input
          type={
            showPass ? 'text' : 'password'
          }
          placeholder="Date of birth (DDMMYYYY)"
          value={pass}
          onChange={e =>
            setPass(e.target.value)
          }
        />

        <button
          onClick={() =>
            setShowPass(!showPass)
          }
          style={{
            position: 'absolute',
            right: '10px',
            top: '34px',
            background: 'none',
            border: 'none',
            color: '#888',
            cursor: 'pointer'
          }}
        >
          {showPass ? (
            <EyeOff size={18} />
          ) : (
            <Eye size={18} />
          )}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginTop: '1.5rem'
        }}
      >
        {hasCreds && (
          <button
            className="btn-cancel"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
        )}

        <button
          className="btn-submit"
          style={{ flex: 1 }}
          disabled={!user || !pass}
          onClick={() =>
            onSubmit(user, pass)
          }
        >
          Securely Save
        </button>
      </div>
    </div>
  );
}

export default CredentialForm;