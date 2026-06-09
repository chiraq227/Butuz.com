import { useEffect, useState, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { Coins } from 'lucide-react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import AdminPanel from '../components/casino/AdminPanel';

interface CasinoProfile {
  balance: number;
  bank_balance: number;
  level: number;
  xp: number;
  rating: number;
  vip: boolean;
  games_played: number;
  total_won: number;
  total_lost: number;
  rank?: number;
  total_btc?: number;
  btc_value?: number;
  hide_balance?: boolean;
  last_bet?: number;
}

const CURRENCY = '💎';
const MIN_BET = 10;
const TRANSFER_MIN = 10;

const FARM_LEVELS_FRONT = {
  1:  {name: "🖥️ Старый ноутбук",      btc_per_hour: 0.100,  price: 500000,    emoji: "🖥️"},
  2:  {name: "💻 Игровой ПК",           btc_per_hour: 0.500,  price: 630000,   emoji: "💻"},
  3:  {name: "⚡ Разгонный ПК",         btc_per_hour: 1.000,  price: 670000,   emoji: "⚡"},
  4:  {name: "🔧 ASIC Начальный",       btc_per_hour: 5.000,  price: 720000,   emoji: "🔧"},
  5:  {name: "⛏️ ASIC Стандарт",        btc_per_hour: 10.000,  price: 800000,  emoji: "⛏️"},
  6:  {name: "🏭 Мини-ферма",           btc_per_hour: 25.000,  price: 950000,  emoji: "🏭"},
  7:  {name: "🔋 Ферма среднего класса",btc_per_hour: 50.000,  price: 1500000, emoji: "🔋"},
  8:  {name: "🚀 Продвинутая ферма",    btc_per_hour: 100.800,  price: 2000000, emoji: "🚀"},
  9:  {name: "💎 Мега-ферма",           btc_per_hour: 170.000,  price: 5000000, emoji: "💎"},
  10: {name: "👑 Бутуз-центр",           btc_per_hour: 250.000,  price: 12000000,emoji: "👑"},
};

const QUICK_BETS = [1000, 10000, 100000, 1000000, 10000000];

const SLOT_SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "💎", "7️⃣", "⭐", "🔔"];

