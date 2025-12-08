import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // קבלת הגוף של הבקשה
  const body = await req.json();
  const { prompt, tools, apiKey: userApiKey } = body;

  // עדכון קריטי: עבור משחקים מותאמים אישית (שמשתמשים ב-Route הזה),
  // אנחנו דורשים אך ורק את המפתח של המשתמש.
  // הסרתי את ה-Fallback למפתח המערכת (process.env) כדי להבטיח שלא ייעשה שימוש במכסה שלך למשחקים פרטיים.
  const apiKey = userApiKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing User API Key. Please provide a key in settings.' },
      { status: 401 } // 401 Unauthorized - חובה לספק מפתח
    );
  }

  if (!prompt) {
    return NextResponse.json(
      { error: 'Missing prompt in request body' },
      { status: 400 }
    );
  }

  const payload: any = {
    contents: [{ parts: [{ text: prompt }] }],
  };

  if (tools && Array.isArray(tools) && tools.length > 0) {
    payload.tools = tools;
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json().catch(() => undefined);
      console.error('Gemini API Error Details:', errorData);
      return NextResponse.json(
        { error: 'Gemini API error', details: errorData },
        { status: 500 }
      );
    }

    const data = await geminiResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error calling Gemini:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from Gemini' },
      { status: 500 }
    );
  }
}