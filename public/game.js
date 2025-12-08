(function () {
  const GAME_CONFIG = {
    initialTime: 60, // עודכן ל-60 שניות
    baseMoney: 100,
    moneyMultiplier: 1.5,
    timeBonusBase: 8,
    timePenaltyBase: 3,
    questionsPerStage: 10,
    fetchBatchSize: 30,
    fetchBuffer: 5,
    randomSubjectsCount: 8,
    scorePerCorrectForRanking: 500,
    baseShopPrices: {
      time_small: 100,
      time_big: 200,
      lifelines: 300,
    },
    dailyStagesDistribution: [25, 22, 20, 18, 16],
  };

  const ACHIEVEMENTS_LIST = [
    // --- Knowledge & Persistence ---
    { id: 'first_step', icon: '👶', title: 'צעד ראשון', desc: 'ענית נכון על השאלה הראשונה' },
    { id: 'student', icon: '✏️', title: 'תלמיד מצטיין', desc: '10 תשובות נכונות במשחק אחד' },
    { id: 'scholar', icon: '🎓', title: 'מלומד', desc: '25 תשובות נכונות במשחק אחד' },
    { id: 'bookworm', icon: '📚', title: 'תולעת ספרים', desc: '50 תשובות נכונות במשחק אחד' },
    { id: 'professor', icon: '🏫', title: 'פרופסור', desc: '80 תשובות נכונות במשחק אחד' },
    { id: 'encyclopedia', icon: '🧠', title: 'אנציקלופדיה', desc: '100 תשובות נכונות במשחק אחד' },

    // --- Stages ---
    { id: 'stage_3', icon: '🥉', title: 'מתחילים להתחמם', desc: 'הגעת לשלב 3' },
    { id: 'stage_5', icon: '🥈', title: 'חצי דרך', desc: 'הגעת לשלב 5' },
    { id: 'stage_8', icon: '🧗', title: 'מטפס הרים', desc: 'הגעת לשלב 8' },
    { id: 'stage_10', icon: '🥇', title: 'מנצח האתגר', desc: 'סיימת את כל 10 השלבים!' },

    // --- Streaks ---
    { id: 'streak_3', icon: '🔥', title: 'מתחמם', desc: '3 תשובות נכונות ברצף' },
    { id: 'streak_5', icon: '🔥🔥', title: 'על הגל', desc: '5 תשובות נכונות ברצף' },
    { id: 'streak_10', icon: '💣', title: 'פצצה', desc: '10 תשובות נכונות ברצף' },
    { id: 'streak_15', icon: '⚡', title: 'בלתי ניתן לעצירה', desc: '15 תשובות נכונות ברצף' },
    { id: 'streak_20', icon: '🦄', title: 'אגדי', desc: '20 תשובות נכונות ברצף' },

    // --- Speed ---
    { id: 'quick_draw', icon: '🤠', title: 'שולף מהיר', desc: 'ענית תוך פחות מ-2 שניות' },
    { id: 'sprinter', icon: '🏃', title: 'אצן', desc: 'ענית תוך פחות מ-1.5 שניות' },
    { id: 'flash', icon: '⚡', title: 'פלאש', desc: '3 תשובות מהירות ברצף' },

    // --- Economy ---
    { id: 'pocket_money', icon: '💰', title: 'דמי כיס', desc: 'צברת 1,000 ₪' },
    { id: 'businessman', icon: '💼', title: 'איש עסקים', desc: 'צברת 25,000 ₪' },
    { id: 'tycoon', icon: '🏗️', title: 'טייקון', desc: 'צברת 50,000 ₪' },
    { id: 'millionaire', icon: '💎', title: 'מיליונר', desc: 'צברת 100,000 ₪' },
    
    // --- Special ---
    { id: 'spender', icon: '💸', title: 'בזבזן', desc: 'קנית פריט בחנות' },
    { id: 'shopaholic', icon: '🛍️', title: 'שופוהוליק', desc: 'קנית 5 פריטים במשחק אחד' },
    { id: 'perfect_stage', icon: '✨', title: 'מושלם', desc: 'סיימת שלב ללא טעויות' },
    { id: 'survivor', icon: '🏝️', title: 'הישרדות', desc: 'הגעת לשלב 5 ללא עזרה' },
    { id: 'phoenix', icon: '🦅', title: 'עוף החול', desc: 'ענית נכון כשנותרו פחות מ-3 שניות' },
    { id: 'last_second', icon: '⏱️', title: 'ברגע האחרון', desc: 'עברת שלב עם פחות משנייה אחת' },
    { id: 'comeback', icon: '🛡️', title: 'קאמבק', desc: 'התאוששת אחרי 3 טעויות' },
  ];

  let state = {
    isPlaying: false,
    isDailyMode: false,
    playerName: 'אורח',
    timeLeft: 60, // עודכן ל-60
    score: 0,
    stage: 1,
    totalCorrect: 0,
    totalWrong: 0,
    currentStageCorrect: 0,
    questionInStageIndex: 0,
    globalQuestionIndex: 0,
    currentQuestion: null,
    questionQueue: [],
    seenQuestions: new Set(),
    streak: 0,
    lifelines: { '5050': 1, ai: 1, freeze: 1 },
    isFrozen: false,
    isShopOpen: false,
    lastFrameTime: 0,
    questionStartTime: 0,
    unlockedAchievements: [],
    customTopics: [],
    useGoogle: false,
    lowTimeFlag: false,
  };

  let audioCtx = null;
  let lastHighScores = [];

  class SoundManager {
    constructor() {
      this.init();
    }
    init() {
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) audioCtx = new AudioContext();
    }
    playTone(freq, type, duration) {
      if (!audioCtx) this.init();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    }
    playCorrect() {
      this.playTone(600, 'sine', 0.1);
      setTimeout(() => this.playTone(800, 'sine', 0.2), 100);
    }
    playWrong() {
      this.playTone(150, 'sawtooth', 0.3);
      setTimeout(() => this.playTone(100, 'sawtooth', 0.4), 150);
    }
    playTick() {
      this.playTone(800, 'square', 0.05);
    }
    playWin() {
      [400, 500, 600, 800].forEach((freq, i) =>
        setTimeout(() => this.playTone(freq, 'triangle', 0.2), i * 100)
      );
    }
    playSpeedBonus() {
      this.playTone(1000, 'sine', 0.1);
      setTimeout(() => this.playTone(1500, 'sine', 0.1), 100);
    }
    playCash() {
      this.playTone(1200, 'sine', 0.1);
      setTimeout(() => this.playTone(2000, 'square', 0.2), 100);
    }
  }
  const sound = new SoundManager();

  function addCustomTopic() {
    const input = document.getElementById('custom-topic-input');
    if (!input) return;
    const topic = input.value.trim();
    if (topic && !state.customTopics.includes(topic)) {
      state.customTopics.push(topic);
      renderCustomTopics();
      input.value = '';
    }
  }

  function removeCustomTopic(topic) {
    state.customTopics = state.customTopics.filter((t) => t !== topic);
    renderCustomTopics();
  }

  function renderCustomTopics() {
    const list = document.getElementById('custom-topics-list');
    if (!list) return;
    list.innerHTML = '';
    state.customTopics.forEach((topic) => {
      const tag = document.createElement('div');
      tag.className = 'topic-tag';
      tag.innerHTML = `
        <span>${topic}</span>
        <span class="topic-remove" onclick="window.removeCustomTopic && window.removeCustomTopic('${topic}')">×</span>
      `;
      list.appendChild(tag);
    });
  }

  function toggleGoogleSearch() {
    const toggle = document.getElementById('google-search-toggle');
    if (!toggle) return;
    state.useGoogle = toggle.checked;
  }

  function renderSources(sources) {
    const list = document.getElementById('sources-list');
    if (!list) return;
    list.innerHTML = '';
    if (!sources || sources.length === 0) return;

    const title = document.createElement('div');
    title.style.color = 'var(--secondary)';
    title.style.fontSize = '0.9rem';
    title.style.marginBottom = '5px';
    title.textContent = 'מקורות שנמצאו:';
    list.appendChild(title);

    sources.forEach((src) => {
      const item = document.createElement('div');
      item.className = 'source-item';
      const text = src.title || (src.content && src.content.title) || 'מקור מידע';
      const uri = src.uri || (src.web && src.web.uri) || '#';
      item.innerHTML = `<a href="${uri}" target="_blank" style="color:inherit; text-decoration:none;">🔗 ${text}</a>`;
      list.appendChild(item);
    });
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // --- UPDATED VALIDATION FOR 2+ OPTIONS ---
  function isValidQuestion(q) {
    if (!q || typeof q !== 'object') return false;
    if (!q.question || typeof q.question !== 'string' || q.question.length < 3) return false;
    // Allow 2 options (True/False) or more
    if (!Array.isArray(q.options) || q.options.length < 2) return false; 
    if (q.options.some(opt => !opt || typeof opt !== 'string' || opt.trim().length === 0)) return false;
    // Dynamic index check based on options length
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return false; 
    if (!q.category || typeof q.category !== 'string') return false;
    return true;
  }

  // --- פונקציה מעודכנת ליצירת זוויות חכמות ומגוונות ---
  function generateSmartAngles(topics) {
    const hasTopics = topics && topics.length > 0;
    const context = hasTopics ? `הקשורות לנושאים: ${topics.join(', ')}` : 'בנושאים כלליים ומגוונים';

    return [
      `צור שאלת "איזו מהעובדות הבאות נכונה/לא נכונה" ${context}. הקפד על עובדות לא בנאליות.`,
      `נסח את השאלה כחידת היגיון או חידה מחשבתית ${context}.`,
      `התמקד בפרטים נישתיים, עובדות נדירות או מידע שרק מומחים יודעים ${context}.`,
      `שאל על מקורות, היסטוריה רחוקה או אטימולוגיה ${context}.`,
      `חפש שיאים, נתונים מספריים קיצוניים או סטטיסטיקות מפתיעות ${context}.`,
      `התמקד בניפוץ מיתוסים נפוצים או טעויות רווחות ${context}.`,
      `צור שאלה בסגנון "יוצא דופן" (מי לא שייך לרשימה) ${context}.`,
      `שאל שאלה הדורשת ידע מעמיק ולא שטחי ${context}, המנע מהמובן מאליו.`
    ];
  }

  async function fetchQuestionsFromAI(count, currentStage) {
    if (state.isDailyMode) return [];

    const totalToFetch = count + GAME_CONFIG.fetchBuffer;
    const maxRetries = 3;

    // כאן אנו קוראים לפונקציה החדשה במקום להשתמש במערך הסטטי
    const possibleAngles = generateSmartAngles(state.customTopics);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const currentAngle = possibleAngles[Math.floor(Math.random() * possibleAngles.length)];
      const randomSeed = Math.floor(Math.random() * 999999);

      let promptContext = '';

      if (state.customTopics.length > 0) {
        promptContext = `
          המשתמש ביקש שאלות בנושאים הבאים: ${state.customTopics.join(', ')}.
          עליך ליצור ${totalToFetch} שאלות.
          הנחיות:
          1. השאלות חייבות להיות קשורות לנושאים הללו.
          2. חובה לערבב בין הנושאים.
          3. זווית כתיבה: ${currentAngle}.
        `;
        if (state.useGoogle) {
          promptContext += `
            4. השתמש בחיפוש Google למציאת מידע עדכני ומדויק.
          `;
        }
      } else {
        promptContext = `צור שאלות כלליות מעניינות ומגוונות. זווית כתיבה: ${currentAngle}.`;
      }

      let difficulty;
      if (currentStage === 1) difficulty = 'קל מאוד';
      else if (currentStage === 2) difficulty = 'קל';
      else if (currentStage <= 5) difficulty = 'בינוני';
      else if (currentStage <= 8) difficulty = 'קשה';
      else difficulty = 'קשה מאוד (אכזרי)';

      const prompt = `
        אתה מנוע טריוויה דינמי.
        Seed: ${randomSeed}.
        
        משימה: צור ${totalToFetch} שאלות טריוויה בעברית.
        ${promptContext}

        הנחיות קריטיות:
        - רמת קושי: **${difficulty}**.
        - הפלט חייב להיות **JSON בלבד**.
        - אם יש מרכאות (") בתוך הטקסט, שים לוכסן (escape).
        
        החזר אך ורק את ה-JSON הבא:
        [
          {
            "question": "שאלה",
            "options": ["תשובה1", "תשובה2", "תשובה3", "תשובה4"],
            "correctIndex": 0,
            "hint": "רמז",
            "category": "שם הקטגוריה"
          }
        ]
      `;

      const requestBody = {
        prompt,
        enable_google_search: state.useGoogle,
        tools: state.useGoogle ? [{ google_search: {} }] : [],
        apiKey: window.userApiKey
      };

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) throw new Error('Server error');

        const data = await response.json();

        let groundingSources = [];
        if (data.candidates?.[0]?.groundingMetadata?.groundingAttributions) {
          groundingSources = data.candidates[0].groundingMetadata.groundingAttributions;
        }
        if (groundingSources.length > 0 && attempt === 1) renderSources(groundingSources);

        if (data.candidates && data.candidates[0].content && data.candidates[0].content.parts) {
          let text = data.candidates[0].content.parts[0].text;
          text = text.replace(/```json/g, '').replace(/```/g, '');
          const start = text.indexOf('[');
          if (start !== -1) {
            let jsonStr = text.substring(start);
            const end = jsonStr.lastIndexOf(']');
            if (end !== -1) jsonStr = jsonStr.substring(0, end + 1);

            jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1').replace(/}\s*{/g, '}, {');

            try {
              let parsed = JSON.parse(jsonStr);
              if (Array.isArray(parsed) && parsed.length > 0) {
                const validQuestions = parsed.filter(isValidQuestion);
                if (validQuestions.length === 0) throw new Error("No valid questions");
                const processed = validQuestions.map(q => {
                  const originalCorrectAnswer = q.options[q.correctIndex];
                  shuffleArray(q.options);
                  const newCorrectIndex = q.options.indexOf(originalCorrectAnswer);
                  q.correctIndex = newCorrectIndex !== -1 ? newCorrectIndex : 0;
                  return q;
                });
                return processed;
              }
            } catch (e) {
              console.warn(`JSON Parse failed on attempt ${attempt}.`, e);
            }
          }
        }
      } catch (error) {
        console.error(`Error on attempt ${attempt}:`, error);
      }
    }

    return Array.from({ length: count }, (_, i) => ({
      question: `שגיאה בטעינת שאלה ${i + 1}`,
      options: ['תקלה', 'בחיבור', 'לשרת', 'ה-AI'],
      correctIndex: 0,
      category: 'שגיאה',
      hint: 'בדוק מפתח API',
    }));
  }

  function initGame() {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
    loadLocalAchievements();

    const input = document.getElementById('custom-topic-input');
    if (input) {
      input.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          addCustomTopic();
        }
      });
    }
  }

  function loadLocalAchievements() {
    state.unlockedAchievements = [];
  }

  function hasAchievement(id) {
    return state.unlockedAchievements.includes(id);
  }

  function checkAchievements() {
    const newUnlocks = [];
    
    // בדיקות מעודכנות לפי הרשימה החדשה
    if (state.totalCorrect >= 1 && !hasAchievement('first_step')) newUnlocks.push('first_step');
    if (state.totalCorrect >= 10 && !hasAchievement('student')) newUnlocks.push('student');
    if (state.totalCorrect >= 25 && !hasAchievement('scholar')) newUnlocks.push('scholar');
    if (state.totalCorrect >= 50 && !hasAchievement('bookworm')) newUnlocks.push('bookworm');
    if (state.totalCorrect >= 80 && !hasAchievement('professor')) newUnlocks.push('professor');
    if (state.totalCorrect >= 100 && !hasAchievement('encyclopedia')) newUnlocks.push('encyclopedia');

    if (state.stage >= 3 && !hasAchievement('stage_3')) newUnlocks.push('stage_3');
    if (state.stage >= 5 && !hasAchievement('stage_5')) newUnlocks.push('stage_5');
    if (state.stage >= 8 && !hasAchievement('stage_8')) newUnlocks.push('stage_8');
    if (state.stage >= 10 && !hasAchievement('stage_10')) newUnlocks.push('stage_10');

    if (state.streak >= 3 && !hasAchievement('streak_3')) newUnlocks.push('streak_3');
    if (state.streak >= 5 && !hasAchievement('streak_5')) newUnlocks.push('streak_5');
    if (state.streak >= 10 && !hasAchievement('streak_10')) newUnlocks.push('streak_10');
    if (state.streak >= 15 && !hasAchievement('streak_15')) newUnlocks.push('streak_15');
    if (state.streak >= 20 && !hasAchievement('streak_20')) newUnlocks.push('streak_20');

    if (state.score >= 1000 && !hasAchievement('pocket_money')) newUnlocks.push('pocket_money');
    if (state.score >= 25000 && !hasAchievement('businessman')) newUnlocks.push('businessman');
    if (state.score >= 50000 && !hasAchievement('tycoon')) newUnlocks.push('tycoon');
    if (state.score >= 100000 && !hasAchievement('millionaire')) newUnlocks.push('millionaire');

    // הישגי זמן ואחרים נבדקים בלוגיקה של המשחק בזמן אמת

    if (newUnlocks.length > 0) {
      newUnlocks.forEach((id) => {
        state.unlockedAchievements.push(id);
        const achInfo = ACHIEVEMENTS_LIST.find(a => a.id === id);
        showFloatingText(`🏆 הישג: ${achInfo ? achInfo.title : 'חדש!'}`, 'general', 'gold');
      });
    }
  }

  function unlockAchievement(id) {
    if (!hasAchievement(id)) {
      state.unlockedAchievements.push(id);
      const achInfo = ACHIEVEMENTS_LIST.find(a => a.id === id);
      showFloatingText(`🏆 ${achInfo ? achInfo.title : 'הישג חדש!'}`, 'general', 'gold');
    }
  }

  async function startDailyChallenge() {
    const nameInput = document.getElementById('player-name-input');
    if (!nameInput) return;
    const playerName = nameInput.value.trim();
    if (!playerName) {
      alert('יש להזין שם כדי להשתתף!');
      nameInput.focus();
      return;
    }

    state.playerName = playerName;
    state.isDailyMode = true;
    switchScreen('loading-screen');
    resetGameState();

    const msgEl = document.getElementById('loading-msg');
    if (msgEl) msgEl.textContent = 'טוען את האתגר היומי... 📅';

    try {
      const res = await fetch('/api/daily-challenge');
      if (!res.ok) throw new Error('Daily challenge fetch failed');
      const data = await res.json();

      if (data.questions && Array.isArray(data.questions)) {
        
        // --- RANDOMIZE QUESTION ORDER ---
        // ערבוב סדר השאלות כדי שבכל ניסיון השחקן יקבל רצף שונה
        shuffleArray(data.questions);

        const processed = data.questions.map(q => {
          if (isValidQuestion(q)) {
            const originalCorrectAnswer = q.options[q.correctIndex];
            // Options are shuffled here (already implemented)
            shuffleArray(q.options);
            const newCorrectIndex = q.options.indexOf(originalCorrectAnswer);
            q.correctIndex = newCorrectIndex !== -1 ? newCorrectIndex : 0;
            return q;
          }
          return null;
        }).filter(q => q !== null);

        state.questionQueue = processed;

        switchScreen('game-screen');
        state.lastFrameTime = performance.now();
        requestAnimationFrame(gameLoop);
        renderQuestion();
        updateHUD();
      } else {
        throw new Error('No questions returned. Try again later.');
      }

    } catch (e) {
      console.error(e);
      alert('שגיאה בטעינת האתגר היומי (ייתכן ועדיין נבנה). נסה שוב מאוחר יותר.');
      returnToMenu();
    }
  }

  async function startCustomGame() {
    const nameInput = document.getElementById('player-name-input');
    if (!nameInput) return;
    const playerName = nameInput.value.trim();
    if (!playerName) {
      alert('יאללה, תן שם ונתחיל!');
      nameInput.focus();
      return;
    }

    if (!window.userApiKey) {
      alert('יש להגדיר מפתח API בפרופיל השחקן כדי לשחק במשחק מותאם אישית.');
      return;
    }

    if (state.customTopics.length === 0) {
      alert('יש לבחור לפחות נושא אחד!');
      return;
    }

    state.playerName = playerName;
    state.isDailyMode = false;
    switchScreen('loading-screen');
    resetGameState();
    await loadNextBatch();

    if (state.questionQueue.length === 0) {
      alert('לא הצלחנו ליצור שאלות. בדוק את המפתח שלך.');
      returnToMenu();
      return;
    }

    switchScreen('game-screen');
    state.lastFrameTime = performance.now();
    requestAnimationFrame(gameLoop);
    renderQuestion();
    updateHUD();
  }

  function startGame() {
    startCustomGame(); 
  }

  function resetGameState() {
    state.isPlaying = true;
    state.timeLeft = GAME_CONFIG.initialTime;
    state.score = 0;
    state.stage = 1;
    state.totalCorrect = 0;
    state.totalWrong = 0;
    state.questionInStageIndex = 0;
    state.globalQuestionIndex = 0;
    state.streak = 0;
    state.questionQueue = [];
    state.seenQuestions = new Set();
    state.lifelines = { '5050': 1, ai: 1, freeze: 1 };
    state.isFrozen = false;
    state.isShopOpen = false;
    state.unlockedAchievements = [];
    state.lowTimeFlag = false;
    lastHighScores = [];

    document.querySelectorAll('.lifeline-btn').forEach((btn) => {
      btn.disabled = false;
      btn.style.opacity = '1';
      const badge = btn.querySelector('.lifeline-badge');
      if (badge) badge.textContent = '1';
    });
  }

  async function loadNextBatch() {
    if (state.isDailyMode && state.questionQueue.length === 0) {
      return;
    }

    const msgEl = document.getElementById('loading-msg');
    const sourcesList = document.getElementById('sources-list');
    const tipEl = document.getElementById('loading-tip');

    if (sourcesList) sourcesList.innerHTML = '';

    if (msgEl) {
      if (state.useGoogle) {
        msgEl.textContent = 'מחפש מידע בגוגל... 🌍';
      } else if (state.customTopics.length > 0) {
        msgEl.textContent = 'חוקר את הנושאים שלך...';
      } else {
        msgEl.textContent = 'מכין את השלב הבא...';
      }
    }

    try {
      const newQuestions = await fetchQuestionsFromAI(GAME_CONFIG.fetchBatchSize, state.stage);
      const uniqueQuestions = [];
      if (Array.isArray(newQuestions)) {
        newQuestions.forEach((q) => {
          const qKey = (q.question || '').trim();
          if (!state.seenQuestions.has(qKey)) {
            state.seenQuestions.add(qKey);
            uniqueQuestions.push(q);
          }
        });
      }
      state.questionQueue = [...state.questionQueue, ...uniqueQuestions];
    } catch (e) {
      console.error('Failed loading batch', e);
    }
  }

  function gameLoop(timestamp) {
    if (!state.isPlaying) return;
    if (!state.lastFrameTime) state.lastFrameTime = timestamp;
    const deltaTime = (timestamp - state.lastFrameTime) / 1000;
    state.lastFrameTime = timestamp;

    if (!state.isFrozen) {
      state.timeLeft -= deltaTime;
    }

    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      gameOver('נגמר הזמן! 🕒');
      updateHUD();
      return;
    }

    if (state.timeLeft < 10 && state.timeLeft > 0 && !state.isShopOpen && !state.isFrozen) {
      const prevSec = Math.ceil(state.timeLeft + deltaTime);
      const currSec = Math.ceil(state.timeLeft);
      if (prevSec !== currSec) sound.playTick();
    }

    updateHUD();
    requestAnimationFrame(gameLoop);
  }

  function updateHUD() {
    const timeDisplay = document.getElementById('time-display');
    const scoreDisplay = document.getElementById('score-display');
    const stageDisplay = document.getElementById('stage-display');
    const progressText = document.getElementById('stage-progress');
    const timerBar = document.getElementById('timer-bar');

    if (timeDisplay) timeDisplay.textContent = state.timeLeft.toFixed(1);
    if (scoreDisplay) scoreDisplay.textContent = state.score.toLocaleString();
    if (stageDisplay) stageDisplay.textContent = String(state.stage);

    let questionsThisStage = GAME_CONFIG.questionsPerStage;
    if (state.isDailyMode) {
      const distIndex = Math.min(state.stage - 1, GAME_CONFIG.dailyStagesDistribution.length - 1);
      questionsThisStage = GAME_CONFIG.dailyStagesDistribution[distIndex];
    }

    const currentQ = state.questionInStageIndex + 1;
    if (progressText) {
      if (state.isDailyMode) {
        progressText.textContent = `שאלה ${currentQ} מתוך ${questionsThisStage} (אתגר יומי)`;
      } else {
        progressText.textContent = `שאלה ${currentQ} מתוך ${GAME_CONFIG.questionsPerStage} בשלב ${state.stage}`;
      }
    }

    if (timerBar) {
      const percent = (state.timeLeft / GAME_CONFIG.initialTime) * 100;
      timerBar.style.width = Math.min(Math.max(percent, 0), 100) + '%';
      if (state.timeLeft < 10) timerBar.classList.add('danger');
      else timerBar.classList.remove('danger');
    }
  }

  function renderQuestion() {
    let questionsNeededForNextStage = GAME_CONFIG.questionsPerStage;

    if (state.isDailyMode) {
      const distIndex = Math.min(state.stage - 1, GAME_CONFIG.dailyStagesDistribution.length - 1);
      questionsNeededForNextStage = GAME_CONFIG.dailyStagesDistribution[distIndex];
    }

    if (state.questionInStageIndex >= questionsNeededForNextStage) {
      state.stage++;
      state.questionInStageIndex = 0;

      if (state.stage >= 10 && !hasAchievement('stage_10')) {
        unlockAchievement('stage_10');
      }
      showFloatingText(`שלב ${state.stage}!`, 'general', 'var(--secondary)');
    }

    if (state.questionQueue.length === 0) {
      if (state.isDailyMode) {
        gameOver('סיימת את כל השאלות היומיות! 🏆');
        return;
      }
      state.isFrozen = true;
      switchScreen('loading-screen');
      loadNextBatch().then(() => {
        switchScreen('game-screen');
        state.isFrozen = false;
        renderQuestion();
      });
      return;
    }

    const q = state.questionQueue.shift();
    state.currentQuestion = q;
    state.questionStartTime = Date.now();

    const container = document.getElementById('options-container');
    const questionText = document.getElementById('question-text');
    const categoryEl = document.getElementById('question-category');

    if (container) container.innerHTML = '';
    if (questionText) questionText.textContent = q.question;
    if (categoryEl) categoryEl.textContent = q.category || 'כללי';

    if (container) {
      q.options.forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;
        btn.onclick = () => handleAnswer(idx, btn);
        container.appendChild(btn);
      });
    }

    updateHUD();
  }

  function handleAnswer(selectedIndex, btnElement) {
    if (!state.isPlaying || btnElement.classList.contains('disabled')) return;

    const buttons = document.querySelectorAll('.option-btn');
    buttons.forEach((b) => b.classList.add('disabled'));
    const isCorrect = selectedIndex === state.currentQuestion.correctIndex;
    const reactionTime = (Date.now() - state.questionStartTime) / 1000;

    if (isCorrect) {
      btnElement.classList.add('correct');
      sound.playCorrect();
      handleCorrectAnswer(reactionTime);
    } else {
      btnElement.classList.add('wrong');
      const correctBtn = buttons[state.currentQuestion.correctIndex];
      if (correctBtn) correctBtn.classList.add('correct');
      sound.playWrong();
      handleWrongAnswer();
    }

    state.questionInStageIndex++;
    state.globalQuestionIndex++;
    checkAchievements();

    setTimeout(() => {
      if (state.isPlaying) renderQuestion();
    }, 1500);
  }

  function handleCorrectAnswer(reactionTime) {
    state.totalCorrect++;
    state.streak++;

    // Speed achievements
    if (reactionTime < 2 && !hasAchievement('quick_draw')) unlockAchievement('quick_draw');
    if (reactionTime < 1.5 && !hasAchievement('sprinter')) unlockAchievement('sprinter');
    
    // Low time survival achievement
    if (state.timeLeft < 3 && !hasAchievement('phoenix')) unlockAchievement('phoenix');

    if (state.timeLeft < 5) state.lowTimeFlag = true;
    if (state.lowTimeFlag && state.timeLeft > 30) {
      // Re-adding this generic phoenix achievement if kept
    }

    let moneyReward = Math.floor(
      GAME_CONFIG.baseMoney * Math.pow(GAME_CONFIG.moneyMultiplier, state.stage - 1)
    );
    let timeBonus = Math.max(2, GAME_CONFIG.timeBonusBase - state.stage * 0.5);

    let isSpeedRun = false;
    if (reactionTime < 2) {
      isSpeedRun = true;
      moneyReward = Math.floor(moneyReward * 1.5);
      timeBonus += 2;
      sound.playSpeedBonus();
      showFloatingText('⚡ SPEED RUN! ⚡', 'general', '#ffeb3b');
    }

    if (state.streak >= 3) {
      moneyReward += state.streak * 10;
      showFloatingText(`${state.streak} ברצף! 🔥`, 'general', '#ff5722');
    }

    state.score += moneyReward;
    state.timeLeft += timeBonus;

    showFloatingText(`+₪${moneyReward}`, 'money', 'var(--success)');
    showFloatingText(`+${timeBonus.toFixed(1)}s`, 'time', 'var(--secondary)');

    if (state.streak % 5 === 0 || isSpeedRun) {
      if (window.confetti) {
        window.confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.8 },
          colors: ['#7000ff', '#00f0ff'],
        });
      }
    }
  }

  function handleWrongAnswer() {
    state.streak = 0;
    state.totalWrong++;
    const timePenalty = GAME_CONFIG.timePenaltyBase;
    state.timeLeft -= timePenalty;

    showFloatingText(`-${timePenalty}s`, 'time', 'var(--danger)');
    showFloatingText('אופס! 😬', 'general', '#ffcc00');
  }

  function showFloatingText(text, type, color) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;

    if (type === 'money') {
      el.style.left = '20px';
      el.style.top = '100px';
      el.classList.add('float-up');
      el.style.fontSize = '1.5rem';
    } else if (type === 'time') {
      el.style.right = '20px';
      el.style.top = '100px';
      el.classList.add('float-up');
      el.style.fontSize = '1.5rem';
    } else {
      el.style.left = '50%';
      el.style.top = '50%';
      el.classList.add('float-center');
    }

    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  function useLifeline(type) {
    if (!state.isPlaying || state.lifelines[type] <= 0) return;

    const btn = document.querySelector(`#btn-${type}`);
    state.lifelines[type]--;
    if (btn) {
      const badge = btn.querySelector('.lifeline-badge');
      if (badge) badge.textContent = '0';
      btn.disabled = true;
      btn.style.opacity = '0.5';
    }

    if (type === '5050') {
      const correctIdx = state.currentQuestion.correctIndex;
      const buttons = document.querySelectorAll('.option-btn');
      const wrongIndices = [];
      buttons.forEach((_, i) => {
        if (i !== correctIdx) wrongIndices.push(i);
      });

      for (let i = wrongIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [wrongIndices[i], wrongIndices[j]] = [wrongIndices[j], wrongIndices[i]];
      }
      if (buttons[wrongIndices[0]]) buttons[wrongIndices[0]].style.visibility = 'hidden';
      if (buttons[wrongIndices[1]]) buttons[wrongIndices[1]].style.visibility = 'hidden';
    } else if (type === 'freeze') {
      state.isFrozen = true;
      document.body.style.filter = 'grayscale(80%)';
      showFloatingText('הזמן קפא! ❄️', 'general', 'var(--secondary)');
      setTimeout(() => {
        state.isFrozen = false;
        document.body.style.filter = 'none';
      }, 5000);
    } else if (type === 'ai') {
      const bubble = document.getElementById('ai-bubble');
      const correctIdx = state.currentQuestion.correctIndex;
      const correctTxt = state.currentQuestion.options[correctIdx];
      const confidence = Math.floor(Math.random() * (95 - 60) + 60);
      let aiText = '';
      if (confidence > 80) {
        aiText = `🤖 Gemini: "אני ${confidence}% בטוח שזה <b>${correctTxt}</b>."`;
      } else {
        const wrongIdx = (correctIdx + 1) % 4;
        const wrongTxt = state.currentQuestion.options[wrongIdx];
        aiText = `🤖 Gemini: "מתלבט בין ${wrongTxt} ל-${correctTxt}... אבל הולך על <b>${correctTxt}</b> (${confidence}%)"`;
      }
      if (bubble) {
        bubble.style.display = 'block';
        bubble.innerHTML = aiText;
        setTimeout(() => {
          bubble.style.display = 'none';
        }, 6000);
      }
    }
  }

  function getShopPrice(type) {
    const s = state.stage;
    const base = GAME_CONFIG.baseShopPrices;
    if (type === 'time_small') return base.time_small + (s - 1) * 50;
    if (type === 'time_big') return base.time_big + (s - 1) * 100;
    if (type === 'lifelines') return base.lifelines + (s - 1) * 150;
    return 9999;
  }

  function openShop() {
    if (!state.isPlaying) return;
    state.isShopOpen = true;
    const s1 = document.getElementById('shop-price-time-small');
    const s2 = document.getElementById('shop-price-time-big');
    const s3 = document.getElementById('shop-price-lifelines');
    if (s1) s1.textContent = `₪${getShopPrice('time_small')}`;
    if (s2) s2.textContent = `₪${getShopPrice('time_big')}`;
    if (s3) s3.textContent = `₪${getShopPrice('lifelines')}`;
    const modal = document.getElementById('shop-modal');
    if (modal) modal.classList.add('active');
  }

  function closeShop() {
    const modal = document.getElementById('shop-modal');
    if (modal) modal.classList.remove('active');
    state.isShopOpen = false;
    state.lastFrameTime = performance.now();
  }

  function buyItem(type, btnElement) {
    const price = getShopPrice(type);
    if (state.score >= price) {
      state.score -= price;
      if (type === 'time_small') {
        state.timeLeft += 10;
        showFloatingText('+10s', 'time', 'var(--success)');
      } else if (type === 'time_big') {
        state.timeLeft += 30;
        showFloatingText('+30s', 'time', 'var(--success)');
      } else if (type === 'lifelines') {
        state.lifelines = { '5050': 1, ai: 1, freeze: 1 };
        document.querySelectorAll('.lifeline-btn').forEach((btn) => {
          btn.disabled = false;
          btn.style.opacity = '1';
          const badge = btn.querySelector('.lifeline-badge');
          if (badge) badge.textContent = '1';
        });
        showFloatingText('עזרות מלאות!', 'general', 'var(--primary)');
      }
      sound.playCash();
      unlockAchievement('spender');

      // Shopaholic
      // Need to track purchases per game if we want that achievement to work perfectly
      
      updateHUD();
      if (btnElement) {
        const originalBg = btnElement.style.background;
        btnElement.style.background = 'var(--success)';
        setTimeout(() => {
          btnElement.style.background = originalBg;
        }, 200);
      }
    } else {
      sound.playWrong();
      showFloatingText('אין מספיק כסף!', 'money', 'var(--danger)');
    }
  }

  async function openLeaderboard(type = 'daily') {
    const modal = document.getElementById('leaderboard-modal');
    const content = document.getElementById('modal-body-content');
    const titleEl = document.getElementById('modal-title');
    const backBtn = document.getElementById('modal-back-btn');

    if (!modal || !content || !titleEl || !backBtn) return;

    modal.classList.add('active');
    titleEl.textContent = '🏆 היכל התהילה';
    backBtn.style.display = 'none';

    const tabsHtml = `
      <div style="display:flex; justify-content:center; gap:10px; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:10px;">
          <button onclick="window.openLeaderboard('daily')" class="btn" style="padding:5px 15px; font-size:0.8rem; background:${type === 'daily' ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}">יומי</button>
          <button onclick="window.openLeaderboard('accumulated')" class="btn" style="padding:5px 15px; font-size:0.8rem; background:${type === 'accumulated' ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}">מצטבר</button>
          <button onclick="window.openLeaderboard('personal')" class="btn" style="padding:5px 15px; font-size:0.8rem; background:${type === 'personal' ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}">אישי</button>
      </div>
      <div id="scores-list"></div>
    `;
    
    content.innerHTML = tabsHtml + '<p style="text-align:center; opacity:0.6;">טוען נתונים...</p>';
    const listContainer = document.getElementById('scores-list');

    try {
      const userId = window.currentUser?.id || '';
      const res = await fetch(`/api/high-scores?type=${type}&userId=${userId}`);
      if (!res.ok) throw new Error('Response not OK');
      const data = await res.json();
      const highScores = data.scores || [];
      lastHighScores = highScores;

      let html = '';
      if (highScores.length === 0) {
        html = '<p style="text-align:center; opacity:0.6;">עדיין אין נתונים בטבלה זו...</p>';
      } else {
        const subTitle = type === 'accumulated' ? 'הטובים ביותר בכל הזמנים' : (type === 'personal' ? 'ההיסטוריה שלי' : 'היום (מתאפס בחצות)');
        html += `<div style="font-size:0.8rem; color:var(--secondary); margin-bottom:10px; text-align:center;">${subTitle}</div>`;

        highScores.forEach((s, i) => {
          const isAccumulated = type === 'accumulated';
          const score = s.score || 0; 
          
          const money = isAccumulated ? (s.total_money || 0) : (s.money || 0);
          const correct = isAccumulated ? (s.total_correct || 0) : (s.correct_count || 0);
          const wrong = isAccumulated ? (s.total_wrong || 0) : (s.wrong_count || 0);
          
          const dateRaw = s.created_at || s.last_played_at;
          const created = dateRaw ? new Date(dateRaw).toLocaleDateString('he-IL') : '';
          const maskedId = s.masked_id ? `(${s.masked_id})` : '';
          const accumulatedIcon = isAccumulated ? '∑ ' : ''; 

          // COSMETICS LOGIC
          const isGolden = s.golden_name_expires_at && new Date(s.golden_name_expires_at) > new Date();
          const nameClass = isGolden ? 'golden-name' : '';
          const activeFrame = s.active_frame && s.active_frame !== 'none' ? s.active_frame : '';
          const frameClass = activeFrame ? `profile-frame ${activeFrame}` : '';

          html += `
            <div class="leaderboard-item ${frameClass}" onclick="showPlayerDetails(${i})" style="flex-direction: column; align-items: stretch; gap: 5px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                  <div>
                      <span style="font-weight:bold; color:var(--secondary); font-size: 1.1rem;" class="${nameClass}">#${i + 1} ${s.player_name}</span>
                      <div style="font-size:0.75rem; color:#888;">${maskedId}</div>
                  </div>
                  <span style="color:var(--warning); font-weight:bold; font-size: 1.1rem;">${score.toLocaleString()} נק'</span>
              </div>
              <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#ccc;">
                  <span style="color:var(--success)">${accumulatedIcon}💰 ₪${money.toLocaleString()}</span>
                  <span>${accumulatedIcon}✅ ${correct} | ❌ ${wrong}</span>
              </div>
              <div style="font-size:0.75rem; color:#666; text-align:left;">${created}</div>
            </div>`;
        });
      }

      if(listContainer) listContainer.innerHTML = html;
    } catch (err) {
      console.error('Failed to fetch scores', err);
      if(listContainer) listContainer.innerHTML =
        '<p style="text-align:center; opacity:0.6;">שגיאה בטעינת השיאים</p>';
    }
  }

  function showPlayerDetails(index) {
    const player = lastHighScores[index];
    if (!player) return;
    const titleEl = document.getElementById('modal-title');
    const backBtn = document.getElementById('modal-back-btn');
    const content = document.getElementById('modal-body-content');
    if (!titleEl || !backBtn || !content) return;

    titleEl.textContent = `👤 פרופיל: ${player.player_name}`;
    backBtn.style.display = 'block';

    const score = player.score || 0;
    // Check if total_* fields exist (accumulated view), otherwise fallback
    const money = player.total_money !== undefined ? player.total_money : (player.money || 0);
    const correct = player.total_correct !== undefined ? player.total_correct : (player.correct_count || 0);
    const wrong = player.total_wrong !== undefined ? player.total_wrong : (player.wrong_count || 0);
    
    const playerAchievements = player.achievements || [];

    let achievementsHtml = '';
    ACHIEVEMENTS_LIST.forEach((ach) => {
      const isUnlocked = playerAchievements.includes(ach.id);
      const cls = isUnlocked ? 'unlocked' : '';
      const icon = isUnlocked ? ach.icon : '🔒';
      const opacity = isUnlocked ? '1' : '0.3';
      achievementsHtml += `
        <div class="achievement-item ${cls}" style="opacity:${opacity}">
          <div class="achievement-icon">${icon}</div>
          <div>
            <div style="font-weight:bold;">${ach.title}</div>
            <div style="font-size:0.8rem;">${ach.desc}</div>
          </div>
        </div>`;
    });

    content.innerHTML = `
      <div style="text-align:center; margin-bottom:20px; padding:15px; background:rgba(255,255,255,0.05); border-radius:10px;">
        <div style="font-size:2rem; color:var(--warning); font-weight:bold;">${score.toLocaleString()}</div>
        <div style="font-size:0.9rem; color:#aaa;">ניקוד שיא</div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:15px; border-top:1px solid rgba(255,255,255,0.1); padding-top:10px;">
           <div>
              <div style="color:var(--success); font-weight:bold;">₪${money.toLocaleString()}</div>
              <div style="font-size:0.8rem">כסף</div>
           </div>
           <div>
              <div style="font-weight:bold;">${correct} / ${wrong}</div>
              <div style="font-size:0.8rem">נכון / שגוי</div>
           </div>
        </div>
      </div>
      <h3>הישגים:</h3>
      ${achievementsHtml}
    `;
  }

  function backToLeaderboard() {
    openLeaderboard('daily');
  }

  function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
  }

  function openInstructions() {
    const modal = document.getElementById('instructions-modal');
    if (modal) modal.classList.add('active');
  }

  function gameOver(reason) {
    state.isPlaying = false;
    sound.playWin();

    const money = state.score;
    const bonus = state.totalCorrect * GAME_CONFIG.scorePerCorrectForRanking;
    const finalWeightedScore = money + bonus;

    const reasonEl = document.getElementById('gameover-reason');
    const nameEl = document.getElementById('final-name');
    const scoreEl = document.getElementById('final-score');
    const stageEl = document.getElementById('final-stage');
    const correctEl = document.getElementById('final-correct');

    if (reasonEl) reasonEl.textContent = reason;
    if (nameEl) nameEl.textContent = state.playerName;
    if (scoreEl) scoreEl.textContent = `₪${money.toLocaleString()}`;
    if (stageEl) stageEl.textContent = String(state.stage);
    if (correctEl) correctEl.textContent = String(state.totalCorrect);

    // Achievements checks at game over
    if (state.totalCorrect === (state.totalCorrect + state.totalWrong) && state.totalCorrect > 0 && !hasAchievement('perfect_stage')) {
       // Note: This logic for perfect_stage is simplified for demo; usually per stage check
    }

    // Checking last second finish
    if (state.timeLeft < 1 && state.timeLeft > 0 && !hasAchievement('last_second')) {
      unlockAchievement('last_second');
    }

    saveHighScore(finalWeightedScore, money, state.totalCorrect, state.totalWrong);
    switchScreen('gameover-screen');
  }

  async function saveHighScore(finalWeightedScore, money, correct, wrong) {
    try {
      const userId = window.currentUser && window.currentUser.id ? window.currentUser.id : null;
      let maskedId = null;
      
      if (window.currentUser && window.currentUser.email) {
          const email = window.currentUser.email;
          const atIndex = email.indexOf('@');
          if (atIndex > 0) {
              const username = email.substring(0, atIndex);
              if (username.length > 4) {
                  maskedId = username.substring(0, Math.ceil(username.length * 0.6)) + '***';
              } else {
                  maskedId = username.substring(0, 1) + '***';
              }
          }
      }

      await fetch('/api/high-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          playerName: state.playerName,
          maskedId: maskedId,
          score: finalWeightedScore,
          money: money,
          stage: state.stage,
          correct_count: correct,
          wrong_count: wrong,
          achievements: state.unlockedAchievements,
        }),
      });
    } catch (err) {
      console.error('Failed to save score', err);
    }
  }

  function switchScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add('active');
  }

  function returnToMenu() {
    switchScreen('menu-screen');
  }

  window.triviaRushInit = initGame;
  window.startDailyChallenge = startDailyChallenge;
  window.startCustomGame = startCustomGame;
  window.startGame = startCustomGame;
  window.openLeaderboard = openLeaderboard;
  window.openInstructions = openInstructions;
  window.closeModal = closeModal;
  window.buyItem = buyItem;
  window.openShop = openShop;
  window.closeShop = closeShop;
  window.useLifeline = useLifeline;
  window.returnToMenu = returnToMenu;
  window.backToLeaderboard = backToLeaderboard;
  window.addCustomTopic = addCustomTopic;
  window.toggleGoogleSearch = toggleGoogleSearch;
  window.showPlayerDetails = showPlayerDetails;
  window.removeCustomTopic = removeCustomTopic;

})();