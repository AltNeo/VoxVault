import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const IGNORE_LIST_FILE_NAME = 'teams-record-ignorelist.json';

function normalizeTitle(title: string): string {
  return title.trim();
}

export function createTeamsIgnoreList() {
  const filePath = path.join(app.getAppPath(), 'electron', IGNORE_LIST_FILE_NAME);

  const ensureIgnoreListFile = (): void => {
    if (!existsSync(filePath)) {
      writeFileSync(filePath, '[]\n', 'utf8');
    }
  };

  const readIgnoreList = (): string[] => {
    ensureIgnoreListFile();

    try {
      const raw = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter((entry): entry is string => typeof entry === 'string').map(normalizeTitle);
    } catch {
      return [];
    }
  };

  const writeIgnoreList = (titles: string[]): void => {
    writeFileSync(filePath, JSON.stringify(titles, null, 2), 'utf8');
  };

  const getIgnoreList = (): string[] => {
    return readIgnoreList();
  };

  const addToIgnoreList = (title: string): string[] => {
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) {
      return readIgnoreList();
    }

    const currentList = readIgnoreList();
    if (currentList.includes(normalizedTitle)) {
      return currentList;
    }

    const updatedList = [...currentList, normalizedTitle];
    writeIgnoreList(updatedList);
    return updatedList;
  };

  return {
    getIgnoreList,
    addToIgnoreList,
  };
}
