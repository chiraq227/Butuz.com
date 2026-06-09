import React, { useEffect, useMemo, useState } from 'react';

type AdminUser = {
  id: number;
  username: string;
  display_name?: string;
  casino_balance: number;
  casino_rating: number;
  casino_vip: number | boolean;
  casino_banned: number | boolean;
  casino_level?: number;
};

type AdminStats = {
  users: number;
  totalBalance: number;
  totalRating: number;
  vips: number;
  banned: number;
};

type AdminLog = {
  id: number;
  admin_username: string;
  target_username: string | null;
  action: string;
  details: any;
  created_at: string;
};

type AdminInspect = {
  id: number;
  username: string;
  balance: number;
  rating: number;
  vip: boolean;
  banned: boolean;
  level: number;
  mining?: any;
  businesses?: any;
  [key: string]: any;
};

interface AdminPanelProps {
  token: string;
  api: any;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  refreshProfile: () => Promise<void>;
  isButuz: boolean;
}

const fmt = (n: number) => {
  if (!n && n !== 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 10_000) return Math.floor(n / 1000) + 'k';
  return n.toLocaleString('ru-RU');
};

const safeNum = (v: any, d = 0) => {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : d;
};

// Theme-agnostic high-contrast admin buttons (always readable)
const BTN = {
  base: "inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-2xl text-sm font-semibold border transition active:scale-[0.985] select-none",
  neutral: "bg-zinc-900 text-white border-zinc-700 hover:bg-zinc-800 active:bg-black",
  success: "bg-emerald-600 text-white border-emerald-700 hover:bg-emerald-500 active:bg-emerald-700",
  danger: "bg-red-600 text-white border-red-700 hover:bg-red-500 active:bg-red-700",
  warn: "bg-amber-600 text-white border-amber-700 hover:bg-amber-500 active:bg-amber-700",
  subtle: "bg-zinc-800/90 text-zinc-100 border-zinc-600 hover:bg-zinc-700",
  ghost: "bg-transparent text-white/90 border-white/30 hover:bg-white/10 hover:text-white",
};

