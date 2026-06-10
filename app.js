/**
 * ============================================================
 * CALCULUS — MENTAL ARITHMETIC TRAINING
 * Enhanced: Decimal Mode + Full Analytics (IndexedDB)
 * ============================================================
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-analytics.js";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/12.14.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCXSx5J7I149bo5qmf0bkFvMzuA6seav-c",
  authDomain: "mental-calculations.firebaseapp.com",
  projectId: "mental-calculations",
  storageBucket: "mental-calculations.firebasestorage.app",
  messagingSenderId: "563028952038",
  appId: "1:563028952038:web:8626a2f3e57ffb78a2cc27",
  measurementId: "G-5DD559MH5J"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ============================================================
// SUBJECT DEFINITIONS
// ============================================================
const SUBJECTS = [
  { id: 'addition',       name: 'Addition',       icon: '+',  symbol: '+' },
  { id: 'subtraction',    name: 'Subtraction',    icon: '−',  symbol: '-' },
  { id: 'multiplication', name: 'Multiplication', icon: '×',  symbol: '×' },
  { id: 'division',       name: 'Division',       icon: '÷',  symbol: '÷' },
  { id: 'bodmas',         name: 'BODMAS',         icon: '( )', symbol: '' }
];

const MODES = ['integer', 'decimal'];

// ============================================================
// INDEXEDDB SETUP — 365-day analytics storage
// ============================================================
let idbDb = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('calculus_analytics', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { autoIncrement: true });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('discipline', 'discipline', { unique: false });
      }
    };
    req.onsuccess = (e) => { idbDb = e.target.result; resolve(idbDb); };
    req.onerror = (e) => reject(e);
  });
}

async function idbSaveRecord(record) {
  if (!idbDb) return;
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction('records', 'readwrite');
    tx.objectStore('records').add(record);
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

async function idbGetAllRecords() {
  if (!idbDb) return [];
  return new Promise((resolve, reject) => {
    const tx = idbDb.transaction('records', 'readonly');
    const req = tx.objectStore('records').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = reject;
  });
}

async function idbPurgeOldRecords() {
  if (!idbDb) return;
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const allRecs = await idbGetAllRecords();
  const tx = idbDb.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  // Re-query with cursor to get keys
  return new Promise((resolve) => {
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        if (cursor.value.timestamp < cutoff) cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = resolve;
  });
}

// ============================================================
// APP STATE
// ============================================================
let state = instantiateDefaultState();
let currentUser = null;

// Analytics period state
let analyticsTab = 'daily';
let analyticsPeriodOffset = 0; // days / weeks / months offset from today

let session = {
  subject: null, subjectName: '', mode: 'integer',
  level: null, questions: [], answers: [], times: [],
  current: 0, streak: 0, timerInterval: null,
  timeLeft: 0, maxTime: 0, questionStart: null,
  totalSolved: 0, totalCorrect: 0, startTime: null
};

// Practice flow state
let practiceSubject = null;
let practiceMode = null;

// ============================================================
// GLOBAL EXPORTS
// ============================================================
window.showScreen              = showScreen;
window.backToSubjectSelect     = backToSubjectSelect;
window.backToModeSelect        = backToModeSelect;
window.selectMode              = selectMode;
window.toggleAuthenticationState = toggleAuthenticationState;
window.submitAnswer            = submitAnswer;
window.bootExecutionSession    = bootExecutionSession;
window.executeSubjectProfiling = executeSubjectProfiling;
window.switchAnalyticsTab      = switchAnalyticsTab;
window.shiftAnalyticsPeriod    = shiftAnalyticsPeriod;
window.goToTodayPeriod         = goToTodayPeriod;
window.exportData              = exportData;

// ============================================================
// AUTH LAYER
// ============================================================
onAuthStateChanged(auth, async (user) => {
  const overlay = document.getElementById('gatewayLockoutOverlay');
  if (user) {
    currentUser = user;
    document.getElementById('authBtn').textContent = 'Sign Out';
    document.getElementById('userGreeting').textContent = `Pilot Vector: ${user.displayName || 'Authorized Human'}`;
    if (overlay) overlay.classList.remove('active');
    state = await loadRemoteUserCloudState(user.uid);
    await openIDB();
    await idbPurgeOldRecords();
    renderDashboardCore();
  } else {
    currentUser = null;
    document.getElementById('authBtn').textContent = 'Sign In';
    document.getElementById('userGreeting').textContent = 'Mental Arithmetic Training';
    state = instantiateDefaultState();
    if (overlay) overlay.classList.add('active');
    showScreen('dashboard');
  }
});

async function toggleAuthenticationState() {
  if (currentUser) {
    try { await signOut(auth); } catch (e) { console.error(e); }
  } else {
    try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); }
  }
}

// ============================================================
// STATE / FIRESTORE PERSISTENCE
// ============================================================
async function loadRemoteUserCloudState(uid) {
  try {
    const ref = doc(db, "users", uid, "state", "calculus_data");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      if (data.subjects && data.history) return mergeStateSafetyChecks(data);
    } else {
      const fresh = instantiateDefaultState();
      await setDoc(ref, fresh);
      return fresh;
    }
  } catch (e) { console.error(e); }
  return instantiateDefaultState();
}

function instantiateDefaultState() {
  const subjects = {};
  SUBJECTS.forEach(s => {
    subjects[s.id] = {
      integer: { level: 1, clearedLevels: [], totalQ: 0, totalCorrect: 0, bestStreak: 0, totalTime: 0 },
      decimal: { level: 1, clearedLevels: [], totalQ: 0, totalCorrect: 0, bestStreak: 0, totalTime: 0 }
    };
  });
  return {
    subjects,
    bestStreak: 0,
    totalQ: 0,
    totalCorrect: 0,
    totalTime: 0,
    history: [],
    // streak tracking
    lastPracticeDay: null,
    currentDayStreak: 0,
    longestDayStreak: 0
  };
}

function mergeStateSafetyChecks(incoming) {
  const base = instantiateDefaultState();
  base.bestStreak        = incoming.bestStreak || 0;
  base.totalQ            = incoming.totalQ || 0;
  base.totalCorrect      = incoming.totalCorrect || 0;
  base.totalTime         = incoming.totalTime || 0;
  base.history           = incoming.history || [];
  base.lastPracticeDay   = incoming.lastPracticeDay || null;
  base.currentDayStreak  = incoming.currentDayStreak || 0;
  base.longestDayStreak  = incoming.longestDayStreak || 0;

  SUBJECTS.forEach(s => {
    if (incoming.subjects && incoming.subjects[s.id]) {
      const inc = incoming.subjects[s.id];
      // Handle legacy single-mode format
      if (inc.level !== undefined && inc.clearedLevels !== undefined) {
        // old format — migrate to integer
        base.subjects[s.id].integer = {
          level: inc.level || 1,
          clearedLevels: inc.clearedLevels || [],
          totalQ: inc.totalQ || 0,
          totalCorrect: inc.totalCorrect || 0,
          bestStreak: inc.bestStreak || 0,
          totalTime: inc.totalTime || 0
        };
      } else {
        // new dual-mode format
        ['integer', 'decimal'].forEach(m => {
          if (inc[m]) {
            base.subjects[s.id][m] = {
              level:         inc[m].level || 1,
              clearedLevels: inc[m].clearedLevels || [],
              totalQ:        inc[m].totalQ || 0,
              totalCorrect:  inc[m].totalCorrect || 0,
              bestStreak:    inc[m].bestStreak || 0,
              totalTime:     inc[m].totalTime || 0
            };
          }
        });
      }
    }
  });
  return base;
}

async function saveStatePipeline() {
  if (!currentUser) return;
  try {
    const ref = doc(db, "users", currentUser.uid, "state", "calculus_data");
    await setDoc(ref, state);
  } catch (e) { console.error(e); }
}

// ============================================================
// DAY STREAK TRACKING
// ============================================================
function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function updateDayStreak() {
  const today = getTodayKey();
  if (state.lastPracticeDay === today) return; // already counted today

  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  })();

  if (state.lastPracticeDay === yesterday) {
    state.currentDayStreak = (state.currentDayStreak || 0) + 1;
  } else {
    state.currentDayStreak = 1;
  }
  state.lastPracticeDay = today;
  if (state.currentDayStreak > (state.longestDayStreak || 0)) {
    state.longestDayStreak = state.currentDayStreak;
  }
}

// ============================================================
// QUESTION GENERATORS — INTEGER MODE
// ============================================================
function generateBounds(level) {
  if (level === 1)  return { min: 2,     max: 9 };
  if (level === 2)  return { min: 10,    max: 25 };
  if (level === 3)  return { min: 10,    max: 50 };
  if (level === 4)  return { min: 20,    max: 99 };
  if (level <= 7)   return { min: 50,    max: 250 };
  if (level <= 12)  return { min: 100,   max: 999 };
  if (level <= 20)  return { min: 500,   max: 4999 };
  if (level <= 40)  return { min: 2000,  max: 15000 };
  return { min: 10000, max: 999999 };
}

function generateIntegerQuestion(subjectId, level) {
  const b = generateBounds(level);
  switch (subjectId) {
    case 'addition': {
      const a = rand(b.min, b.max), x = rand(b.min, b.max);
      return { expr: `${a} + ${x}`, answer: a + x };
    }
    case 'subtraction': {
      let a = rand(b.min, b.max), x = rand(b.min, b.max);
      if (a < x) [a, x] = [x, a];
      return { expr: `${a} − ${x}`, answer: a - x };
    }
    case 'multiplication': {
      const mMin = Math.max(2, Math.floor(b.min * 0.1));
      const mMax = Math.max(9, Math.floor(b.max * 0.1));
      const a = rand(mMin, mMax);
      const x = level <= 3 ? rand(2, 9) : rand(mMin, Math.min(mMax, 100));
      return { expr: `${a} × ${x}`, answer: a * x };
    }
    case 'division': {
      const dMin = Math.max(2, Math.floor(b.min * 0.1));
      const dMax = Math.max(9, Math.floor(b.max * 0.1));
      const divisor = rand(dMin, Math.min(dMax, 100));
      const quotient = rand(2, Math.max(9, level * 3));
      return { expr: `${divisor * quotient} ÷ ${divisor}`, answer: quotient };
    }
    case 'bodmas':
      return generateBodmasInteger(level);
  }
}

function generateBodmasInteger(level) {
  if (level === 1) {
    const b = rand(2, 6), c = rand(2, 6), a = rand(2, 15);
    return { expr: `${a} + ${b} × ${c}`, answer: a + b * c };
  }
  if (level === 2) {
    const b = rand(2, 9), c = rand(2, 9), a = rand(10, 30), d = rand(2, 10);
    return { expr: `${a} + ${b} × ${c} − ${d}`, answer: a + b * c - d };
  }
  if (level <= 5) {
    const c = rand(2, 9), b = rand(2, 12), a = b + rand(2, 10), d = rand(5, 25);
    return { expr: `(${a} − ${b}) × ${c} + ${d}`, answer: (a - b) * c + d };
  }
  if (level <= 15) {
    const b = rand(3, 9), mult = rand(2, 8), a = b * mult;
    const c = rand(2, 10), e = rand(2, 6), d = e + rand(2, 6);
    return { expr: `(${a} ÷ ${b} + ${c}) × (${d} − ${e})`, answer: (mult + c) * (d - e) };
  }
  const a = rand(2, 9), b = rand(3, 15), c = rand(2, 10), d = rand(2, 9), e = rand(2, 9);
  return { expr: `${a} × (${b} + ${c}) − ${d} × ${e}`, answer: a * (b + c) - d * e };
}

// ============================================================
// QUESTION GENERATORS — DECIMAL MODE
// ============================================================
function roundTo(val, places) {
  return Math.round(val * Math.pow(10, places)) / Math.pow(10, places);
}

function randFloat(min, max, decimals) {
  const v = Math.random() * (max - min) + min;
  return roundTo(v, decimals);
}

function generateDecimalQuestion(subjectId, level) {
  switch (subjectId) {
    case 'addition':       return generateDecimalAddition(level);
    case 'subtraction':    return generateDecimalSubtraction(level);
    case 'multiplication': return generateDecimalMultiplication(level);
    case 'division':       return generateDecimalDivision(level);
    case 'bodmas':         return generateDecimalBodmas(level);
  }
}

function ensureDecimal(q) {
  // Validate constraint: at least one operand or answer must be decimal
  const hasDecimalOperand = q.expr.match(/\d+\.\d+/);
  const hasDecimalAnswer = !Number.isInteger(q.answer);
  return hasDecimalOperand || hasDecimalAnswer;
}

function generateDecimalAddition(level) {
  let a, b, answer, expr;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (level === 1) {
      a = randFloat(0, 20, 1); b = randFloat(0, 20, 1);
    } else if (level === 2) {
      a = randFloat(0, 100, 1); b = randFloat(0, 100, 1);
    } else if (level === 3) {
      a = randFloat(0, 100, 2); b = randFloat(0, 100, 2);
    } else if (level === 4) {
      a = randFloat(0, 1000, 2); b = randFloat(0, 1000, 2);
    } else {
      a = randFloat(0, 1000, 3); b = randFloat(0, 1000, 3);
    }
    answer = roundTo(a + b, 3);
    expr = `${a} + ${b}`;
    const q = { expr, answer };
    if (ensureDecimal(q)) return q;
  }
  // Fallback guarantee
  a = randFloat(1, 20, 1) + 0.1; b = rand(1, 10);
  return { expr: `${a} + ${b}`, answer: roundTo(a + b, 3) };
}

function generateDecimalSubtraction(level) {
  let a, b, answer, expr;
  for (let attempt = 0; attempt < 20; attempt++) {
    const dp = level <= 2 ? 1 : (level <= 4 ? 2 : 3);
    const range = level <= 2 ? 50 : (level <= 4 ? 200 : 1000);
    a = randFloat(range * 0.3, range, dp);
    b = randFloat(0, a, dp);
    a = roundTo(a, dp); b = roundTo(b, dp);
    answer = roundTo(a - b, 3);
    expr = `${a} − ${b}`;
    const q = { expr, answer };
    if (ensureDecimal(q) && answer >= 0) return q;
  }
  a = randFloat(5, 20, 1) + 0.3; b = randFloat(0, a - 0.1, 1);
  return { expr: `${a} − ${b}`, answer: roundTo(a - b, 3) };
}

function generateDecimalMultiplication(level) {
  let a, b, answer, expr;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (level === 1) {
      a = rand(1, 20); b = randFloat(0.1, 0.9, 1);
    } else if (level === 2) {
      a = randFloat(1, 10, 1); b = randFloat(1, 10, 1);
    } else if (level === 3) {
      a = randFloat(1, 20, 2); b = randFloat(1, 5, 2);
    } else if (level === 4) {
      a = randFloat(10, 50, 1); b = randFloat(1, 10, 1);
    } else {
      a = randFloat(1, 20, 3); b = randFloat(1, 5, 3);
    }
    answer = roundTo(a * b, 3);
    expr = `${a} × ${b}`;
    const q = { expr, answer };
    if (ensureDecimal(q)) return q;
  }
  a = rand(2, 15); b = 0.5;
  return { expr: `${a} × ${b}`, answer: a * b };
}

function generateDecimalDivision(level) {
  // Generate guaranteed exact decimal answers
  for (let attempt = 0; attempt < 30; attempt++) {
    let dividend, divisor, answer;
    if (level === 1) {
      divisor = rand(2, 10);
      const mult = rand(1, 20);
      const rem = rand(1, divisor - 1);
      dividend = divisor * mult + rem;
      answer = roundTo(dividend / divisor, 1);
      if (Number.isInteger(answer)) continue;
      return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else if (level === 2) {
      divisor = rand(2, 20);
      const q = rand(1, 10) + randFloat(0.1, 0.9, 1);
      dividend = roundTo(divisor * q, 1);
      answer = roundTo(dividend / divisor, 2);
      if (Number.isInteger(answer)) continue;
      return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else if (level === 3) {
      divisor = rand(2, 20);
      const q = rand(1, 20);
      const adjDividend = divisor * q + (rand(1, divisor - 1));
      answer = roundTo(adjDividend / divisor, 2);
      if (Number.isInteger(answer)) continue;
      return { expr: `${adjDividend} ÷ ${divisor}`, answer };
    } else if (level === 4) {
      divisor = rand(4, 25);
      const q = rand(2, 30);
      const rem = rand(1, divisor - 1);
      const ddv = divisor * q + rem;
      answer = roundTo(ddv / divisor, 3);
      if (Number.isInteger(answer)) continue;
      return { expr: `${ddv} ÷ ${divisor}`, answer };
    } else {
      // Level 5: decimal dividend
      const divisorD = randFloat(1.5, 5, 1);
      const dividendD = randFloat(5, 50, 1);
      answer = roundTo(dividendD / divisorD, 3);
      if (Number.isInteger(answer)) continue;
      return { expr: `${dividendD} ÷ ${divisorD}`, answer };
    }
  }
  // Fallback
  return { expr: `10 ÷ 4`, answer: 2.5 };
}

function generateDecimalBodmas(level) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let expr, answer;
    if (level === 1) {
      const a = randFloat(1, 5, 1), b = rand(1, 5), c = rand(1, 5);
      answer = roundTo(a + b * c, 3);
      expr = `${a} + ${b} × ${c}`;
    } else if (level === 2) {
      const a = rand(2, 8), b = randFloat(1, 5, 1), c = rand(2, 8);
      answer = roundTo((a + b) * c, 3);
      expr = `(${a} + ${b}) × ${c}`;
    } else if (level === 3) {
      const a = randFloat(2, 10, 1), b = rand(2, 5), c = randFloat(1, 4, 1);
      answer = roundTo(a * b - c, 3);
      expr = `${a} × ${b} − ${c}`;
    } else if (level === 4) {
      const a = rand(5, 20), b = randFloat(1, 4, 1), c = rand(2, 10);
      answer = roundTo(a / b + c, 3);
      expr = `${a} ÷ ${b} + ${c}`;
    } else {
      const a = randFloat(2, 8, 1), b = rand(2, 5), c = randFloat(1, 3, 1), d = rand(2, 6);
      answer = roundTo((a + b) * c - d, 3);
      expr = `(${a} + ${b}) × ${c} − ${d}`;
    }
    const q = { expr, answer };
    if (ensureDecimal(q)) return q;
  }
  return { expr: `(2.5 + 3) × 4`, answer: 22 };
}

// ============================================================
// UNIFIED QUESTION DISPATCHER
// ============================================================
function generateQuestion(subjectId, level, mode = 'integer') {
  if (mode === 'decimal') return generateDecimalQuestion(subjectId, level);
  return generateIntegerQuestion(subjectId, level);
}

// Decimal answer tolerance
const DECIMAL_TOLERANCE = 0.001;

function isAnswerCorrect(userVal, correctVal, mode) {
  if (isNaN(userVal)) return false;
  if (mode === 'decimal') {
    return Math.abs(userVal - correctVal) < DECIMAL_TOLERANCE;
  }
  return userVal === correctVal;
}

// ============================================================
// TIMING
// ============================================================
function getAdaptiveTimeLimit(subjectId, level, mode) {
  const base = {
    addition:       [6, 8, 10, 14, 18, 25],
    subtraction:    [6, 8, 10, 14, 18, 25],
    multiplication: [8, 10, 12, 16, 22, 30],
    division:       [8, 10, 12, 18, 25, 35],
    bodmas:         [10, 14, 18, 24, 35, 50]
  };
  const tier = base[subjectId];
  const idx = Math.min(Math.floor((level - 1) / 3), tier.length - 1);
  const t = tier[idx];
  // Decimal gets 50% more time
  return mode === 'decimal' ? Math.round(t * 1.5) : t;
}

function fetchQuestionsPerSession(level) {
  if (level <= 2)  return 6;
  if (level <= 6)  return 8;
  if (level <= 15) return 10;
  return 12;
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseFormattedDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  return `${m}m ${rs}s`;
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function showScreen(screenId) {
  if ((screenId === 'practice' || screenId === 'analytics') && !currentUser) {
    toggleAuthenticationState();
    return;
  }

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));

  const id = 'screen' + screenId.charAt(0).toUpperCase() + screenId.slice(1);
  const target = document.getElementById(id);
  if (target) target.classList.add('active');

  const navMap = { dashboard: 'navDash', practice: 'navPractice', analytics: 'navAnalytics' };
  const navBtn = document.getElementById(navMap[screenId]);
  if (navBtn) navBtn.classList.add('active');

  if (screenId !== 'practice') clearInterval(session.timerInterval);

  if (screenId === 'dashboard')  renderDashboardCore();
  if (screenId === 'practice')   initializePracticeRoutingView();
  if (screenId === 'analytics')  initAnalyticsView();
}

// ============================================================
// DASHBOARD RENDERING
// ============================================================
function renderDashboardCore() {
  const totalQ = state.totalQ || 0;
  const acc = totalQ > 0 ? Math.round((state.totalCorrect / totalQ) * 100) : 0;
  let clearedTotal = 0;
  SUBJECTS.forEach(s => {
    clearedTotal += state.subjects[s.id].integer.clearedLevels.length;
    clearedTotal += state.subjects[s.id].decimal.clearedLevels.length;
  });

  document.getElementById('statTotalQ').textContent       = totalQ;
  document.getElementById('statAccuracy').textContent     = totalQ > 0 ? `${acc}%` : '—';
  document.getElementById('statBestStreak').textContent   = state.bestStreak || 0;
  document.getElementById('statLevels').textContent       = clearedTotal;
  document.getElementById('statTime').textContent         = parseFormattedDuration(state.totalTime || 0);
  document.getElementById('statDayStreak').textContent    = state.currentDayStreak || 0;

  // Today summary
  renderTodaySummary();

  // Subject cards
  const grid = document.getElementById('subjectsGrid');
  grid.innerHTML = '';
  SUBJECTS.forEach(s => {
    const intData = state.subjects[s.id].integer;
    const decData = state.subjects[s.id].decimal;
    const totQ = intData.totalQ + decData.totalQ;
    const totC = intData.totalCorrect + decData.totalCorrect;
    const subAcc = totQ > 0 ? Math.round((totC / totQ) * 100) : null;
    const cleared = intData.clearedLevels.length + decData.clearedLevels.length;
    const levelPct = Math.min(cleared * 5, 100);

    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
      <span class="subject-icon">${s.icon}</span>
      <span class="subject-level-badge">Int. Lv ${intData.level}</span>
      <div class="subject-name">${s.name}</div>
      <div class="subject-meta">${subAcc !== null ? `${subAcc}% accuracy · ${cleared} steps cleared` : 'No sessions yet'}</div>
      <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${levelPct}%"></div></div>
    `;
    card.addEventListener('click', () => {
      if (!currentUser) { toggleAuthenticationState(); return; }
      showScreen('practice');
      executeSubjectProfiling(s.id);
    });
    grid.appendChild(card);
  });

  renderLogStack();
}

async function renderTodaySummary() {
  if (!idbDb) return;
  const allRecs = await idbGetAllRecords();
  const todayStr = getTodayKey();
  const todayRecs = allRecs.filter(r => {
    const d = new Date(r.timestamp);
    const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    return k === todayStr;
  });

  const totalQ = todayRecs.length;
  const correct = todayRecs.filter(r => r.correct).length;
  const acc = totalQ > 0 ? Math.round((correct / totalQ) * 100) + '%' : '—';
  const avgTime = totalQ > 0 ? (todayRecs.reduce((a, r) => a + r.timeTaken, 0) / totalQ).toFixed(1) + 's' : '—';
  const sessions = new Set(todayRecs.map(r => r.sessionId)).size;

  document.getElementById('todayQ').textContent       = totalQ;
  document.getElementById('todayAcc').textContent     = acc;
  document.getElementById('todaySpeed').textContent   = avgTime;
  document.getElementById('todaySessions').textContent = sessions;
}

function renderLogStack() {
  const container = document.getElementById('historyList');
  container.innerHTML = '';
  const logs = (state.history || []).slice(-6).reverse();
  if (!logs.length) {
    container.innerHTML = `<div style="color:var(--steel);font-size:0.85rem;padding:1rem 0;">No sessions yet. Run baseline calculations.</div>`;
    return;
  }
  logs.forEach(log => {
    const cls = log.perfect ? 'perfect' : (log.correct === 0 ? 'failed' : '');
    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div class="history-left">
        <div class="history-dot ${cls}"></div>
        <div>
          <div class="history-subject">${log.subjectName} · ${log.mode === 'decimal' ? 'Decimal' : 'Integer'} · Level ${log.level}</div>
          <div class="history-detail">${log.correct} / ${log.total} · ${parseFormattedDuration(log.elapsed)}</div>
        </div>
      </div>
      <div class="history-score">${log.accuracy}%</div>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// PRACTICE ROUTING VIEW
// ============================================================
function initializePracticeRoutingView() {
  document.getElementById('noSubjectMsg').classList.remove('hidden');
  document.getElementById('modeSelectMsg').classList.add('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
  document.getElementById('sessionMeta').classList.add('hidden');
  document.getElementById('sessionProgress').classList.add('hidden');
  document.getElementById('questionView').classList.remove('active');
  document.getElementById('subjectSelectView').style.display = '';

  const selGrid = document.getElementById('practiceSubjectsGrid');
  selGrid.innerHTML = '';

  SUBJECTS.forEach(s => {
    const intData = state.subjects[s.id].integer;
    const decData = state.subjects[s.id].decimal;
    const cleared = intData.clearedLevels.length + decData.clearedLevels.length;
    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
      <span class="subject-icon">${s.icon}</span>
      <span class="subject-level-badge">Int Lv ${intData.level}</span>
      <div class="subject-name">${s.name}</div>
      <div class="subject-meta">${cleared} steps cleared</div>
      <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${Math.min(cleared * 5, 100)}%"></div></div>
    `;
    card.addEventListener('click', () => executeSubjectProfiling(s.id));
    selGrid.appendChild(card);
  });
}

function backToSubjectSelect() {
  practiceSubject = null;
  practiceMode = null;
  document.getElementById('noSubjectMsg').classList.remove('hidden');
  document.getElementById('modeSelectMsg').classList.add('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
}

function backToModeSelect() {
  practiceMode = null;
  document.getElementById('modeSelectMsg').classList.remove('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
}

function executeSubjectProfiling(subjectId) {
  practiceSubject = subjectId;
  const profile = SUBJECTS.find(x => x.id === subjectId);
  const intData = state.subjects[subjectId].integer;
  const decData = state.subjects[subjectId].decimal;

  document.getElementById('noSubjectMsg').classList.add('hidden');
  document.getElementById('modeSelectMsg').classList.remove('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
  document.getElementById('modeSelectTitle').textContent = profile.name;

  document.getElementById('modeBadgeInteger').textContent = `Level ${intData.level} · ${intData.clearedLevels.length} cleared`;
  document.getElementById('modeBadgeDecimal').textContent = `Level ${decData.level} · ${decData.clearedLevels.length} cleared`;
}

function selectMode(mode) {
  practiceMode = mode;
  const profile = SUBJECTS.find(x => x.id === practiceSubject);
  const modeData = state.subjects[practiceSubject][mode];

  document.getElementById('modeSelectMsg').classList.add('hidden');
  document.getElementById('levelSelectMsg').classList.remove('hidden');
  document.getElementById('levelSelectTitle').textContent = `${profile.name} · ${mode === 'decimal' ? 'Decimal' : 'Integer'} Mode`;
  document.getElementById('levelSelectSub').textContent = `Current level: ${modeData.level}. Perfect evaluation (100%) required to advance.`;

  buildLevelSelectionRows(practiceSubject, mode);
}

function buildLevelSelectionRows(subjectId, mode) {
  const modeData = state.subjects[subjectId][mode];
  const container = document.getElementById('levelSelector');
  container.innerHTML = '';
  const maxLv = Math.max(modeData.level + 4, 8);

  for (let lv = 1; lv <= maxLv; lv++) {
    const cleared  = modeData.clearedLevels.includes(lv);
    const active   = lv === modeData.level;
    const locked   = lv > modeData.level;

    const sample = generateQuestion(subjectId, lv, mode);
    const row = document.createElement('div');
    row.className = `level-row${locked ? ' locked' : ''}${active ? ' current' : ''}`;
    row.innerHTML = `
      <div class="level-num">Level ${lv}</div>
      <div class="level-desc" style="color:${locked ? 'var(--steel)' : 'var(--white)'}">
        ${sample.expr.length > 35 ? sample.expr.slice(0, 32) + '…' : sample.expr}
      </div>
      <div class="level-status ${cleared ? 'cleared' : (active ? 'current' : 'locked')}">
        ${cleared ? 'Cleared' : (active ? 'Active' : 'Locked')}
      </div>
    `;
    if (!locked) row.addEventListener('click', () => window.bootExecutionSession(subjectId, mode, lv));
    container.appendChild(row);
  }
}

// ============================================================
// SESSION BOOT & CONTROL
// ============================================================
function bootExecutionSession(subjectId, mode, level) {
  const discipline = SUBJECTS.find(x => x.id === subjectId);
  const total = fetchQuestionsPerSession(level);
  const questions = [];
  for (let i = 0; i < total; i++) questions.push(generateQuestion(subjectId, level, mode));

  session = {
    subject: subjectId,
    subjectName: discipline.name,
    mode,
    level,
    questions,
    answers: [],
    times: [],
    current: 0,
    streak: 0,
    timerInterval: null,
    timeLeft: 0,
    maxTime: getAdaptiveTimeLimit(subjectId, level, mode),
    questionStart: null,
    totalSolved: 0,
    totalCorrect: 0,
    startTime: Date.now(),
    sessionId: Date.now().toString(36)
  };

  document.getElementById('subjectSelectView').style.display = 'none';
  document.getElementById('sessionMeta').classList.remove('hidden');
  document.getElementById('sessionProgress').classList.remove('hidden');
  document.getElementById('questionView').classList.add('active');

  document.getElementById('metaSubject').textContent = discipline.name;
  document.getElementById('metaMode').textContent    = mode === 'decimal' ? 'Decimal' : 'Integer';
  document.getElementById('metaLevel').textContent   = level;
  document.getElementById('metaStreak').textContent  = 0;
  document.getElementById('metaScore').textContent   = `0 / ${total}`;

  const arc = document.getElementById('timerArc');
  if (arc) {
    const circ = 2 * Math.PI * 48;
    arc.style.strokeDasharray = circ;
    arc.style.strokeDashoffset = 0;
  }

  executeDisplayLoop();
}

function executeDisplayLoop() {
  const q = session.questions[session.current];
  const total = session.questions.length;

  document.getElementById('questionNum').textContent  = `Evaluation ${session.current + 1} of ${total}`;
  document.getElementById('questionExpr').textContent = q.expr;

  const inp = document.getElementById('answerInput');
  inp.value = '';
  inp.className = 'answer-input';
  inp.disabled = false;

  document.getElementById('feedbackMsg').textContent = '';
  document.getElementById('feedbackMsg').className   = 'feedback-msg';
  document.getElementById('submitBtn').disabled       = false;
  document.getElementById('sessionProgressFill').style.width = `${(session.current / total) * 100}%`;

  inp.focus();
  session.questionStart = Date.now();
  engageTimerSubsystem();
}

function engageTimerSubsystem() {
  clearInterval(session.timerInterval);
  session.timeLeft = session.maxTime;
  const num = document.getElementById('timerNumber');
  if (num) num.textContent = session.timeLeft;

  session.timerInterval = setInterval(() => {
    session.timeLeft--;
    synchronizeTimerGraphics();
    if (session.timeLeft <= 0) {
      clearInterval(session.timerInterval);
      processTimeoutFault();
    }
  }, 1000);
}

function synchronizeTimerGraphics() {
  const arc = document.getElementById('timerArc');
  const num = document.getElementById('timerNumber');
  if (!num) return;
  num.textContent = session.timeLeft;
  if (!arc) return;

  const circ = 2 * Math.PI * 48;
  const ratio = Math.max(0, session.timeLeft / session.maxTime);
  arc.style.strokeDasharray  = circ;
  arc.style.strokeDashoffset = circ * (1 - ratio);
  arc.classList.remove('warning', 'critical');
  if (ratio <= 0.25) arc.classList.add('critical');
  else if (ratio <= 0.5) arc.classList.add('warning');
}

function processTimeoutFault() {
  const q = session.questions[session.current];
  const dt = Date.now() - session.questionStart;

  session.answers.push({ chosenValue: null, statusCorrect: false, expression: q.expr, actualValue: q.answer });
  session.times.push(dt);
  session.streak = 0;

  const inp = document.getElementById('answerInput');
  inp.value = 'Time Limit Exceeded';
  inp.className = 'answer-input wrong';
  inp.disabled = true;

  const msg = document.getElementById('feedbackMsg');
  msg.textContent = `Time expired. Correct: ${q.answer}`;
  msg.className = 'feedback-msg wrong';
  document.getElementById('submitBtn').disabled = true;

  refreshLiveSessionMetaChips();
  setTimeout(advanceSessionQueue, 1800);
}

function submitAnswer() {
  const inp = document.getElementById('answerInput');
  const raw = inp.value.trim();
  if (raw === '') return;

  const userVal = parseFloat(raw);
  const q = session.questions[session.current];
  const dt = Date.now() - session.questionStart;

  clearInterval(session.timerInterval);
  const correct = isAnswerCorrect(userVal, q.answer, session.mode);

  inp.disabled = true;
  document.getElementById('submitBtn').disabled = true;

  const msg = document.getElementById('feedbackMsg');

  if (correct) {
    session.streak++;
    session.totalCorrect++;
    inp.className = 'answer-input correct';
    msg.className = 'feedback-msg correct';
    const affirm = ['Execution Verified', 'Precision Nominal', 'Exact Match', 'Compliance Met'];
    msg.textContent = affirm[session.current % affirm.length];
  } else {
    session.streak = 0;
    inp.value = `Fault: ${raw}`;
    inp.className = 'answer-input wrong';
    msg.className = 'feedback-msg wrong';
    msg.textContent = `Incorrect. Answer: ${q.answer}`;
  }

  session.answers.push({ chosenValue: userVal, statusCorrect: correct, expression: q.expr, actualValue: q.answer });
  session.times.push(dt);
  session.totalSolved++;

  refreshLiveSessionMetaChips();
  setTimeout(advanceSessionQueue, correct ? 1000 : 2000);
}

function advanceSessionQueue() {
  session.current++;
  if (session.current >= session.questions.length) {
    terminateProcessingSession();
  } else {
    executeDisplayLoop();
  }
}

function refreshLiveSessionMetaChips() {
  document.getElementById('metaStreak').textContent = session.streak;
  document.getElementById('metaScore').textContent  = `${session.totalCorrect} / ${session.questions.length}`;
}

// ============================================================
// SESSION TERMINATION & STATE UPDATE
// ============================================================
async function terminateProcessingSession() {
  clearInterval(session.timerInterval);

  const total    = session.questions.length;
  const correct  = session.answers.filter(x => x.statusCorrect).length;
  const perfect  = correct === total;
  const elapsed  = Date.now() - session.startTime;
  const accuracy = Math.round((correct / total) * 100);

  const correctTimes = session.times.filter((_, i) => session.answers[i]?.statusCorrect);
  const meanTime = correctTimes.length ? Math.round(correctTimes.reduce((a, b) => a + b, 0) / correctTimes.length) : 0;
  const peakTime = correctTimes.length ? Math.min(...correctTimes) : 0;

  // Update mode-specific state
  const modeData = state.subjects[session.subject][session.mode];
  modeData.totalQ        += total;
  modeData.totalCorrect  += correct;
  modeData.totalTime     += elapsed;
  if (session.streak > modeData.bestStreak) modeData.bestStreak = session.streak;

  if (perfect) {
    if (!modeData.clearedLevels.includes(session.level)) modeData.clearedLevels.push(session.level);
    if (session.level === modeData.level) modeData.level = session.level + 1;
  }

  // Update global state
  state.totalQ        += total;
  state.totalCorrect  += correct;
  state.totalTime     += elapsed;
  if (session.streak > state.bestStreak) state.bestStreak = session.streak;

  updateDayStreak();

  state.history.push({
    subjectName: session.subjectName,
    mode: session.mode,
    level: session.level,
    correct, total, elapsed, perfect, accuracy,
    date: Date.now()
  });
  if (state.history.length > 80) state.history.shift();

  // Save per-question records to IndexedDB
  if (idbDb) {
    for (let i = 0; i < session.questions.length; i++) {
      const ans = session.answers[i];
      await idbSaveRecord({
        timestamp:  session.startTime + (session.times[i] || 0),
        discipline: session.subjectName,
        section:    session.mode,
        level:      session.level,
        question:   session.questions[i].expr,
        answer:     session.questions[i].answer,
        userAnswer: ans ? ans.chosenValue : null,
        correct:    ans ? ans.statusCorrect : false,
        timeTaken:  ans ? (session.times[i] || 0) / 1000 : 0,
        sessionId:  session.sessionId
      });
    }
  }

  displayTerminalOverlay(perfect, correct, total, accuracy, meanTime, peakTime);

  try { await saveStatePipeline(); } catch (e) { console.error(e); }
}

function displayTerminalOverlay(isPass, correct, total, accuracy, meanTime, peakTime) {
  const overlay = document.getElementById('resultOverlay');
  overlay.className = 'result-overlay active';

  document.getElementById('resultStatus').textContent  = isPass ? 'Task Profile Clear' : 'Discipline Standards Deviation';
  const heading = document.getElementById('resultHeading');
  heading.textContent = isPass ? 'Mastery Achieved.' : 'Precision Threshold Fault.';
  heading.className   = `result-heading ${isPass ? 'success' : 'failure'}`;

  document.getElementById('resultSub').textContent = isPass
    ? `All ${correct} operations solved correctly. Next level unlocked.`
    : `Compliance index: ${correct} / ${total}. 100% accuracy required to advance.`;

  document.getElementById('resAcc').textContent     = `${accuracy}%`;
  document.getElementById('resAvgTime').textContent = meanTime ? `${(meanTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resBest').textContent    = peakTime ? `${(peakTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resStreak').textContent  = session.streak;

  const btns = document.getElementById('resultBtns');
  btns.innerHTML = '';

  const primary = document.createElement('button');
  primary.className = 'btn-primary';
  primary.textContent = isPass ? 'Advance to Next Level' : 'Retry';
  primary.onclick = () => {
    overlay.className = 'result-overlay';
    const nextLv = isPass ? state.subjects[session.subject][session.mode].level : session.level;
    window.bootExecutionSession(session.subject, session.mode, nextLv);
  };
  btns.appendChild(primary);

  const sec = document.createElement('button');
  sec.className = 'btn-secondary';
  sec.textContent = 'Exit to Dashboard';
  sec.onclick = () => {
    overlay.className = 'result-overlay';
    document.getElementById('sessionMeta').classList.add('hidden');
    document.getElementById('sessionProgress').classList.add('hidden');
    document.getElementById('questionView').classList.remove('active');
    window.showScreen('dashboard');
  };
  btns.appendChild(sec);
}

// ============================================================
// ANALYTICS ENGINE
// ============================================================
function switchAnalyticsTab(tab) {
  analyticsTab = tab;
  analyticsPeriodOffset = 0;
  ['daily', 'weekly', 'monthly', 'alltime'].forEach(t => {
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  const dateRow = document.getElementById('dateSelectorRow');
  dateRow.style.display = (tab === 'alltime') ? 'none' : 'flex';
  renderAnalyticsPeriod();
}

function shiftAnalyticsPeriod(delta) {
  analyticsPeriodOffset += delta;
  if (analyticsPeriodOffset > 0) analyticsPeriodOffset = 0;
  renderAnalyticsPeriod();
}

function goToTodayPeriod() {
  analyticsPeriodOffset = 0;
  renderAnalyticsPeriod();
}

async function initAnalyticsView() {
  analyticsTab = 'daily';
  analyticsPeriodOffset = 0;
  document.getElementById('dateSelectorRow').style.display = 'flex';
  ['daily', 'weekly', 'monthly', 'alltime'].forEach(t => {
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === 'daily');
  });
  await renderAnalyticsPeriod();
}

async function renderAnalyticsPeriod() {
  if (!idbDb) {
    await openIDB();
  }
  const allRecs = await idbGetAllRecords();

  let filteredRecs, periodLabel;

  const now = new Date();

  if (analyticsTab === 'daily') {
    const target = new Date(now);
    target.setDate(target.getDate() + analyticsPeriodOffset);
    const key = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`;
    filteredRecs = allRecs.filter(r => {
      const d = new Date(r.timestamp);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === key;
    });
    periodLabel = analyticsPeriodOffset === 0 ? 'Today · ' + target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      : target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } else if (analyticsTab === 'weekly') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() + analyticsPeriodOffset * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    filteredRecs = allRecs.filter(r => r.timestamp >= weekStart.getTime() && r.timestamp <= weekEnd.getTime());
    periodLabel = `Week of ${weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  } else if (analyticsTab === 'monthly') {
    const target = new Date(now.getFullYear(), now.getMonth() + analyticsPeriodOffset, 1);
    filteredRecs = allRecs.filter(r => {
      const d = new Date(r.timestamp);
      return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth();
    });
    periodLabel = target.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } else {
    filteredRecs = allRecs;
    periodLabel = 'All Time';
  }

  const lbl = document.getElementById('dateSelectorLabel');
  if (lbl) lbl.textContent = periodLabel;

  renderAnalyticsMetrics(filteredRecs, allRecs);
  renderInsights(filteredRecs, allRecs);
  renderBreakdownCards(filteredRecs);
  renderTrendChart(allRecs);
}

function computeMetrics(recs) {
  const total   = recs.length;
  const correct = recs.filter(r => r.correct).length;
  const wrong   = total - correct;
  const acc     = total > 0 ? Math.round((correct / total) * 100) : null;
  const times   = recs.map(r => r.timeTaken).filter(t => t > 0);
  const avgTime = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : null;
  const fastest = times.length ? Math.min(...times).toFixed(2) : null;
  const slowest = times.length ? Math.max(...times).toFixed(2) : null;
  const medTime = times.length ? (() => {
    const s = [...times].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid].toFixed(2) : ((s[mid - 1] + s[mid]) / 2).toFixed(2);
  })() : null;
  const qpm = times.length && avgTime > 0 ? (60 / parseFloat(avgTime)).toFixed(1) : null;
  const totalTime = recs.reduce((a, r) => a + r.timeTaken, 0);

  return { total, correct, wrong, acc, avgTime, fastest, slowest, medTime, qpm, totalTime };
}

function renderAnalyticsMetrics(recs, allRecs) {
  const m = computeMetrics(recs);
  const grid = document.getElementById('analyticsTopGrid');
  const configs = [
    { label: 'Questions',     value: m.total,                      accent: false },
    { label: 'Correct',       value: m.correct,                    accent: false },
    { label: 'Accuracy',      value: m.acc !== null ? `${m.acc}%` : '—', accent: true },
    { label: 'Avg Speed',     value: m.avgTime ? `${m.avgTime}s` : '—', accent: false },
    { label: 'Best Time',     value: m.fastest ? `${m.fastest}s` : '—', accent: true },
    { label: 'Q / Minute',    value: m.qpm || '—',                 accent: false },
    { label: 'Practice Time', value: parseFormattedDuration(m.totalTime * 1000), accent: false },
    { label: 'Day Streak',    value: state.currentDayStreak || 0,  accent: true }
  ];
  grid.innerHTML = '';
  configs.forEach(cfg => {
    const card = document.createElement('div');
    card.className = 'analytics-card';
    card.innerHTML = `<div class="label">${cfg.label}</div><div class="value${cfg.accent ? ' accent' : ''}">${cfg.value}</div>`;
    grid.appendChild(card);
  });
}

function renderInsights(recs, allRecs) {
  const panel = document.getElementById('insightsPanel');
  panel.innerHTML = '';
  const insights = generateInsights(recs, allRecs);
  insights.forEach(ins => {
    const el = document.createElement('div');
    el.className = 'insight-item';
    el.innerHTML = `<div class="insight-dot ${ins.color}"></div><span>${ins.text}</span>`;
    panel.appendChild(el);
  });
}

function generateInsights(recs, allRecs) {
  const insights = [];
  if (!recs.length) {
    insights.push({ text: 'No activity in this period. Start a practice session to generate insights.', color: '' });
    return insights;
  }

  const m = computeMetrics(recs);

  // Best / worst discipline this period
  const byDisc = {};
  recs.forEach(r => {
    if (!byDisc[r.discipline]) byDisc[r.discipline] = { total: 0, correct: 0 };
    byDisc[r.discipline].total++;
    if (r.correct) byDisc[r.discipline].correct++;
  });
  const discArr = Object.entries(byDisc).map(([d, v]) => ({ d, acc: v.total > 0 ? v.correct / v.total : 0, total: v.total }));
  if (discArr.length >= 2) {
    discArr.sort((a, b) => b.acc - a.acc);
    insights.push({ text: `Your strongest discipline is ${discArr[0].d} (${Math.round(discArr[0].acc * 100)}% accuracy).`, color: 'green' });
    insights.push({ text: `Your weakest discipline is ${discArr[discArr.length - 1].d} (${Math.round(discArr[discArr.length - 1].acc * 100)}% accuracy).`, color: 'red' });
  }

  // Best / worst section (integer vs decimal)
  const bySec = {};
  recs.forEach(r => {
    const k = `${r.discipline} · ${r.section}`;
    if (!bySec[k]) bySec[k] = { total: 0, correct: 0 };
    bySec[k].total++;
    if (r.correct) bySec[k].correct++;
  });
  const secArr = Object.entries(bySec).map(([k, v]) => ({ k, acc: v.total > 5 ? v.correct / v.total : null })).filter(x => x.acc !== null);
  if (secArr.length) {
    secArr.sort((a, b) => b.acc - a.acc);
    insights.push({ text: `Fastest section: ${secArr[0].k} at ${Math.round(secArr[0].acc * 100)}% accuracy.`, color: 'green' });
  }

  // Speed insight
  if (m.avgTime) {
    const avgF = parseFloat(m.avgTime);
    if (avgF < 5) insights.push({ text: `Excellent response speed: averaging ${m.avgTime}s per question.`, color: 'green' });
    else if (avgF > 15) insights.push({ text: `Average response time is ${m.avgTime}s — practice speed drills to improve.`, color: 'amber' });
  }

  // Compare to all-time
  if (allRecs.length > recs.length) {
    const mAll = computeMetrics(allRecs);
    if (m.acc !== null && mAll.acc !== null) {
      const diff = m.acc - mAll.acc;
      if (diff >= 5) insights.push({ text: `Accuracy is ${diff}% above your all-time average — great momentum.`, color: 'green' });
      else if (diff <= -5) insights.push({ text: `Accuracy is ${Math.abs(diff)}% below your all-time average.`, color: 'red' });
    }
  }

  return insights.slice(0, 5);
}

function renderBreakdownCards(recs) {
  const container = document.getElementById('subjectBreakdown');
  container.innerHTML = '';

  SUBJECTS.forEach(s => {
    const card = document.createElement('div');
    card.className = 'breakdown-card';

    const intData = state.subjects[s.id].integer;
    const decData = state.subjects[s.id].decimal;

    const intRecs = recs.filter(r => r.discipline === s.name && r.section === 'integer');
    const decRecs = recs.filter(r => r.discipline === s.name && r.section === 'decimal');

    function buildRows(disciplineRecs, modeData) {
      const total   = disciplineRecs.length;
      const correct = disciplineRecs.filter(r => r.correct).length;
      const acc     = total > 0 ? Math.round((correct / total) * 100) : 0;
      const cleared = modeData.clearedLevels.length;
      return `
        <div class="breakdown-row">
          <div class="breakdown-row-label">Accuracy</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${acc}%"></div></div>
          <div class="breakdown-row-val">${total > 0 ? acc + '%' : '—'}</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-row-label">Questions</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${Math.min((total / 50) * 100, 100)}%"></div></div>
          <div class="breakdown-row-val">${total}</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-row-label">Cleared</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${Math.min(cleared * 10, 100)}%"></div></div>
          <div class="breakdown-row-val">${cleared}</div>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="breakdown-header">
        <div class="breakdown-name">${s.name}</div>
        <div class="breakdown-level">Lv ${intData.level} / ${decData.level}</div>
      </div>
      <div class="breakdown-mode-tabs">
        <button class="breakdown-mode-tab active" onclick="this.parentElement.querySelectorAll('.breakdown-mode-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.closest('.breakdown-card').querySelector('.mode-rows-integer').style.display='';this.closest('.breakdown-card').querySelector('.mode-rows-decimal').style.display='none';">Integer</button>
        <button class="breakdown-mode-tab" onclick="this.parentElement.querySelectorAll('.breakdown-mode-tab').forEach(b=>b.classList.remove('active'));this.classList.add('active');this.closest('.breakdown-card').querySelector('.mode-rows-integer').style.display='none';this.closest('.breakdown-card').querySelector('.mode-rows-decimal').style.display='';">Decimal</button>
      </div>
      <div class="breakdown-rows mode-rows-integer">${buildRows(intRecs, intData)}</div>
      <div class="breakdown-rows mode-rows-decimal" style="display:none">${buildRows(decRecs, decData)}</div>
    `;
    container.appendChild(card);
  });
}

function renderTrendChart(allRecs) {
  const canvas = document.getElementById('perfChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = rect.width || 600;
  canvas.height = 200;

  // Group by session using history
  const history = (state.history || []).slice(-20);
  if (!history.length) {
    ctx.fillStyle = '#4E4E4E';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText('No data yet. Complete sessions to see trend.', 30, 100);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  const L = 50, R = 20, T = 20, B = 30;
  const pw = W - L - R, ph = H - T - B;

  // Grid lines
  [0, 25, 50, 75, 100].forEach(pct => {
    const y = T + ph - (pct / 100) * ph;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillStyle = '#4E4E4E';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, L - 8, y + 3);
  });

  const n = history.length;
  const stepX = pw / Math.max(n - 1, 1);
  const pts = history.map((h, i) => ({
    x: L + i * stepX,
    y: T + ph - (h.accuracy / 100) * ph,
    perfect: h.perfect
  }));

  // Fill gradient
  const grad = ctx.createLinearGradient(0, T, 0, T + ph);
  grad.addColorStop(0, 'rgba(84,122,165,0.15)');
  grad.addColorStop(1, 'rgba(84,122,165,0.00)');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, T + ph);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, T + ph);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#547AA5';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Dots
  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = p.perfect ? '#4E8752' : '#547AA5';
    ctx.fill();
  });
}

// ============================================================
// EXPORT
// ============================================================
async function exportData(format) {
  if (!idbDb) return;
  const recs = await idbGetAllRecords();
  if (!recs.length) { alert('No data to export.'); return; }

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(recs, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'calculus_analytics.json');
  } else {
    const headers = ['timestamp', 'discipline', 'section', 'level', 'question', 'answer', 'userAnswer', 'correct', 'timeTaken'];
    const rows = recs.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'calculus_analytics.csv');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ============================================================
// KEYBOARD & RESIZE HANDLERS
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('answerInput');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.submitAnswer(); });
});

window.addEventListener('resize', () => {
  const analytics = document.getElementById('screenAnalytics');
  if (analytics && analytics.classList.contains('active')) renderTrendChart(state.history || []);
});
