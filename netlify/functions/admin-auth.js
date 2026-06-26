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

exports.handler = async function handler(event) {
    if (event.httpMethod !== "POST") {
        return jsonResponse(405, { error: "Method not allowed" });
    }

    try {
        const body = JSON.parse(event.body || "{}");
        const expectedId = process.env.ADMIN_ID || DEFAULT_ADMIN_ID;
        const expectedPassword = process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD;

        if (body.adminId === expectedId && body.adminPassword === expectedPassword) {
            return jsonResponse(200, { ok: true });
        }

        return jsonResponse(401, { error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    } catch (error) {
        return jsonResponse(500, { error: error.message || "Failed to authenticate admin." });
    }
};
