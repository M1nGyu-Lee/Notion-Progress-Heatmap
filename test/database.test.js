import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { processData } from '../api/database.js';

const page = (date, progress = 1) => ({
    created_time: '2026-09-04T01:00:00.000Z',
    properties: {
        Date: { type: 'date', date: date ? { start: date } : null },
        Progress: { type: 'number', number: progress }
    }
});

test('Date overrides creation date and other date properties', () => {
    const lesson = page('2026-07-24');
    lesson.properties = { 'Created date': { created_time: lesson.created_time }, ...lesson.properties };
    assert.deepEqual(processData([lesson]), [{ date: '2026-07-24', progress: 100 }]);
});

test('missing, invalid and archived dates never create fallback contributions', () => {
    assert.deepEqual(processData([
        page(null), page('invalid'), page('2026-02-30'),
        { ...page('2026-07-24'), archived: true },
        { ...page('2026-07-25'), in_trash: true },
        { created_time: '2026-09-04', properties: { 'Other date': { date: { start: '2026-07-26' } } } }
    ]), []);
});

test('timestamps use Seoul dates while date-only values remain unchanged', () => {
    assert.deepEqual(processData([page('2026-07-24T16:00:00Z'), page('2026-07-24')]), [
        { date: '2026-07-24', progress: 100 }, { date: '2026-07-25', progress: 100 }
    ]);
});

test('duplicates keep maximum progress; zero, missing and formula values work', () => {
    const formula = page('2026-07-25');
    formula.properties.Progress = { formula: { number: 0.5 } };
    assert.deepEqual(processData([
        page('2026-07-24'), page('2026-07-24', 0), formula,
        page('2026-07-26', 0), page('2026-07-27', null)
    ]), [
        { date: '2026-07-24', progress: 100 }, { date: '2026-07-25', progress: 50 },
        { date: '2026-07-26', progress: 0 }, { date: '2026-07-27', progress: 100 }
    ]);
});

test('handler scopes queries to configured DB, following pagination across sources', async (t) => {
    const oldToken = process.env.ENV_NOTION_TOKEN;
    const oldDatabase = process.env.ENV_DATABASE_ID;
    process.env.ENV_NOTION_TOKEN = 'test-token';
    process.env.ENV_DATABASE_ID = 'lesson-db';
    t.after(() => {
        if (oldToken === undefined) delete process.env.ENV_NOTION_TOKEN;
        else process.env.ENV_NOTION_TOKEN = oldToken;
        if (oldDatabase === undefined) delete process.env.ENV_DATABASE_ID;
        else process.env.ENV_DATABASE_ID = oldDatabase;
    });
    const responses = [
        { data_sources: [{ id: 'source-a' }, { id: 'source-b' }] },
        { results: Array.from({ length: 100 }, () => page('2026-07-24')), has_more: true, next_cursor: 'next-page' },
        { results: [page('2026-07-25')], has_more: false },
        { results: [page('2026-07-26')], has_more: false }
    ];
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => responses.shift() };
    });
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        setHeader() {},
        json(body) { this.body = body; return this; }
    };
    await handler({}, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, ['2026-07-24', '2026-07-25', '2026-07-26'].map(date => ({ date, progress: 100 })));
    assert.deepEqual(calls.map(call => call.url), [
        'https://api.notion.com/v1/databases/lesson-db',
        'https://api.notion.com/v1/data_sources/source-a/query',
        'https://api.notion.com/v1/data_sources/source-a/query',
        'https://api.notion.com/v1/data_sources/source-b/query'
    ]);
    assert.equal(calls[0].options.headers['Notion-Version'], '2025-09-03');
    assert.deepEqual(JSON.parse(calls[2].options.body), { page_size: 100, start_cursor: 'next-page' });
});
