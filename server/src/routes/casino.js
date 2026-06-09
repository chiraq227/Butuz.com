import express from 'express';
import { getDB } from '../db.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// ====================== CONFIG (ported from butuz-cas-bu/config.py) ======================
const CURRENCY = '💎';
const START_BALANCE = 1000000;
const DAILY_BONUS = 100000000;
const REFERRAL_BONUS = 50000;
const MIN_BET = 10;
const MAX_BET = 1000000000000000000000000; // still very high — consider lowering in real deployment
const RATING_PRICE = 600_000_000;
const RATING_SELL_RATE = 0.6;
const VIP_PRICE = 250_000_000_000;

// Simple helper to prevent negative / insane amounts that could be used for abuse
function safePositiveInt(val, max = Number.MAX_SAFE_INTEGER) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

const TRANSFER_MIN = 10;
const TRANSFER_MAX = 50_000_000_000;
const TRANSFER_MAX_VIP = 250_000_000_000;
const TRANSFER_DAILY_LIMIT = 5;
const TRANSFER_DAILY_LIMIT_VIP = 25;

const BTC_SELL_RATE = 65000;
const MAX_EXTRA_FARMS = 1000;
const MINES_HOUSE_EDGE = 0.90; // переработано: иксы стали меньше (было 0.95), сложнее фармить валюту

const FARM_LEVELS = {
  1: { name: "🖥️ Старый ноутбук", btc_per_hour: 0.100, price: 500000, emoji: "🖥️" },
  2: { name: "💻 Игровой ПК", btc_per_hour: 0.500, price: 630000, emoji: "💻" },
  3: { name: "⚡ Разгонный ПК", btc_per_hour: 1.000, price: 670000, emoji: "⚡" },
  4: { name: "🔧 ASIC Начальный", btc_per_hour: 5.000, price: 720000, emoji: "🔧" },
  5: { name: "⛏️ ASIC Стандарт", btc_per_hour: 10.000, price: 800000, emoji: "⛏️" },
  6: { name: "🏭 Мини-ферма", btc_per_hour: 25.000, price: 950000, emoji: "🏭" },
  7: { name: "🔋 Ферма среднего класса", btc_per_hour: 50.000, price: 1500000, emoji: "🔋" },
  8: { name: "🚀 Продвинутая ферма", btc_per_hour: 100.800, price: 2000000, emoji: "🚀" },
  9: { name: "💎 Мега-ферма", btc_per_hour: 170.000, price: 5000000, emoji: "💎" },
  10: { name: "👑 Бутуз-центр", btc_per_hour: 250.000, price: 12000000, emoji: "👑" },
};

const BUSINESSES = {
  1: { id: 1, name: "🏪 Шаурмичная", price: 5_000_000, income_min: 15000, income_max: 45000, emoji: "🏪", tasks: [
    { id: "meat", name: "🥩 Закупить мясо" }, { id: "sauce", name: "🧴 Секретный соус" }, { id: "flyer", name: "📄 Раздать листовки" }
  ]},
  2: { id: 2, name: "☕ Кофейня", price: 25_000_000, income_min: 80000, income_max: 240000, emoji: "☕", tasks: [
    { id: "beans", name: "🫘 Элитные зёрна" }, { id: "barista", name: "🤵 Обучить бариста" }, { id: "wifi", name: "⚡ Быстрый Wi-Fi" }
  ]},
  3: { id: 3, name: "🧼 Автомойка", price: 150_000_000, income_min: 500000, income_max: 1500000, emoji: "🧼", tasks: [
    { id: "foam", name: "🧼 Активная пена" }, { id: "vacuum", name: "🌀 Мощный пылесос" }, { id: "lux", name: "✨ Комплекс Люкс" }
  ]},
  4: { id: 4, name: "🥊 Фитнес-клуб", price: 800_000_000, income_min: 2500000, income_max: 7500000, emoji: "🥊", tasks: [
    { id: "coaches", name: "💪 Топ-тренеры" }, { id: "protein", name: "🥤 Протеин-бар" }, { id: "pool", name: "🏊 Хлорировать бассейн" }
  ]},
  5: { id: 5, name: "🏨 Отель", price: 3500000000, income_min: 12000000, income_max: 36000000, emoji: "🏨", tasks: [
    { id: "stars", name: "⭐️ Пятая звезда" }, { id: "buffet", name: "🍳 Шведский стол" }, { id: "vip_room", name: "🛋️ Президентский люкс" }
  ]},
  6: { id: 6, name: "🚢 Логистическая компания", price: 15000000000, income_min: 50000000, income_max: 150000000, emoji: "🚢", tasks: [
    { id: "trucks", name: "🚛 Новые фуры" }, { id: "customs", name: "🛃 Таможня" }, { id: "route", name: "🗺️ Новый маршрут" }
  ]},
  7: { id: 7, name: "🏭 Нефтяная вышка", price: 60000000000, income_min: 200000000, income_max: 600000000, emoji: "🏭", tasks: [
    { id: "drill", name: "⚙️ Бурение" }, { id: "ecology", name: "🌱 Эко-контроль" }, { id: "export", name: "🛢️ Контракт на экспорт" }
  ]},
  8: { id: 8, name: "🚀 Аэрокосмический завод", price: 250000000000, income_min: 1000000000, income_max: 3000000000, emoji: "🚀", tasks: [
    { id: "engine", name: "🔥 Ионный двигатель" }, { id: "satellite", name: "📡 Спутник связи" }, { id: "mars", name: "☄️ Миссия на Марс" }
  ]},
  9: { id: 9, name: "🌍 Международная корпорация", price: 100000000000, income_min: 1000000000, income_max: 5000000000, emoji: "🌍", tasks: [
    { id: "merge", name: "🤝 Поглотить компанию" }, { id: "lobby", name: "🎩 Лоббирование" }, { id: "monopoly", name: "♟️ Захватить рынок" }
  ]},
  10: { id: 10, name: "🌐 Мировое правительство", price: 1000000000000, income_min: 10000000000, income_max: 100000000000, emoji: "🌐", tasks: [
    { id: "summit", name: "🕊️ Провести саммит" }, { id: "sanction", name: "⚔️ Ввести санкции" }, { id: "print", name: "💵 Напечатать деньги" }
  ]},
};

const BUSINESS_TASK_COOLDOWN = 3600; // 1h
const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "7️⃣", "⭐", "🔔"];
const SLOT_WEIGHTS = [30, 25, 20, 15, 5, 3, 1, 1];
const SLOT_MULTIPLIERS = { "🍒": 2, "🍋": 2.5, "🍊": 3, "🍇": 4, "💎": 8, "7️⃣": 15, "⭐": 25, "🔔": 50 };
const ROULETTE_REDS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const MAX_LEVEL = 1000;

// ====================== PLINKO ======================
const PLINKO_ROWS_OPTIONS = [8, 9, 12, 16];
const PLINKO_RISKS = ['low', 'medium', 'high'];

const PLINKO_MULTIPLIERS = {
  8: {
    low: [1.7, 1.4, 1.15, 1.0, 0.85, 1.0, 1.15, 1.4, 1.7],
    medium: [2.6, 1.7, 1.25, 0.85, 0.5, 0.85, 1.25, 1.7, 2.6],
    high: [5.0, 2.6, 1.3, 0.55, 0.25, 0.55, 1.3, 2.6, 5.0],
  },
  9: {
    low: [8, 3, 1.8, 1.1, 0.7, 1.1, 1.8, 3, 8],
    medium: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
    high: [50, 7, 2.5, 0.4, 0.1, 0.4, 2.5, 7, 50],
  },
  12: {
    low: [1.9, 1.55, 1.3, 1.15, 1.05, 0.95, 0.9, 0.95, 1.05, 1.15, 1.3, 1.55, 1.9],
    medium: [3.2, 2.1, 1.5, 1.1, 0.8, 0.55, 0.4, 0.55, 0.8, 1.1, 1.5, 2.1, 3.2],
    high: [8.0, 3.8, 2.0, 1.1, 0.6, 0.35, 0.2, 0.35, 0.6, 1.1, 2.0, 3.8, 8.0],
  },
  16: {
    low: [2.0, 1.6, 1.35, 1.2, 1.1, 1.0, 0.95, 0.9, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.35, 1.6, 2.0],
    medium: [4.5, 2.8, 1.8, 1.3, 1.0, 0.75, 0.55, 0.4, 0.3, 0.4, 0.55, 0.75, 1.0, 1.3, 1.8, 2.8, 4.5],
    high: [22, 8, 4, 2.2, 1.3, 0.7, 0.4, 0.25, 0.15, 0.25, 0.4, 0.7, 1.3, 2.2, 4, 8, 22],
  },
};

function getPlinkoMultipliers(rows, risk) {
  const table = PLINKO_MULTIPLIERS[rows];
  if (!table || !table[risk]) return PLINKO_MULTIPLIERS[12].medium;
  return table[risk];
}

function simulatePlinko(rows, risk) {
  const path = [];
  let pos = 0;
  for (let i = 0; i < rows; i++) {
    const right = Math.random() < 0.5;
    if (right) pos += 1;
    path.push(right ? 'R' : 'L');
  }
  const mults = getPlinkoMultipliers(rows, risk);
  const multiplier = mults[pos] || 1;
  return { path, finalSlot: pos, multiplier: Math.round(multiplier * 100) / 100 };
}

// ====================== BANK DEPOSIT TIERS (срочные вклады) ======================
// Higher rate => significantly lower max principal. Different terms & mins.
const DEPOSIT_TIERS = [
  {
    id: 'short',
    name: 'Краткосрочный',
    emoji: '📅',
    rate: 5,
    term_days: 7,
    min: 5000,
    max: 1000000,
    desc: 'Быстрый возврат, небольшая доходность',
  },
  {
    id: 'standard',
    name: 'Стандартный',
    emoji: '📆',
    rate: 10,
    term_days: 14,
    min: 25000,
    max: 500000,
    desc: 'Оптимальный баланс срока и дохода',
  },
  {
    id: 'profitable',
    name: 'Выгодный',
    emoji: '💰',
    rate: 18,
    term_days: 30,
    min: 100000,
    max: 300000,
    desc: 'Хорошая доходность, средний срок',
  },
  {
    id: 'premium',
    name: 'Премиум',
    emoji: '👑',
    rate: 30,
    term_days: 60,
    min: 250000,
    max: 150000,
    desc: 'Максимальный процент — для крупных сумм на долгий срок',
  },
];

