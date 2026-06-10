/**
 * ============================================================
 * PARAMETRIC CONFIGURATIONS AND STATIC META ARRAYS
 * ============================================================
 */
const SUBJECTS = [
  { id: 'addition',       name: 'Addition',       icon: '+',  symbol: '+' },
  { id: 'subtraction',    name: 'Subtraction',    icon: '−',  symbol: '-' },
  { id: 'multiplication', name: 'Multiplication', icon: '×',  symbol: '×' },
  { id: 'division',       name: 'Division',       icon: '÷',  symbol: '÷' },
  { id: 'bodmas',         name: 'BODMAS',         icon: '( )', symbol: '' }
];

/**
 * ============================================================
 * ENGINE APPLICATION STATE OBJECT
 * ============================================================
 */
let state = loadState();

let session = {
  subject: null,
  subjectName: '',
  level: null,
  questions: [],
  answers: [],
  times: [],
  current: 0,
  streak: 0,
  timerInterval: null,
  timeLeft: 0,
  maxTime: 0,
  questionStart: null,
  totalSolved: 0,
  totalCorrect: 0,
  startTime: null
};

/**
 * ============================================================
 * STATE STORAGE PERSISTENCE SYSTEMS
 * ============================================================
 */
function loadState() {
  try {
    const data = localStorage.getItem('calculus_v3_engine');
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.subjects && parsed.history) return parsed;
    }
  } catch (e) {
    console.error("State core fault: Resetting structural parameters.", e);
  }
  return instantiateDefaultState();
}

function instantiateDefaultState() {
  const subjectProgress = {};
  SUBJECTS.forEach(s => {
    subjectProgress[s.id] = {
      level: 1,
      clearedLevels: [],
      totalQ: 0,
      totalCorrect: 0,
      bestStreak: 0,
      totalTime: 0,
      sessions: []
    };
  });
  return {
    subjects: subjectProgress,
    bestStreak: 0,
    totalQ: 0,
    totalCorrect: 0,
    totalTime: 0,
    history: []
  };
}

function saveState() {
  try {
    localStorage.setItem('calculus_v3_engine', JSON.stringify(state));
  } catch (e) {
    console.error("Critical State save warning.", e);
  }
}

/**
 * ============================================================
 * PROCEDURAL DIFFICULTY PIPELINE GENERATION
 * ============================================================
 */
function generateBounds(level) {
  if (level === 1) return { min: 2, max: 9 };
  if (level === 2) return { min: 10, max: 25 };
  if (level === 3) return { min: 10, max: 50 };
  if (level === 4) return { min: 20, max: 99 };
  if (level <= 7)  return { min: 50, max: 250 };
  if (level <= 12) return { min: 100, max: 999 };
  if (level <= 20) return { min: 500, max: 4999 };
  if (level <= 40) return { min: 2000, max: 15000 };
  return { min: 10000, max: 999999 };
}

function generateQuestion(subjectId, level) {
  const bounds = generateBounds(level);
  
  switch (subjectId) {
    case 'addition': {
      const a = rand(bounds.min, bounds.max);
      const b = rand(bounds.min, bounds.max);
      return { expr: `${a} + ${b}`, answer: a + b };
    }
    case 'subtraction': {
      let a = rand(bounds.min, bounds.max);
      let b = rand(bounds.min, bounds.max);
      if (a < b) [a, b] = [b, a]; 
      return { expr: `${a} − ${b}`, answer: a - b };
    }
    case 'multiplication': {
      const multMin = Math.max(2, Math.floor(bounds.min * 0.1));
      const multMax = Math.max(9, Math.floor(bounds.max * 0.1));
      const a = rand(multMin, multMax);
      const b = level <= 3 ? rand(2, 9) : rand(multMin, Math.min(multMax, 100));
      return { expr: `${a} × ${b}`, answer: a * b };
    }
    case 'division': {
      const baseMin = Math.max(2, Math.floor(bounds.min * 0.1));
      const baseMax = Math.max(9, Math.floor(bounds.max * 0.1));
      const b = rand(baseMin, Math.min(baseMax, 100));
      const quotient = rand(2, Math.max(9, level * 3));
      const a = b * quotient;
      return { expr: `${a} ÷ ${b}`, answer: quotient };
    }
    case 'bodmas': {
      return executeBodmasGeneration(level);
    }
  }
}

