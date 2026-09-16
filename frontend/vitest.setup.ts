import '@testing-library/jest-dom/vitest';

const getComputedStyleWithoutPseudo = window.getComputedStyle.bind(window);

Object.defineProperty(window, 'getComputedStyle', {
  configurable: true,
  value: (element: Element) => getComputedStyleWithoutPseudo(element),
});
