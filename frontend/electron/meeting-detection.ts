const TEAMS_BRAND_PATTERNS = [/\bmicrosoft teams\b/i, /\bnew microsoft teams\b/i];
const TEAMS_SUFFIX_PATTERN = /\s*[-|:]\s*(new\s+)?microsoft teams\s*$/i;

const ACTIVE_CALL_PATTERNS = [
  /\bmeeting\b/i,
  /\bcall\b/i,
  /\bcalling\b/i,
  /\bmeet now\b/i,
  /\blive event\b/i,
  /\btown hall\b/i,
  /\bwebinar\b/i,
  /\bbreakout room\b/i,
  /\bscreen sharing\b/i,
  /\bsharing\b/i,
  /\bpresenting\b/i,
  /\bpresentation\b/i,
] as const;

const NON_CALL_PATTERNS = [
  /^\s*(activity|chat|calendar|calls|files|teams|updates|apps|settings)\s*$/i,
  /^\s*(activity|chat|calendar|calls|files|teams|updates|apps|settings)\s*[|:-]/i,
  /^\s*(calendar\s*[|:-]\s*calendar)\s*$/i,
  /^\s*chat\b/i,
  /^\s*files\b/i,
  /^\s*activity\b/i,
  /^\s*calls?\b/i,
  /^\s*teams?\b/i,
  /^\s*updates?\b/i,
  /^\s*apps?\b/i,
  /\bnotifications?\b/i,
  /\bsettings\b/i,
] as const;

const NON_CALL_LABEL_TOKENS = new Set([
  'activity',
  'chat',
  'calendar',
  'calls',
  'files',
  'teams',
  'updates',
  'apps',
  'settings',
  'channel',
  'general',
  'posts',
  'wiki',
  'approvals',
  'tasks',
  'planner',
  'onedrive',
  'sharepoint',
  'sync',
  'discussion',
  'roadmap',
  'announcement',
]);

function normalizeWindowTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function removeTeamsSuffix(title: string): string {
  return normalizeWindowTitle(title.replace(TEAMS_SUFFIX_PATTERN, ''));
}

function tokenizeTitle(label: string): string[] {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9,\s'.-]/g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
}

function isLikelyTeamsDirectCallLabel(label: string): boolean {
  const normalizedLabel = normalizeWindowTitle(label);
  if (!normalizedLabel || NON_CALL_PATTERNS.some((pattern) => pattern.test(normalizedLabel))) {
    return false;
  }

  if (normalizedLabel.length < 3) {
    return false;
  }

  // Reject multi-pane/channel titles. Direct call labels are simple names.
  if (/[|/\\]/.test(normalizedLabel)) {
    return false;
  }

  const tokens = tokenizeTitle(normalizedLabel);
  if (tokens.length < 1 || tokens.length > 4) {
    return false;
  }

  if (tokens.some((token) => NON_CALL_LABEL_TOKENS.has(token))) {
    return false;
  }

  if (!tokens.every((token) => /^[a-z0-9][a-z0-9'.-]*$/i.test(token))) {
    return false;
  }

  // 1:1 and small-group Teams call windows often expose participant names.
  return normalizedLabel.includes(',') || tokens.length >= 2;
}

export function isLikelyTeamsCallWindow(title: string): boolean {
  const normalizedTitle = normalizeWindowTitle(title);
  if (!normalizedTitle) {
    return false;
  }

  const isTeamsWindow = TEAMS_BRAND_PATTERNS.some((pattern) => pattern.test(normalizedTitle));
  if (!isTeamsWindow) {
    return false;
  }

  const strippedTitle = removeTeamsSuffix(normalizedTitle);

  if (
    NON_CALL_PATTERNS.some((pattern) => pattern.test(normalizedTitle)) ||
    NON_CALL_PATTERNS.some((pattern) => pattern.test(strippedTitle))
  ) {
    return false;
  }

  if (ACTIVE_CALL_PATTERNS.some((pattern) => pattern.test(strippedTitle))) {
    return true;
  }

  return isLikelyTeamsDirectCallLabel(strippedTitle);
}
