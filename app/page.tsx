// trivia-rush\app\page.tsx

'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { LucideIcon } from 'lucide-react';

// --- Supabase Setup (Inlined) ---
// Note: In a real app, use environment variables. 
// For this environment, we attempt to read them or fallback safely.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);

// --- Types ---
declare global {
  interface Window {
    triviaRushInit?: () => void;
    startGame?: () => void;
    startDailyChallenge?: () => void;
    startCustomGame?: () => void;
    openLeaderboard?: (type?: string) => void;
    openInstructions?: () => void;
    closeModal?: (id: string) => void;
    buyItem?: (type: string, btn?: HTMLButtonElement) => void;
    openShop?: () => void;
    closeShop?: () => void;
    useLifeline?: (type: string) => void;
    returnToMenu?: () => void;
    backToLeaderboard?: () => void;
    addCustomTopic?: () => void;
    showPlayerDetails?: (index: number) => void;
    removeCustomTopic?: (topic: string) => void;
    shareResult?: (platform: string) => void;

    currentUser?: {
      id: string;
      email?: string | null;
    };
    userApiKey?: string | null;
  }
}

// --- Inline Components ---

const InstructionsModal = () => {
  return (
    <div id="instructions-modal" className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <button
            className="modal-back-btn"
            onClick={() => window.closeModal && window.closeModal('instructions-modal')}
          >
            <i data-lucide="arrow-right" />
          </button>
          <span>📜 הוראות משחק</span>
        </div>
        <div className="modal-body" style={{ textAlign: 'right', direction: 'rtl' }}>
          <h3>איך משחקים?</h3>
          <ul style={{ paddingRight: '20px', lineHeight: '1.6' }}>
            <li>ענו על כמה שיותר שאלות נכונות לפני שנגמר הזמן.</li>
            <li>כל תשובה נכונה מזכה אתכם בכסף ובתוספת זמן.</li>
            <li>תשובה שגויה תוריד לכם זמן יקר מהשעון!</li>
            <li>השתמשו בגלגלי הצלה (50/50, AI, הקפאה) כשאתם תקועים.</li>
            <li>בחנויות ניתן לקנות תוספות זמן ופריטים מיוחדים עם הכסף שצברתם.</li>
          </ul>
        </div>
        <div className="modal-footer">
          <button
            className="btn"
            onClick={() => window.closeModal && window.closeModal('instructions-modal')}
          >
            הבנתי, בוא נשחק!
          </button>
        </div>
      </div>
    </div>
  );
};