export default function AdminPanel({ token, api, showToast, refreshProfile, isButuz }: AdminPanelProps) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [logs, setLogs] = useState<AdminLog[]>([]);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'vip' | 'banned'>('all');
  const [sort, setSort] = useState<'id' | 'balance' | 'rating' | 'level'>('id');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [view, setView] = useState<'cards' | 'table'>('cards');

  const [globalAmt, setGlobalAmt] = useState(1_000_000);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [inspect, setInspect] = useState<AdminInspect | null>(null);
  const [inspectLocalAmt, setInspectLocalAmt] = useState(1_000_000);

  const [loading, setLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Amount presets — always high contrast
  const AMOUNTS = [1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000];

  async function loadUsers(opts?: Partial<{ q: string; filter: string; sort: string; dir: string }>) {
    if (!token || !isButuz) return;
    setLoading(true);
    try {
      const params: any = {
        q: opts?.q ?? query,
        filter: opts?.filter ?? filter,
        sort: opts?.sort ?? sort,
        dir: opts?.dir ?? sortDir,
        limit: 80,
      };
      const data = await api.adminUsersAdvanced(params, token);
      setUsers(Array.isArray(data) ? data : []);
    } catch (e: any) {
      showToast(e?.message || 'Ошибка загрузки пользователей', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    if (!token || !isButuz) return;
    try {
      const s = await api.adminStats(token);
      setStats(s);
    } catch {}
  }

  async function loadLogs() {
    if (!token || !isButuz) return;
    try {
      const l = await api.adminLogs(token, 40);
      setLogs(Array.isArray(l) ? l : []);
    } catch {}
  }

  async function reloadAll() {
    await Promise.all([loadUsers(), loadStats(), loadLogs()]);
  }

  useEffect(() => {
    if (!isButuz) return;
    const t = setTimeout(() => {
      loadUsers({ q: query });
    }, 280);
    return () => clearTimeout(t);
  }, [query]);

  // initial + when filter/sort change
  useEffect(() => {
    if (!isButuz) return;
    loadUsers();
    loadStats();
  }, [filter, sort, sortDir]);

  useEffect(() => {
    if (isButuz) {
      loadUsers({ q: '' });
      loadStats();
      loadLogs();
    }
  }, [isButuz]);

  async function act(action: string, payload: any) {
    if (!token || !isButuz) return;
    try {
      const amt = payload.a ?? globalAmt;

      if (action === 'give') await api.adminGive(payload.u, amt, token);
      else if (action === 'take') await api.adminTake(payload.u, amt, token);
      else if (action === 'gr') await api.adminGiveRating(payload.u, amt, token);
      else if (action === 'tr') await api.adminTakeRating(payload.u, amt, token);
      else if (action === 'vip') await api.adminVipToggle(payload.u, token);
      else if (action === 'ban') await api.adminBan(payload.u, payload.ban, token);
      else if (action === 'setbalance') await api.adminSetBalance(payload.u, payload.amount ?? amt, token);
      else if (action === 'setrating') await api.adminSetRating(payload.u, payload.amount ?? amt, token);
      else if (action === 'setlevel') await api.adminSetLevel(payload.u, payload.level ?? 1, token);
      else if (action === 'setfarm') await api.adminSetFarm(payload.u, payload.level ?? 0, payload.extra ?? 0, token);
      else if (action === 'resetfarm') await api.adminResetFarm(payload.u, token);
      else if (action === 'givebiz') await api.adminGiveBusiness(payload.u, payload.id, token);
      else if (action === 'clearcooldowns') await api.adminClearBizCooldowns(payload.u, token);
      else if (action === 'bc') await api.adminBroadcast(payload.text, token);

      showToast(`✅ ${action}`);
      await reloadAll();

      // refresh inspector if open
      if (inspect && (inspect.username || '').toLowerCase() === (payload.u || '').toLowerCase()) {
        const fresh = await api.adminUserInfo(payload.u, token);
        setInspect(fresh);
      }
      await refreshProfile();
    } catch (e: any) {
      showToast(e?.message || 'Admin error', 'error');
    }
  }

  // Bulk
  const selectedList = useMemo(() => Array.from(selected), [selected]);

  async function bulkAct(type: 'give' | 'take' | 'ban' | 'vip' | 'resetfarm') {
    if (selectedList.length === 0) return;
    if (type === 'give' || type === 'take') {
      const delta = globalAmt;
      for (const u of selectedList) {
        try {
          if (type === 'give') await api.adminGive(u, delta, token);
          else await api.adminTake(u, delta, token);
        } catch {}
      }
      showToast(`✅ ${type} ×${selectedList.length}`);
    } else if (type === 'ban' || type === 'vip') {
      for (const u of selectedList) {
        try {
          if (type === 'ban') {
            const uObj = users.find(x => x.username === u);
            await api.adminBan(u, !uObj?.casino_banned, token);
          } else {
            await api.adminVipToggle(u, token);
          }
        } catch {}
      }
      showToast(`✅ ${type} ×${selectedList.length}`);
    } else if (type === 'resetfarm') {
      for (const u of selectedList) {
        try { await api.adminResetFarm(u, token); } catch {}
      }
      showToast(`✅ resetfarm ×${selectedList.length}`);
    }
    setSelected(new Set());
    await reloadAll();
  }

  // Mass give (powerful)
  async function doMassGive(mode: 'ALL' | 'ALL_NONBANNED') {
    const ok = window.confirm(`Выдать ${fmt(globalAmt)} ВСЕМ (${mode})? Это необратимо.`);
    if (!ok) return;
    try {
      const res = await api.adminMassGive(globalAmt, mode, undefined, token);
      showToast(`✅ Mass-give: ${res.updated} пользователей`);
      await reloadAll();
    } catch (e: any) {
      showToast(e?.message || 'Mass error', 'error');
    }
  }

  // Broadcast
  async function doBroadcast() {
    const el = document.getElementById('admin-bc') as HTMLTextAreaElement | null;
    const text = el?.value?.trim();
    if (!text) return;
    if (!window.confirm(`Разослать всем: "${text.slice(0, 80)}..." ?`)) return;
    await act('bc', { text });
    if (el) el.value = '';
  }

  // Inspect
  async function openInspect(username: string) {
    try {
      const info = await api.adminUserInfo(username, token);
      setInspect(info);
      setInspectLocalAmt(globalAmt);
    } catch (e: any) {
      showToast(e?.message || 'Не удалось загрузить', 'error');
    }
  }

  function closeInspect() {
    setInspect(null);
  }

  // Selection
  function toggleSelect(u: string) {
    const next = new Set(selected);
    if (next.has(u)) next.delete(u);
    else next.add(u);
    setSelected(next);
  }
  function selectAllVisible() {
    const next = new Set(users.map(u => u.username));
    setSelected(next);
  }
  function clearSelection() { setSelected(new Set()); }

  // Per user quick amount (optional future)
  const amt = globalAmt;

  // Render helpers for buttons that are ALWAYS readable
  const QuickBtn = ({ children, onClick, variant = 'neutral' as keyof typeof BTN, title }: any) => (
    <button
      onClick={onClick}
      title={title}
      className={`${BTN.base} ${BTN[variant]}`}
    >
      {children}
    </button>
  );

  return (
    <div className="mb-6">
      {/* HEADER */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold tracking-tight text-white flex items-center gap-2 drop-shadow">
            🛡️ <span>Админ-панель</span>
          </div>
          <div className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/70 border border-white/20">butuz only</div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reloadAll} className={`${BTN.base} ${BTN.neutral} text-xs px-3 py-1`}>⟳ Обновить всё</button>
          <button onClick={() => setShowLogs(v => !v)} className={`${BTN.base} ${BTN.subtle} text-xs px-3 py-1`}>{showLogs ? 'Скрыть' : 'Показать'} логи</button>
        </div>
      </div>

      {/* STATS — clean high contrast pills */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Пользователей', value: stats.users, onClick: () => { setFilter('all'); loadUsers({ filter: 'all' }); } },
            { label: 'Общий баланс', value: fmt(stats.totalBalance) },
            { label: 'Общий рейтинг', value: fmt(stats.totalRating) },
            { label: 'VIP', value: stats.vips, onClick: () => { setFilter('vip'); } },
            { label: 'Забанено', value: stats.banned, onClick: () => { setFilter('banned'); } },
          ].map((s, i) => (
            <div
              key={i}
              onClick={s.onClick}
              className="rounded-3xl border border-white/15 bg-zinc-950/70 px-4 py-3 text-center cursor-pointer hover:border-white/30 transition"
            >
              <div className="text-[10px] uppercase tracking-widest text-white/50">{s.label}</div>
              <div className="font-mono text-xl font-semibold text-white tabular-nums mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* CONTROLS BAR — amount + search + filters (theme-proof) */}
      <div className="rounded-3xl border border-white/10 bg-zinc-950/60 p-4 mb-4">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Amount */}
          <div className="flex-1 min-w-[280px]">
            <div className="text-xs font-semibold text-white/60 mb-1.5">ГЛОБАЛЬНАЯ СУММА ОПЕРАЦИЙ</div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {AMOUNTS.map(n => (
                <button
                  key={n}
                  onClick={() => setGlobalAmt(n)}
                  className={`${BTN.base} px-2.5 py-1 text-xs ${globalAmt === n ? 'bg-white text-zinc-950 border-white' : 'bg-zinc-900 text-white/90 border-white/20 hover:bg-zinc-800'}`}
                >
                  {n >= 1_000_000 ? (n / 1_000_000) + 'M' : fmt(n)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={globalAmt}
                onChange={e => setGlobalAmt(Math.max(1, safeNum(e.target.value, 1)))}
                className="w-44 bg-zinc-950 border border-white/20 text-white font-mono px-3 py-1.5 rounded-2xl text-sm focus:outline-none focus:border-white/40"
              />
              <div className="text-xs text-white/50">кристаллов</div>
            </div>
          </div>

          {/* Search + filters */}
          <div className="flex-1">
            <div className="text-xs font-semibold text-white/60 mb-1.5">ПОИСК И ФИЛЬТРЫ</div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="username или имя • live поиск"
              className="w-full bg-zinc-950 border border-white/20 text-white px-3 py-2 rounded-2xl mb-2 text-sm placeholder:text-white/40"
            />
            <div className="flex flex-wrap gap-1.5">
              {(['all', 'vip', 'banned'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`${BTN.base} px-3 py-1 text-xs ${filter === f ? 'bg-white text-zinc-950 border-white' : BTN.subtle}`}>
                  {f === 'all' ? 'Все' : f === 'vip' ? '👑 VIP' : '⛔ Banned'}
                </button>
              ))}
              <div className="w-px h-6 bg-white/10 mx-1" />
              {(['id', 'balance', 'rating', 'level'] as const).map(s => (
                <button key={s} onClick={() => { setSort(s); setSortDir(sortDir === 'desc' ? 'asc' : 'desc'); }} className={`${BTN.base} px-2.5 py-1 text-xs ${sort === s ? 'bg-white/90 text-zinc-950' : BTN.subtle}`}>
                  {s === 'id' ? 'ID' : s === 'balance' ? 'Баланс' : s === 'rating' ? 'Рейтинг' : 'Level'} {sort === s ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </button>
              ))}
              <button onClick={() => setView(v => v === 'cards' ? 'table' : 'cards')} className={`${BTN.base} px-2.5 py-1 text-xs ${BTN.subtle}`}>
                {view === 'cards' ? 'Таблица' : 'Карточки'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SELECTION BAR */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-3xl border border-amber-500/30 bg-amber-950/30 px-4 py-2 text-sm text-amber-200">
          <span className="font-semibold">Выбрано: {selected.size}</span>
          <div className="flex-1" />
          <QuickBtn variant="success" onClick={() => bulkAct('give')}>+{fmt(globalAmt)} selected</QuickBtn>
          <QuickBtn variant="danger" onClick={() => bulkAct('take')}>-{fmt(globalAmt)} selected</QuickBtn>
          <QuickBtn variant="warn" onClick={() => bulkAct('vip')}>Toggle VIP</QuickBtn>
          <QuickBtn variant="danger" onClick={() => bulkAct('ban')}>Toggle Ban</QuickBtn>
          <QuickBtn variant="neutral" onClick={() => bulkAct('resetfarm')}>Reset farms</QuickBtn>
          <button onClick={clearSelection} className="text-xs underline ml-2">очистить</button>
        </div>
      )}

      {/* USERS LIST */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold text-white/70">
          Пользователи ({users.length}) {loading && <span className="text-white/40">• обновление…</span>}
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAllVisible} className="underline text-white/60 hover:text-white">Выбрать всех на странице</button>
          <button onClick={clearSelection} className="underline text-white/60 hover:text-white">Снять выбор</button>
        </div>
      </div>

      {users.length === 0 && !loading && (
        <div className="text-sm border border-white/10 rounded-3xl p-6 text-white/60 bg-zinc-950/50">Ничего не найдено. Попробуйте другой запрос или фильтр.</div>
      )}

      {/* CARDS VIEW */}
      {view === 'cards' && users.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {users.map(u => {
            const isBanned = !!u.casino_banned;
            const isVip = !!u.casino_vip;
            const uname = u.username;
            const sel = selected.has(uname);
            return (
              <div key={u.id} className={`rounded-3xl border p-3.5 text-sm bg-zinc-950/70 ${sel ? 'border-amber-400/60' : 'border-white/10'}`}>
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={sel} onChange={() => toggleSelect(uname)} className="accent-white" />
                      <span className="font-semibold text-white">{u.username}</span>
                    </label>
                    {u.display_name && <div className="text-xs text-white/50 -mt-0.5 ml-6">{u.display_name}</div>}
                  </div>
                  <div className="text-right text-[10px] text-white/40 tabular-nums leading-tight">
                    ID:{u.id}<br />Lvl {u.casino_level || 1}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-3 text-sm font-medium tabular-nums">
                  <span className="text-emerald-400">💎 {fmt(u.casino_balance)}</span>
                  <span className="text-amber-400">👑 {fmt(u.casino_rating)}</span>
                  {isVip && <span className="text-amber-400">VIP</span>}
                  {isBanned && <span className="text-red-400">BANNED</span>}
                </div>

                {/* Action groups — high contrast, grouped, readable */}
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <QuickBtn variant="success" onClick={() => act('give', { u: uname })}>+{fmt(amt)}</QuickBtn>
                    <QuickBtn variant="danger" onClick={() => act('take', { u: uname })}>-{fmt(amt)}</QuickBtn>
                    <QuickBtn variant="neutral" onClick={() => act('setbalance', { u: uname, amount: amt })}>Set баланс</QuickBtn>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <QuickBtn variant="warn" onClick={() => act('gr', { u: uname })}>+{fmt(amt)}👑</QuickBtn>
                    <QuickBtn variant="neutral" onClick={() => act('tr', { u: uname })}>-{fmt(amt)}👑</QuickBtn>
                    <QuickBtn variant="neutral" onClick={() => act('setrating', { u: uname, amount: amt })}>Set рейтинг</QuickBtn>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <QuickBtn variant="warn" onClick={() => act('vip', { u: uname })}>VIP toggle</QuickBtn>
                    <QuickBtn variant={isBanned ? 'success' : 'danger'} onClick={() => act('ban', { u: uname, ban: !isBanned })}>
                      {isBanned ? 'Unban' : 'Ban'}
                    </QuickBtn>
                    <QuickBtn variant="neutral" onClick={() => act('resetfarm', { u: uname })}>Reset farm</QuickBtn>
                    <QuickBtn variant="neutral" onClick={() => act('setfarm', { u: uname, level: 10, extra: 300 })}>Max farm</QuickBtn>
                  </div>
                  <div>
                    <QuickBtn variant="subtle" onClick={() => openInspect(uname)} title="Полный редактор пользователя">Inspect →</QuickBtn>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TABLE VIEW — dense & powerful */}
      {view === 'table' && users.length > 0 && (
        <div className="overflow-auto rounded-3xl border border-white/10 bg-zinc-950/70">
          <table className="min-w-full text-sm">
            <thead className="text-white/50 text-xs border-b border-white/10">
              <tr>
                <th className="p-2 w-6"><input type="checkbox" onChange={(e) => e.target.checked ? selectAllVisible() : clearSelection()} /></th>
                <th className="p-2 text-left">User</th>
                <th className="p-2 text-right">Balance</th>
                <th className="p-2 text-right">Rating</th>
                <th className="p-2 text-center">VIP</th>
                <th className="p-2 text-center">Ban</th>
                <th className="p-2 text-center">Lvl</th>
                <th className="p-2 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-white">
              {users.map(u => {
                const isBanned = !!u.casino_banned;
                const isVip = !!u.casino_vip;
                const sel = selected.has(u.username);
                return (
                  <tr key={u.id} className={sel ? 'bg-amber-950/30' : ''}>
                    <td className="p-2"><input type="checkbox" checked={sel} onChange={() => toggleSelect(u.username)} /></td>
                    <td className="p-2 font-medium">{u.username}</td>
                    <td className="p-2 text-right tabular-nums text-emerald-400">{fmt(u.casino_balance)}</td>
                    <td className="p-2 text-right tabular-nums text-amber-400">{fmt(u.casino_rating)}</td>
                    <td className="p-2 text-center">{isVip ? '👑' : ''}</td>
                    <td className="p-2 text-center">{isBanned ? '⛔' : ''}</td>
                    <td className="p-2 text-center text-white/60">{u.casino_level || 1}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1 justify-end">
                        <button onClick={() => act('give', {u: u.username})} className="text-[11px] px-2 py-px rounded bg-emerald-600 text-white">+{fmt(amt)}</button>
                        <button onClick={() => act('take', {u: u.username})} className="text-[11px] px-2 py-px rounded bg-red-600 text-white">-{fmt(amt)}</button>
                        <button onClick={() => act('setbalance', {u: u.username, amount: amt})} className="text-[11px] px-2 py-px rounded bg-zinc-700 text-white">Set</button>
                        <button onClick={() => act('gr', {u: u.username})} className="text-[11px] px-2 py-px rounded bg-amber-600 text-white">+R</button>
                        <button onClick={() => act('tr', {u: u.username})} className="text-[11px] px-2 py-px rounded bg-zinc-700 text-white">-R</button>
                        <button onClick={() => act('vip', {u: u.username})} className="text-[11px] px-2 py-px rounded bg-white/10 text-white">VIP</button>
                        <button onClick={() => act('ban', {u: u.username, ban: !isBanned})} className="text-[11px] px-2 py-px rounded bg-white/10 text-white">{isBanned ? 'Unban' : 'Ban'}</button>
                        <button onClick={() => openInspect(u.username)} className="text-[11px] px-2 py-px rounded bg-sky-600 text-white">Inspect</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* GLOBAL TOOLS */}
      <div className="mt-6 rounded-3xl border border-white/10 bg-zinc-950/60 p-4">
        <div className="font-semibold text-red-400 mb-3">ГЛОБАЛЬНЫЕ ДЕЙСТВИЯ (ОСТОРОЖНО)</div>

        {/* Broadcast */}
        <div className="mb-4">
          <div className="text-xs text-white/60 mb-1">Broadcast — системное уведомление всем пользователям</div>
          <div className="flex gap-2">
            <textarea id="admin-bc" placeholder="Текст объявления..." className="flex-1 min-h-[64px] bg-zinc-950 border border-white/20 text-white p-3 rounded-2xl text-sm" />
            <button onClick={doBroadcast} className={`${BTN.base} ${BTN.danger} px-5`}>Разослать</button>
          </div>
        </div>

        {/* Mass give */}
        <div>
          <div className="text-xs text-white/60 mb-1.5">Массовые выдачи (логируются)</div>
          <div className="flex flex-wrap gap-2">
            <QuickBtn variant="success" onClick={() => doMassGive('ALL')}>+{fmt(globalAmt)} ВСЕМ</QuickBtn>
            <QuickBtn variant="success" onClick={() => doMassGive('ALL_NONBANNED')}>+{fmt(globalAmt)} НЕЗАБАНЕННЫМ</QuickBtn>
            <div className="text-[10px] text-white/40 self-center ml-1">Используй с умом. Все действия сохраняются в логах.</div>
          </div>
        </div>
      </div>

      {/* AUDIT LOGS */}
      {showLogs && (
        <div className="mt-4 rounded-3xl border border-white/10 bg-black/40 p-4 text-xs">
          <div className="font-semibold mb-2 text-white/70">Последние действия админа (аудит)</div>
          {logs.length === 0 && <div className="text-white/40">Логов пока нет.</div>}
          <div className="space-y-1 max-h-[280px] overflow-auto font-mono">
            {logs.map(l => (
              <div key={l.id} className="flex gap-2 text-white/70 border-b border-white/5 pb-0.5">
                <span className="text-white/40 w-36 shrink-0">{new Date(l.created_at).toLocaleString('ru-RU')}</span>
                <span className="text-amber-400/90 w-16 shrink-0">{l.action}</span>
                <span className="text-white/80">{l.target_username || '—'}</span>
                {l.details && <span className="text-white/50 truncate"> {JSON.stringify(l.details)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* POWERFUL INSPECTOR MODAL */}
      {inspect && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-start justify-center pt-10 p-4" onClick={closeInspect}>
          <div
            className="w-full max-w-3xl rounded-3xl border border-white/15 bg-zinc-950 text-white p-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between mb-4">
              <div>
                <div className="text-2xl font-bold tracking-tight">{inspect.username}</div>
                <div className="text-xs text-white/50">ID: {inspect.id} • Level {inspect.level ?? 1} • {inspect.banned ? 'BANNED' : 'active'} {inspect.vip ? '👑 VIP' : ''}</div>
              </div>
              <button onClick={closeInspect} className="text-3xl leading-none text-white/60 hover:text-white">×</button>
            </div>

            {/* Overview */}
            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">Баланс: <span className="font-mono font-semibold text-emerald-400">{fmt(inspect.balance)}</span> 💎</div>
              <div className="rounded-2xl border border-white/10 bg-black/30 p-3">Рейтинг: <span className="font-mono font-semibold text-amber-400">{fmt(inspect.rating)}</span> 👑</div>
            </div>

            {/* Exact values — the flexible part */}
            <div className="mb-4">
              <div className="font-semibold mb-2 text-xs tracking-widest text-white/60">ТОЧНЫЕ ЗНАЧЕНИЯ (ГИБКО)</div>
              <div className="flex flex-wrap gap-2 items-end">
                <div>
                  <div className="text-[10px] text-white/50 mb-0.5">Баланс</div>
                  <input id="insp-bal" type="number" defaultValue={inspect.balance} className="w-36 bg-zinc-900 border border-white/20 px-2 py-1 rounded-xl font-mono text-sm" />
                </div>
                <QuickBtn onClick={() => {
                  const v = safeNum((document.getElementById('insp-bal') as HTMLInputElement)?.value, 0);
                  act('setbalance', { u: inspect.username, amount: v });
                }} variant="neutral">Set баланс</QuickBtn>

                <div>
                  <div className="text-[10px] text-white/50 mb-0.5">Рейтинг</div>
                  <input id="insp-rat" type="number" defaultValue={inspect.rating} className="w-28 bg-zinc-900 border border-white/20 px-2 py-1 rounded-xl font-mono text-sm" />
                </div>
                <QuickBtn onClick={() => {
                  const v = safeNum((document.getElementById('insp-rat') as HTMLInputElement)?.value, 0);
                  act('setrating', { u: inspect.username, amount: v });
                }} variant="neutral">Set рейтинг</QuickBtn>

                <div>
                  <div className="text-[10px] text-white/50 mb-0.5">Level</div>
                  <input id="insp-lvl" type="number" defaultValue={inspect.level || 1} className="w-20 bg-zinc-900 border border-white/20 px-2 py-1 rounded-xl font-mono text-sm" />
                </div>
                <QuickBtn onClick={() => {
                  const v = safeNum((document.getElementById('insp-lvl') as HTMLInputElement)?.value, 1);
                  act('setlevel', { u: inspect.username, level: v });
                }} variant="neutral">Set level</QuickBtn>
              </div>
            </div>

            {/* Local amount for this inspector */}
            <div className="mb-3 text-xs flex items-center gap-2">
              <span className="text-white/50">Сумма для быстрых кнопок этого окна:</span>
              <input type="number" value={inspectLocalAmt} onChange={e => setInspectLocalAmt(Math.max(1, safeNum(e.target.value, 1)))} className="w-28 bg-zinc-900 border border-white/20 px-2 py-0.5 rounded text-sm font-mono" />
              <button onClick={() => setInspectLocalAmt(globalAmt)} className="text-xs underline text-white/50">= глобальная</button>
            </div>

            {/* Quick actions in inspector */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <div className="text-xs font-semibold mb-1.5 text-white/60">БАЛАНС</div>
                <div className="flex flex-wrap gap-1.5">
                  <QuickBtn variant="success" onClick={() => act('give', { u: inspect.username, a: inspectLocalAmt })}>+{fmt(inspectLocalAmt)}</QuickBtn>
                  <QuickBtn variant="danger" onClick={() => act('take', { u: inspect.username, a: inspectLocalAmt })}>-{fmt(inspectLocalAmt)}</QuickBtn>
                  <QuickBtn variant="neutral" onClick={() => act('setbalance', { u: inspect.username, amount: inspectLocalAmt })}>Set</QuickBtn>
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold mb-1.5 text-white/60">РЕЙТИНГ</div>
                <div className="flex flex-wrap gap-1.5">
                  <QuickBtn variant="warn" onClick={() => act('gr', { u: inspect.username, a: inspectLocalAmt })}>+{fmt(inspectLocalAmt)} 👑</QuickBtn>
                  <QuickBtn variant="neutral" onClick={() => act('tr', { u: inspect.username, a: inspectLocalAmt })}>-{fmt(inspectLocalAmt)} 👑</QuickBtn>
                  <QuickBtn variant="neutral" onClick={() => act('setrating', { u: inspect.username, amount: inspectLocalAmt })}>Set</QuickBtn>
                </div>
              </div>
            </div>

            <div className="flex gap-2 mb-4">
              <QuickBtn variant="warn" onClick={() => act('vip', { u: inspect.username })}>Toggle VIP</QuickBtn>
              <QuickBtn variant={inspect.banned ? 'success' : 'danger'} onClick={() => act('ban', { u: inspect.username, ban: !inspect.banned })}>
                {inspect.banned ? 'Unban' : 'Ban'}
              </QuickBtn>
            </div>

            {/* Farm */}
            <div className="mb-4">
              <div className="text-xs font-semibold mb-1.5 text-white/60">ФЕРМА</div>
              <div className="text-xs mb-1.5 text-white/60">Текущий уровень: {inspect.mining?.farm_level ?? 0} • extra: {inspect.mining?.extra_farms ?? 0}</div>
              <div className="flex flex-wrap gap-1.5">
                <QuickBtn onClick={() => act('resetfarm', { u: inspect.username })} variant="neutral">Сбросить</QuickBtn>
                <QuickBtn onClick={() => act('setfarm', { u: inspect.username, level: 5, extra: 0 })} variant="subtle">Lvl 5</QuickBtn>
                <QuickBtn onClick={() => act('setfarm', { u: inspect.username, level: 10, extra: 100 })} variant="subtle">Max +100</QuickBtn>
                <QuickBtn onClick={() => act('setfarm', { u: inspect.username, level: 10, extra: 500 })} variant="subtle">Max +500</QuickBtn>
                <QuickBtn onClick={() => act('setfarm', { u: inspect.username, level: 10, extra: 1000 })} variant="warn">Абсолютный максимум</QuickBtn>
              </div>
            </div>

            {/* Businesses */}
            <div className="mb-4">
              <div className="text-xs font-semibold mb-1.5 text-white/60">БИЗНЕСЫ (1–10)</div>
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 10 }, (_, i) => i + 1).map(id => (
                  <QuickBtn key={id} onClick={() => act('givebiz', { u: inspect.username, id })} variant="neutral">+Бизнес {id}</QuickBtn>
                ))}
              </div>
              <div className="mt-2">
                <QuickBtn onClick={() => act('clearcooldowns', { u: inspect.username })} variant="subtle">Сбросить все КД бизнесов</QuickBtn>
              </div>
            </div>

            <div className="text-[10px] text-white/40 mt-2">Все действия логируются. Используйте с ответственностью.</div>
          </div>
        </div>
      )}
    </div>
  );
}
