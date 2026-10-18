import { describe, expect, it } from 'vitest';
import { splitSummarySections } from '../services/summary-sections';

describe('splitSummarySections', () => {
  it('splits the extractive fallback format', () => {
    const sections = splitSummarySections(
      [
        'Key Topics:',
        '- Packaging',
        '',
        'Decisions Made:',
        '- Ship next sprint',
        '',
        'Action Items:',
        '- Marco runs the spike',
        '',
        'Brief Summary:',
        'The team agreed to package the backend.',
      ].join('\n')
    );

    expect(sections.map((section) => [section.kind, section.title])).toEqual([
      ['brief', 'Brief Summary'],
      ['actions', 'Action Items'],
      ['decisions', 'Decisions Made'],
      ['topics', 'Key Topics'],
    ]);
    expect(sections[1].body).toBe('- Marco runs the spike');
  });

  it('splits markdown headings and bold headings from the local model', () => {
    const sections = splitSummarySections(
      [
        '## Brief Summary',
        'Short recap.',
        '',
        '**Action Items:**',
        '- **Priya**: share timings',
        '',
        '**Decisions Made**',
        '- Keep chunking',
      ].join('\n')
    );

    expect(sections.map((section) => section.title)).toEqual([
      'Brief Summary',
      'Action Items',
      'Decisions Made',
    ]);
    expect(sections[1].body).toContain('**Priya**: share timings');
  });

  it('handles inline labels such as the mock summary', () => {
    const sections = splitSummarySections(
      'Key Topics: roadmap\nDecisions Made: none\nAction Items: review\nBrief Summary: recap'
    );
    expect(sections[0]).toEqual({ title: 'Brief Summary', kind: 'brief', body: 'recap' });
    expect(sections).toHaveLength(4);
  });

  it('keeps free-form summaries whole when there are no sections', () => {
    const text = 'The team met to discuss packaging.\n\nEveryone agreed it matters.';
    expect(splitSummarySections(text)).toEqual([{ title: 'Summary', kind: 'brief', body: text }]);
  });

  it('returns nothing for an empty summary', () => {
    expect(splitSummarySections('   ')).toEqual([]);
  });
});
