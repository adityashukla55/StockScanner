import { useState } from 'react';
import { money, signedPct } from '../format.js';
import { MAX_GROUP_NAME, MAX_GROUPS, quickAddOptions } from '../groups.js';

/** Clicking a row does something different per view, so say which. */
const ROW_LABEL = {
  detail: (s) => `Open ${s}`,
  compare: (s) => `Toggle ${s} in the comparison`,
  portfolio: (s) => `Add ${s} to the portfolio`,
  projection: (s) => `Project ${s}`,
  allocation: (s) => `Toggle ${s} in the allocation`,
};

function GroupBar({ groups, activeGroup, total, onPick, onCreate }) {
  return (
    <div className="group-bar" aria-label="Groups">
      <button
        type="button"
        className={`group-chip ${activeGroup ? '' : 'on'}`}
        aria-pressed={!activeGroup}
        onClick={() => onPick(null)}
      >
        All <span className="group-count">{total}</span>
      </button>
      {groups.map((g) => (
        <button
          key={g.id}
          type="button"
          className={`group-chip ${activeGroup?.id === g.id ? 'on' : ''}`}
          aria-pressed={activeGroup?.id === g.id}
          onClick={() => onPick(g.id)}
          title={`Show only ${g.name} in every tab`}
        >
          {g.name || 'Group'} <span className="group-count">{g.symbols.length}</span>
        </button>
      ))}
      {groups.length < MAX_GROUPS && (
        <button type="button" className="group-chip add" onClick={onCreate} title="Make a new group">
          + Group
        </button>
      )}
    </div>
  );
}

function GroupEditor({ group, candidates, quotes, onRename, onToggle, onAddMany, onDelete, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const members = new Set(group.symbols);
  const quick = quickAddOptions(candidates, quotes);

  return (
    <div className="group-editor">
      <label className="group-name">
        <span className="group-label">Group name</span>
        <input
          type="text"
          value={group.name}
          maxLength={MAX_GROUP_NAME}
          onChange={(e) => onRename(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onDone()}
          onFocus={(e) => e.target.select()}
          placeholder="e.g. India, Europe, EUR, Tech"
          autoFocus
        />
      </label>

      {quick.length > 0 && (
        <div className="group-quick">
          <span className="group-label">Add all from</span>
          <div className="group-quick-list">
            {quick.map((q) => (
              <button
                key={q.key}
                type="button"
                className="group-chip small"
                onClick={() => onAddMany(q.symbols)}
                title={`Add ${q.symbols.join(', ')}`}
              >
                {q.label} <span className="group-count">{q.symbols.length}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <span className="group-label">Tickers in this group</span>
      {candidates.length === 0 ? (
        <p className="watchlist-empty">Your watchlist is empty. Search above to add tickers first.</p>
      ) : (
        <ul className="group-members">
          {candidates.map((s) => (
            <li key={s}>
              <label>
                <input type="checkbox" checked={members.has(s)} onChange={() => onToggle(s)} />
                <span className="ticker">{s}</span>
                <span className="co-name">{quotes[s]?.name ?? ''}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="group-actions">
        <button
          type="button"
          className={`ghost-btn ${confirming ? 'danger-on' : ''}`}
          onClick={() => (confirming ? onDelete() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          {confirming ? 'Click again to delete' : 'Delete group'}
        </button>
        <button type="button" className="primary-btn" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="group-hint">Deleting a group keeps its tickers in your watchlist.</p>
    </div>
  );
}

export default function Watchlist({
  symbols,
  total,
  groups = [],
  activeGroup = null,
  candidates = [],
  quotes,
  selected,
  compared = [],
  mode,
  onSelect,
  onRemove,
  onPickGroup,
  onCreateGroup,
  onRenameGroup,
  onFinishGroup,
  onDeleteGroup,
  onToggleMember,
  onAddMembers,
}) {
  const [editing, setEditing] = useState(false);
  const comparing = mode === 'compare';
  const label = ROW_LABEL[mode] ?? ROW_LABEL.detail;
  const showEditor = editing && activeGroup;

  const pick = (id) => {
    if (activeGroup) onFinishGroup(activeGroup.id);
    setEditing(false);
    onPickGroup(id);
  };

  const create = () => {
    if (activeGroup) onFinishGroup(activeGroup.id);
    onCreateGroup();
    setEditing(true);
  };

  const done = () => {
    onFinishGroup(activeGroup.id);
    setEditing(false);
  };

  return (
    <aside className="watchlist">
      <div className="panel-head">
        <h2>Watchlist</h2>
        <span className="count">{symbols.length}</span>
      </div>

      <GroupBar
        groups={groups}
        activeGroup={activeGroup}
        total={total ?? symbols.length}
        onPick={pick}
        onCreate={create}
      />

      {activeGroup && !showEditor && (
        <div className="group-tools">
          <span>Every tab shows only this group.</span>
          <button type="button" className="link-btn" onClick={() => setEditing(true)}>
            Edit group
          </button>
        </div>
      )}

      {showEditor ? (
        <GroupEditor
          key={activeGroup.id}
          group={activeGroup}
          candidates={candidates}
          quotes={quotes}
          onRename={(name) => onRenameGroup(activeGroup.id, name)}
          onToggle={(symbol) => onToggleMember(activeGroup.id, symbol)}
          onAddMany={(list) => onAddMembers(activeGroup.id, list)}
          onDelete={() => {
            setEditing(false);
            onDeleteGroup(activeGroup.id);
          }}
          onDone={done}
        />
      ) : (
        <>
          {symbols.length === 0 && (
            <p className="watchlist-empty">
              {activeGroup
                ? 'No tickers in this group yet. Click Edit group to add some.'
                : 'Search above and pick a ticker to pin it here. Quotes refresh automatically.'}
            </p>
          )}

          <ul className="watchlist-rows">
            {symbols.map((symbol) => {
              const q = quotes[symbol];
              const dir = q?.changePercent > 0 ? 'up' : q?.changePercent < 0 ? 'down' : 'flat';
              const isCompared = compared.includes(symbol);
              const isActive = symbol === selected || isCompared;
              const removeLabel = activeGroup
                ? `Remove ${symbol} from ${activeGroup.name}`
                : `Remove ${symbol} from watchlist`;

              return (
                <li key={symbol}>
                  <button
                    type="button"
                    className={`watch-row ${isActive ? 'selected' : ''}`}
                    onClick={() => onSelect(symbol)}
                    aria-pressed={comparing ? isCompared : undefined}
                    title={label(symbol)}
                  >
                    <span className="watch-id">
                      <span className="ticker">{symbol}</span>
                      <span className="co-name">{q?.name ?? '…'}</span>
                    </span>
                    <span className="watch-price">
                      <span className="px">{q ? money(q.price, q.currency) : '—'}</span>
                      <span className={`chg ${dir}`}>{q ? signedPct(q.changePercent) : ''}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="remove"
                    onClick={() => onRemove(symbol)}
                    aria-label={removeLabel}
                    title={removeLabel}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