// Note: This file is large by design (full casino with multiple games).
// Heavy lifting is code-split at build time via Vite manualChunks + React.lazy in App.tsx.
// For further source maintainability, individual games (slots, mines, etc.) can be extracted to ./casino/* in future.
export default function Casino() {
  const { user, token } = useAuth();
  const [profile, setProfile] = useState<CasinoProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'games' | 'farm' | 'bank' | 'biz' | 'shop' | 'top' | 'admin' | 'profile' | null>(null);
  const [hubView, setHubView] = useState<'economy' | 'games'>('economy');

  const [bet, setBet] = useState(10000);
  const [lastResult, setLastResult] = useState<any>(null);
  const [spinningSlots, setSpinningSlots] = useState(false);
  const [gameRolling, setGameRolling] = useState(false);

  // Slots reel animation states
  const [slotReels, setSlotReels] = useState<string[]>(['🍒', '🍋', '💎']);
  const [activeSpinningReels, setActiveSpinningReels] = useState<boolean[]>([false, false, false]);
  const spinningReelsRef = useRef<boolean[]>([false, false, false]);

  // High-quality vertical reel strips (no white bg, physical scroll feel)
  const reelControls = [useAnimation(), useAnimation(), useAnimation()];
  const REEL_HEIGHT = 96;
  const CYCLE_HEIGHT = SLOT_SYMBOLS.length * REEL_HEIGHT;
  const reelTape = useMemo(() => {
    // repeat the symbol cycle enough times for satisfying long spins + safe landing targets
    return Array.from({ length: 9 }).flatMap(() => SLOT_SYMBOLS);
  }, []);

  const getReelTargetY = (symbol: string, minExtraCycles = 3) => {
    const cycleLen = SLOT_SYMBOLS.length;
    const first = reelTape.indexOf(symbol);
    if (first < 0) return 0;

    // Find an occurrence of the symbol that is at least minExtraCycles full cycles into the tape.
    // This guarantees long spin + exact grid alignment (y always multiple of REEL_HEIGHT).
    const minStep = first + Math.floor(minExtraCycles) * cycleLen;

    for (let k = minStep; k < reelTape.length; k++) {
      if (reelTape[k] === symbol) {
        return -k * REEL_HEIGHT;
      }
    }

    // Fallback (should rarely hit)
    const fallback = first + Math.floor(minExtraCycles) * cycleLen;
    return -fallback * REEL_HEIGHT;
  };

  // Mines state
  const [minesSession, setMinesSession] = useState<any>(null);
  const [minesOpened, setMinesOpened] = useState<number[]>([]);
  const [minesMult, setMinesMult] = useState(1.0);
  const [minesCount, setMinesCount] = useState(5);
  const [minesLost, setMinesLost] = useState<null | { opened: number[]; mines: number[]; mult: number; bet: number }>(null);

  // Blackjack (supports Split + Double) — fully restored
  const betInitializedRef = useRef(false);
  const [bjSession, setBjSession] = useState<any>(null);
  const [bjPlayerHands, setBjPlayerHands] = useState<any[]>([]); // array of hands: {cards, bet, stood, busted, ...}
  const [bjCurrentHandIndex, setBjCurrentHandIndex] = useState(0);

  // Animated / visible cards (for initial deal + split/double animations)
  const [bjDealerCards, setBjDealerCards] = useState<any[]>([]);
  const [bjAnimating, setBjAnimating] = useState(false);
  const [bjDealerDrawing, setBjDealerDrawing] = useState(false);

  // Dice state
  const [diceBetType, setDiceBetType] = useState<'high' | 'low' | 'seven' | 'num'>('high');
  const [diceTarget, setDiceTarget] = useState<number>(7);
  const [diceRolling, setDiceRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<{ d1: number; d2: number; sum: number } | null>(null);
  const [rollingDie1, setRollingDie1] = useState(1);
  const [rollingDie2, setRollingDie2] = useState(1);

  // Roulette state
  const [rouletteBetType, setRouletteBetType] = useState<string>('red');
  const [rouletteTarget, setRouletteTarget] = useState<number | null>(null);
  const [rouletteSpinning, setRouletteSpinning] = useState(false);
  const [rouletteResult, setRouletteResult] = useState<any>(null);
  const [targetWheelRotation, setTargetWheelRotation] = useState(0);
  const [pendingRouletteResult, setPendingRouletteResult] = useState<any>(null);

  // Other panels data
  const [farm, setFarm] = useState<any>(null);
  const [bank, setBank] = useState<any>(null);
  const [bizList, setBizList] = useState<any[]>([]);
  const [shop, setShop] = useState<any>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  // Shop modal state
  const [selectedShopItem, setSelectedShopItem] = useState<string | null>(null);
  const [shopSellAmount, setShopSellAmount] = useState(1);
  // Admin panel state is now fully encapsulated inside <AdminPanel />

  // Biz sub-state: sub-tabs, selected business for detail window, cooldown constant, tick for live timers, toasts
  const [bizSubTab, setBizSubTab] = useState<'my' | 'available'>('my');
  const [selectedBizId, setSelectedBizId] = useState<number | null>(null);
  const [bizCooldown, setBizCooldown] = useState(3600);
  const [bizTick, setBizTick] = useState(0);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);

  // Bank tab local UI state (amount pickers + opening flow) — must be top-level hooks
  const [instantDepAmt, setInstantDepAmt] = useState(0);
  const [instantWdAmt, setInstantWdAmt] = useState(0);
  const [openingTierId, setOpeningTierId] = useState<string | null>(null);
  const [openAmount, setOpenAmount] = useState(0);

  // === Dedicated game views inside the casino tab ===
  const [currentGame, setCurrentGame] = useState<null | 'slots' | 'mines' | 'blackjack' | 'dice' | 'roulette' | 'coin' | 'plinko'>(null);

  // ===== COIN states (solo + PvP) =====
  const [coinMode, setCoinMode] = useState<'solo' | 'pvp'>('solo');
  const [coinSide, setCoinSide] = useState<'heads' | 'tails'>('heads');
  const [coinFlipping, setCoinFlipping] = useState(false);
  const [coinResult, setCoinResult] = useState<null | { result: 'heads'|'tails'; win: number; bet: number; side: 'heads'|'tails' }>(null);
  const [coinFlipFace, setCoinFlipFace] = useState<'heads' | 'tails'>('heads'); // for live animation

  // PvP coin
  const [pvpRooms, setPvpRooms] = useState<any[]>([]);
  const [currentRoom, setCurrentRoom] = useState<any>(null);
  const [joinCode, setJoinCode] = useState('');
  const [pvpMySide, setPvpMySide] = useState<'heads' | 'tails' | null>(null);
  const [pvpFlipping, setPvpFlipping] = useState(false);
  const [pvpFlipResult, setPvpFlipResult] = useState<any>(null); // {flip, flip_name, p1_choice, p2_choice, winner_id?, tie?, payout? ...}
  const pvpPollRef = useRef<NodeJS.Timeout | null>(null);

  // ===== PLINKO =====
  const [plinkoRisk, setPlinkoRisk] = useState<'low' | 'medium' | 'high'>('medium');
  const [plinkoRows, setPlinkoRows] = useState<8 | 12 | 16>(12);
  const [plinkoDropping, setPlinkoDropping] = useState(false);
  const [plinkoPath, setPlinkoPath] = useState<('L' | 'R')[] | null>(null);
  const [plinkoLanded, setPlinkoLanded] = useState<number | null>(null);
  const [plinkoResult, setPlinkoResult] = useState<any>(null); // {multiplier, win, profit, ...}
  const [plinkoHistory, setPlinkoHistory] = useState<any[]>([]); // recent drops
  const plinkoAnimRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPlinkoRef = useRef<any>(null);

  // Dice: sync result for visual when play() completes
  useEffect(() => {
    if (lastResult?.game === 'dice' && diceRolling) {
      const finalD1 = lastResult.d1;
      const finalD2 = lastResult.d2;
      setDiceResult({ d1: finalD1, d2: finalD2, sum: lastResult.sum });
      // "settle" the visible tumbling dice to the real outcome a moment before stopping the spin
      setRollingDie1(finalD1);
      setRollingDie2(finalD2);
      // let the roll animation finish a bit
      const t = setTimeout(() => setDiceRolling(false), 650);
      return () => clearTimeout(t);
    }
  }, [lastResult, diceRolling]);

  // Client-side "tumbling" faces while dice are rolling (prevents static icons + makes animation lively)
  useEffect(() => {
    if (!diceRolling) return;
    const iv = setInterval(() => {
      setRollingDie1(Math.floor(Math.random() * 6) + 1);
      setRollingDie2(Math.floor(Math.random() * 6) + 1);
    }, 85);
    return () => clearInterval(iv);
  }, [diceRolling]);

  // SLOTS: drive high-quality vertical reel strips via animation controls
  // Fast continuous scroll while waiting for server result, then smooth decelerating land per reel

  // Park reels nicely when entering the slots view (clean grid alignment so symbol is exactly centered in the window)
  useEffect(() => {
    if (currentGame !== 'slots') return;
    reelControls.forEach((ctrl, i) => {
      const parkSym = SLOT_SYMBOLS[(i * 3) % SLOT_SYMBOLS.length];
      const parkY = getReelTargetY(parkSym, 1); // start one cycle in for nicer initial look
      ctrl.set({ y: parkY });
    });
  }, [currentGame]);

  useEffect(() => {
    if (lastResult?.game === 'slots' && spinningSlots) {
      const finals = (lastResult.reels || ['🍒', '🍋', '💎']) as string[];

      (async () => {
        // Land reels left-to-right with increasing spin time (classic slots cadence)
        for (let i = 0; i < 3; i++) {
          // Integer extra cycles → always lands with pixel-perfect centering
          const targetY = getReelTargetY(finals[i], 3 + i);
          // This .start() overrides any previous repeating fast-spin transition.
          // Spring on later reels for a nice physical "clunk".
          const useSpring = i >= 1;
          await reelControls[i].start({
            y: targetY,
            transition: useSpring
              ? { type: 'spring', stiffness: 68, damping: 14, mass: 0.95 }
              : { duration: 0.95 + i * 0.32, ease: [0.22, 0.95, 0.28, 1] },
          });
          // small theatrical pause between reels stopping
          if (i < 2) await sleep(165);
        }

        setSlotReels(finals);
        setActiveSpinningReels([false, false, false]);
        spinningReelsRef.current = [false, false, false];
        setSpinningSlots(false);
      })();
    }
  }, [lastResult, spinningSlots]);

  // Note: Roulette reveal is now handled via onAnimationComplete on the wheel
  // to ensure the number is not shown until the wheel has fully stopped.

  // Roulette wheel data (European, 37 pockets)
  const ROULETTE_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];

  function getRouletteColor(num: number) {
    if (num === 0) return '#10b981'; // green
    const reds = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    return reds.includes(num) ? '#ef4444' : '#1f2937';
  }

  function calculateRouletteRotation(winningNumber: number) {
    const idx = ROULETTE_ORDER.indexOf(winningNumber);
    if (idx < 0) return 0;
    const segment = 360 / 37;
    const segmentCenter = idx * segment + segment / 2;
    // Rotate so the center of the winning segment is under the top pointer (0 deg)
    const base = -segmentCenter;
    // Add several full rotations + slight random for natural feel
    const spins = 5.5 + Math.random() * 2.5;
    return base + spins * 360;
  }

  function createPieSlice(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
    const start = (startDeg - 90) * Math.PI / 180;
    const end = (endDeg - 90) * Math.PI / 180;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = (endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
  }

  const isButuz = (user?.username || '').toLowerCase() === 'butuz';

  // Local helpers for Blackjack (client-side card rendering + scoring)
  const cardStr = (c: any) => `${c?.rank ?? '?'}${c?.suit ?? ''}`;
  const handValue = (hand: any[]): number => {
    if (!hand || !hand.length) return 0;
    let val = 0, aces = 0;
    for (const c of hand) {
      const r = c?.rank || '';
      if (r === 'A') aces++;
      else if (['J','Q','K'].includes(r)) val += 10;
      else if (r) val += parseInt(r, 10) || 0;
    }
    for (let i = 0; i < aces; i++) {
      val += (val + 11 <= 21 ? 11 : 1);
    }
    return val;
  };

  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  // ===== COIN PvP helpers (local) =====
  async function loadPvpRooms() {
    if (!token) return;
    try {
      const list = await api.coinPvpRooms(token);
      const mine = currentRoom?.p1?.id || 0;
      setPvpRooms((list || []).filter((r: any) => !mine || (r.p1?.id !== mine)));
    } catch {}
  }

  function startPvpPolling(roomId: string) {
    if (pvpPollRef.current) clearInterval(pvpPollRef.current);
    pvpPollRef.current = setInterval(async () => {
      if (!token) return;
      try {
        const fresh = await api.coinPvpRoom(roomId, token);
        setCurrentRoom(fresh);

        if (fresh && fresh.p1_choice && fresh.p2_choice && !pvpFlipResult) {
          // Both locked — get authoritative result (works even if server already resolved it)
          try {
            const res = await api.coinPvpReveal(roomId, token);
            setPvpFlipResult(res);
            setPvpFlipping(true);
            setTimeout(() => {
              setPvpFlipping(false);
              refreshProfile();
            }, 1150);
            if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
          } catch {}
        }

        if (!fresh || fresh.status === 'finished') {
          if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
        }
      } catch {
        // room gone (already resolved)
        if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
      }
    }, 1550);
  }

  function clearPvp() {
    if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
    setCurrentRoom(null);
    setPvpRooms([]);
    setJoinCode('');
    setPvpMySide(null);
    setPvpFlipping(false);
    setPvpFlipResult(null);
  }

  function exitPvpRoom() {
    if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
    setCurrentRoom(null);
    setPvpMySide(null);
    setPvpFlipping(false);
    setPvpFlipResult(null);
  }

  // small helper used in blackjack UI
  const ranksEqual = (a: any, b: any) => !!(a && b && a.rank === b.rank);

  // Mines helpers (exact port of server getMinesMult + house edge 0.90)
  const getMinesMult = (opened: number, minesC: number): number => {
    const cells = 25 - minesC;
    if (opened === 0) return 1.0;
    let m = 1.0;
    for (let i = 0; i < opened; i++) m *= (25 - i) / (cells - i);
    return Math.round(m * 0.90 * 100) / 100;
  };
  const getMinesMaxMult = (minesC: number): number => getMinesMult(25 - minesC, minesC);

  // ===== PLINKO pure helpers (used by board + selectors) =====
  const getPlinkoMultipliers = (rows: 8 | 12 | 16, risk: 'low' | 'medium' | 'high'): number[] => {
    // Mirror of server tables (keep in sync)
    if (rows === 8) {
      if (risk === 'low') return [1.7, 1.4, 1.15, 1.0, 0.85, 1.0, 1.15, 1.4, 1.7];
      if (risk === 'medium') return [2.6, 1.7, 1.25, 0.85, 0.5, 0.85, 1.25, 1.7, 2.6];
      return [5.0, 2.6, 1.3, 0.55, 0.25, 0.55, 1.3, 2.6, 5.0];
    }
    if (rows === 12) {
      if (risk === 'low') return [1.9, 1.55, 1.3, 1.15, 1.05, 0.95, 0.9, 0.95, 1.05, 1.15, 1.3, 1.55, 1.9];
      if (risk === 'medium') return [3.2, 2.1, 1.5, 1.1, 0.8, 0.55, 0.4, 0.55, 0.8, 1.1, 1.5, 2.1, 3.2];
      return [8.0, 3.8, 2.0, 1.1, 0.6, 0.35, 0.2, 0.35, 0.6, 1.1, 2.0, 3.8, 8.0];
    }
    // 16
    if (risk === 'low') return [2.0, 1.6, 1.35, 1.2, 1.1, 1.0, 0.95, 0.9, 0.85, 0.9, 0.95, 1.0, 1.1, 1.2, 1.35, 1.6, 2.0];
    if (risk === 'medium') return [4.5, 2.8, 1.8, 1.3, 1.0, 0.75, 0.55, 0.4, 0.3, 0.4, 0.55, 0.75, 1.0, 1.3, 1.8, 2.8, 4.5];
    return [22, 8, 4, 2.2, 1.3, 0.7, 0.4, 0.25, 0.15, 0.25, 0.4, 0.7, 1.3, 2.2, 4, 8, 22];
  };

  const getPlinkoMax = (risk: 'low'|'medium'|'high', rows: 8|12|16) => {
    const m = getPlinkoMultipliers(rows, risk);
    return Math.max(...m);
  };

  const getPlinkoMultAt = (rows: number, risk: 'low'|'medium'|'high', slot: number | null) => {
    if (slot == null) return null;
    const m = getPlinkoMultipliers(rows as 8|12|16, risk);
    return m[slot] ?? null;
  };

  // Visual Plinko board — completely rebuilt to the exact spec provided.
  // 1000x700 world (scaled for display), 9 rows, precise peg placement, real circle collisions,
  // post-hit micro randomness, side walls + bottom slot dividers as static barriers,
  // glow, peg pop, slot win highlight, and predictive dotted line.
  const PlinkoBoard = ({ 
    risk, path, landed, dropping, 
    onComplete,
    maxWidth = 620
  }: {
    risk: 'low' | 'medium' | 'high';
    path: ('L'|'R')[] | null;
    landed: number | null;
    dropping: boolean;
    onComplete?: () => void;
    maxWidth?: number;
  }) => {
    // Responsive: scale the entire 1000x700 world to fit the available mobile/desktop width
    const displayWidth = Math.max(280, Math.min(maxWidth, 620));
    const SCALE = displayWidth / 1000;
    const WORLD_WIDTH = 1000 * SCALE;
    const WORLD_HEIGHT = 700 * SCALE;
    const centerX = 500 * SCALE;
    const horizontalSpacing = 60 * SCALE;
    const verticalSpacing = 55 * SCALE;
    const topOffset = 80 * SCALE;
    const hPad = 180 * SCALE;
    const rightWallX = 820 * SCALE;

    const PEG_DIAM = 12 * SCALE;
    const PEG_R = PEG_DIAM / 2;
    const BALL_DIAM = 18 * SCALE;
    const BALL_R = BALL_DIAM / 2;

    // 9 rows as per spec
    const numRows = 9;

    const containerRef = useRef<HTMLDivElement | null>(null);
    const ballRef = useRef<HTMLDivElement | null>(null);
    const rafRef = useRef<number | null>(null);
    const simRef = useRef<any>({ running: false });
    const [hitPegs, setHitPegs] = useState<number[]>([]); // for pop animation
    const [winSlot, setWinSlot] = useState<number | null>(null);

    // Exact peg generation per the user's formula (9 rows, 3→11 pins)
    const pegPositions = useMemo(() => {
      const out: Array<{x: number; y: number; row: number; id: number}> = [];
      let id = 0;
      for (let row = 0; row < numRows; row++) {
        const pegs = row + 3;
        const startX = centerX - ((pegs - 1) * horizontalSpacing) / 2;
        const y = topOffset + row * verticalSpacing;
        for (let i = 0; i < pegs; i++) {
          const x = startX + i * horizontalSpacing;
          out.push({ x, y, row, id: id++ });
        }
      }
      return out;
    }, []);

    // 9 slots - layout kept identical for physics correctness (mechanics not touched except landing snap)
    const numSlots = 9;
    const slotWidth = 65 * SCALE;
    const slotHeight = 25 * SCALE;
    const slotGap = 2 * SCALE;
    const dividerWidth = 4 * SCALE;
    const dividerHeight = 40 * SCALE;

    const slotsStartX = centerX - (numSlots * slotWidth + (numSlots - 1) * slotGap) / 2;
    const slotsY = topOffset + (numRows - 1) * verticalSpacing + 38 * SCALE;

    const slotCenters = useMemo(() => {
      return Array.from({ length: numSlots }, (_, i) =>
        slotsStartX + i * (slotWidth + slotGap) + slotWidth / 2
      );
    }, []);

    // Multipliers per risk, matching server tables for rows=9 (so labels match actual payouts)
    const multipliers = risk === 'low'
      ? [8, 3, 1.8, 1.1, 0.7, 1.1, 1.8, 3, 8]
      : risk === 'high'
        ? [50, 7, 2.5, 0.4, 0.1, 0.4, 2.5, 7, 50]
        : [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29];

    // Static barriers (side walls + bottom dividers)
    const staticBarriers = useMemo(() => {
      const barriers: Array<{type: 'wall' | 'divider'; x: number; y: number; w: number; h: number}> = [];

      // Side walls (thick)
      barriers.push({ type: 'wall', x: hPad - 10, y: 0, w: 20, h: WORLD_HEIGHT });
      barriers.push({ type: 'wall', x: rightWallX - 10, y: 0, w: 20, h: WORLD_HEIGHT });

      // Vertical dividers between the 9 slots
      for (let i = 1; i < numSlots; i++) {
        const dx = slotsStartX + i * (slotWidth + slotGap) - dividerWidth / 2;
        barriers.push({
          type: 'divider',
          x: dx,
          y: slotsY - 8,
          w: dividerWidth,
          h: dividerHeight,
        });
      }
      return barriers;
    }, []);

    // Reset ball visual
    const resetBallVisual = (toTop = true) => {
      const el = ballRef.current;
      if (!el) return;
      if (toTop) {
        el.style.transition = 'none';
        el.style.transform = `translate(${centerX - BALL_R}px, ${topOffset - 30}px)`;
        void el.offsetWidth;
        el.style.transition = '';
      }
      setHitPegs([]);
      setWinSlot(null);
    };

    // Main physics — matches the detailed spec as closely as possible
    const startPhysicsDrop = (finalSlot: number) => {
      const ballEl = ballRef.current;
      if (!ballEl) return;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);

      const state = {
        x: centerX,
        y: topOffset - 25,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 2.8,
        done: false,
      };
      simRef.current = { running: true, state };

      const GRAVITY = 0.75 * SCALE;   // spec gravity feeling
      const AIR_FRICTION = 0.998;

      // For preview / guidance we still respect the server finalSlot
      const targetFinalX = slotCenters[Math.max(0, Math.min(numSlots - 1, finalSlot))];

      const tick = () => {
        if (!simRef.current.running || !ballEl) return;

        const s = simRef.current.state;

        // Gravity + movement
        s.vy += GRAVITY;
        s.vy *= AIR_FRICTION;
        s.vx *= AIR_FRICTION;
        s.x += s.vx;
        s.y += s.vy;

        // === REAL COLLISIONS WITH PEGS (every peg is a real barrier) ===
        let hitThisFrame = false;
        const ballR = BALL_R;
        const pegR = PEG_R + 1.5;

        for (let i = 0; i < pegPositions.length; i++) {
          const peg = pegPositions[i];
          const dx = s.x - peg.x;
          const dy = s.y - peg.y;
          const distSq = dx * dx + dy * dy;
          const minDist = ballR + pegR;

          if (distSq > 0 && distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            const nx = dx / dist;
            const ny = dy / dist;

            // Push out
            const overlap = minDist - dist + 0.5;
            s.x += nx * overlap;
            s.y += ny * overlap;

            // Bounce
            const vn = s.vx * nx + s.vy * ny;
            s.vx = (s.vx - 1.7 * vn * nx) * 0.82;
            s.vy = (s.vy - 1.7 * vn * ny) * 0.82;

            // === CRITICAL CASINO RANDOMNESS (the spec emphasizes this) ===
            s.vx += (Math.random() - 0.5) * 0.9;   // small random left/right impulse after hit

            // Visual pop on the peg
            setHitPegs((prev) => [...prev, peg.id].slice(-6));
            setTimeout(() => {
              setHitPegs((prev) => prev.filter((id) => id !== peg.id));
            }, 120);

            hitThisFrame = true;
          }
        }

        // Side walls (simple)
        if (s.x < hPad + 12) {
          s.x = hPad + 12;
          s.vx = Math.abs(s.vx) * 0.65;
        }
        if (s.x > rightWallX - 12) {
          s.x = rightWallX - 12;
          s.vx = -Math.abs(s.vx) * 0.65;
        }

        // Bottom slot dividers (static rect collisions)
        const ballBottom = s.y + ballR;
        for (const bar of staticBarriers) {
          if (bar.type !== 'divider') continue;

          const barLeft = bar.x;
          const barRight = bar.x + bar.w;
          const barTop = bar.y;
          const barBottom = bar.y + bar.h;

          if (
            s.x + ballR > barLeft &&
            s.x - ballR < barRight &&
            ballBottom > barTop &&
            s.y - ballR < barBottom
          ) {
            // Horizontal push + bounce
            const centerBar = bar.x + bar.w / 2;
            const push = s.x < centerBar ? -1 : 1;
            s.x = s.x < centerBar
              ? barLeft - ballR - 0.5
              : barRight + ballR + 0.5;

            s.vx = push * Math.abs(s.vx) * 0.7 + (Math.random() - 0.5) * 0.4;
            s.vy *= 0.85;
          }
        }

        // Speed limits
        const maxSpeed = 6.5 * SCALE;
        if (s.vx > maxSpeed) s.vx = maxSpeed;
        if (s.vx < -maxSpeed) s.vx = -maxSpeed;
        if (s.vy > 7.5 * SCALE) s.vy = 7.5 * SCALE;

        // Render ball
        ballEl.style.transform = `translate(${s.x - BALL_R}px, ${s.y - BALL_R}px)`;

        // Landing detection: the ball falls naturally according to physics + collisions.
        // Only when it has reached the bottom area do we settle it into the exact
        // server-determined slot (to avoid mid-air teleport/magnet effect).
        const landY = slotsY + 6;

        if (s.y >= landY && !s.done) {
          s.y = landY;
          s.vy = 0;
          s.vx = 0;

          s.done = true;

          const slotIdx = Math.max(0, Math.min(numSlots - 1, finalSlot));
          setWinSlot(slotIdx);

          // Stop RAF so physics doesn't fight the settle
          if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          simRef.current.running = false;

          // From whatever natural x the physics brought it to at the bottom,
          // smoothly slide horizontally into the center of the correct (server) slot.
          // This fixes the teleport while keeping the visual "it landed here".
          const naturalX = s.x;
          ballEl.style.transition = 'none';
          ballEl.style.transform = `translate(${naturalX - BALL_R}px, ${landY}px)`;
          void ballEl.offsetWidth; // force reflow
          ballEl.style.transition = 'transform 280ms cubic-bezier(0.22, 0.96, 0.3, 1)';
          ballEl.style.transform = `translate(${targetFinalX - BALL_R}px, ${slotsY + 4}px)`;

          setTimeout(() => {
            if (onComplete) onComplete();
            // clear win glow after a bit
            setTimeout(() => setWinSlot(null), 1600);
          }, 300);

          return;
        }

        rafRef.current = requestAnimationFrame(tick);
      };

      // Initial drop position
      ballEl.style.transition = 'none';
      ballEl.style.transform = `translate(${centerX - BALL_R}px, ${topOffset - 32}px)`;
      void ballEl.offsetWidth;
      ballEl.style.transition = '';

      // Add the signature pink glow
      ballEl.style.boxShadow = '0 0 18px #ff00aa, 0 0 32px #ff00aa33';

      rafRef.current = requestAnimationFrame(tick);
    };

    // Trigger physics when dropping starts (authoritative finalSlot from server)
    useEffect(() => {
      if (dropping && landed != null) {
        startPhysicsDrop(landed);
      } else if (!dropping) {
        if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
        simRef.current.running = false;
        resetBallVisual(true);
      }
    }, [dropping, landed]);

    // Cleanup on unmount
    useEffect(() => {
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }, []);

    // When result is available, ensure the correct slot is highlighted (glow).
    // The ball position is handled inside the physics landing logic to avoid jumps/teleports.
    useEffect(() => {
      if (!dropping && landed != null) {
        setWinSlot(landed);
        setTimeout(() => setWinSlot(null), 1800);
      }
    }, [landed, dropping]);

    // Predictive dotted line (simple guide from top center)
    const showPreview = !dropping && !landed;

    return (
      <div 
        ref={containerRef} 
        className="relative mx-auto overflow-hidden rounded-3xl" 
        style={{ 
          width: WORLD_WIDTH, 
          height: WORLD_HEIGHT, 
          background: '#0b111f'
        }}
      >
        <svg 
          width={WORLD_WIDTH} 
          height={WORLD_HEIGHT} 
          viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} 
          className="block"
        >
          {/* Clean background for the playfield */}
          <rect x={0} y={0} width={WORLD_WIDTH} height={WORLD_HEIGHT} fill="#0b111f" rx={12} />

          {/* Pegs (real physical barriers) */}
          {pegPositions.map((pg) => {
            const isHit = hitPegs.includes(pg.id);
            return (
              <g key={pg.id}>
                <circle 
                  cx={pg.x} 
                  cy={pg.y} 
                  r={PEG_R + 2} 
                  fill="#0f172a" 
                />
                <circle 
                  cx={pg.x} 
                  cy={pg.y} 
                  r={PEG_R} 
                  fill={risk === 'high' ? '#fda4af' : risk === 'medium' ? '#fcd34d' : '#6ee7b7'}
                  style={{
                    transition: isHit ? 'transform 80ms ease-out' : 'none',
                    transform: isHit ? 'scale(1.18)' : 'scale(1)',
                    transformOrigin: `${pg.x}px ${pg.y}px`
                  }}
                />
              </g>
            );
          })}

          {/* Redesigned bottom slots area - clean, no overlaps, stable text */}
          {/* Subtle raised platform / separator */}
          <rect 
            x={hPad + 8} 
            y={slotsY - 5} 
            width={rightWallX - hPad - 16} 
            height="5" 
            fill="#1f2937" 
            rx="2"
          />

          {multipliers.map((m, i) => {
            const slotX = slotsStartX + i * (slotWidth + slotGap);
            const isWin = winSlot === i;
            const isHigh = m >= 4;
            const isLow = m <= 0.3;

            // Visual bin slightly inset so dividers don't overlap the colored area
            const visualInset = 2.5 * SCALE;
            const visX = slotX + visualInset;
            const visW = slotWidth - visualInset * 2;

            // The main bin (the "лунка")
            const binFill = isWin 
              ? (isHigh ? '#334155' : '#1f2937') 
              : (isLow ? '#3f1f1f' : isHigh ? '#052e16' : '#111827');
            const binStroke = isWin 
              ? (isHigh ? '#fbbf24' : '#a5b4fc') 
              : (isLow ? '#f87171' : isHigh ? '#34d399' : '#475569');

            return (
              <g key={i}>
                {/* Main slot bin */}
                <rect 
                  x={visX} 
                  y={slotsY} 
                  width={visW} 
                  height={slotHeight} 
                  rx={4}
                  fill={binFill}
                  stroke={binStroke}
                  strokeWidth={isWin ? 2.2 : 1.1}
                />

                {/* Multiplier badge (separate to prevent any text shift on win) */}
                <rect 
                  x={visX + 4} 
                  y={slotsY + 3} 
                  width={visW - 8} 
                  height={slotHeight - 6} 
                  rx={3}
                  fill={isWin 
                    ? (isHigh ? '#78350f' : isLow ? '#450a0a' : '#052e16') 
                    : (isLow ? '#450a0a' : isHigh ? '#052e16' : '#1f2937')}
                  stroke={isWin ? (isHigh ? '#fbbf24' : '#4ade80') : 'none'}
                  strokeWidth={isWin ? 1 : 0}
                />

                {/* Multiplier text - stable position and size */}
                <text 
                  x={slotX + slotWidth / 2} 
                  y={slotsY + slotHeight * 0.68} 
                  textAnchor="middle" 
                  fontSize="12.5" 
                  fontWeight="700" 
                  fill={isWin 
                    ? (isHigh ? '#fef08c' : isLow ? '#fda4af' : '#4ade80') 
                    : (isLow ? '#fda4af' : isHigh ? '#4ade80' : '#e0e7ff')}
                >
                  {m}×
                </text>
              </g>
            );
          })}

          {/* Vertical slot dividers / bin walls - clean separators, no overlap with visual bins */}
          {Array.from({ length: numSlots - 1 }).map((_, i) => {
            const divX = slotsStartX + (i + 1) * (slotWidth + slotGap) - dividerWidth / 2;
            return (
              <g key={i}>
                {/* Main wall */}
                <rect 
                  x={divX} 
                  y={slotsY - 12} 
                  width={dividerWidth} 
                  height={dividerHeight + 8} 
                  fill="#475569" 
                  rx="1"
                />
                {/* Small top cap for nicer bin look */}
                <rect 
                  x={divX - 0.5} 
                  y={slotsY - 14} 
                  width={dividerWidth + 1} 
                  height="4" 
                  fill="#64748b" 
                  rx="1"
                />
              </g>
            );
          })}

          {/* Predictive dotted guide line (before drop) */}
          {showPreview && (
            <g opacity="0.35">
              <line 
                x1={centerX} 
                y1={topOffset - 20} 
                x2={centerX} 
                y2={slotsY + 30} 
                stroke="#ffffff" 
                strokeWidth="2" 
                strokeDasharray="4 6" 
              />
              {/* faint target highlight on a high multiplier */}
              <circle 
                cx={slotCenters[0]} 
                cy={slotsY + 12} 
                r="8" 
                fill="none" 
                stroke="#ffffff" 
                strokeWidth="1.5" 
                strokeDasharray="2 3" 
              />
              <circle 
                cx={slotCenters[8]} 
                cy={slotsY + 12} 
                r="8" 
                fill="none" 
                stroke="#ffffff" 
                strokeWidth="1.5" 
                strokeDasharray="2 3" 
              />
            </g>
          )}
        </svg>

        {/* The actual ball — pink glow as per spec */}
        <div
          ref={ballRef}
          className="absolute pointer-events-none z-20 rounded-full"
          style={{
            width: BALL_DIAM,
            height: BALL_DIAM,
            left: 0,
            top: 0,
            background: '#ff00aa',
            border: '2px solid #ffffff',
            boxShadow: '0 0 18px #ff00aa, 0 0 32px #ff00aa55, inset 0 -4px 6px rgba(0,0,0,0.3)',
            willChange: 'transform',
          }}
        />
      </div>
    );
  };

  // Blackjack card visuals + helpers
  const isRedSuit = (suit: any) => {
    const s = String(suit || '').toUpperCase();
    return s.includes('H') || s.includes('D') || s.includes('♥') || s.includes('♦');
  };

  const renderBJCard = (c: any, key: React.Key, faceDown = false) => (
    <motion.div
      key={key}
      initial={{ scale: 0.65, opacity: 0, y: 14, rotate: -6 }}
      animate={{ scale: 1, opacity: 1, y: 0, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 460, damping: 24 }}
      className="w-12 h-16 sm:w-14 sm:h-[78px] bg-white text-slate-900 rounded-xl border border-slate-300 shadow-md flex flex-col items-center justify-center select-none overflow-hidden"
    >
      {faceDown ? (
        <div className="text-2xl text-slate-400">🂠</div>
      ) : c ? (
        <div className="flex flex-col items-center justify-center gap-px pt-0.5 pb-1">
          <span
            style={{
              color: isRedSuit(c.suit) ? '#b91c1c' : '#0f172a',
              fontSize: '17px',
              lineHeight: '15px',
              fontWeight: 800,
              letterSpacing: '-0.3px'
            }}
          >
            {c.rank}
          </span>
          <span
            style={{
              color: isRedSuit(c.suit) ? '#b91c1c' : '#0f172a',
              fontSize: '15px',
              lineHeight: '13px',
              marginTop: '1px'
            }}
          >
            {c.suit || ''}
          </span>
        </div>
      ) : '??'}
    </motion.div>
  );

  const refreshProfile = async () => {
    if (!token) return;
    try {
      const p = await api.casinoProfile(token);
      setProfile(p);
    } catch (e) {
      console.error('Casino profile load failed', e);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await refreshProfile();
      setLoading(false);
    })();
  }, [token]);

  // Initialize bet from server's last_bet (remembered like in the bot)
  useEffect(() => {
    if (profile && !betInitializedRef.current && profile.last_bet && profile.last_bet >= MIN_BET) {
      const suggested = Math.min(profile.last_bet, profile.balance || profile.last_bet);
      if (suggested >= MIN_BET) setBet(suggested);
      betInitializedRef.current = true;
    }
  }, [profile]);

  // Live farm accumulator (client prediction for nice feel) — now only while in economy tab
  useEffect(() => {
    if (!farm || !farm.farm || hubView !== 'economy') return;
    const iv = setInterval(() => {
      // mutate local display value for smoothness (real value comes on collect/load)
      setFarm((prev: any) => {
        if (!prev || !prev.farm) return prev;
        const hoursSince = Math.min((Date.now() - new Date(prev.last_collected || Date.now()).getTime()) / 3600000, 72);
        const add = (prev.farm.btc_per_hour || 0) * hoursSince * 0.02; // small tick
        const newBtc = Math.min((prev.totalBtc || 0) + add * 0.01, (prev.totalBtc || 0) + 0.5);
        return { ...prev, totalBtc: newBtc, btcValue: Math.floor(newBtc * 65000) };
      });
    }, 1400);
    return () => clearInterval(iv);
  }, [farm, hubView]);

  const setQuickBet = (v: number) => {
    if (!profile) return;
    setBet(Math.min(v, profile.balance));
  };

  const doVabank = () => {
    if (profile) setBet(Math.max(MIN_BET, profile.balance));
  };

  async function play(game: string, extra?: any) {
    if (!token || !profile) return;
    if (bet < MIN_BET) { alert('Мин. ставка ' + MIN_BET); return; }
    if (bet > profile.balance) { alert('Недостаточно кристаллов'); return; }

    setLastResult(null);
    try {
      let res: any;
      if (game === 'slots') res = await api.playSlots(bet, token);
      else if (game === 'coin') res = await api.playCoin(bet, extra?.side || 'heads', token);
      else if (game === 'dice') res = await api.playDice(bet, extra?.betType || 'high', extra?.target, token);
      else if (game === 'roulette') res = await api.playRoulette(bet, extra?.betType || 'red', extra?.target, token);
      else return;

      setLastResult({ game, ...res });
      await refreshProfile();
    } catch (e: any) {
      alert(e.message || 'Ошибка игры');
    }
  }

  // ===== PLINKO (physics falling + clean right sidebar controls) =====
  async function dropPlinko() {
    if (!token || !profile) return;
    if (bet < MIN_BET) { alert('Мин. ставка ' + MIN_BET); return; }
    if (bet > profile.balance) { alert('Недостаточно кристаллов'); return; }

    if (plinkoAnimRef.current) { clearTimeout(plinkoAnimRef.current); plinkoAnimRef.current = null; }

    setPlinkoResult(null);
    setPlinkoPath(null);
    setPlinkoLanded(null);
    setPlinkoDropping(true);

    try {
      const res = await api.playPlinko(bet, plinkoRisk, 9, token);
      pendingPlinkoRef.current = res;

      setPlinkoPath(res.path);
      setPlinkoLanded(res.finalSlot);
      setLastResult({ game: 'plinko', ...res });

      // The PlinkoBoard component will run the real physics animation and call handlePlinkoComplete when the ball visually settles
    } catch (e: any) {
      setPlinkoDropping(false);
      alert(e.message || 'Ошибка Плинко');
    }
  }

  function handlePlinkoComplete() {
    const res = pendingPlinkoRef.current;
    if (!res) {
      setPlinkoDropping(false);
      return;
    }
    setPlinkoResult({ multiplier: res.multiplier, win: res.win, profit: res.profit, bet: res.bet });
    setPlinkoHistory((h) => [{ multiplier: res.multiplier, win: res.win, risk: res.risk, rows: res.rows }, ...h].slice(0, 8));
    setPlinkoDropping(false);
    pendingPlinkoRef.current = null;
    refreshProfile();
  }

  function resetPlinkoBoard() {
    if (plinkoAnimRef.current) { clearTimeout(plinkoAnimRef.current); plinkoAnimRef.current = null; }
    pendingPlinkoRef.current = null;
    setPlinkoPath(null);
    setPlinkoLanded(null);
    setPlinkoResult(null);
    setPlinkoDropping(false);
  }

  function repeatPlinko() {
    if (!plinkoDropping) dropPlinko();
  }

  function clearPlinkoHistory() {
    setPlinkoHistory([]);
  }

  // Cleanup when leaving plinko view
  useEffect(() => {
    if (currentGame !== 'plinko') {
      if (plinkoAnimRef.current) { clearTimeout(plinkoAnimRef.current); plinkoAnimRef.current = null; }
      pendingPlinkoRef.current = null;
    }
  }, [currentGame]);

  // Fresh board when (re)opening Plinko
  useEffect(() => {
    if (currentGame === 'plinko') {
      resetPlinkoBoard();
    }
  }, [currentGame]);

  // Safety: non-admins should never have Plinko open
  useEffect(() => {
    if (currentGame === 'plinko' && !isButuz) {
      setCurrentGame(null);
    }
  }, [currentGame, isButuz]);

  // MINES
  async function startMines() {
    if (!token) return;
    try {
      const s = await api.minesStart(bet, minesCount, token);
      setMinesSession(s);
      setMinesOpened([]);
      setMinesLost(null);
      setMinesMult(1.0);
      setLastResult(null);
      await refreshProfile();
    } catch (e: any) { alert(e.message); }
  }
  async function mineOpen(cell: number) {
    if (!minesSession || !token) return;
    try {
      const r = await api.minesOpen(minesSession.sessionId, cell, token);
      setMinesOpened(r.opened);
      setMinesMult(r.mult);
      if (r.busted || r.finished) {
        setLastResult({ game: 'mines', ...r.result, busted: r.busted });
        if (r.busted && r.mines) {
          setMinesLost({ opened: r.opened, mines: r.mines, mult: r.mult, bet });
        }
        setMinesSession(null);
        await refreshProfile();
      }
    } catch (e: any) { alert(e.message); }
  }
  async function minesCash() {
    if (!minesSession || !token) return;
    const r = await api.minesCashout(minesSession.sessionId, token);
    setLastResult({ game: 'mines', win: r.win, mult: r.mult });
    setMinesSession(null);
    await refreshProfile();
  }

  // BLACKJACK with Split + Double + card dealing animations — fully restored & polished
  async function startBJ(overrideBet?: number) {
    if (!token || !profile) return;
    const betToUse = (typeof overrideBet === 'number' ? overrideBet : bet);
    if (betToUse < MIN_BET) { alert('Мин. ставка ' + MIN_BET); return; }
    if (betToUse > profile.balance) { alert('Недостаточно кристаллов'); return; }

    setLastResult(null);
    try {
      const r = await api.bjStart(betToUse, token);
      setBjPlayerHands([]);
      setBjDealerCards([]);
      setBjAnimating(true);
      setBjCurrentHandIndex(0);

      if (r.natural) {
        // Natural: quick deal animation + result
        const p = r.pHand || [];
        const d = r.dHand || [];

        await sleep(110);
        setBjPlayerHands([{ cards: p, bet: r.bet || betToUse }]);
        await sleep(140);
        setBjDealerCards(d.length > 0 ? [d[0]] : []);
        await sleep(130);
        if (d.length > 1) setBjDealerCards([d[0], d[1]]);

        setBjAnimating(false);
        // normalize for result popup (provide playerHands shape for net calc)
        setLastResult({
          game: 'blackjack',
          natural: true,
          totalWin: r.win,
          bet: r.bet || betToUse,
          playerHands: [{ cards: p, bet: r.bet || betToUse }],
          ...r
        });
        await refreshProfile();
        return;
      }

      // Normal initial deal animation (2 player cards + dealer upcard)
      const hands = r.playerHands || [];
      const firstHandCards = hands[0]?.cards || [];
      const dealerUp = r.dealerUp;

      await sleep(120);
      if (firstHandCards[0]) setBjPlayerHands([{ cards: [firstHandCards[0]], bet: r.bet || betToUse }]);
      await sleep(160);
      setBjDealerCards(dealerUp ? [dealerUp] : []);
      await sleep(160);
      if (firstHandCards[1]) {
        setBjPlayerHands([{ cards: firstHandCards, bet: r.bet || betToUse }]);
      }

      setBjSession({ sessionId: r.sessionId, bet: r.bet });
      setBjPlayerHands(hands.length ? hands : [{ cards: firstHandCards, bet: r.bet || betToUse }]);
      setBjCurrentHandIndex(r.currentHandIndex ?? 0);
      setBjAnimating(false);
      await refreshProfile();
    } catch (e: any) {
      setBjAnimating(false);
      alert(e.message);
    }
  }

  async function bjHit() {
    if (!bjSession || !token || bjAnimating) return;
    try {
      setBjAnimating(true);
      const r = await api.bjHit(bjSession.sessionId, token);

      if (r.finished) {
        // round over (bust on last hand etc.)
        // show final dealer cards with animation
        setBjDealerDrawing(true);
        const fullD = r.dHand || [];
        await sleep(300);
        setBjDealerCards(fullD.length >= 2 ? fullD.slice(0, 2) : fullD);
        for (let i = 2; i < fullD.length; i++) {
          await sleep(550);
          setBjDealerCards(prev => [...prev, fullD[i]]);
        }
        setBjDealerDrawing(false);
        setBjAnimating(false);
        setBjPlayerHands(r.playerHands || []);
        setLastResult({ game: 'blackjack', ...r });
        setBjSession(null);
        await refreshProfile();
        return;
      }

      // animate the new card to the current hand
      const newCard = r.playerHands?.[r.currentHandIndex]?.cards?.slice(-1)[0];
      if (newCard) {
        setBjPlayerHands(r.playerHands);
        // trigger a small re-render animation by briefly touching state
        await sleep(60);
      } else {
        setBjPlayerHands(r.playerHands || []);
      }
      setBjCurrentHandIndex(r.currentHandIndex ?? 0);
      setBjAnimating(false);
    } catch (e: any) {
      setBjAnimating(false);
      alert(e.message);
    }
  }

  async function bjStand() {
    if (!bjSession || !token || bjAnimating) return;
    try {
      setBjAnimating(true);
      const r = await api.bjStand(bjSession.sessionId, token);

      if (r.finished) {
        setBjDealerDrawing(true);
        const fullD = r.dHand || [];
        await sleep(320);
        setBjDealerCards(fullD.length >= 2 ? fullD.slice(0, 2) : fullD);
        for (let i = 2; i < fullD.length; i++) {
          await sleep(580);
          setBjDealerCards(prev => [...prev, fullD[i]]);
        }
        setBjDealerDrawing(false);
        setBjAnimating(false);
        setBjPlayerHands(r.playerHands || []);
        setLastResult({ game: 'blackjack', ...r });
        setBjSession(null);
        await refreshProfile();
        return;
      }

      setBjPlayerHands(r.playerHands || []);
      setBjCurrentHandIndex(r.currentHandIndex ?? 0);
      setBjAnimating(false);
    } catch (e: any) {
      setBjAnimating(false);
      alert(e.message);
    }
  }

  async function bjDouble() {
    if (!bjSession || !token || bjAnimating) return;
    try {
      setBjAnimating(true);
      const r = await api.bjDouble(bjSession.sessionId, token);

      if (r.finished) {
        setBjDealerDrawing(true);
        const fullD = r.dHand || [];
        await sleep(280);
        setBjDealerCards(fullD.length >= 2 ? fullD.slice(0, 2) : fullD);
        for (let i = 2; i < fullD.length; i++) {
          await sleep(520);
          setBjDealerCards(prev => [...prev, fullD[i]]);
        }
        setBjDealerDrawing(false);
        setBjAnimating(false);
        setBjPlayerHands(r.playerHands || []);
        setLastResult({ game: 'blackjack', ...r });
        setBjSession(null);
        await refreshProfile();
        return;
      }

      setBjPlayerHands(r.playerHands || []);
      setBjCurrentHandIndex(r.currentHandIndex ?? 0);
      setBjAnimating(false);
      await refreshProfile(); // balance changed (extra bet taken)
    } catch (e: any) {
      setBjAnimating(false);
      alert(e.message);
    }
  }

  async function bjSplit() {
    if (!bjSession || !token || bjAnimating) return;
    try {
      setBjAnimating(true);
      const r = await api.bjSplit(bjSession.sessionId, token);

      if (r.finished) {
        // split aces usually
        setBjDealerDrawing(true);
        const fullD = r.dHand || [];
        await sleep(260);
        setBjDealerCards(fullD.length >= 2 ? fullD.slice(0, 2) : fullD);
        for (let i = 2; i < fullD.length; i++) {
          await sleep(480);
          setBjDealerCards(prev => [...prev, fullD[i]]);
        }
        setBjDealerDrawing(false);
        setBjAnimating(false);
        setBjPlayerHands(r.playerHands || []);
        setLastResult({ game: 'blackjack', ...r });
        setBjSession(null);
        await refreshProfile();
        return;
      }

      // Split happened — set the two hands. New cards are already in the hands from server.
      setBjPlayerHands(r.playerHands || []);
      setBjCurrentHandIndex(r.currentHandIndex ?? 0);
      setBjAnimating(false);
      await refreshProfile(); // extra bet was taken
    } catch (e: any) {
      setBjAnimating(false);
      alert(e.message);
    }
  }

  // Loaders for panels
  async function loadFarm() { if (!token) return; setFarm(await api.farmStatus(token)); }
  async function loadBank() {
    if (!token) return;
    const data = await api.bankFull(token);
    setBank(data);
    // sensible defaults for amount pickers
    const onHand = data.balance || 0;
    const inst = data.instant || 0;
    setInstantDepAmt(Math.min(100000, Math.max(1000, Math.floor(onHand * 0.5))));
    setInstantWdAmt(Math.min(100000, Math.max(1000, Math.floor(inst * 0.5))));
    if (openingTierId) {
      const t = (data.tiers || []).find((x: any) => x.id === openingTierId);
      if (t) setOpenAmount(Math.min(t.max, Math.max(t.min, Math.floor(onHand * 0.3))));
    }
  }
  async function loadBiz() {
    if (!token) return;
    const d = await api.businessesList(token);
    setBizList(d.list || []);
    if (d.cooldown) setBizCooldown(d.cooldown);
  }

  // Live tick for business task cooldown timers (only when on biz tab for perf)
  useEffect(() => {
    let iv: ReturnType<typeof setInterval> | null = null;
    if (activeTab === 'biz') {
      iv = setInterval(() => setBizTick((t) => t + 1), 1000);
    }
    return () => {
      if (iv) clearInterval(iv);
    };
  }, [activeTab]);

  // Auto default sub-tab and clear selection when switching to biz or list changes
  useEffect(() => {
    if (activeTab !== 'biz') return;

    const owned = bizList.filter((b: any) => b.owned);
    const total = bizList.length;

    if (total > 0) {
      if (owned.length === 0) {
        setBizSubTab('available');
        setSelectedBizId(null);
      } else if (owned.length === total) {
        setBizSubTab('my');
        // do not auto-open detail window; user clicks to open
      } else {
        // has both owned and available — prefer "my"
        if (bizSubTab !== 'my' && bizSubTab !== 'available') setBizSubTab('my');
      }
    }
  }, [activeTab, bizList]);

  // Clear shop modal when leaving shop tab
  useEffect(() => {
    if (activeTab !== 'shop') {
      setSelectedShopItem(null);
    }
  }, [activeTab]);

  // Reset sell amount when selecting rating
  useEffect(() => {
    if (selectedShopItem === 'rating' && shop) {
      setShopSellAmount(Math.min(shop.rating || 1, 100));
    }
  }, [selectedShopItem, shop]);

  // Admin tab handled by dedicated AdminPanel component (no extra effects here)

  // Auto-load open coin pvp rooms when entering pvp mode
  useEffect(() => {
    if (currentGame === 'coin' && coinMode === 'pvp' && !currentRoom) {
      loadPvpRooms();
    }
  }, [currentGame, coinMode, currentRoom]);

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }
  async function loadShop() { if (!token) return; setShop(await api.shopStatus(token)); }
  async function loadTop() { if (!token) return; setLeaderboard(await api.casinoLeaderboard(token)); }

  // Panel openers
  const openPanel = async (tab: any) => {
    setActiveTab(tab);
    if (tab === 'farm') await loadFarm();
    if (tab === 'bank') await loadBank();
    if (tab === 'biz') await loadBiz();
    if (tab === 'shop') await loadShop();
    if (tab === 'top') await loadTop();
    // admin tab is self-contained
  };

  // Farm actions
  async function farmCollect() { if (!token) return; await api.farmCollect(token); await loadFarm(); await refreshProfile(); }
  async function farmUpgrade() { if (!token) return; await api.farmUpgrade(token); await loadFarm(); await refreshProfile(); }
  async function farmBuyExtra(n: number) { if (!token) return; await api.farmBuyExtra(n, token); await loadFarm(); await refreshProfile(); }

  // Bank actions (instant flexible 0% + timed deposits)
  async function doInstantDeposit(amt?: number) {
    if (!token || !bank) return;
    const a = amt ?? instantDepAmt;
    const max = bank.balance || 0;
    const val = Math.max(0, Math.min(Math.floor(a || 0), max));
    if (val <= 0) { alert('Укажите сумму для пополнения'); return; }
    await api.bankDeposit(val, token);
    await loadBank();
    await refreshProfile();
  }
  async function doInstantWithdraw(amt?: number) {
    if (!token || !bank) return;
    const a = amt ?? instantWdAmt;
    const max = bank.instant || 0;
    const val = Math.max(0, Math.min(Math.floor(a || 0), max));
    if (val <= 0) { alert('Укажите сумму для снятия'); return; }
    await api.bankWithdraw(val, token);
    await loadBank();
    await refreshProfile();
  }

  async function startOpenDeposit(tierId: string) {
    if (!bank) return;
    const tier = (bank.tiers || []).find((t: any) => t.id === tierId);
    if (!tier) return;
    setOpeningTierId(tierId);
    const onHand = bank.balance || 0;
    const suggested = Math.min(tier.max, Math.max(tier.min, Math.floor(onHand * 0.4)));
    setOpenAmount(suggested);
  }
  async function confirmOpenDeposit() {
    if (!token || !openingTierId || !bank) return;
    const tier = (bank.tiers || []).find((t: any) => t.id === openingTierId);
    if (!tier) return;
    const val = Math.floor(openAmount || 0);
    if (val < tier.min || val > tier.max) {
      alert(`Сумма от ${fmt(tier.min)} до ${fmt(tier.max)}`);
      return;
    }
    if (val > (bank.balance || 0)) {
      alert('Недостаточно на руках');
      return;
    }
    try {
      await api.bankOpenDeposit(openingTierId, val, token);
      setOpeningTierId(null);
      setOpenAmount(0);
      await loadBank();
      await refreshProfile();
    } catch (e: any) { alert(e.message || 'Ошибка открытия вклада'); }
  }
  function cancelOpenDeposit() {
    setOpeningTierId(null);
    setOpenAmount(0);
  }
  async function claimDeposit(id: number) {
    if (!token) return;
    try {
      const r = await api.bankClaimDeposit(id, token);
      alert(`✅ Забрано ${fmt(r.claimed)} ${CURRENCY}\nПрибыль: +${fmt(r.profit)}`);
      await loadBank();
      await refreshProfile();
    } catch (e: any) { alert(e.message || 'Не удалось забрать'); }
  }

  // Biz
  async function bizBuy(id: number) {
    if (!token) return;
    try {
      await api.bizBuy(id, token);
      await loadBiz();
      await refreshProfile();
      setSelectedBizId(id); // switch to the newly bought business "tab"
      showToast('Бизнес приобретён! Теперь выполняйте задачи каждый час для дохода.');
    } catch (e: any) {
      showToast(e.message || 'Не удалось купить бизнес', 'error');
    }
  }
  async function bizDo(bizId: number, taskId: string) {
    if (!token) return;
    try {
      const r = await api.bizTask(bizId, taskId, token);
      showToast(`✅ Активность выполнена! Получено +${fmt(r.reward || 0)} ${CURRENCY} прибыли`);
      await loadBiz();
      await refreshProfile();
    } catch (e: any) {
      showToast(e.message || 'Не удалось выполнить задачу', 'error');
    }
  }
  async function bizSell(id: number) {
    if (!token) return;
    try {
      await api.bizSell(id, token);
      if (selectedBizId === id) setSelectedBizId(null);
      await loadBiz();
      await refreshProfile();
      showToast('Бизнес продан. На счёт возвращено 70% от стоимости.');
    } catch (e: any) {
      showToast(e.message || 'Не удалось продать бизнес', 'error');
    }
  }

  // Shop
  async function buyRat(a: number) { 
    if (!token) return; 
    try {
      await api.buyRating(a, token); 
      await loadShop(); 
      await refreshProfile(); 
      showToast(`Куплено +${a} 👑 рейтинга`);
    } catch (e: any) { 
      showToast(e.message || 'Ошибка покупки', 'error'); 
    }
  }
  async function sellRat(a: number) { 
    if (!token) return; 
    try {
      await api.sellRating(a, token); 
      await loadShop(); 
      await refreshProfile(); 
      showToast(`Продано ${a} 👑 рейтинга`);
      setShopSellAmount(1);
    } catch (e: any) { 
      showToast(e.message || 'Ошибка продажи', 'error'); 
    }
  }
  async function buyVip() { 
    if (!token) return; 
    try {
      await api.buyVip(token); 
      await loadShop(); 
      await refreshProfile(); 
      showToast('VIP активирован навсегда!');
      setSelectedShopItem(null); // close modal after purchase
    } catch (e: any) { 
      showToast(e.message || 'Ошибка покупки VIP', 'error'); 
    }
  }

  // Transfer
  const [transferTo, setTransferTo] = useState('');
  const [transferAmt, setTransferAmt] = useState(100000);
  async function doTransfer() {
    if (!token || !transferTo) return;
    try {
      await api.casinoTransfer(transferTo, transferAmt, token);
      alert('Перевод выполнен');
      setTransferTo('');
      await refreshProfile();
    } catch (e: any) { alert(e.message); }
  }

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Загрузка казино...</div>;
  }

  const bal = profile?.balance || 0;

  // ====================== ALWAYS VISIBLE BALANCE HEADER (fully respects profile theme, including dark) ======================
  const BalanceHeader = () => (
    <div 
      className="sticky top-16 z-[60] backdrop-blur border-b mb-3 px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-1.5 gap-x-2 rounded-b-2xl shadow-sm overflow-x-hidden"
      style={{ 
        backgroundColor: 'color-mix(in srgb, var(--card) 100%, transparent)',
        borderColor: 'var(--border)'
      }}
    >
      {/* Left: Logo + Title + Level */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-shrink-0">
          <div 
            className="w-8 h-8 rounded-xl flex items-center justify-center" 
            style={{ background: 'var(--brand-gradient)' }}
          >
            <Coins className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <span className="font-bold text-base sm:text-lg logo-gradient leading-none">Бутуз Казино</span>
            {currentGame && (
              <span 
                className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded align-middle"
                style={{ backgroundColor: 'var(--hover-bg)', color: 'var(--text-secondary)' }}
              >
                {currentGame.toUpperCase()}
              </span>
            )}
          </div>
        </div>
        {profile && (
          <div 
            className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0"
            style={{ backgroundColor: 'var(--hover-bg)', color: 'var(--text-secondary)' }}
          >
            Ур.{profile.level} {profile.vip ? '👑' : ''}
          </div>
        )}
      </div>

      {/* Right: Balance + Actions */}
      <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
        <div className="flex-1 sm:flex-none text-right min-w-0">
          <div className="text-[9px] tracking-widest leading-none" style={{ color: 'var(--text-muted)' }}>БАЛАНС</div>
          <div 
            className="font-mono text-base sm:text-lg font-semibold tabular-nums leading-none truncate"
            style={{ color: 'var(--brand-500)' }}
          >
            {fmt(bal)} <span className="text-[10px] align-super">{CURRENCY}</span>
          </div>
        </div>

        <div className="flex gap-1.5 flex-shrink-0">
          <button
            onClick={refreshProfile}
            className="text-[10px] px-2.5 py-1 border rounded-xl transition-colors hover:brightness-95 active:brightness-90 whitespace-nowrap"
            style={{ 
              borderColor: 'var(--border)',
              backgroundColor: 'var(--card)',
              color: 'var(--text-primary)'
            }}
          >
            Обновить
          </button>
          <button
            onClick={async () => {
              try {
                const res = await api.casinoDailyClaim(token!);
                if (res.bonus) {
                  alert(`Получен бонус +${fmt(res.bonus)} ${CURRENCY} (стрик ${res.streak})`);
                  await refreshProfile();
                }
              } catch (e: any) {
                alert(e.message || 'Бонус уже получен');
              }
            }}
            className="text-[10px] px-2.5 py-1 rounded-xl whitespace-nowrap"
            style={{ 
              backgroundColor: 'color-mix(in srgb, #10b981 15%, var(--card))',
              color: '#166534'
            }}
          >
            🎁 Бонус
          </button>
          {currentGame && (
            <button
              onClick={() => {
                setCurrentGame(null);
                setMinesSession(null);
                setMinesLost(null);
                setMinesOpened([]);
                setMinesMult(1.0);
                setBjSession(null);
                setBjPlayerHands([]);
                setBjDealerCards([]);
                setBjAnimating(false);
                setBjDealerDrawing(false);
                setBjCurrentHandIndex(0);
                setLastResult(null);
                setSpinningSlots(false);
                setSlotReels(['🍒', '🍋', '💎']);
                spinningReelsRef.current = [false, false, false];
                setActiveSpinningReels([false, false, false]);
                setDiceRolling(false);
                setDiceResult(null);
                setRouletteSpinning(false);
                setRouletteResult(null);
                setRouletteBetType('red');
                setRouletteTarget(null);
                setTargetWheelRotation(0);
                setPendingRouletteResult(null);
                setRouletteSpinning(false);
                setRouletteResult(null);
                setRouletteBetType('red');
                setRouletteTarget(null);
                setTargetWheelRotation(0);
                setPendingRouletteResult(null);
                // Coin resets
                setCoinMode('solo');
                setCoinSide('heads');
                setCoinFlipping(false);
                setCoinResult(null);
                setCoinFlipFace('heads');
                setPvpRooms([]);
                setCurrentRoom(null);
                setJoinCode('');
                setPvpMySide(null);
                setPvpFlipping(false);
                setPvpFlipResult(null);
                if (pvpPollRef.current) { clearInterval(pvpPollRef.current); pvpPollRef.current = null; }
                betInitializedRef.current = false; // allow last_bet re-init on re-entry

                // reset slots reel controls
                reelControls.forEach((c) => {
                  c.stop();
                  c.set({ y: 0 });
                });
              }}
              className="text-[10px] px-2 py-1 border rounded-xl whitespace-nowrap"
              style={{ 
                borderColor: 'color-mix(in srgb, #ef4444 30%, var(--border))',
                color: '#b91c1c'
              }}
            >
              ← Лобби
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-full max-w-6xl mx-auto px-3 sm:px-4 py-5 sm:py-6 overflow-x-hidden">
      <BalanceHeader />

     {/* Bet selector - only for actual games, not economy pages. Hide for active coin pvp room (bet is locked). */}
      {['slots', 'mines', 'blackjack', 'dice', 'roulette', 'coin', 'plinko'].includes(currentGame) &&
        !(currentGame === 'coin' && coinMode === 'pvp' && currentRoom) && (
        <div className="bg-white border rounded-3xl p-4 mb-6 flex flex-wrap items-center gap-3" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
          <div className="font-medium mr-2">Ставка:</div>
          <div className="flex gap-2 flex-wrap">
            {QUICK_BETS.map(q => (
              <button key={q} onClick={() => setQuickBet(q)} className="px-3 py-1.5 rounded-xl border text-sm hover:bg-slate-50 active:bg-slate-100">{fmt(q)}</button>
            ))}
            <button onClick={doVabank} className="px-3 py-1.5 rounded-xl bg-amber-100 text-amber-800 text-sm font-medium">ВАБАНК</button>
          </div>
          <input
            type="number"
            value={bet}
            onChange={e => {
              const raw = e.target.value;
              if (raw === '') {
                setBet(MIN_BET);
                return;
              }
              const num = parseInt(raw, 10);
              if (!isNaN(num)) {
                setBet(Math.min(bal, num)); // allow values below MIN_BET while typing
              }
            }}
            onBlur={() => {
              if (bet < MIN_BET) {
                setBet(MIN_BET);
              }
            }}
            className="ml-auto w-32 sm:w-44 border rounded-2xl px-3 sm:px-4 py-1.5 sm:py-2 font-mono text-base sm:text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <div className="text-xs text-slate-500 w-20 sm:w-24 flex-shrink-0">мин {MIN_BET}</div>
        </div>
      )}

     {/* Dedicated game views or hub — mobile safe */}
      {currentGame ? (
        <div className="pb-8 w-full max-w-full overflow-x-hidden">
          {currentGame && !['slots', 'mines', 'blackjack', 'dice', 'roulette', 'coin', 'plinko'].includes(currentGame) && (
            <div className="w-full max-w-md mx-auto text-center py-12">
              <div className="text-7xl mb-4">🚧</div>
              <div className="text-3xl font-bold mb-3">В разработке!</div>
              <p className="text-sm opacity-70 mb-1">Игра «{currentGame?.toUpperCase()}»</p>
              <p className="text-sm opacity-70">Эта игра находится в разработке и скоро станет доступна.</p>
            </div>
          )}

         {/* MINES — fully restored */}
          {currentGame === 'mines' && (
            <div className="w-full max-w-[680px] mx-auto">
              {/* Header - short */}
              <div className="text-center mb-2">
                <div className="text-6xl">💣</div>
                <div className="text-3xl font-bold">Мины</div>
                <div className="text-xs opacity-60 mt-0.5">5×5 • Не попади на мину</div>
              </div>

              <div
                className="rounded-3xl p-3 sm:p-5 mb-4 border overflow-x-hidden w-full"
                style={{
                  background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)',
                  borderColor: 'var(--game-border)',
                  color: 'var(--game-text)'
                }}
              >
                {/* Live / final stats (compact) */}
                {(minesSession || minesOpened.length > 0 || minesLost) && (
                  <div className="flex items-center justify-between text-xs mb-3 px-1">
                    <div>
                      <span className="opacity-60">МИН</span>{' '}
                      <span className="font-mono text-base">{minesSession ? minesSession.minesCount : minesCount}</span>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] opacity-60 -mb-0.5">МНОЖИТЕЛЬ</div>
                      <div className="font-mono text-3xl font-bold tabular-nums text-emerald-400">x{minesMult.toFixed(2)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] opacity-60 -mb-0.5">ПОТЕНЦИАЛ</div>
                      <div className="font-mono text-xl font-semibold tabular-nums">{fmt(Math.floor(bet * minesMult))}{CURRENCY}</div>
                    </div>
                  </div>
                )}

                {/* Main area: large grid on left + difficulty list on right */}
                <div className="flex flex-col sm:flex-row gap-4">
                  {/* LEFT: Game field (enlarged cells) */}
                  <div className="flex-1 min-w-0">
                    {(minesSession || minesOpened.length > 0 || minesLost) ? (
                      /* 5x5 Grid - bigger cells + overlay for result */
                      <div className="relative">
                        <div className="grid grid-cols-5 gap-2 sm:gap-3">
                          {Array.from({ length: 25 }).map((_, i) => {
                            const opened = minesOpened.includes(i);
                            const isBomb = !!(minesLost?.mines && minesLost.mines.includes(i));
                            const isExploded = opened && isBomb;

                            let cls = 'h-12 sm:h-16 rounded-2xl border flex items-center justify-center text-2xl sm:text-3xl transition-all active:scale-[0.92] select-none ';
                            let content: React.ReactNode = '';

                            if (opened) {
                              if (isExploded) {
                                cls += 'bg-red-600 border-red-400 shadow-inner';
                                content = '💥';
                              } else {
                                cls += 'bg-emerald-500/90 border-emerald-300';
                                content = '💎';
                              }
                            } else if (minesLost && isBomb) {
                              cls += 'bg-red-900/70 border-red-500/70';
                              content = '💣';
                            } else {
                              cls += 'bg-slate-800 border-slate-600 hover:border-slate-400 hover:bg-slate-700';
                              content = minesSession ? <span className="text-slate-500 text-xl">⬜</span> : '';
                            }

                            const canClick = !!minesSession && !opened && !minesLost;

                            return (
                              <motion.button
                                key={i}
                                whileTap={canClick ? { scale: 0.85 } : {}}
                                onClick={() => canClick && mineOpen(i)}
                                disabled={!canClick}
                                className={cls}
                              >
                                {content}
                              </motion.button>
                            );
                          })}
                        </div>

                        {/* Overlay result directly on the field */}
                        {lastResult?.game === 'mines' && !minesSession && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 rounded-3xl">
                            <div className="bg-[#0f1a2e] border border-white/10 rounded-2xl p-5 text-center max-w-[240px] shadow-2xl">
                              <div className={`text-xl font-bold mb-0.5 ${lastResult.busted ? 'text-red-400' : 'text-emerald-400'}`}>
                                {lastResult.busted ? '💥 ПРОИГРЫШ' : '✅ ВЫИГРЫШ'}
                              </div>
                              <div className={`text-3xl font-mono font-bold tabular-nums ${lastResult.busted ? 'text-red-400' : 'text-emerald-400'}`}>
                                {lastResult.busted
                                  ? `−${fmt(lastResult.bet || bet)}`
                                  : `+${fmt(lastResult.win || 0)}`}
                                <span className="text-base align-super ml-0.5">{CURRENCY}</span>
                              </div>
                              <div className="text-xs opacity-70 mt-0.5">
                                Множитель x{(lastResult.mult || minesMult || 1).toFixed(2)}
                              </div>

                              <div className="mt-4 grid grid-cols-2 gap-2">
                                <button
                                  onClick={() => startMines()}
                                  className="py-2.5 rounded-xl font-semibold text-sm active:scale-[0.985]"
                                  style={{ background: 'var(--brand-gradient)' }}
                                >
                                  🔄 Играть снова
                                </button>
                                <button
                                  onClick={() => setLastResult(null)}
                                  className="py-2.5 rounded-xl font-medium text-sm border border-white/20 hover:bg-white/5 active:bg-white/10"
                                >
                                  Изменить ставку
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Pre-start: big start button (when no board yet) */
                      <button
                        onClick={startMines}
                        disabled={bet < MIN_BET}
                        className="w-full h-40 sm:h-48 rounded-2xl text-white font-bold text-xl active:scale-[0.985] disabled:opacity-70 flex items-center justify-center"
                        style={{ background: 'var(--brand-gradient)' }}
                      >
                        💣 НАЧАТЬ ИГРУ • {fmt(bet)}
                      </button>
                    )}
                  </div>

                  {/* RIGHT: Difficulty list (vertical, bigger icons + font for readability) */}
                  {!minesSession && (
                    <div className="w-24 flex-shrink-0 flex flex-col gap-3">
                      <div className="text-[10px] text-center opacity-60 tracking-wider">МИНЫ</div>
                      {[3,5,10,15].map(n => {
                        const icon = n === 3 ? '🟢' : n === 5 ? '🟡' : n === 10 ? '🟠' : '🔴';
                        return (
                          <button
                            key={n}
                            onClick={() => setMinesCount(n)}
                            className={`flex flex-col items-center justify-center py-3.5 rounded-2xl border transition active:scale-[0.97] ${minesCount === n ? 'border-red-400 bg-red-500/10 ring-1 ring-red-400/40 scale-[1.02]' : 'border-white/15 hover:bg-white/5'}`}
                          >
                            <div className="text-4xl leading-none">{icon}</div>
                            <div className="font-mono text-2xl font-bold tabular-nums mt-0.5">{n}</div>
                            <div className="text-xs opacity-60 -mt-0.5">мин</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Cashout (only during active session) */}
                {minesSession && (
                  <button
                    onClick={minesCash}
                    disabled={minesOpened.length === 0}
                    className="w-full mt-4 py-3.5 rounded-2xl font-bold text-lg disabled:opacity-50 active:scale-[0.985] shadow-sm"
                    style={{ background: '#10b981' }}
                  >
                    💰 ЗАБРАТЬ {fmt(Math.floor(bet * minesMult))} {CURRENCY}
                  </button>
                )}

                {/* After round "Играть снова" — only when overlay is dismissed (change bet was chosen) */}
                {!minesSession && (minesOpened.length > 0 || minesLost) && !(lastResult?.game === 'mines') && (
                  <button
                    onClick={() => startMines()}
                    className="w-full mt-4 py-3 rounded-2xl font-semibold text-base active:scale-[0.985]"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    🔄 Играть снова • {fmt(bet)}
                  </button>
                )}

                {/* Minimal footer */}
                <div className="text-[10px] text-center mt-3 opacity-50">
                  Открывай клетки. Ошибёшься — проиграешь.
                </div>
              </div>
            </div>
          )}

         {/* BLACKJACK - full with Split, Double, dealing animations */}
          {currentGame === 'blackjack' && (
            <div className="w-full max-w-[680px] mx-auto">
              {/* Header - cleaner */}
              <div className="text-center mb-3">
                <div className="text-5xl">🃏</div>
                <div className="text-3xl font-bold tracking-tight">Блэкджек</div>
                <div className="text-sm opacity-60 mt-0.5">Сплит • Дабл • Natural x1.5</div>
              </div>

              {/* Felt table - theme adaptive + relative for overlay result */}
              <div
                className="rounded-3xl p-6 mb-4 border relative"
                style={{
                  background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)',
                  borderColor: 'var(--game-border)',
                  color: 'var(--game-text)'
                }}
              >
                {/* Bet reminder */}
                <div className="text-center mb-4">
                  <span className="text-xs opacity-60">СТАВКА</span>
                  <div className="text-2xl font-mono font-bold tabular-nums">{fmt(bet)}{CURRENCY}</div>
                </div>

                {/* Dealer - clear section */}
                <div className="mb-5">
                  <div className="uppercase tracking-[1.5px] text-xs font-semibold mb-1.5 flex items-center gap-2 opacity-80">
                    ДИЛЕР
                    {bjDealerCards.length > 0 && (
                      <span className="font-mono text-base bg-[var(--game-chip)] px-2 py-0.5 rounded text-[var(--game-text)]">
                        {handValue(bjDealerCards)}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-3 min-h-[82px] items-center rounded-2xl p-3" style={{ background: 'var(--game-sub-bg)' }}>
                    {bjDealerCards.length === 0 ? (
                      <div className="text-sm opacity-60 px-2">Карты дилера появятся после раздачи</div>
                    ) : (
                      bjDealerCards.map((c, i) => renderBJCard(c, `dealer-${i}`))
                    )}
                  </div>
                </div>

                {/* Player hands - more intuitive */}
                <div>
                  <div className="uppercase tracking-[1.5px] text-xs font-semibold mb-2 opacity-80">ВАШИ РУКИ</div>

                  {bjPlayerHands.length === 0 ? (
                    <div className="text-sm opacity-60 py-4 px-3 rounded-2xl text-center" style={{ background: 'var(--game-sub-bg)' }}>
                      Нажмите «Начать раздачу», чтобы получить карты
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {bjPlayerHands.map((hand: any, idx: number) => {
                        const val = handValue(hand.cards || []);
                        const isActive = !!bjSession && idx === bjCurrentHandIndex;
                        const finished = hand.stood || hand.busted;
                        const isBust = hand.busted;
                        const isStood = hand.stood && !hand.busted;
                        return (
                          <div
                            key={idx}
                            className={`rounded-2xl border p-4 transition ${isActive ? 'border-violet-400 ring-2 ring-violet-400/40' : 'border-white/15'}`} style={{ background: isActive ? 'var(--game-chip)' : 'var(--game-chip)' }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold">Рука {idx + 1}</span>
                                {isActive && !finished && (
                                  <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/30 text-violet-300 font-medium">ТЕКУЩАЯ</span>
                                )}
                              </div>
                              <span className="font-mono text-sm tabular-nums">{fmt(hand.bet || bet)}{CURRENCY}</span>
                            </div>

                            <div className="flex gap-2 mb-2 flex-wrap min-h-[60px]">
                              {(hand.cards || []).map((c: any, ci: number) =>
                                renderBJCard(c, `p${idx}-${ci}`)
                              )}
                            </div>

                            <div className={`font-mono text-3xl tabular-nums font-bold tracking-tighter ${isBust ? 'text-red-400' : isStood ? 'text-emerald-400' : ''}`}>
                              {val}
                            </div>

                            <div className="flex gap-2 mt-1.5">
                              {isBust && <div className="text-xs px-2.5 py-0.5 rounded bg-red-500/20 text-red-400 font-semibold">ПЕРЕБОР</div>}
                              {isStood && <div className="text-xs px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-semibold">СТОП</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Result notification - pops up DIRECTLY over the playing field */}
                <AnimatePresence>
                  {lastResult?.game === 'blackjack' && !bjSession && (
                    <div className="absolute inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 rounded-3xl">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.92, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96, y: 10 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                        className="w-full max-w-[340px] rounded-3xl border p-5 shadow-2xl"
                        style={{
                          background: (() => {
                            const credited = lastResult.totalWin ?? lastResult.win ?? 0;
                            const playerHands = lastResult.playerHands || [];
                            const totalStaked = playerHands.reduce((s, h) => s + (h.bet || 0), 0) || (lastResult.bet || 0);
                            const net = credited - totalStaked;
                            if (net > 0) return 'linear-gradient(145deg, rgba(16,185,129,0.18), rgba(16,185,129,0.06))';
                            if (net < 0) return 'linear-gradient(145deg, rgba(239,68,68,0.18), rgba(239,68,68,0.06))';
                            return 'linear-gradient(145deg, rgba(148,163,184,0.14), rgba(148,163,184,0.04))';
                          })(),
                          borderColor: (() => {
                            const credited = lastResult.totalWin ?? lastResult.win ?? 0;
                            const playerHands = lastResult.playerHands || [];
                            const totalStaked = playerHands.reduce((s, h) => s + (h.bet || 0), 0) || (lastResult.bet || 0);
                            const net = credited - totalStaked;
                            if (net > 0) return '#166534';
                            if (net < 0) return '#7f1d1d';
                            return '#475569';
                          })()
                        }}
                      >
                        {(() => {
                          const credited = lastResult.totalWin ?? lastResult.win ?? 0;
                          const playerHands = lastResult.playerHands || [];
                          const totalStaked = playerHands.reduce((s, h) => s + (h.bet || 0), 0) || (lastResult.bet || 0);
                          const net = credited - totalStaked;
                          const isWin = net > 0;
                          const isLoss = net < 0;
                          const isPush = net === 0;
                          const amountStr = isWin ? `+${fmt(net)}` : isLoss ? `${fmt(net)}` : '0 (ставка возвращена)';
                          const title = lastResult.natural ? '🎉 БЛЭКДЖЕК!' : isWin ? 'ПОБЕДА' : isLoss ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ';

                          return (
                            <div className="text-center">
                              <div className="text-xs uppercase tracking-[1.5px] opacity-60 mb-1">Результат</div>
                              <div className={`text-2xl font-bold mb-1 ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-slate-300'}`}>
                                {title}
                              </div>
                              <div className={`text-3xl font-mono tabular-nums font-semibold mb-3 ${isWin ? 'text-emerald-400' : isLoss ? 'text-red-400' : 'text-slate-300'}`}>
                                {amountStr} {CURRENCY}
                              </div>

                              {lastResult.payout && (
                                <div className="text-xs mb-2 opacity-70">Выплата x{lastResult.payout}</div>
                              )}

                              {Array.isArray(lastResult.handResults) && lastResult.handResults.length > 1 && (
                                <div className="text-[11px] opacity-70 mb-2">Несколько рук • итог по всем</div>
                              )}

                              {Array.isArray(lastResult.handResults) && lastResult.handResults.length > 0 && (
                                <div className="text-[11px] opacity-70 mb-3 space-y-0.5">
                                  {lastResult.handResults.map((hr: any, i: number) => (
                                    <div key={i}>Рука {i+1}: {hr.status || ''} {hr.win != null ? `(${hr.win >= 0 ? '+' : ''}${fmt(hr.win - (hr.bet||0))})` : ''}</div>
                                  ))}
                                </div>
                              )}

                              <div className="flex gap-2 justify-center">
                                <button
                                  onClick={() => setLastResult(null)}
                                  className="text-sm px-4 py-2 rounded-xl border active:scale-[0.985]"
                                  style={{ 
                                    borderColor: 'var(--game-border)', 
                                    color: 'var(--game-text)',
                                    background: 'var(--game-chip)'
                                  }}
                                >
                                  Закрыть
                                </button>
                                <button
                                  onClick={() => {
                                    const rb = lastResult?.bet || (lastResult?.playerHands?.[0]?.bet) || bet;
                                    setBet(rb);
                                    startBJ(rb);
                                  }}
                                  className="text-sm px-4 py-2 rounded-xl border border-emerald-400/60 active:scale-[0.985]"
                                  style={{ 
                                    color: 'var(--game-text)',
                                    background: 'rgba(16,185,129,0.15)'
                                  }}
                                >
                                  🔄 Играть ещё
                                </button>
                              </div>
                            </div>
                          );
                        })()}
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Action buttons - clearer and larger */}
              <div className="space-y-3">
                {!bjSession ? (
                  <button
                    onClick={() => startBJ()}
                    disabled={bjAnimating || bet < MIN_BET}
                    className="w-full py-4 text-xl rounded-2xl text-white font-bold active:scale-[0.985] disabled:opacity-70 shadow"
                    style={{ background: 'var(--brand-gradient)' }}
                  >
                    {bjAnimating ? 'РАЗДАЁМ...' : `🃏 НАЧАТЬ РАЗДАЧУ • ${fmt(bet)}`}
                  </button>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {(() => {
                      const ch = bjPlayerHands[bjCurrentHandIndex] || {};
                      const chCards = ch.cards || [];
                      const finished = ch.stood || ch.busted;
                      const currentBal = profile?.balance || 0;
                      const handBet = ch.bet || bet;
                      const canDbl = chCards.length === 2 && !finished && currentBal >= handBet;
                      const baseForSplit = bjSession?.bet || bet;
                      const canSpl = chCards.length === 2 && ranksEqual(chCards[0], chCards[1]) && !finished && currentBal >= baseForSplit;
                      return (
                        <>
                          <button
                            onClick={bjHit}
                            disabled={bjAnimating || finished}
                            className="py-4 rounded-2xl text-white font-bold text-lg active:scale-[0.985] disabled:opacity-50"
                            style={{ background: '#16a34a' }}
                          >
                            🃏 ВЗЯТЬ ЕЩЁ
                          </button>
                          <button
                            onClick={bjStand}
                            disabled={bjAnimating || finished}
                            className="py-4 rounded-2xl text-white font-bold text-lg active:scale-[0.985] disabled:opacity-50"
                            style={{ background: '#dc2626' }}
                          >
                            ✋ СТОЯТЬ
                          </button>
                          <button
                            onClick={bjDouble}
                            disabled={bjAnimating || !canDbl}
                            className="py-3.5 rounded-2xl font-semibold active:scale-[0.985] disabled:opacity-60 border"
                            style={{ 
                              background: canDbl ? 'rgba(245,158,11,0.85)' : 'var(--card)', 
                              color: canDbl ? 'white' : 'var(--game-text)',
                              borderColor: canDbl ? 'transparent' : 'var(--game-border)'
                            }}
                          >
                            ⬆️ УДВОИТЬ<br /><span className="text-xs opacity-70">+{fmt(handBet)}</span>
                          </button>
                          <button
                            onClick={bjSplit}
                            disabled={bjAnimating || !canSpl}
                            className="py-3.5 rounded-2xl font-semibold active:scale-[0.985] disabled:opacity-60 border"
                            style={{ 
                              background: canSpl ? '#7c3aed' : 'var(--card)', 
                              color: canSpl ? 'white' : 'var(--game-text)',
                              borderColor: canSpl ? 'transparent' : 'var(--game-border)'
                            }}
                          >
                            ✂️ РАЗДЕЛИТЬ<br /><span className="text-xs opacity-70">+{fmt(baseForSplit)}</span>
                          </button>
                        </>
                      );
                    })()}
                  </div>
                )}

                <button
                  onClick={() => setCurrentGame(null)}
                  className="w-full py-2 text-sm rounded-2xl opacity-50 hover:opacity-80 active:opacity-100"
                >
                  ← Выйти в меню игр
                </button>
              </div>

              <div className="text-[10px] text-center mt-2 opacity-40">
                Ставка списывается сразу. Natural (А+10) платит 3:2.
              </div>
            </div>
          )}

          {/* ====================== МОНЕТКА — полностью переработанная, интуитивная + анимации + PvP комнаты ====================== */}
          {currentGame === 'coin' && (
            <div className="w-full max-w-[680px] mx-auto">
              {/* Header */}
              <div className="text-center mb-4">
                <div className="text-7xl mb-1">🪙</div>
                <div className="text-3xl font-bold tracking-tight">Монетка</div>
                <div className="text-sm opacity-60 mt-0.5">Классика. x2 при совпадении. Честный 50/50.</div>
              </div>

              {/* Mode switch — максимально понятный */}
              <div className="flex gap-2 mb-5 justify-center">
                <button
                  onClick={() => { setCoinMode('solo'); clearPvp(); }}
                  className={`px-6 py-2.5 rounded-2xl text-sm font-semibold transition active:scale-[0.985] ${coinMode === 'solo' ? 'text-white' : 'border'}`}
                  style={coinMode === 'solo' ? { background: 'var(--brand-gradient)' } : { borderColor: 'var(--border)', background: 'var(--card)' }}
                >
                  ⚡ Быстрая игра
                </button>
                <button
                  onClick={() => { setCoinMode('pvp'); setCoinResult(null); }}
                  className={`px-6 py-2.5 rounded-2xl text-sm font-semibold transition active:scale-[0.985] ${coinMode === 'pvp' ? 'text-white' : 'border'}`}
                  style={coinMode === 'pvp' ? { background: 'var(--brand-gradient)' } : { borderColor: 'var(--border)', background: 'var(--card)' }}
                >
                  ⚔️ Онлайн дуэли (PvP)
                </button>
              </div>

              {/* ========== SOLO ========== */}
              {coinMode === 'solo' && (
                <div>
                  {/* The beautiful coin + controls */}
                  <div
                    className="rounded-3xl p-6 border mb-4"
                    style={{ background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)', borderColor: 'var(--game-border)' }}
                  >
                    {/* Centered coin area */}
                    <div className="flex justify-center py-4">
                      <CoinFlip
                        isFlipping={coinFlipping}
                        finalFace={coinResult ? coinResult.result : coinFlipFace}
                        onFlipComplete={() => {
                          // nothing — result already shown below
                        }}
                      />
                    </div>

                    {/* Side choice — large, clear, two columns */}
                    <div className="mt-1 mb-4">
                      <div className="text-[11px] tracking-[1px] opacity-60 text-center mb-2">ВЫБЕРИТЕ СТОРОНУ</div>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setCoinSide('heads')}
                          disabled={coinFlipping}
                          className={`group py-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 active:scale-[0.985] transition ${coinSide === 'heads' ? 'border-yellow-400 ring-2 ring-yellow-400/30 scale-[1.01]' : 'border-white/20 hover:border-white/40'}`}
                          style={{ background: coinSide === 'heads' ? 'rgba(250,204,21,0.12)' : 'var(--game-sub-bg)' }}
                        >
                          <div className="text-5xl">🪙</div>
                          <div className="font-bold text-xl tracking-tight">ОРЁЛ</div>
                          <div className="text-[10px] opacity-60 -mt-0.5">heads</div>
                        </button>
                        <button
                          onClick={() => setCoinSide('tails')}
                          disabled={coinFlipping}
                          className={`group py-4 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 active:scale-[0.985] transition ${coinSide === 'tails' ? 'border-yellow-400 ring-2 ring-yellow-400/30 scale-[1.01]' : 'border-white/20 hover:border-white/40'}`}
                          style={{ background: coinSide === 'tails' ? 'rgba(250,204,21,0.12)' : 'var(--game-sub-bg)' }}
                        >
                          <div className="text-5xl rotate-180">🪙</div>
                          <div className="font-bold text-xl tracking-tight">РЕШКА</div>
                          <div className="text-[10px] opacity-60 -mt-0.5">tails</div>
                        </button>
                      </div>
                    </div>

                    {/* Big action */}
                    <button
                      onClick={async () => {
                        if (coinFlipping || !profile) return;
                        if (bet < MIN_BET) { alert('Мин. ставка ' + MIN_BET); return; }
                        if (bet > (profile.balance || 0)) { alert('Недостаточно средств'); return; }

                        setCoinResult(null);
                        setCoinFlipping(true);
                        setCoinFlipFace(Math.random() < 0.5 ? 'heads' : 'tails');

                        try {
                          const res = await api.playCoin(bet, coinSide, token!);
                          // server returns { result, side, win, bet, balance }
                          // drive the animation to the real result after a satisfying delay
                          const target = res.result as 'heads' | 'tails';
                          // let the flip spin for a bit (CoinFlip internally handles timing)
                          setTimeout(() => {
                            setCoinFlipFace(target);
                            setCoinResult({ result: target, win: res.win || 0, bet: res.bet || bet, side: res.side });
                            setCoinFlipping(false);
                            refreshProfile();
                          }, 820);
                        } catch (e: any) {
                          setCoinFlipping(false);
                          alert(e.message || 'Ошибка');
                        }
                      }}
                      disabled={coinFlipping || bet < MIN_BET}
                      className="w-full py-4 rounded-2xl text-white font-bold text-lg active:scale-[0.985] disabled:opacity-60 shadow"
                      style={{ background: 'var(--brand-gradient)' }}
                    >
                      {coinFlipping ? 'ПОДБРАСЫВАЕМ...' : `ПОДБРОСИТЬ • ${fmt(bet)} ${CURRENCY}`}
                    </button>

                    <div className="text-center text-[10px] mt-2 opacity-50">Ставка списывается сразу. При победе ×2.</div>
                  </div>

                  {/* Result banner — super clear */}
                  {coinResult && !coinFlipping && (
                    <div className={`mb-4 rounded-3xl p-5 border text-center ${coinResult.win > 0 ? 'bg-emerald-900/30 border-emerald-600/40' : 'bg-red-900/20 border-red-600/30'}`}>
                      <div className="text-xs tracking-widest opacity-70 mb-0.5">ВЫПАЛО</div>
                      <div className="text-4xl font-bold mb-1 tracking-[-1px]">
                        {coinResult.result === 'heads' ? 'ОРЁЛ' : 'РЕШКА'}
                      </div>
                      <div className={`text-2xl font-mono tabular-nums font-semibold ${coinResult.win > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {coinResult.win > 0 ? `+${fmt(coinResult.win)}` : `−${fmt(coinResult.bet)}`} {CURRENCY}
                      </div>
                      <div className="mt-3 text-sm opacity-80">
                        {coinResult.win > 0 ? '✅ Вы угадали! Выигрыш x2' : '❌ Не угадали'}
                      </div>

                      <div className="mt-4 flex gap-2 justify-center">
                        <button
                          onClick={() => {
                            setCoinResult(null);
                            // keep last side for fast replay
                          }}
                          className="px-5 py-2 rounded-2xl text-sm border active:scale-[0.985]"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          Изменить ставку
                        </button>
                        <button
                          onClick={() => {
                            // quick replay same side + current bet
                            // trigger same flow
                            const doReplay = async () => {
                              if (!profile || bet > (profile.balance || 0)) return;
                              setCoinResult(null);
                              setCoinFlipping(true);
                              setCoinFlipFace(Math.random() < 0.5 ? 'heads' : 'tails');
                              try {
                                const res = await api.playCoin(bet, coinSide, token!);
                                const target = res.result as 'heads' | 'tails';
                                setTimeout(() => {
                                  setCoinFlipFace(target);
                                  setCoinResult({ result: target, win: res.win || 0, bet: res.bet || bet, side: res.side });
                                  setCoinFlipping(false);
                                  refreshProfile();
                                }, 820);
                              } catch (e: any) { setCoinFlipping(false); alert(e.message); }
                            };
                            doReplay();
                          }}
                          className="px-6 py-2 rounded-2xl text-sm font-semibold active:scale-[0.985] text-white"
                          style={{ background: 'var(--brand-gradient)' }}
                        >
                          🔄 Сыграть ещё ({fmt(bet)})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ========== PVP (онлайн комнаты) ========== */}
              {coinMode === 'pvp' && (
                <div className="space-y-4">
                  {!currentRoom ? (
                    <>
                      {/* Create room */}
                      <div className="rounded-3xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                        <div className="font-semibold mb-3 flex items-center gap-2">➕ Создать комнату</div>

                        <div className="text-xs opacity-60 mb-1.5">Ставка</div>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {QUICK_BETS.map(q => (
                            <button key={q} onClick={() => setQuickBet(q)} className="px-3 py-1 rounded-xl border text-sm active:scale-[0.98]">{fmt(q)}</button>
                          ))}
                          <button onClick={doVabank} className="px-3 py-1 rounded-xl bg-amber-200 text-amber-900 text-sm font-medium">ВАБАНК</button>
                        </div>

                        <div className="text-xs opacity-60 mb-1.5">Ваша сторона (зафиксируется при создании)</div>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          {(['heads','tails'] as const).map(s => (
                            <button
                              key={s}
                              onClick={() => setCoinSide(s)}
                              className={`py-3 rounded-2xl border-2 font-semibold active:scale-[0.985] ${coinSide === s ? 'border-yellow-400 ring-1 ring-yellow-400/40' : 'border-white/15'}`}
                              style={{ background: coinSide === s ? 'rgba(245,158,11,0.12)' : 'transparent' }}
                            >
                              {s === 'heads' ? '🪙 ОРЁЛ' : '🪙 РЕШКА'}
                            </button>
                          ))}
                        </div>

                        <button
                          onClick={async () => {
                            if (!token || !profile) return;
                            if (bet < MIN_BET) return alert('Мин ставка ' + MIN_BET);
                            if (bet > profile.balance) return alert('Недостаточно');
                            try {
                              const r = await api.coinPvpCreate(bet, coinSide, token);
                              setCurrentRoom(r);
                              setPvpFlipResult(null);
                              setPvpMySide(coinSide);
                              // start polling
                              startPvpPolling(r.room_id);
                            } catch (e: any) { alert(e.message); }
                          }}
                          disabled={bet < MIN_BET}
                          className="w-full py-3.5 rounded-2xl font-bold text-lg active:scale-[0.985] disabled:opacity-60"
                          style={{ background: 'var(--brand-gradient)' }}
                        >
                          СОЗДАТЬ КОМНАТУ • {fmt(bet)} {CURRENCY}
                        </button>
                        <div className="text-[10px] text-center mt-2 opacity-50">Соперник выбирает свою сторону. 5% комиссии при выигрыше.</div>
                      </div>

                      {/* Join by code + list */}
                      <div className="rounded-3xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
                        <div className="font-semibold mb-2">Присоединиться к комнате</div>

                        <div className="flex gap-2 mb-3">
                          <input
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value.toUpperCase().trim())}
                            placeholder="Код комнаты, напр. 12345"
                            className="flex-1 border rounded-2xl px-4 py-2.5 font-mono text-lg tracking-widest"
                            style={{ background: 'var(--input-bg)' }}
                          />
                          <button
                            onClick={async () => {
                              if (!joinCode || !token) return;
                              try {
                                const r = await api.coinPvpJoin(joinCode, token);
                                setCurrentRoom(r);
                                setJoinCode('');
                                setPvpFlipResult(null);
                                setPvpMySide(null);
                                startPvpPolling(r.room_id);
                              } catch (e: any) { alert(e.message); }
                            }}
                            className="px-6 rounded-2xl font-semibold active:scale-[0.985]"
                            style={{ background: 'var(--brand-gradient)', color: 'white' }}
                          >
                            ВОЙТИ
                          </button>
                        </div>

                        <div className="text-xs opacity-60 mb-2">Или выберите из списка открытых комнат</div>
                        <button
                          onClick={loadPvpRooms}
                          className="text-sm px-4 py-1.5 rounded-xl border mb-2 active:bg-white/5"
                        >
                          🔄 Обновить список
                        </button>

                        <div className="space-y-2 max-h-[260px] overflow-auto pr-1">
                          {pvpRooms.length === 0 && (
                            <div className="text-sm opacity-60 py-6 text-center border rounded-2xl">Открытых комнат пока нет. Создайте свою!</div>
                          )}
                          {pvpRooms.map((rm: any) => (
                            <button
                              key={rm.room_id}
                              onClick={async () => {
                                try {
                                  const r = await api.coinPvpJoin(rm.room_id, token!);
                                  setCurrentRoom(r);
                                  setPvpFlipResult(null);
                                  setPvpMySide(null);
                                  startPvpPolling(rm.room_id);
                                } catch (e: any) { alert(e.message); }
                              }}
                              className="w-full text-left p-3 rounded-2xl border flex items-center justify-between hover:bg-white/5 active:bg-white/10"
                              style={{ borderColor: 'var(--border)' }}
                            >
                              <div>
                                <span className="font-mono font-semibold tracking-wider">#{rm.room_id}</span>
                                <span className="ml-2 text-sm opacity-70">• {fmt(rm.bet)} {CURRENCY}</span>
                                {rm.p1 && <span className="ml-2 text-xs opacity-60">от {rm.p1.name}</span>}
                              </div>
                              <div className="text-emerald-400 text-sm font-medium">Вступить →</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    /* INSIDE A ROOM — very clear status + actions */
                    <div className="rounded-3xl border p-5" style={{ background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)', borderColor: 'var(--game-border)' }}>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <div className="text-xs opacity-60">КОМНАТА</div>
                          <div className="flex items-center gap-2">
                            <div className="font-mono text-3xl font-bold tracking-[3px] -ml-0.5">#{currentRoom.room_id}</div>
                            <button
                              onClick={() => { navigator.clipboard?.writeText(currentRoom.room_id); alert('Код скопирован'); }}
                              className="text-xs px-2 py-0.5 rounded border opacity-70 active:opacity-100"
                              title="Скопировать код"
                            >
                              📋
                            </button>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs opacity-60">СТАВКА</div>
                          <div className="text-2xl font-mono font-semibold tabular-nums">{fmt(currentRoom.bet)}{CURRENCY}</div>
                        </div>
                      </div>

                      {/* Players */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                        {/* You / P1 */}
                        <div className="rounded-2xl p-3 border" style={{ background: 'var(--game-sub-bg)', borderColor: 'var(--game-border)' }}>
                          <div className="text-xs opacity-60 mb-1">ВЫ</div>
                          <div className="font-semibold">{currentRoom.p1?.name || 'Вы'}</div>
                          {currentRoom.p1_choice || pvpMySide ? (
                            <div className="mt-1 inline-block px-3 py-0.5 rounded-full text-sm bg-yellow-400/20 text-yellow-300 font-medium">
                              {((currentRoom.p1_choice || pvpMySide) === 'heads' ? '🪙 ОРЁЛ' : '🪙 РЕШКА')}
                            </div>
                          ) : (
                            <div className="text-xs text-amber-400 mt-1">Выберите сторону ниже</div>
                          )}
                        </div>

                        {/* Opponent */}
                        <div className="rounded-2xl p-3 border" style={{ background: 'var(--game-sub-bg)', borderColor: 'var(--game-border)' }}>
                          <div className="text-xs opacity-60 mb-1">СОПЕРНИК</div>
                          {currentRoom.p2 ? (
                            <>
                              <div className="font-semibold">{currentRoom.p2.name}</div>
                              {currentRoom.p2_choice ? (
                                <div className="mt-1 inline-block px-3 py-0.5 rounded-full text-sm bg-yellow-400/20 text-yellow-300 font-medium">
                                  {currentRoom.p2_choice === 'heads' ? '🪙 ОРЁЛ' : '🪙 РЕШКА'}
                                </div>
                              ) : (
                                <div className="text-xs opacity-60 mt-1">Выбирает сторону…</div>
                              )}
                            </>
                          ) : (
                            <div className="opacity-60">⏳ Ожидание игрока…</div>
                          )}
                        </div>
                      </div>

                      {/* Coin animation area when both ready or during reveal */}
                      {(currentRoom.p1_choice && currentRoom.p2_choice) || pvpFlipResult ? (
                        <div className="my-4 flex justify-center">
                          <CoinFlip
                            isFlipping={pvpFlipping}
                            finalFace={(pvpFlipResult?.flip || (pvpFlipResult?.flip === 'heads' ? 'heads' : 'tails')) as any}
                            size="large"
                          />
                        </div>
                      ) : null}

                      {/* Side choice for the player who hasn't picked yet (usually joiner) */}
                      {currentRoom.status === 'choosing' && !(currentRoom.p1_choice && currentRoom.p2_choice) && !pvpFlipResult && (
                        <div className="mb-4">
                          <div className="text-center text-sm mb-2 opacity-80">Выберите свою сторону</div>
                          <div className="grid grid-cols-2 gap-3">
                            {(['heads','tails'] as const).map(s => (
                              <button
                                key={s}
                                disabled={!!pvpMySide}
                                onClick={async () => {
                                  if (!token) return;
                                  try {
                                    const res = await api.coinPvpChoose(currentRoom.room_id, s, token);
                                    setPvpMySide(s);
                                    if (res.flip) {
                                      // resolved on server
                                      setPvpFlipResult(res);
                                      setPvpFlipping(true);
                                      // let animation play then show final
                                      setTimeout(() => {
                                        setPvpFlipping(false);
                                        refreshProfile();
                                      }, 1100);
                                    } else {
                                      // refresh room state
                                      const fresh = await api.coinPvpRoom(currentRoom.room_id, token);
                                      setCurrentRoom(fresh);
                                    }
                                  } catch (e: any) { alert(e.message); }
                                }}
                                className="py-4 rounded-2xl border-2 font-bold active:scale-[0.985] disabled:opacity-50"
                                style={{ borderColor: pvpMySide === s ? '#facc15' : 'rgba(255,255,255,0.15)' }}
                              >
                                {s === 'heads' ? '🪙 ОРЁЛ' : '🪙 РЕШКА'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Result after flip */}
                      {pvpFlipResult && (
                        <div className="mt-2 mb-4 rounded-2xl p-4 border text-center bg-black/40 border-white/10">
                          <div className="text-xs tracking-[2px] opacity-60">ВЫПАЛО</div>
                          <div className="text-3xl font-bold mb-1">{pvpFlipResult.flip_name}</div>

                          {pvpFlipResult.tie ? (
                            <div className="text-xl font-semibold text-slate-300">🤝 НИЧЬЯ — ставки возвращены</div>
                          ) : (
                            <>
                              <div className={`text-xl font-semibold ${pvpFlipResult.winner_id === (user?.id || 0) ? 'text-emerald-400' : 'text-red-400'}`}>
                                {pvpFlipResult.winner_id === (user?.id || 0) ? '🏆 ВЫ ПОБЕДИЛИ' : '💀 ВЫ ПРОИГРАЛИ'}
                              </div>
                              <div className="font-mono text-2xl tabular-nums mt-0.5">
                                {pvpFlipResult.winner_id === (user?.id || 0) ? `+${fmt(pvpFlipResult.payout || 0)}` : `−${fmt(currentRoom.bet)}`} {CURRENCY}
                              </div>
                              <div className="text-[10px] opacity-60 mt-1">Комиссия дома 5%</div>
                            </>
                          )}

                          <button
                            onClick={() => {
                              exitPvpRoom();
                              loadPvpRooms();
                            }}
                            className="mt-3 px-5 py-2 rounded-xl text-sm font-medium border active:scale-[0.985]"
                          >
                            ← К списку комнат
                          </button>
                        </div>
                      )}

                      {/* Actions footer */}
                      <div className="flex gap-2">
                        {!pvpFlipResult && currentRoom.p1?.id === (user?.id) && !currentRoom.p2 && (
                          <button
                            onClick={async () => {
                              if (!token) return;
                              try {
                                await api.coinPvpCancel(currentRoom.room_id, token);
                                exitPvpRoom();
                              } catch (e: any) { alert(e.message); }
                            }}
                            className="flex-1 py-2.5 rounded-2xl border border-red-400/60 text-red-400 active:bg-red-950/30"
                          >
                            Отменить комнату (вернуть ставку)
                          </button>
                        )}
                        <button
                          onClick={() => { exitPvpRoom(); loadPvpRooms(); }}
                          className="flex-1 py-2.5 rounded-2xl border active:bg-white/5"
                        >
                          Выйти из комнаты
                        </button>
                      </div>

                      <div className="text-[10px] text-center mt-3 opacity-40">
                        Оба игрока выбирают стороны. Если только один угадал — он забирает банк минус 5%.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom hint */}
              <button onClick={() => setCurrentGame(null)} className="w-full mt-3 py-2 text-xs opacity-50 hover:opacity-80">← Вернуться в лобби игр</button>
            </div>
          )}

         {/* PLINKO — spacious board on the left, all controls cleanly on the right */}
          {currentGame === 'plinko' && isButuz && (
            <div className="w-full max-w-[980px] mx-auto">
              <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
                {/* LEFT — big beautiful board */}
                <div className="flex-1 min-w-0">
                  <div className="mb-2 flex items-center gap-2">
                    <div className="text-3xl">🔴</div>
                    <div>
                      <div className="text-3xl font-bold tracking-tight">Плинко</div>
                      <div className="text-[11px] opacity-50 -mt-0.5">реальная физика падения</div>
                    </div>
                  </div>

                  <div className="relative w-full max-w-[620px] mx-auto rounded-3xl border overflow-hidden bg-[#0b111f] shadow-xl" style={{ borderColor: 'var(--border)' }}>
                    <PlinkoBoard
                      risk={plinkoRisk}
                      path={plinkoPath}
                      landed={plinkoLanded}
                      dropping={plinkoDropping}
                      onComplete={handlePlinkoComplete}
                      maxWidth={620}
                    />
                  </div>

                  {/* Compact history under the board (optional glance) */}
                  {plinkoHistory.length > 0 && (
                    <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] uppercase tracking-widest opacity-40 mr-1">последние</span>
                      {plinkoHistory.map((h, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-px rounded-md border tabular-nums"
                          style={{ borderColor: h.multiplier < 1 ? '#f87171' : '#34d399', background: 'var(--card)' }}
                        >
                          x{h.multiplier}
                        </span>
                      ))}
                      <button onClick={clearPlinkoHistory} className="text-[10px] opacity-30 hover:opacity-60 ml-1">очистить</button>
                    </div>
                  )}
                </div>

                {/* RIGHT — all selection + action, clean and compact (full width on mobile) */}
                <div className="w-full lg:w-72 lg:shrink-0 pt-1 space-y-4">
                  {/* Risk */}
                  <div>
                    <div className="text-[10px] font-semibold tracking-widest opacity-50 mb-1.5 px-0.5">РИСК</div>
                    <div className="space-y-1.5">
                      {(['low','medium','high'] as const).map(r => {
                        const active = plinkoRisk === r;
                        const label = r === 'low' ? 'Низкий' : r === 'medium' ? 'Средний' : 'Высокий';
                        return (
                          <button
                            key={r}
                            onClick={() => { if (!plinkoDropping) { setPlinkoRisk(r); resetPlinkoBoard(); } }}
                            disabled={plinkoDropping}
                            className="w-full text-left rounded-2xl border px-3.5 py-2.5 transition active:scale-[0.985] flex items-center justify-between"
                            style={{
                              backgroundColor: active ? (r==='low'?'#052e16':r==='medium'?'#451a03':'#4c1d24') : 'var(--card)',
                              borderColor: active ? (r==='low'?'#4ade80':r==='medium'?'#fbbf24':'#fb7185') : 'var(--border)'
                            }}
                          >
                            <span className="font-semibold">{label}</span>
                            <span className="text-xs opacity-60 tabular-nums">макс x{r === 'low' ? 8 : r === 'high' ? 50 : 29}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Rows */}
                  <div>
                    <div className="text-[10px] font-semibold tracking-widest opacity-50 mb-1.5 px-0.5">РЯДОВ</div>
                    <div className="flex gap-1.5">
                      <div className="flex-1 rounded-2xl py-2 text-sm border font-medium border-white/70 bg-white/5 text-center">
                        9 рядов
                      </div>
                    </div>
                    <div className="text-[10px] opacity-40 mt-1 px-0.5">63 пина • точная спецификация</div>
                  </div>

                  {/* Big drop button */}
                  <button
                    onClick={dropPlinko}
                    disabled={plinkoDropping || !profile || bet > profile.balance}
                    className="w-full py-3.5 text-base font-semibold rounded-3xl active:scale-[0.985] disabled:opacity-60 transition shadow-md"
                    style={{ background: plinkoRisk==='high' ? '#e11d48' : plinkoRisk==='medium' ? '#ca8a04' : '#059669', color: 'white' }}
                  >
                    {plinkoDropping ? 'ЛЕТИТ…' : 'СБРОСИТЬ ШАРИК'}
                  </button>

                  {/* Result */}
                  <AnimatePresence>
                    {plinkoResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-2xl p-3 text-center border"
                        style={{
                          backgroundColor: plinkoResult.profit > 0 ? 'rgba(16,185,129,0.08)' : 'rgba(148,163,184,0.06)',
                          borderColor: plinkoResult.profit > 0 ? '#34d399' : '#64748b'
                        }}
                      >
                        <div className="text-[10px] opacity-60">ВЫИГРЫШ</div>
                        <div className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: plinkoResult.profit > 0 ? '#4ade80' : '#cbd5e1' }}>
                          {plinkoResult.win.toLocaleString('ru-RU')} {CURRENCY}
                        </div>
                        <div className="text-xs opacity-60 mt-0.5">
                          x{plinkoResult.multiplier} • {plinkoResult.profit >= 0 ? `+${plinkoResult.profit.toLocaleString('ru-RU')}` : 'возврат'}
                        </div>

                        <div className="flex gap-2 mt-2.5">
                          <button onClick={repeatPlinko} disabled={plinkoDropping} className="flex-1 py-1.5 text-xs rounded-xl border active:bg-white/5" style={{borderColor:'var(--border)'}}>
                            Ещё раз
                          </button>
                          <button onClick={resetPlinkoBoard} className="px-3 py-1.5 text-xs rounded-xl border opacity-70 active:bg-white/5" style={{borderColor:'var(--border)'}}>
                            Сбросить
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <button onClick={() => setCurrentGame(null)} className="w-full mt-1 py-1 text-xs opacity-40 hover:opacity-70">← в лобби игр</button>
                </div>
              </div>
            </div>
          )}

          {/* SLOTS — dark machine, high-quality vertical reel strips with smooth deceleration */}
          {currentGame === 'slots' && (
            <div className="max-w-md mx-auto">
              <div className="text-center mb-3">
                <div className="text-6xl">🎰</div>
                <div className="text-3xl font-bold">Слоты</div>
                <div className="text-xs opacity-60 mt-0.5">Три в ряд — джекпот! Пара — x1.5</div>
              </div>

              {/* Slot machine body - adapts to theme */}
              <div 
                className="rounded-3xl p-4 mb-4 border shadow-xl"
                style={{
                  background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)',
                  borderColor: 'var(--game-border)'
                }}
              >
                {/* Reel window frame */}
                <div className="flex justify-center gap-3 py-3">
                  {[0, 1, 2].map((i) => {
                    const isActive = spinningSlots || activeSpinningReels[i];
                    return (
                      <div
                        key={i}
                        className="relative rounded-2xl overflow-hidden border-4 shadow-[inset_0_8px_16px_rgba(0,0,0,0.75),0_0_0_1px_rgba(255,255,255,0.06)]"
                        style={{
                          width: REEL_HEIGHT,
                          height: REEL_HEIGHT,
                          background: 'linear-gradient(180deg, var(--game-felt) 0%, var(--game-felt2) 100%)',
                          borderColor: isActive ? '#475569' : '#1e2937'
                        }}
                      >
                        {/* The scrolling symbol strip */}
                        <motion.div
                          className="flex flex-col items-center text-[64px] leading-none select-none"
                          style={{ willChange: 'transform' }}
                          animate={reelControls[i]}
                        >
                          {reelTape.map((sym, j) => (
                            <div
                              key={j}
                              style={{ height: REEL_HEIGHT, minHeight: REEL_HEIGHT }}
                              className="flex items-center justify-center w-full"
                            >
                              {/* Inner centered box so the fruit glyph sits visually dead-center in the reel window */}
                              <div className="flex items-center justify-center" style={{ width: 74, height: 74 }}>
                                {sym}
                              </div>
                            </div>
                          ))}
                        </motion.div>

                        {/* subtle glass/highlight overlay on the reel window */}
                        <div 
                          className="pointer-events-none absolute inset-0 rounded-2xl"
                          style={{
                            background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.015) 28%, rgba(0,0,0,0.25) 72%, rgba(0,0,0,0.45) 100%)'
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                <div className="mt-1 flex justify-center gap-x-4 text-[10px] opacity-60">
                  <span>3× = ДжЕКПОТ (x2–x50)</span>
                  <span>•</span>
                  <span>2× = x1.5</span>
                </div>
              </div>

              {/* Last spin result */}
              {lastResult?.game === 'slots' && !spinningSlots && (
                <div className="mb-4 text-center">
                  <div className={`text-base font-semibold ${ (lastResult.win || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {lastResult.status}
                  </div>
                  <div className={`text-3xl font-mono tabular-nums font-bold mt-0.5 ${ (lastResult.win || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {(lastResult.win || 0) > 0 ? `+${fmt(lastResult.win)}` : '0'} {CURRENCY}
                  </div>
                </div>
              )}

              <button
                onClick={() => {
                  if (spinningSlots) return;

                  setSpinningSlots(true);
                  setLastResult(null);
                  setActiveSpinningReels([true, true, true]);
                  spinningReelsRef.current = [true, true, true];

                  // Kick fast continuous scrolling — scroll exactly one full symbol cycle repeatedly.
                  // This is seamless, never runs out of tape, and the last reel won't disappear.
                  reelControls.forEach((ctrl, i) => {
                    ctrl.start({
                      y: `-=${CYCLE_HEIGHT}`,
                      transition: {
                        duration: 0.52 + i * 0.085,
                        ease: 'linear',
                        repeat: Infinity,
                        repeatType: 'loop',
                      },
                    });
                  });

                  play('slots');
                }}
                disabled={spinningSlots}
                className="w-full py-3.5 rounded-2xl text-white font-bold text-base active:scale-[0.985] disabled:opacity-70"
                style={{ background: 'var(--brand-gradient)' }}
              >
                {spinningSlots ? 'КРУТИМ...' : `КРУТИТЬ СЛОТЫ • ${fmt(bet)}`}
              </button>

              <div className="text-[10px] mt-2 text-center text-slate-400">Ставка списывается сразу. Результат моментальный.</div>
            </div>
          )}

         {/* DICE dedicated UI */}
          {currentGame === 'dice' && (
            <div className="max-w-md mx-auto">
              <div className="text-center mb-4">
                <div className="text-6xl">🎲</div>
                <div className="text-3xl font-bold">Кости</div>
                <div className="text-xs opacity-60 mt-1">Классика • Выбери тип ставки</div>
              </div>

             {/* Bet type selector */}
              <div className="bg-white border rounded-3xl p-4 mb-4" style={{backgroundColor:'var(--card)', borderColor:'var(--border)'}}>
                <div className="text-sm font-medium mb-2 px-1 opacity-70">Тип ставки:</div>

                <div className="grid grid-cols-2 gap-2 mb-3">
                  <button
                    onClick={() => { setDiceBetType('high'); setDiceTarget(0); }}
                    className={`py-2.5 rounded-2xl text-sm font-medium border transition ${diceBetType === 'high' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-slate-50'}`}
                  >
                    ⬆️ Больше 7 <span className="opacity-70 text-xs">(x1.9)</span>
                  </button>
                  <button
                    onClick={() => { setDiceBetType('low'); setDiceTarget(0); }}
                    className={`py-2.5 rounded-2xl text-sm font-medium border transition ${diceBetType === 'low' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-slate-50'}`}
                  >
                    ⬇️ Меньше 7 <span className="opacity-70 text-xs">(x1.9)</span>
                  </button>
                  <button
                    onClick={() => { setDiceBetType('seven'); setDiceTarget(0); }}
                    className={`py-2.5 rounded-2xl text-sm font-medium border transition ${diceBetType === 'seven' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-slate-50'}`}
                  >
                    🎯 Ровно 7 <span className="opacity-70 text-xs">(x5)</span>
                  </button>
                  <button
                    onClick={() => setDiceBetType('num')}
                    className={`py-2.5 rounded-2xl text-sm font-medium border transition ${diceBetType === 'num' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-slate-50'}`}
                  >
                    🔢 Точное число <span className="opacity-70 text-xs">(x36)</span>
                  </button>
                </div>

               {/* Exact number picker */}
                {diceBetType === 'num' && (
                  <div>
                    <div className="text-xs mb-1.5 px-1 opacity-60">Выбери число (2–12):</div>
                    <div className="flex flex-wrap gap-1.5">
                      {[2,3,4,5,6,7,8,9,10,11,12].map(n => (
                        <button
                          key={n}
                          onClick={() => setDiceTarget(n)}
                          className={`px-3 py-1 rounded-xl text-sm font-mono border ${diceTarget === n ? 'bg-slate-900 text-white border-slate-900' : 'hover:bg-slate-50'}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <div className="text-[10px] mt-1 px-1 text-amber-600">Выплата x36 за точное совпадение</div>
                  </div>
                )}
              </div>

             {/* Dice visual + roll */}
              <div className="bg-white border rounded-3xl p-5 text-center" style={{backgroundColor:'var(--card)', borderColor:'var(--border)'}}>
                <div className="flex justify-center gap-10 mb-6">
                  <motion.div
                    className="w-20 h-20 bg-white rounded-2xl border-4 border-slate-300 shadow-inner flex items-center justify-center text-5xl font-bold tabular-nums select-none"
                    animate={diceRolling ? {
                      rotate: [0, 60, 150, 240, 330, 420, 510, 570],
                      scale: [1, 0.9, 1.07, 0.88, 1.04, 0.92, 1.02, 1],
                      x: [0, -7, 5, -4, 3, -2, 1, 0],
                      y: [0, 4, -5, 3, -3, 2, -1, 0]
                    } : { rotate: 0, scale: 1, x: 0, y: 0 }}
                    transition={{ duration: diceRolling ? 0.95 : 0.22, repeat: diceRolling ? 2 : 0, ease: 'easeInOut' }}
                  >
                    {diceRolling ? rollingDie1 : (diceResult?.d1 ?? '?')}
                  </motion.div>
                  <motion.div
                    className="w-20 h-20 bg-white rounded-2xl border-4 border-slate-300 shadow-inner flex items-center justify-center text-5xl font-bold tabular-nums select-none"
                    animate={diceRolling ? {
                      rotate: [0, -70, -160, -250, -340, -430, -520, -580],
                      scale: [1, 0.91, 1.06, 0.89, 1.03, 0.93, 1.01, 1],
                      x: [0, 6, -4, 5, -3, 2, -1, 0],
                      y: [0, -3, 4, -2, 3, -2, 1, 0]
                    } : { rotate: 0, scale: 1, x: 0, y: 0 }}
                    transition={{ duration: diceRolling ? 0.88 : 0.22, repeat: diceRolling ? 2 : 0, ease: 'easeInOut' }}
                  >
                    {diceRolling ? rollingDie2 : (diceResult?.d2 ?? '?')}
                  </motion.div>
                </div>

                {diceResult && !diceRolling && lastResult?.game === 'dice' && (
                  <div className={`mb-4 text-lg font-semibold ${ (lastResult.win||0) > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    Выпало <b>{diceResult.sum}</b> — {(lastResult.win||0) > 0 ? `+${fmt(lastResult.win)}` : 'проигрыш'}
                  </div>
                )}

                <button
                  onClick={() => {
                    const bt = diceBetType === 'num' ? `num${diceTarget}` : diceBetType;
                    // seed initial tumbling faces so animation doesn't start from old values
                    setRollingDie1(Math.floor(Math.random() * 6) + 1);
                    setRollingDie2(Math.floor(Math.random() * 6) + 1);
                    play('dice', { betType: bt });
                    setDiceRolling(true);
                    setDiceResult(null);
                  }}
                  disabled={diceRolling}
                  className="w-full py-3.5 rounded-2xl text-white font-bold text-base active:scale-[0.985] disabled:opacity-70"
                  style={{background: 'var(--brand-gradient)'}}
                >
                  {diceRolling ? 'БРОСАЕМ...' : `БРОСИТЬ КУБИКИ • ${fmt(bet)}`}
                </button>

                <div className="text-[10px] mt-2 text-slate-400">Ставка списывается сразу. Выплата по итогам броска.</div>
              </div>
            </div>
          )}

         {/* ROULETTE dedicated UI - bigger wheel left (340px), selector right, larger cell text */}
          {currentGame === 'roulette' && (
            <div className="w-full max-w-[680px] mx-auto">
              <div className="text-center mb-3">
                <div className="text-6xl">🎡</div>
                <div className="text-3xl font-bold">Европейская Рулетка</div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-center sm:items-start">
               {/* LEFT: Big wheel - responsive */}
                <div className="flex-shrink-0 w-full max-w-[280px] sm:max-w-[340px] mx-auto">
                  <div className="relative w-full aspect-square">
                    <motion.svg
                      width="100%"
                      height="100%"
                      viewBox="0 0 340 340"
                      className="mx-auto drop-shadow-lg"
                      preserveAspectRatio="xMidYMid meet"
                    >
                      <g transform="translate(170,170)">
                        <circle r="165" fill="#1f2937" stroke="#4b5563" strokeWidth="8" />
                        <circle r="155" fill="#111827" stroke="#374151" strokeWidth="4" />

                        <motion.g
                          animate={{ rotate: targetWheelRotation }}
                          transition={{ duration: 2.9, ease: [0.22, 1, 0.36, 1] }}
                          onAnimationComplete={() => {
                            if (pendingRouletteResult) {
                              setRouletteResult(pendingRouletteResult);
                              setLastResult({ game: 'roulette', ...pendingRouletteResult });
                              refreshProfile();
                              setPendingRouletteResult(null);
                              setRouletteSpinning(false);
                            }
                          }}
                        >
                          {ROULETTE_ORDER.map((num, i) => {
                            const start = i * (360 / 37);
                            const end = start + (360 / 37);
                            const pathD = createPieSlice(0, 0, 152, start, end);
                            const color = getRouletteColor(num);
                            const mid = start + (360 / 37) / 2;
                            const tx = 110 * Math.cos((mid - 90) * Math.PI / 180);
                            const ty = 110 * Math.sin((mid - 90) * Math.PI / 180);
                            return (
                              <g key={i}>
                                <path d={pathD} fill={color} stroke="#1f2937" strokeWidth="1" />
                                <text
                                  x={tx}
                                  y={ty}
                                  fill="white"
                                  fontSize="11"
                                  fontWeight="700"
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                  transform={`rotate(${mid}, ${tx}, ${ty})`}
                                >
                                  {num}
                                </text>
                              </g>
                            );
                          })}

                          <circle r="34" fill="#1f2937" stroke="#4b5563" strokeWidth="4" />
                          <circle r="15" fill="#374151" />
                        </motion.g>
                      </g>
                    </motion.svg>

                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-1 text-6xl z-20 drop-shadow-md pointer-events-none" style={{ color: '#f87171' }}>
                      ▼
                    </div>
                  </div>

                  {rouletteResult && !rouletteSpinning && (
                    <div className="mt-3 text-center">
                      <div className={`inline-block px-5 py-1.5 rounded-2xl text-base font-semibold ${rouletteResult.color === 'red' ? 'bg-red-600 text-white' : rouletteResult.color === 'black' ? 'bg-slate-800 text-white' : 'bg-emerald-600 text-white'}`}>
                        {rouletteResult.result} — {rouletteResult.color === 'red' ? 'Красное' : rouletteResult.color === 'black' ? 'Чёрное' : 'Зеро'}
                      </div>
                      <div className={`mt-1 text-2xl font-bold ${rouletteResult.win > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {rouletteResult.win > 0 ? `+${fmt(rouletteResult.win)}` : 'Проигрыш'}
                      </div>
                    </div>
                  )}
                </div>

               {/* RIGHT: Sector selector */}
                <div className="flex-1 pt-2">
                  <div className="bg-white border rounded-3xl p-4" style={{backgroundColor:'var(--card)', borderColor:'var(--border)'}}>
                    <div className="text-sm font-semibold mb-2.5 px-1 opacity-80">Выберите сектор:</div>

                    <div className="grid grid-cols-1 gap-2 text-sm">
                      <button onClick={() => { setRouletteBetType('red'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'red' ? 'bg-red-600 text-white border-red-600' : 'hover:bg-red-50'}`}>🔴 Красное (x2)</button>
                      <button onClick={() => { setRouletteBetType('black'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'black' ? 'bg-slate-800 text-white border-slate-800' : 'hover:bg-slate-100'}`}>⚫ Чёрное (x2)</button>
                      <button onClick={() => { setRouletteBetType('zero'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'zero' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-emerald-50'}`}>🟢 Зеро (x35)</button>
                      <button onClick={() => { setRouletteBetType('number'); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'number' ? 'bg-violet-600 text-white border-violet-600' : 'hover:bg-violet-50'}`}>🔢 Число (x35)</button>
                      <button onClick={() => { setRouletteBetType('low'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'low' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-emerald-50'}`}>⬇️ 1–18 (x2)</button>
                      <button onClick={() => { setRouletteBetType('high'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'high' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-emerald-50'}`}>⬆️ 19–36 (x2)</button>
                      <button onClick={() => { setRouletteBetType('even'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'even' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-emerald-50'}`}>⚖️ Чётное (x2)</button>
                      <button onClick={() => { setRouletteBetType('odd'); setRouletteTarget(null); }} className={`py-2 rounded-2xl border flex items-center justify-center gap-2 transition ${rouletteBetType === 'odd' ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-emerald-50'}`}>⚖️ Нечётное (x2)</button>
                    </div>

                    {rouletteBetType === 'number' && (
                      <div className="mt-3 pt-3 border-t text-xs">
                        <div className="mb-1 opacity-70">Номер (0–36):</div>
                        <div className="flex flex-wrap gap-1">
                          {Array.from({length: 37}, (_, i) => i).map(n => (
                            <button key={n} onClick={() => setRouletteTarget(n)} className={`px-1.5 py-0.5 rounded border font-mono ${rouletteTarget === n ? 'bg-violet-600 text-white' : 'hover:bg-slate-100'}`}>{n}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                onClick={async () => {
                  if (rouletteSpinning) return;
                  if (rouletteBetType === 'number' && rouletteTarget === null) {
                    alert('Выберите номер');
                    return;
                  }
                  setRouletteSpinning(true);
                  setRouletteResult(null);
                  setPendingRouletteResult(null);

                  try {
                    const bt = rouletteBetType;
                    const tgt = rouletteBetType === 'number' ? rouletteTarget : undefined;
                    const res = await api.playRoulette(bet, bt, tgt, token!);
                    const finalRot = calculateRouletteRotation(res.result);
                    setPendingRouletteResult(res);
                    setTargetWheelRotation(finalRot);
                  } catch (e: any) {
                    setRouletteSpinning(false);
                    alert(e.message || 'Ошибка рулетки');
                  }
                }}
                disabled={rouletteSpinning}
                className="mt-5 w-full py-3.5 rounded-2xl text-white font-bold text-lg active:scale-[0.985] disabled:opacity-70"
                style={{background: 'var(--brand-gradient)'}}
              >
                {rouletteSpinning ? 'КРУТИМ...' : `КРУТИТЬ РУЛЕТКУ • ${fmt(bet)}`}
              </button>
            </div>
          )}

        </div>
      ) : (
        /* HUB */
        <div className="w-full max-w-full overflow-x-hidden">
         {/* Top level tabs: Economy vs Games (games not always on screen) */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => { setHubView('economy'); setActiveTab(null as any); }}
              className={`flex-1 py-3 rounded-2xl text-lg font-semibold transition ${hubView === 'economy' ? 'text-white' : 'border'}`}
              style={hubView === 'economy' ? { background: 'var(--brand-gradient)' } : { backgroundColor: 'var(--card)' }}
            >
              💰 Экономика
            </button>
            <button
              onClick={() => setHubView('games')}
              className={`flex-1 py-3 rounded-2xl text-lg font-semibold transition ${hubView === 'games' ? 'text-white' : 'border'}`}
              style={hubView === 'games' ? { background: 'var(--brand-gradient)' } : { backgroundColor: 'var(--card)' }}
            >
              🎰 Игры
            </button>
          </div>

          {hubView === 'economy' && (
            <div className="mb-8 w-full overflow-x-hidden">
              <div className="flex items-center justify-between mb-3">
                <div className="text-2xl font-semibold">Экономика</div>
                {activeTab && (
                  <button 
                    onClick={() => setActiveTab(null as any)} 
                    className="text-sm px-3 py-1 border rounded-2xl hover:bg-slate-100"
                  >
                    Свернуть
                  </button>
                )}
              </div>

             {/* Bigger economy buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                {[
                  {k:'farm', label:'⛏️ Ферма', icon:'⛏️'},
                  {k:'bank', label:'🏦 Банк', icon:'🏦'},
                  {k:'biz', label:'🏢 Бизнесы', icon:'🏢'},
                  {k:'shop', label:'🛒 Магазин', icon:'🛒'},
                  {k:'top', label:'🏆 Топ', icon:'🏆'},
                  {k:'profile', label:'👤 Профиль', icon:'👤'},
                  ...(isButuz ? [{k:'admin', label:'🛡️ Админ', icon:'🛡️'}] : []),
                ].map(item => (
                  <button 
                    key={item.k}
                    onClick={() => openPanel(item.k as any)}
                    className={`p-4 rounded-2xl border text-left transition flex items-center gap-3 text-base font-medium ${activeTab === item.k ? 'ring-2 ring-offset-2' : 'hover:scale-[1.01]'}`}
                    style={activeTab === item.k ? { backgroundColor: 'color-mix(in srgb, var(--brand-500) 12%, var(--card))', borderColor: 'var(--brand-500)' } : { backgroundColor: 'var(--card)' }}
                  >
                    <span className="text-3xl">{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>

           {/* Full economy content - shown big when selected */}
            {activeTab === 'farm' && farm && (
              <div className="bg-white border rounded-3xl p-4 sm:p-6 mb-4 w-full overflow-x-hidden" style={{backgroundColor:'var(--card)'}}>
                {/* Header */}
                <div className="text-2xl font-bold mb-4">⛏️ Майнинг-ферма</div>

                {/* Status - big and clear */}
                <div className="mb-6">
                  {farm.level > 0 ? (
                    <div>
                      <div className="text-3xl font-semibold flex items-center gap-2">
                        {farm.farm.emoji} {farm.farm.name}
                        <span className="text-lg font-normal text-slate-500">ур. {farm.level}</span>
                      </div>

                      {farm.level === 10 && farm.extra > 0 && (
                        <div className="mt-1 text-base font-medium">
                          Всего ферм: <b>{1 + farm.extra}</b> / 1000
                        </div>
                      )}

                      <div className="mt-3">
                        <div className="text-xs uppercase tracking-wide opacity-60">Скорость майнинга</div>
                        <div className="text-3xl sm:text-4xl font-bold tabular-nums text-emerald-600 break-all">
                          {(() => {
                            const base = farm.farm?.btc_per_hour || 0;
                            const extraRate = (farm.level === 10 ? (farm.extra || 0) * base : 0);
                            return (base + extraRate).toFixed(3);
                          })()} <span className="text-lg sm:text-xl">BTC/ч</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="text-2xl font-semibold">У вас ещё нет фермы</div>
                      <div className="mt-1 text-base opacity-70">Купите первую — она будет работать даже когда вы оффлайн.</div>
                    </div>
                  )}
                </div>

                {/* Accumulated - most important number, very prominent */}
                <div className="mb-6 p-5 rounded-2xl bg-emerald-50 border border-emerald-100 overflow-x-hidden">
                  <div className="text-xs uppercase tracking-[1px] text-emerald-700">НАКОПЛЕНО</div>
                  <div className="mt-1 font-mono text-3xl sm:text-5xl font-bold tabular-nums text-emerald-600 break-all">
                    {(farm.totalBtc || 0).toFixed(6)}
                  </div>
                  <div className="text-xl mt-1">
                    ≈ <b className="text-emerald-600">{fmt(farm.btcValue || 0)}</b> {CURRENCY}
                  </div>
                  <div className="text-[10px] text-emerald-600/70 mt-0.5">1 BTC = 65 000 {CURRENCY}</div>
                </div>

                {/* Primary actions */}
                <div className="space-y-3">
                  {/* Collect - only when meaningful */}
                  {(farm.level || 0) > 0 && (
                    <button 
                      onClick={farmCollect} 
                      disabled={!farm.totalBtc || farm.totalBtc < 0.000001}
                      className="w-full py-4 text-lg rounded-2xl text-white font-bold active:scale-[0.985] disabled:opacity-60" 
                      style={{background:'#10b981'}}
                    >
                      💰 Собрать {fmt(farm.btcValue || 0)} {CURRENCY}
                    </button>
                  )}

                  {/* Buy first farm or Upgrade - the main progression action */}
                  {farm.level < 10 && (
                    <button 
                      onClick={farmUpgrade} 
                      className="w-full py-4 text-lg rounded-2xl font-bold active:scale-[0.985]"
                      style={{
                        backgroundColor: farm.level === 0 ? '#10b981' : '#f1f5f9',
                        color: farm.level === 0 ? 'white' : '#0f172a'
                      }}
                    >
                      {farm.level === 0 ? '🛒 Купить первую ферму' : '⬆️ Улучшить ферму'}<br />
                      <span className="text-base font-semibold opacity-90">
                        {FARM_LEVELS_FRONT[farm.level + 1]?.name} — {fmt(FARM_LEVELS_FRONT[farm.level + 1]?.price || 0)} {CURRENCY}
                      </span>
                    </button>
                  )}

                  {/* Extras at max level - simplified, fewer buttons */}
                  {farm.level === 10 && (
                    <div className="pt-2">
                      <div className="text-base font-semibold mb-2">Докупить доп. фермы</div>
                      <div className="flex flex-wrap gap-2">
                        {[1, 10, 50, 100].map(n => (
                          <button 
                            key={n} 
                            onClick={() => farmBuyExtra(n)} 
                            className="flex-1 min-w-[60px] sm:min-w-[68px] py-2.5 text-sm font-medium border rounded-2xl active:bg-slate-100"
                          >
                            +{n}
                          </button>
                        ))}
                        <button 
                          onClick={() => {
                            const maxByBal = Math.floor((profile?.balance || 0) / (farm.farm?.price || 12000000));
                            const max = Math.min(maxByBal, 1000 - (farm.extra || 0));
                            if (max > 0) farmBuyExtra(max);
                          }} 
                          className="flex-1 py-2.5 text-sm font-medium border rounded-2xl active:bg-slate-100"
                        >
                          Макс
                        </button>
                      </div>
                      <div className="text-[10px] text-center mt-2 opacity-60">
                        Цена за ферму: {fmt(farm.farm?.price || 12000000)} {CURRENCY} • Лимит 1000
                      </div>
                    </div>
                  )}
                </div>

                {/* Reference: all levels - always visible, readable size */}
                <div className="mt-6">
                  <div className="text-sm font-semibold mb-2 opacity-80">Все уровни ферм</div>
                  <div className="grid grid-cols-1 gap-1 text-sm">
                    {Object.entries(FARM_LEVELS_FRONT).map(([lvl, f]: any) => (
                      <div key={lvl} className="flex items-center justify-between border rounded-xl px-3 py-1.5 bg-slate-50" style={{backgroundColor:'var(--card)'}}>
                        <span className="font-medium">{f.emoji} {f.name} <span className="font-normal text-xs text-slate-500">ур.{lvl}</span></span>
                        <span className="text-right tabular-nums text-xs opacity-75">{f.btc_per_hour} BTC/ч • {fmt(f.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="text-[10px] text-center text-slate-400 mt-5">Работают оффлайн до 72 часов</div>
              </div>
            )}

            {activeTab === 'bank' && bank && (
              <div className="mb-4">
                {/* Header + summary */}
                <div className="bg-white border rounded-3xl p-6" style={{backgroundColor:'var(--card)'}}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <div className="text-2xl font-bold">🏦 Банк</div>
                      <div className="text-sm opacity-70 mt-0.5">Безопасное хранение и вклады под процент</div>
                    </div>
                    <button onClick={loadBank} className="text-xs px-3 py-1.5 border rounded-2xl active:bg-slate-100">⟳ Обновить</button>
                  </div>

                  {/* Summary bar - intuitive overview */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-2xl border p-3" style={{background:'var(--card)'}}>
                      <div className="text-[10px] uppercase tracking-widest opacity-60">На руках</div>
                      <div className="mt-0.5">
                        <div className="font-mono font-semibold tabular-nums leading-none text-[clamp(13px,4.2vw,18px)]">{fmt(bank.balance || 0)}</div>
                        <div className="text-[9px] sm:text-[10px] opacity-50 -mt-px">{CURRENCY}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border p-3" style={{background:'var(--card)'}}>
                      <div className="text-[10px] uppercase tracking-widest opacity-60">Гибкий сейф (0%)</div>
                      <div className="mt-0.5">
                        <div className="font-mono font-semibold tabular-nums leading-none text-[clamp(13px,4.2vw,18px)] text-sky-600">{fmt(bank.instant || 0)}</div>
                        <div className="text-[9px] sm:text-[10px] opacity-50 -mt-px">{CURRENCY}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border p-3" style={{background:'var(--card)'}}>
                      <div className="text-[10px] uppercase tracking-widest opacity-60">В срочных вкладах</div>
                      <div className="mt-0.5">
                        <div className="font-mono font-semibold tabular-nums leading-none text-[clamp(13px,4.2vw,18px)] text-amber-600">{fmt(bank.locked || 0)}</div>
                        <div className="text-[9px] sm:text-[10px] opacity-50 -mt-px">{CURRENCY}</div>
                      </div>
                    </div>
                    <div className="rounded-2xl border p-3 bg-emerald-50/60" style={{background:'color-mix(in srgb, var(--card) 70%, #10b98110)'}}>
                      <div className="text-[10px] uppercase tracking-widest opacity-60">Всего под защитой</div>
                      <div className="mt-0.5">
                        <div className="font-mono font-semibold tabular-nums leading-none text-[clamp(13px,4.2vw,18px)] text-emerald-600">{fmt((bank.instant||0) + (bank.locked||0))}</div>
                        <div className="text-[9px] sm:text-[10px] opacity-50 -mt-px">{CURRENCY}</div>
                      </div>
                    </div>
                  </div>

                  {/* INSTANT FLEXIBLE SAFE (0%) - amount choice for deposit/withdraw */}
                  <div className="mb-6">
                    <div className="font-semibold mb-2 flex items-center gap-2">
                      🏦 Гибкий сейф <span className="text-xs px-2 py-0.5 rounded bg-sky-100 text-sky-700 font-normal">0% • мгновенный доступ</span>
                    </div>
                    <div className="text-sm opacity-70 mb-3">Кладите и снимайте в любой момент без ограничений. Процент не начисляется.</div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Deposit to instant */}
                      <div className="border rounded-2xl p-4">
                        <div className="text-sm font-medium mb-1.5">Пополнить сейф</div>
                        <div className="flex gap-2 mb-2">
                          <input
                            type="number"
                            className="flex-1 px-3 py-2 rounded-xl border font-mono tabular-nums"
                            value={instantDepAmt}
                            onChange={e => setInstantDepAmt(Math.max(0, parseInt(e.target.value || '0')))}
                            min={0}
                            max={bank.balance || 0}
                          />
                          <button onClick={() => doInstantDeposit()} className="px-5 rounded-2xl text-white font-medium active:scale-[0.985]" style={{background:'var(--brand-500)'}}>Пополнить</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[0.25, 0.5, 0.75, 1].map(p => (
                            <button key={p} onClick={() => setInstantDepAmt(Math.floor((bank.balance || 0) * p))} className="text-xs px-2.5 py-1 border rounded-xl hover:bg-slate-50 active:bg-slate-100">{Math.round(p*100)}%</button>
                          ))}
                          <button onClick={() => setInstantDepAmt(bank.balance || 0)} className="text-xs px-2.5 py-1 border rounded-xl hover:bg-slate-50">Всё</button>
                        </div>
                        <div className="text-[10px] opacity-50 mt-1 break-words">Макс: {fmt(bank.balance || 0)}</div>
                      </div>

                      {/* Withdraw from instant */}
                      <div className="border rounded-2xl p-4">
                        <div className="text-sm font-medium mb-1.5">Снять из сейфа</div>
                        <div className="flex gap-2 mb-2">
                          <input
                            type="number"
                            className="flex-1 px-3 py-2 rounded-xl border font-mono tabular-nums"
                            value={instantWdAmt}
                            onChange={e => setInstantWdAmt(Math.max(0, parseInt(e.target.value || '0')))}
                            min={0}
                            max={bank.instant || 0}
                          />
                          <button onClick={() => doInstantWithdraw()} className="px-5 rounded-2xl font-medium active:scale-[0.985] border">Снять</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[0.25, 0.5, 0.75, 1].map(p => (
                            <button key={p} onClick={() => setInstantWdAmt(Math.floor((bank.instant || 0) * p))} className="text-xs px-2.5 py-1 border rounded-xl hover:bg-slate-50 active:bg-slate-100">{Math.round(p*100)}%</button>
                          ))}
                          <button onClick={() => setInstantWdAmt(bank.instant || 0)} className="text-xs px-2.5 py-1 border rounded-xl hover:bg-slate-50">Всё</button>
                        </div>
                        <div className="text-[10px] opacity-50 mt-1 break-words">Доступно: {fmt(bank.instant || 0)}</div>
                      </div>
                    </div>
                  </div>

                  {/* TIMED DEPOSITS / СРОЧНЫЕ ВКЛАДЫ */}
                  <div>
                    <div className="font-semibold mb-1.5 flex items-center gap-2">
                      📈 Срочные вклады под процент
                    </div>
                    <div className="text-sm opacity-70 mb-3">
                      Выберите уровень вклада → укажите сумму в пределах лимита → деньги замораживаются на срок. 
                      <span className="font-medium text-amber-600"> Вывод возможен только после окончания срока.</span> Чем выше ставка — тем ниже максимальная сумма.
                    </div>

                    {/* Tier cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      {(bank.tiers || []).map((t: any) => {
                        const isOpeningThis = openingTierId === t.id;
                        const maxAffordable = Math.min(t.max, bank.balance || 0);
                        return (
                          <div key={t.id} className={`border rounded-2xl p-4 flex flex-col ${isOpeningThis ? 'ring-2 ring-offset-2' : ''}`} style={{ borderColor: isOpeningThis ? 'var(--brand-500)' : undefined, backgroundColor:'var(--card)' }}>
                            <div className="flex items-start justify-between">
                              <div>
                                <div className="text-2xl mb-0.5">{t.emoji}</div>
                                <div className="font-semibold">{t.name}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-3xl font-bold tabular-nums leading-none text-emerald-600">{t.rate}<span className="text-base font-medium">%</span></div>
                                <div className="text-[10px] opacity-60 -mt-0.5">годовых</div>
                              </div>
                            </div>

                            <div className="mt-3 text-sm break-words">
                              <span className="opacity-70">Срок:</span> <b>{t.term_days} дней</b><br />
                              <span className="opacity-70">Мин/макс:</span> <b>{fmt(t.min)}</b> — <b>{fmt(t.max)}</b> {CURRENCY}
                            </div>
                            <div className="text-xs opacity-60 mt-1 mb-3">{t.desc}</div>

                            {!isOpeningThis ? (
                              <button
                                onClick={() => startOpenDeposit(t.id)}
                                disabled={maxAffordable < t.min}
                                className="mt-auto w-full py-2 rounded-2xl text-sm font-medium active:scale-[0.985] disabled:opacity-50"
                                style={{ background: maxAffordable >= t.min ? 'var(--brand-500)' : '#e5e7eb', color: maxAffordable >= t.min ? 'white' : '#111' }}
                              >
                                {maxAffordable >= t.min ? 'Открыть вклад' : 'Недостаточно средств'}
                              </button>
                            ) : (
                              <button onClick={cancelOpenDeposit} className="mt-auto w-full py-2 rounded-2xl text-sm font-medium border">Отмена</button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Inline amount chooser when a tier is selected for opening */}
                    {openingTierId && bank && (() => {
                      const tier = (bank.tiers || []).find((t: any) => t.id === openingTierId);
                      if (!tier) return null;
                      const maxPossible = Math.min(tier.max, bank.balance || 0);
                      const previewPayout = Math.floor(openAmount * (1 + tier.rate / 100));
                      const previewProfit = previewPayout - openAmount;
                      return (
                        <div className="mb-5 border-2 rounded-3xl p-5" style={{borderColor:'var(--brand-500)', background:'color-mix(in srgb, var(--card) 98%, #00000003)'}}>
                          <div className="font-semibold mb-2">Открытие вклада: {tier.emoji} {tier.name} • {tier.rate}% на {tier.term_days} дней</div>

                          <div className="flex flex-col md:flex-row gap-3 items-end">
                            <div className="flex-1">
                              <div className="text-xs uppercase tracking-widest opacity-60 mb-1">Сумма вклада</div>
                              <input
                                type="number"
                                className="w-full px-4 py-3 text-lg font-mono tabular-nums rounded-2xl border"
                                value={openAmount}
                                onChange={e => {
                                  const v = Math.max(0, parseInt(e.target.value || '0'));
                                  setOpenAmount(Math.min(tier.max, Math.max(tier.min, v)));
                                }}
                                min={tier.min}
                                max={maxPossible}
                              />
                              <div className="text-[10px] opacity-60 mt-1 break-words">Мин {fmt(tier.min)} • Макс {fmt(tier.max)} • Доступно {fmt(bank.balance || 0)}</div>
                            </div>

                            <div className="flex gap-2">
                              {[0.25,0.5,0.75,1].map(p => (
                                <button key={p} onClick={() => setOpenAmount(Math.max(tier.min, Math.min(tier.max, Math.floor(maxPossible * p))))} className="px-3 py-2 text-sm border rounded-2xl active:bg-slate-100">{Math.round(p*100)}%</button>
                              ))}
                              <button onClick={() => setOpenAmount(maxPossible)} className="px-3 py-2 text-sm border rounded-2xl active:bg-slate-100">Макс</button>
                            </div>

                            <button onClick={confirmOpenDeposit} className="px-6 py-2.5 rounded-2xl text-white font-bold active:scale-[0.985] text-sm leading-tight" style={{background:'var(--brand-500)'}}>
                              Подтвердить<br /><span className="text-[10px] font-normal opacity-90">+{fmt(previewProfit)}</span>
                            </button>
                          </div>

                          <div className="mt-3 text-sm break-words">
                            По окончании срока вы получите <b className="tabular-nums">{fmt(previewPayout)}</b> {CURRENCY} 
                            (ваши <b>{fmt(openAmount)}</b> + прибыль <b className="text-emerald-600">+{fmt(previewProfit)}</b>)
                          </div>
                          <div className="mt-1 text-xs text-amber-600">⚠️ Деньги будут заморожены. Досрочный вывод невозможен.</div>
                        </div>
                      );
                    })()}

                    {/* Active deposits list - the key part for "until term ends, no withdraw" */}
                    <div className="mt-2">
                      <div className="font-medium mb-2">Мои активные вклады {bank.deposits && bank.deposits.length > 0 ? `(${bank.deposits.length})` : ''}</div>

                      {!bank.deposits || bank.deposits.length === 0 ? (
                        <div className="text-sm opacity-60 border rounded-2xl p-4 text-center">Нет активных срочных вкладов. Откройте один из уровней выше, чтобы получать проценты.</div>
                      ) : (
                        <div className="space-y-2">
                          {bank.deposits.map((d: any) => (
                            <div key={d.id} className={`rounded-2xl border p-4 ${d.is_matured ? 'bg-emerald-50 border-emerald-200' : ''}`} style={{backgroundColor: d.is_matured ? undefined : 'var(--card)'}}>
                              {/* Tier header */}
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-semibold">{(bank.tiers || []).find((t:any)=>t.id===d.tier_id)?.emoji || '📈'} {(bank.tiers || []).find((t:any)=>t.id===d.tier_id)?.name || d.tier_id}</span>
                                <span className="text-emerald-600 font-bold tabular-nums">{d.rate}%</span>
                                <span className="text-xs px-2 py-px rounded bg-black/5">{d.term_days} дн.</span>
                              </div>

                              {/* SUM — dedicated full-width line so it never squeezes or hides under the card frame.
                                  Uses clamp() to auto-reduce size based on available space when numbers are extreme. */}
                              <div className="font-mono tabular-nums font-semibold leading-none text-[clamp(15px,5vw,20px)] mb-0.5">
                                {fmt(d.principal)} {CURRENCY}
                              </div>

                              {/* For matured: show what you will actually receive (on its line too) */}
                              {d.is_matured && (
                                <div className="text-emerald-600 text-sm font-medium tabular-nums mb-1">
                                  К получению: {fmt(d.payout)} {CURRENCY} <span className="text-xs opacity-80">(+{fmt(d.profit)})</span>
                                </div>
                              )}

                              {/* Bottom meta: dates + status + action (stacks on small screens, row on larger) */}
                              <div className="flex flex-col sm:flex-row sm:items-center gap-x-3 gap-y-1.5 text-xs sm:text-sm">
                                <div className="opacity-70 flex-1 min-w-0">
                                  Вложено {new Date(d.start_at).toLocaleDateString('ru-RU')} • созревает {new Date(d.matures_at).toLocaleDateString('ru-RU')}
                                </div>

                                <div className="sm:text-right sm:min-w-[100px] sm:min-w-[140px]">
                                  {d.is_matured ? (
                                    <>
                                      <span className="text-emerald-700 font-medium">Готов к выплате</span>
                                      <span className="ml-1.5 font-mono tabular-nums text-emerald-600">+{fmt(d.profit)}</span>
                                    </>
                                  ) : (
                                    <>
                                      <span>Осталось ~{d.days_left} дн.</span>
                                      <span className="ml-1.5 text-amber-600">вывод заблокирован</span>
                                    </>
                                  )}
                                </div>

                                <div className="sm:ml-auto">
                                  {d.is_matured ? (
                                    <button onClick={() => claimDeposit(d.id)} className="px-5 py-1.5 rounded-2xl bg-emerald-600 text-white font-bold active:scale-[0.985] text-sm whitespace-nowrap">
                                      Забрать
                                    </button>
                                  ) : (
                                    <div className="text-center text-xs px-3 py-1 border rounded-2xl opacity-70">Вывод после {new Date(d.matures_at).toLocaleDateString('ru-RU')}</div>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 text-[11px] text-center text-slate-400">Проценты выплачиваются единовременно при закрытии вклада по истечении срока. Досрочное расторжение недоступно.</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'biz' && (
              <div className="mb-4">
                <div className="text-2xl font-bold mb-1">🏢 Бизнесы</div>
                <div className="text-sm opacity-70 mb-4">Покупайте бизнесы и выполняйте часовые задачи для стабильного дохода.</div>

                {/* Two explicit sub-tabs */}
                <div className="flex gap-2 border-b mb-4">
                  <button
                    onClick={() => setBizSubTab('my')}
                    className={`px-5 py-2 text-sm font-medium rounded-t-2xl transition ${bizSubTab === 'my' ? 'bg-[var(--card)] border border-b-0 border-[var(--border)] font-semibold' : 'text-[var(--text-muted)] hover:text-foreground'}`}
                  >
                    Мои бизнесы
                  </button>

                  {bizList.some((b: any) => !b.owned) && (
                    <button
                      onClick={() => { setBizSubTab('available'); setSelectedBizId(null); }}
                      className={`px-5 py-2 text-sm font-medium rounded-t-2xl transition ${bizSubTab === 'available' ? 'bg-[var(--card)] border border-b-0 border-[var(--border)] font-semibold' : 'text-[var(--text-muted)] hover:text-foreground'}`}
                    >
                      Доступные бизнесы
                    </button>
                  )}
                </div>

                {/* === SUB-TAB: Мои бизнесы === */}
                {bizSubTab === 'my' && (
                  <div className="space-y-4">
                    {(() => {
                      const owned = bizList.filter((b: any) => b.owned);
                      if (owned.length === 0) {
                        return (
                          <div className="text-center py-8 text-sm opacity-70 border rounded-2xl">
                            У вас пока нет купленных бизнесов.<br />
                            Перейдите во вкладку «Доступные бизнесы», чтобы приобрести первый.
                          </div>
                        );
                      }

                      return (
                        <>
                          <div className="text-sm opacity-70 mb-1">Нажмите на бизнес, чтобы развернуть окно с активностями прямо под ним</div>

                          {/* Clickable list — activities window drops out directly under the clicked business */}
                          <div className="space-y-2">
                            {owned.map((b: any) => {
                              const isOpen = selectedBizId === b.id;

                              return (
                                <div key={b.id} className="space-y-1">
                                  {/* Business list item (clickable header) */}
                                  <div
                                    onClick={() => setSelectedBizId(isOpen ? null : b.id)}
                                    className={`p-4 rounded-2xl border cursor-pointer transition flex items-center justify-between hover:border-[var(--brand-500)] ${isOpen ? 'ring-2 ring-[var(--brand-500)] bg-[color-mix(in_srgb,var(--brand-500)_6%,var(--card))]' : ''}`}
                                    style={{ backgroundColor: isOpen ? undefined : 'var(--card)' }}
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-2xl">{b.emoji}</span>
                                      <div>
                                        <div className="font-semibold text-lg">{b.name}</div>
                                        <div className="text-xs opacity-60">Доход за задачу: {fmt(b.income_min)}–{fmt(b.income_max)} {CURRENCY}</div>
                                      </div>
                                    </div>
                                    <div className="text-xs px-3 py-1 rounded-xl border bg-white/60">
                                      {isOpen ? 'Свернуть ▲' : 'Открыть активности ▼'}
                                    </div>
                                  </div>

                                  {/* The activities window "выпадает" directly under this specific business */}
                                  {isOpen && (
                                    <div className="ml-4 pl-4 border-l-4 border-[var(--brand-500)] rounded-b-3xl p-5" style={{ backgroundColor: 'var(--card)' }}>
                                      <div className="flex items-start justify-between mb-4">
                                        <div>
                                          <div className="text-xl font-bold">{b.emoji} {b.name} — Активности</div>
                                          <div className="text-sm mt-0.5 opacity-70">Каждая задача имеет перерыв 1 час</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => bizSell(b.id)}
                                            className="text-xs px-3 py-1.5 rounded-xl border border-red-200 text-red-600 hover:bg-red-50"
                                          >
                                            Продать за 70%
                                          </button>
                                          <button
                                            onClick={() => setSelectedBizId(null)}
                                            className="text-xs px-3 py-1.5 rounded-xl border hover:bg-slate-100"
                                          >
                                            Закрыть
                                          </button>
                                        </div>
                                      </div>

                                      <div className="mb-4 p-3 rounded-2xl bg-emerald-50 text-sm border border-emerald-100">
                                        Выполняйте задачи для получения дохода. Нажмите на активность — прибыль сразу зачислится.
                                      </div>

                                      <div className="font-semibold mb-2">Задачи</div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {(b.tasks || []).map((t: any) => {
                                          const remain = t.last
                                            ? Math.max(0, Math.ceil((bizCooldown || 3600) - (Date.now() - new Date(t.last).getTime()) / 1000))
                                            : 0;
                                          const isReady = remain <= 0;

                                          return (
                                            <div key={t.id} className="border rounded-2xl p-4 flex flex-col" style={{ backgroundColor: 'var(--card)' }}>
                                              <div className="font-medium mb-1">{t.name}</div>
                                              <div className="text-xs opacity-60 flex-1 mb-3">Выполните задачу, чтобы получить прибыль</div>

                                              <button
                                                onClick={() => bizDo(b.id, t.id)}
                                                disabled={!isReady}
                                                className={`w-full py-3 rounded-2xl text-sm font-semibold active:scale-[0.985] disabled:opacity-60 disabled:cursor-not-allowed ${isReady ? 'text-white' : 'text-slate-600'}`}
                                                style={{ background: isReady ? 'var(--brand-500)' : '#f1f5f9' }}
                                              >
                                                {isReady ? 'Выполнить задачу' : `⏳ Перерыв ${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, '0')}`}
                                              </button>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* === SUB-TAB: Доступные бизнесы === */}
                {bizSubTab === 'available' && bizList.some((b: any) => !b.owned) && (
                  <div>
                    <div className="text-sm opacity-70 mb-3">Выберите бизнес для покупки. После покупки он появится в «Мои бизнесы».</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {bizList
                        .filter((b: any) => !b.owned)
                        .map((b: any) => (
                          <div key={b.id} className="p-4 border rounded-2xl flex flex-col" style={{ backgroundColor: 'var(--card)' }}>
                            <div className="font-semibold text-lg">{b.emoji} {b.name}</div>
                            <div className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Цена: {fmt(b.price)} {CURRENCY}</div>
                            <div className="text-sm mt-1 mb-4">Потенциал: {fmt(b.income_min)}–{fmt(b.income_max)} {CURRENCY} за задачу</div>
                            <button
                              onClick={() => bizBuy(b.id)}
                              className="mt-auto w-full py-2.5 rounded-2xl text-white font-medium active:scale-[0.985]"
                              style={{ background: 'var(--brand-500)' }}
                            >
                              Купить бизнес
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* When all businesses are bought and we are on "available" (edge case) */}
                {bizSubTab === 'available' && !bizList.some((b: any) => !b.owned) && (
                  <div className="text-sm opacity-70 border rounded-2xl p-4 text-center">
                    Вы приобрели все доступные бизнесы!
                  </div>
                )}
              </div>
            )}

            {activeTab === 'shop' && shop && (
              <div className="mb-4">
                <div className="text-2xl font-bold mb-1">🛒 Магазин</div>
                <div className="text-sm opacity-70 mb-4">Выбирайте товары и управляйте ими в индивидуальных окнах.</div>

                {/* Магазин - товары как отдельные кликабельные карточки */}
                <div className="mb-6">
                  <div className="text-sm font-semibold mb-2 opacity-80">Магазин</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Рейтинг */}
                    <div
                      onClick={() => setSelectedShopItem('rating')}
                      className="p-5 border rounded-3xl cursor-pointer hover:border-[var(--brand-500)] active:scale-[0.99] transition flex flex-col"
                      style={{ backgroundColor: 'var(--card)' }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-4xl">👑</span>
                        <div className="flex-1">
                          <div className="font-semibold text-xl">Рейтинг</div>
                          <div className="text-sm opacity-70">У вас: <b className="tabular-nums">{shop.rating}</b> 👑</div>
                        </div>
                      </div>
                      <div className="mt-auto pt-3 text-xs opacity-60">
                        Цена: {fmt(shop.ratingPrice)} {CURRENCY} / шт • Продажа 60%
                      </div>
                    </div>

                    {/* VIP */}
                    <div
                      onClick={() => setSelectedShopItem('vip')}
                      className="p-5 border rounded-3xl cursor-pointer hover:border-[var(--brand-500)] active:scale-[0.99] transition flex flex-col"
                      style={{ backgroundColor: 'var(--card)' }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-4xl">🌟</span>
                        <div className="flex-1">
                          <div className="font-semibold text-xl">VIP (навсегда)</div>
                          <div className="text-sm opacity-70">{shop.hasVip ? 'У вас есть' : 'Не активирован'}</div>
                        </div>
                      </div>
                      <div className="mt-auto pt-3 text-xs opacity-60">
                        Цена: {fmt(shop.vipPrice)} {CURRENCY} • Постоянные привилегии
                      </div>
                    </div>
                  </div>
                </div>

                {/* Отдельный раздел "Донат" */}
                <div>
                  <div className="text-sm font-semibold mb-2 opacity-80">Донат</div>
                  <div className="p-6 border rounded-3xl text-center" style={{ backgroundColor: 'var(--card)' }}>
                    <div className="text-2xl mb-2">💎 Донат</div>
                    <div className="text-lg font-medium opacity-70">В разработке!</div>
                    <div className="text-sm mt-2 opacity-50 max-w-xs mx-auto">
                      Скоро здесь появятся эксклюзивные предложения, бонусы и поддержка проекта.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Shop item detail window (modal) */}
            {selectedShopItem && shop && (
              <div 
                className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-4"
                onClick={() => setSelectedShopItem(null)}
              >
                <div 
                  className="w-full max-w-lg rounded-3xl border p-6" 
                  style={{ backgroundColor: 'var(--card)' }}
                  onClick={e => e.stopPropagation()}
                >
                  {/* Rating window */}
                  {selectedShopItem === 'rating' && (
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-3 text-2xl font-bold">
                            <span>👑</span> Рейтинг
                          </div>
                          <div className="text-sm mt-1">У вас: <b>{shop.rating}</b> 👑</div>
                        </div>
                        <button onClick={() => setSelectedShopItem(null)} className="text-2xl leading-none opacity-50 hover:opacity-100">×</button>
                      </div>

                      <div className="text-sm mb-4 opacity-70">
                        Рейтинг повышает ваш престиж в таблице лидеров и влияет на видимость.
                      </div>

                      <div className="mb-4 text-sm">
                        Цена покупки: <b>{fmt(shop.ratingPrice)}</b> {CURRENCY} за 1 шт.<br />
                        Цена продажи: <b>{fmt(shop.sellPrice || Math.floor(shop.ratingPrice * 0.6))}</b> {CURRENCY} за 1 шт. (60%)
                      </div>

                      {/* Buy */}
                      <div className="mb-5">
                        <div className="font-semibold mb-2">Купить</div>
                        <div className="flex flex-wrap gap-2">
                          {[1,5,10,25,50,100].map(n => (
                            <button key={n} onClick={() => buyRat(n)} className="px-4 py-2 rounded-2xl border text-sm active:bg-[var(--hover-bg)]">+{n}</button>
                          ))}
                          <button 
                            onClick={() => {
                              const max = Math.floor((profile?.balance || 0) / (shop.ratingPrice || 1));
                              if (max > 0) buyRat(max);
                            }} 
                            className="px-4 py-2 rounded-2xl border text-sm active:bg-[var(--hover-bg)]"
                          >
                            Макс
                          </button>
                        </div>
                      </div>

                      {/* Sell */}
                      <div>
                        <div className="font-semibold mb-2">Продать</div>
                        <div className="flex gap-2 items-center">
                          <input 
                            type="number" 
                            min={1} 
                            max={shop.rating || 1}
                            value={shopSellAmount} 
                            onChange={e => setShopSellAmount(Math.max(1, Math.min(shop.rating || 1, parseInt(e.target.value) || 1)))}
                            className="w-28 px-3 py-2 rounded-2xl border font-mono text-sm"
                            style={{ backgroundColor: 'var(--input-bg)' }}
                          />
                          <button onClick={() => sellRat(shopSellAmount)} className="px-5 py-2 rounded-2xl border text-sm active:bg-[var(--hover-bg)]">Продать</button>
                          <button onClick={() => sellRat(shop.rating || 0)} className="px-4 py-2 rounded-2xl border text-sm active:bg-[var(--hover-bg)]">Всё</button>
                        </div>
                        <div className="text-[10px] mt-1 opacity-60">Можно продать любое количество рейтинга.</div>
                      </div>
                    </div>
                  )}

                  {/* VIP window - no sell */}
                  {selectedShopItem === 'vip' && (
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="flex items-center gap-3 text-2xl font-bold">
                            <span>🌟</span> VIP (навсегда)
                          </div>
                          <div className="text-sm mt-1">{shop.hasVip ? 'У вас активирован' : 'Не куплен'}</div>
                        </div>
                        <button onClick={() => setSelectedShopItem(null)} className="text-2xl leading-none opacity-50 hover:opacity-100">×</button>
                      </div>

                      <div className="text-sm mb-4 opacity-70">
                        Постоянный статус с бонусами.
                      </div>

                      <ul className="text-sm mb-4 list-disc list-inside opacity-80">
                        <li>Ежедневный бонус x1.5</li>
                        <li>Увеличенные лимиты переводов</li>
                        <li>Уникальный бейдж в профиле</li>
                      </ul>

                      <div className="mb-4 text-sm">Цена: <b>{fmt(shop.vipPrice)}</b> {CURRENCY}</div>

                      {!shop.hasVip ? (
                        <button 
                          onClick={buyVip} 
                          className="w-full py-3 rounded-2xl text-black font-semibold active:scale-[0.985]" 
                          style={{ background: '#f59e0b' }}
                        >
                          Купить VIP навсегда
                        </button>
                      ) : (
                        <div className="p-3 rounded-2xl border text-center text-sm">
                          У вас уже есть VIP.<br />
                          <span className="opacity-70">Статус VIP продать нельзя.</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'top' && leaderboard.length > 0 && (
              <div className="bg-white border rounded-3xl overflow-hidden mb-4" style={{backgroundColor:'var(--card)'}}>
                <div className="p-4 font-semibold border-b">🏆 Топ игроков</div>
                {leaderboard.slice(0,8).map((u:any,i:number) => (
                  <div key={i} className="px-4 py-2 flex border-b last:border-0 text-sm">
                    <div className="w-8">#{i+1}</div>
                    <div className="flex-1">{u.display_name}</div>
                    <div>👑 {fmt(u.rating)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Dedicated Casino Profile tab - rich info + transfers moved here */}
            {activeTab === 'profile' && profile && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-2xl font-bold">👤 Профиль в Бутуз Казино</div>
                    <div className="text-sm opacity-70">Вся информация о вашем прогрессе</div>
                  </div>
                  <button onClick={() => setActiveTab(null)} className="text-sm px-3 py-1 border rounded-2xl active:bg-white/10">Закрыть</button>
                </div>

                <div className="bg-white border rounded-3xl p-6 space-y-6" style={{backgroundColor:'var(--card)'}}>
                  {/* Balances - always visible inside casino */}
                  <div>
                    <div className="text-4xl font-bold tabular-nums">{CURRENCY} {profile.balance?.toLocaleString('ru-RU')}</div>
                    <div className="text-sm mt-1 opacity-70">На руках • В банке: {CURRENCY} {profile.bank_balance?.toLocaleString('ru-RU')}</div>
                  </div>

                  {/* Core stats */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div className="p-3 rounded-2xl border" style={{background:'var(--bg)'}}>
                      <div className="text-xs opacity-60">Уровень</div>
                      <div className="text-2xl font-semibold">{profile.level}</div>
                      <div className="text-[10px] opacity-60">XP: {profile.xp}</div>
                    </div>
                    <div className="p-3 rounded-2xl border" style={{background:'var(--bg)'}}>
                      <div className="text-xs opacity-60">Рейтинг</div>
                      <div className="text-2xl font-semibold">👑 {profile.rating}</div>
                      {profile.rank && <div className="text-[10px] opacity-60">Место: #{profile.rank}</div>}
                    </div>
                    <div className="p-3 rounded-2xl border" style={{background:'var(--bg)'}}>
                      <div className="text-xs opacity-60">Игр сыграно</div>
                      <div className="text-2xl font-semibold">{profile.games_played}</div>
                    </div>
                    <div className="p-3 rounded-2xl border flex items-center" style={{background:'var(--bg)'}}>
                      <div>
                        <div className="text-xs opacity-60">Статус</div>
                        <div className="font-semibold">{profile.vip ? '👑 VIP-игрок' : 'Обычный игрок'}</div>
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div>
                    <div className="font-medium mb-1 text-sm">Статистика выигрышей</div>
                    <div className="text-sm opacity-80">Выиграно всего: <span className="font-medium">{CURRENCY} {profile.total_won?.toLocaleString('ru-RU')}</span> • Проиграно: <span className="font-medium">{CURRENCY} {profile.total_lost?.toLocaleString('ru-RU')}</span></div>
                  </div>

                  {/* Transfers - moved here as requested */}
                  <div className="pt-4 border-t">
                    <div className="font-medium mb-2">Переводы кристаллов другим игрокам</div>
                    <div className="flex flex-wrap gap-2">
                      <input 
                        value={transferTo} 
                        onChange={e=>setTransferTo(e.target.value)} 
                        placeholder="username получателя" 
                        className="border px-3 py-2 rounded-2xl flex-1 min-w-[100px] sm:min-w-[140px]" 
                        style={{backgroundColor:'var(--input-bg)'}} 
                      />
                      <input 
                        type="number" 
                        value={transferAmt} 
                        onChange={e=>setTransferAmt(+e.target.value)} 
                        className="border px-3 py-2 rounded-2xl w-40 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" 
                        style={{backgroundColor:'var(--input-bg)'}} 
                      />
                      <button 
                        onClick={doTransfer} 
                        className="px-6 py-2 rounded-2xl text-white active:scale-[0.985]" 
                        style={{background:'var(--brand-500)'}}
                      >
                        Перевести
                      </button>
                    </div>
                    <div className="text-[10px] opacity-60 mt-1">Минимум {TRANSFER_MIN} {CURRENCY}. Лимиты зависят от VIP-статуса.</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'admin' && isButuz && (
              <AdminPanel
                token={token}
                api={api}
                showToast={showToast}
                refreshProfile={refreshProfile}
                isButuz={isButuz}
              />
            )}

            {/* (All legacy admin UI + inspector excised. <AdminPanel/> component above is the only active admin UI.) */}
          </div>
      )}

     {/* GAMES - separate view controlled by hubView tab, not always visible */}
      {hubView === 'games' && (
        <div>
          <div className="text-xl font-semibold mb-3">Игры</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            <button onClick={() => setCurrentGame('slots')} className="bg-white border rounded-3xl p-5 text-left hover:border-[color:var(--brand-500)]" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">🎰</div><div className="font-semibold mt-2">Слоты</div></button>
            {isButuz && (
              <button 
                onClick={() => setCurrentGame('plinko')} 
                className="bg-white border rounded-3xl p-5 text-left hover:border-rose-300 relative" 
                style={{backgroundColor:'var(--card)'}}>
                <div className="text-4xl">🔴</div>
                <div className="font-semibold mt-2">Плинко</div>
                <div className="absolute top-2 right-2 text-[9px] leading-none font-bold px-1.5 py-[1px] rounded bg-red-600 text-white tracking-wider">НЕ ПРОРАБОТАНО</div>
              </button>
            )}
            <button onClick={() => setCurrentGame('mines')} className="bg-white border rounded-3xl p-5 text-left hover:border-red-300" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">💣</div><div className="font-semibold mt-2">Мины</div></button>
            <button onClick={() => setCurrentGame('blackjack')} className="bg-white border rounded-3xl p-5 text-left hover:border-violet-300" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">🃏</div><div className="font-semibold mt-2">Блэкджек</div></button>
            <button onClick={() => setCurrentGame('dice')} className="bg-white border rounded-3xl p-5 text-left" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">🎲</div><div className="font-semibold mt-2">Кости</div></button>
            <button onClick={() => setCurrentGame('roulette')} className="bg-white border rounded-3xl p-5 text-left" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">🎡</div><div className="font-semibold mt-2">Рулетка</div></button>
            <button onClick={() => setCurrentGame('coin')} className="bg-white border rounded-3xl p-5 text-left" style={{backgroundColor:'var(--card)'}}><div className="text-4xl">🪙</div><div className="font-semibold mt-2">Монетка</div></button>
          </div>
        </div>
      )}

     {/* Transfer only shown inside the dedicated casino Profile tab now */}
    </div>
  )}

      {/* Toast notifications (for business task completions etc) */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`pointer-events-auto max-w-xs px-4 py-3 rounded-2xl shadow-xl border text-sm flex items-start gap-2 ${toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'}`}
            >
              <div className="flex-1 pr-2">{toast.message}</div>
              <button
                onClick={() => setToasts((ts) => ts.filter((t) => t.id !== toast.id))}
                className="opacity-50 hover:opacity-100 text-lg leading-none mt-[-2px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================== COIN FLIP VISUAL - premium, distinct faces, much smoother physical animation ======================
function CoinFlip({ isFlipping, finalFace, size = 'normal', onFlipComplete }: {
  isFlipping: boolean;
  finalFace: 'heads' | 'tails';
  size?: 'normal' | 'large';
  onFlipComplete?: () => void;
}) {
  const s = size === 'large' ? 182 : 142;
  const controls = useAnimation();

  // Rich premium coin animation with weight and natural settle + wobble
  useEffect(() => {
    let cancelled = false;

    if (isFlipping) {
      const extraFullSpins = 6 + Math.floor(Math.random() * 2); // 6-7 full rotations — heavy feel
      const finalOffset = finalFace === 'heads' ? 0 : 180;
      const targetY = 360 * extraFullSpins + finalOffset;

      controls.start({
        rotateY: targetY,
        rotateX: [3, -6, 4, -2.5, 0],
        y: [0, -18, 9, -5, 0],
        scale: [1, 1.015, 0.985, 1.01, 1],
        transition: {
          duration: 1.85,
          ease: [0.12, 0.0, 0.08, 1], // long, smooth, powerful deceleration
        }
      });
    } else {
      const baseY = finalFace === 'heads' ? 0 : 180;

      // Main settle with nice spring (weighty)
      controls.start({
        rotateY: baseY,
        rotateX: 0,
        y: 0,
        scale: 1,
        transition: {
          type: 'spring',
          stiffness: 110,
          damping: 13,
          mass: 0.95,
          restDelta: 0.001,
        }
      }).then(() => {
        if (cancelled) return;
        // Subtle realistic wobble as the coin settles flat on the table (2.5 small oscillations)
        controls.start({
          rotateY: [baseY, baseY + 6.5, baseY - 4.2, baseY + 2.1, baseY],
          transition: {
            duration: 0.82,
            ease: [0.32, 0.02, 0.22, 1],
            times: [0, 0.28, 0.55, 0.78, 1],
          }
        });
      });

      // Very slight squash on impact for "clink" feel
      setTimeout(() => {
        if (!cancelled) {
          controls.start({
            scale: [1, 0.96, 1.008, 1],
            transition: { duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }
          });
        }
      }, 260);
    }

    return () => { cancelled = true; };
  }, [isFlipping, finalFace, controls]);

  // Premium expensive coin: bimetallic-style rim, deep engraved gold, completely different faces
  return (
    <div style={{ perspective: '1400px' }}>
      <motion.div
        animate={controls}
        className="relative rounded-full shadow-[0_16px_40px_rgba(0,0,0,0.65),0_4px_12px_rgba(0,0,0,0.4)] select-none"
        style={{
          width: s,
          height: s,
          // Expensive multi-layer gold with brushed/hammered metal feel + strong bevel
          background: `
            radial-gradient(circle at 32% 28%, #fff7d1 0%, #f0d070 12%, #d9a83a 28%, #b37a1f 46%, #7a4f12 65%, #4a2f0a 82%, #2a1a07 95%),
            linear-gradient(138deg, #f4d35e 0%, #e8b923 18%, #c48a1a 42%, #8c5c12 68%, #5c3a0c 100%)
          `,
          border: `${Math.max(8, Math.floor(s * 0.065))}px solid #2f220f`,
          boxShadow: `
            inset 0 22px 32px rgba(255,255,255,0.55),
            inset 0 -26px 34px rgba(0,0,0,0.72),
            inset 22px 0 18px rgba(255,220,140,0.18),
            inset -18px 0 22px rgba(40,20,0,0.55),
            0 0 0 1px #3f2a0f
          `,
        }}
        onAnimationComplete={() => {
          if (!isFlipping && onFlipComplete) onFlipComplete();
        }}
      >
        {/* === HEADS: Орёл — чёткая фигуративная сторона === */}
        <div
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(0deg)',
            background: 'radial-gradient(circle at 50% 46%, #3a2a12 0%, #2a1f0c 62%, #1a1206 100%)',
          }}
        >
          {/* Beaded outer ring */}
          <div className="absolute inset-[6%] rounded-full border border-[#d4af5a]/80" style={{ boxShadow: 'inset 0 0 0 1px rgba(212,175,90,0.4)' }} />

          {/* Main engraved field */}
          <div className="absolute inset-[12%] rounded-full" style={{
            background: 'radial-gradient(circle at 50% 48%, #4a3518 0%, #2f220f 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.7)'
          }} />

          {/* Stylized double-headed eagle (SVG) — главная отличительная черта стороны */}
          <div className="absolute inset-0 flex items-center justify-center" style={{ paddingTop: '1%' }}>
            <svg width="58%" height="58%" viewBox="0 0 100 100" fill="none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.65))' }}>
              {/* Left wing */}
              <path d="M18 52 Q8 36 26 28 Q36 34 40 46" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="2"/>
              {/* Right wing */}
              <path d="M82 52 Q92 36 74 28 Q64 34 60 46" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="2"/>
              {/* Body */}
              <ellipse cx="50" cy="54" rx="10" ry="14" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="1.5"/>
              {/* Left head */}
              <circle cx="37" cy="35" r="5" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="1.2"/>
              {/* Right head */}
              <circle cx="63" cy="35" r="5" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="1.2"/>
              {/* Beaks */}
              <path d="M34 36 L29.5 38.5 L34 39.5" fill="#f4e8c8" stroke="#2a1a07" strokeWidth="0.9"/>
              <path d="M66 36 L70.5 38.5 L66 39.5" fill="#f4e8c8" stroke="#2a1a07" strokeWidth="0.9"/>
              {/* Crown / top detail */}
              <path d="M42 28 L50 23 L58 28" fill="none" stroke="#f4e8c8" strokeWidth="2.2" strokeLinecap="round"/>
              {/* Small chest detail */}
              <circle cx="50" cy="52" r="2.8" fill="#2a1a07" />
            </svg>
          </div>

          {/* Minimal label */}
          <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2 text-[#d4af5a] text-[9.5px] font-semibold tracking-[4.5px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">ОРЁЛ</div>

          {/* Inner bevel */}
          <div className="absolute inset-[10%] rounded-full pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.55), inset 0 8px 12px rgba(255,255,255,0.07)' }} />
        </div>

        {/* === TAILS: Решка — МАКСИМАЛЬНО ПЛОТНАЯ отдельная текстура + новый центральный символ === */}
        <div
          className="absolute inset-0 rounded-full overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            background: 'radial-gradient(circle at 50% 46%, #2f2514 0%, #221b0c 65%, #161107 100%)',
          }}
        >
          {/* Beaded outer ring */}
          <div className="absolute inset-[6%] rounded-full border border-[#c9a05a]/70" style={{ boxShadow: 'inset 0 0 0 1px rgba(201,160,90,0.35)' }} />

          {/* Base field — cooler bronze */}
          <div className="absolute inset-[12%] rounded-full" style={{
            background: 'radial-gradient(circle at 50% 48%, #2f2514 0%, #1c160a 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.75)'
          }} />

          {/* === ЕЩЁ БОЛЕЕ ПЛОТНАЯ текстура решки === */}

          {/* 1. Очень плотные концентрические окружности (guilloche) */}
          <div className="absolute inset-[13%] rounded-full pointer-events-none"
               style={{
                 background: `
                   repeating-radial-gradient(circle at 50% 50%, 
                     rgba(201,160,90,0) 0px, 
                     rgba(201,160,90,0) 1.1px, 
                     rgba(201,160,90,0.38) 1.15px, 
                     rgba(201,160,90,0.38) 1.45px
                   )
                 `,
                 mixBlendMode: 'screen',
               }} />

          {/* 2. Супер-плотные радиальные штрихи (много тонких линий) */}
          <div className="absolute inset-[13%] rounded-full pointer-events-none"
               style={{
                 background: `repeating-conic-gradient(
                   from 0deg at 50% 50%,
                   rgba(201,160,90,0) 0deg 1.15deg,
                   rgba(201,160,90,0.52) 1.18deg 1.35deg
                 )`,
                 mixBlendMode: 'screen',
               }} />

          {/* 3. Ещё один слой радиальных штрихов под небольшим углом (перекрёстная гравировка) */}
          <div className="absolute inset-[13%] rounded-full pointer-events-none"
               style={{
                 background: `repeating-conic-gradient(
                   from 4deg at 50% 50%,
                   rgba(201,160,90,0) 0deg 2.3deg,
                   rgba(201,160,90,0.28) 2.35deg 2.55deg
                 )`,
                 mixBlendMode: 'screen',
               }} />

          {/* 4. Очень мелкая плотная точечная гравировка */}
          <div className="absolute inset-[13%] rounded-full pointer-events-none"
               style={{
                 backgroundImage: `
                   radial-gradient(circle, rgba(201,160,90,0.48) 0.45px, transparent 0.7px),
                   radial-gradient(circle, rgba(201,160,90,0.26) 0.4px, transparent 0.65px)
                 `,
                 backgroundSize: '2.1px 2.1px, 4.2px 4.2px',
                 backgroundPosition: '0 0, 1.05px 1.05px',
               }} />

          {/* 5. Многочисленные плотные концентрические кольца */}
          <div className="absolute inset-[15%] rounded-full border border-[#c9a05a]/35" />
          <div className="absolute inset-[18.5%] rounded-full border border-[#c9a05a]/28" />
          <div className="absolute inset-[22%] rounded-full border border-[#c9a05a]/23" />
          <div className="absolute inset-[25.5%] rounded-full border border-[#c9a05a]/19" />
          <div className="absolute inset-[29%] rounded-full border border-[#c9a05a]/16" />
          <div className="absolute inset-[33%] rounded-full border border-[#c9a05a]/13" />

          {/* Центральный крупный рельефный элемент решки — новый символ (не звезда) */}
          {/* Большой выпуклый медальон */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[31%] h-[31%] rounded-full"
               style={{
                 background: 'radial-gradient(circle at 38% 32%, #d4af5a 0%, #b38a3a 48%, #6b4f1f 78%, #3a2a12 100%)',
                 boxShadow: `
                   inset 0 0 0 1.8px #f4e8c8,
                   0 2px 5px rgba(0,0,0,0.6),
                   inset 0 7px 9px rgba(255,255,255,0.42),
                   inset 0 -6px 8px rgba(0,0,0,0.5)
                 `,
               }} />

          {/* Внутренний тёмный круг */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[14%] h-[14%] rounded-full"
               style={{
                 background: '#2a1f0e',
                 boxShadow: 'inset 0 0 0 1.5px #d4af5a, 0 1px 3px rgba(0,0,0,0.7)',
               }} />

          {/* Новый центральный символ — стилизованная корона / лавровый венок (SVG) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[9%] h-[9%]"
               style={{ transform: 'translate(-50%, -50%)' }}>
            <svg width="100%" height="100%" viewBox="0 0 24 24" fill="none">
              {/* Crown base */}
              <rect x="3" y="15" width="18" height="4" rx="0.5" fill="#d4af5a"/>
              {/* Crown points */}
              <path d="M5 15 L5 8 L8 12 L12 5 L16 12 L19 8 L19 15" fill="#d4af5a" stroke="#f4e8c8" strokeWidth="1.2"/>
              {/* Small jewels on points */}
              <circle cx="8" cy="12" r="1.1" fill="#2a1f0e"/>
              <circle cx="12" cy="5" r="1.1" fill="#2a1f0e"/>
              <circle cx="16" cy="12" r="1.1" fill="#2a1f0e"/>
            </svg>
          </div>

          {/* Минимальная подпись */}
          <div className="absolute bottom-[12%] left-1/2 -translate-x-1/2 text-[#c9a05a] text-[9.5px] font-semibold tracking-[4.5px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]">РЕШКА</div>

          {/* Внутренний скос */}
          <div className="absolute inset-[10%] rounded-full pointer-events-none" style={{ boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.6), inset 0 8px 11px rgba(255,255,255,0.05)' }} />
        </div>

        {/* Ultra-premium thick bevel rim + reeded edge simulation */}
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            border: `${Math.max(6, Math.floor(s * 0.048))}px solid transparent`,
            boxShadow: `
              0 0 0 ${Math.max(5, Math.floor(s * 0.038))}px #3f2a0f,
              inset 0 0 0 1.5px #f4d35e,
              inset 0 12px 18px rgba(255,255,255,0.25),
              inset 0 -14px 20px rgba(0,0,0,0.65)
            `
          }}
        />

        {/* Moving luxury specular highlight (only during toss) */}
        {isFlipping && (
          <motion.div
            className="pointer-events-none absolute inset-0 rounded-full"
            style={{
              background: 'linear-gradient(115deg, transparent 22%, rgba(255,255,255,0.65) 38%, rgba(255,255,255,0.25) 46%, transparent 64%)',
              mixBlendMode: 'screen',
            }}
            animate={{ x: ['-160%', '260%'] }}
            transition={{ duration: 1.05, repeat: Infinity, ease: 'linear' }}
          />
        )}

        {/* Very subtle top surface grain / engraving texture */}
        <div
          className="pointer-events-none absolute inset-[9%] rounded-full opacity-30"
          style={{
            backgroundImage: `
              repeating-linear-gradient(35deg, transparent, transparent 1.6px, rgba(0,0,0,0.18) 1.8px, rgba(0,0,0,0.18) 2.4px),
              repeating-linear-gradient(-55deg, transparent, transparent 2.4px, rgba(255,255,255,0.12) 2.6px, rgba(255,255,255,0.12) 3.1px)
            `,
            backgroundSize: '5.5px 5.5px',
          }}
        />
      </motion.div>
    </div>
  );
}

// Small components
function GameCard({ title, desc, onPlay, extra }: { title: string; desc: string; onPlay: () => void; extra?: React.ReactNode }) {
  return (
    <div className="bg-white border rounded-3xl p-5 flex flex-col">
      <div className="font-semibold text-lg">{title}</div>
      <div className="text-sm text-slate-500 flex-1 mt-1">{desc}</div>
      {extra}
      <button onClick={onPlay} className="mt-3 w-full py-3 rounded-2xl text-white font-medium active:brightness-95" style={{ background: 'var(--brand-gradient)' }}>ИГРАТЬ</button>
    </div>
  );
}

function fmt(n: number) { return (n || 0).toLocaleString('ru-RU').replace(/,/g, ' '); }
function cardStr(c: any) { return c ? `${c.rank}${c.suit}` : '?'; }
function handValue(hand: any[]) {
  let v = 0, ac = 0;
  for (const c of hand || []) {
    if (c.rank === 'A') ac++;
    else if (['J','Q','K'].includes(c.rank)) v += 10;
    else v += parseInt(c.rank || '0');
  }
  for (let i = 0; i < ac; i++) v += (v + 11 <= 21 ? 11 : 1);
  return v;
}
