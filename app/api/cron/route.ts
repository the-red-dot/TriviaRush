import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';
import { ALL_SUB_TOPICS } from './topics';

// --- Config for Long Running Tasks ---
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOTAL_TARGET_QUESTIONS = 50;
// UPDATE: Increased to 15 minutes. 
// Since cron runs every 10 mins, this forces a skip of one cycle to let API cool down.
const BATCH_WAIT_MINUTES = 15; 
const PRE_GENERATE_HOUR = 21;
// UPDATE: Reduced history to 3 days to save Token Quota (TPM)
const HISTORY_WINDOW_DAYS = 3; 

// --- Utility Functions ---

// 1. נרמול טקסט להשוואה חכמה (Exact Match)
function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "") // הסרת פיסוק
    .replace(/\s{2,}/g, " "); // הסרת רווחים כפולים
}

// 2. פונקציית Retry לבקשות רשת (מעודכנת ל-Backoff איטי יותר)
async function fetchWithRetry(url: string, options: any, retries = 3, initialDelay = 2000) {
  let delay = initialDelay;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) return response;
      
      // אם יש שגיאת עומס (429) או שרת (5xx), נחכה יותר זמן
      if (response.status === 503 || response.status === 429 || response.status >= 500) {
        console.warn(`[Cron API] Attempt ${i + 1} failed (${response.status}). Cooling down for ${delay}ms...`);
        if (i === retries - 1) throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff: 2s -> 4s -> 8s
        continue;
      }
      
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
      
    } catch (error) {
      console.error(`[Cron API] Attempt ${i + 1} Error:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error('Max retries reached for Gemini API');
}

// 3. עזרים לזמן
function getIsraelTime() {
  const now = new Date();
  try {
      const israelTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
      return new Date(israelTimeStr);
  } catch (e) {
      return new Date(now.getTime() + (3 * 60 * 60 * 1000));
  }
}

function formatDate(date: Date) {
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - (offset*60*1000));
  return localDate.toISOString().split('T')[0];
}

function shuffleArray(array: string[]) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 4. ולידציה בסיסית לשאלות
function validateAndFixQuestions(questions: any[]): any[] {
  if (!Array.isArray(questions)) return [];
  return questions.filter(q => {
    if (!q || typeof q !== 'object') return false;
    if (typeof q.question !== 'string' || q.question.length < 3) return false;
    if (!q.category) q.category = 'כללי';
    
    // וידוא שדה difficulty
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
        q.difficulty = 'medium'; 
    }

    // אפשרויות: מינימום 2 (נכון/לא נכון), מקסימום 3
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 3) return false;
    // אינדקס תקין
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return false;
    // תוכן אפשרויות
    if (q.options.some((o: any) => !o || typeof o !== 'string' || o.trim() === '')) return false;
    return true;
  });
}

// 5. מנגנון שליפת היסטוריה מורחב (עבור סמנטיקה + exact match)
type HistoryData = {
    exactSet: Set<string>;
    byDifficulty: {
        easy: string[];
        medium: string[];
        hard: string[];
    };
};

async function getHistory(targetDate: string): Promise<HistoryData> {
  if (!supabaseServer) return { exactSet: new Set(), byDifficulty: { easy: [], medium: [], hard: [] } };

  // חישוב תאריך התחלה לחלון ההיסטוריה (קוצר ל-3 ימים)
  const historyStart = new Date();
  historyStart.setDate(historyStart.getDate() - HISTORY_WINDOW_DAYS);
  const historyStartStr = formatDate(historyStart);

  // שליפת האתגרים בטווח הזמן
  const { data: challenges } = await supabaseServer
    .from('daily_challenges')
    .select('questions')
    .gte('challenge_date', historyStartStr)
    .neq('challenge_date', targetDate);

  const exactSet = new Set<string>();
  const byDifficulty: any = { easy: [], medium: [], hard: [] };

  if (challenges) {
    challenges.forEach((row: any) => {
      if (Array.isArray(row.questions)) {
        row.questions.forEach((q: any) => {
           if (q && q.question) {
             // 1. שמירה ל-Exact Match
             exactSet.add(normalizeText(q.question));
             
             // 2. שמירה להשוואה סמנטית (לפי רמת קושי)
             const diff = q.difficulty || 'medium';
             if (byDifficulty[diff]) {
                 byDifficulty[diff].push(q.question);
             }
           }
        });
      }
    });
  }
  
  console.log(`[Cron] History loaded (${HISTORY_WINDOW_DAYS} days). Exact entries: ${exactSet.size}.`);
  return { exactSet, byDifficulty };
}

// 6. פונקציית סינון סמנטי (AI Judge)
async function filterSemanticDuplicates(
    newQuestions: any[], 
    history: HistoryData['byDifficulty'], 
    apiKey: string
): Promise<number[]> {
    // אם אין מספיק היסטוריה או שאלות חדשות, דלג
    if (newQuestions.length === 0) return [];
    
    // אופטימיזציה: אם ההיסטוריה ריקה לגמרי, אין מה לבדוק
    if (history.easy.length === 0 && history.medium.length === 0 && history.hard.length === 0) return [];

    console.log(`[Cron] Starting Semantic Check for ${newQuestions.length} candidates...`);

    // בניית פרומפט ממוקד לזיהוי כפילויות משמעות
    const candidatesList = newQuestions.map((q, i) => `${i}. [${q.difficulty}] ${q.question}`).join('\n');
    
    // UPDATE: לוקחים דגימה קטנה יותר מההיסטוריה (30 במקום 50) כדי לחסוך טוקנים
    const contextEasy = history.easy.slice(-30).join(' | ');
    const contextMedium = history.medium.slice(-30).join(' | ');
    const contextHard = history.hard.slice(-30).join(' | ');

    const prompt = `
    Task: Identify semantic duplicates in a trivia database.
    
    Below is a list of NEW CANDIDATE questions (numbered).
    Below that is a list of EXISTING HISTORY questions grouped by difficulty.
    
    You must identify any NEW question that is semantically identical or extremely similar to an EXISTING question.
    
    Rules for duplicate detection:
    1. Same fact, different wording (e.g. "Capital of France?" vs "Paris is the capital of?").
    2. Minor variations (e.g. "Who wrote Harry Potter?" vs "Author of Harry Potter books").
    3. Compare strictly within difficulty levels (Easy vs Easy context, etc), but if a question is identical to ANY history question, flag it.
    
    --- NEW CANDIDATES ---
    ${candidatesList}
    
    --- EXISTING HISTORY (Context) ---
    [EASY]: ${contextEasy}
    [MEDIUM]: ${contextMedium}
    [HARD]: ${contextHard}
    
    OUTPUT: A JSON array of numbers only. These are the indices of the NEW candidates that should be REJECTED.
    If no duplicates found, return [].
    Example: [0, 4, 12]
    `;

    try {
        const response = await fetchWithRetry(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                }),
            }, 1 // ניסיון אחד מספיק לסינון, אם נכשל - נוותר כדי לא לתקוע את התהליך
        );

        const data = await response.json();
        const text = data.candidates[0].content.parts[0].text;
        const rejectedIndices = JSON.parse(text);
        
        if (Array.isArray(rejectedIndices)) {
            console.log(`[Cron] Semantic Filter rejected ${rejectedIndices.length} questions.`);
            return rejectedIndices;
        }
    } catch (e) {
        console.warn('[Cron] Semantic check failed or timed out. Proceeding without semantic filter.', e);
    }
    
    return [];
}


export async function GET(req: Request) {
  if (!supabaseServer) {
    return NextResponse.json({ error: 'Supabase config missing' }, { status: 500 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Server API Key missing' }, { status: 500 });

  try {
    const nowIL = getIsraelTime();
    const todayStr = formatDate(nowIL);
    
    const tomorrow = new Date(nowIL);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    let targetDate = todayStr;

    // שלב 1: בדיקת היום
    let { data: todayChallenge } = await supabaseServer
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', todayStr)
      .single();

    if (!todayChallenge || todayChallenge.status !== 'complete') {
      targetDate = todayStr;
      console.log(`[Cron] Priority: Finishing TODAY (${todayStr})`);
    } else {
      const currentHour = nowIL.getHours();
      if (currentHour >= PRE_GENERATE_HOUR) {
        targetDate = tomorrowStr;
        console.log(`[Cron] Late hour (${currentHour}:00). Switching target to TOMORROW (${tomorrowStr})`);
      } else {
        return NextResponse.json({
          message: 'Today is complete. Too early to generate tomorrow.',
          hour: currentHour,
          threshold: PRE_GENERATE_HOUR
        });
      }
    }

    // --- מכאן והלאה: עובדים על targetDate שנבחר ---

    let { data: challenge } = await supabaseServer
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', targetDate)
      .single();

    // אתחול רשומה אם לא קיימת
    if (!challenge) {
      console.log(`[Cron] Initializing record for ${targetDate}`);
      const { data: newRecord, error: insertError } = await supabaseServer
        .from('daily_challenges')
        .insert({
          challenge_date: targetDate,
          questions: [],
          status: 'processing',
          current_batch: 0,
          next_batch_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (insertError) throw insertError;
      challenge = newRecord;
    }

    if (challenge.status === 'complete') {
      return NextResponse.json({ message: `Challenge for ${targetDate} is already complete.` });
    }

    // --- בדיקת זמן המתנה (Cooldown Check) ---
    const now = new Date();
    const nextRun = new Date(challenge.next_batch_at);
    
    // בדיקה קריטית: אם לא עבר הזמן - יוצאים מיד כדי לתת ל-API לנוח
    if (now < nextRun) {
      const waitMinutes = Math.ceil((nextRun.getTime() - now.getTime()) / 60000);
      return NextResponse.json({ message: `Waiting for cooldown. ${waitMinutes} mins left until next batch.` });
    }

    const nextBatchNum = (challenge.current_batch || 0) + 1;
    if (nextBatchNum > 2) {
       await supabaseServer.from('daily_challenges').update({ status: 'complete' }).eq('challenge_date', targetDate);
       return NextResponse.json({ message: 'Marked as complete (Safety)' });
    }

    // --- טעינת היסטוריה (Exact + Semantic) ---
    const historyData = await getHistory(targetDate);
    const { exactSet, byDifficulty } = historyData;
    
    // הוספת השאלות שכבר קיימות באתגר הנוכחי (למניעת כפילות באותו יום)
    const currentQuestions = challenge.questions || [];
    currentQuestions.forEach((q: any) => {
        if (q && q.question) {
            exactSet.add(normalizeText(q.question));
        }
    });


    // --- הגדרת יעדים (Targets) ---
    // אנו מבקשים "Buffer" (תוספת) כדי שיהיה לנו מרחב סינון
    const BUFFER_FACTOR = 1.4; // נבקש 40% יותר שאלות
    const QUESTIONS_PER_BATCH = 25;
    
    let targetEasy = 0;
    let targetMedium = 0;
    let targetHard = 0;

    let promptInstructions = '';

    if (nextBatchNum === 1) {
        // נגלה 1: יעד 15 Easy, 10 Medium
        targetEasy = 15;
        targetMedium = 10;
        targetHard = 0;
        
        promptInstructions = `
        עליך לייצר כ-35 שאלות (כולל ספייר לסינון):
        - כ-20 שאלות ברמת "easy".
        - כ-15 שאלות ברמת "medium".
        `;
    } else {
        // נגלה 2: יעד 10 Medium, 15 Hard
        targetEasy = 0;
        targetMedium = 10;
        targetHard = 15;

        promptInstructions = `
        עליך לייצר כ-35 שאלות (כולל ספייר לסינון):
        - כ-15 שאלות ברמת "medium".
        - כ-20 שאלות ברמת "hard".
        `;
    }

    const shuffledTopics = shuffleArray(ALL_SUB_TOPICS);
    const selectedTopics = shuffledTopics.slice(0, Math.floor(QUESTIONS_PER_BATCH * BUFFER_FACTOR));

    console.log(`[Cron] Batch ${nextBatchNum} for ${targetDate}. Requesting with Buffer.`);

    const prompt = `
      משימה: צור מאגר שאלות טריוויה בעברית למשחק מהיר.
      עליך להשתמש בנושאים הבאים (ועוד): ${selectedTopics.join(', ')}

      ${promptInstructions}

      הנחיות טכניות למניעת כפילויות:
      - השתמש בניסוחים מקוריים ומגוונים.
      - הימנע משאלות בנאליות מדי ("מה בירת צרפת?").

      הנחיות מבנה (חובה):
      1. השאלה: עד 15 מילים.
      2. התשובות: 1-4 מילים.
      3. אפשרויות: 3 (רגיל) או 2 (נכון/לא נכון).
      4. שדה "difficulty" חובה: "easy", "medium", או "hard".
      
      פלט JSON בלבד:
      [
        { "question": "...", "options": ["..."], "correctIndex": 0, "category": "...", "difficulty": "easy" }
      ]
    `;

    // --- ביצוע הבקשה ל-Gemini ---
    let generatedQuestionsRaw: any[] = [];
    
    const modelsToTry = ["gemini-2.5-flash", "gemini-2.5-flash-preview-09-2025"];
    
    for (const model of modelsToTry) {
        try {
            const geminiResponse = await fetchWithRetry(
                `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    }),
                }
            );
            const data = await geminiResponse.json();
            const text = data.candidates[0].content.parts[0].text;
            generatedQuestionsRaw = JSON.parse(text);
            if (generatedQuestionsRaw.length > 0) break;
        } catch (e) {
            console.warn(`[Cron] Model ${model} failed:`, e);
        }
    }

    if (generatedQuestionsRaw.length === 0) {
        throw new Error('All Gemini models failed to generate valid JSON');
    }

    // --- שלב סינון 1: ולידציה טכנית ---
    let candidates = validateAndFixQuestions(generatedQuestionsRaw);
    
    // --- שלב סינון 2: Exact Match (מהיר) ---
    // מסננים מראש את מה שבוודאות כפול כדי לחסוך טוקנים ל-AI
    candidates = candidates.filter(q => {
        const normQ = normalizeText(q.question);
        if (exactSet.has(normQ)) {
             console.log(`[Cron] Exact duplicate rejected: "${q.question}"`);
             return false;
        }
        return true;
    });

    // --- שלב סינון 3: Semantic Check (חכם - Gemini) ---
    // השהייה קטנה לפני הבקשה הכבדה הבאה (כדי לתת למכסה להתאושש מעט)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const rejectedIndices = await filterSemanticDuplicates(candidates, byDifficulty, apiKey);
    
    // יצירת סט של אינדקסים לפסילה לגישה מהירה
    const rejectedSet = new Set(rejectedIndices);

    // --- מילוי הדליים (Bucket Fill) ---
    const finalBatch: any[] = [];
    let countEasy = 0;
    let countMedium = 0;
    let countHard = 0;

    for (let i = 0; i < candidates.length; i++) {
        const q = candidates[i];
        
        // בדיקה האם המודל פסל את השאלה הזו סמנטית
        if (rejectedSet.has(i)) {
             console.log(`[Cron] Semantic duplicate rejected: "${q.question}"`);
             continue;
        }

        // בדיקת מקום בדליים
        let added = false;
        if (q.difficulty === 'easy' && countEasy < targetEasy) {
            finalBatch.push(q);
            countEasy++;
            added = true;
        } else if (q.difficulty === 'medium' && countMedium < targetMedium) {
            finalBatch.push(q);
            countMedium++;
            added = true;
        } else if (q.difficulty === 'hard' && countHard < targetHard) {
            finalBatch.push(q);
            countHard++;
            added = true;
        }
        
        // עדכון סט לוקלי (למניעת כפילות פנימית בתוך הנגלה הנוכחית)
        if (added) {
             const normQ = normalizeText(q.question);
             exactSet.add(normQ); 
        }
    }

    // --- בדיקת חוסרים (Refill) ---
    // הערה: משאירים את הלוגיקה, אך אם היא תיכשל בגלל 429, ה-Cron ימשיך עם מה שיש.
    const missingEasy = targetEasy - countEasy;
    const missingMedium = targetMedium - countMedium;
    const missingHard = targetHard - countHard;
    const totalMissing = missingEasy + missingMedium + missingHard;

    if (totalMissing > 0) {
        console.log(`[Cron] Missing ${totalMissing} questions (E:${missingEasy}, M:${missingMedium}, H:${missingHard}). Triggering REFILL.`);
        
        const refillPrompt = `
           אני צריך השלמה של ${totalMissing} שאלות טריוויה נוספות בדיוק.
           הקפד לא לחזור על שאלות קודמות.
           
           הכמות החסרה לפי קושי:
           - Easy: ${missingEasy}
           - Medium: ${missingMedium}
           - Hard: ${missingHard}
           
           החזר JSON בלבד.
        `;

        try {
             // השהייה נוספת קטנה
             await new Promise(resolve => setTimeout(resolve, 2000));
             
             const refillRes = await fetchWithRetry(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: refillPrompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    }),
                }, 1
            );
            const refillData = await refillRes.json();
            const refillRaw = JSON.parse(refillData.candidates[0].content.parts[0].text);
            const refillValid = validateAndFixQuestions(refillRaw);

            // הוספת ההשלמות (כאן מוותרים על בדיקה סמנטית כבדה כדי לא לחרוג מזמן, מסתפקים ב-Exact)
            for (const q of refillValid) {
                const normQ = normalizeText(q.question);
                if (exactSet.has(normQ)) continue;

                if (q.difficulty === 'easy' && countEasy < targetEasy) { finalBatch.push(q); countEasy++; }
                else if (q.difficulty === 'medium' && countMedium < targetMedium) { finalBatch.push(q); countMedium++; }
                else if (q.difficulty === 'hard' && countHard < targetHard) { finalBatch.push(q); countHard++; }
            }

        } catch (e) {
            console.warn('[Cron] Refill failed. Proceeding with what we have.', e);
        }
    }

    // --- שמירה ב-DB ---
    const updatedQuestions = [...currentQuestions, ...finalBatch];
    
    // קביעת זמן הריצה הבא: עכשיו + 15 דקות.
    // מכיוון שהקרון רץ כל 10 דקות, זה יגרום לו "לדלג" על הפעם הבאה, וייתן ל-API כ-20 דקות מנוחה.
    const nextRunTime = new Date(now.getTime() + BATCH_WAIT_MINUTES * 60000);

    const updatePayload: any = {
      questions: updatedQuestions,
      current_batch: nextBatchNum,
      // אכיפה של ההמתנה גם אם הנגלה הנוכחית קצרה
      next_batch_at: nextBatchNum < 2 ? nextRunTime.toISOString() : now.toISOString(),
      last_log: `Batch ${nextBatchNum}: Added ${finalBatch.length} unique questions.`
    };

    if (nextBatchNum === 2 || updatedQuestions.length >= TOTAL_TARGET_QUESTIONS) {
      updatePayload.status = 'complete';
      updatePayload.last_log = `READY! Total: ${updatedQuestions.length}`;
    }

    await supabaseServer
      .from('daily_challenges')
      .update(updatePayload)
      .eq('challenge_date', targetDate);

    return NextResponse.json({
      success: true,
      batch: nextBatchNum,
      added: finalBatch.length,
      nextRun: nextRunTime.toISOString(),
      stats: { easy: countEasy, medium: countMedium, hard: countHard }
    });

  } catch (error: any) {
    console.error('Cron Job Failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}