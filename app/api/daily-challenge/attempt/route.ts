// trivia-rush\app\api\daily-challenge\attempt\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../../utils/supabase';

function getIsraelDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export async function POST(req: Request) {
  if (!supabaseServer) return NextResponse.json({ error: 'No DB' }, { status: 500 });

  const { userId } = await req.json();
  // אם אין משתמש, אנחנו מאפשרים (למצב אורח או בדיקה), 
  // אבל הקליינט לרוב חוסם את זה לפני כן.
  if (!userId) return NextResponse.json({ allowed: true }); 

  const today = getIsraelDate();

  try {
    // שליפת סטטוס קיים להיום
    let { data: dailyStats } = await supabaseServer
      .from('daily_player_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('play_date', today)
      .single();

    // אם אין רשומה להיום - יוצרים חדשה
    if (!dailyStats) {
      const { data: newStats, error } = await supabaseServer
        .from('daily_player_stats')
        .insert({ user_id: userId, play_date: today, attempts: 0 })
        .select()
        .single();
      
      if (error) throw error;
      dailyStats = newStats;
    }

    // --- לוגיקה מעודכנת ---
    // המקסימום המותר: 1 (רגיל) או 2 (אם נרכש כרטיס קאמבק)
    const maxAllowed = dailyStats.has_retry_pass ? 2 : 1;
    
    if (dailyStats.attempts >= maxAllowed) {
      // אם יש לו כרטיס והוא הגיע ל-2, הוא סיים להיום.
      // אם אין לו כרטיס והוא הגיע ל-1, הוא צריך לקנות כרטיס כדי להמשיך.
      const reason = (dailyStats.attempts >= 2) ? 'daily_limit_reached' : 'needs_pass';
      return NextResponse.json({ allowed: false, reason });
    }

    // עדכון מספר הניסיונות (מעלים ב-1) לפני תחילת המשחק
    await supabaseServer
      .from('daily_player_stats')
      .update({ attempts: dailyStats.attempts + 1 })
      .eq('user_id', userId)
      .eq('play_date', today);

    return NextResponse.json({ allowed: true });

  } catch (error: any) {
    console.error('Attempt check error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}