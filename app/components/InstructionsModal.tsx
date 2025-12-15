'use client';

import React from 'react';

export default function InstructionsModal() {
  return (
    <div id="instructions-modal" className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">📜 מדריך למשחק</div>
        <div
          className="modal-body"
          style={{ textAlign: 'right', lineHeight: 1.6, maxHeight: '60vh', overflowY: 'auto' }}
        >
          <div style={{ marginBottom: 15 }}>
            <h3 style={{ color: 'var(--secondary)', marginBottom: 5 }}>
              ⚡ המטרה
            </h3>
            <p style={{ margin: 0 }}>
              לענות על שאלות, לצבור כסף ולשרוד! הזמן הוא המשאב הכי יקר שלכם - אם הוא נגמר, המשחק נגמר.
            </p>
          </div>

          <div style={{ marginBottom: 15 }}>
            <h3 style={{ color: 'gold', marginBottom: 5 }}>
              🎮 מצבי משחק
            </h3>
            <ul style={{ paddingRight: 20, margin: 0 }}>
              <li style={{ marginBottom: 5 }}>
                <b>האתגר היומי:</b> 50 שאלות זהות לכל השחקנים בישראל. האתגר מתאפס בחצות.
                <br />
                <span style={{ fontSize: '0.85rem', color: '#aaa' }}>
                  * מוגבל לניסיון אחד חינם ביום (ניתן לרכוש כרטיס קאמבק לניסיון נוסף).
                </span>
              </li>
              <li>
                <b>משחק מותאם:</b> צור משחק בכל נושא שתרצה!
                <br />
                <span style={{ fontSize: '0.85rem', color: '#aaa' }}>
                  * דורש מפתח API אישי (חינם) של Google Gemini בהגדרות הפרופיל.
                </span>
              </li>
            </ul>
          </div>

          <div style={{ marginBottom: 15 }}>
            <h3 style={{ color: 'var(--warning)', marginBottom: 5 }}>
              ⏳ חוקים וניקוד
            </h3>
            <ul style={{ paddingRight: 20, margin: 0 }}>
              <li><b>תשובה נכונה:</b> מעניקה כסף ומוסיפה זמן לשעון.</li>
              <li><b>תשובה שגויה:</b> קנס זמן מיידי!</li>
              <li><b>Speed Run:</b> תשובה מהירה (מתחת ל-2 שניות) מכפילה את הכסף.</li>
              <li><b>רמות קושי:</b> המשחק מחולק ל-10 שלבים, הקושי עולה ככל שמתקדמים.</li>
            </ul>
          </div>

          <div style={{ marginBottom: 15 }}>
            <h3 style={{ color: 'var(--shop)', marginBottom: 5 }}>
              🛒 חנות ועזרות
            </h3>
            <ul style={{ paddingRight: 20, margin: 0 }}>
              <li><b>גלגלי הצלה:</b> 50:50, הקפאת זמן, והתייעצות עם AI.</li>
              <li>ניתן לקנות תוספת זמן ומילוי עזרות במהלך המשחק.</li>
              <li style={{ color: 'var(--danger)', fontWeight: 'bold' }}>
                שימו לב: הזמן לא עוצר כשאתם בתוך החנות!
              </li>
              <li><b>קוסמטיקה:</b> ניתן לרכוש ערכות נושא (Themes) ושם זוהר לטבלה בחנות הראשי.</li>
            </ul>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="btn"
            style={{ width: 'auto', padding: '10px 30px' }}
            onClick={() =>
              // שימוש ב-window as any כדי לגשת לפונקציה הגלובלית שהוגדרה ב-page.tsx
              (window as any).closeModal && (window as any).closeModal('instructions-modal')
            }
          >
            הבנתי, יאללה!
          </button>
        </div>
      </div>
    </div>
  );
}