/**
 * Predefined niche *suggestions* offered to influencers during onboarding.
 *
 * IMPORTANT: This is a suggestions list ONLY. It is NOT an `@IsIn` allow-list.
 * Niche is a mandatory free-text field validated purely as a non-empty string
 * (`@IsString() @IsNotEmpty()`), so influencers may submit any custom value that
 * is not in this list. These values exist solely to populate the client-side
 * autocomplete; the server never rejects a niche for being absent from this set.
 */
export const NICHE_VALUES = [
  'Fashion',
  'Fitness',
  'Tech',
  'Beauty',
  'Travel',
  'Food',
  'Lifestyle',
  'Health',
  'Education',
  'Entertainment',
  'Other',
] as const;

export type NicheSuggestion = (typeof NICHE_VALUES)[number];
