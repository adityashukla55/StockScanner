import { useEffect, useRef, useState } from 'react';
import {
  SECTIONS,
  applyBackup,
  backupToText,
  buildBackup,
  downloadBackup,
  parseBackup,
  sectionSummary,
} from '../backup.js';

const MAX_FILE_BYTES = 2_000_000;

function SectionList({ sections, chosen, onToggle, state, settings }) {
  return (
    <ul className="backup-sections">
      {sections.map((s) => (
        <li key={s.key}>
          <label>
            <input type="checkbox" checked={chosen.includes(s.key)} onChange={() => onToggle(s.key)} />
            <span className="backup-name">{s.label}</span>
            <span className="backup-sum">{sectionSummary(s.key, state, settings)}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

const toggleIn = (list, key) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

export default function BackupPanel({ current, settings, storedIn, canUndo, onApply, onUndo, onClose }) {
  const [saveSections, setSaveSections] = useState(() => SECTIONS.map((s) => s.key));
  const [copyState, setCopyState] = useState(null);
  const [copyText, setCopyText] = useState('');
  const [pasted, setPasted] = useState('');
  const [loaded, setLoaded] = useState(null);
  const [source, setSource] = useState('');
  const [loadSections, setLoadSections] = useState([]);
  const [mode, setMode] = useState('merge');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = () => {
    downloadBackup(buildBackup(current, settings, saveSections));
    setCopyState(null);
  };

  const copy = async () => {
    const text = await backupToText(buildBackup(current, settings, saveSections));
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setCopyText('');
    } catch {
      setCopyState('failed');
      setCopyText(text);
    }
  };

  const read = async (text, from) => {
    setError(null);
    setDone(false);
    setLoaded(null);
    try {
      const backup = await parseBackup(text);
      setLoaded(backup);
      setSource(from);
      setLoadSections(backup.sections);
    } catch (err) {
      setError(err.message);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('This file is too big to be a Stock Scanner backup.');
      return;
    }
    read(await file.text(), `the file ${file.name}`);
  };

  const load = () => {
    onApply(applyBackup(current, loaded, loadSections, mode));
    setLoaded(null);
    setPasted('');
    setDone(true);
  };

  const savedWhen = loaded?.exportedAt ? new Date(loaded.exportedAt) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal backup" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <header className="modal-head">
          <div>
            <h2 id="backup-title">Backup &amp; move</h2>
            <p>
              Your setup lives only in this browser. To use it on another computer, save a backup
              here and load it there.
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        <section className="backup-step">
          <h3>
            <span className="step-num">1</span> Save a backup
          </h3>
          <p className="backup-help">Pick what to include.</p>
          <SectionList
            sections={SECTIONS}
            chosen={saveSections}
            onToggle={(key) => setSaveSections((prev) => toggleIn(prev, key))}
            state={current}
            settings={settings}
          />
          <div className="backup-actions">
            <button type="button" className="primary-btn" disabled={!saveSections.length} onClick={download}>
              ⤓ Download file
            </button>
            <button type="button" className="ghost-btn plain" disabled={!saveSections.length} onClick={copy}>
              Copy as text
            </button>
            {copyState === 'copied' && (
              <span className="backup-ok">Copied. Paste it into an email or a note to yourself.</span>
            )}
          </div>
          {copyState === 'failed' && (
            <>
              <p className="backup-help">Could not copy by itself. Select this text and copy it:</p>
              <textarea className="backup-text" readOnly value={copyText} rows={3} onFocus={(e) => e.target.select()} />
            </>
          )}
        </section>

        <section className="backup-step">
          <h3>
            <span className="step-num">2</span> Load a backup
          </h3>
          <p className="backup-help">On the other computer, choose the file or paste the text.</p>
          <div className="backup-actions">
            <button type="button" className="primary-btn" onClick={() => fileRef.current?.click()}>
              ⤒ Choose file…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json,text/plain"
              hidden
              onChange={onFile}
            />
          </div>
          <div className="backup-paste">
            <textarea
              className="backup-text"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="…or paste backup text here"
              rows={2}
            />
            <button
              type="button"
              className="ghost-btn plain"
              disabled={!pasted.trim()}
              onClick={() => read(pasted, 'the pasted text')}
            >
              Read text
            </button>
          </div>

          {error && <p className="backup-error">{error}</p>}

          {loaded && (
            <div className="backup-preview">
              <p>
                Found in {source}
                {savedWhen && !Number.isNaN(savedWhen.getTime())
                  ? `, saved ${savedWhen.toLocaleString()}`
                  : ''}
                . Pick what to load:
              </p>
              <SectionList
                sections={SECTIONS.filter((s) => loaded.sections.includes(s.key))}
                chosen={loadSections}
                onToggle={(key) => setLoadSections((prev) => toggleIn(prev, key))}
                state={loaded.state}
                settings={loaded.settings}
              />
              <div className="backup-mode">
                <label>
                  <input type="radio" name="backup-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  <span>
                    <strong>Add to what I have</strong>
                    <span className="backup-sum">
                      Keeps your tickers and groups, and adds the new ones. If a holding is in both,
                      the backup's numbers are used.
                    </span>
                  </span>
                </label>
                <label>
                  <input type="radio" name="backup-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span>
                    <strong>Replace what I have</strong>
                    <span className="backup-sum">The ticked parts become exactly what is in the backup.</span>
                  </span>
                </label>
              </div>
              <div className="backup-actions">
                <button type="button" className="primary-btn" disabled={!loadSections.length} onClick={load}>
                  Load backup
                </button>
                <button type="button" className="ghost-btn plain" onClick={() => setLoaded(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {done && (
            <p className="backup-ok">
              Backup loaded.{' '}
              {canUndo && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    onUndo();
                    setDone(false);
                  }}
                >
                  Undo
                </button>
              )}
            </p>
          )}
        </section>

        <section className="backup-note">
          <h3>Good to know</h3>
          <ul>
            {storedIn === 'sync' && (
              <li>
                Right now your setup is kept in browser sync. If you sign in to the same Chrome or
                Firefox account on the other computer, it may arrive there by itself.
              </li>
            )}
            {storedIn === 'local' && (
              <li>
                Right now your setup is too big for browser sync, so it stays on this computer
                only. Use a backup to move it.
              </li>
            )}
            <li>A backup file always works. Nothing is sent anywhere: the file stays where you put it.</li>
            <li>The file holds your portfolio numbers. Keep it private if they are.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
