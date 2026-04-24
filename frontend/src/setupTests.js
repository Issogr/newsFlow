import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

function createTestStorage() {
  const values = new Map();

  return {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key) => values.get(String(key)) ?? null),
    key: vi.fn((index) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key) => values.delete(String(key))),
    setItem: vi.fn((key, value) => values.set(String(key), String(value))),
  };
}

function ensureUsableLocalStorage() {
  const storage = globalThis.window?.localStorage;
  const isUsable = storage
    && typeof storage.clear === 'function'
    && typeof storage.getItem === 'function'
    && typeof storage.setItem === 'function'
    && typeof storage.removeItem === 'function';

  if (isUsable) {
    return;
  }

  Object.defineProperty(globalThis.window, 'localStorage', {
    configurable: true,
    value: createTestStorage(),
  });
}

ensureUsableLocalStorage();

afterEach(() => {
  cleanup();
});

globalThis.jest = vi;
