// trivia-rush\app\api\generate\route.ts

import { NextRequest, NextResponse } from 'next/server';

// פונקציית עזר לביצוע בקשות עם ניסיון חוזר (Retry)
async function fetchWithRetry(url: string, options: any, retries = 3, initialDelay = 1000) {
  let delay = initialDelay;
  
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.ok) return response;
      
      // טיפול בשגיאות שרת ועומס
      if (response.status === 503 || response.status === 429 || response.status >= 500) {
        console.warn(`[Generate API] Attempt ${i + 1} failed (${response.status}). Retrying...`);
        if (i === retries - 1) throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; 
        continue;
      }
      
      throw new Error(`Gemini API Error: ${response.status} ${response.statusText}`);
      
    } catch (error) {
      console.error(`[Generate API] Attempt ${i + 1} Error:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
  throw new Error('Max retries reached for Gemini API');
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { prompt, tools, apiKey: userApiKey } = body;

  const apiKey = userApiKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing User API Key. Please provide a key in settings.' },
      { status: 401 }
    );
  }

  if (!prompt) {
    return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
  }

  // עדכון מודלים לפי סדר העדיפויות שביקשת
  const modelsToTry = [
    "gemini-2.5-flash", 
    "gemini-2.5-flash-preview-09-2025", 
    "gemini-2.5-flash-lite"
  ];

  let geminiData = null;
  let lastError = null;
  let usedModel = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            // אם יש tools (כמו חיפוש), נוסיף אותם
            ...(tools && tools.length > 0 ? { tools } : {}),
            generationConfig: { responseMimeType: "application/json" }
          }),
        },
        2, 
        1000
      );

      const data = await response.json();
      
      if (data.candidates && data.candidates[0] && data.candidates[0].content) {
         geminiData = data;
         usedModel = model;
         console.log(`[Generate API] SUCCESS using model: ${model}`); // הדפסת המודל שנבחר ללוג
         break;
      } else {
         console.warn(`[Generate API] Empty response from ${model}`, data);
         throw new Error(`Empty/Blocked response from ${model}`);
      }

    } catch (e) {
      console.warn(`[Generate API] Failed with model ${model}:`, e);
      lastError = e;
    }
  }

  if (!geminiData) {
    return NextResponse.json(
      { error: 'Failed to generate content', details: lastError },
      { status: 500 }
    );
  }

  return NextResponse.json(geminiData);
}