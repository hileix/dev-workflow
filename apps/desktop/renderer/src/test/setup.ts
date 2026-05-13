import "@testing-library/jest-dom/vitest";

window.ResizeObserver = window.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
