/**
 * 페르소나 대장간 - 월드인포/로어북 접근
 */

import { getContext } from "../../../../extensions.js";
import { log, logError } from './state.js';

/**
 * 캐릭터의 월드인포 엔트리 전체 로드 (중복 제거 포함)
 * (캐릭터 카드 내장 lorebook + 연결된 WI 북)
 * @param {number} charIndex - 캐릭터 인덱스
 * @returns {Promise<Array<Object>>} 엔트리 배열
 */
export async function loadCharacterWorldInfo(charIndex) {
    const context = getContext();
    const char = context.characters?.[charIndex];
    if (!char) {
        log('Character not found for WI loading');
        return [];
    }

    const allEntries = [];
    const seenContentHashes = new Set();

    // 1) 캐릭터에 연결된 외부 WI 북 (우선 로드 — source 이름이 더 의미있음)
    const worldName = char.data?.extensions?.world;
    if (worldName) {
        const external = await fetchWorldInfoBook(worldName);
        for (const entry of external) {
            const hash = hashEntryContent(entry);
            if (!seenContentHashes.has(hash)) {
                seenContentHashes.add(hash);
                allEntries.push(entry);
            }
        }
        log(`Found ${external.length} external WI entries from "${worldName}"`);
    }

    // 2) 캐릭터 카드 내장 character_book (V2 spec) — 중복 제거
    const charBook = char.data?.character_book;
    if (charBook) {
        const embedded = extractBookEntries(charBook, '캐릭터 로어북');
        let addedCount = 0;
        for (const entry of embedded) {
            const hash = hashEntryContent(entry);
            if (!seenContentHashes.has(hash)) {
                seenContentHashes.add(hash);
                allEntries.push(entry);
                addedCount++;
            }
        }
        log(`Found ${embedded.length} embedded lorebook entries, ${addedCount} unique added`);
    }

    return allEntries;
}

/**
 * 사용 가능한 전체 WI 북 목록 가져오기
 * 방법 1: ST DOM에서 직접 읽기 (가장 안정적)
 * 방법 2: /api/worldinfo/list API
 * 방법 3: /api/settings/get 폴백
 * @returns {Promise<Array<string>>} WI 북 이름 배열
 */
export async function getAvailableWorldInfoBooks() {
    // 방법 1: ST DOM의 #world_editor_select에서 직접 읽기 (ST가 world_names로 채워놓음)
    try {
        const options = $('#world_editor_select option');
        if (options.length > 0) {
            const names = [];
            options.each(function () {
                const text = $(this).text().trim();
                const val = $(this).val();
                // 빈 값이나 placeholder 제외
                if (text && val !== '' && val !== 'None') {
                    names.push(text);
                }
            });
            if (names.length > 0) {
                log(`WI books from DOM: ${names.length} found`);
                return names;
            }
        }
    } catch (e) {
        log(`DOM WI read failed: ${e.message}`);
    }

    // 방법 2: /api/worldinfo/list API (올바른 엔드포인트)
    try {
        const headers = { 'Content-Type': 'application/json' };

        try {
            const scriptModule = await import("../../../../../script.js");
            if (scriptModule.getRequestHeaders) {
                const stHeaders = scriptModule.getRequestHeaders();
                Object.assign(headers, stHeaders);
            }
        } catch (e) { /* 무시 */ }

        const response = await fetch('/api/worldinfo/list', {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
        });

        if (response.ok) {
            const data = await response.json();
            const names = Array.isArray(data) ? data : (data.worldNames || data.world_names || []);
            if (names.length > 0) {
                log(`WI books from /api/worldinfo/list: ${names.length} found`);
                return names;
            }
        }
    } catch (e) {
        log(`WI list API failed: ${e.message}`);
    }

    // 방법 3: /api/settings/get 폴백 (world_names 포함)
    try {
        const headers = { 'Content-Type': 'application/json' };

        try {
            const scriptModule = await import("../../../../../script.js");
            if (scriptModule.getRequestHeaders) {
                Object.assign(headers, scriptModule.getRequestHeaders());
            }
        } catch (e) { /* 무시 */ }

        const response = await fetch('/api/settings/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
        });

        if (response.ok) {
            const data = await response.json();
            const names = data.world_names || [];
            if (names.length > 0) {
                log(`WI books from /api/settings/get: ${names.length} found`);
                return names;
            }
        }
    } catch (e) {
        log(`Settings API fallback failed: ${e.message}`);
    }

    log('No WI books found from any source');
    return [];
}