function executeBodmasGeneration(level) {
  if (level === 1) {
    const b = rand(2, 6), c = rand(2, 6), a = rand(2, 15);
    return { expr: `${a} + ${b} × ${c}`, answer: a + (b * c) };
  }
  if (level === 2) {
    const b = rand(2, 9), c = rand(2, 9), a = rand(10, 30), d = rand(2, 10);
    return { expr: `${a} + ${b} × ${c} − ${d}`, answer: a + (b * c) - d };
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
  return { expr: `${a} × (${b} + ${c}) − ${d} × ${e}`, answer: a * (b + c) - (d * e) };
}

/**
 * ============================================================
 * PARAMETRIC RUNTIME SCHEDULER & METRICS
 * ============================================================
 */
function getAdaptiveTimeLimit(subjectId, level) {
  const baseAllocation = {
    addition:       [6, 8, 10, 14, 18, 25],
    subtraction:    [6, 8, 10, 14, 18, 25],
    multiplication: [8, 10, 12, 16, 22, 30],
    division:       [8, 10, 12, 18, 25, 35],
    bodmas:         [10, 14, 18, 24, 35, 50]
  };
  const tier = baseAllocation[subjectId];
  const pointer = Math.min(Math.floor((level - 1) / 3), tier.length - 1);
  return tier[pointer];
}

function fetchQuestionsPerSession(level) {
  if (level <= 2) return 6;
  if (level <= 6) return 8;
  if (level <= 15) return 10;
  return 12;
}

/**
 * ============================================================
 * STRUCTURAL AUXILIARY METHODS
 * ============================================================
 */
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseFormattedDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const balancedMinutes = Math.floor(totalSeconds / 60);
  const structuralSeconds = totalSeconds % 60;
  return `${balancedMinutes}m ${structuralSeconds}s`;
}

/**
 * ============================================================
 * APPLICATION SCREEN EXECUTIVE ROUTER
 * ============================================================
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-links button').forEach(b => b.classList.remove('active'));

  const formattedId = 'screen' + screenId.charAt(0).toUpperCase() + screenId.slice(1);
  const targetScreen = document.getElementById(formattedId);
  if (targetScreen) targetScreen.classList.add('active');

  const navMappings = { dashboard: 'navDash', practice: 'navPractice', analytics: 'navAnalytics' };
  const targetNavButton = document.getElementById(navMappings[screenId]);
  if (targetNavButton) targetNavButton.classList.add('active');

  if (screenId !== 'practice') {
    clearInterval(session.timerInterval);
  }

  if (screenId === 'dashboard')  renderDashboardCore();
  if (screenId === 'practice')   initializePracticeRoutingView();
  if (screenId === 'analytics')  generateAnalyticsVisualization();
}

/**
 * ============================================================
 * INTERFACE COMPONENT RENDERING MECHANICS
 * ============================================================
 */
function renderDashboardCore() {
  const totalQ = state.totalQ || 0;
  const rawAccuracy = totalQ > 0 ? Math.round((state.totalCorrect / totalQ) * 100) : 0;
  let accumulatedClearedLevels = 0;
  
  SUBJECTS.forEach(s => {
    accumulatedClearedLevels += state.subjects[s.id].clearedLevels.length;
  });

  document.getElementById('statTotalQ').textContent = totalQ;
  document.getElementById('statAccuracy').textContent = totalQ > 0 ? `${rawAccuracy}%` : '—';
  document.getElementById('statBestStreak').textContent = state.bestStreak || 0;
  document.getElementById('statLevels').textContent = accumulatedClearedLevels;
  document.getElementById('statTime').textContent = parseFormattedDuration(state.totalTime || 0);

  const grid = document.getElementById('subjectsGrid');
  grid.innerHTML = '';

  SUBJECTS.forEach(s => {
    const currentSubjectData = state.subjects[s.id];
    const subAccuracy = currentSubjectData.totalQ > 0 
      ? Math.round((currentSubjectData.totalCorrect / currentSubjectData.totalQ) * 100) 
      : null;
    const levelProgressPercent = Math.min(currentSubjectData.clearedLevels.length * 8, 100);

    const card = document.createElement('div');
    card.className = 'subject-card';
    card.innerHTML = `
      <span class="subject-icon">${s.icon}</span>
      <span class="subject-level-badge">Level ${currentSubjectData.level}</span>
      <div class="subject-name">${s.name}</div>
      <div class="subject-meta">${subAccuracy !== null ? `${subAccuracy}% accuracy` : 'No logs logged'}</div>
      <div class="subject-progress-bar">
        <div class="subject-progress-fill" style="width: ${levelProgressPercent}%"></div>
      </div>
    `;
    card.addEventListener('click', () => {
      showScreen('practice');
      executeSubjectProfiling(s.id);
    });
    grid.appendChild(card);
  });

  renderLogStack();
}

