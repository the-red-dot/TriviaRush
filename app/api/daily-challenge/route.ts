// trivia-rush\app\api\daily-challenge\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';

export const dynamic = 'force-dynamic';

function getIsraelDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

export async function GET() {
  if (!supabaseServer) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const today = getIsraelDate();

  try {
    const { data: challenge, error } = await supabaseServer
      .from('daily_challenges')
      .select('*')
      .eq('challenge_date', today)
      .single();

    // אם אין רשומה, מחזירים סטטוס התחלתי (ה-Client יראה 0/50)
    if (!challenge) {
      return NextResponse.json({ 
        date: today, 
        status: 'not_started', 
        progress: 0, 
        total: 50 
      });
    }

    const questions = challenge.questions || [];
    
    // מנגנון הגנה:
    // מחזירים את השאלות ללקוח *רק* כשהסטטוס הוא 'complete' (כל 50 השאלות מוכנות).
    // אם התהליך באמצע, מחזירים מערך ריק כדי למנוע מצב של משחק חלקי.
    const questionsToReturn = challenge.status === 'complete' ? questions : [];

    return NextResponse.json({
      questions: questionsToReturn,
      date: today,
      status: challenge.status, // 'pending', 'processing', 'complete'
      currentBatch: challenge.current_batch,
      progress: questions.length,
      total: 50, // היעד החדש שלנו: 50 שאלות
      log: challenge.last_log,
      nextBatchAt: challenge.next_batch_at
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}