// trivia-rush\app\api\cron\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';
import { ALL_SUB_TOPICS } from './topics';

// --- Config for Long Running Tasks ---
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOTAL_TARGET_QUESTIONS = 50;
const BATCH_WAIT_MINUTES = 15; 
const PRE_GENERATE_HOUR = 21;
const HISTORY_WINDOW_DAYS = 3; 

// --- API Key Rotation Config --
// Collect available keys (Limit to 3)
const API_KEYS = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3
].filter(key => key && key.trim().length > 0) as string[];

// Models to try in order
const MODELS_TO_TRY = ["gemini-2.5-flash", "gemini-2.5-flash-preview-09-2025"];

// --- Utility Functions ---

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, "")
    .replace(/\s{2,}/g, " ");
}

// Low-level fetch that handles 5xx retries but throws immediately on 429 (Quota)
async function fetchWithBackoff(url: string, options: any, retries = 2, initialDelay = 1000) {
    let delay = initialDelay;
    
    for (let i = 0; i <= retries; i++) {
        try {
            const response = await fetch(url, options);
            
            // If success, return immediately
            if (response.ok) return response;

            // If Rate Limit (429), throw immediately to trigger key rotation
            if (response.status === 429) {
                throw new Error('QUOTA_EXHAUSTED');
            }

            // If Server Error (5xx), wait and retry
            if (response.status >= 500) {
                if (i === retries) throw new Error(`Server Error: ${response.status}`);
                console.warn(`[Cron API] 5xx Error (Attempt ${i + 1}). Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                continue;
            }

            // Client Error (4xx) - throw immediately
            throw new Error(`API Error: ${response.status} ${response.statusText}`);

        } catch (error: any) {
            // Re-throw Quota errors immediately
            if (error.message === 'QUOTA_EXHAUSTED') throw error;
            
            // If it's the last retry or a fatal network error, throw
            if (i === retries) throw error;
            
            // Network error retry
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
    throw new Error('Max retries reached');
}

// High-level generator that handles Key Rotation AND Model Fallback
async function generateWithRotation(prompt: string, jsonMode = true): Promise<any> {
    if (API_KEYS.length === 0) throw new Error('No API Keys configured!');

    let lastError = null;

    // Loop through Keys
    for (let k = 0; k < API_KEYS.length; k++) {
        const apiKey = API_KEYS[k];
        
        // Loop through Models
        for (const model of MODELS_TO_TRY) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
                
                const response = await fetchWithBackoff(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: jsonMode ? { responseMimeType: "application/json" } : undefined
                    })
                });

                const data = await response.json();
                if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
                    throw new Error(`Invalid response format from ${model}`);
                }
                
                // Success! Return the text content
                return data.candidates[0].content.parts[0].text;

            } catch (e: any) {
                lastError = e;
                
                // If Quota Exhausted, Log and Break the Model Loop -> Switches to Next Key
                if (e.message === 'QUOTA_EXHAUSTED') {
                    console.warn(`[Cron] Key ${k + 1}/${API_KEYS.length} exhausted (429). Switching to next key...`);
                    break; // Break inner loop (models), continue outer loop (keys)
                }

                // If not quota (e.g. Model overloaded or invalid response), log and try next model
                console.warn(`[Cron] Model ${model} failed with key ${k + 1}: ${e.message}`);
            }
        }
    }

    throw new Error(`All keys and models failed. Last error: ${lastError?.message}`);
}


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

// 5. מנגנון שליפת היסטוריה מורחב
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
  
  console.log(`[Cron] History loaded (${HISTORY_WINDOW_DAYS} days). Exact entries: ${exactSet.size}.`);
  return { exactSet, byDifficulty };
}

// 6. פונקציית סינון סמנטי (AI Judge) - מעודכנת להשתמש ברוטציה
async function filterSemanticDuplicates(
    newQuestions: any[], 
    history: HistoryData['byDifficulty']
): Promise<number[]> {
    if (newQuestions.length === 0) return [];
    if (history.easy.length === 0 && history.medium.length === 0 && history.hard.length === 0) return [];

    console.log(`[Cron] Starting Semantic Check for ${newQuestions.length} candidates...`);

    const candidatesList = newQuestions.map((q, i) => `${i}. [${q.difficulty}] ${q.question}`).join('\n');
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
        // Use the new Rotation Logic here
        const text = await generateWithRotation(prompt, true);
        const rejectedIndices = JSON.parse(text);
        
        if (Array.isArray(rejectedIndices)) {
            console.log(`[Cron] Semantic Filter rejected ${rejectedIndices.length} questions.`);
            return rejectedIndices;
        }
    } catch (e) {
        console.warn('[Cron] Semantic check failed. Proceeding without filter to ensure continuity.', e);
    }
    
    return [];
}


export async function GET(req: Request) {
  if (!supabaseServer) {
    return NextResponse.json({ error: 'Supabase config missing' }, { status: 500 });
  }

  // Basic check to ensure at least one key exists
  if (API_KEYS.length === 0) {
      return NextResponse.json({ error: 'Server API Keys missing' }, { status: 500 });
  }

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

    let { data: challenge } = await supabaseServer
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', targetDate)
      .single();

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

    // --- בדיקת זמן המתנה ---
    const now = new Date();
    const nextRun = new Date(challenge.next_batch_at);
    
    if (now < nextRun) {
      const waitMinutes = Math.ceil((nextRun.getTime() - now.getTime()) / 60000);
      return NextResponse.json({ message: `Waiting for cooldown. ${waitMinutes} mins left until next batch.` });
    }

    const nextBatchNum = (challenge.current_batch || 0) + 1;
    if (nextBatchNum > 2) {
       await supabaseServer.from('daily_challenges').update({ status: 'complete' }).eq('challenge_date', targetDate);
       return NextResponse.json({ message: 'Marked as complete (Safety)' });
    }

    // --- טעינת היסטוריה ---
    const historyData = await getHistory(targetDate);
    const { exactSet, byDifficulty } = historyData;
    
    const currentQuestions = challenge.questions || [];
    currentQuestions.forEach((q: any) => {
        if (q && q.question) {
            exactSet.add(normalizeText(q.question));
        }
    });

    // --- הגדרת יעדים ---
    const BUFFER_FACTOR = 1.4; 
    const QUESTIONS_PER_BATCH = 25;
    
    let targetEasy = 0;
    let targetMedium = 0;
    let targetHard = 0;
    let promptInstructions = '';

    if (nextBatchNum === 1) {
        targetEasy = 15;
        targetMedium = 10;
        targetHard = 0;
        promptInstructions = `
        עליך לייצר כ-35 שאלות (כולל ספייר לסינון):
        - כ-20 שאלות ברמת "easy".
        - כ-15 שאלות ברמת "medium".
        `;
    } else {
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

    console.log(`[Cron] Batch ${nextBatchNum} for ${targetDate}. Keys available: ${API_KEYS.length}`);

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

    // --- ביצוע הבקשה ל-Gemini (עם רוטציה) ---
    let generatedQuestionsRaw: any[] = [];
    
    try {
        const text = await generateWithRotation(prompt, true);
        generatedQuestionsRaw = JSON.parse(text);
    } catch (e) {
        console.error('[Cron] Generation failed:', e);
        throw new Error('All Gemini keys/models failed to generate valid JSON');
    }

    if (!Array.isArray(generatedQuestionsRaw) || generatedQuestionsRaw.length === 0) {
        throw new Error('Gemini output invalid format');
    }

    // --- שלב סינון 1: ולידציה טכנית ---
    let candidates = validateAndFixQuestions(generatedQuestionsRaw);
    
    // --- שלב סינון 2: Exact Match ---
    candidates = candidates.filter(q => {
        const normQ = normalizeText(q.question);
        if (exactSet.has(normQ)) {
             console.log(`[Cron] Exact duplicate rejected: "${q.question}"`);
             return false;
        }
        return true;
    });

    // --- שלב סינון 3: Semantic Check (עם רוטציה) ---
    await new Promise(resolve => setTimeout(resolve, 1000));
    const rejectedIndices = await filterSemanticDuplicates(candidates, byDifficulty);
    const rejectedSet = new Set(rejectedIndices);

    // --- מילוי הדליים ---
    const finalBatch: any[] = [];
    let countEasy = 0;
    let countMedium = 0;
    let countHard = 0;

    for (let i = 0; i < candidates.length; i++) {
        const q = candidates[i];
        
        if (rejectedSet.has(i)) {
             console.log(`[Cron] Semantic duplicate rejected: "${q.question}"`);
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
        console.log(`[Cron] Missing ${totalMissing}. Triggering REFILL.`);
        
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
             await new Promise(resolve => setTimeout(resolve, 1000));
             const text = await generateWithRotation(refillPrompt, true);
             const refillRaw = JSON.parse(text);
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
      next_batch_at: nextBatchNum < 2 ? nextRunTime.toISOString() : now.toISOString(),
      last_log: `Batch ${nextBatchNum}: Added ${finalBatch.length} unique questions. Keys used: ${API_KEYS.length}`
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