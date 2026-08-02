import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Testing Library checks the Jest global to coordinate async queries with fake timers.
Object.assign(globalThis, { jest: vi });
