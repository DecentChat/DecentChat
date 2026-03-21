import { describe, expect, test } from 'bun:test';
import {
  TITLE_TOOLTIP_ATTRIBUTE_FILTER,
  shouldHydrateTitleTooltipAttribute,
} from '../../src/ui/titleTooltipObserver';

describe('title tooltip observer policy', () => {
  test('ignores live data-tooltip mutations to avoid document rescans on delivery updates', () => {
    expect(shouldHydrateTitleTooltipAttribute('data-tooltip')).toBe(false);
    expect(TITLE_TOOLTIP_ATTRIBUTE_FILTER.includes('data-tooltip' as never)).toBe(false);
  });

  test('still hydrates native title attributes into managed tooltips', () => {
    expect(shouldHydrateTitleTooltipAttribute('title')).toBe(true);
    expect(TITLE_TOOLTIP_ATTRIBUTE_FILTER).toEqual(['title']);
  });
});