function getTier(tierId) {
  return DEPOSIT_TIERS.find(t => t.id === tierId) || null;
}

function calcPayout(principal, rate) {
  return Math.floor(principal * (1 + rate / 100));
}

// ====================== HELPERS ======================
function fmt(n) {
  return (n || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
}

function getCasinoData(userRow) {
  // Build normalized casino profile from flat columns + JSON blobs
  const mining = userRow.casino_mining ? JSON.parse(userRow.casino_mining) : { farm_level: 0, btc_accumulated: 0, last_collected: null, extra_farms: 0 };
  const businesses = userRow.casino_businesses ? JSON.parse(userRow.casino_businesses) : {};
  const achievements = userRow.casino_achievements ? JSON.parse(userRow.casino_achievements) : [];
  const transfers = userRow.casino_transfers ? JSON.parse(userRow.casino_transfers) : { count: 0, date: '' };

  return {
    balance: userRow.casino_balance ?? START_BALANCE,
    bank_balance: userRow.casino_bank_balance || 0,
    level: userRow.casino_level || 1,
    xp: userRow.casino_xp || 0,
    rating: userRow.casino_rating || 0,
    vip: !!userRow.casino_vip,
    games_played: userRow.casino_games_played || 0,
    total_won: userRow.casino_total_won || 0,
    total_lost: userRow.casino_total_lost || 0,
    daily_last: userRow.casino_daily_last,
    streak: userRow.casino_streak || 0,
    last_bet: userRow.casino_last_bet || 0,
    joined: userRow.casino_joined,
    banned: !!userRow.casino_banned,
    mining,
    businesses,
    achievements,
    transfers,
  };
}

async function saveCasinoProfile(db, userId, profile) {
  const miningStr = JSON.stringify(profile.mining || {});
  const bizStr = JSON.stringify(profile.businesses || {});
  const achStr = JSON.stringify(profile.achievements || []);
  const transStr = JSON.stringify(profile.transfers || { count: 0, date: '' });

  await db.run(`
    UPDATE users SET
      casino_balance = ?,
      casino_bank_balance = ?,
      casino_level = ?,
      casino_xp = ?,
      casino_rating = ?,
      casino_vip = ?,
      casino_games_played = ?,
      casino_total_won = ?,
      casino_total_lost = ?,
      casino_daily_last = ?,
      casino_streak = ?,
      casino_last_bet = ?,
      casino_joined = COALESCE(casino_joined, ?),
      casino_mining = ?,
      casino_businesses = ?,
      casino_achievements = ?,
      casino_transfers = ?
    WHERE id = ?
  `, [
    profile.balance || 0,
    profile.bank_balance || 0,
    profile.level || 1,
    profile.xp || 0,
    profile.rating || 0,
    profile.vip ? 1 : 0,
    profile.games_played || 0,
    profile.total_won || 0,
    profile.total_lost || 0,
    profile.daily_last || null,
    profile.streak || 0,
    profile.last_bet || 0,
    new Date().toISOString(),
    miningStr,
    bizStr,
    achStr,
    transStr,
    userId
  ]);
}

async function ensureCasinoInit(db, userId) {
  const u = await db.get('SELECT casino_joined FROM users WHERE id = ?', [userId]);
  if (!u || !u.casino_joined) {
    await db.run(`
      UPDATE users SET
        casino_balance = COALESCE(casino_balance, ?),
        casino_joined = COALESCE(casino_joined, ?),
        casino_mining = COALESCE(casino_mining, ?),
        casino_businesses = COALESCE(casino_businesses, ?),
        casino_achievements = COALESCE(casino_achievements, ?),
        casino_transfers = COALESCE(casino_transfers, ?)
      WHERE id = ?
    `, [
      START_BALANCE,
      new Date().toISOString(),
      JSON.stringify({ farm_level: 0, btc_accumulated: 0, last_collected: null, extra_farms: 0 }),
      '{}',
      '[]',
      JSON.stringify({ count: 0, date: '' }),
      userId
    ]);
  }
}

async function getCasinoUser(db, userId) {
  await ensureCasinoInit(db, userId);
  const row = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!row) throw new Error('User not found');
  if (row.casino_banned) throw new Error('Вы забанены в казино');
  return { row, profile: getCasinoData(row) };
}

async function updateCasinoBalance(db, userId, delta, isWin = null) {
  const { profile } = await getCasinoUser(db, userId);
  const before = profile.balance;
  profile.balance = Math.max(0, before + delta);

  if (delta > 0) {
    profile.total_won = (profile.total_won || 0) + delta;
  } else if (delta < 0) {
    profile.total_lost = (profile.total_lost || 0) + Math.abs(delta);
  }
  profile.games_played = (profile.games_played || 0) + 1;

  // XP + level (ported logic)
  const xpGain = Math.max(1, Math.floor(Math.abs(delta) / 10000));
  profile.xp = (profile.xp || 0) + xpGain;
  profile.level = Math.min(MAX_LEVEL, calcLevelFromXp(profile.xp));

  // achievements
  profile.achievements = profile.achievements || [];
  const checks = [
    ['first_win', profile.total_won >= 1],
    ['rich', profile.balance >= 10000],
    ['veteran', profile.games_played >= 100],
    ['whale', profile.total_won >= 100000],
    ['lucky', profile.level >= 5],
  ];
  for (const [key, cond] of checks) {
    if (cond && !profile.achievements.includes(key)) profile.achievements.push(key);
  }

  await saveCasinoProfile(db, userId, profile);
  return profile.balance;
}

function xpForLevel(lvl) { return Math.floor(5000 * Math.pow(lvl, 1.8)); }
function calcLevelFromXp(xp) {
  let lvl = 1;
  while (lvl < MAX_LEVEL && xp >= xpForLevel(lvl)) lvl++;
  return lvl;
}

function getTransferLimits(profile) {
  if (profile.vip) return [TRANSFER_MAX_VIP, TRANSFER_DAILY_LIMIT_VIP];
  return [TRANSFER_MAX, TRANSFER_DAILY_LIMIT];
}

function getTransfersToday(profile) {
  const t = profile.transfers || { count: 0, date: '' };
  const today = new Date().toISOString().slice(0, 10);
  if (t.date !== today) return 0;
  return t.count || 0;
}

async function addTransferCount(db, userId, profile) {
  const today = new Date().toISOString().slice(0, 10);
  const t = profile.transfers || { count: 0, date: '' };
  if (t.date !== today) { t.count = 0; t.date = today; }
  t.count = (t.count || 0) + 1;
  profile.transfers = t;
  await saveCasinoProfile(db, userId, profile);
}

