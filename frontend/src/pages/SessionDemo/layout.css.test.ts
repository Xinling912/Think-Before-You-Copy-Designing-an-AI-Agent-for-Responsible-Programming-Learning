import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(resolve(process.cwd(), 'src/global.css'), 'utf8');

test('keeps the student conversation shell within the viewport and gives the session list its own hidden scrollbar', () => {
  expect(stylesheet).toMatch(
    /\.student-session-shell\s*\{[\s\S]*?flex:\s*1\s+1\s+0;[\s\S]*?min-height:\s*0;[\s\S]*?\}/,
  );
  expect(stylesheet).toMatch(
    /\.student-session-sidebar\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;[\s\S]*?\}/,
  );
  expect(stylesheet).toMatch(
    /\.session-list\s*\{[\s\S]*?flex:\s*1\s+1\s+0;[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;[\s\S]*?scrollbar-width:\s*none;[\s\S]*?\}/,
  );
  expect(stylesheet).toMatch(
    /\.student-session-page\s+\.session-chat-panel\s*\{[\s\S]*?height:\s*100%;[\s\S]*?min-height:\s*0;[\s\S]*?\}/,
  );
});

test('reserves seven 70px session rows before the conversation list scrolls', () => {
  expect(stylesheet).toMatch(
    /\.session-list\s*\{[\s\S]*?--session-visible-rows:\s*7;[\s\S]*?grid-template-rows:\s*repeat\(var\(--session-visible-rows\),\s*70px\);[\s\S]*?grid-auto-rows:\s*70px;[\s\S]*?\}/,
  );
});
