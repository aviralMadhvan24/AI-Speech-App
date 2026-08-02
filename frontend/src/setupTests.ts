// Global test setup: registers jest-dom matchers for Vitest's `expect` and
// unmounts any mounted React trees between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