// ====================== PROFILE & LEADERBOARD ======================
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { row, profile } = await getCasinoUser(db, req.user.id);

    // rank by rating
    const all = await db.all('SELECT id, casino_rating, casino_balance FROM users');
    const sorted = all.filter(u => (u.casino_rating || 0) > 0 || (u.casino_balance || 0) > 0)
      .sort((a, b) => (b.casino_rating || 0) - (a.casino_rating || 0));
    let rank = sorted.findIndex(u => u.id === req.user.id) + 1;
    if (rank === 0) rank = sorted.length + 1;

    const totalBtc = miningGetAccumulated(profile);

    res.json({
      ...profile,
      game_id: req.user.id, // reuse social id as game id
      username: row.username,
      rank,
      total_btc: totalBtc,
      btc_value: Math.floor(totalBtc * BTC_SELL_RATE),
      hide_balance: !!row.casino_hide_balance,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get('/leaderboard', authMiddleware, async (req, res) => {
  const db = getDB();
  const rows = await db.all(`
    SELECT id, username, display_name, casino_rating, casino_balance, casino_vip, casino_level
    FROM users
    ORDER BY casino_rating DESC, casino_balance DESC
    LIMIT 20
  `);
  const top = rows.map((r, i) => ({
    rank: i + 1,
    username: r.username,
    display_name: r.display_name,
    rating: r.casino_rating || 0,
    balance: r.casino_balance || 0,
    vip: !!r.casino_vip,
    level: r.casino_level || 1,
  }));
  res.json(top);
});

// ====================== DAILY BONUS ======================
router.post('/bonus/claim', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { profile } = await getCasinoUser(db, req.user.id);
    const now = new Date();

    if (profile.daily_last) {
      const last = new Date(profile.daily_last);
      if ((now.getTime() - last.getTime()) < 86400 * 1000) {
        const remain = 86400 * 1000 - (now.getTime() - last.getTime());
        return res.json({ error: 'Бонус уже получен', remaining_ms: remain });
      }
      const diffDays = (now.getTime() - last.getTime()) / 86400000;
      profile.streak = diffDays < 2 ? (profile.streak || 0) + 1 : 1;
    } else {
      profile.streak = 1;
    }

    let bonus = DAILY_BONUS + (profile.streak - 1) * 100;
    if (profile.vip) bonus = Math.floor(bonus * 1.5);

    profile.balance += bonus;
    profile.daily_last = now.toISOString();
    await saveCasinoProfile(db, req.user.id, profile);

    res.json({ bonus, new_balance: profile.balance, streak: profile.streak, vip: profile.vip });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ====================== GAMES ======================
// --- SLOTS ---
router.post('/games/slots/play', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet } = req.body;
    if (!bet || bet < MIN_BET) return res.status(400).json({ error: 'Минимальная ставка ' + MIN_BET });

    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

    profile.last_bet = bet;
    await saveCasinoProfile(db, req.user.id, profile);

    await updateCasinoBalance(db, req.user.id, -bet);

    const reels = spinSlots();
    const { mult, status } = slotsResult(reels);
    const win = Math.floor(bet * mult);
    const profit = win - bet;
    const newBal = await updateCasinoBalance(db, req.user.id, win);

    res.json({ reels, status, mult, bet, win, profit, balance: newBal });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

function spinSlots() {
  // weighted choice
  const totalW = SLOT_WEIGHTS.reduce((a, b) => a + b, 0);
  const pick = () => {
    let r = Math.random() * totalW;
    for (let i = 0; i < SLOT_SYMBOLS.length; i++) {
      r -= SLOT_WEIGHTS[i];
      if (r <= 0) return SLOT_SYMBOLS[i];
    }
    return SLOT_SYMBOLS[0];
  };
  return [pick(), pick(), pick()];
}
function slotsResult(reels) {
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    const m = SLOT_MULTIPLIERS[reels[0]] || 2;
    return { mult: m, status: `🎰 ДЖЕКПОТ! x${m}` };
  }
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
    return { mult: 1.5, status: '✨ Две совпали! x1.5' };
  }
  return { mult: 0, status: '❌ Проигрыш' };
}

// --- MINES (interactive via sessions) ---
router.post('/games/mines/start', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet, minesCount } = req.body;
    if (![3,5,10,15].includes(minesCount)) return res.status(400).json({ error: 'Неверное кол-во мин' });
    if (!bet || bet < MIN_BET) return res.status(400).json({ error: 'Ставка слишком мала' });

    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

    profile.last_bet = bet;
    await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    // create grid
    const grid = Array(25).fill(0);
    const mineIdx = [];
    while (mineIdx.length < minesCount) {
      const i = Math.floor(Math.random() * 25);
      if (!mineIdx.includes(i)) { mineIdx.push(i); grid[i] = 1; }
    }

    const state = { minesCount, grid, opened: [], mult: 1.0, bet };
    const sess = await db.run(
      'INSERT INTO casino_game_sessions (user_id, game_type, bet, state) VALUES (?,?,?,?)',
      [req.user.id, 'mines', bet, JSON.stringify(state)]
    );
    const sessionId = sess.lastID;

    res.json({ sessionId, minesCount, bet, gridSize: 25, safeCells: 25 - minesCount, mult: 1.0, opened: [] });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/games/mines/open', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { sessionId, cell } = req.body;
    const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id = ? AND user_id = ?', [sessionId, req.user.id]);
    if (!sess) return res.status(404).json({ error: 'Сессия не найдена' });

    const state = JSON.parse(sess.state);
    if (state.opened.includes(cell)) return res.json({ ok: true, already: true });

    state.opened.push(cell);
    let busted = state.grid[cell] === 1;

    if (!busted) {
      state.mult = getMinesMult(state.opened.length, state.minesCount);
    }

    const safeLeft = 25 - state.minesCount;
    const finished = !busted && state.opened.length === safeLeft;

    let result = null;
    if (busted || finished) {
      if (busted) {
        result = { type: 'loss', lost: state.bet };
      } else {
        const win = Math.floor(state.bet * state.mult);
        const newBal = await updateCasinoBalance(db, req.user.id, win);
        result = { type: 'win', win, mult: state.mult, balance: newBal };
      }
      await db.run('DELETE FROM casino_game_sessions WHERE id = ?', [sessionId]);
    } else {
      await db.run('UPDATE casino_game_sessions SET state = ? WHERE id = ?', [JSON.stringify(state), sessionId]);
    }

    // On bust reveal all mine positions so client can show them nicely
    let mines = null;
    if (busted) {
      mines = [];
      for (let i = 0; i < state.grid.length; i++) if (state.grid[i]) mines.push(i);
    }

    res.json({
      opened: state.opened,
      mult: state.mult,
      busted,
      finished,
      result,
      potential: Math.floor(state.bet * state.mult),
      mines, // only present on loss
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/games/mines/cashout', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { sessionId } = req.body;
    const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id = ? AND user_id = ?', [sessionId, req.user.id]);
    if (!sess) return res.status(404).json({ error: 'Сессия не найдена' });

    const state = JSON.parse(sess.state);
    const win = Math.floor(state.bet * state.mult);
    const newBal = await updateCasinoBalance(db, req.user.id, win);

    await db.run('DELETE FROM casino_game_sessions WHERE id = ?', [sessionId]);
    res.json({ win, mult: state.mult, balance: newBal });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

function getMinesMult(opened, minesCount) {
  const cells = 25 - minesCount;
  if (opened === 0) return 1.0;
  let m = 1.0;
  for (let i = 0; i < opened; i++) m *= (25 - i) / (cells - i);
  return Math.round(m * MINES_HOUSE_EDGE * 100) / 100;
}

// --- BLACKJACK (with Split & Double support) ---
function ranksEqual(a, b) {
  return !!(a && b && a.rank === b.rank);
}
function isPair(hand) {
  return Array.isArray(hand) && hand.length === 2 && ranksEqual(hand[0], hand[1]);
}

// Advance to next hand or mark round as ready to resolve
function advanceHand(state) {
  const hands = state.playerHands || [];
  let idx = state.currentHandIndex ?? 0;

  // find next non-finished hand
  for (let i = idx + 1; i < hands.length; i++) {
    if (!hands[i].stood && !hands[i].busted) {
      state.currentHandIndex = i;
      return false; // still more hands to play
    }
  }
  // no more hands
  state.currentHandIndex = hands.length; // past the end
  return true; // all hands finished
}

function allHandsFinished(state) {
  const hands = state.playerHands || [];
  return hands.every(h => h.stood || h.busted);
}

function computeHandResult(pHand, pBet, dVal, dBusted) {
  const pv = handValue(pHand);
  if (pv > 21) return { win: 0, status: 'Перебор' };

  // Natural blackjack only on non-split original 2-card hand
  const isNatural = pHand.length === 2 && pv === 21 && !pHand.some(c => c._fromSplit);

  if (dBusted) {
    const mult = isNatural ? 2.5 : 2;
    return { win: Math.floor(pBet * mult), status: isNatural ? 'Блэкджек!' : 'Дилер перебрал' };
  }
  if (isNatural) {
    return { win: Math.floor(pBet * 2.5), status: 'Блэкджек!' };
  }
  if (pv > dVal) {
    return { win: pBet * 2, status: 'Вы победили' };
  } else if (pv < dVal) {
    return { win: 0, status: 'Дилер выиграл' };
  } else {
    return { win: pBet, status: 'Ничья' };
  }
}

router.post('/games/blackjack/start', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet } = req.body;
    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });
    profile.last_bet = bet; await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    const deck = newDeck();
    const pHand = [deck.pop(), deck.pop()];
    const dHand = [deck.pop(), deck.pop()];

    // mark cards for split tracking if needed later
    pHand.forEach(c => { c._fromSplit = false; });

    const pVal = handValue(pHand);
    if (pVal === 21) {
      const win = Math.floor(bet * 2.5);
      const bal = await updateCasinoBalance(db, req.user.id, win);
      return res.json({ natural: true, win, balance: bal, pHand, dHand, dVal: handValue(dHand) });
    }

    const state = {
      bet,                    // base bet per hand
      deck,
      playerHands: [{ cards: pHand, bet, stood: false, busted: false }],
      currentHandIndex: 0,
      dealerHand: dHand
    };

    const sess = await db.run('INSERT INTO casino_game_sessions(user_id,game_type,bet,state) VALUES (?,?,?,?)',
      [req.user.id, 'blackjack', bet, JSON.stringify(state)]);

    const canSplit = isPair(pHand) && profile.balance >= bet; // enough for second bet
    const canDouble = profile.balance >= bet; // enough to double the current hand

    res.json({
      sessionId: sess.lastID,
      playerHands: state.playerHands,
      currentHandIndex: 0,
      dealerUp: dHand[0],
      bet,
      canSplit,
      canDouble
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/games/blackjack/hit', authMiddleware, async (req, res) => {
  const db = getDB();
  const { sessionId } = req.body;
  const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id=? AND user_id=?', [sessionId, req.user.id]);
  if (!sess) return res.status(404).json({ error: 'Нет игры' });
  const state = JSON.parse(sess.state);

  const idx = state.currentHandIndex ?? 0;
  const hand = state.playerHands[idx];
  if (!hand || hand.stood || hand.busted) {
    return res.status(400).json({ error: 'Невозможно взять карту' });
  }
  if (hand.splitAces) {
    return res.status(400).json({ error: 'При сплите тузов нельзя добирать' });
  }

  hand.cards.push(state.deck.pop());
  const pv = handValue(hand.cards);

  let handJustFinished = false;
  if (pv > 21) {
    hand.busted = true;
    hand.stood = true;
    handJustFinished = true;
  }

  if (handJustFinished) {
    const finishedAll = advanceHand(state) || allHandsFinished(state);

    if (finishedAll) {
      // resolve the whole round
      const dHand = [...state.dealerHand];
      while (handValue(dHand) < 17) dHand.push(state.deck.pop());
      const dv = handValue(dHand);
      const dBusted = dv > 21;

      let totalWin = 0;
      const handResults = [];
      for (const h of state.playerHands) {
        const res = computeHandResult(h.cards, h.bet, dv, dBusted);
        totalWin += res.win;
        handResults.push({ ...res, cards: h.cards, bet: h.bet });
      }

      const bal = await updateCasinoBalance(db, req.user.id, totalWin);
      await db.run('DELETE FROM casino_game_sessions WHERE id=?', [sessionId]);

      return res.json({
        finished: true,
        playerHands: state.playerHands,
        dHand,
        dVal: dv,
        totalWin,
        balance: bal,
        handResults
      });
    }

    // bust on this hand, but there is another hand (e.g. after split). Return updated state.
    await db.run('UPDATE casino_game_sessions SET state=? WHERE id=?', [JSON.stringify(state), sessionId]);
    return res.json({
      playerHands: state.playerHands,
      currentHandIndex: state.currentHandIndex
    });
  }

  // Successful hit (pv <= 21) — hand remains active, player can hit again or stand.
  await db.run('UPDATE casino_game_sessions SET state=? WHERE id=?', [JSON.stringify(state), sessionId]);
  res.json({
    playerHands: state.playerHands,
    currentHandIndex: state.currentHandIndex,
    pVal: pv
  });
});

router.post('/games/blackjack/stand', authMiddleware, async (req, res) => {
  const db = getDB();
  const { sessionId } = req.body;
  const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id=? AND user_id=?', [sessionId, req.user.id]);
  if (!sess) return res.status(404).json({ error: 'Нет игры' });
  const state = JSON.parse(sess.state);

  const idx = state.currentHandIndex ?? 0;
  const hand = state.playerHands[idx];
  if (hand) hand.stood = true;

  const finishedAll = advanceHand(state) || allHandsFinished(state);

  if (finishedAll) {
    const dHand = [...state.dealerHand];
    while (handValue(dHand) < 17) dHand.push(state.deck.pop());
    const dv = handValue(dHand);
    const dBusted = dv > 21;

    let totalWin = 0;
    const handResults = [];
    for (const h of state.playerHands) {
      const res = computeHandResult(h.cards, h.bet, dv, dBusted);
      totalWin += res.win;
      handResults.push({ ...res, cards: h.cards, bet: h.bet });
    }

    const bal = await updateCasinoBalance(db, req.user.id, totalWin);
    await db.run('DELETE FROM casino_game_sessions WHERE id=?', [sessionId]);

    return res.json({
      finished: true,
      playerHands: state.playerHands,
      dHand,
      dVal: dv,
      totalWin,
      balance: bal,
      handResults
    });
  }

  await db.run('UPDATE casino_game_sessions SET state=? WHERE id=?', [JSON.stringify(state), sessionId]);
  res.json({
    playerHands: state.playerHands,
    currentHandIndex: state.currentHandIndex
  });
});

router.post('/games/blackjack/double', authMiddleware, async (req, res) => {
  const db = getDB();
  const { sessionId } = req.body;
  const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id=? AND user_id=?', [sessionId, req.user.id]);
  if (!sess) return res.status(404).json({ error: 'Нет игры' });
  const state = JSON.parse(sess.state);

  const idx = state.currentHandIndex ?? 0;
  const hand = state.playerHands[idx];
  if (!hand || hand.cards.length !== 2 || hand.stood || hand.busted || hand.splitAces) {
    return res.status(400).json({ error: 'Дабл невозможен' });
  }

  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < hand.bet) {
    return res.status(400).json({ error: 'Недостаточно средств для дабла' });
  }

  // deduct the additional bet for this hand
  await updateCasinoBalance(db, req.user.id, -hand.bet);
  hand.bet = hand.bet * 2;
  hand.cards.push(state.deck.pop());
  hand.stood = true;

  const finishedAll = advanceHand(state) || allHandsFinished(state);

  if (finishedAll) {
    const dHand = [...state.dealerHand];
    while (handValue(dHand) < 17) dHand.push(state.deck.pop());
    const dv = handValue(dHand);
    const dBusted = dv > 21;

    let totalWin = 0;
    const handResults = [];
    for (const h of state.playerHands) {
      const res = computeHandResult(h.cards, h.bet, dv, dBusted);
      totalWin += res.win;
      handResults.push({ ...res, cards: h.cards, bet: h.bet });
    }

    const bal = await updateCasinoBalance(db, req.user.id, totalWin);
    await db.run('DELETE FROM casino_game_sessions WHERE id=?', [sessionId]);

    return res.json({
      finished: true,
      playerHands: state.playerHands,
      dHand,
      dVal: dv,
      totalWin,
      balance: bal,
      handResults
    });
  }

  await db.run('UPDATE casino_game_sessions SET state=? WHERE id=?', [JSON.stringify(state), sessionId]);
  res.json({
    playerHands: state.playerHands,
    currentHandIndex: state.currentHandIndex
  });
});

