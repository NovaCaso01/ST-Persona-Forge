/**
 * 페르소나 대장간 - 설정 및 히스토리 저장/로드
 */

import { extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import { extensionName, defaultSettings } from './constants.js';
import { state, log } from './state.js';

/**
 * 설정 로드 및 초기화
 */
export function loadSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = structuredClone(defaultSettings);
    }

    // 누락된 키 병합
    const saved = extension_settings[extensionName];
    for (const key of Object.keys(defaultSettings)) {
        if (saved[key] === undefined) {
            saved[key] = structuredClone(defaultSettings[key]);
        }
    }

    state.settings = extension_settings[extensionName];
    log('Settings loaded');
}

/**
 * 설정 저장 (디바운스)
 */
export function saveSettings() {
    saveSettingsDebounced();
}

/**
 * 설정값 업데이트
 * @param {string} key
 * @param {*} value
 */
export function updateSetting(key, value) {
    if (state.settings) {
        state.settings[key] = value;
        saveSettings();
    }
}

// ===== 히스토리 관리 =====

/**
 * 히스토리 목록 반환
 * @returns {Array}
 */
export function getHistory() {
    return state.settings?.history || [];
}

/**
 * 히스토리에 페르소나 저장
 * @param {Object} personaData
 * @param {string} personaData.name - 페르소나 이름
 * @param {string} personaData.charName - 대상 캐릭터 이름
 * @param {string} personaData.fullText - 전체 텍스트
 * @param {string} personaData.language - 생성 언어
 * @param {string} personaData.templateId - 사용된 템플릿
 */
export function saveToHistory(personaData) {
    if (!state.settings) return;

    const entry = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        name: personaData.name || 'Unnamed Persona',
        charName: personaData.charName || 'Unknown',
        fullText: personaData.fullText,
        language: personaData.language || 'en',
        templateId: personaData.templateId || 'standard',
        timestamp: Date.now(),
    };

    if (!state.settings.history) {
        state.settings.history = [];
    }

    // 최신이 앞에 오도록 unshift
    state.settings.history.unshift(entry);

    // 최대 50개 유지
    if (state.settings.history.length > 50) {
        state.settings.history = state.settings.history.slice(0, 50);
    }

    saveSettings();
    log(`Saved to history: ${entry.name}`);
    return entry.id;
}

/**
 * 히스토리에서 항목 삭제
 * @param {string} id
 */
export function deleteFromHistory(id) {
    if (!state.settings?.history) return;
    state.settings.history = state.settings.history.filter(h => h.id !== id);
    saveSettings();
    log(`Deleted from history: ${id}`);
}

/**
 * 전체 히스토리 삭제
 */
export function clearHistory() {
    if (state.settings) {
        state.settings.history = [];
        saveSettings();
        log('History cleared');
    }
}
