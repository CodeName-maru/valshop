import { vi, beforeAll, afterAll, afterEach } from "vitest";
import "@testing-library/jest-dom";
import { setupServer } from "msw/node";
import { defaultRiotHandlers } from "./tests/critical-path/_msw/riot-handlers";
import { cleanup } from "@testing-library/react";

// MSW server setup for API mocking
export const mswServer = setupServer(...defaultRiotHandlers);

// Setup before all tests
beforeAll(() => {
  mswServer.listen({ onUnhandledRequest: "error" });
});

// Reset handlers after each test
afterEach(() => {
  mswServer.resetHandlers();
  cleanup();
});

// Cleanup after all tests
afterAll(() => {
  mswServer.close();
});

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