router.post('/games/blackjack/split', authMiddleware, async (req, res) => {
  const db = getDB();
  const { sessionId } = req.body;
  const sess = await db.get('SELECT * FROM casino_game_sessions WHERE id=? AND user_id=?', [sessionId, req.user.id]);
  if (!sess) return res.status(404).json({ error: 'Нет игры' });
  const state = JSON.parse(sess.state);

  const idx = state.currentHandIndex ?? 0;
  const hand = state.playerHands[idx];
  if (!hand || hand.cards.length !== 2 || !isPair(hand.cards) || hand.stood) {
    return res.status(400).json({ error: 'Сплит невозможен' });
  }

  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < state.bet) {
    return res.status(400).json({ error: 'Недостаточно средств для сплита' });
  }

  // deduct second bet
  await updateCasinoBalance(db, req.user.id, -state.bet);

  const cardA = hand.cards[0];
  const cardB = hand.cards[1];
  cardA._fromSplit = true;
  cardB._fromSplit = true;

  const newCardA = state.deck.pop();
  const newCardB = state.deck.pop();
  newCardA._fromSplit = true;
  newCardB._fromSplit = true;

  const isAces = cardA.rank === 'A';

  const newHands = [
    { cards: [cardA, newCardA], bet: state.bet, stood: false, busted: false, wasSplit: true, splitAces: isAces },
    { cards: [cardB, newCardB], bet: state.bet, stood: false, busted: false, wasSplit: true, splitAces: isAces }
  ];

  if (isAces) {
    // split aces: one card each, auto stand
    newHands[0].stood = true;
    newHands[1].stood = true;
  }

  state.playerHands = newHands;
  state.currentHandIndex = 0;
  state.isSplit = true;

  // if aces, both hands are already finished → resolve
  if (isAces) {
    const dHand = [...state.dealerHand];
    while (handValue(dHand) < 17) dHand.push(state.deck.pop());
    const dv = handValue(dHand);
    const dBusted = dv > 21;

    let totalWin = 0;
    const handResults = [];
    for (const h of state.playerHands) {
      const res = computeHandResult(h.cards, h.bet, dv, dBusted);
      totalWin += res.win;
      handResults.push({ ...res, cards: h.cards, bet: h.bet });
    }

    const bal = await updateCasinoBalance(db, req.user.id, totalWin);
    await db.run('DELETE FROM casino_game_sessions WHERE id=?', [sessionId]);

    return res.json({
      finished: true,
      playerHands: state.playerHands,
      dHand,
      dVal: dv,
      totalWin,
      balance: bal,
      handResults
    });
  }

  await db.run('UPDATE casino_game_sessions SET state=? WHERE id=?', [JSON.stringify(state), sessionId]);
  res.json({
    playerHands: state.playerHands,
    currentHandIndex: 0,
    bet: state.bet
  });
});

function newDeck() {
  const suits = ["♠️","♥️","♦️","♣️"]; const ranks = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
  const d = ranks.flatMap(r => suits.map(s => ({rank:r, suit:s})));
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [d[i],d[j]]=[d[j],d[i]]; }
  return d;
}
function handValue(hand) {
  let v = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') aces++;
    else if (['J','Q','K'].includes(c.rank)) v += 10;
    else v += parseInt(c.rank);
  }
  for (let i = 0; i < aces; i++) v += (v + 11 <= 21 ? 11 : 1);
  return v;
}
function cardStr(c) { return `${c.rank}${c.suit}`; }

// --- DICE (solo + basic PvP rooms via table) ---
router.post('/games/dice/play', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet, betType, target } = req.body; // betType: high/low/seven/numN
    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });
    profile.last_bet = bet; await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    const d1 = 1 + Math.floor(Math.random()*6), d2 = 1 + Math.floor(Math.random()*6);
    const sum = d1 + d2;
    let win = 0;
    const t = (betType || '').toString();
    if (t === 'high' && sum > 7) win = Math.floor(bet * 1.9);
    else if (t === 'low' && sum < 7) win = Math.floor(bet * 1.9);
    else if (t === 'seven' && sum === 7) win = Math.floor(bet * 5);
    else if (t.startsWith('num') && sum === parseInt(t.replace('num',''))) win = Math.floor(bet * 36);

    const bal = await updateCasinoBalance(db, req.user.id, win);
    res.json({ d1, d2, sum, win, bet, balance: bal });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Simple PvP dice rooms (list/create/join/resolve)
router.get('/pvp/dice/rooms', authMiddleware, async (req, res) => {
  const db = getDB();
  const rooms = await db.all(`SELECT * FROM casino_pvp_rooms WHERE game_type='dice' AND status='wait' ORDER BY created_at DESC LIMIT 30`);
  res.json(rooms.map(r => ({ room_id: r.room_id, bet: r.bet, creator: r.p1_id })));
});

router.post('/pvp/dice/create', authMiddleware, async (req, res) => {
  const db = getDB();
  const { bet } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });
  // check no active room for user
  const existing = await db.get('SELECT 1 FROM casino_pvp_rooms WHERE p1_id=? AND status="wait"', [req.user.id]);
  if (existing) return res.status(400).json({ error: 'У вас уже есть комната' });

  await updateCasinoBalance(db, req.user.id, -bet);
  const roomId = (Date.now() % 100000).toString().padStart(5, '0') + Math.floor(Math.random()*90);
  await db.run('INSERT INTO casino_pvp_rooms (room_id, game_type, p1_id, bet) VALUES (?,?,?,?)', [roomId, 'dice', req.user.id, bet]);
  res.json({ room_id: roomId, bet });
});

