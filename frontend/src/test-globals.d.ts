// Makes Vitest's global APIs (describe/it/expect/vi/...) available to the
// TypeScript program without switching every test to explicit imports. The
// jest-dom matcher augmentation is pulled in by src/setupTests.ts.
/// <reference types="vitest/globals" />
