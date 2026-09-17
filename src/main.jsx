import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import GrantAccess from './components/GrantAccess.jsx';
import { browserApi } from './browser.js';
import { load } from './settings.js';
import './styles.css';

const origins = browserApi.runtime.getManifest().host_permissions ?? [];

/** Ask the browser rather than assume: Chrome grants at install, Firefox does not. */
async function hasAccess() {
  try {
    return await browserApi.permissions.contains({ origins });
  } catch {
    // Older browsers without the permissions API granted at install time.
    return true;
  }
}

function Root({ granted }) {
  const [ok, setOk] = useState(granted);
  return ok ? <App /> : <GrantAccess origins={origins} onGranted={() => setOk(true)} />;
}

// Settings are read synchronously throughout the data layer, so the snapshot
// has to be in place before anything mounts — App.jsx reads the poll interval
// while its module is still evaluating.
Promise.all([load(), hasAccess()]).then(([, granted]) => {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root granted={granted} />
    </StrictMode>,
  );
});