router.post('/pvp/dice/join', authMiddleware, async (req, res) => {
  const db = getDB();
  const { roomId } = req.body;
  const room = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=? AND status="wait"', [roomId]);
  if (!room) return res.status(404).json({ error: 'Комната закрыта' });
  if (room.p1_id === req.user.id) return res.status(400).json({ error: 'Нельзя играть с собой' });
  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < room.bet) return res.status(400).json({ error: 'Нет средств' });
  await updateCasinoBalance(db, req.user.id, -room.bet);

  const d1 = Math.ceil(Math.random()*6) + Math.ceil(Math.random()*6);
  const d2 = Math.ceil(Math.random()*6) + Math.ceil(Math.random()*6);
  const totalPot = Math.floor(room.bet * 2 * 0.95);

  let winnerId, loserId;
  if (d1 > d2) { winnerId = room.p1_id; loserId = req.user.id; }
  else if (d2 > d1) { winnerId = req.user.id; loserId = room.p1_id; }
  else {
    // tie refund
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id IN (?,?)', [room.bet, room.p1_id, req.user.id]);
    await db.run('DELETE FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
    return res.json({ tie: true, d1, d2 });
  }
  await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [totalPot, winnerId]);
  await db.run('DELETE FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
  res.json({ winner: winnerId, loser: loserId, d1, d2, payout: totalPot });
});

// ====================== COIN PvP (side choice + flip, 5% house) ======================
function generateCoinRoomId() {
  // short memorable numeric code like the bot (4-6 digits)
  return (Date.now() % 100000).toString().padStart(5, '0') + Math.floor(Math.random() * 90);
}

async function getUserDisplay(db, userId) {
  if (!userId) return null;
  const u = await db.get('SELECT id, username, display_name FROM users WHERE id = ?', [userId]);
  if (!u) return null;
  return { id: u.id, username: u.username, display_name: u.display_name || u.username };
}

router.get('/pvp/coin/rooms', authMiddleware, async (req, res) => {
  const db = getDB();
  const rooms = await db.all(
    `SELECT * FROM casino_pvp_rooms WHERE game_type='coin' AND status IN ('wait','choosing') ORDER BY created_at DESC LIMIT 30`
  );
  const enriched = [];
  for (const r of rooms) {
    const p1 = await getUserDisplay(db, r.p1_id);
    const p2 = await getUserDisplay(db, r.p2_id);
    enriched.push({
      room_id: r.room_id,
      bet: r.bet,
      status: r.status,
      p1: p1 ? { id: p1.id, name: p1.display_name || p1.username } : null,
      p2: p2 ? { id: p2.id, name: p2.display_name || p2.username } : null,
      p1_choice: r.p1_choice,
      p2_choice: r.p2_choice,
      created_at: r.created_at,
    });
  }
  res.json(enriched);
});

// Get single room (for polling)
router.get('/pvp/coin/room/:roomId', authMiddleware, async (req, res) => {
  const db = getDB();
  const r = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=?', [req.params.roomId]);
  if (!r) return res.status(404).json({ error: 'Комната не найдена' });
  const p1 = await getUserDisplay(db, r.p1_id);
  const p2 = await getUserDisplay(db, r.p2_id);
  res.json({
    room_id: r.room_id,
    bet: r.bet,
    status: r.status,
    p1: p1 ? { id: p1.id, name: p1.display_name || p1.username } : null,
    p2: p2 ? { id: p2.id, name: p2.display_name || p2.username } : null,
    p1_choice: r.p1_choice,
    p2_choice: r.p2_choice,
    created_at: r.created_at,
  });
});

router.post('/pvp/coin/create', authMiddleware, async (req, res) => {
  const db = getDB();
  const { bet, side } = req.body; // side: 'heads' | 'tails'
  if (!bet || bet < 10) return res.status(400).json({ error: 'Минимальная ставка 10' });
  if (!['heads', 'tails'].includes(side)) return res.status(400).json({ error: 'Выберите сторону' });

  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });

  const existing = await db.get('SELECT 1 FROM casino_pvp_rooms WHERE p1_id=? AND status IN ("wait","choosing")', [req.user.id]);
  if (existing) return res.status(400).json({ error: 'У вас уже есть активная комната' });

  await updateCasinoBalance(db, req.user.id, -bet);

  const roomId = generateCoinRoomId();
  await db.run(
    'INSERT INTO casino_pvp_rooms (room_id, game_type, p1_id, bet, p1_choice, status) VALUES (?,?,?,?,?,?)',
    [roomId, 'coin', req.user.id, bet, side, 'wait']
  );

  const p1 = await getUserDisplay(db, req.user.id);
  res.json({
    room_id: roomId,
    bet,
    side,
    status: 'wait',
    p1: p1 ? { id: p1.id, name: p1.display_name || p1.username } : null,
  });
});

router.post('/pvp/coin/join', authMiddleware, async (req, res) => {
  const db = getDB();
  const { roomId } = req.body;
  const room = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=? AND status="wait"', [roomId]);
  if (!room) return res.status(404).json({ error: 'Комната закрыта или уже занята' });
  if (room.p1_id === req.user.id) return res.status(400).json({ error: 'Нельзя играть с самим собой' });

  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.balance < room.bet) return res.status(400).json({ error: 'Нет средств' });

  await updateCasinoBalance(db, req.user.id, -room.bet);

  await db.run('UPDATE casino_pvp_rooms SET p2_id=?, status="choosing" WHERE room_id=?', [req.user.id, roomId]);

  const p1 = await getUserDisplay(db, room.p1_id);
  const p2 = await getUserDisplay(db, req.user.id);
  res.json({
    room_id: roomId,
    bet: room.bet,
    status: 'choosing',
    p1: p1 ? { id: p1.id, name: p1.display_name || p1.username, choice: room.p1_choice } : null,
    p2: p2 ? { id: p2.id, name: p2.display_name || p2.username } : null,
    p1_choice: room.p1_choice,
  });
});

router.post('/pvp/coin/choose', authMiddleware, async (req, res) => {
  const db = getDB();
  const { roomId, side } = req.body;
  if (!['heads', 'tails'].includes(side)) return res.status(400).json({ error: 'Неверная сторона' });

  const room = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });
  if (room.status === 'finished') return res.status(400).json({ error: 'Игра уже завершена' });

  const uid = req.user.id;
  let isP1 = uid === room.p1_id;
  let isP2 = uid === room.p2_id;

  if (!isP1 && !isP2) return res.status(403).json({ error: 'Вы не участник этой комнаты' });

  if (isP1) {
    if (room.p1_choice) return res.status(400).json({ error: 'Вы уже выбрали сторону' });
    await db.run('UPDATE casino_pvp_rooms SET p1_choice=? WHERE room_id=?', [side, roomId]);
    room.p1_choice = side;
  } else {
    if (room.p2_choice) return res.status(400).json({ error: 'Вы уже выбрали сторону' });
    await db.run('UPDATE casino_pvp_rooms SET p2_choice=? WHERE room_id=?', [side, roomId]);
    room.p2_choice = side;
  }

  // re-fetch fresh
  const fresh = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=?', [roomId]);

  // If both have chosen -> resolve immediately
  if (fresh.p1_choice && fresh.p2_choice) {
    const result = await resolveCoinPvp(db, fresh);
    return res.json(result);
  }

  // Otherwise just confirm choice
  const p1 = await getUserDisplay(db, fresh.p1_id);
  const p2 = await getUserDisplay(db, fresh.p2_id);
  res.json({
    ok: true,
    chosen: side,
    room: {
      room_id: fresh.room_id,
      bet: fresh.bet,
      status: fresh.status,
      p1: p1 ? { id: p1.id, name: p1.display_name || p1.username, choice: fresh.p1_choice } : null,
      p2: p2 ? { id: p2.id, name: p2.display_name || p2.username, choice: fresh.p2_choice } : null,
    },
  });
});

router.post('/pvp/coin/cancel', authMiddleware, async (req, res) => {
  const db = getDB();
  const { roomId } = req.body;
  const room = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
  if (!room) return res.status(404).json({ error: 'Комната не найдена' });
  if (room.p1_id !== req.user.id) return res.status(403).json({ error: 'Только создатель может отменить' });
  if (room.p2_id) return res.status(400).json({ error: 'Нельзя отменить — соперник уже зашёл' });

  // refund
  await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [room.bet, room.p1_id]);
  await db.run('DELETE FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
  res.json({ ok: true, refunded: room.bet });
});

async function resolveCoinPvp(db, room) {
  const flip = Math.random() < 0.5 ? 'heads' : 'tails';
  const flipName = flip === 'heads' ? 'Орёл' : 'Решка';

  const p1Choice = room.p1_choice;
  const p2Choice = room.p2_choice;
  const p1NameC = p1Choice === 'heads' ? 'Орёл' : 'Решка';
  const p2NameC = p2Choice === 'heads' ? 'Орёл' : 'Решка';

  const totalPot = room.bet * 2;
  const commission = Math.floor(totalPot * 0.05);
  const winPayout = totalPot - commission;

  const p1Correct = p1Choice === flip;
  const p2Correct = p2Choice === flip;

  let outcome;

  if (p1Correct && !p2Correct) {
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [winPayout, room.p1_id]);
    outcome = {
      winner_id: room.p1_id,
      loser_id: room.p2_id,
      payout: winPayout,
      commission,
      result: 'win_p1',
    };
  } else if (p2Correct && !p1Correct) {
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [winPayout, room.p2_id]);
    outcome = {
      winner_id: room.p2_id,
      loser_id: room.p1_id,
      payout: winPayout,
      commission,
      result: 'win_p2',
    };
  } else {
    // tie: both correct or both wrong
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id IN (?,?)', [room.bet, room.p1_id, room.p2_id]);
    outcome = { tie: true, result: 'tie' };
  }

  await db.run('UPDATE casino_pvp_rooms SET status="finished" WHERE room_id=?', [room.room_id]);
  // Optionally delete after a while; for now keep finished briefly or delete immediately like dice
  await db.run('DELETE FROM casino_pvp_rooms WHERE room_id=?', [room.room_id]);

  return {
    flip,
    flip_name: flipName,
    p1_choice: p1Choice,
    p2_choice: p2Choice,
    ...outcome,
    bet: room.bet,
  };
}

