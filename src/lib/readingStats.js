// Reading-streak and daily-minutes tracking, shared by App (stats UI) and
// NativeReader (session time logging). All state lives in localStorage.

export function recordReadingDay() {
  try {
    const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
    const today = new Date().toDateString();
    if (!days.includes(today)) {
      days.push(today);
      if (days.length > 365) days.shift();
      localStorage.setItem('archivum_reading_days', JSON.stringify(days));
    }
  } catch { /* storage unavailable */ }
}

export function getReadingStreak() {
  try {
    const days = JSON.parse(localStorage.getItem('archivum_reading_days') || '[]');
    const uniqueDays = new Set(days);
    if (uniqueDays.size === 0) return 0;
    // Count consecutive reading days ending today — or yesterday, since the
    // streak is still alive until a full day passes without reading. The old
    // version returned the TOTAL number of reading days whenever today was
    // unrecorded, which inflated the streak most of the time.
    let cursor = new Date();
    if (!uniqueDays.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);
    let streak = 0;
    for (let i = 0; i < 3650; i++) {
      if (uniqueDays.has(cursor.toDateString())) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
      } else break;
    }
    return streak;
  } catch { return 0; }
}

// Per-day reading minutes, e.g. { "Mon Nov 09 2026": 14 } — feeds the daily
// goal ring with REAL numbers instead of a lifetime-minutes guess.
export function addDailyMinutes(mins) {
  try {
    const log = JSON.parse(localStorage.getItem('archivum_daily_minutes') || '{}');
    const day = new Date().toDateString();
    log[day] = (log[day] || 0) + mins;
    // keep roughly a year of entries
    const keys = Object.keys(log);
    if (keys.length > 400) {
      keys.sort((a, b) => new Date(a) - new Date(b));
      keys.slice(0, keys.length - 400).forEach(k => delete log[k]);
    }
    localStorage.setItem('archivum_daily_minutes', JSON.stringify(log));
  } catch { /* storage unavailable */ }
}

export function getTodayMinutes() {
  try {
    const log = JSON.parse(localStorage.getItem('archivum_daily_minutes') || '{}');
    return log[new Date().toDateString()] || 0;
  } catch { return 0; }
}

// Reading sessions are often shorter than a minute — buffer milliseconds and
// flush whole minutes so short sessions are not silently dropped from the
// daily total.
export function addDailyMs(ms) {
  if (!ms || ms <= 0) return;
  try {
    const day = new Date().toDateString();
    const raw = JSON.parse(localStorage.getItem('archivum_ms_buffer') || 'null');
    const state = raw && raw.day === day ? raw : { day, ms: 0 };
    state.ms += ms;
    const whole = Math.floor(state.ms / 60000);
    if (whole > 0) {
      addDailyMinutes(whole);
      state.ms -= whole * 60000;
    }
    localStorage.setItem('archivum_ms_buffer', JSON.stringify(state));
  } catch { /* storage unavailable */ }
}
