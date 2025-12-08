import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';
import { ALL_SUB_TOPICS } from './topics'; // ייבוא רשימת הנושאים

export const dynamic = 'force-dynamic';

const TOTAL_TARGET_QUESTIONS = 101;
const BATCH_WAIT_MINUTES = 5; // עודכן ל-5 דקות
const PRE_GENERATE_HOUR = 21; // מתחילים להכין את המחר החל משעה 21:00

const BATCH_CONFIG: any = {
  1: { topicsCount: 33 },
  2: { topicsCount: 33 },
  3: { topicsCount: 35 },
};

// פונקציית עזר לקבלת אובייקט זמן ישראל
function getIsraelTime() {
  const now = new Date();
  const israelTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
  return new Date(israelTimeStr);
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

function validateAndFixQuestions(questions: any[]): any[] {
  if (!Array.isArray(questions)) return [];
  return questions.filter(q => {
    if (!q || typeof q !== 'object') return false;
    if (typeof q.question !== 'string' || q.question.length < 3) return false;
    if (!q.category) q.category = 'כללי';
    if (!Array.isArray(q.options) || q.options.length !== 4) return false;
    if (typeof q.correctIndex !== 'number' || q.correctIndex < 0 || q.correctIndex > 3) return false;
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

    // לוגיקה חכמה:
    // 1. קודם בודקים את היום. אם לא גמור - עובדים עליו.
    // 2. אם היום גמור, בודקים אם השעה מאוחרת (>= 21:00).
    // 3. אם כן, בודקים את מחר. אם מחר לא גמור - עובדים עליו.

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
      
      // תיקון: אם זמן ההמתנה שנותר גדול מההגדרה החדשה (5 דקות), סימן שזה ערך ישן.
      // במקרה כזה, נתעלם ממנו ונריץ את הנגלה.
      if (waitMinutes <= BATCH_WAIT_MINUTES) {
         return NextResponse.json({ message: `Waiting for next batch slot for ${targetDate}. ${waitMinutes} mins left.` });
      }
      console.log(`[Cron] Legacy wait time detected (${waitMinutes}m > ${BATCH_WAIT_MINUTES}m). Overriding and running now.`);
    }

    const nextBatchNum = (challenge.current_batch || 0) + 1;
    
    // הגנה
    if (nextBatchNum > 3) {
       await supabaseServer.from('daily_challenges').update({ status: 'complete' }).eq('challenge_date', targetDate);
       return NextResponse.json({ message: 'Marked as complete (Safety)' });
    }

    // --- הפעלת ג'מיני ---
    const config = BATCH_CONFIG[nextBatchNum];
    const questionsToGenerate = nextBatchNum === 3 ? 35 : 33; // לוודא סה"כ 101

    // בחירת נושאים רנדומליים מתוך הרשימה הגדולה
    const shuffledTopics = shuffleArray(ALL_SUB_TOPICS);
    const selectedTopics = shuffledTopics.slice(0, questionsToGenerate);

    console.log(`[Cron] Generating Batch ${nextBatchNum} for ${targetDate}. Topics: ${selectedTopics.length}`);

    // הגדרת הנחיות דינמיות לפי מספר הנגלה
    let difficultyInstruction = '';
    
    if (nextBatchNum === 1) {
        difficultyInstruction = `
        1. רמת קושי: קלה-בינונית (שאלות ידע כללי נגישות).
        2. הקפד על עובדות נכונות ומעניינות.
        3. המנע משאלות מכשילות מדי - המטרה היא כניסה חלקה למשחק.`;
    } else if (nextBatchNum === 2) {
        difficultyInstruction = `
        1. רמת קושי: בינונית.
        2. המנע מעובדות בנאליות או התוצאה הראשונה והמובנת מאליה.
        3. חפש עובדות מעניינות שדורשות ידע מעט יותר מעמיק, אך עדיין הוגנות.
        4. אל תשאל שאלות טריוויאליות שכולם יודעים.`;
    } else {
        // נגלה 3
        difficultyInstruction = `
        1. רמת קושי: נישתית/ספציפית.
        2. לכל נושא, התמקד בזווית ייחודית, נישה פנימית או פרט ספציפי, ולא בידע הכללי של הנושא.
        3. השאלות צריכות להיות מאתגרות ולא צפויות.
        4. התמקד ב"הידעת?" או עובדות מפתיעות בתוך הנישה.`;
    }

    const prompt = `
      משימה: צור בדיוק ${selectedTopics.length} שאלות טריוויה בעברית לאתגר היומי.
      יש ליצור שאלה אחת עבור כל אחד מהנושאים הבאים:
      ${selectedTopics.join(', ')}

      הנחיות ספציפיות לנגלה זו (נגלה ${nextBatchNum} מתוך 3):
      ${difficultyInstruction}
      
      פלט JSON בלבד:
      [
        {
          "question": "...",
          "options": ["...", "...", "...", "..."],
          "correctIndex": 0, 
          "category": "הנושא שנבחר מהרשימה"
        }
      ]
      חשוב: Escape quotes inside strings.
    `;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        }),
      }
    );

    if (!geminiResponse.ok) throw new Error(`Gemini API Error: ${geminiResponse.statusText}`);
    
    const geminiData = await geminiResponse.json();
    let newQuestionsRaw = [];
    
    try {
      const text = geminiData.candidates[0].content.parts[0].text;
      newQuestionsRaw = JSON.parse(text);
    } catch (e) {
      console.error('JSON Parse Error', e);
      // Retry in 5 mins
      const retryTime = new Date(now.getTime() + 5 * 60000);
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
      next_batch_at: nextBatchNum < 3 ? nextRunTime.toISOString() : now.toISOString(),
      last_log: `Batch ${nextBatchNum} for ${targetDate} Success. Added ${validNewQuestions.length} questions.`
    };

    if (nextBatchNum === 3 || updatedQuestions.length >= TOTAL_TARGET_QUESTIONS) {
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