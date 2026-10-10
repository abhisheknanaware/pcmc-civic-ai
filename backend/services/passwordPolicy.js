// Officer passwords: at least 10 characters with letters and numbers, not based on the email or common words.
const COMMON = ['password', 'pcmc', 'admin', '12345', 'qwerty', 'welcome', 'officer'];

function passwordProblem(password, email = '') {
  const p = String(password || '');
  if (p.length < 10) return 'Password must be at least 10 characters long.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain both letters and numbers.';
  const lower = p.toLowerCase();
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Password must not contain your email name.';
  if (COMMON.some((w) => lower.includes(w))) return 'Password is too easy to guess. Avoid words like "password", "admin" or "pcmc".';
  return null;
}

module.exports = { passwordProblem };