// Lightweight reveal (used by polling creator to get the result after joiner chose)
router.post('/pvp/coin/reveal', authMiddleware, async (req, res) => {
  const db = getDB();
  const { roomId } = req.body;
  const room = await db.get('SELECT * FROM casino_pvp_rooms WHERE room_id=?', [roomId]);
  if (!room) return res.status(404).json({ error: 'Комната уже закрыта' });
  if (!room.p1_choice || !room.p2_choice) return res.status(400).json({ error: 'Оба игрока ещё не выбрали стороны' });

  // Re-resolve (but since we delete inside, we need to be careful — for simplicity re-run logic without deleting twice)
  const flip = Math.random() < 0.5 ? 'heads' : 'tails';
  const flipName = flip === 'heads' ? 'Орёл' : 'Решка';
  const p1Correct = room.p1_choice === flip;
  const p2Correct = room.p2_choice === flip;
  const totalPot = room.bet * 2;
  const commission = Math.floor(totalPot * 0.05);
  const winPayout = totalPot - commission;

  let outcome;
  if (p1Correct && !p2Correct) {
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [winPayout, room.p1_id]);
    outcome = { winner_id: room.p1_id, loser_id: room.p2_id, payout: winPayout, result: 'win_p1' };
  } else if (p2Correct && !p1Correct) {
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id = ?', [winPayout, room.p2_id]);
    outcome = { winner_id: room.p2_id, loser_id: room.p1_id, payout: winPayout, result: 'win_p2' };
  } else {
    await db.run('UPDATE users SET casino_balance = casino_balance + ? WHERE id IN (?,?)', [room.bet, room.p1_id, room.p2_id]);
    outcome = { tie: true, result: 'tie' };
  }
  await db.run('DELETE FROM casino_pvp_rooms WHERE room_id=?', [roomId]);

  res.json({ flip, flip_name: flipName, p1_choice: room.p1_choice, p2_choice: room.p2_choice, ...outcome, bet: room.bet });
});

// --- COIN (heads/tails) solo ---
router.post('/games/coin/play', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet, side } = req.body; // heads or tails
    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });
    profile.last_bet = bet; await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const win = (side === result) ? bet * 2 : 0;
    const bal = await updateCasinoBalance(db, req.user.id, win);
    res.json({ result, side, win, bet, balance: bal });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- ROULETTE ---
router.post('/games/roulette/play', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet, betType, target } = req.body;
    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Нет средств' });
    profile.last_bet = bet; await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    const result = Math.floor(Math.random() * 37);
    let win = 0;
    const isRed = ROULETTE_REDS.includes(result);
    if (betType === 'red' && isRed) win = bet * 2;
    else if (betType === 'black' && !isRed && result !== 0) win = bet * 2;
    else if (betType === 'zero' && result === 0) win = bet * 35;
    else if (betType === 'number' && Number.isInteger(target) && result === target) win = bet * 35;
    else if (betType === 'low' && result >= 1 && result <= 18) win = bet * 2;
    else if (betType === 'high' && result >= 19 && result <= 36) win = bet * 2;
    else if (betType === 'even' && result !== 0 && result % 2 === 0) win = bet * 2;
    else if (betType === 'odd' && result % 2 === 1) win = bet * 2;

    const bal = await updateCasinoBalance(db, req.user.id, win);
    res.json({ result, color: result === 0 ? 'zero' : (isRed ? 'red' : 'black'), win, bet, balance: bal });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// --- PLINKO ---
router.post('/games/plinko/play', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { bet, risk, rows } = req.body;
    const r = parseInt(rows);
    if (!bet || bet < MIN_BET) return res.status(400).json({ error: 'Минимальная ставка ' + MIN_BET });
    if (!['low', 'medium', 'high'].includes(risk)) return res.status(400).json({ error: 'Неверный уровень риска' });
    if (!PLINKO_ROWS_OPTIONS.includes(r)) return res.status(400).json({ error: 'Неверное количество рядов' });

    const { profile } = await getCasinoUser(db, req.user.id);
    if (profile.balance < bet) return res.status(400).json({ error: 'Недостаточно средств' });

    profile.last_bet = bet;
    await saveCasinoProfile(db, req.user.id, profile);
    await updateCasinoBalance(db, req.user.id, -bet);

    const { path, finalSlot, multiplier } = simulatePlinko(r, risk);
    const win = Math.floor(bet * multiplier);
    const newBal = await updateCasinoBalance(db, req.user.id, win);

    res.json({
      path,
      finalSlot,
      multiplier,
      bet,
      win,
      profit: win - bet,
      balance: newBal,
      risk,
      rows: r,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ====================== BANK (instant 0% safe + timed interest deposits) ======================
// Old endpoints kept for compatibility (used amount-aware now in UI)
router.get('/bank', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  res.json({ balance: profile.balance, bank: profile.bank_balance || 0 });
});

router.post('/bank/deposit', authMiddleware, async (req, res) => {
  const db = getDB();
  const { amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const realOnHand = profile.balance ?? 0;
  const amt = Math.min(Number(amount) || realOnHand, realOnHand);
  if (amt <= 0) return res.status(400).json({ error: 'Нечего класть' });
  profile.balance = realOnHand - amt;
  profile.bank_balance = (profile.bank_balance || 0) + amt;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ balance: profile.balance, bank: profile.bank_balance });
});

router.post('/bank/withdraw', authMiddleware, async (req, res) => {
  const db = getDB();
  const { amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const realBank = profile.bank_balance ?? 0;
  const amt = Math.min(Number(amount) || realBank, realBank);
  if (amt <= 0) return res.status(400).json({ error: 'Нет сбережений' });
  profile.balance = (profile.balance ?? 0) + amt;
  profile.bank_balance = realBank - amt;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ balance: profile.balance, bank: profile.bank_balance });
});

// Full bank status for redesigned UI: includes tiers config + active deposits
async function fetchUserDeposits(db, userId) {
  const rows = await db.all(
    `SELECT * FROM casino_deposits WHERE user_id = ? AND claimed = 0 ORDER BY matures_at ASC`,
    [userId]
  );
  const now = Date.now();
  return rows.map(r => {
    const matures = new Date(r.matures_at).getTime();
    const isMatured = now >= matures;
    const payout = calcPayout(r.principal, r.rate);
    return {
      id: r.id,
      tier_id: r.tier_id,
      principal: r.principal,
      rate: r.rate,
      term_days: r.term_days,
      start_at: r.start_at,
      matures_at: r.matures_at,
      is_matured: isMatured,
      payout,
      profit: payout - r.principal,
      // human friendly remaining (server computed at fetch time)
      days_left: isMatured ? 0 : Math.max(0, Math.ceil((matures - now) / (1000 * 3600 * 24))),
    };
  });
}

