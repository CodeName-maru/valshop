import { vi } from "vitest";
import "@testing-library/jest-dom";

// localStorage mock for jsdom environment
Object.defineProperty(window, "localStorage", {
  value: {
    store: {} as Record<string, string>,
    getItem(key: string) {
      return this.store[key] || null;
    },
    setItem(key: string, value: string) {
      this.store[key] = value;
    },
    removeItem(key: string) {
      delete this.store[key];
    },
    clear() {
      this.store = {};
    },
    get length() {
      return Object.keys(this.store).length;
    },
    key(index: number) {
      return Object.keys(this.store)[index] || null;
    },
  },
  writable: true,
});

// document.cookie mock
Object.defineProperty(document, "cookie", {
  writable: true,
  value: "",
});
