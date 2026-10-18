export type SummarySectionKind = 'brief' | 'actions' | 'decisions' | 'topics' | 'other';

export interface SummarySection {
  title: string;
  kind: SummarySectionKind;
  body: string;
}

const MAX_HEADING_LENGTH = 48;

const KIND_PATTERNS: Array<[SummarySectionKind, RegExp]> = [
  ['brief', /\b(brief|overview|summary|tl;?dr|in short)\b/i],
  ['actions', /\b(action|next step|follow[- ]?up|to[- ]?do|task)/i],
  ['decisions', /\b(decision|decided|agreed|outcome)/i],
  ['topics', /\b(topic|discussed|agenda|theme|key point|highlight)/i],
];

function classify(title: string): SummarySectionKind {
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (pattern.test(title)) {
      return kind;
    }
  }
  return 'other';
}

function cleanHeading(raw: string): string {
  return raw
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*(.+?)\*\*:?$/, '$1')
    .replace(/^__(.+?)__:?$/, '$1')
    .replace(/[:：]\s*$/, '')
    .trim();
}

// Recognises a heading line in any of the shapes the summary providers produce:
// "## Action Items", "**Action Items**", "**Action Items:**", "Action Items:" and
// "Action Items: inline content". Returns the heading and any inline content.
function parseHeading(line: string): { title: string; rest: string } | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const markdownHeading = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (markdownHeading) {
    return { title: cleanHeading(markdownHeading[1]), rest: '' };
  }

  const boldHeading = trimmed.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*(.*)$/);
  if (boldHeading && boldHeading[1].length <= MAX_HEADING_LENGTH) {
    const title = cleanHeading(boldHeading[1]);
    const rest = boldHeading[2].trim();
    // A bold line on its own is a heading. With text after it ("**Marco**: owns the
    // spike") it is only a heading when it names a known section.
    if (!rest || classify(title) !== 'other') {
      return { title, rest };
    }
  }

  const labelHeading = trimmed.match(/^([A-Za-z][A-Za-z0-9 &/()'-]{1,46}):\s*(.*)$/);
  if (labelHeading && classify(labelHeading[1]) !== 'other') {
    return { title: labelHeading[1].trim(), rest: labelHeading[2].trim() };
  }
  if (labelHeading && !labelHeading[2]) {
    return { title: labelHeading[1].trim(), rest: '' };
  }

  return null;
}

/**
 * Splits a free-form summary into titled sections so it can be shown as cards.
 * Summaries come from the local model, the extractive fallback or a custom prompt,
 * so the shape varies; when fewer than two sections are found the whole text is
 * returned as a single section and nothing is lost.
 */
export function splitSummarySections(summary: string): SummarySection[] {
  const text = summary.replace(/\r\n/g, '\n').trim();
  if (!text) {
    return [];
  }

  const sections: Array<{ title: string; lines: string[] }> = [];
  const preamble: string[] = [];

  for (const line of text.split('\n')) {
    const heading = parseHeading(line);
    if (heading && heading.title) {
      sections.push({ title: heading.title, lines: heading.rest ? [heading.rest] : [] });
      continue;
    }
    if (sections.length === 0) {
      preamble.push(line);
    } else {
      sections[sections.length - 1].lines.push(line);
    }
  }

  const built = sections
    .map((section) => ({
      title: section.title,
      kind: classify(section.title),
      body: section.lines.join('\n').trim(),
    }))
    .filter((section) => section.body.length > 0);

  const preambleText = preamble.join('\n').trim();
  if (built.length < 2) {
    return [{ title: 'Summary', kind: 'brief', body: text }];
  }
  if (preambleText) {
    built.unshift({ title: 'Summary', kind: 'brief', body: preambleText });
  }

  // Lead with the short overview, then actions, decisions, topics and the rest.
  const order: SummarySectionKind[] = ['brief', 'actions', 'decisions', 'topics', 'other'];
  return built
    .map((section, index) => ({ section, index }))
    .sort(
      (a, b) =>
        order.indexOf(a.section.kind) - order.indexOf(b.section.kind) || a.index - b.index
    )
    .map(({ section }) => section);
}
