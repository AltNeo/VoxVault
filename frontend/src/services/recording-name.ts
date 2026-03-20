const TEAMS_SUFFIX_PATTERN = /\s*[-|:]\s*(new\s+)?microsoft teams\s*$/i;
const INVALID_FILENAME_CHARS_PATTERN = /[<>:"/\\|?*\u0000-\u001f]/g;
const TRAILING_DOTS_AND_SPACES_PATTERN = /[.\s]+$/g;
const LEADING_DOTS_AND_SPACES_PATTERN = /^[.\s]+/g;
const MAX_BASE_LENGTH = 120;

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sanitizeFilenameSegment(value: string): string {
  const sanitized = value
    .replace(INVALID_FILENAME_CHARS_PATTERN, ' ')
    .replace(LEADING_DOTS_AND_SPACES_PATTERN, '')
    .replace(TRAILING_DOTS_AND_SPACES_PATTERN, '');

  return normalizeWhitespace(sanitized);
}

export function deriveRecordingBaseName(windowTitle: string | null | undefined): string {
  const normalizedTitle = normalizeWhitespace(windowTitle ?? '');
  if (!normalizedTitle) {
    return 'recording';
  }

  const withoutTeamsSuffix = normalizeWhitespace(normalizedTitle.replace(TEAMS_SUFFIX_PATTERN, ''));
  const sanitizedTitle = sanitizeFilenameSegment(withoutTeamsSuffix || normalizedTitle);

  if (!sanitizedTitle) {
    return 'recording';
  }

  return sanitizedTitle.slice(0, MAX_BASE_LENGTH);
}
