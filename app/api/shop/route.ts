// trivia-rush\app\api\shop\route.ts

import { NextResponse } from 'next/server';
import { supabaseServer } from '../../../utils/supabase';

function getIsraelDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

// GET: קבלת יתרה, סטטוס יומי ומלאי
export async function GET(req: Request) {
  if (!supabaseServer) return NextResponse.json({ error: 'No DB' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'No User ID' }, { status: 400 });

  const today = getIsraelDate();

  try {
    // 1. קבלת יתרה ומלאי (כולל קוסמטיקה)
    const { data: walletData } = await supabaseServer
      .from('user_best_scores')
      .select('total_money, inventory, active_theme, active_frame, golden_name_expires_at')
      .eq('user_id', userId)
      .single();

    const balance = walletData?.total_money || 0;
    const inventory = walletData?.inventory || [];
    const activeTheme = walletData?.active_theme || 'default';
    const activeFrame = walletData?.active_frame || 'none';
    
    // בדיקה אם "שם הזהב" עדיין בתוקף
    let isGolden = false;
    if (walletData?.golden_name_expires_at) {
        const expiry = new Date(walletData.golden_name_expires_at);
        if (expiry > new Date()) isGolden = true;
    }

    // 2. קבלת סטטוס יומי (Daily Stats)
    const { data: dailyStats } = await supabaseServer
      .from('daily_player_stats')
      .select('*')
      .eq('user_id', userId)
      .eq('play_date', today)
      .single();

    return NextResponse.json({
      balance,
      inventory,
      activeTheme,
      activeFrame,
      isGolden,
      attempts: dailyStats?.attempts || 0,
      hasRetryPass: dailyStats?.has_retry_pass || false
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: רכישת פריט (כרטיס קאמבק או קוסמטיקה)
export async function POST(req: Request) {
  if (!supabaseServer) return NextResponse.json({ error: 'No DB' }, { status: 500 });

  const body = await req.json();
  const { userId, itemId } = body;
  const today = getIsraelDate();

  // מחירון פריטים (0 = חינם/ברירת מחדל)
  // עודכן: הוסרו המסגרות
  const PRICES: Record<string, number> = {
      'retry_pass': 5000,
      'theme_default': 0,
      'theme_matrix': 2500,
      'theme_retro': 2500,
      'theme_gold': 2500,
      'golden_name': 5000
  };

  if (PRICES[itemId] === undefined) {
    return NextResponse.json({ error: 'Invalid Item' }, { status: 400 });
  }

  const cost = PRICES[itemId];

  try {
    // 1. קבלת נתונים נוכחיים
    const { data: userData } = await supabaseServer
      .from('user_best_scores')
      .select('*')
      .eq('user_id', userId)
      .single();

    const currentBalance = userData?.total_money || 0;
    let inventory = userData?.inventory || [];
    if (!Array.isArray(inventory)) inventory = [];

    // בדיקה האם הפריט כבר נרכש (למעט מתכלים)
    // ברירת מחדל (default) נחשבת תמיד כ-"בבעלות"
    const isConsumable = itemId === 'retry_pass' || itemId === 'golden_name';
    const isDefault = itemId === 'theme_default';
    const isOwned = inventory.includes(itemId) || isDefault;

    // אם זה פריט קבוע שכבר נרכש (או ברירת מחדל) - רק מפעילים אותו
    if (!isConsumable && isOwned) {
        let updateData: any = {};
        if (itemId.startsWith('theme_')) updateData.active_theme = itemId;
        
        // במקרה של ברירת מחדל, נשמור ב-DB את הערך 'default' הנקי
        if (itemId === 'theme_default') updateData.active_theme = 'default';

        await supabaseServer
            .from('user_best_scores')
            .update(updateData)
            .eq('user_id', userId);
            
        return NextResponse.json({ success: true, newBalance: currentBalance, message: 'Activated' });
    }

    // בדיקת יתרה לתשלום
    if (currentBalance < cost) {
      return NextResponse.json({ error: 'Insufficient funds' }, { status: 402 });
    }

    // --- ביצוע רכישה לפי סוג ---

    // 1. כרטיס קאמבק
    if (itemId === 'retry_pass') {
        const { error: deductError } = await supabaseServer
            .from('user_best_scores')
            .update({ total_money: currentBalance - cost })
            .eq('user_id', userId);
        
        if (deductError) throw deductError;

        // עדכון סטטוס יומי
        const { data: existingDaily } = await supabaseServer
            .from('daily_player_stats')
            .select('*')
            .eq('user_id', userId)
            .eq('play_date', today)
            .single();

        if (existingDaily) {
            await supabaseServer
                .from('daily_player_stats')
                .update({ has_retry_pass: true })
                .eq('user_id', userId)
                .eq('play_date', today);
        } else {
            await supabaseServer
                .from('daily_player_stats')
                .insert({ 
                    user_id: userId, 
                    play_date: today, 
                    attempts: 0, 
                    has_retry_pass: true 
                });
        }
    } 
    // 2. שם הזהב (ל-24 שעות)
    else if (itemId === 'golden_name') {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        
        await supabaseServer
            .from('user_best_scores')
            .update({ 
                total_money: currentBalance - cost,
                golden_name_expires_at: expiresAt.toISOString()
            })
            .eq('user_id', userId);
    }
    // 3. פריטים קבועים (Themes בלבד) - רכישה ראשונה
    else {
        inventory.push(itemId);
        let updateData: any = { 
            total_money: currentBalance - cost,
            inventory: inventory
        };
        // הפעלה אוטומטית בעת הרכישה
        if (itemId.startsWith('theme_')) updateData.active_theme = itemId;

        await supabaseServer
            .from('user_best_scores')
            .update(updateData)
            .eq('user_id', userId);
    }

    return NextResponse.json({ success: true, newBalance: currentBalance - cost });

  } catch (error: any) {
    console.error('Purchase error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}