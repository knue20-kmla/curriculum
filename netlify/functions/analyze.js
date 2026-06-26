function jsonResponse(statusCode, payload) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(payload)
    };
}

function buildCourseText(selections) {
    const semesterLabels = {
        "1-1": "1학년 1학기",
        "1-2": "1학년 2학기",
        "2-1": "2학년 1학기",
        "2-2": "2학년 2학기",
        "3-1": "3학년 1학기",
        "3-2": "3학년 2학기"
    };

    return Object.entries(semesterLabels)
        .map(([semesterKey, label]) => {
            const courses = Array.isArray(selections && selections[semesterKey]) ? selections[semesterKey] : [];
            return courses.length ? `${label}: ${courses.join(", ")}` : null;
        })
        .filter(Boolean)
        .join("\n");
}

function buildInput(goal, selections) {
    const courseText = buildCourseText(selections);
    return [
        `진로 희망: ${goal || "자유전공"}`,
        "",
        "선택 과목:",
        courseText || "선택 과목 정보 없음",
        "",
        "출력 규칙:",
        "1. 반드시 순수 JSON 객체만 출력합니다.",
        "2. markdown 코드블록을 절대 사용하지 않습니다.",
        "3. 설명문, 서론, 결론을 절대 덧붙이지 않습니다.",
        "4. JSON 키는 strengths, recommendations, summary 세 개만 사용합니다.",
        "5. strengths와 recommendations는 각각 2~5개의 한국어 문자열 배열이어야 합니다.",
        "6. summary는 2~4문장의 한국어 문자열이어야 합니다.",
        "",
        "정확한 출력 형식 예시:",
        '{',
        '  "strengths": ["강점 1", "강점 2"],',
        '  "recommendations": ["제언 1", "제언 2"],',
        '  "summary": "총평 문장 1. 총평 문장 2."',
        '}'
    ].join("\n");
}

function extractJsonObject(rawText) {
    if (typeof rawText !== "string") return null;
    const trimmed = rawText.trim();

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        // Continue to fallback extraction.
    }

    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fencedMatch) {
        try {
            return JSON.parse(fencedMatch[1].trim());
        } catch (error) {
            // Continue to brace extraction.
        }
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        } catch (error) {
            return null;
        }
    }

    return null;
}

exports.handler = async function handler(event) {
    if (event.httpMethod !== "POST") {
        return jsonResponse(405, { error: "Method not allowed" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

    if (!apiKey) {
        return jsonResponse(500, { error: "OPENAI_API_KEY is not configured." });
    }

    try {
        const { goal, selections, systemPrompt } = JSON.parse(event.body || "{}");
        const input = buildInput(goal, selections);

        const response = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                instructions: systemPrompt,
                input
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return jsonResponse(response.status, {
                error: result && result.error && result.error.message ? result.error.message : "OpenAI API request failed."
            });
        }

        const outputText = typeof result.output_text === "string" ? result.output_text.trim() : "";
        if (!outputText) {
            return jsonResponse(500, { error: "OpenAI response did not include text output." });
        }

        const analysis = extractJsonObject(outputText);
        if (!analysis) {
            return jsonResponse(500, {
                error: "OpenAI response was not valid JSON.",
                raw: outputText
            });
        }

        if (!Array.isArray(analysis.strengths) || !Array.isArray(analysis.recommendations) || typeof analysis.summary !== "string") {
            return jsonResponse(500, {
                error: "OpenAI response JSON did not match the expected schema.",
                raw: analysis
            });
        }

        return jsonResponse(200, {
            strengths: analysis.strengths.map(item => String(item).trim()).filter(Boolean),
            recommendations: analysis.recommendations.map(item => String(item).trim()).filter(Boolean),
            summary: String(analysis.summary).trim()
        });
    } catch (error) {
        return jsonResponse(500, {
            error: error && error.message ? error.message : "Server error"
        });
    }
};
