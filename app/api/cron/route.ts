// trivia-rush\app\api\cron\route.ts

// trivia-rush\app\api\cron\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';
import { ALL_SUB_TOPICS } from './topics';

// --- Config for Long Running Tasks ---
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOTAL_TARGET_QUESTIONS = 50;
// CHANGED: Increased wait time to let API cool down between batches
const BATCH_WAIT_MINUTES = 10; 
const PRE_GENERATE_HOUR = 21;
// CHANGED: Reduced history window to 3 days to save Tokens and avoid 429
const HISTORY_WINDOW_DAYS = 3; 

// --- Utility Functions ---

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "")
    .replace(/\s{2,}/g, " ");
}

// CHANGED: Improved Retry Logic for 429 errors
async function fetchWithRetry(url: string, options: any, retries = 3, initialDelay = 5000) {
  let delay = initialDelay;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) return response;
      
      // If rate limited (429) or server error (5xx)
      if (response.status === 429 || response.status >= 500 || response.status === 503) {
        console.warn(`[Cron API] Attempt ${i + 1} failed (${response.status}). Cooling down for ${delay/1000}s...`);
        
        if (i === retries - 1) throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
        
        // Wait
        await new Promise(resolve => setTimeout(resolve, delay));
        // Exponential backoff: 5s -> 10s -> 20s
        delay *= 2; 
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
    
    if (!['easy', 'medium', 'hard'].includes(q.difficulty)) {
        q.difficulty = 'medium'; 
    }

    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 3) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return false;
    if (q.options.some((o: any) => !o || typeof o !== 'string' || o.trim() === '')) return false;
    return true;
  });
}

type HistoryData = {
    exactSet: Set<string>;
    byDifficulty: {
        easy: string[];
        medium: string[];
        hard: string[];
    };
};

async function get7DayHistory(targetDate: string): Promise<HistoryData> {
  if (!supabaseServer) return { exactSet: new Set(), byDifficulty: { easy: [], medium: [], hard: [] } };

  const historyStart = new Date();
  historyStart.setDate(historyStart.getDate() - HISTORY_WINDOW_DAYS);
  const historyStartStr = formatDate(historyStart);

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
             exactSet.add(normalizeText(q.question));
             
             const diff = q.difficulty || 'medium';
             if (byDifficulty[diff]) {
                 byDifficulty[diff].push(q.question);
             }
           }
        });
      }
    });
  }
  
  console.log(`[Cron] History loaded (Last ${HISTORY_WINDOW_DAYS} days). Exact entries: ${exactSet.size}.`);
  return { exactSet, byDifficulty };
}

// 6. פונקציית סינון סמנטי (AI Judge)
async function filterSemanticDuplicates(
    newQuestions: any[], 
    history: HistoryData['byDifficulty'], 
    apiKey: string
): Promise<number[]> {
    if (newQuestions.length === 0) return [];
    if (history.easy.length === 0 && history.medium.length === 0 && history.hard.length === 0) return [];

    console.log(`[Cron] Starting Semantic Check for ${newQuestions.length} candidates...`);

    const candidatesList = newQuestions.map((q, i) => `${i}. [${q.difficulty}] ${q.question}`).join('\n');
    
    // CHANGED: Reduced context size from 50 to 30 to save tokens and avoid 429
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
            }, 
            1 // Still 1 retry here is enough as it's optional
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

    // בדיקת זמן המתנה
    const now = new Date();
    const nextRun = new Date(challenge.next_batch_at);
    
    if (now < nextRun) {
      const waitMinutes = Math.ceil((nextRun.getTime() - now.getTime()) / 60000);
      // Only strictly enforce wait if we are not in "Emergency Fix" mode (batch 0)
      if (challenge.current_batch > 0) {
          console.log(`[Cron] Waiting for cool-down. ${waitMinutes} mins left.`);
          return NextResponse.json({ message: `Waiting for next batch slot. ${waitMinutes} mins left.` });
      }
    }

    const nextBatchNum = (challenge.current_batch || 0) + 1;
    if (nextBatchNum > 2) {
       await supabaseServer.from('daily_challenges').update({ status: 'complete' }).eq('challenge_date', targetDate);
       return NextResponse.json({ message: 'Marked as complete (Safety)' });
    }

    // --- טעינת היסטוריה (Exact + Semantic) ---
    const historyData = await get7DayHistory(targetDate);
    const { exactSet, byDifficulty } = historyData;
    
    // הוספת השאלות שכבר קיימות באתגר הנוכחי (למניעת כפילות באותו יום)
    const currentQuestions = challenge.questions || [];
    currentQuestions.forEach((q: any) => {
        if (q && q.question) {
            exactSet.add(normalizeText(q.question));
        }
    });


    // --- הגדרת יעדים (Targets) ---
    const BUFFER_FACTOR = 1.4; 
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
                },
                3, // Retries
                5000 // Initial Delay 5s
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
    candidates = candidates.filter(q => {
        const normQ = normalizeText(q.question);
        if (exactSet.has(normQ)) {
             return false;
        }
        return true;
    });

    // --- שלב סינון 3: Semantic Check (חכם - Gemini) ---
    const rejectedIndices = await filterSemanticDuplicates(candidates, byDifficulty, apiKey);
    const rejectedSet = new Set(rejectedIndices);

    // --- מילוי הדליים (Bucket Fill) ---
    const finalBatch: any[] = [];
    let countEasy = 0;
    let countMedium = 0;
    let countHard = 0;

    for (let i = 0; i < candidates.length; i++) {
        const q = candidates[i];
        
        if (rejectedSet.has(i)) {
             continue;
        }

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
        
        if (added) {
             const normQ = normalizeText(q.question);
             exactSet.add(normQ); 
        }
    }

    // --- בדיקת חוסרים (Refill) ---
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
             const refillRes = await fetchWithRetry(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: refillPrompt }] }],
                        generationConfig: { responseMimeType: "application/json" }
                    }),
                }, 
                2, // Less retries for refill
                5000
            );
            const refillData = await refillRes.json();
            const refillRaw = JSON.parse(refillData.candidates[0].content.parts[0].text);
            const refillValid = validateAndFixQuestions(refillRaw);

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
    const nextRunTime = new Date(now.getTime() + BATCH_WAIT_MINUTES * 60000);

    const updatePayload: any = {
      questions: updatedQuestions,
      current_batch: nextBatchNum,
      // Always set delay for next run to prevent 429
      next_batch_at: nextRunTime.toISOString(), 
      last_log: `Batch ${nextBatchNum}: Added ${finalBatch.length} unique questions.`
    };

    if (nextBatchNum === 2 || updatedQuestions.length >= TOTAL_TARGET_QUESTIONS) {
      updatePayload.status = 'complete';
      updatePayload.last_log = `READY! Total: ${updatedQuestions.length}`;
      // No next batch needed if complete, but good to set a future date just in case
      updatePayload.next_batch_at = new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(); 
    }

    await supabaseServer
      .from('daily_challenges')
      .update(updatePayload)
      .eq('challenge_date', targetDate);

    return NextResponse.json({
      success: true,
      batch: nextBatchNum,
      added: finalBatch.length,
      stats: { easy: countEasy, medium: countMedium, hard: countHard }
    });

  } catch (error: any) {
    console.error('Cron Job Failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}