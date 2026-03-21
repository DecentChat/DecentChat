export const TITLE_TOOLTIP_ATTRIBUTE_FILTER = ['title'] as const;

export function shouldHydrateTitleTooltipAttribute(attributeName: string | null | undefined): boolean {
  return attributeName === 'title';
}
