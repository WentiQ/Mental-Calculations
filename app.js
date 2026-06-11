/**
 * ============================================================
 * CALCULUS — MENTAL ARITHMETIC TRAINING
 * Enhanced: Dynamic Skill-Based Scoring Engine
 * Extended: Decimal Mode + Full High-Precision Analytics
 * Unified: Dual-Layer Cloud Recovery Fallback Pipeline
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
// SYSTEM BASES & CONSTANTS
// ============================================================
const SUBJECTS = [
  { id: 'mixed',          name: 'Mixed',          icon: '🎯', symbol: '' },
  { id: 'addition',       name: 'Addition',       icon: '+',  symbol: '+' },
  { id: 'subtraction',    name: 'Subtraction',    icon: '−',  symbol: '-' },
  { id: 'multiplication', name: 'Multiplication', icon: '×',  symbol: '×' },
  { id: 'division',       name: 'Division',       icon: '÷',  symbol: '÷' },
  { id: 'bodmas',         name: 'BODMAS',         icon: '( )', symbol: '' }
];

const ABSOLUTE_MAX_TIME = 50; // Dynamic ceiling variable used to map max points
const REVIEW_SCREEN_DURATION_MS = 2500; // Duration parameter for distraction free review lockouts

// ============================================================
// INDEXEDDB SETUP
// ============================================================
let idbDb = null;

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('calculus_analytics', 4); // Incremented schema version for dynamic point variables
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('records')) {
        db.deleteObjectStore('records');
      }
      const store = db.createObjectStore('records', { autoIncrement: true });
      store.createIndex('timestamp', 'timestamp', { unique: false });
      store.createIndex('discipline', 'discipline', { unique: false });
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
  const tx = idbDb.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
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

let analyticsTab = 'daily';
let analyticsPeriodOffset = 0;

let session = {
  subject: null, subjectName: '', mode: 'integer',
  level: null, questions: [], answers: [], times: [],
  current: 0, streak: 0, timerInterval: null,
  timeLeft: 0, maxTime: 0, questionStart: null,
  totalSolved: 0, totalCorrect: 0, startTime: null,
  isMixed: false, mixedQuestionsTrack: [],
  sessionEarnedPoints: 0, sessionPossiblePoints: 0
};

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
window.terminateMixedSession   = terminateMixedSession;

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
// STATE DESIGN ARCHITECTURE
// ============================================================
function instantiateDefaultState() {
  const subjects = {};
  SUBJECTS.forEach(s => {
    if (s.id === 'mixed') return;
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
    lastPracticeDay: null,
    currentDayStreak: 0,
    longestDayStreak: 0,
    // Skill Scoring Structural Entities
    totalPoints: 0,
    normalModePoints: 0,
    mixedModePoints: 0,
    maxPossiblePoints: 0,
    highestQuestionScore: 0,
    averagePointsPerQuestion: 0,
    lifetimeEfficiency: 0
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

  // Sync point layers using double protection
  base.totalPoints              = incoming.totalPoints || 0;
  base.normalModePoints         = incoming.normalModePoints || 0;
  base.mixedModePoints          = incoming.mixedModePoints || 0;
  base.maxPossiblePoints        = incoming.maxPossiblePoints || 0;
  base.highestQuestionScore     = incoming.highestQuestionScore || 0;
  base.averagePointsPerQuestion = incoming.averagePointsPerQuestion || 0;
  base.lifetimeEfficiency       = incoming.lifetimeEfficiency || 0;

  SUBJECTS.forEach(s => {
    if (s.id === 'mixed') return;
    if (incoming.subjects && incoming.subjects[s.id]) {
      const inc = incoming.subjects[s.id];
      ['integer', 'decimal'].forEach(m => {
        const modeSrc = inc[m] || inc; // Backward compatibility fallback
        if (modeSrc) {
          base.subjects[s.id][m] = {
            level:         modeSrc.level || 1,
            clearedLevels: modeSrc.clearedLevels || [],
            totalQ:        modeSrc.totalQ || 0,
            totalCorrect:  modeSrc.totalCorrect || 0,
            bestStreak:    modeSrc.bestStreak || 0,
            totalTime:     modeSrc.totalTime || 0
          };
        }
      });
    }
  });
  return base;
}

async function loadRemoteUserCloudState(uid) {
  try {
    const ref = doc(db, "users", uid, "state", "calculus_data");
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return mergeStateSafetyChecks(snap.data());
    } else {
      const fresh = instantiateDefaultState();
      await setDoc(ref, fresh);
      return fresh;
    }
  } catch (e) { console.error(e); }
  return instantiateDefaultState();
}

async function saveStatePipeline() {
  if (!currentUser) return;
  try {
    const ref = doc(db, "users", currentUser.uid, "state", "calculus_data");
    await setDoc(ref, state);
  } catch (e) { console.error(e); }
}

function getTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function updateDayStreak() {
  const today = getTodayKey();
  if (state.lastPracticeDay === today) return;

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
// ADAPTIVE SCORING SUB-ENGINE ENGINE
// ============================================================
function calculateMaxPoints(timeLimit) {
  const calculatedPoints = timeLimit / ABSOLUTE_MAX_TIME;
  return Math.min(Math.max(calculatedPoints, 0.10), 1.00);
}

function calculateScoreVector(timeLimit, timeLeft, isCorrect) {
  const maxPoints = calculateMaxPoints(timeLimit);
  if (!isCorrect || timeLeft <= 0) {
    return { maxPoints, earnedPoints: 0, efficiency: 0 };
  }
  const speedRatio = Math.min(Math.max(timeLeft / timeLimit, 0.0), 1.0);
  const earnedPoints = maxPoints * speedRatio;
  const efficiency = speedRatio * 100;
  return { maxPoints, earnedPoints, efficiency };
}

// ============================================================
// QUESTION GENERATORS
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

function roundTo(val, places) {
  return Math.round(val * Math.pow(10, places)) / Math.pow(10, places);
}

function randFloat(min, max, decimals) {
  const v = Math.random() * (max - min) + min;
  return roundTo(v, decimals);
}

function ensureDecimal(q) {
  const hasDecimalOperand = q.expr.match(/\d+\.\d+/);
  const hasDecimalAnswer = !Number.isInteger(q.answer);
  return hasDecimalOperand || hasDecimalAnswer;
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

function generateDecimalAddition(level) {
  let a, b, answer;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (level === 1) { a = randFloat(0, 20, 1); b = randFloat(0, 20, 1); }
    else if (level === 2) { a = randFloat(0, 100, 1); b = randFloat(0, 100, 1); }
    else if (level === 3) { a = randFloat(0, 100, 2); b = randFloat(0, 100, 2); }
    else if (level === 4) { a = randFloat(0, 1000, 2); b = randFloat(0, 1000, 2); }
    else { a = randFloat(0, 1000, 3); b = randFloat(0, 1000, 3); }
    answer = roundTo(a + b, 3);
    const q = { expr: `${a} + ${b}`, answer };
    if (ensureDecimal(q)) return q;
  }
  a = randFloat(1, 20, 1) + 0.1; b = rand(1, 10);
  return { expr: `${a} + ${b}`, answer: roundTo(a + b, 3) };
}

function generateDecimalSubtraction(level) {
  let a, b, answer;
  for (let attempt = 0; attempt < 20; attempt++) {
    const dp = level <= 2 ? 1 : (level <= 4 ? 2 : 3);
    const range = level <= 2 ? 50 : (level <= 4 ? 200 : 1000);
    a = randFloat(range * 0.3, range, dp);
    b = randFloat(0, a, dp);
    answer = roundTo(a - b, 3);
    const q = { expr: `${a} − ${b}`, answer };
    if (ensureDecimal(q) && answer >= 0) return q;
  }
  a = randFloat(5, 20, 1) + 0.3; b = randFloat(0, a - 0.1, 1);
  return { expr: `${a} − ${b}`, answer: roundTo(a - b, 3) };
}

function generateDecimalMultiplication(level) {
  let a, b, answer;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (level === 1) { a = rand(1, 20); b = randFloat(0.1, 0.9, 1); }
    else if (level === 2) { a = randFloat(1, 10, 1); b = randFloat(1, 10, 1); }
    else if (level === 3) { a = randFloat(1, 20, 2); b = randFloat(1, 5, 2); }
    else if (level === 4) { a = randFloat(10, 50, 1); b = randFloat(1, 10, 1); }
    else { a = randFloat(1, 20, 3); b = randFloat(1, 5, 3); }
    answer = roundTo(a * b, 3);
    const q = { expr: `${a} × ${b}`, answer };
    if (ensureDecimal(q)) return q;
  }
  a = rand(2, 15); b = 0.5;
  return { expr: `${a} × ${b}`, answer: a * b };
}

function generateDecimalDivision(level) {
  for (let attempt = 0; attempt < 30; attempt++) {
    let divisor, dividend, answer;
    if (level === 1) {
      divisor = rand(2, 10); dividend = divisor * rand(1, 20) + rand(1, divisor - 1);
      answer = roundTo(dividend / divisor, 1);
      if (!Number.isInteger(answer)) return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else if (level === 2) {
      divisor = rand(2, 20); const q = rand(1, 10) + randFloat(0.1, 0.9, 1);
      dividend = roundTo(divisor * q, 1); answer = roundTo(dividend / divisor, 2);
      if (!Number.isInteger(answer)) return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else if (level === 3) {
      divisor = rand(2, 20); dividend = divisor * rand(1, 20) + rand(1, divisor - 1);
      answer = roundTo(dividend / divisor, 2);
      if (!Number.isInteger(answer)) return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else if (level === 4) {
      divisor = rand(4, 25); dividend = divisor * rand(2, 30) + rand(1, divisor - 1);
      answer = roundTo(dividend / divisor, 3);
      if (!Number.isInteger(answer)) return { expr: `${dividend} ÷ ${divisor}`, answer };
    } else {
      const divisorD = randFloat(1.5, 5, 1); const dividendD = randFloat(5, 50, 1);
      answer = roundTo(dividendD / divisorD, 3);
      if (!Number.isInteger(answer)) return { expr: `${dividendD} ÷ ${divisorD}`, answer };
    }
  }
  return { expr: `10 ÷ 4`, answer: 2.5 };
}

function generateDecimalBodmas(level) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let expr, answer;
    if (level === 1) {
      const a = randFloat(1, 5, 1), b = rand(1, 5), c = rand(1, 5);
      answer = roundTo(a + b * c, 3); expr = `${a} + ${b} × ${c}`;
    } else if (level === 2) {
      const a = rand(2, 8), b = randFloat(1, 5, 1), c = rand(2, 8);
      answer = roundTo((a + b) * c, 3); expr = `(${a} + ${b}) × ${c}`;
    } else if (level === 3) {
      const a = randFloat(2, 10, 1), b = rand(2, 5), c = randFloat(1, 4, 1);
      answer = roundTo(a * b - c, 3); expr = `${a} × ${b} − ${c}`;
    } else if (level === 4) {
      const a = rand(5, 20), b = randFloat(1, 4, 1), c = rand(2, 10);
      answer = roundTo(a / b + c, 3); expr = `${a} ÷ ${b} + ${c}`;
    } else {
      const a = randFloat(2, 8, 1), b = rand(2, 5), c = randFloat(1, 3, 1), d = rand(2, 6);
      answer = roundTo((a + b) * c - d, 3); expr = `(${a} + ${b}) × ${c} − ${d}`;
    }
    const q = { expr, answer };
    if (ensureDecimal(q)) return q;
  }
  return { expr: `(2.5 + 3) × 4`, answer: 22 };
}

function generateQuestion(subjectId, level, mode = 'integer') {
  if (mode === 'decimal') return generateDecimalQuestion(subjectId, level);
  return generateIntegerQuestion(subjectId, level);
}

function generateInfiniteMixedQuestion() {
  const pools = ['addition', 'subtraction', 'multiplication', 'division', 'bodmas'];
  const chosenSub = pools[Math.floor(Math.random() * pools.length)];
  const chosenMode = Math.random() < 0.5 ? 'integer' : 'decimal';
  const chosenLevel = rand(1, 15);
  
  const questionObj = generateQuestion(chosenSub, chosenLevel, chosenMode);
  return {
    ...questionObj,
    actualDiscipline: chosenSub,
    actualMode: chosenMode,
    actualLevel: chosenLevel
  };
}

const DECIMAL_TOLERANCE = 0.001;
function isAnswerCorrect(userVal, correctVal, mode) {
  if (isNaN(userVal)) return false;
  if (mode === 'decimal') return Math.abs(userVal - correctVal) < DECIMAL_TOLERANCE;
  return userVal === correctVal;
}

// ============================================================
// FULL-SCREEN FAULT REVIEW CONTROL PIPELINES
// ============================================================
function triggerFullScreenFaultReview(expression, correctAnswer, onReviewComplete) {
  const overlay = document.getElementById('faultReviewOverlay');
  const exprEl = document.getElementById('faultReviewExpr');
  const answerEl = document.getElementById('faultReviewAnswer');
  
  if (!overlay || !exprEl || !answerEl) {
    onReviewComplete();
    return;
  }

  exprEl.textContent = expression;
  answerEl.textContent = correctAnswer;
  overlay.classList.add('active');

  setTimeout(() => {
    overlay.classList.remove('active');
    onReviewComplete();
  }, REVIEW_SCREEN_DURATION_MS);
}

function getAdaptiveTimeLimit(subjectId, level, mode) {
  const base = {
    addition:       [6, 8, 10, 14, 18, 25],
    subtraction:    [6, 8, 10, 14, 18, 25],
    multiplication: [8, 10, 12, 16, 22, 30],
    division:       [8, 10, 12, 18, 25, 35],
    bodmas:         [10, 14, 18, 24, 35, 50]
  };
  const tier = base[subjectId] || base['addition'];
  const idx = Math.min(Math.floor((level - 1) / 3), tier.length - 1);
  const t = tier[idx];
  return mode === 'decimal' ? Math.round(t * 1.5) : t;
}

function fetchQuestionsPerSession(level) {
  if (level <= 2)  return 6;
  if (level <= 6)  return 8;
  if (level <= 15) return 10;
  return 12;
}

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function parseFormattedDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  return `${m}m ${rs}s`;
}

// ============================================================
// VIEW SYSTEM CAPTURES
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
// CORE UI RENDER MODULES
// ============================================================
function renderDashboardCore() {
  const totalQ = state.totalQ || 0;
  const acc = totalQ > 0 ? Math.round((state.totalCorrect / totalQ) * 100) : 0;
  let clearedTotal = 0;
  SUBJECTS.forEach(s => {
    if (s.id === 'mixed') return;
    clearedTotal += state.subjects[s.id].integer.clearedLevels.length;
    clearedTotal += state.subjects[s.id].decimal.clearedLevels.length;
  });

  // Calculate Avg Points safely even if session arrays are not yet locally initialized inside the browser instance
  let computedAvgPointsPerQ = state.averagePointsPerQuestion || 0;
  if (computedAvgPointsPerQ === 0 && totalQ > 0 && state.totalPoints > 0) {
    computedAvgPointsPerQ = state.totalPoints / totalQ;
    state.averagePointsPerQuestion = computedAvgPointsPerQ; // Mirror state repair data mapping protocols
  }

  // Structural metric display elements binding
  document.getElementById('statTotalQ').textContent       = totalQ;
  document.getElementById('statAccuracy').textContent     = totalQ > 0 ? `${acc}%` : '—';
  document.getElementById('statBestStreak').textContent   = state.bestStreak || 0;
  document.getElementById('statLevels').textContent       = clearedTotal;
  document.getElementById('statTime').textContent         = parseFormattedDuration(state.totalTime || 0);
  document.getElementById('statDayStreak').textContent    = state.currentDayStreak || 0;

  // Adaptive Scoring Metric Layout Assignments
  document.getElementById('statOverallPoints').textContent     = (state.totalPoints || 0).toFixed(2);
  document.getElementById('statNormalPoints').textContent      = (state.normalModePoints || 0).toFixed(2);
  document.getElementById('statMixedPoints').textContent       = (state.mixedModePoints || 0).toFixed(2);
  document.getElementById('statAvgPointsPerQ').textContent     = computedAvgPointsPerQ.toFixed(2);
  document.getElementById('statHighestSingleQ').textContent   = (state.highestQuestionScore || 0).toFixed(2);
  document.getElementById('statLifetimeEfficiency').textContent = `${(state.lifetimeEfficiency || 0).toFixed(1)}%`;

  renderTodaySummary();

  const grid = document.getElementById('subjectsGrid');
  grid.innerHTML = '';
  SUBJECTS.forEach(s => {
    const card = document.createElement('div');
    if (s.id === 'mixed') {
      card.className = 'subject-card premium-mixed-card';
      card.innerHTML = `
        <span class="subject-icon">${s.icon}</span>
        <span class="subject-level-badge mixed-badge-flavor">Infinite</span>
        <div class="subject-name">${s.name} Challenge</div>
        <div class="subject-meta">Adaptive Risk Workspace Engine<br><span style="color:var(--accent-core)">Adaptive Difficulty Scoring Layer</span></div>
        <div class="subject-progress-bar" style="background:rgba(84,122,165,0.2)"><div class="subject-progress-fill" style="width:100%; background:linear-gradient(90deg, var(--accent-core), var(--green-light))"></div></div>
      `;
      card.addEventListener('click', () => { if (!currentUser) { toggleAuthenticationState(); return; } bootMixedInfiniteSession(); });
    } else {
      const intData = state.subjects[s.id].integer;
      const decData = state.subjects[s.id].decimal;
      const totQ = intData.totalQ + decData.totalQ;
      const totC = intData.totalCorrect + decData.totalCorrect;
      const subAcc = totQ > 0 ? Math.round((totC / totQ) * 100) : null;
      const cleared = intData.clearedLevels.length + decData.clearedLevels.length;
      const levelPct = Math.min(cleared * 5, 100);

      card.className = 'subject-card';
      card.innerHTML = `
        <span class="subject-icon">${s.icon}</span>
        <span class="subject-level-badge">Int. Lv ${intData.level}</span>
        <div class="subject-name">${s.name}</div>
        <div class="subject-meta">${subAcc !== null ? `${subAcc}% accuracy · ${cleared} steps clear` : 'Workspace ready'}</div>
        <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${levelPct}%"></div></div>
      `;
      card.addEventListener('click', () => { if (!currentUser) { toggleAuthenticationState(); return; } showScreen('practice'); executeSubjectProfiling(s.id); });
    }
    grid.appendChild(card);
  });

  renderLogStack();
}

// ============================================================
// DUAL-LAYER METRIC SYNCHRONIZATION SUB-ENGINE
// ============================================================
async function renderTodaySummary() {
  let todayRecs = [];
  const todayStr = getTodayKey();

  // Layer 1: Attempt tracking acquisition via local high-precision IndexedDB
  if (idbDb) {
    try {
      const allRecs = await idbGetAllRecords();
      todayRecs = allRecs.filter(r => {
        const d = new Date(r.timestamp);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayStr;
      });
    } catch (e) {
      console.warn("IndexedDB read friction encountered, executing fallback engine initialization:", e);
    }
  }

  // Layer 2: Cloud Recovery Fallback Pipeline (Triggered if local database state array is clear)
  if (todayRecs.length === 0 && state.history && state.history.length > 0) {
    todayRecs = state.history.filter(h => {
      const d = new Date(h.date || h.timestamp);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === todayStr;
    }).map(h => ({
      correct: h.perfect || h.accuracy === 100 ? h.total : h.correct, // Normalize parameter schemas
      total: h.total,
      earnedPoints: h.pointsEarned || 0,
      timeTaken: h.elapsed ? (h.elapsed / 1000) / h.total : 0 // Extrapolate speed metrics
    }));
  }

  // Calculate Aggregated Matrix Coordinates
  const totalQ = todayRecs.reduce((acc, r) => acc + (r.total || 1), 0);
  const totalCorrect = todayRecs.reduce((acc, r) => acc + (r.correct !== undefined ? (r.correct === true ? 1 : (r.correct === false ? 0 : r.correct)) : 0), 0);
  
  const acc = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) + '%' : '—';
  
  // Calculate average operational speed loop coordinates
  let avgTime = '—';
  if (idbDb && todayRecs.length > 0 && todayRecs.some(r => r.timeTaken && !r.total)) {
    const times = todayRecs.map(r => r.timeTaken).filter(t => t > 0);
    avgTime = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) + 's' : '—';
  } else if (totalQ > 0) {
    const totalTimeRecorded = todayRecs.reduce((acc, r) => acc + (r.timeTaken * (r.total || 1)), 0);
    avgTime = totalTimeRecorded > 0 ? (totalTimeRecorded / todayRecs.length).toFixed(1) + 's' : '—';
  }

  const earnedToday = todayRecs.reduce((a, r) => a + (r.earnedPoints || 0), 0);

  // Update DOM Workspace Node Interface Elements
  document.getElementById('todayQ').textContent       = totalQ;
  document.getElementById('todayAcc').textContent     = acc;
  document.getElementById('todaySpeed').textContent   = avgTime;
  document.getElementById('todayPoints').textContent  = earnedToday.toFixed(2);
}

function renderLogStack() {
  const container = document.getElementById('historyList');
  container.innerHTML = '';
  const logs = (state.history || []).slice(-6).reverse();
  if (!logs.length) {
    container.innerHTML = `<div style="color:var(--steel);font-size:0.85rem;padding:1rem 0;">No active calculation pipelines initialized.</div>`;
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
          <div class="history-subject">${log.subjectName} · ${log.mode === 'mixed' ? 'Infinite Mode' : (log.mode === 'decimal' ? 'Decimal' : 'Integer')} ${log.level ? '· Level ' + log.level : ''}</div>
          <div class="history-detail">${log.correct} / ${log.total} Solved · Points gained: +${(log.pointsEarned || 0).toFixed(2)}</div>
        </div>
      </div>
      <div class="history-score">${log.accuracy}%</div>
    `;
    container.appendChild(item);
  });
}

// ============================================================
// PRACTICE SELECTION ARCHITECTURE
// ============================================================
function initializePracticeRoutingView() {
  document.getElementById('noSubjectMsg').classList.remove('hidden');
  document.getElementById('modeSelectMsg').classList.add('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
  document.getElementById('sessionMeta').classList.add('hidden');
  document.getElementById('sessionProgress').classList.add('hidden');
  document.getElementById('questionView').classList.remove('active');
  document.getElementById('mixedExitBtn').classList.add('hidden');
  document.getElementById('subjectSelectView').style.display = '';

  const selGrid = document.getElementById('practiceSubjectsGrid');
  selGrid.innerHTML = '';

  SUBJECTS.forEach(s => {
    const card = document.createElement('div');
    if (s.id === 'mixed') {
      card.className = 'subject-card premium-mixed-card';
      card.innerHTML = `
        <span class="subject-icon">${s.icon}</span>
        <span class="subject-level-badge mixed-badge-flavor">Infinite</span>
        <div class="subject-name">${s.name} Challenge</div>
        <div class="subject-meta">Continuous integration speed calculation workspace</div>
        <div class="subject-progress-bar" style="background:rgba(84,122,165,0.2)"><div class="subject-progress-fill" style="width:100%; background:linear-gradient(90deg, var(--accent-core), var(--green-light))"></div></div>
      `;
      card.addEventListener('click', () => bootMixedInfiniteSession());
    } else {
      const intData = state.subjects[s.id].integer;
      const decData = state.subjects[s.id].decimal;
      const cleared = intData.clearedLevels.length + decData.clearedLevels.length;
      card.className = 'subject-card';
      card.innerHTML = `
        <span class="subject-icon">${s.icon}</span>
        <span class="subject-level-badge">Int Lv ${intData.level}</span>
        <div class="subject-name">${s.name}</div>
        <div class="subject-meta">${cleared} clearance coordinates mapped</div>
        <div class="subject-progress-bar"><div class="subject-progress-fill" style="width:${Math.min(cleared * 5, 100)}%"></div></div>
      `;
      card.addEventListener('click', () => executeSubjectProfiling(s.id));
    }
    selGrid.appendChild(card);
  });
}

function backToSubjectSelect() {
  practiceSubject = null; practiceMode = null;
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
  if (subjectId === 'mixed') { bootMixedInfiniteSession(); return; }
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
  document.getElementById('levelSelectTitle').textContent = `${profile.name} · ${mode === 'decimal' ? 'Decimal' : 'Integer'}`;
  document.getElementById('levelSelectSub').textContent = `Active level path: ${modeData.level}. 100% execution accuracy profiles required for core logic acceleration.`;

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
// WORKSPACE DISPATCHERS & EXECUTIONS
// ============================================================
function bootExecutionSession(subjectId, mode, level) {
  const discipline = SUBJECTS.find(x => x.id === subjectId);
  const total = fetchQuestionsPerSession(level);
  const questions = [];
  for (let i = 0; i < total; i++) questions.push(generateQuestion(subjectId, level, mode));

  session = {
    subject: subjectId, subjectName: discipline.name, mode, level,
    questions, answers: [], times: [], current: 0, streak: 0, timerInterval: null,
    timeLeft: 0, maxTime: getAdaptiveTimeLimit(subjectId, level, mode),
    questionStart: null, totalSolved: 0, totalCorrect: 0, startTime: Date.now(),
    sessionId: Date.now().toString(36), isMixed: false, mixedQuestionsTrack: [],
    sessionEarnedPoints: 0, sessionPossiblePoints: 0
  };

  document.getElementById('subjectSelectView').style.display = 'none';
  document.getElementById('sessionMeta').classList.remove('hidden');
  document.getElementById('sessionProgress').classList.remove('hidden');
  document.getElementById('questionView').classList.add('active');
  document.getElementById('mixedExitBtn').classList.add('hidden');

  document.getElementById('metaSubject').textContent = discipline.name;
  document.getElementById('metaMode').textContent    = mode === 'decimal' ? 'Decimal' : 'Integer';
  document.getElementById('metaLevel').textContent   = level;
  document.getElementById('metaStreak').textContent  = 0;
  document.getElementById('metaScore').textContent   = `0.00`;

  const arc = document.getElementById('timerArc');
  if (arc) {
    const circ = 2 * Math.PI * 48;
    arc.style.strokeDasharray = circ; arc.style.strokeDashoffset = 0;
  }
  executeDisplayLoop();
}

function bootMixedInfiniteSession() {
  session = {
    subject: 'mixed', subjectName: 'Mixed', mode: 'mixed', level: null,
    questions: [], answers: [], times: [], current: 0, streak: 0, timerInterval: null,
    timeLeft: 0, maxTime: 10, questionStart: null, totalSolved: 0, totalCorrect: 0,
    startTime: Date.now(), sessionId: Date.now().toString(36), isMixed: true, mixedQuestionsTrack: [],
    sessionEarnedPoints: 0, sessionPossiblePoints: 0
  };

  showScreen('practice');
  document.getElementById('subjectSelectView').style.display = 'none';
  document.getElementById('sessionMeta').classList.remove('hidden');
  document.getElementById('sessionProgress').classList.add('hidden');
  document.getElementById('questionView').classList.add('active');
  document.getElementById('mixedExitBtn').classList.remove('hidden');

  document.getElementById('metaSubject').textContent = 'Mixed';
  document.getElementById('metaMode').textContent    = 'Infinite';
  document.getElementById('metaLevel').textContent   = '—';
  document.getElementById('metaStreak').textContent  = 0;
  document.getElementById('metaScore').textContent   = `Pts: 0.00`;

  executeMixedQuestionLoop();
}

function executeMixedQuestionLoop() {
  const nextQ = generateInfiniteMixedQuestion();
  session.questions[session.current] = nextQ;
  session.maxTime = getAdaptiveTimeLimit(nextQ.actualDiscipline, nextQ.actualLevel, nextQ.actualMode);

  document.getElementById('questionNum').textContent  = `Mixed Operational Node — Index ${session.current + 1}`;
  document.getElementById('questionExpr').textContent = nextQ.expr;

  const inp = document.getElementById('answerInput');
  inp.value = ''; inp.className = 'answer-input'; inp.disabled = false;

  document.getElementById('feedbackMsg').textContent = '';
  document.getElementById('feedbackMsg').className   = 'feedback-msg';
  document.getElementById('submitBtn').disabled       = false;

  inp.focus();
  session.questionStart = Date.now();
  engageTimerSubsystem();
}

function executeDisplayLoop() {
  const q = session.questions[session.current];
  const total = session.questions.length;

  document.getElementById('questionNum').textContent  = `Operational Unit ${session.current + 1} of ${total}`;
  document.getElementById('questionExpr').textContent = q.expr;

  const inp = document.getElementById('answerInput');
  inp.value = ''; inp.className = 'answer-input'; inp.disabled = false;

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

  const scoreMetrics = calculateScoreVector(session.maxTime, 0, false);
  session.sessionPossiblePoints += scoreMetrics.maxPoints;

  session.answers.push({ chosenValue: null, statusCorrect: false, expression: q.expr, actualValue: q.answer, scoreMetrics });
  session.times.push(dt);
  session.streak = 0;

  // Process system tracking objects update cascades globally
  state.maxPossiblePoints += scoreMetrics.maxPoints;
  recomputeLifetimeAverages();
  refreshLiveSessionMetaChips();
  
  if (session.isMixed) {
    session.mixedQuestionsTrack.push({
      discipline: "mixed", actualDiscipline: q.actualDiscipline, actualMode: q.actualMode, actualLevel: q.actualLevel,
      question: q.expr, answer: q.answer, correct: false, timeTaken: dt / 1000, timestamp: Date.now(),
      maxPoints: scoreMetrics.maxPoints, earnedPoints: 0, efficiency: 0, timeLimit: session.maxTime
    });
    session.totalSolved++;
    
    // Launch dynamic screen fault review pipeline before continuing
    triggerFullScreenFaultReview(q.expr, q.answer, () => {
      advanceMixedQueue();
    });
  } else {
    // Launch dynamic screen fault review pipeline before continuing
    triggerFullScreenFaultReview(q.expr, q.answer, () => {
      advanceSessionQueue();
    });
  }
}

function submitAnswer() {
  const inp = document.getElementById('answerInput');
  const raw = inp.value.trim();
  if (raw === '') return;

  const userVal = parseFloat(raw);
  const q = session.questions[session.current];
  const dt = Date.now() - session.questionStart;

  clearInterval(session.timerInterval);
  const correct = isAnswerCorrect(userVal, q.answer, session.isMixed ? q.actualMode : session.mode);

  inp.disabled = true;
  document.getElementById('submitBtn').disabled = true;

  const scoreMetrics = calculateScoreVector(session.maxTime, session.timeLeft, correct);
  session.sessionEarnedPoints += scoreMetrics.earnedPoints;
  session.sessionPossiblePoints += scoreMetrics.maxPoints;

  // State global mutators matching precision allocations
  state.totalPoints += scoreMetrics.earnedPoints;
  state.maxPossiblePoints += scoreMetrics.maxPoints;
  if (session.isMixed) {
    state.mixedModePoints += scoreMetrics.earnedPoints;
  } else {
    state.normalModePoints += scoreMetrics.earnedPoints;
  }

  if (scoreMetrics.earnedPoints > (state.highestQuestionScore || 0)) {
    state.highestQuestionScore = scoreMetrics.earnedPoints;
  }

  const msg = document.getElementById('feedbackMsg');

  if (correct) {
    session.streak++; session.totalCorrect++;
    inp.className = 'answer-input correct';
    msg.className = 'feedback-msg correct';
    msg.textContent = `Verified (+${scoreMetrics.earnedPoints.toFixed(2)} Pts)`;
  } else {
    session.streak = 0;
    inp.className = 'answer-input wrong';
  }

  session.answers.push({ chosenValue: userVal, statusCorrect: correct, expression: q.expr, actualValue: q.answer, scoreMetrics });
  session.times.push(dt);
  session.totalSolved++;

  recomputeLifetimeAverages();

  if (session.isMixed) {
    session.mixedQuestionsTrack.push({
      discipline: "mixed", actualDiscipline: q.actualDiscipline, actualMode: q.actualMode, actualLevel: q.actualLevel,
      question: q.expr, answer: q.answer, correct: correct, timeTaken: dt / 1000, timestamp: Date.now(),
      maxPoints: scoreMetrics.maxPoints, earnedPoints: scoreMetrics.earnedPoints, efficiency: scoreMetrics.efficiency, timeLimit: session.maxTime
    });
    refreshLiveSessionMetaChips();
    if (correct) {
      setTimeout(advanceMixedQueue, 1000);
    } else {
      triggerFullScreenFaultReview(q.expr, q.answer, () => {
        advanceMixedQueue();
      });
    }
  } else {
    refreshLiveSessionMetaChips();
    if (correct) {
      setTimeout(advanceSessionQueue, 1000);
    } else {
      triggerFullScreenFaultReview(q.expr, q.answer, () => {
        advanceSessionQueue();
      });
    }
  }
}

function recomputeLifetimeAverages() {
  const currentTotalQuestions = state.totalQ + session.totalSolved;
  if (currentTotalQuestions > 0) {
    state.averagePointsPerQuestion = state.totalPoints / currentTotalQuestions;
  }
  if (state.maxPossiblePoints > 0) {
    state.lifetimeEfficiency = (state.totalPoints / state.maxPossiblePoints) * 100;
  }
}

function advanceSessionQueue() {
  session.current++;
  if (session.current >= session.questions.length) {
    terminateProcessingSession();
  } else {
    executeDisplayLoop();
  }
}

function advanceMixedQueue() {
  session.current++;
  executeMixedQuestionLoop();
}

function refreshLiveSessionMetaChips() {
  document.getElementById('metaStreak').textContent = session.streak;
  document.getElementById('metaScore').textContent = session.sessionEarnedPoints.toFixed(2);
}

// ============================================================
// SYSTEM CLOSURES & DATA PIPELINES
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

  const modeData = state.subjects[session.subject][session.mode];
  modeData.totalQ        += total;
  modeData.totalCorrect  += correct;
  modeData.totalTime     += elapsed;
  if (session.streak > modeData.bestStreak) modeData.bestStreak = session.streak;

  // Level thresholds configuration checks
  if (perfect) {
    if (!modeData.clearedLevels.includes(session.level)) modeData.clearedLevels.push(session.level);
    if (session.level === modeData.level) modeData.level = session.level + 1;
  }

  state.totalQ        += total;
  state.totalCorrect  += correct;
  state.totalTime     += elapsed;
  if (session.streak > state.bestStreak) state.bestStreak = session.streak;

  updateDayStreak();

  state.history.push({
    subjectName: session.subjectName, mode: session.mode, level: session.level,
    correct, total, elapsed, perfect, accuracy, date: Date.now(),
    pointsEarned: session.sessionEarnedPoints, pointsPossible: session.sessionPossiblePoints
  });
  if (state.history.length > 80) state.history.shift();

  if (idbDb) {
    for (let i = 0; i < session.questions.length; i++) {
      const ans = session.answers[i];
      await idbSaveRecord({
        timestamp:  session.startTime + (session.times[i] || 0),
        discipline: session.subjectName, section: session.mode, level: session.level,
        question:   session.questions[i].expr, answer: session.questions[i].answer,
        userAnswer: ans ? ans.chosenValue : null, correct: ans ? ans.statusCorrect : false,
        timeTaken:  ans ? (session.times[i] || 0) / 1000 : 0, sessionId: session.sessionId,
        maxPoints:  ans?.scoreMetrics.maxPoints || 0,
        earnedPoints: ans?.scoreMetrics.earnedPoints || 0,
        efficiency: ans?.scoreMetrics.efficiency || 0,
        timeLimit:  session.maxTime
      });
    }
  }

  displayTerminalOverlay(perfect, correct, total, accuracy, meanTime, peakTime);
  try { await saveStatePipeline(); } catch (e) { console.error(e); }
}

async function terminateMixedSession() {
  clearInterval(session.timerInterval);
  
  const elapsed = Date.now() - session.startTime;
  state.totalQ += session.totalSolved;
  state.totalCorrect += session.totalCorrect;
  state.totalTime += elapsed;
  
  updateDayStreak();
  
  const accuracy = session.totalSolved > 0 ? Math.round((session.totalCorrect / session.totalSolved) * 100) : 0;
  
  state.history.push({
    subjectName: "Mixed Challenge", mode: "mixed", level: null,
    correct: session.totalCorrect, total: session.totalSolved, elapsed: elapsed,
    perfect: false, accuracy: accuracy, date: Date.now(),
    pointsEarned: session.sessionEarnedPoints, pointsPossible: session.sessionPossiblePoints
  });
  
  if (idbDb) {
    for (const rec of session.mixedQuestionsTrack) {
      await idbSaveRecord({ ...rec, sessionId: session.sessionId });
    }
  }
  
  const overlay = document.getElementById('resultOverlay');
  overlay.className = 'result-overlay active';

  document.getElementById('resultStatus').textContent  = 'Infinite Workspace Loop Terminated';
  const heading = document.getElementById('resultHeading');
  heading.textContent = 'Mixed Run Summary';
  heading.className   = `result-heading success`;

  document.getElementById('resultSub').textContent = `Runtime safely halted. Velocity engine points allocation output yields +${session.sessionEarnedPoints.toFixed(2)} metrics.`;

  const times = session.times.filter(t => t > 0);
  const avgS = times.length ? ((times.reduce((a,b)=>a+b, 0)/times.length)/1000).toFixed(1) + 's' : '—';

  document.getElementById('resAcc').textContent     = `${accuracy}%`;
  document.getElementById('resAvgTime').textContent = avgS;
  document.getElementById('resBest').textContent    = parseFormattedDuration(elapsed);
  document.getElementById('resStreak').textContent  = session.streak;

  const labels = overlay.querySelectorAll('.result-stat-label');
  if (labels[2]) labels[2].textContent = "Session Duration";

  const btns = document.getElementById('resultBtns');
  btns.innerHTML = '';

  const primary = document.createElement('button');
  primary.className = 'btn-primary'; primary.textContent = 'Return to Control Dashboard';
  primary.onclick = () => {
    overlay.className = 'result-overlay';
    if (labels[2]) labels[2].textContent = "Peak Velocity";
    document.getElementById('sessionMeta').classList.add('hidden');
    document.getElementById('questionView').classList.remove('active');
    window.showScreen('dashboard');
  };
  btns.appendChild(primary);
  
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
    ? `All ${correct} operational arrays synchronized. System score allocation +${session.sessionEarnedPoints.toFixed(2)} vectors.`
    : `Compliance performance map index: ${correct} / ${total}. 100% precision execution required to scale next tier.`;

  document.getElementById('resAcc').textContent     = `${accuracy}%`;
  document.getElementById('resAvgTime').textContent = meanTime ? `${(meanTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resBest').textContent    = peakTime ? `${(peakTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resStreak').textContent  = session.streak;

  const btns = document.getElementById('resultBtns');
  btns.innerHTML = '';

  const primary = document.createElement('button');
  primary.className = 'btn-primary';
  primary.textContent = isPass ? 'Advance Tier Run' : 'Re-verify Parameters';
  primary.onclick = () => {
    overlay.className = 'result-overlay';
    const nextLv = isPass ? state.subjects[session.subject][session.mode].level : session.level;
    window.bootExecutionSession(session.subject, session.mode, nextLv);
  };
  btns.appendChild(primary);

  const sec = document.createElement('button');
  sec.className = 'btn-secondary'; sec.textContent = 'Exit to Base Hub';
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
// ANALYTICS INTEGRATION PANELS
// ============================================================
function switchAnalyticsTab(tab) {
  analyticsTab = tab; analyticsPeriodOffset = 0;
  ['daily', 'weekly', 'monthly', 'alltime'].forEach(t => {
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  document.getElementById('dateSelectorRow').style.display = (tab === 'alltime') ? 'none' : 'flex';
  renderAnalyticsPeriod();
}

function shiftAnalyticsPeriod(delta) {
  analyticsPeriodOffset += delta;
  if (analyticsPeriodOffset > 0) analyticsPeriodOffset = 0;
  renderAnalyticsPeriod();
}

function goToTodayPeriod() { analyticsPeriodOffset = 0; renderAnalyticsPeriod(); }

async function initAnalyticsView() {
  analyticsTab = 'daily'; analyticsPeriodOffset = 0;
  document.getElementById('dateSelectorRow').style.display = 'flex';
  ['daily', 'weekly', 'monthly', 'alltime'].forEach(t => {
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === 'daily');
  });
  await renderAnalyticsPeriod();
}

async function renderAnalyticsPeriod() {
  if (!idbDb) { await openIDB(); }
  const allRecs = await idbGetAllRecords();

  let filteredRecs, periodLabel;
  const now = new Date();

  if (analyticsTab === 'daily') {
    const target = new Date(now); target.setDate(target.getDate() + analyticsPeriodOffset);
    const key = `${target.getFullYear()}-${target.getMonth()}-${target.getDate()}`;
    filteredRecs = allRecs.filter(r => { const d = new Date(r.timestamp); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` === key; });
    periodLabel = analyticsPeriodOffset === 0 ? 'Today · ' + target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : target.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  } else if (analyticsTab === 'weekly') {
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay() + analyticsPeriodOffset * 7); weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6); weekEnd.setHours(23, 59, 59, 999);
    filteredRecs = allRecs.filter(r => r.timestamp >= weekStart.getTime() && r.timestamp <= weekEnd.getTime());
    periodLabel = `Week of ${weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – ${weekEnd.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`;
  } else if (analyticsTab === 'monthly') {
    const target = new Date(now.getFullYear(), now.getMonth() + analyticsPeriodOffset, 1);
    filteredRecs = allRecs.filter(r => { const d = new Date(r.timestamp); return d.getFullYear() === target.getFullYear() && d.getMonth() === target.getMonth(); });
    periodLabel = target.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  } else {
    filteredRecs = allRecs; periodLabel = 'All Time';
  }

  const lbl = document.getElementById('dateSelectorLabel');
  if (lbl) lbl.textContent = periodLabel;

  renderAnalyticsMetrics(filteredRecs);
  renderInsights(filteredRecs);
  renderBreakdownCards(filteredRecs);
  renderTrendChart();
}

function computeMetrics(recs) {
  const total   = recs.length;
  const correct = recs.filter(r => r.correct).length;
  const acc     = total > 0 ? Math.round((correct / total) * 100) : null;
  const times   = recs.map(r => r.timeTaken).filter(t => t > 0);
  const avgTime = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(2) : null;
  const totalTime = recs.reduce((a, r) => a + r.timeTaken, 0);
  const earned = recs.reduce((a, r) => a + (r.earnedPoints || 0), 0);
  const possible = recs.reduce((a, r) => a + (r.maxPoints || 0), 0);
  const efficiency = possible > 0 ? (earned / possible) * 100 : 0;

  return { total, correct, acc, avgTime, totalTime, earned, possible, efficiency };
}

function renderAnalyticsMetrics(recs) {
  const m = computeMetrics(recs);
  const grid = document.getElementById('analyticsTopGrid');
  const configs = [
    { label: 'Evaluation Vol',   value: m.total,                       accent: false },
    { label: 'Yield Accuracy',   value: m.acc !== null ? `${m.acc}%` : '—', accent: true },
    { label: 'Mean Sync Speed',  value: m.avgTime ? `${m.avgTime}s` : '—', accent: false },
    { label: 'Points Yielded',   value: m.earned.toFixed(2),           accent: true },
    { label: 'Potential Points', value: m.possible.toFixed(2),         accent: false },
    { label: 'Conversion Eff.', value: `${m.efficiency.toFixed(1)}%`,  accent: false }
  ];
  grid.innerHTML = '';
  configs.forEach(cfg => {
    const card = document.createElement('div'); card.className = 'analytics-card';
    card.innerHTML = `<div class="label">${cfg.label}</div><div class="value${cfg.accent ? ' accent' : ''}">${cfg.value}</div>`;
    grid.appendChild(card);
  });
}

function renderInsights(recs) {
  const panel = document.getElementById('insightsPanel'); panel.innerHTML = '';
  if (!recs.length) {
    panel.innerHTML = `<div class="insight-item"><div class="insight-dot"></div><span>No transactional tracking matrix parameters logged.</span></div>`;
    return;
  }

  const m = computeMetrics(recs);
  const insights = [];

  if (m.efficiency >= 80) {
    insights.push({ text: `High calculation velocity conversion discovered: System operating at ${m.efficiency.toFixed(1)}% performance index.`, color: 'green' });
  } else if (m.efficiency < 50) {
    insights.push({ text: `Velocity loss observed. Conversion efficiency is at ${m.efficiency.toFixed(1)}%. Accelerate responses to retain point multiplier channels.`, color: 'amber' });
  }

  const byDisc = {};
  recs.forEach(r => {
    const discName = r.discipline;
    if (!byDisc[discName]) byDisc[discName] = { earned: 0, possible: 0 };
    byDisc[discName].earned += (r.earnedPoints || 0);
    byDisc[discName].possible += (r.maxPoints || 0);
  });

  const discArr = Object.entries(byDisc).map(([d, v]) => ({ d, eff: v.possible > 0 ? v.earned / v.possible : 0 }));
  if (discArr.length >= 2) {
    discArr.sort((a, b) => b.eff - a.eff);
    insights.push({ text: `Dominant efficiency execution mapped to ${discArr[0].d} (${Math.round(discArr[0].eff * 100)}% Conversion).`, color: 'green' });
    insights.push({ text: `Highest computational resistance found in ${discArr[discArr.length - 1].d} (${Math.round(discArr[discArr.length - 1].eff * 100)}% Conversion).`, color: 'red' });
  }

  if (insights.length === 0) {
    insights.push({ text: "Operational throughput metrics verified. Increase baseline task complexity to optimize reward multipliers.", color: 'green' });
  }

  insights.forEach(ins => {
    const el = document.createElement('div'); el.className = 'insight-item';
    el.innerHTML = `<div class="insight-dot ${ins.color}"></div><span>${ins.text}</span>`;
    panel.appendChild(el);
  });
}

function renderBreakdownCards(recs) {
  const container = document.getElementById('subjectBreakdown'); container.innerHTML = '';

  SUBJECTS.forEach(s => {
    const card = document.createElement('div'); card.className = 'breakdown-card';

    if (s.id === 'mixed') {
      const mixedRecs = recs.filter(r => r.discipline === 'Mixed' || r.discipline === 'mixed');
      const metrics = computeMetrics(mixedRecs);
      
      card.innerHTML = `
        <div class="breakdown-header">
          <div class="breakdown-name">🎯 Mixed Infinite</div>
          <div class="breakdown-level" style="background:rgba(78,135,82,0.1); color:var(--green-light); border-color:var(--green)">Dynamic Engine</div>
        </div>
        <div style="margin-top:1rem;" class="breakdown-rows">
          <div class="breakdown-row">
            <div class="breakdown-row-label">Conversion</div>
            <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${metrics.efficiency}%; background:var(--green)"></div></div>
            <div class="breakdown-row-val">${metrics.efficiency.toFixed(1)}%</div>
          </div>
          <div class="breakdown-row">
            <div class="breakdown-row-label">Points Yield</div>
            <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${Math.min((metrics.earned / 50) * 100, 100)}%; background:var(--green)"></div></div>
            <div class="breakdown-row-val">${metrics.earned.toFixed(1)}</div>
          </div>
        </div>
      `;
    } else {
      const intData = state.subjects[s.id].integer;
      const decData = state.subjects[s.id].decimal;

      const intRecs = recs.filter(r => r.discipline === s.name && r.section === 'integer');
      const decRecs = recs.filter(r => r.discipline === s.name && r.section === 'decimal');

      function buildRows(disciplineRecs) {
        const metrics = computeMetrics(disciplineRecs);
        return `
          <div class="breakdown-row">
            <div class="breakdown-row-label">Conversion</div>
            <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${metrics.efficiency}%"></div></div>
            <div class="breakdown-row-val">${metrics.efficiency.toFixed(1)}%</div>
          </div>
          <div class="breakdown-row">
            <div class="breakdown-row-label">Points Earned</div>
            <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${Math.min((metrics.earned / 50) * 100, 100)}%"></div></div>
            <div class="breakdown-row-val">${metrics.earned.toFixed(1)}</div>
          </div>
          <div class="breakdown-row">
            <div class="breakdown-row-label">Accuracy Index</div>
            <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width:${metrics.acc || 0}%"></div></div>
            <div class="breakdown-row-val">${metrics.acc !== null ? metrics.acc + '%' : '—'}</div>
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
        <div class="breakdown-rows mode-rows-integer">${buildRows(intRecs)}</div>
        <div class="breakdown-rows mode-rows-decimal" style="display:none">${buildRows(decRecs)}</div>
      `;
    }
    container.appendChild(card);
  });
}

function renderTrendChart() {
  const canvas = document.getElementById('perfChart'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width  = rect.width || 600; canvas.height = 200;

  const history = (state.history || []).slice(-20);
  if (!history.length) {
    ctx.fillStyle = '#4E4E4E'; ctx.font = '12px Inter, sans-serif';
    ctx.fillText('Computational metrics tracking matrix empty.', 30, 100);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  const L = 50, R = 20, T = 20, B = 30;
  const pw = W - L - R, ph = H - T - B;

  [0, 25, 50, 75, 100].forEach(pct => {
    const y = T + ph - (pct / 100) * ph;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillStyle = '#4E4E4E'; ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, L - 8, y + 3);
  });

  const n = history.length; const stepX = pw / Math.max(n - 1, 1);
  const pts = history.map((h, i) => ({ x: L + i * stepX, y: T + ph - (h.accuracy / 100) * ph, perfect: h.perfect }));

  const grad = ctx.createLinearGradient(0, T, 0, T + ph);
  grad.addColorStop(0, 'rgba(84,122,165,0.15)'); grad.addColorStop(1, 'rgba(84,122,165,0.00)');

  ctx.beginPath(); ctx.moveTo(pts[0].x, T + ph);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(pts[pts.length - 1].x, T + ph); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.strokeStyle = '#547AA5'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();

  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = p.perfect ? '#4E8752' : '#547AA5'; ctx.fill();
  });
}

async function exportData(format) {
  if (!idbDb) return;
  const recs = await idbGetAllRecords();
  if (!recs.length) { alert('Data layer cache array is empty.'); return; }

  if (format === 'json') {
    const blob = new Blob([JSON.stringify(recs, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'calculus_dynamic_analytics.json');
  } else {
    const headers = ['timestamp', 'discipline', 'section', 'level', 'question', 'answer', 'userAnswer', 'correct', 'timeTaken', 'maxPoints', 'earnedPoints', 'efficiency', 'timeLimit'];
    const rows = recs.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    downloadBlob(blob, 'calculus_dynamic_analytics.csv');
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('answerInput');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') window.submitAnswer(); });
});

window.addEventListener('resize', () => {
  const analytics = document.getElementById('screenAnalytics');
  if (analytics && analytics.classList.contains('active')) renderTrendChart();
});