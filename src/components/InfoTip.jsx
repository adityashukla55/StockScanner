import { useEffect, useId, useRef, useState } from 'react';

/**
 * The ⓘ beside a tab heading, and the panel it opens.
 *
 * Each view used to carry a sentence of explanation under its title, which cost
 * a line of height on every visit to tell you something you only needed once.
 * Folding it away turns that into a question you can ask: what is this tab, and
 * what is it computed from?
 *
 * Written as a disclosure rather than a tooltip on purpose — the content runs to
 * several lines and includes formulas, which a hover bubble handles badly and a
 * touchscreen cannot show at all.
 */
export default function InfoTip({ label = 'About this tab', children }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapper = useRef(null);

  // Escape closes it, and so does a click anywhere else — the usual expectations
  // for something that opens over the page.
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span className="infotip" ref={wrapper}>
      <button
        type="button"
        className={`infotip-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={label}
      >
        i
      </button>

      {open && (
        <div className="infotip-panel" id={panelId} role="region" aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}
