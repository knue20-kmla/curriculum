const crypto = require("crypto");

const DEFAULT_ADMIN_ID = "admin";
const DEFAULT_ADMIN_PASSWORD = "kmla-admin";
const FIRESTORE_DATABASE_ID = process.env.FIREBASE_DATABASE_ID || "(default)";
const FIRESTORE_COLLECTION = "app_data";
const FIRESTORE_DOCUMENT = "course_data";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function jsonResponse(statusCode, payload) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(payload)
    };
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

function getFirebaseConfig() {
    const projectId = process.env.FIREBASE_PROJECT_ID || "kmla-curriculum";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

    if (!clientEmail || !privateKeyRaw) {
        return null;
    }

    return {
        projectId,
        clientEmail,
        privateKey: privateKeyRaw.replace(/\\n/g, "\n")
    };
}

function toBase64Url(value) {
    return Buffer.from(value)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

async function getGoogleAccessToken(firebaseConfig) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claimSet = {
        iss: firebaseConfig.clientEmail,
        sub: firebaseConfig.clientEmail,
        aud: GOOGLE_TOKEN_URL,
        scope: FIRESTORE_SCOPE,
        iat: now,
        exp: now + 3600
    };

    const encodedHeader = toBase64Url(JSON.stringify(header));
    const encodedClaimSet = toBase64Url(JSON.stringify(claimSet));
    const unsignedToken = `${encodedHeader}.${encodedClaimSet}`;
    const signature = crypto
        .createSign("RSA-SHA256")
        .update(unsignedToken)
        .sign(firebaseConfig.privateKey, "base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");

    const assertion = `${unsignedToken}.${signature}`;
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion
        }).toString()
    });

    const tokenResult = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenResult.access_token) {
        throw new Error(tokenResult?.error_description || tokenResult?.error || "Failed to obtain Firebase access token.");
    }

    return tokenResult.access_token;
}

function getFirestoreDocumentUrl(projectId) {
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/${FIRESTORE_COLLECTION}/${FIRESTORE_DOCUMENT}`;
}

async function loadCourseDataFromFirestore(firebaseConfig) {
    const accessToken = await getGoogleAccessToken(firebaseConfig);
    const response = await fetch(getFirestoreDocumentUrl(firebaseConfig.projectId), {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (response.status === 404) {
        return null;
    }

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result?.error?.message || "Failed to load course data from Firestore.");
    }

    const jsonValue = result?.fields?.courseDataJson?.stringValue;
    if (!jsonValue) {
        return null;
    }

    return normalizeCourseData(JSON.parse(jsonValue));
}

async function saveCourseDataToFirestore(firebaseConfig, courseData) {
    const accessToken = await getGoogleAccessToken(firebaseConfig);
    const response = await fetch(`${getFirestoreDocumentUrl(firebaseConfig.projectId)}?updateMask.fieldPaths=courseDataJson&updateMask.fieldPaths=updatedAt`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
            fields: {
                courseDataJson: {
                    stringValue: JSON.stringify(courseData)
                },
                updatedAt: {
                    timestampValue: new Date().toISOString()
                }
            }
        })
    });

    const result = await response.json();
    if (!response.ok) {
        throw new Error(result?.error?.message || "Failed to save course data to Firestore.");
    }
}

exports.handler = async function handler(event) {
    const firebaseConfig = getFirebaseConfig();
    if (!firebaseConfig) {
        return jsonResponse(500, {
            error: "Firebase server credentials are not configured."
        });
    }

    if (event.httpMethod === "GET") {
        try {
            const courseData = await loadCourseDataFromFirestore(firebaseConfig);
            return jsonResponse(200, { courseData });
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
            await saveCourseDataToFirestore(firebaseConfig, normalized);
            return jsonResponse(200, { ok: true });
        } catch (error) {
            return jsonResponse(500, { error: error.message || "Failed to save course data." });
        }
    }

    return jsonResponse(405, { error: "Method not allowed" });
};
