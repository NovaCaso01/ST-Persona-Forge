/**
 * 페르소나 대장간 - 상태 관리
 */

import { extensionName } from './constants.js';

// ===== 공유 상태 =====
export const state = {
    /** @type {Object|null} 확장 설정 참조 */
    settings: null,

    /** @type {Object|null} 현재 생성된 페르소나 데이터 */
    currentGeneration: null,
    // {
    //   sections: { section_0: { header: '## HEADER', content: 'content...' }, ... },
    //   fullText: 'combined text',
    //   charName: 'Character Name',
    //   charIndex: 0,
    //   templateId: 'standard',
    //   language: 'en',
    //   timestamp: Date.now(),
    // }

    /** @type {boolean} 생성 중 여부 */
    isGenerating: false,

    /** @type {Set<number>} 선택된 WI 엔트리 인덱스 */
    selectedWIEntries: new Set(),

    /** @type {Set<string>} 선택된 WI 북 이름들 ('__char__' 포함 가능) */
    selectedWIBooks: new Set(),

    /** @type {Array} 로드된 WI 엔트리 목록 */
    loadedWIEntries: [],

    /** @type {boolean} 생성 취소 플래그 */
    isCancelled: false,

    /** @type {number} 선택된 캐릭터 인덱스 */
    selectedCharIndex: -1,

    /** @type {Object|null} 선택된 캐릭터 데이터 */
    selectedCharData: null,
};

// ===== 유틸리티 =====

/**
 * 로그 출력
 * @param {string} msg
 */
export function log(msg) {
    console.log(`[${extensionName}] ${msg}`);
}

/**
 * 에러 로그 출력
 * @param {string} context
 * @param {Error} error
 * @param {Object} details
 */
export function logError(context, error, details = {}) {
    console.error(`[${extensionName}] [${context}]`, error.message || error, details);
}

/**
 * 현재 설정 반환
 * @returns {Object}
 */
export function getSettings() {
    return state.settings;
}

/**
 * 생성 상태 설정
 * @param {boolean} generating
 */
export function setGenerating(generating) {
    state.isGenerating = generating;
}

/**
 * 생성 취소 상태 설정
 * @param {boolean} cancelled
 */
export function setCancelled(cancelled) {
    state.isCancelled = cancelled;
}
