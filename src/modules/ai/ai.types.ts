// ── AI generation types ──────────────────────────────────────

export type GenerationType =
  | 'content_idea'
  | 'hook_creator'
  | 'bio_generator'
  | 'script_idea'
  | 'story_idea'
  | 'caption_idea';

export interface GenerateContentDto {
  type: GenerationType;
  niche?: string;
  topic?: string;
  tone?: string;
  platform_goal?: string;
  format?: string;
  audience?: string;
  // Legacy field
  prompt?: string;
}