router.get('/bank/full', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { profile } = await getCasinoUser(db, req.user.id);
    const deposits = await fetchUserDeposits(db, req.user.id);
    const locked = deposits.reduce((s, d) => s + d.principal, 0);
    res.json({
      balance: profile.balance,                 // на руках
      instant: profile.bank_balance || 0,       // гибкий сейф 0%
      locked,                                   // всего в срочных вкладах (principal)
      deposits,
      tiers: DEPOSIT_TIERS,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Open a timed deposit (deducts from on-hand balance, locks until term)
router.post('/bank/deposits/open', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { tierId, amount } = req.body;
    const tier = getTier(tierId);
    if (!tier) return res.status(400).json({ error: 'Неизвестный тип вклада' });

    const { profile } = await getCasinoUser(db, req.user.id);
    const amt = Math.floor(Number(amount) || 0);
    if (amt < tier.min || amt > tier.max) {
      return res.status(400).json({ error: `Сумма должна быть от ${tier.min} до ${tier.max}` });
    }
    if (profile.balance < amt) return res.status(400).json({ error: 'Недостаточно средств' });

    const now = new Date();
    const matures = new Date(now.getTime() + tier.term_days * 86400 * 1000);

    // deduct
    profile.balance -= amt;
    await saveCasinoProfile(db, req.user.id, profile);

    await db.run(
      `INSERT INTO casino_deposits (user_id, tier_id, principal, rate, term_days, start_at, matures_at, claimed)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      [req.user.id, tier.id, amt, tier.rate, tier.term_days, now.toISOString(), matures.toISOString()]
    );

    const deposits = await fetchUserDeposits(db, req.user.id);
    res.json({
      ok: true,
      balance: profile.balance,
      instant: profile.bank_balance || 0,
      locked: deposits.reduce((s, d) => s + d.principal, 0),
      deposits,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Claim matured deposit (principal + interest goes to on-hand balance)
router.post('/bank/deposits/claim', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { depositId } = req.body;
    const id = parseInt(depositId);
    if (!id) return res.status(400).json({ error: 'Неверный ID' });

    const row = await db.get(
      `SELECT * FROM casino_deposits WHERE id = ? AND user_id = ? AND claimed = 0`,
      [id, req.user.id]
    );
    if (!row) return res.status(400).json({ error: 'Вклад не найден или уже забран' });

    const now = Date.now();
    if (now < new Date(row.matures_at).getTime()) {
      return res.status(400).json({ error: 'Срок вклада ещё не истёк — вывод невозможен' });
    }

    const payout = calcPayout(row.principal, row.rate);

    const { profile } = await getCasinoUser(db, req.user.id);
    profile.balance = (profile.balance || 0) + payout;
    await saveCasinoProfile(db, req.user.id, profile);

    await db.run(`UPDATE casino_deposits SET claimed = 1 WHERE id = ?`, [id]);

    const deposits = await fetchUserDeposits(db, req.user.id);
    res.json({
      ok: true,
      claimed: payout,
      profit: payout - row.principal,
      balance: profile.balance,
      instant: profile.bank_balance || 0,
      locked: deposits.reduce((s, d) => s + d.principal, 0),
      deposits,
    });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ====================== FARM / MINING ======================
router.get('/farm', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  const totalBtc = miningGetAccumulated(profile);
  const level = profile.mining.farm_level || 0;
  const farm = level ? FARM_LEVELS[level] : null;
  res.json({
    level,
    farm,
    extra: profile.mining.extra_farms || 0,
    totalBtc,
    btcValue: Math.floor(totalBtc * BTC_SELL_RATE),
    balance: profile.balance,
  });
});

router.post('/farm/collect', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  const m = profile.mining || {};
  if (!m.farm_level) return res.status(400).json({ error: 'Нет фермы' });
  const totalBtc = miningGetAccumulated(profile);
  if (totalBtc < 0.000001) return res.status(400).json({ error: 'Ничего не накоплено' });
  const crystals = Math.floor(totalBtc * BTC_SELL_RATE);
  profile.balance += crystals;
  profile.mining.btc_accumulated = 0;
  profile.mining.last_collected = new Date().toISOString();
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ collected: crystals, balance: profile.balance });
});

router.post('/farm/upgrade', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  const target = (profile.mining.farm_level || 0) + 1;
  if (target > 10) return res.status(400).json({ error: 'Максимум' });
  const farm = FARM_LEVELS[target];
  if (profile.balance < farm.price) return res.status(400).json({ error: 'Недостаточно' });

  const acc = miningGetAccumulated(profile);
  profile.balance -= farm.price;
  profile.mining.farm_level = target;
  profile.mining.btc_accumulated = acc;
  if (target === 1) profile.mining.last_collected = new Date().toISOString();
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ level: target, farm, balance: profile.balance });
});

router.post('/farm/buy-extra', authMiddleware, async (req, res) => {
  const db = getDB();
  const { amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const m = profile.mining || {};
  if ((m.farm_level || 0) !== 10) return res.status(400).json({ error: 'Сначала 10 уровень' });
  const extra = m.extra_farms || 0;
  const buy = Math.min(amount || 1, MAX_EXTRA_FARMS - extra);
  if (buy <= 0) return res.status(400).json({ error: 'Лимит' });
  const price = FARM_LEVELS[10].price * buy;
  if (profile.balance < price) return res.status(400).json({ error: 'Нет денег' });
  profile.balance -= price;
  profile.mining.extra_farms = extra + buy;
  profile.mining.btc_accumulated = miningGetAccumulated(profile);
  profile.mining.last_collected = new Date().toISOString();
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ extra: profile.mining.extra_farms, balance: profile.balance });
});

function miningGetAccumulated(profile) {
  const m = profile.mining || {};
  const lvl = m.farm_level || 0;
  if (!lvl) return 0;
  const farm = FARM_LEVELS[lvl];
  let saved = m.btc_accumulated || 0;
  if (m.last_collected) {
    const hours = Math.min((Date.now() - new Date(m.last_collected).getTime()) / 3600000, 72);
    let add = farm.btc_per_hour * hours;
    if (lvl === 10) add += (m.extra_farms || 0) * farm.btc_per_hour * hours;
    saved += add;
  }
  return Math.round(saved * 1e6) / 1e6;
}

// ====================== BUSINESSES ======================
router.get('/businesses', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  const ownedRaw = profile.businesses || {};
  const cooldown = BUSINESS_TASK_COOLDOWN;
  const list = Object.values(BUSINESSES).map(b => {
    const ob = ownedRaw[b.id];
    const isCurrentlyOwned = ob && !ob.sold_at;  // cooldowns persist even after sell
    const taskList = (b.tasks || []).map(t => {
      const key = `${b.id}_${t.id}_last`;
      const last = ob && ob[key] ? ob[key] : null;
      return { id: t.id, name: t.name, last };
    });
    return {
      ...b,
      owned: !!isCurrentlyOwned,
      income: isCurrentlyOwned ? { min: b.income_min, max: b.income_max } : null,
      tasks: taskList,
    };
  });
  res.json({ list, balance: profile.balance, cooldown });
});

router.post('/businesses/buy', authMiddleware, async (req, res) => {
  const db = getDB();
  const { id } = req.body;
  const biz = BUSINESSES[id];
  if (!biz) return res.status(400).json({ error: 'Нет такого бизнеса' });
  const { profile } = await getCasinoUser(db, req.user.id);
  profile.businesses = profile.businesses || {};
  const existing = profile.businesses[id];
  if (existing && !existing.sold_at) {
    return res.status(400).json({ error: 'Уже есть' });
  }
  if (profile.balance < biz.price) return res.status(400).json({ error: 'Нет средств' });
  profile.balance -= biz.price;
  if (existing && existing.sold_at) {
    // rebuy after sell: restore ownership, keep cooldown history
    existing.bought_at = new Date().toISOString();
    delete existing.sold_at;
  } else {
    profile.businesses[id] = { bought_at: new Date().toISOString() };
  }
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ ok: true, balance: profile.balance });
});

router.post('/businesses/task', authMiddleware, async (req, res) => {
  const db = getDB();
  const { bizId, taskId } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const biz = BUSINESSES[bizId];
  const ownedBiz = profile.businesses && profile.businesses[bizId];
  const isOwned = ownedBiz && !ownedBiz.sold_at;
  if (!biz || !isOwned) return res.status(400).json({ error: 'Нет бизнеса' });
  const key = `${bizId}_${taskId}_last`;
  const last = ownedBiz[key];
  if (last) {
    const elapsed = (Date.now() - new Date(last).getTime()) / 1000;
    if (elapsed < BUSINESS_TASK_COOLDOWN) return res.status(400).json({ error: 'Подождите', remain: Math.ceil(BUSINESS_TASK_COOLDOWN - elapsed) });
  }
  const reward = Math.floor(biz.income_min + Math.random() * (biz.income_max - biz.income_min));
  profile.balance += reward;
  ownedBiz[key] = new Date().toISOString();
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ reward, balance: profile.balance });
});

router.post('/businesses/sell', authMiddleware, async (req, res) => {
  const db = getDB();
  const { id } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const ownedBiz = profile.businesses && profile.businesses[id];
  if (!ownedBiz || ownedBiz.sold_at) return res.status(400).json({ error: 'Не владеете' });
  const biz = BUSINESSES[id];
  const refund = Math.floor(biz.price * 0.7);
  // Mark as sold but KEEP the cooldown timestamps (_last keys) so rebuy doesn't reset КД
  ownedBiz.sold_at = new Date().toISOString();
  profile.balance += refund;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ refund, balance: profile.balance });
});

// ====================== SHOP (rating + VIP) ======================
router.get('/shop', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  res.json({
    rating: profile.rating || 0,
    ratingPrice: RATING_PRICE,
    sellPrice: Math.floor(RATING_PRICE * RATING_SELL_RATE),
    vipPrice: VIP_PRICE,
    hasVip: !!profile.vip,
    balance: profile.balance,
  });
});

router.post('/shop/buy-rating', authMiddleware, async (req, res) => {
  const db = getDB();
  const { amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const amt = Math.max(1, parseInt(amount) || 1);
  const cost = amt * RATING_PRICE;
  if (profile.balance < cost) return res.status(400).json({ error: 'Нет средств' });
  profile.balance -= cost;
  profile.rating = (profile.rating || 0) + amt;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ rating: profile.rating, balance: profile.balance });
});

router.post('/shop/sell-rating', authMiddleware, async (req, res) => {
  const db = getDB();
  const { amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const cur = profile.rating || 0;
  const amt = Math.min(cur, Math.max(1, parseInt(amount) || 1));
  const rev = Math.floor(amt * RATING_PRICE * RATING_SELL_RATE);
  profile.rating = cur - amt;
  profile.balance += rev;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ rating: profile.rating, balance: profile.balance });
});

router.post('/shop/buy-vip', authMiddleware, async (req, res) => {
  const db = getDB();
  const { profile } = await getCasinoUser(db, req.user.id);
  if (profile.vip) return res.status(400).json({ error: 'Уже VIP' });
  if (profile.balance < VIP_PRICE) return res.status(400).json({ error: 'Нет средств' });
  profile.balance -= VIP_PRICE;
  profile.vip = true;
  await saveCasinoProfile(db, req.user.id, profile);
  res.json({ vip: true, balance: profile.balance });
});

// ====================== TRANSFERS ======================
router.post('/transfer', authMiddleware, async (req, res) => {
  const db = getDB();
  const { targetUsername, amount } = req.body;
  const { profile } = await getCasinoUser(db, req.user.id);
  const amt = parseInt(amount);
  if (!amt || amt < TRANSFER_MIN) return res.status(400).json({ error: 'Минимум ' + TRANSFER_MIN });
  if (profile.balance < amt) return res.status(400).json({ error: 'Нет средств' });

  const [maxA, maxC] = getTransferLimits(profile);
  if (getTransfersToday(profile) >= maxC) return res.status(400).json({ error: 'Лимит переводов на сегодня' });
  if (amt > maxA) return res.status(400).json({ error: 'Превышен макс. за перевод' });

  const target = await db.get('SELECT id, username FROM users WHERE LOWER(username)=LOWER(?)', [targetUsername]);
  if (!target) return res.status(404).json({ error: 'Получатель не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя себе' });

  const tProf = await getCasinoUser(db, target.id);
  profile.balance -= amt;
  tProf.profile.balance += amt;

  await saveCasinoProfile(db, req.user.id, profile);
  await saveCasinoProfile(db, target.id, tProf.profile);
  await addTransferCount(db, req.user.id, profile);

  res.json({ ok: true, sent: amt, to: target.username, balance: profile.balance });
});

// ====================== ADMIN PROTECTION ======================
// Only users listed in ADMIN_USERNAMES (comma separated, case-insensitive) can access /admin/*
// This is still username-based (MVP), but at least configurable via .env and not hardcoded to "butuz".
// For real production, prefer a proper role/flag in the DB + 2FA or IP whitelist.
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || 'butuz')
  .split(',')
  .map(u => u.trim().toLowerCase())
  .filter(Boolean);

function isAdmin(req) {
  const uname = (req.user?.username || '').toLowerCase();
  return ADMIN_USERNAMES.includes(uname);
}

async function logAdminAction(db, adminUsername, targetUsername, action, details = null) {
  try {
    await db.run(
      `INSERT INTO casino_admin_actions (admin_username, target_username, action, details) VALUES (?,?,?,?)`,
      [adminUsername || 'unknown', targetUsername || null, action, details ? JSON.stringify(details) : null]
    );
  } catch (e) { /* non-fatal */ }
}

// Mount admin protection once for the whole /admin subtree
router.use('/admin', authMiddleware, (req, res, next) => {
  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  next();
});

router.get('/admin/users', async (req, res) => {
  const db = getDB();
  const q = (req.query.q || '').trim();
  const filter = (req.query.filter || 'all').toLowerCase(); // all | vip | banned
  const sort = (req.query.sort || 'id').toLowerCase(); // id | balance | rating | level
  const dir = (req.query.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);

  const whereParts = [];
  const params = [];

  if (q) {
    whereParts.push('(LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)');
    params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  if (filter === 'vip') {
    whereParts.push('casino_vip = 1');
  } else if (filter === 'banned') {
    whereParts.push('casino_banned = 1');
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  let orderBy = 'id DESC';
  if (sort === 'balance') orderBy = `casino_balance ${dir}`;
  else if (sort === 'rating') orderBy = `casino_rating ${dir}`;
  else if (sort === 'level') orderBy = `casino_level ${dir}`;
  else if (sort === 'id') orderBy = `id ${dir}`;

  const sql = `
    SELECT id, username, display_name, 
           casino_balance as casino_balance, 
           casino_rating as casino_rating, 
           casino_vip, casino_banned, casino_level
    FROM users 
    ${where}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `;
  const rows = await db.all(sql, [...params, limit, offset]);
  res.json(rows);
});

router.post('/admin/give', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const delta = safePositiveInt(amount, 1e15); // hard cap to prevent absurd admin abuse
  if (!delta) return res.status(400).json({ error: 'Invalid amount' });
  profile.balance += delta;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'give', { amount: delta });
  res.json({ ok: true, newBal: profile.balance });
});

router.post('/admin/take', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const delta = safePositiveInt(amount, 1e15);
  if (!delta) return res.status(400).json({ error: 'Invalid amount' });
  profile.balance = Math.max(0, profile.balance - delta);
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'take', { amount: delta });
  res.json({ ok: true, newBal: profile.balance });
});

router.post('/admin/giverating', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const delta = parseInt(amount) || 0;
  profile.rating = (profile.rating || 0) + delta;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'giverating', { amount: delta });
  res.json({ ok: true, rating: profile.rating });
});

router.post('/admin/takerating', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const delta = parseInt(amount) || 0;
  profile.rating = Math.max(0, (profile.rating || 0) - delta);
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'takerating', { amount: delta });
  res.json({ ok: true, rating: profile.rating });
});

router.post('/admin/vip', async (req, res) => {
  const db = getDB();
  const { username } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  profile.vip = !profile.vip;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'vip_toggle', { newValue: profile.vip });
  res.json({ ok: true, vip: profile.vip });
});

router.post('/admin/ban', async (req, res) => {
  const db = getDB();
  const { username, ban } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  await db.run('UPDATE users SET casino_banned = ? WHERE id = ?', [ban ? 1 : 0, t.id]);
  await logAdminAction(db, req.user.username, username, 'ban', { banned: !!ban });
  res.json({ ok: true, banned: !!ban });
});

router.post('/admin/broadcast', async (req, res) => {
  const { text } = req.body;
  const db = getDB();
  const users = await db.all('SELECT id FROM users LIMIT 500');
  for (const u of users) {
    try {
      await db.run('INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id) VALUES (?,?,?,?,?)',
        [u.id, req.user.id, 'system', null, null]);
    } catch {}
  }
  await logAdminAction(db, req.user.username, null, 'broadcast', { text: (text || '').slice(0, 120), count: users.length });
  res.json({ ok: true, sent: users.length, note: 'System notifs created (visible in bell)' });
});

router.get('/admin/userinfo', async (req, res) => {
  const db = getDB();
  const { username } = req.query;
  const row = await db.get('SELECT * FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!row) return res.status(404).json({ error: 'Не найден' });
  const prof = getCasinoData(row);
  res.json({ id: row.id, username: row.username, ...prof });
});

// Flexible admin farm controls
router.post('/admin/setfarm', async (req, res) => {
  const db = getDB();
  const { username, level, extra } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const newLevel = Math.max(0, Math.min(10, parseInt(level) || 0));
  const newExtra = Math.max(0, Math.min(1000, parseInt(extra) || 0));
  profile.mining = profile.mining || {};
  profile.mining.farm_level = newLevel;
  profile.mining.extra_farms = newExtra;
  profile.mining.btc_accumulated = 0;
  profile.mining.last_collected = new Date().toISOString();
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'setfarm', { level: newLevel, extra: newExtra });
  res.json({ ok: true, level: newLevel, extra: newExtra });
});

router.post('/admin/resetfarm', async (req, res) => {
  const db = getDB();
  const { username } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  profile.mining = { farm_level: 0, btc_accumulated: 0, last_collected: null, extra_farms: 0 };
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'resetfarm');
  res.json({ ok: true });
});

// Additional powerful admin tools
router.post('/admin/setbalance', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const newVal = safePositiveInt(amount, 1e15);
  if (!newVal && newVal !== 0) return res.status(400).json({ error: 'Invalid amount' });
  profile.balance = newVal;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'setbalance', { amount: newVal });
  res.json({ ok: true, newBal: profile.balance });
});

router.post('/admin/setrating', async (req, res) => {
  const db = getDB();
  const { username, amount } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const newVal = Math.max(0, parseInt(amount) || 0);
  profile.rating = newVal;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'setrating', { amount: newVal });
  res.json({ ok: true, rating: profile.rating });
});

router.post('/admin/givebusiness', async (req, res) => {
  const db = getDB();
  const { username, id } = req.body;
  const biz = BUSINESSES[id];
  if (!biz) return res.status(400).json({ error: 'Нет такого бизнеса' });
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  profile.businesses = profile.businesses || {};
  const existing = profile.businesses[id];
  if (existing && !existing.sold_at) {
    return res.json({ ok: true, note: 'Уже владеет' });
  }
  if (existing && existing.sold_at) {
    existing.bought_at = new Date().toISOString();
    existing.admin_given = true;
    delete existing.sold_at;
  } else {
    profile.businesses[id] = { bought_at: new Date().toISOString(), admin_given: true };
  }
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'givebusiness', { businessId: id });
  res.json({ ok: true });
});

router.post('/admin/clearbizcooldowns', async (req, res) => {
  const db = getDB();
  const { username } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  if (profile.businesses) {
    Object.keys(profile.businesses).forEach(bid => {
      const b = profile.businesses[bid] || {};
      Object.keys(b).forEach(k => { if (k.endsWith('_last')) delete b[k]; });
    });
  }
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'clearbizcooldowns');
  res.json({ ok: true });
});

router.post('/admin/setlevel', async (req, res) => {
  const db = getDB();
  const { username, level } = req.body;
  const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [username]);
  if (!t) return res.status(404).json({ error: 'Не найден' });
  const { profile } = await getCasinoUser(db, t.id);
  const newLevel = Math.max(1, Math.min(1000, parseInt(level) || 1));
  profile.level = newLevel;
  await saveCasinoProfile(db, t.id, profile);
  await logAdminAction(db, req.user.username, username, 'setlevel', { level: newLevel });
  res.json({ ok: true, level: profile.level });
});

router.get('/admin/stats', async (req, res) => {
  const db = getDB();
  const u = await db.get('SELECT COUNT(*) as users, SUM(casino_balance) as totalBal, SUM(casino_rating) as totalRat FROM users');
  const vip = await db.get('SELECT COUNT(*) as vips FROM users WHERE casino_vip=1');
  const ban = await db.get('SELECT COUNT(*) as banned FROM users WHERE casino_banned=1');
  res.json({
    users: u.users || 0,
    totalBalance: u.totalBal || 0,
    totalRating: u.totalRat || 0,
    vips: vip.vips || 0,
    banned: ban.banned || 0,
  });
});

// Recent admin action logs (accountability)
router.get('/admin/logs', async (req, res) => {
  const db = getDB();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 30));
  const logs = await db.all(
    `SELECT id, admin_username, target_username, action, details, created_at 
     FROM casino_admin_actions 
     ORDER BY id DESC 
     LIMIT ?`,
    [limit]
  );
  res.json(logs.map(l => ({
    ...l,
    details: l.details ? JSON.parse(l.details) : null
  })));
});

// Mass give (ALL / non-banned / list) — logged heavily
router.post('/admin/mass-give', async (req, res) => {
  const db = getDB();
  const { amount, mode, usernames } = req.body; // 'ALL' | 'ALL_NONBANNED' | 'LIST'
  const delta = safePositiveInt(amount, 1e12); // cap mass give to reasonable size
  if (!delta) return res.status(400).json({ error: 'amount required' });

  let targets = [];
  if (mode === 'LIST' && Array.isArray(usernames)) {
    targets = usernames;
  } else {
    let sql = 'SELECT id, username FROM users';
    if (mode === 'ALL_NONBANNED') sql += ' WHERE casino_banned=0';
    sql += ' LIMIT 5000';
    const rows = await db.all(sql);
    targets = rows.map(r => r.username);
  }

  let updated = 0;
  for (const uname of targets) {
    try {
      const t = await db.get('SELECT id FROM users WHERE LOWER(username)=LOWER(?)', [uname]);
      if (!t) continue;
      const { profile } = await getCasinoUser(db, t.id);
      profile.balance = (profile.balance || 0) + delta;
      await saveCasinoProfile(db, t.id, profile);
      await logAdminAction(db, req.user.username, uname, 'mass_give', { amount: delta, via: mode || 'LIST' });
      updated++;
    } catch (_) {}
  }
  await logAdminAction(db, req.user.username, null, 'mass_give_summary', { amount: delta, mode: mode || 'LIST', updated });
  res.json({ ok: true, updated, amount: delta });
});

export default router;