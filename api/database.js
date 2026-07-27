export default async (req, res) => {
    const token = process.env.ENV_NOTION_TOKEN;
    const databaseId = process.env.ENV_DATABASE_ID;
    if (!token || !databaseId) {
        return res.status(500).json({ error: "Missing ENV_NOTION_TOKEN or ENV_DATABASE_ID" });
    }
    try {
        const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
        
        // Notion Search API를 사용하여 다중 소스 데이터베이스 호환 처리
        const response = await fetchFn(`https://api.notion.com/v1/search`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.trim()}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filter: { value: 'page', property: 'object' },
                sort: { direction: 'descending', timestamp: 'last_edited_time' }
            })
        });
        
        const data = await response.json();
        if (!response.ok) {
            return res.status(response.status).json({ 
                error: `Notion API Error (${response.status})`, 
                message: data.message || data 
            });
        }
        const processedData = processData(data.results || []);
        res.json(processedData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
const processData = (results) => {
    const progressMap = new Map();
    results.forEach(item => {
        if (!item || !item.properties) return;
        let dateStr = null;
        let numVal = 100;
        for (const [key, prop] of Object.entries(item.properties)) {
            if (key.toLowerCase().includes('date') || key.includes('일시') || key.includes('날짜')) {
                if (prop.date && prop.date.start) {
                    dateStr = prop.date.start;
                    break;
                } else if (prop.created_time) {
                    dateStr = prop.created_time.split('T')[0];
                    break;
                }
            }
        }
        if (!dateStr && item.created_time) {
            dateStr = item.created_time.split('T')[0];
        }
        for (const [key, prop] of Object.entries(item.properties)) {
            if (key.toLowerCase().includes('progress') || key.includes('진행')) {
                if (prop.number !== undefined && prop.number !== null) {
                    numVal = prop.number;
                    break;
                } else if (prop.formula && prop.formula.number !== null && prop.formula.number !== undefined) {
                    numVal = prop.formula.number;
                    break;
                }
            }
        }
        if (dateStr) {
            const progress = numVal <= 1 ? Math.round(numVal * 100) : Math.round(numVal);
            progressMap.set(dateStr, progress);
        }
    });
    return Array.from(progressMap).map(([date, progress]) => ({ date, progress }));
};