/**
 * 특정 WI 북의 엔트리 로드
 * @param {string} bookName - WI 북 이름
 * @returns {Promise<Array<Object>>} 엔트리 배열
 */
export async function loadWorldInfoBookEntries(bookName) {
    return await fetchWorldInfoBook(bookName);
}

/**
 * 엔트리 content 기반 해시 생성 (중복 판별용)
 * @param {Object} entry
 * @returns {string}
 */
function hashEntryContent(entry) {
    // comment + keys + content 첫 200자 결합하여 간단 해시
    const raw = `${entry.comment || ''}|${(entry.keys || []).join(',')}|${(entry.content || '').substring(0, 200)}`;
    // 간단한 문자열 해시
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        const chr = raw.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash.toString(36);
}

/**
 * character_book 객체에서 엔트리 추출
 * @param {Object} book - character_book 데이터
 * @param {string} sourceName - 출처 표시용 이름
 * @returns {Array<Object>}
 */
function extractBookEntries(book, sourceName) {
    const entries = [];

    if (!book?.entries) return entries;

    // entries가 배열인 경우와 객체인 경우 모두 처리
    const rawEntries = Array.isArray(book.entries)
        ? book.entries
        : Object.values(book.entries);

    for (const entry of rawEntries) {
        if (!entry) continue;

        entries.push({
            uid: entry.id ?? entry.uid ?? entries.length,
            keys: entry.keys || entry.key || [],
            secondaryKeys: entry.secondary_keys || [],
            comment: entry.comment || entry.name || '',
            content: entry.content || '',
            enabled: entry.enabled !== false,
            constant: entry.constant || false,
            selective: entry.selective || false,
            position: entry.position || 'before_char',
            source: sourceName,
        });
    }

    return entries;
}

/**
 * 외부 WI 북 데이터 fetch
 * @param {string} bookName - WI 북 이름
 * @returns {Promise<Array<Object>>}
 */
async function fetchWorldInfoBook(bookName) {
    // 방법 1: SillyTavern API를 통한 fetch
    try {
        const headers = { 'Content-Type': 'application/json' };

        // CSRF 토큰 추가
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (csrfMeta) {
            headers['X-CSRF-Token'] = csrfMeta.getAttribute('content');
        }

        // ST의 getRequestHeaders 함수 사용 시도
        try {
            const scriptModule = await import("../../../../../script.js");
            if (scriptModule.getRequestHeaders) {
                const stHeaders = scriptModule.getRequestHeaders();
                Object.assign(headers, stHeaders);
            }
        } catch (e) {
            // 무시 — 수동으로 설정한 헤더 사용
        }

        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: bookName }),
        });

        if (response.ok) {
            const book = await response.json();
            return extractBookEntries(book, bookName);
        }
    } catch (e) {
        log(`WI fetch method 1 failed: ${e.message}`);
    }

    // 방법 2: 다른 엔드포인트 시도
    try {
        const response = await fetch(`/api/worldinfo/get?name=${encodeURIComponent(bookName)}`);
        if (response.ok) {
            const book = await response.json();
            return extractBookEntries(book, bookName);
        }
    } catch (e) {
        log(`WI fetch method 2 failed: ${e.message}`);
    }

    log(`Could not fetch external WI book: ${bookName}`);
    return [];
}


