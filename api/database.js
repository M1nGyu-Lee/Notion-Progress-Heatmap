export default async (req, res) => {
    const token = process.env.ENV_NOTION_TOKEN;
    const databaseId = process.env.ENV_DATABASE_ID;
    // 1. 환경 변수 체크
    if (!token || !databaseId) {
        return res.status(500).json({ 
            error: "Vercel 환경 변수가 없습니다. ENV_NOTION_TOKEN 및 ENV_DATABASE_ID를 확인하세요." 
        });
    }
    try {
        const fetchFn = globalThis.fetch || (await import('node-fetch')).default;
        const response = await fetchFn(`https://api.notion.com/v1/databases/${databaseId.trim()}/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token.trim()}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
        });
        const data = await response.json();
        // 2. Notion API 반환 에러 시 원인 메시지 출력
        if (!response.ok) {
            return res.status(response.status).json({ 
                error: `Notion API Error (${response.status})`, 
                message: data.message || data 
            });
        }
        const processedData = processData(data.results || []);
        res.json(processedData);
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: error.message });
    }
};
const processData = (results) => {
    const progressMap = new Map();
    results.forEach(item => {
        if (!item || !item.properties) return;
        let dateStr = null;
        let numVal = 100; // 기본값 100%
        // A. 날짜(Date) 속성 자동 탐색 (Date, 날짜, 생성 일시 등 모두 호환)
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
        // 만약 속성에서 날짜를 못 찾으면 노션 글 기본 생성 날짜 활용
        if (!dateStr && item.created_time) {
            dateStr = item.created_time.split('T')[0];
        }
        // B. Progress 속성 자동 탐색 (Progress, 진행률, 수식/숫자 모두 호환)
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
