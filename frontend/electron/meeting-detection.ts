const TEAMS_BRAND_PATTERNS = [/\bmicrosoft teams\b/i, /\bnew microsoft teams\b/i, /\bteams\b/i];
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
  /^\s*(calendar\s*[|:-]\s*calendar)\s*$/i,
  /\bnotifications?\b/i,
  /\bsettings\b/i,
] as const;

function normalizeWindowTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ');
}

function removeTeamsSuffix(title: string): string {
  return normalizeWindowTitle(title.replace(TEAMS_SUFFIX_PATTERN, ''));
}

function isLikelyTeamsDirectCallLabel(label: string): boolean {
  if (!label || NON_CALL_PATTERNS.some((pattern) => pattern.test(label))) {
    return false;
  }

  const normalizedLabel = normalizeWindowTitle(label);
  if (normalizedLabel.length < 3) {
    return false;
  }

  // 1:1 and small-group Teams call windows often expose only the participant label.
  return /[A-Za-z0-9]/.test(normalizedLabel);
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

  if (NON_CALL_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return false;
  }

  if (ACTIVE_CALL_PATTERNS.some((pattern) => pattern.test(normalizedTitle))) {
    return true;
  }

  const strippedTitle = removeTeamsSuffix(normalizedTitle);
  return isLikelyTeamsDirectCallLabel(strippedTitle);
}
