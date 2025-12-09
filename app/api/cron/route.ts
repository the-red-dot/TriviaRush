// trivia-rush\app\api\cron\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';
import { ALL_SUB_TOPICS } from './topics';

// --- Config for Long Running Tasks ---
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const TOTAL_TARGET_QUESTIONS = 50;
const BATCH_WAIT_MINUTES = 5;
const PRE_GENERATE_HOUR = 21;

// פונקציית עזר לביצוע בקשות עם ניסיון חוזר (Retry)
async function fetchWithRetry(url: string, options: any, retries = 3, initialDelay = 1000) {
  let delay = initialDelay;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) return response;
      
      // טיפול בשגיאות שרת ועומס
      if (response.status === 503 || response.status === 429 || response.status >= 500) {
        console.warn(`[Cron API] Attempt ${i + 1} failed (${response.status}). Retrying...`);
        if (i === retries - 1) throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
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

// פונקציית עזר לקבלת אובייקט זמן ישראל
function getIsraelTime() {
  const now = new Date();
  try {
      const israelTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
      return new Date(israelTimeStr);
  } catch (e) {
      return new Date(now.getTime() + (3 * 60 * 60 * 1000));
  }
}

// המרת תאריך לסטרינג YYYY-MM-DD
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

// עדכון ולידציה לאפשר 2 או 3 אפשרויות
function validateAndFixQuestions(questions: any[]): any[] {
  if (!Array.isArray(questions)) return [];
  return questions.filter(q => {
    if (!q || typeof q !== 'object') return false;
    if (typeof q.question !== 'string' || q.question.length < 3) return false;
    if (!q.category) q.category = 'כללי';
    // אפשרויות: מינימום 2 (נכון/לא נכון), מקסימום 3
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 3) return false;
    // אינדקס תקין
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex >= q.options.length) return false;
    // תוכן אפשרויות
    if (q.options.some((o: any) => !o || typeof o !== 'string' || o.trim() === '')) return false;
    return true;
  });
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
    
    // חישוב התאריך של מחר
    const tomorrow = new Date(nowIL);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = formatDate(tomorrow);

    let targetDate = todayStr;
    let isPreGeneration = false;

    // שלב 1: בדיקת היום
    let { data: todayChallenge } = await supabaseServer
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', todayStr)
      .single();

    // אם היום חסר או לא גמור - הוא בעדיפות עליונה
    if (!todayChallenge || todayChallenge.status !== 'complete') {
      targetDate = todayStr;
      console.log(`[Cron] Priority: Finishing TODAY (${todayStr})`);
    } else {
      // היום גמור. האם הגיע הזמן להכין את מחר?
      const currentHour = nowIL.getHours();
      
      if (currentHour >= PRE_GENERATE_HOUR) {
        targetDate = tomorrowStr;
        isPreGeneration = true;
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
          next_batch_at: new Date().toISOString() // מוכן מיד
        })
        .select()
        .single();
      
      if (insertError) throw insertError;
      challenge = newRecord;
    }

    if (challenge.status === 'complete') {
      return NextResponse.json({ message: `Challenge for ${targetDate} is already complete.` });
    }

    // בדיקת זמן המתנה (בין נגלות)
    const now = new Date();
    const nextRun = new Date(challenge.next_batch_at);
    
    if (now < nextRun) {
      const waitMinutes = Math.ceil((nextRun.getTime() - now.getTime()) / 60000);
      
      // Override if legacy wait time
      if (waitMinutes <= BATCH_WAIT_MINUTES) {
          return NextResponse.json({ message: `Waiting for next batch slot for ${targetDate}. ${waitMinutes} mins left.` });
      }
      console.log(`[Cron] Legacy wait time detected (${waitMinutes}m). Overriding.`);
    }

    const nextBatchNum = (challenge.current_batch || 0) + 1;
    
    // בטיחות: רק 2 נגלות
    if (nextBatchNum > 2) {
       await supabaseServer.from('daily_challenges').update({ status: 'complete' }).eq('challenge_date', targetDate);
       return NextResponse.json({ message: 'Marked as complete (Safety - max batches reached)' });
    }

    // --- הפעלת ג'מיני ---
    const questionsToGenerate = 25; // תמיד 25

    const shuffledTopics = shuffleArray(ALL_SUB_TOPICS);
    const selectedTopics = shuffledTopics.slice(0, questionsToGenerate);

    console.log(`[Cron] Generating Batch ${nextBatchNum} for ${targetDate}. Topics: ${selectedTopics.length}`);

    let difficultyInstruction = '';
    
    // הנחיות מעודכנות
    if (nextBatchNum === 1) {
        difficultyInstruction = `
        1. רמת קושי: קלה-בינונית (שאלות טריוויה מהירות).
        2. שלב שאלות "נכון או לא נכון" (True/False) - חובה לספק 2 אפשרויות בלבד במקרה זה.
        3. השאלות חייבות להיות קצרות (עד 15 מילים).
        4. התשובות חייבות להיות קצרות (1-4 מילים).`;
    } else {
        difficultyInstruction = `
        1. רמת קושי: בינונית-קשה.
        2. תן עדיפות לעובדות מפתיעות.
        3. השאלות חייבות להיות קצרות (עד 15 מילים).
        4. התשובות חייבות להיות קצרות (1-4 מילים).`;
    }

    const prompt = `
      משימה: צור בדיוק ${selectedTopics.length} שאלות טריוויה בעברית למשחק מהיר (Speed Trivia).
      יש ליצור שאלה אחת עבור כל אחד מהנושאים הבאים:
      ${selectedTopics.join(', ')}

      הנחיות קריטיות (חובה):
      1. השאלה: קצרה מאוד! מקסימום שורה וחצי. בלי הקדמות.
      2. התשובות: קצרות מאוד! 1 עד 4 מילים גג.
      3. אפשרויות בחירה:
         - לשאלות רגילות: ספק בדיוק 3 אפשרויות.
         - לשאלות "נכון/לא נכון": ספק בדיוק 2 אפשרויות (למשל: "נכון", "לא נכון").
      4. גוון בסוגי השאלות (חלק רגילות, חלק נכון/לא נכון).

      ${difficultyInstruction}
      
      פלט JSON בלבד:
      [
        {
          "question": "שאלה קצרה...",
          "options": ["תשובה קצרה", "תשובה קצרה", "תשובה קצרה"],
          "correctIndex": 0,
          "category": "הנושא שנבחר מהרשימה"
        }
      ]
      חשוב: Escape quotes inside strings.
    `;

    // --- שימוש ב-Retry ובמודל גיבוי לפי בקשת המשתמש ---
    const modelsToTry = [
      "gemini-2.5-flash", 
      "gemini-2.5-flash-preview-09-2025", 
      "gemini-2.5-flash-lite"
    ];

    let geminiData = null;
    let lastError = null;

    for (const model of modelsToTry) {
      try {
        console.log(`[Cron] Attempting generation with model: ${model}`);
        
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
          2, // 2 ניסיונות לכל מודל
          1000 // השהייה התחלתית
        );

        const data = await geminiResponse.json();
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
           geminiData = data;
           console.log(`[Cron] SUCCESS using model: ${model}`); // לוג הצלחה ברור ב-console
           break;
        } else {
           throw new Error(`Invalid response structure from ${model}`);
        }

      } catch (e) {
        console.warn(`[Cron] Failed with model ${model}:`, e);
        lastError = e;
      }
    }

    if (!geminiData) {
      throw lastError || new Error('All Gemini models failed');
    }
    
    let newQuestionsRaw = [];
    
    try {
      const text = geminiData.candidates[0].content.parts[0].text;
      newQuestionsRaw = JSON.parse(text);
    } catch (e) {
      console.error('JSON Parse Error', e);
      // במקרה שגיאת JSON - נסה שוב עוד 2 דקות
      const retryTime = new Date(now.getTime() + 2 * 60000);
      await supabaseServer.from('daily_challenges').update({
          next_batch_at: retryTime.toISOString(),
          last_log: `Error parsing JSON batch ${nextBatchNum}. Retrying soon.`
      }).eq('challenge_date', targetDate);
      throw new Error('Failed to parse Gemini JSON');
    }

    const validNewQuestions = validateAndFixQuestions(newQuestionsRaw);
    const currentQuestions = challenge.questions || [];
    const updatedQuestions = [...currentQuestions, ...validNewQuestions];

    const nextRunTime = new Date(now.getTime() + BATCH_WAIT_MINUTES * 60000);

    const updatePayload: any = {
      questions: updatedQuestions,
      current_batch: nextBatchNum,
      next_batch_at: nextBatchNum < 2 ? nextRunTime.toISOString() : now.toISOString(),
      last_log: `Batch ${nextBatchNum} for ${targetDate} Success. Added ${validNewQuestions.length} questions.`
    };

    // סיום בנגלה שניה או אם הגענו ליעד
    if (nextBatchNum === 2 || updatedQuestions.length >= TOTAL_TARGET_QUESTIONS) {
      updatePayload.status = 'complete';
      updatePayload.last_log = `READY for ${targetDate}! Total: ${updatedQuestions.length}`;
    }

    await supabaseServer
      .from('daily_challenges')
      .update(updatePayload)
      .eq('challenge_date', targetDate);

    return NextResponse.json({
      success: true,
      targetDate: targetDate,
      batch: nextBatchNum,
      added: validNewQuestions.length,
      total: updatedQuestions.length
    });

  } catch (error: any) {
    console.error('Cron Job Failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}