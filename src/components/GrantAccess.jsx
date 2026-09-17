import { useState } from 'react';
import { browserApi } from '../browser.js';

/**
 * Asks for the Yahoo host permissions when the browser has not already granted
 * them.
 *
 * Chrome grants everything in `host_permissions` at install time, so this never
 * appears there. Firefox treats them as opt-in under Manifest V3 — the add-on
 * installs, the dashboard opens, and every request fails with nothing on screen
 * to explain why. Asking explicitly turns that into one button.
 *
 * `permissions.request` must be called from a user gesture, which is why this
 * is a button rather than something the app does on startup.
 */
export default function GrantAccess({ origins, onGranted }) {
  const [error, setError] = useState(null);
  const [asking, setAsking] = useState(false);

  const ask = async () => {
    setAsking(true);
    setError(null);
    try {
      const granted = await browserApi.permissions.request({ origins });
      if (granted) onGranted();
      else setError('Access was declined. Nothing can load without it.');
    } catch (err) {
      setError(err.message);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="grant">
      <h1>One permission to go</h1>
      <p>
        Stock Scanner reads prices from Yahoo Finance. Your browser needs your say-so before it
        can do that.
      </p>
      <ul className="grant-hosts">
        {origins.map((origin) => (
          <li key={origin}>{origin}</li>
        ))}
      </ul>
      <button type="button" className="grant-btn" onClick={ask} disabled={asking}>
        {asking ? 'Waiting for the browser…' : 'Allow Yahoo Finance'}
      </button>
      {error && <p className="grant-error">{error}</p>}
      <p className="grant-note">
        This is the only network access the extension has. It reads no page you visit and sends
        nothing anywhere else.
      </p>
    </div>
  );
}
