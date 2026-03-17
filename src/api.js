/**
 * 페르소나 대장간 - API 호출 로직
 */

import { extension_settings } from "../../../../extensions.js";
import { generateQuietPrompt, generateRaw } from "../../../../../script.js";
import { extensionName, ANTI_CENSORSHIP_PROMPT, PREFILL_PROMPT } from './constants.js';
import { log, logError, getSettings } from './state.js';

// ConnectionManagerRequestService (SillyTavern 1.13.0+)
let ConnectionManagerRequestService = null;

/**
 * ConnectionManagerRequestService 로드
 */
async function loadConnectionManager() {
    if (ConnectionManagerRequestService) return true;
    try {
        const shared = await import("../../../shared.js");
        ConnectionManagerRequestService = shared.ConnectionManagerRequestService;
        log('ConnectionManagerRequestService loaded');
        return true;
    } catch (error) {
        log(`ConnectionManagerRequestService not available: ${error.message}`);
        return false;
    }
}

/**
 * 사용 가능한 Connection Profile 목록 반환
 * @returns {Array<{id: string, name: string}>}
 */
export function getConnectionProfiles() {
    const profiles = extension_settings?.connectionManager?.profiles || [];
    return profiles.map(p => ({ id: p.id, name: p.name }));
}

/**
 * 메인 API 호출 (시스템 + 유저 프롬프트)
 * ⚠️ 기존 유저 페르소나가 프롬프트에 주입되는 것을 방지하기 위해
 *    호출 전 모든 페르소나 데이터를 임시 제거 → 완료 후 복원
 * @param {string} systemPrompt - 시스템 프롬프트
 * @param {string} userPrompt - 유저 프롬프트
 * @returns {Promise<string>}
 */
export async function callGenerationAPI(systemPrompt, userPrompt) {
    const settings = getSettings();
    const profileId = settings.connectionProfile;

    // 검열 완화 + 프리필 적용
    const fullUserPrompt = ANTI_CENSORSHIP_PROMPT + userPrompt + PREFILL_PROMPT;

    // ===== 페르소나 임시 제거 (모든 API 경로에 적용) =====
    let power_user = null;
    let savedPersonaDesc = null;           // power_user.persona_description (현재 활성 텍스트)
    let savedAvatarKey = null;             // 현재 아바타 키
    let savedAvatarDescObj = null;         // power_user.persona_descriptions[avatar] 객체 내 description

    try {
        const powerUserModule = await import("../../../../power-user.js");
        power_user = powerUserModule.power_user;

        if (power_user) {
            // 1) 활성 페르소나 텍스트 제거
            if (power_user.persona_description) {
                savedPersonaDesc = power_user.persona_description;
                power_user.persona_description = '';
            }

            // 2) 현재 아바타 키에 연결된 persona_descriptions 제거
            try {
                const scriptModule = await import("../../../../../script.js");
                const userAvatar = scriptModule.user_avatar;
                if (userAvatar && power_user.persona_descriptions?.[userAvatar]) {
                    savedAvatarKey = userAvatar;
                    savedAvatarDescObj = power_user.persona_descriptions[userAvatar].description;
                    power_user.persona_descriptions[userAvatar].description = '';
                }
            } catch (e) {
                // user_avatar를 못 가져와도 1번만으로 충분할 수 있음
            }
        }
    } catch (e) {
        log('Could not suppress persona: ' + e.message);
    }

    try {
        if (profileId) {
            return await callConnectionManagerAPI(systemPrompt, fullUserPrompt, profileId);
        }
        return await callDefaultAPI(systemPrompt, fullUserPrompt);
    } finally {
        // ===== 페르소나 복원 =====
        if (power_user) {
            if (savedPersonaDesc !== null) {
                power_user.persona_description = savedPersonaDesc;
            }
            if (savedAvatarKey && savedAvatarDescObj !== null) {
                power_user.persona_descriptions[savedAvatarKey].description = savedAvatarDescObj;
            }
        }
    }
}

/**
 * Connection Manager API 호출
 */
async function callConnectionManagerAPI(systemPrompt, userPrompt, profileId) {
    const loaded = await loadConnectionManager();
    if (!loaded || !ConnectionManagerRequestService) {
        log('ConnectionManager not available, falling back to default API');
        return await callDefaultAPI(systemPrompt, userPrompt);
    }

    const profiles = extension_settings?.connectionManager?.profiles || [];
    const profile = profiles.find(p => p.id === profileId);

    if (!profile) {
        log(`Profile ${profileId} not found, falling back to default API`);
        return await callDefaultAPI(systemPrompt, userPrompt);
    }

    try {
        log(`Using ConnectionManager profile: ${profile.name}`);

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const result = await ConnectionManagerRequestService.sendRequest(
            profileId,
            messages,
            null, // 토큰 제한 없음 — 프리셋 기본값 사용
            {
                includePreset: true,
                includeInstruct: true,
                stream: false,
            },
            {}
        );

        const content = result?.content || result || '';
        if (!content) {
            throw new Error('Empty response from ConnectionManager');
        }
        return content;
    } catch (error) {
        logError('callConnectionManagerAPI', error);
        throw error;
    }
}

/**
 * SillyTavern 기본 API 호출 (Connection Profile 미사용)
 * 페르소나 차단은 callGenerationAPI에서 이미 처리됨
 */
async function callDefaultAPI(systemPrompt, userPrompt) {
    try {
        // 시스템 + 유저 프롬프트를 하나로 결합
        const combinedPrompt = systemPrompt + '\n\n---\n\n' + userPrompt;

        let result;

        if (typeof generateRaw === 'function') {
            result = await generateRaw({
                prompt: combinedPrompt,
                maxContext: null,
                quietToLoud: false,
                skipWIAN: true,
                skipAN: true,
                quietImage: null,
                quietName: null,
            });
        } else if (typeof generateQuietPrompt === 'function') {
            result = await generateQuietPrompt(combinedPrompt, false, false);
        } else {
            throw new Error('SillyTavern API 함수를 찾을 수 없습니다');
        }

        return result || '';
    } catch (error) {
        logError('callDefaultAPI', error);
        throw error;
    }
}
