// PII redaction tuned for PCMC civic complaints (English, Hinglish, Hindi, Marathi).
// Redacts data that identifies the citizen; keeps what officers and the NLP routing need:
// localities, pincodes, ward numbers, dates, durations, counts, complaint references and vehicle plates.

const toAsciiDigits = (text) => text.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966));

const NAME = Symbol('name');
const NAME_STOP_WORDS = 'hai|he|aahe|ahe|and|from|near|at|in|resident|living|staying|here|speaking';
const LATIN_NAME = `[A-Za-z][A-Za-z.'-]+(?:\\s+(?!(?:${NAME_STOP_WORDS})\\b)[A-Za-z][A-Za-z.'-]+){0,2}`;
const DEVANAGARI_NAME = '[\\u0900-\\u097F]+(?:\\s+(?!(?:है|आहे)(?![\\u0900-\\u097F]))[\\u0900-\\u097F]+)?';

// Order matters: longer and more specific identifiers run first so shorter rules cannot split them.
const REDACTION_RULES = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<EMAIL_ADDRESS>'],
  // Payment cards: 13–19 plain digits, or grouped 4-4-4-x / Amex 4-6-5.
  [/(?<![\d-])(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}|\d{4}([ -])\d{6}\2\d{5})(?![\d-])/g, '<CREDIT_CARD>'],
  // Aadhaar: 12 digits, usually written 4-4-4.
  [/(?<![\d-])\d{4}([ -]?)\d{4}\1\d{4}(?![\d-])/g, '<GOVERNMENT_ID>'],
  // PAN card: ABCDE1234F.
  [/\b[A-Z]{5}\d{4}[A-Z]\b/gi, '<GOVERNMENT_ID>'],
  // Indian mobile: optional +91 / 91 / 0 prefix, 10 digits starting 6–9, common 5-5 or 3-3-4 grouping.
  [/(?<![\d+])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '<PHONE_NUMBER>'],
  [/(?<![\d+])(?:(?:\+|00)?91[\s-]?|0)?[6-9]\d{2}[\s-]\d{3}[\s-]\d{4}(?!\d)/g, '<PHONE_NUMBER>'],
  // Landline with STD code, e.g. 020-2553 1234, (020) 25531234, +91 20 2553 1234.
  [/(?<![\d+])(?:(?:\+|00)?91[\s-]?|\(?0)\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g, '<PHONE_NUMBER>'],
  // Names introduced by a cue phrase. Only the name is replaced; the cue stays for readability.
  [new RegExp(`\\b(my name is|name\\s*[:-]|mera naam|mera nam|maza nav|majha nav|maze nav)\\s+(${LATIN_NAME})`, 'gi'), NAME],
  [new RegExp(`(मेरा नाम है|मेरा नाम|माझे नाव|माझं नाव|नाम\\s*[:-])\\s*(${DEVANAGARI_NAME})`, 'g'), NAME],
];

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Removes the submitter's own name and email wherever they appear, e.g. "Ramesh here, garbage not collected".
function redactKnownIdentity(text, { name, email } = {}) {
  let result = text;
  if (email) result = result.replace(new RegExp(escapeRegExp(email.trim()), 'gi'), '<EMAIL_ADDRESS>');
  const parts = (name || '').trim().split(/\s+/).filter((part) => part.length >= 3);
  if (parts.length) {
    const wholeWord = (pattern, flags) => new RegExp(`(?<!\\p{L})${pattern}(?!\\p{L})`, flags);
    result = result.replace(wholeWord(parts.map(escapeRegExp).join('\\s+'), 'giu'), '<PERSON>');
    // Single name words match as typed, Title-cased or lower-cased, but never ALL CAPS,
    // so "Rose" / "rose" are redacted while "ROSE GARDEN" or a "[TEST]" tag are kept.
    parts.forEach((part) => {
      const lower = part.toLowerCase();
      const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
      new Set([part, titled, lower]).forEach((variant) => {
        result = result.replace(wholeWord(escapeRegExp(variant), 'gu'), '<PERSON>');
      });
    });
  }
  return result;
}

// After a name cue the first word is always the name; later Latin words count only when capitalised,
// so "my name is ramesh garbage not collected" keeps "garbage not collected".
function redactName(cue, name) {
  const words = name.split(/\s+/);
  let taken = 1;
  while (taken < words.length && !/^[a-z]/.test(words[taken])) taken++;
  const rest = words.slice(taken).join(' ');
  return `${cue} <PERSON>${rest ? ` ${rest}` : ''}`;
}

function applyRules(text) {
  return REDACTION_RULES.reduce((sanitized, [pattern, replacement]) => sanitized.replace(pattern, (match, ...groups) => (
    replacement === NAME ? redactName(groups[0], groups[1]) : replacement
  )), text);
}

function sanitizePii(text, identity) {
  if (typeof text !== 'string' || !text) return text || '';
  return applyRules(redactKnownIdentity(toAsciiDigits(text), identity)).replace(/<PERSON>(\s+<PERSON>)+/g, '<PERSON>');
}

module.exports = { sanitizePii };
