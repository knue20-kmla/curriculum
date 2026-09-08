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

function buildInput(goal, selections, analysisContext) {
    const courseText = buildCourseText(selections);
    const lines = [
        `진로 희망: ${goal || "자유전공"}`,
        "",
        "선택 과목:",
        courseText || "선택 과목 정보 없음"
    ];

    if (analysisContext && typeof analysisContext === "object") {
        lines.push(
            "",
            "정량 지표(이 수치를 반드시 근거로 인용하여 분석):",
            JSON.stringify(analysisContext, null, 2)
        );
    }

    lines.push(
        "",
        "분석 기준:",
        "A. 진로연관 과목 수/비율이 낮거나 진로연관 심화·전문 과목이 거의 없으면, 어떤 세부 영역이 비어 있는지 구체적으로 지목하며 명확히 지적합니다. 막연한 격려로 넘기지 않습니다.",
        "B. 진로연관 과목이 특정 계열에만 과도하게 편중되어 균형이 깨졌으면 그 점을 지적합니다.",
        "C. 진로와 무관한 심화·전문 과목이 많으면 학업 부담 대비 진로 정합성 관점에서 비판적으로 평가합니다.",
        "D. summary에는 진로-교육과정 정합성 수준(높음/보통/낮음)을 분명히 드러냅니다.",
        "",
        "출력 규칙:",
        "1. 반드시 순수 JSON 객체만 출력합니다.",
        "2. markdown 코드블록을 절대 사용하지 않습니다.",
        "3. 설명문, 서론, 결론을 절대 덧붙이지 않습니다.",
        "4. JSON 키는 strengths, recommendations, summary 세 개만 사용합니다.",
        "5. 분석은 반드시 선택 과목과 희망 분야의 관련성만 다룹니다.",
        "6. 동아리, 봉사, 캠프, 인턴, 독서, 탐구활동, 대회, 비교과 활동은 절대 언급하지 않습니다.",
        "7. strengths와 recommendations는 각각 2~5개의 한국어 문자열 배열이어야 합니다.",
        "8. recommendations는 앞으로 선택하면 좋은 구체적 과목명 또는 부족한 과목 영역만 다룹니다.",
        "9. summary는 2~4문장의 한국어 문자열이어야 합니다.",
        "10. strengths도 사실에 기반해 냉정하게 서술하고, 실제 지표가 빈약하면 강점을 과장하지 않습니다.",
        "",
        "정확한 출력 형식 예시:"
    );
    return lines.concat([
        '{',
        '  "strengths": ["강점 1", "강점 2"],',
        '  "recommendations": ["제언 1", "제언 2"],',
        '  "summary": "총평 문장 1. 총평 문장 2."',
        '}'
    ]).join("\n");
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

function extractOutputText(result) {
    if (typeof result.output_text === "string" && result.output_text.trim()) {
        return result.output_text.trim();
    }

    if (!Array.isArray(result.output)) return "";

    const collected = [];
    result.output.forEach(item => {
        if (!item || !Array.isArray(item.content)) return;
        item.content.forEach(contentItem => {
            if (!contentItem) return;
            if (typeof contentItem.text === "string" && contentItem.text.trim()) {
                collected.push(contentItem.text.trim());
            } else if (contentItem.type === "output_text" && typeof contentItem.text === "string" && contentItem.text.trim()) {
                collected.push(contentItem.text.trim());
            }
        });
    });

    return collected.join("\n").trim();
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
        const { goal, selections, systemPrompt, analysisContext } = JSON.parse(event.body || "{}");
        const input = buildInput(goal, selections, analysisContext);

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

        const outputText = extractOutputText(result);
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
