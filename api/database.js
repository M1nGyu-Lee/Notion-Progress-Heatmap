import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();
export default async (req, res) => {
    const token = process.env.ENV_NOTION_TOKEN;
    const databaseId = process.env.ENV_DATABASE_ID;
    try {
        const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json'
            },
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(`Notion API error: ${response.status} ${JSON.stringify(data)}`);
        }
        const processedData = processData(data.results);
        res.json(processedData);
    } catch (error) {
        console.error("Error processing request:", error);
        res.status(500).json({ error: error.message });
    }
};
const processData = (data) => {
    const progressMap = new Map();
    data.forEach(item => {
        if (item.properties && item.properties.Date) {
            let dateStr = null;
            // 1. 일반 날짜(Date) 속성 지원
            if (item.properties.Date.date && item.properties.Date.date.start) {
                dateStr = item.properties.Date.date.start;
            } 
            // 2. 생성 일시(Created Time) 속성 지원
            else if (item.properties.Date.created_time) {
                dateStr = item.properties.Date.created_time.split('T')[0];
            }
            // 3. Progress 값 추출 (숫자 또는 수식 모두 지원)
            let numVal = 100; // 기본값 100%
            if (item.properties.Progress) {
                if (item.properties.Progress.number !== undefined && item.properties.Progress.number !== null) {
                    numVal = item.properties.Progress.number;
                } else if (item.properties.Progress.formula && item.properties.Progress.formula.number !== null) {
                    numVal = item.properties.Progress.formula.number;
                }
            }
            if (dateStr && numVal > 0) {
                // 수치가 1 이하 소수인 경우 100을 곱함 (1 -> 100%)
                const progress = numVal <= 1 ? Math.round(numVal * 100) : Math.round(numVal);
                progressMap.set(dateStr, progress);
            }
        }
    });
    return Array.from(progressMap).map(([date, progress]) => ({ date, progress }));
};