function renderLogStack() {
  const container = document.getElementById('historyList');
  container.innerHTML = '';
  
  const historicalArray = (state.history || []).slice(-6).reverse();
  if (!historicalArray.length) {
    container.innerHTML = `<div style="color: var(--steel); font-size: 0.85rem; padding: 1rem 0;">No active processing matrix found. Run baseline calculations.</div>`;
    return;
  }

  historicalArray.forEach(log => {
    const indicatorClass = log.perfect ? 'perfect' : (log.correct === 0 ? 'failed' : '');
    const structuralItem = document.createElement('div');
    structuralItem.className = 'history-item';
    structuralItem.innerHTML = `
      <div class="history-left">
        <div class="history-dot ${indicatorClass}"></div>
        <div>
          <div class="history-subject">${log.subjectName} — Level ${log.level}</div>
          <div class="history-detail">${log.correct} / ${log.total} structural compliance · ${parseFormattedDuration(log.elapsed)} execution run</div>
        </div>
      </div>
      <div class="history-score">${log.accuracy}%</div>
    `;
    container.appendChild(structuralItem);
  });
}

/**
 * ============================================================
 * INTERACTIVE SESSION PRACTICE CONTROLLER
 * ============================================================
 */
function initializePracticeRoutingView() {
  document.getElementById('noSubjectMsg').classList.remove('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
  document.getElementById('sessionMeta').classList.add('hidden');
  document.getElementById('sessionProgress').classList.add('hidden');
  document.getElementById('questionView').classList.remove('active');
  document.getElementById('subjectSelectView').style.display = '';

  const selectionGrid = document.getElementById('practiceSubjectsGrid');
  selectionGrid.innerHTML = '';

  SUBJECTS.forEach(s => {
    const metaSubjectState = state.subjects[s.id];
    const structuralCard = document.createElement('div');
    structuralCard.className = 'subject-card';
    structuralCard.innerHTML = `
      <span class="subject-icon">${s.icon}</span>
      <span class="subject-level-badge">Level ${metaSubjectState.level}</span>
      <div class="subject-name">${s.name}</div>
      <div class="subject-meta">${metaSubjectState.clearedLevels.length} steps cleared</div>
      <div class="subject-progress-bar">
        <div class="subject-progress-fill" style="width: ${Math.min(metaSubjectState.clearedLevels.length * 10, 100)}%"></div>
      </div>
    `;
    structuralCard.addEventListener('click', () => executeSubjectProfiling(s.id));
    selectionGrid.appendChild(structuralCard);
  });
}

function backToSubjectSelect() {
  document.getElementById('noSubjectMsg').classList.remove('hidden');
  document.getElementById('levelSelectMsg').classList.add('hidden');
}

function executeSubjectProfiling(subjectId) {
  const profile = SUBJECTS.find(x => x.id === subjectId);
  const subjectMetadata = state.subjects[subjectId];

  document.getElementById('noSubjectMsg').classList.add('hidden');
  document.getElementById('levelSelectMsg').classList.remove('hidden');
  document.getElementById('levelSelectTitle').textContent = profile.name;
  document.getElementById('levelSelectSub').textContent = `Current Operational Step: Level ${subjectMetadata.level}. Perfect evaluation (100%) required to step ahead.`;

  buildLevelSelectionRows(subjectId);
}

function buildLevelSelectionRows(subjectId) {
  const currentSubjectState = state.subjects[subjectId];
  const container = document.getElementById('levelSelector');
  container.innerHTML = '';

  const absoluteHorizon = Math.max(currentSubjectState.level + 4, 8);
  
  for (let lv = 1; lv <= absoluteHorizon; lv++) {
    const statusCleared = currentSubjectState.clearedLevels.includes(lv);
    const statusActive = lv === currentSubjectState.level;
    const statusLocked = lv > currentSubjectState.level;

    const structuralRow = document.createElement('div');
    structuralRow.className = `level-row${statusLocked ? ' locked' : ''}${statusActive ? ' current' : ''}`;
    
    const standardMockSample = generateQuestion(subjectId, lv);

    structuralRow.innerHTML = `
      <div class="level-num">Level ${lv}</div>
      <div class="level-desc" style="color: ${statusLocked ? 'var(--steel)' : 'var(--white)'}">
        ${standardMockSample.expr.length > 35 ? standardMockSample.expr.slice(0, 32) + '...' : standardMockSample.expr}
      </div>
      <div class="level-status ${statusCleared ? 'cleared' : (statusActive ? 'current' : 'locked')}">
        ${statusCleared ? 'Cleared' : (statusActive ? 'Active' : 'Locked')}
      </div>
    `;

    if (!statusLocked) {
      structuralRow.addEventListener('click', () => bootExecutionSession(subjectId, lv));
    }
    container.appendChild(structuralRow);
  }
}

/**
 * ============================================================
 * INTERACTIVE MATRIX MONITOR ENGINE START
 * ============================================================
 */
function bootExecutionSession(subjectId, level) {
  const targetDiscipline = SUBJECTS.find(x => x.id === subjectId);
  const totalQuestionsNeeded = fetchQuestionsPerSession(level);

  const proceduralQuestionsArray = [];
  for (let i = 0; i < totalQuestionsNeeded; i++) {
    proceduralQuestionsArray.push(generateQuestion(subjectId, level));
  }

  session = {
    subject: subjectId,
    subjectName: targetDiscipline.name,
    level: level,
    questions: proceduralQuestionsArray,
    answers: [],
    times: [],
    current: 0,
    streak: 0,
    timerInterval: null,
    timeLeft: 0,
    maxTime: getAdaptiveTimeLimit(subjectId, level),
    questionStart: null,
    totalSolved: 0,
    totalCorrect: 0,
    startTime: Date.now()
  };

  document.getElementById('subjectSelectView').style.display = 'none';
  document.getElementById('sessionMeta').classList.remove('hidden');
  document.getElementById('sessionProgress').classList.remove('hidden');
  
  document.getElementById('questionView').classList.add('active');

  document.getElementById('metaSubject').textContent = targetDiscipline.name;
  document.getElementById('metaLevel').textContent = level;
  document.getElementById('metaStreak').textContent = 0;
  document.getElementById('metaScore').textContent = `0 / ${totalQuestionsNeeded}`;

  executeDisplayLoop();
}

function executeDisplayLoop() {
  const currentActiveQuestion = session.questions[session.current];
  const terminalCount = session.questions.length;

  document.getElementById('questionNum').textContent = `Evaluation Sequence ${session.current + 1} of ${terminalCount}`;
  document.getElementById('questionExpr').textContent = currentActiveQuestion.expr;

  const targetField = document.getElementById('answerInput');
  targetField.value = '';
  targetField.className = 'answer-input';
  targetField.disabled = false;
  
  document.getElementById('feedbackMsg').textContent = '';
  document.getElementById('feedbackMsg').className = 'feedback-msg';
  document.getElementById('submitBtn').disabled = false;

  document.getElementById('sessionProgressFill').style.width = `${(session.current / terminalCount) * 100}%`;

  targetField.focus();
  session.questionStart = Date.now();
  engageTimerSubsystem();
}

/**
 * ============================================================
 * ENGINE TIMER INTERFACES
 * ============================================================
 */
function engageTimerSubsystem() {
  clearInterval(session.timerInterval);
  session.timeLeft = session.maxTime;
  synchronizeTimerGraphics();

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
  const arcGraphic = document.getElementById('timerArc');
  const frameCounter = document.getElementById('timerNumber');
  
  const arcRadius = 48;
  const totalCircumference = 2 * Math.PI * arcRadius;
  const currentRatio = session.timeLeft / session.maxTime;
  const calculationOffset = totalCircumference * (1 - currentRatio);

  arcGraphic.style.strokeDasharray = totalCircumference;
  arcGraphic.style.strokeDashoffset = calculationOffset;
  frameCounter.textContent = session.timeLeft;

  arcGraphic.className = 'timer-arc';
  if (currentRatio <= 0.25) {
    arcGraphic.classList.add('critical');
  } else if (currentRatio <= 0.5) {
    arcGraphic.classList.add('warning');
  }
}

function processTimeoutFault() {
  const dataNode = session.questions[session.current];
  const totalDeltaTime = Date.now() - session.questionStart;

  session.answers.push({ chosenValue: null, statusCorrect: false, expression: dataNode.expr, actualValue: dataNode.answer });
  session.times.push(totalDeltaTime);
  session.streak = 0;

  const field = document.getElementById('answerInput');
  field.value = `Time Limit Exceeded`;
  field.className = 'answer-input wrong';
  field.disabled = true;

  const signal = document.getElementById('feedbackMsg');
  signal.textContent = `Processing Window Expired. Correct: ${dataNode.answer}`;
  signal.className = 'feedback-msg wrong';
  document.getElementById('submitBtn').disabled = true;

  refreshLiveSessionMetaChips();
  setTimeout(advanceSessionQueue, 1800);
}

/**
 * ============================================================
 * INPUT EVALUATION LOGIC
 * ============================================================
 */
function submitAnswer() {
  const structuralField = document.getElementById('answerInput');
  const filteredInputString = structuralField.value.trim();
  if (filteredInputString === '') return;

  const formattedNumericalValue = parseFloat(filteredInputString);
  const dataNode = session.questions[session.current];
  const loopDeltaTime = Date.now() - session.questionStart;

  clearInterval(session.timerInterval);
  const evaluationValidationMatch = formattedNumericalValue === dataNode.answer;

  structuralField.disabled = true;
  document.getElementById('submitBtn').disabled = true;

  const signalLabel = document.getElementById('feedbackMsg');

  if (evaluationValidationMatch) {
    session.streak++;
    session.totalCorrect++;
    structuralField.className = 'answer-input correct';
    signalLabel.className = 'feedback-msg correct';
    
    const operationalAffirmations = ['Execution Verified', 'Precision Index Nominal', 'Exact Match', 'Compliance Standard Met'];
    signalLabel.textContent = operationalAffirmations[session.current % operationalAffirmations.length];
  } else {
    session.streak = 0;
    structuralField.value = `Fault: ${filteredInputString}`;
    structuralField.className = 'answer-input wrong';
    signalLabel.className = 'feedback-msg wrong';
    signalLabel.textContent = `Variance Detected. Value: ${dataNode.answer}`;
  }

  session.answers.push({ chosenValue: formattedNumericalValue, statusCorrect: evaluationValidationMatch, expression: dataNode.expr, actualValue: dataNode.answer });
  session.times.push(loopDeltaTime);
  session.totalSolved++;

  refreshLiveSessionMetaChips();
  setTimeout(advanceSessionQueue, evaluationValidationMatch ? 1000 : 2000);
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
  document.getElementById('metaScore').textContent = `${session.totalCorrect} / ${session.questions.length}`;
}

/**
 * ============================================================
 * TERMINAL SECTOR LOG COMPILER
 * ============================================================
 */
function terminateProcessingSession() {
  clearInterval(session.timerInterval);

  const totalEvaluationsCount = session.questions.length;
  const verifiedSuccessCount = session.answers.filter(x => x.statusCorrect).length;
  const logicalStrictCompliancePass = verifiedSuccessCount === totalEvaluationsCount;
  const processingRunDuration = Date.now() - session.startTime;
  const runSuccessPercentage = Math.round((verifiedSuccessCount / totalEvaluationsCount) * 100);

  const verifiedTimeIndices = session.times.filter((t, index) => session.answers[index]?.statusCorrect);
  const processingMeanVelocity = verifiedTimeIndices.length ? Math.round(verifiedTimeIndices.reduce((a, b) => a + b, 0) / verifiedTimeIndices.length) : 0;
  const processingPeakVelocity = verifiedTimeIndices.length ? Math.min(...verifiedTimeIndices) : 0;

  const profileSubState = state.subjects[session.subject];
  profileSubState.totalQ += totalEvaluationsCount;
  profileSubState.totalCorrect += verifiedSuccessCount;
  profileSubState.totalTime += processingRunDuration;
  if (session.streak > profileSubState.bestStreak) {
    profileSubState.bestStreak = session.streak;
  }

  state.totalQ += totalEvaluationsCount;
  state.totalCorrect += verifiedSuccessCount;
  state.totalTime += processingRunDuration;
  if (session.streak > state.bestStreak) {
    state.bestStreak = session.streak;
  }

  if (logicalStrictCompliancePass) {
    if (!profileSubState.clearedLevels.includes(session.level)) {
      profileSubState.clearedLevels.push(session.level);
    }
    if (session.level === profileSubState.level) {
      profileSubState.level = session.level + 1;
    }
  }

  profileSubState.sessions.push({
    accuracy: runSuccessPercentage,
    elapsed: processingRunDuration,
    level: session.level
  });
  if (profileSubState.sessions.length > 40) profileSubState.sessions.shift();

  state.history.push({
    subjectName: session.subjectName,
    level: session.level,
    correct: verifiedSuccessCount,
    total: totalEvaluationsCount,
    elapsed: processingRunDuration,
    perfect: logicalStrictCompliancePass,
    accuracy: runSuccessPercentage,
    date: Date.now()
  });
  if (state.history.length > 60) state.history.shift();

  saveState();
  displayTerminalOverlay(logicalStrictCompliancePass, verifiedSuccessCount, totalEvaluationsCount, runSuccessPercentage, processingMeanVelocity, processingPeakVelocity);
}

function displayTerminalOverlay(isPass, correct, total, accuracy, meanTime, peakTime) {
  const frameOverlay = document.getElementById('resultOverlay');
  frameOverlay.className = 'result-overlay active';

  const headingNode = document.getElementById('resultHeading');
  
  document.getElementById('resultStatus').textContent = isPass ? 'Task Profile Clear' : 'Discipline Standards Deviation';
  headingNode.textContent = isPass ? 'Mastery Achieved.' : 'Precision Threshold Fault.';
  headingNode.className = `result-heading ${isPass ? 'success' : 'failure'}`;
  
  document.getElementById('resultSub').textContent = isPass 
    ? `All ${correct} operations solved under nominal tolerances. Next architectural step unlocked.`
    : `Compliance index at ${correct} / ${total}. System demands 100% processing structural accuracy to proceed.`;

  document.getElementById('resAcc').textContent = `${accuracy}%`;
  document.getElementById('resAvgTime').textContent = meanTime ? `${(meanTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resBest').textContent = peakTime ? `${(peakTime / 1000).toFixed(1)}s` : '—';
  document.getElementById('resStreak').textContent = session.streak;

  const structuralPanel = document.getElementById('resultBtns');
  structuralPanel.innerHTML = '';

  const dynamicPrimaryActionButton = document.createElement('button');
  dynamicPrimaryActionButton.className = 'btn-primary';
  dynamicPrimaryActionButton.textContent = isPass ? 'Advance Configuration' : 'Retry Step Cycle';
  dynamicPrimaryActionButton.onclick = () => {
    frameOverlay.className = 'result-overlay';
    const destinationTargetLevel = isPass ? state.subjects[session.subject].level : session.level;
    bootExecutionSession(session.subject, destinationTargetLevel);
  };
  structuralPanel.appendChild(dynamicPrimaryActionButton);

  const fallbackDashboardExitButton = document.createElement('button');
  fallbackDashboardExitButton.className = 'btn-secondary';
  fallbackDashboardExitButton.textContent = 'Exit to Terminal';
  fallbackDashboardExitButton.onclick = () => {
    frameOverlay.className = 'result-overlay';
    document.getElementById('sessionMeta').classList.add('hidden');
    document.getElementById('sessionProgress').classList.add('hidden');
    document.getElementById('questionView').classList.remove('active');
    showScreen('dashboard');
  };
  structuralPanel.appendChild(fallbackDashboardExitButton);
}

/**
 * ============================================================
 * HIGH CONTRAST GRAPH DATA ENGINE ANALYSIS
 * ============================================================
 */
function generateAnalyticsVisualization() {
  const totalQ = state.totalQ || 0;
  const absoluteSystemAccuracy = totalQ > 0 ? Math.round((state.totalCorrect / totalQ) * 100) : 0;
  let overallClearedLevelsSum = 0;
  
  let peakEvaluationSubjectName = '—';
  let calculationMaxTrackingValue = -1;

  SUBJECTS.forEach(s => {
    const dataInstance = state.subjects[s.id];
    overallClearedLevelsSum += dataInstance.clearedLevels.length;
    if (dataInstance.totalQ > 0) {
      const systemicMetricRatio = dataInstance.totalCorrect / dataInstance.totalQ;
      if (systemicMetricRatio > calculationMaxTrackingValue) {
        calculationMaxTrackingValue = systemicMetricRatio;
        peakEvaluationSubjectName = s.name;
      }
    }
  });

  const matrixTopGrid = document.getElementById('analyticsTopGrid');
  const metricsMappingConfig = [
    { label: 'Evaluations Checked', value: totalQ, highlight: false },
    { label: 'Precision Index', value: totalQ > 0 ? `${absoluteSystemAccuracy}%` : '—', highlight: true },
    { label: 'Milestones Secured', value: overallClearedLevelsSum, highlight: false },
    { label: 'Optimal Sector', value: peakEvaluationSubjectName, highlight: true },
    { label: 'Peak Linear Velocity', value: state.bestStreak || 0, highlight: false },
    { label: 'Total Processing Run', value: parseFormattedDuration(state.totalTime || 0), highlight: false }
  ];

  matrixTopGrid.innerHTML = '';
  metricsMappingConfig.forEach(cfg => {
    const analyticsBox = document.createElement('div');
    analyticsBox.className = 'analytics-card';
    analyticsBox.innerHTML = `<div class="label">${cfg.label}</div><div class="value${cfg.highlight ? ' accent' : ''}">${cfg.value}</div>`;
    matrixTopGrid.appendChild(analyticsBox);
  });

  const sectionBreakdownContainer = document.getElementById('subjectBreakdown');
  sectionBreakdownContainer.innerHTML = '';

  SUBJECTS.forEach(s => {
    const metaObject = state.subjects[s.id];
    const disciplineAccuracyRatio = metaObject.totalQ > 0 ? Math.round((metaObject.totalCorrect / metaObject.totalQ) * 100) : 0;
    const clearedSumLevels = metaObject.clearedLevels.length;

    const analyticalRowCard = document.createElement('div');
    analyticalRowCard.className = 'breakdown-card';
    analyticalRowCard.innerHTML = `
      <div class="breakdown-header">
        <div class="breakdown-name">${s.name}</div>
        <div class="breakdown-level">Level ${metaObject.level}</div>
      </div>
      <div class="breakdown-rows">
        <div class="breakdown-row">
          <div class="breakdown-row-label">Accuracy Index</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width: ${disciplineAccuracyRatio}%"></div></div>
          <div class="breakdown-row-val">${disciplineAccuracyRatio}%</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-row-label">Steps Cleared</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width: ${Math.min(clearedSumLevels * 10, 100)}%"></div></div>
          <div class="breakdown-row-val">${clearedSumLevels}</div>
        </div>
        <div class="breakdown-row">
          <div class="breakdown-row-label">Total Load</div>
          <div class="breakdown-row-bar"><div class="breakdown-row-fill" style="width: ${Math.min((metaObject.totalQ / 400) * 100, 100)}%"></div></div>
          <div class="breakdown-row-val">${metaObject.totalQ}</div>
        </div>
      </div>
    `;
    sectionBreakdownContainer.appendChild(analyticalRowCard);
  });

  setTimeout(executeCanvasChartLayerDrawing, 50);
}

function executeCanvasChartLayerDrawing() {
  const surfaceCanvas = document.getElementById('perfChart');
  if (!surfaceCanvas) return;
  const renderingContext = surfaceCanvas.getContext('2d');
  const geometricBoundingRect = surfaceCanvas.parentElement.getBoundingClientRect();
  
  surfaceCanvas.width = geometricBoundingRect.width || 600;
  surfaceCanvas.height = 200;

  const trackingHistorySubarray = (state.history || []).slice(-20);
  if (!trackingHistorySubarray.length) {
    renderingContext.fillStyle = '#4E4E4E';
    renderingContext.font = '12px Inter, sans-serif';
    renderingContext.fillText('Analytical datasets localized window empty. Start testing arrays.', 30, 100);
    return;
  }

  renderingContext.clearRect(0, 0, surfaceCanvas.width, surfaceCanvas.height);

  const canvasTotalW = surfaceCanvas.width;
  const canvasTotalH = surfaceCanvas.height;
  
  const insetL = 50, insetR = 20, insetT = 20, insetB = 30;
  const plotWidth = canvasTotalW - insetL - insetR;
  const plotHeight = canvasTotalH - insetT - insetB;

  renderingContext.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  renderingContext.lineWidth = 1;
  
  const verificationPoints = [0, 25, 50, 75, 100];
  verificationPoints.forEach(pct => {
    const verticalYCoordinate = insetT + plotHeight - (pct / 100) * plotHeight;
    renderingContext.beginPath();
    renderingContext.moveTo(insetL, verticalYCoordinate);
    renderingContext.lineTo(insetL + plotWidth, verticalYCoordinate);
    renderingContext.stroke();
    
    renderingContext.fillStyle = '#4E4E4E';
    renderingContext.font = '10px Inter, sans-serif';
    renderingContext.textAlign = 'right';
    renderingContext.fillText(`${pct}%`, insetL - 10, verticalYCoordinate + 3);
  });

  const runSizeCount = trackingHistorySubarray.length;
  const stepIncrementX = plotWidth / Math.max(runSizeCount - 1, 1);
  
  const geometricPlotVectorPoints = trackingHistorySubarray.map((node, idx) => ({
    x: insetL + (idx * stepIncrementX),
    y: insetT + plotHeight - (node.accuracy / 100) * plotHeight
  }));

  const vectorGlowFillGradient = renderingContext.createLinearGradient(0, insetT, 0, insetT + plotHeight);
  vectorGlowFillGradient.addColorStop(0, 'rgba(84, 122, 165, 0.15)');
  vectorGlowFillGradient.addColorStop(1, 'rgba(84, 122, 165, 0.00)');
  
  renderingContext.beginPath();
  renderingContext.moveTo(geometricPlotVectorPoints[0].x, insetT + plotHeight);
  geometricPlotVectorPoints.forEach(pt => renderingContext.lineTo(pt.x, pt.y));
  renderingContext.lineTo(geometricPlotVectorPoints[geometricPlotVectorPoints.length - 1].x, insetT + plotHeight);
  renderingContext.closePath();
  renderingContext.fillStyle = vectorGlowFillGradient;
  renderingContext.fill();

  renderingContext.beginPath();
  renderingContext.moveTo(geometricPlotVectorPoints[0].x, geometricPlotVectorPoints[0].y);
  geometricPlotVectorPoints.forEach(pt => renderingContext.lineTo(pt.x, pt.y));
  renderingContext.strokeStyle = '#547AA5';
  renderingContext.lineWidth = 2;
  renderingContext.lineJoin = 'round';
  renderingContext.stroke();

  geometricPlotVectorPoints.forEach((pt, idx) => {
    renderingContext.beginPath();
    renderingContext.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    renderingContext.fillStyle = trackingHistorySubarray[idx].perfect ? '#4E8752' : '#547AA5';
    renderingContext.fill();
  });
}

/**
 * ============================================================
 * INTERFACE CONTROL CAPTURE INITIALIZATIONS
 * ============================================================
 */
document.getElementById('answerInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    submitAnswer();
  }
});

window.addEventListener('resize', () => {
  const activeViewSelectorPanel = document.getElementById('screenAnalytics');
  if (activeViewSelectorPanel && activeViewSelectorPanel.classList.contains('active')) {
    executeCanvasChartLayerDrawing();
  }
});

// App Engine Entry Point Initialization Call
renderDashboardCore();