export default function HomePage() {
  const [loadingUser, setLoadingUser] = useState(true);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  
  // Modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showMainShopModal, setShowMainShopModal] = useState(false);
  const [shopTab, setShopTab] = useState<'items' | 'cosmetics'>('items');

  // Shop & Stats
  const [userBalance, setUserBalance] = useState(0);
  const [dailyAttempts, setDailyAttempts] = useState(0);
  const [hasRetryPass, setHasRetryPass] = useState(false);
  const [inventory, setInventory] = useState<string[]>([]);
  const [activeTheme, setActiveTheme] = useState('default');
  const [isGolden, setIsGolden] = useState(false);
  const [shopLoading, setShopLoading] = useState(false);

  // API Key
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [storedApiKey, setStoredApiKey] = useState<string | null>(null);
  
  // Daily Challenge Timer State
  const [timeToNextChallenge, setTimeToNextChallenge] = useState('');
  const [dailyStatus, setDailyStatus] = useState<any>(null); // סטטוס האתגר היומי

  useEffect(() => {
    // Init Game
    if (window.triviaRushInit) {
        window.triviaRushInit();
    }

    // Check Auth
    supabaseBrowser.auth.getUser().then(({ data }) => {
      const user = data?.user;
      if (user) {
        window.currentUser = { id: user.id, email: user.email };
        setUserEmail(user.email ?? null);
        setUserId(user.id);
        fetchUserShopData(user.id); // Load balance immediately
      }
      setLoadingUser(false);
    });

    // Check Local Storage for API Key
    const localKey = localStorage.getItem('trivia_gemini_key');
    if (localKey) {
        setStoredApiKey(localKey);
        window.userApiKey = localKey;
    }

    // Start Timers
    const timerInterval = setInterval(calculateTimeUntilMidnightIL, 1000);
    calculateTimeUntilMidnightIL(); 

    // Poll Daily Status (Read Only)
    checkDailyStatus();
    const statusInterval = setInterval(checkDailyStatus, 30000); 

    return () => {
        clearInterval(timerInterval);
        clearInterval(statusInterval);
    };
  }, []);

  async function fetchUserShopData(uid: string) {
      try {
          const res = await fetch(`/api/shop?userId=${uid}`);
          if (res.ok) {
              const data = await res.json();
              setUserBalance(data.balance);
              setDailyAttempts(data.attempts);
              setHasRetryPass(data.hasRetryPass);
              setInventory(data.inventory || []);
              setActiveTheme(data.activeTheme || 'default');
              setIsGolden(data.isGolden);
              
              applyTheme(data.activeTheme || 'default');
          }
      } catch (e) {
          console.error('Failed to fetch shop data', e);
      }
  }

  function applyTheme(themeName: string) {
      document.body.className = ''; 
      if (themeName && themeName !== 'default') {
          document.body.classList.add(`theme-${themeName.replace('theme_', '')}`);
      }
  }

  async function checkDailyStatus() {
      try {
          const res = await fetch('/api/daily-challenge');
          if(res.ok) {
              const data = await res.json();
              setDailyStatus(data);
          }
      } catch (e) {
          console.error('Error checking daily status', e);
      }
  }

  function saveApiKey() {
      if(!apiKeyInput.trim()) return;
      localStorage.setItem('trivia_gemini_key', apiKeyInput.trim());
      setStoredApiKey(apiKeyInput.trim());
      window.userApiKey = apiKeyInput.trim();
      setApiKeyInput('');
  }

  function removeApiKey() {
      localStorage.removeItem('trivia_gemini_key');
      setStoredApiKey(null);
      window.userApiKey = null;
  }

  function calculateTimeUntilMidnightIL() {
      const now = new Date();
      const israelTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' });
      const israelTime = new Date(israelTimeStr);
      const target = new Date(israelTime);
      target.setHours(24, 0, 0, 0);
      const diff = target.getTime() - israelTime.getTime();
      
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeToNextChallenge(
          `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
  }

  // --- Start Daily Challenge Logic ---
  async function handleStartDaily() {
      if (!userId) {
          alert('חובה להתחבר כדי לשחק באתגר היומי (כדי שנשמור את התוצאה שלך!)');
          setShowAuthModal(true);
          return;
      }

      // Refresh data before checking
      await fetchUserShopData(userId);
      
      // Perform server-side check and "use" attempt
      try {
          const res = await fetch('/api/daily-challenge/attempt', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ userId })
          });
          const data = await res.json();

          if (data.allowed) {
              // GO!
              if(window.startDailyChallenge) window.startDailyChallenge();
          } else {
              // Blocked - Handle specific reasons
              if (data.reason === 'daily_limit_reached') {
                  alert('הגעת למגבלת המשחקים היומית (2/2)! 🛑\nנתראה באתגר של מחר.');
              } else {
                  alert('ניצלת את הניסיון החינמי היומי! 🛑\nכנס לחנות כדי לקנות כרטיס קאמבק לניסיון נוסף.');
              }
              setShowMainShopModal(true);
          }
      } catch (e) {
          alert('שגיאה בתקשורת. נסה שוב.');
      }
  }

  async function buyItem(itemId: string) {
      if (!userId) return;
      setShopLoading(true);
      try {
          const res = await fetch('/api/shop', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ userId, itemId })
          });
          const data = await res.json();
          
          if (res.ok && data.success) {
              if (data.message === 'Activated') {
                    // Item was already owned, just activated
                    if (itemId.startsWith('theme_')) applyTheme(itemId);
                    alert('פריט הופעל בהצלחה! ✨');
              } else {
                    // Item bought
                    setUserBalance(data.newBalance);
                    if(itemId === 'retry_pass') setHasRetryPass(true);
                    alert('רכישה בוצעה בהצלחה! 🛍️');
              }
              // Refresh full state
              fetchUserShopData(userId);
          } else {
              alert('שגיאה: ' + (data.error === 'Insufficient funds' ? 'אין מספיק כסף 😔' : data.error));
          }
      } catch (e) {
          alert('תקלה ברכישה.');
      } finally {
          setShopLoading(false);
      }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setAuthError(null);

    if (!authEmail || !authPassword) {
      setAuthError('נא למלא אימייל וסיסמה');
      return;
    }

    try {
      if (authMode === 'register') {
        const { data, error } = await supabaseBrowser.auth.signUp({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        const user = data.user;
        if (user) {
          window.currentUser = { id: user.id, email: user.email };
          setUserEmail(user.email ?? null);
          setUserId(user.id);
          setShowAuthModal(false); 
        }
      } else {
        const { data, error } = await supabaseBrowser.auth.signInWithPassword({
          email: authEmail,
          password: authPassword,
        });
        if (error) throw error;
        const user = data.user;
        if (user) {
          window.currentUser = { id: user.id, email: user.email };
          setUserEmail(user.email ?? null);
          setUserId(user.id);
          setShowAuthModal(false); 
          fetchUserShopData(user.id);
        }
      }
      setAuthEmail('');
      setAuthPassword('');
    } catch (err: any) {
      console.error('Auth error', err);
      setAuthError(err?.message ?? 'שגיאה בהתחברות');
    }
  }

  async function handleLogout() {
    await supabaseBrowser.auth.signOut();
    window.currentUser = undefined;
    setUserEmail(null);
    setUserId(null);
  }

  const handleCustomGameStart = () => {
      if (!storedApiKey) {
          alert('כדי לשחק במשחק מותאם אישית עליך להזין מפתח API בפרופיל האישי.');
          setShowAuthModal(true);
          return;
      }
      if (window.startCustomGame) {
          window.startCustomGame();
      }
  };

  return (
    <>
      <script src="https://unpkg.com/lucide@latest"></script>
      <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>
      <script src="/game.js"></script>

      <div id="audio-controller"></div>

      {/* --- Main Shop Modal --- */}
      <div className={`modal-overlay ${showMainShopModal ? 'active' : ''}`} style={{zIndex: 260}}>
        <div className="modal-content" style={{maxWidth: 450, borderColor: 'gold', height: '80vh'}}>
            <div className="modal-header" style={{background: 'linear-gradient(90deg, #3d3300, #1a1a2e)', color: 'gold'}}>
                <button className="modal-back-btn" style={{display: 'block', fontSize: '1.5rem'}} onClick={() => setShowMainShopModal(false)}>×</button>
                <span>🏪 חנות ראשית</span>
            </div>
            
            <div className="modal-body" style={{textAlign: 'center', display: 'flex', flexDirection: 'column', height: '100%'}}>
                <div style={{fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)', marginBottom: 10}}>₪{userBalance.toLocaleString()}</div>
                
                {/* Tabs */}
                <div style={{display:'flex', gap: 10, marginBottom: 15, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 10}}>
                    <button className="btn" style={{flex: 1, padding: 8, fontSize: '0.9rem', background: shopTab === 'items' ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}} onClick={() => setShopTab('items')}>פריטים</button>
                    <button className="btn" style={{flex: 1, padding: 8, fontSize: '0.9rem', background: shopTab === 'cosmetics' ? 'var(--primary)' : 'rgba(255,255,255,0.1)'}} onClick={() => setShopTab('cosmetics')}>עיצוב</button>
                </div>

                <div style={{overflowY: 'auto', flex: 1}}>
                    {shopTab === 'items' ? (
                        <div className="shop-grid">
                            <div className="shop-item" style={{flexDirection: 'column', alignItems: 'stretch', gap: 5, borderColor: 'gold', background: 'rgba(255,215,0,0.05)'}}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <div style={{textAlign:'right'}}>
                                        <div style={{fontWeight:'bold', color:'gold'}}>🎫 כרטיס קאמבק</div>
                                        <div style={{fontSize:'0.75rem', color:'#aaa'}}>ניסיון נוסף להיום</div>
                                    </div>
                                    <div style={{fontWeight:'bold'}}>₪5,000</div>
                                </div>
                                
                                {dailyAttempts >= 2 ? (
                                    <button className="btn" disabled style={{background: '#555', cursor: 'not-allowed', opacity: 0.7}}>
                                            🚫 השתמשת בכל הניסיונות להיום
                                    </button>
                                ) : hasRetryPass ? (
                                    <button className="btn" disabled style={{background: 'var(--success)', cursor: 'default', opacity: 1}}>
                                            ✅ יש לך כרטיס (פנוי לשימוש)
                                    </button>
                                ) : (
                                    <button 
                                        className="btn" 
                                        style={{background: 'gold', color: 'black'}}
                                        onClick={() => buyItem('retry_pass')}
                                        disabled={shopLoading || userBalance < 5000}
                                    >
                                        {shopLoading ? 'מבצע רכישה...' : (userBalance < 5000 ? 'חסר כסף' : 'קנה עכשיו')}
                                    </button>
                                )}
                            </div>

                            <div className="shop-item" style={{flexDirection: 'column', alignItems: 'stretch', gap: 5, borderColor: '#BF953F'}}>
                                <div style={{display:'flex', justifyContent:'space-between'}}>
                                    <div style={{textAlign:'right'}}>
                                        <div style={{fontWeight:'bold'}} className="golden-name">✨ שם הזהב (24 שעות)</div>
                                        <div style={{fontSize:'0.75rem', color:'#aaa'}}>השם שלך יזהר בטבלה</div>
                                    </div>
                                    <div style={{fontWeight:'bold'}}>₪5,000</div>
                                </div>
                                <button className="btn" disabled={isGolden} onClick={() => buyItem('golden_name')} style={{padding: '5px', fontSize:'0.9rem', background: isGolden ? 'var(--success)' : '#BF953F'}}>
                                    {isGolden ? 'פעיל' : 'קנה'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="shop-grid">
                            <div style={{textAlign:'right', fontSize:'0.9rem', color:'#888', marginTop: 10}}>ערכות נושא (Themes)</div>
                            {[
                                {id: 'theme_default', name: 'רגיל', price: 0, desc: 'העיצוב המקורי'},
                                {id: 'theme_matrix', name: 'מטריקס', price: 2500, desc: 'קוד ירוק על שחור'},
                                {id: 'theme_retro', name: 'רטרו ניאון', price: 2500, desc: 'אווירת שנות ה-80'},
                                {id: 'theme_gold', name: 'יוקרה', price: 2500, desc: 'שחור וזהב'}
                            ].map(item => {
                                const isOwned = inventory.includes(item.id) || item.id === 'theme_default';
                                const isActive = activeTheme === item.id || (activeTheme === 'default' && item.id === 'theme_default');
                                
                                return (
                                    <div key={item.id} className="shop-item" style={{flexDirection: 'column', alignItems: 'stretch', gap: 5}}>
                                        <div style={{display:'flex', justifyContent:'space-between'}}>
                                            <div style={{textAlign:'right'}}>
                                                <div style={{fontWeight:'bold'}}>{item.name}</div>
                                                <div style={{fontSize:'0.75rem', color:'#aaa'}}>{item.desc}</div>
                                            </div>
                                            <div style={{fontWeight:'bold'}}>{item.price === 0 ? 'חינם' : (isOwned ? 'בבעלות' : `₪${item.price}`)}</div>
                                        </div>
                                        <button className="btn" disabled={isActive} onClick={() => buyItem(item.id)} style={{padding: '5px', fontSize:'0.9rem', background: isActive ? '#555' : (isOwned ? 'var(--success)' : 'var(--primary)')}}>
                                            {isActive ? 'פעיל' : (isOwned ? 'הפעל' : 'קנה')}
                                        </button>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>

      {/* Auth & Profile Modal */}
      <div className={`modal-overlay ${showAuthModal ? 'active' : ''}`} style={{zIndex: 250}}>
        <div className="modal-content" style={{maxWidth: 400}}>
            <div className="modal-header">
                <button 
                    className="modal-back-btn" 
                    style={{display: 'block', fontSize: '1.5rem'}}
                    onClick={() => setShowAuthModal(false)}
                >
                    ×
                </button>
                <span>👤 פרופיל שחקן והגדרות</span>
            </div>
            <div className="modal-body" style={{textAlign: 'center'}}>
                
                {/* Login Section */}
                <div style={{marginBottom: 20, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 20}}>
                    {loadingUser ? (
                        <div>בודק חיבור...</div>
                    ) : userEmail ? (
                        <div style={{display:'flex', flexDirection:'column', gap: 10, alignItems:'center'}}>
                            <div style={{fontSize: '2rem'}}>🤠</div>
                            <div>
                                מחובר כ:<br/>
                                <strong>{userEmail}</strong>
                            </div>
                            <button className="btn btn-outline" onClick={handleLogout} style={{fontSize: '0.8rem', padding: '5px 15px'}}>
                                התנתק
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleAuthSubmit} style={{ textAlign: 'right' }}>
                            <div style={{textAlign:'center', marginBottom: 10, fontSize: '0.9rem', color: 'var(--text-muted)'}}>
                                התחברות לטבלת האלופים
                            </div>
                            <div className="auth-tabs" style={{display:'flex', marginBottom: 10}}>
                                <button type="button" style={{flex:1, padding: 5, background:'none', border:'none', color: authMode === 'login' ? 'var(--secondary)' : 'gray', borderBottom: authMode === 'login' ? '2px solid var(--secondary)' : 'none', cursor:'pointer'}} onClick={() => setAuthMode('login')}>התחברות</button>
                                <button type="button" style={{flex:1, padding: 5, background:'none', border:'none', color: authMode === 'register' ? 'var(--secondary)' : 'gray', borderBottom: authMode === 'register' ? '2px solid var(--secondary)' : 'none', cursor:'pointer'}} onClick={() => setAuthMode('register')}>הרשמה</button>
                            </div>
                            <input type="email" placeholder="אימייל" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} className="name-input" style={{ width: '100%', marginBottom: 5, padding: 8, fontSize: '0.9rem' }} />
                            <input type="password" placeholder="סיסמה" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="name-input" style={{ width: '100%', marginBottom: 10, padding: 8, fontSize: '0.9rem' }} />
                            {authError && <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: 5, textAlign:'center' }}>{authError}</div>}
                            <button type="submit" className="btn" style={{ width: '100%', padding: '8px 0', fontSize: '1rem' }}>{authMode === 'login' ? 'התחבר' : 'הירשם'}</button>
                        </form>
                    )}
                </div>

                {/* API Key Section */}
                <div style={{textAlign: 'right'}}>
                    <div style={{color: 'gold', fontWeight: 'bold', marginBottom: 5}}>🔑 מפתח אישי (למשחק מותאם אישית)</div>
                    <div style={{fontSize: '0.8rem', color: '#ccc', marginBottom: 10}}>
                        נדרש מפתח חינמי של Google Gemini כדי לשחק בנושאים משלך.<br/>
                        <a href="https://aistudio.google.com/api-keys" target="_blank" style={{color: 'var(--secondary)', textDecoration: 'underline'}}>השג מפתח כאן</a>
                    </div>

                    {storedApiKey ? (
                        <div style={{background: 'rgba(0,255,157,0.1)', padding: 10, borderRadius: 8, border: '1px solid var(--success)', textAlign: 'center'}}>
                            <div style={{color: 'var(--success)', fontWeight: 'bold'}}>✅ מפתח שמור</div>
                            <div style={{fontSize: '0.7rem', color: '#aaa', margin: '5px 0'}}>נשמר ב-LocalStorage של הדפדפן שלך בלבד.</div>
                            <button onClick={removeApiKey} style={{background: 'none', border: '1px solid var(--danger)', color: 'var(--danger)', padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: '0.8rem'}}>
                                הסר מפתח
                            </button>
                        </div>
                    ) : (
                        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                            <input 
                                type="text" 
                                placeholder="הדבק כאן את ה-API Key" 
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                className="name-input"
                                style={{
                                    width: '100%', 
                                    marginBottom: 0, 
                                    padding: '12px', 
                                    fontSize: '1rem', 
                                    textAlign: 'left', 
                                    direction: 'ltr' 
                                }}
                            />
                            <button onClick={saveApiKey} className="btn" style={{width: '100%', padding: '10px 0', margin: 0, fontSize: '1rem'}}>שמור</button>
                        </div>
                    )}
                </div>

            </div>
        </div>
      </div>

      {/* Leaderboard Modal */}
      <div id="leaderboard-modal" className="modal-overlay">
        <div className="modal-content">
          <div className="modal-header">
            <button
              className="modal-back-btn"
              id="modal-back-btn"
              onClick={() =>
                window.backToLeaderboard && window.backToLeaderboard()
              }
            >
              <i data-lucide="arrow-right" />
            </button>
            <span id="modal-title">🏆 היכל התהילה</span>
          </div>
          <div className="modal-body" id="modal-body-content" />
          <div className="modal-footer">
            <button
              className="btn"
              style={{ width: 'auto', padding: '10px 30px' }}
              onClick={() =>
                window.closeModal && window.closeModal('leaderboard-modal')
              }
            >
              סגור
            </button>
          </div>
        </div>
      </div>

      {/* Shop Modal */}
      <div id="shop-modal" className="modal-overlay">
        <div className="modal-content" style={{ borderColor: 'var(--shop)' }}>
          <div className="modal-header" style={{ color: 'var(--shop)' }}>🛒 חנות המשחק</div>
          <div className="modal-body">
            <div style={{textAlign: 'center', marginBottom: 15, color: 'var(--text-muted)'}}>המשחק <b>לא עוצר</b>! קנה מהר! ⏳</div>
            <div className="shop-grid">
              <button
                className="shop-item"
                onClick={(e) =>
                  window.buyItem && window.buyItem('time_small', e.currentTarget)
                }
              >
                <div className="shop-item-details">
                  <div className="shop-item-title">⏰ תוספת זמן קצרה</div>
                  <div className="shop-item-desc">+10 שניות</div>
                </div>
                <div className="shop-item-price" id="shop-price-time-small">
                  ₪500
                </div>
              </button>

              <button
                className="shop-item"
                onClick={(e) =>
                  window.buyItem && window.buyItem('time_big', e.currentTarget)
                }
              >
                <div className="shop-item-details">
                  <div className="shop-item-title">⏳ תוספת זמן גדולה</div>
                  <div className="shop-item-desc">+30 שניות</div>
                </div>
                <div className="shop-item-price" id="shop-price-time-big">
                  ₪1,200
                </div>
              </button>

              <button
                className="shop-item"
                onClick={(e) =>
                  window.buyItem &&
                  window.buyItem('lifelines', e.currentTarget)
                }
              >
                <div className="shop-item-details">
                  <div className="shop-item-title">❤️ מילוי עזרות</div>
                  <div className="shop-item-desc">מחזיר את כל העזרות</div>
                </div>
                <div className="shop-item-price" id="shop-price-lifelines">
                  ₪2,000
                </div>
              </button>
            </div>
          </div>
          <div className="modal-footer">
            <button
              className="btn btn-outline"
              onClick={() => window.closeShop && window.closeShop()}
            >
              חזור למשחק
            </button>
          </div>
        </div>
      </div>

      {/* Instructions Modal Component */}
      <InstructionsModal />

      {/* Main Menu */}
      <div id="menu-screen" className="screen active" style={{ overflowY: 'auto' }}>
        <div className="main-menu-container"> {/* מחלקה חדשה לסידור במובייל */}
            <div className="menu-top-bar" style={{justifyContent: 'flex-end', paddingLeft: 15}}>
                {/* New Shop Button */}
                <button 
                    className="btn-icon-small" 
                    onClick={() => setShowMainShopModal(true)}
                    style={{borderColor: 'gold', color: 'gold'}}
                >
                    <i data-lucide="shopping-bag" />
                </button>

                {/* Profile Button */}
                <button className="btn-icon-small" onClick={() => setShowAuthModal(true)} style={{borderColor: userEmail ? 'var(--success)' : 'rgba(255,255,255,0.3)'}}>
                    <i data-lucide={userEmail ? "user-check" : "user"} />{userEmail && <span className="status-dot"></span>}
                </button>
            </div>

            <div style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                <div className="game-title">מירוץ הידע</div>
                <div className="subtitle">הזמן הוא הכסף שלך. אל תבזבז אותו.</div>

                <input
                type="text"
                id="player-name-input"
                className="name-input"
                placeholder="הכנס את שמך..."
                maxLength={15}
                />
            </div>

            {/* --- DAILY CHALLENGE SECTION (UPDATED) --- */}
            <div className="daily-challenge-card">
                <div style={{color:'gold', fontWeight:'bold', marginBottom:'5px', fontSize:'1.1rem'}}>📅 האתגר היומי</div>
                
                {dailyStatus && dailyStatus.status !== 'complete' ? (
                    // --- מצב טעינה / בנייה ---
                    <div style={{marginBottom: '10px'}}>
                        <div style={{fontSize:'0.9rem', color:'#aaa', marginBottom:'5px'}}>
                            {dailyStatus.status === 'not_started' ? 'ממתין לתחילת יצירה...' : 'בונה את מאגר השאלות לחצות...'}
                        </div>
                        <div style={{width: '100%', height: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', overflow: 'hidden', position: 'relative'}}>
                            <div style={{width: `${(dailyStatus.progress / dailyStatus.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--primary), var(--secondary))', transition: 'width 0.5s ease-in-out'}} />
                        </div>
                        <div style={{fontSize:'0.8rem', color:'var(--text-muted)', marginTop:'5px', display:'flex', justifyContent:'space-between'}}>
                            <span>סטטוס: {dailyStatus.currentBatch ? `נגלה ${dailyStatus.currentBatch}/2` : 'ממתין'}</span>
                            <span>{dailyStatus.progress}/{dailyStatus.total} שאלות</span>
                        </div>
                    </div>
                ) : (
                    // --- מצב מוכן ---
                    <div style={{fontSize:'0.9rem', color:'#ddd', marginBottom:'10px'}}>
                        50 שאלות מאתגרות ב-2 נגלות. כולם מקבלים את אותו אתגר!
                    </div>
                )}

                <div style={{fontSize:'0.8rem', color:'var(--text-muted)', marginBottom:'10px'}}>
                    אתגר חדש בעוד: <span style={{fontFamily:'monospace', color:'var(--success)', fontWeight:'bold'}}>{timeToNextChallenge}</span>
                </div>
                
                <button 
                    className="btn" 
                    style={{
                        background: 'linear-gradient(135deg, #FFD700, #FF8C00)', 
                        color:'black', 
                        width:'100%', 
                        marginBottom:0,
                        opacity: dailyStatus?.status !== 'complete' ? 0.6 : 1,
                        cursor: dailyStatus?.status !== 'complete' ? 'not-allowed' : 'pointer'
                    }}
                    disabled={dailyStatus?.status !== 'complete'}
                    onClick={handleStartDaily}
                >
                    {dailyStatus?.status !== 'complete' ? (
                        <span><i data-lucide="loader" /> מכין שאלות...</span>
                    ) : (
                        <span><i data-lucide="star" /> שחק באתגר היומי</span>
                    )}
                </button>
            </div>

            {/* Custom topics Section */}
            <div className="custom-topics-container">
            
            <div className="input-group">
                <input
                type="text"
                id="custom-topic-input"
                className="name-input"
                placeholder="נושא מותאם אישית..."
                style={{
                    marginBottom: 0,
                    width: '70%',
                    borderRadius: '0 12px 12px 0',
                    textAlign: 'right',
                    paddingRight: 15,
                }}
                />
                <button
                className="btn"
                style={{
                    margin: 0,
                    width: '30%',
                    borderRadius: '12px 0 0 12px',
                    padding: 10,
                }}
                onClick={() => window.addCustomTopic && window.addCustomTopic()}
                >
                <i data-lucide="plus" /> הוסף
                </button>
            </div>
            <div id="custom-topics-list" className="topics-list" />
            
            <button
                className="btn"
                onClick={handleCustomGameStart}
                style={{marginTop: 5, width: '100%', justifyContent: 'center'}}
            >
                <i data-lucide="play" /> התחל משחק מותאם
            </button>
            </div>

            <div className="menu-bottom-buttons" style={{display:'flex', gap: 10, width: '90%', maxWidth: 500, marginTop: 10}}>
                <button
                className="btn btn-outline"
                style={{flex: 1}}
                onClick={() =>
                    window.openLeaderboard && window.openLeaderboard('daily')
                }
                >
                <i data-lucide="trophy" /> הישגים ושיאים
                </button>
                <button
                className="btn btn-outline"
                style={{flex: 1}}
                onClick={() =>
                    window.openInstructions && window.openInstructions()
                }
                >
                <i data-lucide="book-open" /> הוראות
                </button>
            </div>

            <div style={{ marginTop: 15, fontSize: '0.8rem', color: '#555', paddingBottom: '10px' }}>
                מופעל ע&quot;י Gemini AI
            </div>
        </div>
      </div>

      {/* Loading Screen */}
      <div id="loading-screen" className="screen">
        <div style={{width: '80%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px'}}>
            
            <div className="loading-icon" style={{fontSize: '3rem', animation: 'bounce 2s infinite'}}>
                🧠
            </div>

            <div className="loading-text" id="loading-msg" style={{minHeight: '1.5em'}}>
              מכין את המשחק...
            </div>

            {/* Progress Bar Container */}
            <div style={{
                width: '100%', 
                height: '24px', 
                background: 'rgba(255,255,255,0.1)', 
                borderRadius: '12px', 
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.2)',
                position: 'relative',
                boxShadow: '0 0 10px rgba(0,0,0,0.5) inset'
            }}>
                {/* The Filling Bar */}
                <div id="loading-bar-fill" style={{
                    width: '0%', 
                    height: '100%', 
                    background: 'linear-gradient(90deg, var(--primary), var(--secondary))', 
                    transition: 'width 0.5s ease-out',
                    borderRadius: '12px',
                    boxShadow: '0 0 10px var(--primary)'
                }}></div>
                
                {/* Percentage Text (Overlaid) */}
                <div id="loading-percentage-text" style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: '0.8rem',
                    fontWeight: 'bold',
                    color: '#fff',
                    textShadow: '0 1px 2px black'
                }}>
                    0%
                </div>
            </div>

            <div id="sources-list" />
            
            <div className="loading-tip" id="loading-tip" style={{marginTop: '20px', opacity: 0.7}}>
              טיפ: שאלות קשות נותנות פחות זמן אבל יותר כסף!
            </div>
        </div>
      </div>

      {/* Game Screen */}
      <div id="game-screen" className="screen">
        <div className="hud">
          <div className="stat-box" id="hud-time">
            <span className="stat-label">זמן</span>
            <span className="stat-value" id="time-display">
              120.0
            </span>
          </div>
          <div className="stat-box" id="hud-stage">
            <span className="stat-label">שלב</span>
            <span className="stat-value" id="stage-display">
              1
            </span>
          </div>
          <div className="stat-box" id="hud-money">
            <span className="stat-label">קופה</span>
            <span
              className="stat-value"
              style={{ color: 'var(--success)' }}
            >
              ₪<span id="score-display">0</span>
            </span>
          </div>
        </div>

        <div className="timer-container">
          <div className="timer-bar" id="timer-bar" />
        </div>
        <div className="progress-text" id="stage-progress">
          שאלה 1 מתוך 50
        </div>

        <div className="question-card">
          <div
            id="question-category"
            style={{
              position: 'absolute',
              top: -10,
              right: 20,
              background: 'var(--primary)',
              padding: '2px 10px',
              borderRadius: 10,
              fontSize: '0.8rem',
            }}
          >
            כללי
          </div>
          <div className="question-text" id="question-text">
            השאלה תופיע כאן...
          </div>
          <div className="options-grid" id="options-container" />
        </div>

        <div className="ai-thinking" id="ai-bubble">
          Gemini חושב...
        </div>

        <div className="bottom-controls">
          <div className="lifelines">
            <button
              className="lifeline-btn"
              id="btn-5050"
              title="50/50"
              onClick={() =>
                window.useLifeline && window.useLifeline('5050')
              }
            >
              <span className="lifeline-badge">1</span>
              <span style={{ fontWeight: 'bold' }}>50:50</span>
            </button>
            <button
              className="lifeline-btn"
              id="btn-ai"
              title="שאל את Gemini"
              onClick={() => window.useLifeline && window.useLifeline('ai')}
            >
              <span className="lifeline-badge">1</span>
              <i data-lucide="bot" />
            </button>
            <button
              className="lifeline-btn"
              id="btn-freeze"
              title="הקפאת זמן"
              onClick={() =>
                window.useLifeline && window.useLifeline('freeze')
              }
            >
              <span className="lifeline-badge">1</span>
              <i data-lucide="snowflake" />
            </button>
          </div>
          <button
            className="btn btn-shop"
            style={{
              width: 60,
              height: 60,
              borderRadius: '50%',
              padding: 0,
            }}
            onClick={() => window.openShop && window.openShop()}
          >
            <i data-lucide="shopping-cart" />
          </button>
        </div>
      </div>

      {/* Game Over Screen */}
      <div id="gameover-screen" className="screen">
        <h1
          style={{
            fontSize: '3rem',
            color: 'var(--danger)',
            margin: 0,
          }}
        >
          נגמר הזמן!
        </h1>
        <p className="subtitle" id="gameover-reason">
          השעון הגיע ל-0
        </p>

        <div
          style={{
            background: 'var(--bg-card)',
            padding: 21,
            borderRadius: 15,
            width: '100%',
            marginBottom: 20,
          }}
        >
          <div className="stat-row">
            <span>שחקן:</span>
            <span
              style={{
                color: 'var(--secondary)',
                fontWeight: 'bold',
              }}
              id="final-name"
            >
              אורח
            </span>
          </div>
          <div className="stat-row">
            <span>סכום סופי:</span>
            <span
              style={{
                color: 'var(--success)',
                fontWeight: 'bold',
              }}
              id="final-score"
            >
              ₪0
            </span>
          </div>
          <div className="stat-row">
            <span>שלב שהגעת:</span>
            <span id="final-stage">1</span>
          </div>
          <div className="stat-row">
            <span>שאלות נכונות:</span>
            <span id="final-correct">0</span>
          </div>
        </div>

        {/* --- Share Section Start --- */}
        <div style={{width: '100%', marginBottom: 20}}>
            <div style={{textAlign: 'center', marginBottom: 10, fontSize: '0.9rem', color: '#aaa'}}>שתף את התוצאה ואתגר חברים:</div>
            <div style={{display: 'flex', gap: 10, justifyContent: 'center'}}>
                <button 
                    className="btn" 
                    style={{flex: 1, background: '#25D366', padding: '10px', fontSize: '1rem', margin: 0}}
                    onClick={() => window.shareResult && window.shareResult('whatsapp')}
                >
                    <i data-lucide="message-circle" /> וואטסאפ
                </button>
                <button 
                    className="btn" 
                    style={{width: '50px', background: '#000', padding: '10px', fontSize: '1rem', margin: 0, border: '1px solid #333'}}
                    onClick={() => window.shareResult && window.shareResult('twitter')}
                >
                    <i data-lucide="twitter" />
                </button>
                 <button 
                    className="btn" 
                    style={{width: '50px', background: 'var(--primary)', padding: '10px', fontSize: '1rem', margin: 0}}
                    onClick={() => window.shareResult && window.shareResult('native')}
                >
                    <i data-lucide="share-2" />
                </button>
            </div>
        </div>
        {/* --- Share Section End --- */}

        <button
          className="btn"
          onClick={() => window.returnToMenu && window.returnToMenu()}
        >
          <i data-lucide="home" /> תפריט ראשי
        </button>
      </div>
    </>
  );
}