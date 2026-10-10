import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});
window.scrollTo = vi.fn();
const stored = new Map<string, string>();
const testStorage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => stored.set(key, String(value)),
  removeItem: (key: string) => stored.delete(key),
  clear: () => stored.clear(),
  key: (i: number) => Array.from(stored.keys())[i] ?? null,
  get length() {
    return stored.size;
  },
};
Object.defineProperty(globalThis, 'localStorage', { value: testStorage, configurable: true });
