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

test('combined lessons include each day of Date range and merge overlaps', () => {
    const combined = page('2026-08-12', 0.5);
    combined.properties.Date.date.end = '2026-08-14';
    assert.deepEqual(processData([combined, page('2026-08-13')]), [
        { date: '2026-08-12', progress: 50 },
        { date: '2026-08-13', progress: 100 },
        { date: '2026-08-14', progress: 50 }
    ]);
});

test('range endpoints use Seoul dates and cross month boundaries', () => {
    const combined = page('2026-08-30T16:00:00Z');
    combined.properties.Date.date.end = '2026-09-01T16:00:00Z';
    assert.deepEqual(processData([combined]), [
        { date: '2026-08-31', progress: 100 },
        { date: '2026-09-01', progress: 100 },
        { date: '2026-09-02', progress: 100 }
    ]);
});

test('invalid or reversed range ends keep only the valid start', () => {
    for (const end of [null, 'invalid', '2026-02-30', '2026-08-11', '2026-08-12']) {
        const combined = page('2026-08-12');
        combined.properties.Date.date.end = end;
        assert.deepEqual(processData([combined]), [{ date: '2026-08-12', progress: 100 }]);
    }
});

const titledPage = (title, date, progress) => {
    const item = page(date, progress);
    item.properties['제목'] = { type: 'title', title: [{ plain_text: title }] };
    return item;
};

test('DAY 33~45 paints exactly thirteen weekdays from the first lesson date', () => {
    const result = processData([titledPage('[DAY 33~45] AWS', '2026-11-05')]);
    assert.deepEqual(result.map(item => item.date), [
        '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11',
        '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18',
        '2026-11-19', '2026-11-20', '2026-11-23'
    ]);
    assert.ok(result.every(item => item.progress === 100));
});

test('DAY range accepts spacing, rich-text fragments, fullwidth and dash variants', () => {
    for (const title of ['[DAY33~45]', 'DAY 33 ~ DAY 45', '[day33–45]', '[DAY 33～45]', '[ＤＡＹ ３３〜４５]', '[DAY33-45]']) {
        const item = titledPage(title, '2026-11-05', 0.5);
        const middle = Math.floor(title.length / 2);
        item.properties['제목'].title = [
            { text: { content: title.slice(0, middle) } },
            { plain_text: title.slice(middle) }
        ];
        const result = processData([item]);
        assert.equal(result.length, 13, title);
        assert.equal(result.at(-1).date, '2026-11-23', title);
        assert.ok(result.every(row => row.progress === 50));
    }
});

test('range uses Seoul start date, skips weekend starts, and takes precedence over Date.end', () => {
    const item = titledPage('[DAY 1~3]', '2026-10-30T16:00:00Z'); // Saturday in Seoul
    item.properties.Date.date.end = '2026-12-31';
    assert.deepEqual(processData([item]).map(row => row.date), ['2026-11-02', '2026-11-03', '2026-11-04']);
});

test('DAY range crosses year boundary, counts weekday holidays, and merges overlaps', () => {
    assert.deepEqual(processData([
        titledPage('[DAY 8~10]', '2026-12-31', 0.5),
        titledPage('[DAY 9]', '2027-01-01', 1)
    ]), [
        { date: '2026-12-31', progress: 50 },
        { date: '2027-01-01', progress: 100 },
        { date: '2027-01-04', progress: 50 }
    ]);
});

test('invalid ranges, missing dates, and unrelated numbers do not invent days', () => {
    for (const title of ['[DAY 45~33]', '[DAY 0~3]', '[DAY 33]', '프로젝트 33~45', '[DAY 1~10000]']) {
        assert.deepEqual(processData([titledPage(title, '2026-11-05')]), [{ date: '2026-11-05', progress: 100 }]);
    }
    assert.deepEqual(processData([titledPage('[DAY 33~45]', null)]), []);
    assert.deepEqual(processData([{ ...titledPage('[DAY 33~45]', '2026-11-05'), archived: true }]), []);
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
