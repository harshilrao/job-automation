import CryptoJS from 'crypto-js';
import { config } from '../config/env';

/**
 * Encrypt sensitive data using AES-256
 * Uses the encryption key as a passphrase (CryptoJS derives key via PBKDF2)
 * Handles both strings and objects (stringifies objects)
 */
export function encrypt(data: string | object): string {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return CryptoJS.AES.encrypt(text, config.encryption.key).toString();
}

/**
 * Decrypt sensitive data
 * Returns parsed object if the decrypted text is valid JSON, otherwise returns string
 */
export function decrypt(encryptedText: string): string | object {
  const bytes = CryptoJS.AES.decrypt(encryptedText, config.encryption.key);
  const decrypted = bytes.toString(CryptoJS.enc.Utf8);
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}

/**
 * Generate a random string
 */
export function generateRandomString(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate slug from string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Deep clone object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Omit keys from object
 */
export function omit<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Omit<T, K> {
  const result = { ...obj };
  keys.forEach(key => delete result[key]);
  return result;
}

/**
 * Pick keys from object
 */
export function pick<T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: K[]
): Pick<T, K> {
  const result = {} as Pick<T, K>;
  keys.forEach(key => {
    if (key in obj) {
      result[key] = obj[key];
    }
  });
  return result;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    shouldRetry?: (error: any) => boolean;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    shouldRetry = () => true,
  } = options;

  let lastError: any;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !shouldRetry(error)) {
        throw error;
      }

      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Parse salary string to min/max numbers
 */
export function parseSalary(salaryStr: string): { min: number | null; max: number | null; currency: string } {
  const currencyMatch = salaryStr.match(/[$€£¥₹]/);
  const currency = currencyMatch ? currencyMatch[0] : '$';

  const numbers = salaryStr.match(/[\d,]+/g)?.map(n => parseInt(n.replace(/,/g, ''))) || [];

  if (numbers.length === 0) {
    return { min: null, max: null, currency };
  }

  if (numbers.length === 1) {
    return { min: numbers[0], max: numbers[0], currency };
  }

  return { min: numbers[0], max: numbers[1], currency };
}

/**
 * Calculate relative time string
 */
export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize HTML for safe display
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length - 3) + '...';
}

/**
 * Group array by key
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const groupKey = String(item[key]);
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

/**
 * Unique array by key
 */
export function uniqueBy<T>(array: T[], key: keyof T): T[] {
  const seen = new Set();
  return array.filter(item => {
    const k = item[key];
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

/**
 * Unique array by function
 */
export function uniqueByFn<T>(array: T[], fn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return array.filter(item => {
    const k = fn(item);
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}

/**
 * Normalize a URL for deduplication: strip tracking params, trailing slash, fragment.
 * Returns origin + pathname (best-effort canonical form).
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    u.searchParams.delete('utm_term');
    u.searchParams.delete('utm_content');
    u.searchParams.delete('ref');
    u.searchParams.delete('source');
    u.searchParams.delete('campaign');
    u.searchParams.set('sort', '');
    // Rebuild search without empty params
    const search = Array.from(u.searchParams.entries())
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    u.search = search ? `?${search}` : '';
    let pathname = u.pathname;
    if (pathname.endsWith('/') && pathname.length > 1) {
      pathname = pathname.slice(0, -1);
    }
    return `${u.origin}${pathname}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Normalize an employer/company name for deduplication: lowercase, strip legal
 * suffixes and punctuation, collapse whitespace.
 */
export function normalizeEmployerName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\b(inc|incorporated|corp|corporation|llc|ltd|limited|co|company|plc|gmbh|ag|sa|bv|oy|ab|spa|srl|kft|kd|pty|llp|lp|limited|partnership|holdings|group)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a canonical deduplication key for a job. Prefers a canonical URL when
 * available (most reliable), falling back to normalized employer + title.
 */
export function canonicalJobKey(employer: string, title: string, jobUrl?: string): string {
  if (jobUrl) {
    const canonical = normalizeUrl(jobUrl);
    if (canonical) return `url:${canonical}`;
  }
  return `name:${normalizeEmployerName(employer)}|title:${title.toLowerCase().trim()}`;
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}