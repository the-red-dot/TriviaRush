import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';

function getIsraelDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

// פונקציית עזר לחישוב מדויק של חצות (00:00) שעון ישראל במונחי UTC
// זה מונע את הבאג שבו משחקים בין 00:00 ל-02:00 בלילה לא מופיעים בטבלה היומית
function getStartOfIsraelDayISO() {
  const now = new Date();
  // 1. קבלת התאריך הנוכחי בישראל בפורמט YYYY-MM-DD
  const ilDateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  
  // 2. יצירת אובייקט זמן שמייצג את חצות UTC של אותו תאריך
  // (למשל: 2025-12-10T00:00:00Z)
  const midnightUTC = new Date(ilDateStr + 'T00:00:00Z');
  
  // 3. חישוב ההפרש בין ישראל ל-UTC באותו יום ספציפי
  // אם בישראל 02:00 כשאצלנו 00:00 UTC -> שעון חורף (הפרש 2)
  // אם בישראל 03:00 כשאצלנו 00:00 UTC -> שעון קיץ (הפרש 3)
  const ilTimeAtMidnightUTC = midnightUTC.toLocaleTimeString('en-US', { timeZone: 'Asia/Jerusalem', hour12: false });
  const hourOffset = parseInt(ilTimeAtMidnightUTC.split(':')[0], 10);
  
  // 4. חיסור ההפרש כדי לקבל את ה-UTC האמיתי של חצות ישראל
  midnightUTC.setHours(midnightUTC.getHours() - hourOffset);
  
  return midnightUTC.toISOString();
}

export async function GET(req: Request) {
  if (!supabaseServer) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'daily';
  const userId = searchParams.get('userId');

  try {
    let scores = [];

    if (type === 'accumulated') {
      // בטבלה המצטברת הכל נמצא באותה טבלה, כולל הקוסמטיקה
      const { data, error } = await supabaseServer
        .from('user_best_scores')
        .select('player_name, masked_id, score, total_money, total_correct, total_wrong, last_played_at, active_frame, golden_name_expires_at')
        .order('score', { ascending: false })
        .limit(20);
      
      if (error) throw error;
      scores = data ?? [];
    
    } else if (type === 'personal') {
      if (!userId) return NextResponse.json({ scores: [] });
      const { data, error } = await supabaseServer
        .from('high_scores')
        .select('*')
        .eq('user_id', userId)
        .order('score', { ascending: false })
        .limit(20);

      if (error) throw error;
      scores = data ?? [];

    } else {
      // --- טבלה יומית ---
      // שימוש בפונקציה החדשה לחישוב זמן התחלה מדויק
      const isoStart = getStartOfIsraelDayISO();

      // 1. שליפת השיאים היומיים (ללא קוסמטיקה בינתיים)
      const { data: dailyData, error: dailyError } = await supabaseServer
        .from('high_scores')
        .select('*')
        .gte('created_at', isoStart) 
        .order('score', { ascending: false })
        .limit(20);

      if (dailyError) throw dailyError;

      // 2. העשרת הנתונים עם קוסמטיקה (Frame/Gold) מטבלת הפרופילים המצטברת
      if (dailyData && dailyData.length > 0) {
          // איסוף מזהי המשתמשים (רק אלו שרשומים)
          const userIds = dailyData
            .filter(r => r.user_id)
            .map(r => r.user_id);

          if (userIds.length > 0) {
              const { data: profiles } = await supabaseServer
                  .from('user_best_scores')
                  .select('user_id, active_frame, golden_name_expires_at')
                  .in('user_id', userIds);

              // מיפוי מהיר לפי ID
              const profileMap: Record<string, any> = {};
              profiles?.forEach(p => { profileMap[p.user_id] = p; });

              // מיזוג לתוך התוצאות
              scores = dailyData.map(record => {
                  const profile = record.user_id ? profileMap[record.user_id] : null;
                  return {
                      ...record,
                      active_frame: profile?.active_frame || 'none',
                      golden_name_expires_at: profile?.golden_name_expires_at || null
                  };
              });
          } else {
              scores = dailyData;
          }
      } else {
          scores = [];
      }
    }

    return NextResponse.json({ scores });

  } catch (err: any) {
    console.error('GET /api/high-scores error:', err);
    return NextResponse.json({ error: 'internal-error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!supabaseServer) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { 
      playerName, 
      score, 
      money, 
      stage, 
      correct_count, 
      wrong_count, 
      achievements, 
      userId,
      maskedId
    } = body;

    if (!playerName || typeof score !== 'number') {
      return NextResponse.json({ error: 'bad-request' }, { status: 400 });
    }

    const finalUserId: string | null = userId || null;

    // 1. שמירה בהיסטוריה (טבלת high_scores)
    // הערה: created_at מקבל אוטומטית את זמן השרת (UTC)
    const { error: histError } = await supabaseServer.from('high_scores').insert({
      user_id: finalUserId,
      player_name: playerName,
      masked_id: maskedId || null,
      score,
      money: money ?? 0,
      stage,
      correct_count: correct_count ?? 0,
      wrong_count: wrong_count ?? 0,
      achievements: achievements ?? [],
    });

    if (histError) throw histError;

    // 2. עדכון הטבלה המצטברת (user_best_scores)
    if (finalUserId) {
      const { data: existingEntry } = await supabaseServer
        .from('user_best_scores')
        .select('*')
        .eq('user_id', finalUserId)
        .single();

      if (!existingEntry) {
        // יצירת רשומה חדשה למשתמש
        await supabaseServer.from('user_best_scores').insert({
          user_id: finalUserId,
          player_name: playerName,
          masked_id: maskedId || null,
          score: score,
          total_money: money ?? 0,
          total_correct: correct_count ?? 0,
          total_wrong: wrong_count ?? 0,
          achievements: achievements ?? [],
          last_played_at: new Date().toISOString()
        });
      } else {
        // עדכון רשומה קיימת
        const updateData: any = {
          player_name: playerName,
          masked_id: maskedId || null,
          last_played_at: new Date().toISOString(),
          total_money: (existingEntry.total_money || 0) + (money ?? 0),
          total_correct: (existingEntry.total_correct || 0) + (correct_count ?? 0),
          total_wrong: (existingEntry.total_wrong || 0) + (wrong_count ?? 0)
        };

        if (score > existingEntry.score) {
          updateData.score = score;
          updateData.achievements = achievements ?? []; 
        }

        await supabaseServer
          .from('user_best_scores')
          .update(updateData)
          .eq('user_id', finalUserId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/high-scores error:', err);
    return NextResponse.json({ error: 'internal-error' }, { status: 500 });
  }
}