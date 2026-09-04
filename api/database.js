const NOTION_VERSION = '2025-09-03';

export default async (req, res) => {
    const token = process.env.ENV_NOTION_TOKEN?.trim();
    const databaseId = process.env.ENV_DATABASE_ID?.trim();
    if (!token || !databaseId) {
        return res.status(500).json({ error: 'Missing ENV_NOTION_TOKEN or ENV_DATABASE_ID' });
    }
    try {
        const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
        const notion = async (path, body) => {
            const response = await fetchFn(`https://api.notion.com/v1/${path}`, {
                method: body ? 'POST' : 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json'
                },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            const data = await response.json();
            if (!response.ok) {
                const error = new Error(data.message || `Notion API Error (${response.status})`);
                error.status = response.status;
                throw error;
            }
            return data;
        };
        // Workspace search includes unrelated pages; query only the configured DB.
        const database = await notion(`databases/${encodeURIComponent(databaseId)}`);
        if (!database.data_sources?.length) {
            throw new Error('No data sources found. ENV_DATABASE_ID must identify the original Notion database.');
        }
        const results = [];
        for (const source of database.data_sources) {
            let cursor;
            do {
                const data = await notion(`data_sources/${encodeURIComponent(source.id)}/query`, {
                    page_size: 100,
                    ...(cursor ? { start_cursor: cursor } : {})
                });
                results.push(...(data.results || []));
                if (data.has_more && (!data.next_cursor || data.next_cursor === cursor)) {
                    throw new Error('Notion returned an invalid pagination cursor.');
                }
                cursor = data.has_more ? data.next_cursor : null;
            } while (cursor);
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.json(processData(results));
    } catch (error) {
        return res.status(error.status || 500).json({ error: error.message });
    }
};

export const processData = (results) => {
    const progressMap = new Map();
    const koreanDate = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
    });
    for (const item of results) {
        if (!item || item.archived || item.in_trash) continue;
        // Date is authoritative. Missing Date must never use created_time.
        const start = item.properties?.Date?.date?.start;
        if (typeof start !== 'string') continue;
        const parsed = new Date(start);
        if (!Number.isFinite(parsed.getTime())) continue;
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(start);
        if (dateOnly && parsed.toISOString().slice(0, 10) !== start) continue;
        const date = dateOnly ? start : koreanDate.format(parsed);
        const properties = item.properties;
        const progressProperty = properties.Progress || Object.entries(properties)
            .find(([key]) => key.toLowerCase().includes('progress') || key.includes('진행'))?.[1];
        const value = progressProperty?.number ?? progressProperty?.formula?.number ?? 100;
        const progress = Number.isFinite(value)
            ? Math.max(0, Math.min(100, Math.round(value <= 1 ? value * 100 : value)))
            : 100;
        progressMap.set(date, Math.max(progressMap.get(date) ?? 0, progress));
    }
    return [...progressMap].sort(([a], [b]) => a.localeCompare(b))
        .map(([date, progress]) => ({ date, progress }));
};
