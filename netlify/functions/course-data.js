const { getStore } = require("@netlify/blobs");

const STORE_NAME = "kmla-course-data";
const STORE_KEY = "global";
const DEFAULT_ADMIN_ID = "admin";
const DEFAULT_ADMIN_PASSWORD = "kmla-admin";

function jsonResponse(statusCode, payload) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(payload)
    };
}

function getBlobsConfig() {
    const siteID =
        process.env.BLOBS_SITE_ID ||
        process.env.NETLIFY_SITE_ID ||
        process.env.SITE_ID;
    const token =
        process.env.BLOBS_TOKEN ||
        process.env.NETLIFY_BLOBS_TOKEN ||
        process.env.NETLIFY_AUTH_TOKEN;

    if (siteID && token) {
        return { siteID, token };
    }

    return undefined;
}

function getExpectedAdminCredentials() {
    return {
        id: process.env.ADMIN_ID || DEFAULT_ADMIN_ID,
        password: process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
    };
}

function isAuthorized(body) {
    const expected = getExpectedAdminCredentials();
    return body && body.adminId === expected.id && body.adminPassword === expected.password;
}

function normalizeCourseData(input) {
    const normalized = {};
    Object.entries(input || {}).forEach(([key, value]) => {
        if (!Array.isArray(value)) return;
        normalized[key] = [...new Set(value.map(item => String(item).trim()).filter(Boolean))];
    });
    return normalized;
}

exports.handler = async function handler(event) {
    const store = getStore(STORE_NAME, getBlobsConfig());

    if (event.httpMethod === "GET") {
        try {
            const raw = await store.get(STORE_KEY);
            if (!raw) {
                return jsonResponse(200, { courseData: null });
            }

            return jsonResponse(200, { courseData: JSON.parse(raw) });
        } catch (error) {
            return jsonResponse(500, { error: error.message || "Failed to load course data." });
        }
    }

    if (event.httpMethod === "POST") {
        try {
            const body = JSON.parse(event.body || "{}");
            if (!isAuthorized(body)) {
                return jsonResponse(401, { error: "관리자 인증에 실패했습니다." });
            }

            const normalized = normalizeCourseData(body.courseData);
            await store.set(STORE_KEY, JSON.stringify(normalized));
            return jsonResponse(200, { ok: true });
        } catch (error) {
            return jsonResponse(500, { error: error.message || "Failed to save course data." });
        }
    }

    return jsonResponse(405, { error: "Method not allowed" });
};
