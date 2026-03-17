/**
 * 페르소나 대장간 - 페르소나 생성 로직
 */

import { getContext } from "../../../../extensions.js";
import {
    PROFILE_FIELDS, TEMPLATE_PRESETS, LANGUAGES,
    SYSTEM_PROMPT, REGEN_SYSTEM_PROMPT, TRANSLATE_SYSTEM_PROMPT, MODIFY_SYSTEM_PROMPT,
} from './constants.js';
import { state, log, logError, getSettings, setGenerating } from './state.js';
import { callGenerationAPI } from './api.js';

// ===== 확장 태그 정제 유틸리티 =====

/**
 * 다른 확장 프로그램이 주입한 태그/프롬프트를 제거 (입력 데이터 정제용)
 * @param {string} text
 * @returns {string}
 */
function cleanExtensionTags(text) {
    if (!text) return '';
    let cleaned = text;

    // AutoPic: <pic prompt="..."> 태그 (셀프클로징 포함)
    cleaned = cleaned.replace(/<pic\s[^>]*>/gi, '');
    cleaned = cleaned.replace(/<\/pic>/gi, '');

    // AutoPic: <image_generation>...</image_generation> 블록 전체
    cleaned = cleaned.replace(/<image_generation>[\s\S]*?<\/image_generation>/gi, '');

    // 일반적인 확장 관련 HTML 태그 패턴
    cleaned = cleaned.replace(/<\/?img[^>]*>/gi, '');
    cleaned = cleaned.replace(/<status[^>]*>[\s\S]*?<\/status>/gi, '');
    cleaned = cleaned.replace(/<choice[^>]*>[\s\S]*?<\/choice>/gi, '');

    // 연속 빈 줄 정리 (3줄 이상 → 2줄)
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned;
}

/**
 * LLM 생성 결과에서 불필요한 태그/아티팩트를 정제 (출력 후처리용)
 * @param {string} text
 * @returns {string}
 */
function cleanGeneratedText(text) {
    if (!text) return '';
    let cleaned = text;

    // AutoPic <pic prompt="..."> 태그 (LLM이 패턴을 재생산한 경우)
    cleaned = cleaned.replace(/<pic\s[^>]*>/gi, '');
    cleaned = cleaned.replace(/<\/pic>/gi, '');

    // <image_generation> 블록
    cleaned = cleaned.replace(/<image_generation>[\s\S]*?<\/image_generation>/gi, '');

    // 기타 HTML 태그 (이미지/미디어 관련)
    cleaned = cleaned.replace(/<\/?img[^>]*>/gi, '');
    cleaned = cleaned.replace(/<status[^>]*>[\s\S]*?<\/status>/gi, '');
    cleaned = cleaned.replace(/<choice[^>]*>[\s\S]*?<\/choice>/gi, '');

    // ``` 코드블록으로 감싼 경우 제거 (가끔 LLM이 마크다운 코드블록으로 감쌈)
    cleaned = cleaned.replace(/^```[a-z]*\n?/gm, '');
    cleaned = cleaned.replace(/^```\s*$/gm, '');

    // 연속 빈 줄 정리
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

// ===== 캐릭터 데이터 수집 =====

/**
 * 캐릭터 데이터를 프롬프트용 텍스트로 변환
 * @param {Object} charData - 캐릭터 데이터
 * @returns {string}
 */
function formatCharacterData(charData) {
    if (!charData) return '';

    const parts = [];

    const name = charData.name || charData.data?.name || 'Unknown';
    parts.push(`Character Name: ${name}`);

    // V2 형식 우선, V1 폴백
    const desc = charData.data?.description || charData.description || '';
    if (desc) parts.push(`\nDescription:\n${desc}`);

    const personality = charData.data?.personality || charData.personality || '';
    if (personality) parts.push(`\nPersonality:\n${personality}`);

    const scenario = charData.data?.scenario || charData.scenario || '';
    if (scenario) parts.push(`\nScenario:\n${scenario}`);

    const firstMes = charData.data?.first_mes || charData.first_mes || '';
    if (firstMes) parts.push(`\nFirst Message:\n${firstMes}`);

    const mesExample = charData.data?.mes_example || charData.mes_example || '';
    if (mesExample) parts.push(`\nExample Messages:\n${mesExample}`);

    // 크리에이터 노트 등 추가 필드
    const creatorNotes = charData.data?.creator_notes || '';
    if (creatorNotes) parts.push(`\nCreator Notes:\n${creatorNotes}`);

    const systemPrompt = charData.data?.system_prompt || '';
    if (systemPrompt) parts.push(`\nSystem Prompt:\n${systemPrompt}`);

    // 다른 확장의 태그/프롬프트 제거 (AutoPic, 기타 확장)
    let result = parts.join('\n');
    result = cleanExtensionTags(result);

    // {{user}} / {{char}} 매크로 치환 — ST가 현재 페르소나 이름으로 치환하는 것을 방지
    result = result.replace(/\{\{user\}\}/gi, '[Player Character]');
    result = result.replace(/\{\{char\}\}/gi, name);

    return result.trim();
}

/**
 * 선택된 WI 엔트리를 프롬프트용 텍스트로 변환
 * @returns {string}
 */
function formatWorldInfoEntries() {
    const { selectedWIEntries, loadedWIEntries } = state;
    if (!selectedWIEntries.size || !loadedWIEntries.length) return '';

    const parts = [];
    for (let i = 0; i < loadedWIEntries.length; i++) {
        if (!selectedWIEntries.has(i)) continue;
        const entry = loadedWIEntries[i];
        const header = entry.comment || entry.keys?.join(', ') || `Entry ${i}`;
        parts.push(`### ${header}\n${entry.content}`);
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
}

/**
 * 활성 필드 목록 반환
 * @returns {Array<string>} 필드 ID 배열
 */
function getActiveFields() {
    const settings = getSettings();
    const presetId = settings.templatePreset;

    if (presetId === 'choice') {
        return settings.customFields || [];
    }

    const preset = TEMPLATE_PRESETS[presetId];
    return preset ? preset.fields : TEMPLATE_PRESETS.standard.fields;
}

/**
 * 필드 목록을 프롬프트 지시문으로 변환
 * @param {Array<string>} fields
 * @param {string} language
 * @returns {string}
 */
function formatFieldInstructions(fields, language) {
    return fields.map((fieldId, idx) => {
        const field = PROFILE_FIELDS[fieldId];
        if (!field) return '';
        return `${idx + 1}. ## ${field.labelEn} — ${field.description}`;
    }).filter(Boolean).join('\n');
}

// ===== 메인 생성 =====

/**
 * 페르소나 전체 생성
 * @param {Object} config
 * @param {string} config.conceptText - 가이드 모드 컨셉 텍스트 (선택)
 * @returns {Promise<Object>} 생성 결과
 */
export async function generatePersona(config = {}) {
    const settings = getSettings();
    const charData = state.selectedCharData;

    if (!charData) {
        throw new Error('캐릭터가 선택되지 않았습니다.');
    }

    setGenerating(true);

    try {
        const language = settings.language || 'en';
        const langInfo = LANGUAGES[language] || LANGUAGES.en;
        const isGuided = settings.generationMode === 'guided' && config.conceptText;
        const isSheetMode = settings.templatePreset === 'custom';
        const sheetTemplate = isSheetMode ? (config.sheetTemplate || '') : '';

        if (isSheetMode && !sheetTemplate.trim()) {
            throw new Error('커스텀 시트가 입력되지 않았습니다.');
        }

        // 유저 프롬프트 조립 — 공통 부분
        let userPrompt = `## Target Character Information\n⚠️ The data below is REFERENCE MATERIAL ONLY for understanding the target character's world and personality. Do NOT copy or imitate its formatting, structure, or markup style in your output.\n\n${formatCharacterData(charData)}`;

        // 월드인포
        if (settings.includeWorldInfo) {
            const wiText = formatWorldInfoEntries();
            if (wiText) {
                userPrompt += `\n\n## World Information\n${wiText}`;
            }
        }

        // 가이드 모드 컨셉
        if (isGuided) {
            userPrompt += `\n\n## User's Character Concept\nThe user wants their persona (the player character) to be like this:\n${config.conceptText}`;
        }

        if (isSheetMode) {
            // ===== 커스텀 시트 모드 =====
            userPrompt += `\n\n## User's Profile Sheet Template\nThe user wants the persona to follow this exact sheet format:\n\n${sheetTemplate}`;

            userPrompt += `\n\n## Instructions\nFill in the above profile sheet template to create a player character persona.
- Follow the sheet template's structure, format, and categories EXACTLY
- Do NOT change the template's formatting or add/remove sections
- Your output format must follow ONLY the sheet template above — do NOT borrow formatting from the target character data`;

            userPrompt += `\n\n## Language\nCRITICAL: ${langInfo.instruction} The ENTIRE profile must be written in this language only. Do NOT mix languages or fall back to any other language.`;

            userPrompt += `\n\n## Important Notes
- The player character is NOT the target chatbot character — create a separate person
- Do NOT name the character "[Player Character]" — create an original name

Begin filling in the profile sheet now.`;

        } else {
            // ===== 템플릿 모드 (basic/standard/detailed/full/choice) =====
            const fields = getActiveFields();

            userPrompt += `\n\n## Profile Sections to Write\nCreate a player character persona profile with the following sections:\n${formatFieldInstructions(fields, language)}`;

            userPrompt += `\n\n## Language\nCRITICAL: ${langInfo.instruction} The ENTIRE profile must be written in this language only. Do NOT mix languages or fall back to any other language.`;

            userPrompt += `\n\n## Important Notes
- The player character is NOT the target chatbot character — create a separate person
- Each section should use ## as the header level
- Use - bullet points before each field label (e.g. "- **Name:** Lily"), and use sub-bullets for multi-item lists
- Your output format must follow ONLY the section structure specified above — do NOT borrow formatting, markup, or layout from the target character data
- Do NOT name the character "[Player Character]" — create an original name

Begin writing the player character persona profile now.`;
        }

        log(`Generating persona (template: ${settings.templatePreset}, lang: ${language}, mode: ${settings.generationMode})`);

        // API 호출
        const activeSystemPrompt = (getSettings().customSystemPrompt || '').trim() || SYSTEM_PROMPT;
        const response = await callGenerationAPI(activeSystemPrompt, userPrompt);

        if (!response || !response.trim()) {
            throw new Error('API에서 빈 응답을 받았습니다.');
        }

        // 출력 후처리: 다른 확장 태그 등 아티팩트 제거
        const cleanedResponse = cleanGeneratedText(response);

        // 결과 저장
        if (isSheetMode) {
            // 커스텀 시트: 단일 블록 저장 (섹션 파싱 없음)
            state.currentGeneration = {
                sections: { _custom: { header: '', content: cleanedResponse } },
                fullText: cleanedResponse,
                isCustomSheet: true,
                sheetTemplate,
                charName: charData.name || charData.data?.name || 'Unknown',
                charIndex: state.selectedCharIndex,
                templateId: settings.templatePreset,
                language,
                timestamp: Date.now(),
            };
        } else {
            // 템플릿 모드: 섹션 파싱
            const fields = getActiveFields();
            const sections = parseResponse(cleanedResponse, fields);

            state.currentGeneration = {
                sections,
                fullText: cleanedResponse,
                isCustomSheet: false,
                charName: charData.name || charData.data?.name || 'Unknown',
                charIndex: state.selectedCharIndex,
                templateId: settings.templatePreset,
                language,
                timestamp: Date.now(),
            };
        }

        log('Persona generated successfully');
        return state.currentGeneration;

    } finally {
        setGenerating(false);
    }
}

// ===== 섹션별 재생성 =====

/**
 * 특정 섹션 재생성
 * @param {string} sectionId - 재생성할 필드 ID
 * @param {string} additionalInstructions - 추가 지시사항
 * @returns {Promise<Object>} 업데이트된 생성 데이터
 */
export async function regenerateSection(sectionId, additionalInstructions = '') {
    if (!state.currentGeneration) {
        throw new Error('생성된 페르소나가 없습니다.');
    }

    const charData = state.selectedCharData;
    if (!charData) {
        throw new Error('캐릭터 데이터를 찾을 수 없습니다.');
    }

    const field = PROFILE_FIELDS[sectionId];
    if (!field) {
        throw new Error(`알 수 없는 필드: ${sectionId}`);
    }

    setGenerating(true);

    try {
        const language = state.currentGeneration.language || 'en';
        const langInfo = LANGUAGES[language] || LANGUAGES.en;

        let userPrompt = `## Target Character Information\n${formatCharacterData(charData)}`;

        userPrompt += `\n\n## Current Full Profile\n${state.currentGeneration.fullText}`;

        userPrompt += `\n\n## Section to Regenerate\n## ${field.labelEn} — ${field.description}`;

        if (additionalInstructions.trim()) {
            userPrompt += `\n\n## Additional Instructions from User\n${additionalInstructions}`;
        }

        userPrompt += `\n\n## Language\n${langInfo.instruction}`;

        userPrompt += `\n\nRegenerate ONLY the ## ${field.labelEn} section now. Output the section with its ## header.`;

        log(`Regenerating section: ${sectionId}`);

        const response = await callGenerationAPI(REGEN_SYSTEM_PROMPT, userPrompt);

        if (!response || !response.trim()) {
            throw new Error('API에서 빈 응답을 받았습니다.');
        }

        // 재생성된 섹션 파싱 (출력 후처리 적용)
        const newContent = cleanGeneratedText(response);

        // 기존 섹션 업데이트
        state.currentGeneration.sections[sectionId] = {
            header: `## ${field.labelEn}`,
            content: newContent,
        };

        // fullText 재조합
        rebuildFullText();

        log(`Section ${sectionId} regenerated successfully`);
        return state.currentGeneration;

    } finally {
        setGenerating(false);
    }
}

/**
 * 전체 재생성 (동일 설정으로)
 * @param {string} additionalInstructions - 추가 지시사항
 * @returns {Promise<Object>}
 */
export async function regenerateAll(additionalInstructions = '') {
    const config = {};
    if (additionalInstructions) config.conceptText = additionalInstructions;
    // 커스텀 시트 모드일 경우 시트 템플릿 보존
    if (state.currentGeneration?.isCustomSheet && state.currentGeneration?.sheetTemplate) {
        config.sheetTemplate = state.currentGeneration.sheetTemplate;
    }
    return await generatePersona(config);
}

// ===== 번역 =====

/**
 * 현재 프로필을 다른 언어로 번역
 * @param {string} targetLang - 대상 언어 코드 (en, ko, ja, zh)
 * @returns {Promise<Object>} 업데이트된 생성 데이터
 */
export async function translateProfile(targetLang) {
    if (!state.currentGeneration?.fullText) {
        throw new Error('번역할 프로필이 없습니다.');
    }

    const sourceLang = state.currentGeneration.language || 'en';
    const targetLangInfo = LANGUAGES[targetLang] || LANGUAGES.en;
    const sourceLangInfo = LANGUAGES[sourceLang] || LANGUAGES.en;

    if (sourceLang === targetLang) {
        throw new Error('원본 언어와 동일한 언어입니다.');
    }

    setGenerating(true);

    try {
        const userPrompt = `## Translation Task
Translate this character profile from ${sourceLangInfo.nativeName} to ${targetLangInfo.nativeName}.

## Profile to Translate
${state.currentGeneration.fullText}`;

        log(`Translating profile: ${sourceLang} → ${targetLang}`);

        const response = await callGenerationAPI(TRANSLATE_SYSTEM_PROMPT, userPrompt);

        if (!response || !response.trim()) {
            throw new Error('번역 API에서 빈 응답을 받았습니다.');
        }

        // 번역 결과로 업데이트 (출력 후처리 적용)
        const cleanedTranslation = cleanGeneratedText(response);
        if (state.currentGeneration.isCustomSheet) {
            state.currentGeneration.sections = { _custom: { header: '', content: cleanedTranslation } };
        } else {
            const fields = Object.keys(state.currentGeneration.sections);
            const newSections = parseResponse(cleanedTranslation, fields);
            state.currentGeneration.sections = newSections;
        }

        state.currentGeneration.fullText = cleanedTranslation;
        state.currentGeneration.language = targetLang;

        log(`Translation complete: ${sourceLang} → ${targetLang}`);
        return state.currentGeneration;

    } finally {
        setGenerating(false);
    }
}

// ===== 응답 파싱 =====

/**
 * LLM 응답을 섹션별로 파싱 (관대한 파싱)
 * @param {string} response - LLM 응답 전체 텍스트
 * @param {Array<string>} expectedFields - 예상 필드 ID 배열
 * @returns {Object} { fieldId: { header, content }, ... }
 */
function parseResponse(response, expectedFields) {
    const sections = {};
    const text = response.trim();

    // ## 또는 # 헤더로 섹션 분리
    const headerRegex = /^(#{1,3})\s+(.+)$/gm;
    const headerMatches = [];
    let match;

    while ((match = headerRegex.exec(text)) !== null) {
        headerMatches.push({
            fullMatch: match[0],
            level: match[1].length,
            title: match[2].trim(),
            index: match.index,
        });
    }

    if (headerMatches.length === 0) {
        // 헤더가 없는 경우 — 전체를 하나의 블록으로 처리
        const firstField = expectedFields[0] || 'basics';
        sections[firstField] = {
            header: `## ${PROFILE_FIELDS[firstField]?.labelEn || 'PROFILE'}`,
            content: text,
        };
        return sections;
    }

    // 이미 할당된 필드 추적 (중복 할당 방지)
    const assignedFields = new Set();

    // 각 헤더 매치를 필드에 매핑
    for (let i = 0; i < headerMatches.length; i++) {
        const hm = headerMatches[i];
        const nextIndex = (i + 1 < headerMatches.length)
            ? headerMatches[i + 1].index
            : text.length;

        const sectionContent = text.substring(hm.index, nextIndex).trim();

        // 타이틀 정규화: 소문자화, 특수문자 제거, 다중 공백 통합
        const titleLower = hm.title.toLowerCase()
            .replace(/[^a-z가-힣\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // 전체 PROFILE_FIELDS 대상으로 최장 키워드 매칭 (할당 완료 필드 제외)
        const fieldId = matchFieldToTitle(titleLower, assignedFields);

        if (fieldId && !assignedFields.has(fieldId)) {
            sections[fieldId] = {
                header: hm.fullMatch,
                content: sectionContent,
            };
            assignedFields.add(fieldId);
        } else {
            // 매칭 실패 또는 중복 — 미할당 expectedField에 순서대로 배치
            const unassigned = expectedFields.find(f => !assignedFields.has(f));
            if (unassigned) {
                sections[unassigned] = {
                    header: hm.fullMatch,
                    content: sectionContent,
                };
                assignedFields.add(unassigned);
            }
        }
    }

    // 매칭되지 않은 expected 필드 — 빈 상태로 두기 (재생성 가능)
    for (const fieldId of expectedFields) {
        if (!sections[fieldId]) {
            sections[fieldId] = {
                header: `## ${PROFILE_FIELDS[fieldId]?.labelEn || fieldId.toUpperCase()}`,
                content: '',
            };
        }
    }

    return sections;
}

/**
 * 헤더 타이틀을 필드 ID에 매칭 (최장 키워드 우선 매칭)
 * - 전체 PROFILE_FIELDS를 대상으로 검사 (expectedFields 제한 없음)
 * - 이미 할당된 필드는 건너뜀
 * - 가장 긴 키워드가 매칭된 필드를 반환 (오버랩 방지)
 * @param {string} titleLower - 정규화된 소문자 타이틀
 * @param {Set} assignedFields - 이미 할당된 필드 ID Set
 * @returns {string|null}
 */
function matchFieldToTitle(titleLower, assignedFields) {
    const mappings = {
        basics: ['basic information', 'basic info', 'basics', 'basic', '기본 정보', '기본정보', '기본'],
        appearance: ['physical appearance', 'appearance', 'look', 'looks', 'physical', '외모', '외형'],
        background: ['background', 'backstory', 'history', 'origin', '배경', '과거'],
        personality: ['personality', 'temperament', '성격', '인격'],
        skills: ['skills and abilities', 'skills abilities', 'skills', 'skill', 'abilities', 'ability', '능력 기술', '능력', '기술', '스킬'],
        relationships: ['relationships', 'relationship', 'relation', '관계'],
        speech: ['speech examples', 'speech pattern', 'speech patterns', 'speech', 'dialogue', '말투 대사', '말투', '대사'],
        quirks: ['quirks and habits', 'quirks habits', 'quirks', 'habits', '버릇 습관', '버릇', '습관'],
        nsfw_appearance: ['nsfw appearance', 'nsfw 외모', 'intimate appearance', 'intimate physical', 'nsfw'],
        sexual_preferences: ['romantic and sexual preferences', 'romantic sexual preferences', 'sexual preferences', 'romantic preferences', 'sexual behavior', '성적 취향', '로맨틱 성적', '성적'],
        hidden_desires: ['hidden desires and guilt', 'hidden desires guilt', 'hidden desires', 'hidden desire', 'secret desires', '숨겨진 욕망 죄책감', '숨겨진 욕망', '내적 갈등', '숨겨진', '욕망'],
        ai_guidelines: ['ai guidelines', 'ai guideline', 'guidelines for ai', 'ai 가이드라인', 'ai 가이드', 'guidelines', 'guideline'],
        character_notes: ['character notes', 'additional notes', 'notes', 'misc', '캐릭터 노트', '추가 참고사항', '참고사항', '참고', '노트'],
    };

    let bestMatch = null;
    let bestLength = 0;

    for (const [fieldId, keywords] of Object.entries(mappings)) {
        // 이미 할당된 필드는 건너뛰기
        if (assignedFields && assignedFields.has(fieldId)) continue;

        for (const kw of keywords) {
            if (titleLower.includes(kw) && kw.length > bestLength) {
                bestMatch = fieldId;
                bestLength = kw.length;
            }
        }
    }

    return bestMatch;
}

/**
 * sections 객체에서 fullText 재조합
 */
function rebuildFullText() {
    if (!state.currentGeneration) return;

    if (state.currentGeneration.isCustomSheet) {
        const section = state.currentGeneration.sections._custom;
        state.currentGeneration.fullText = section?.content || '';
        return;
    }

    const fields = getActiveFields();
    const parts = [];

    for (const fieldId of fields) {
        const section = state.currentGeneration.sections[fieldId];
        if (section?.content) {
            parts.push(section.content);
        }
    }

    state.currentGeneration.fullText = parts.join('\n\n');
}

/**
 * 전체 텍스트를 직접 수정한 후 섹션 재파싱
 * @param {string} newText - 수정된 전체 텍스트
 */
export function updateFromEditedText(newText) {
    if (!state.currentGeneration) return;

    state.currentGeneration.fullText = newText;

    if (state.currentGeneration.isCustomSheet) {
        state.currentGeneration.sections = { _custom: { header: '', content: newText } };
    } else {
        const fields = Object.keys(state.currentGeneration.sections);
        state.currentGeneration.sections = parseResponse(newText, fields);
    }
}

// ===== 프로필 부분 수정 (커스텀 시트 모드 전용) =====

/**
 * 현재 프로필을 자유 지시문으로 부분 수정
 * @param {string} instructions - 수정 지시사항
 * @returns {Promise<Object>} 업데이트된 생성 데이터
 */
export async function modifyProfile(instructions) {
    if (!state.currentGeneration?.fullText) {
        throw new Error('수정할 프로필이 없습니다.');
    }
    if (!instructions.trim()) {
        throw new Error('수정 지시사항을 입력해주세요.');
    }

    setGenerating(true);

    try {
        const language = state.currentGeneration.language || 'en';
        const langInfo = LANGUAGES[language] || LANGUAGES.en;

        let userPrompt = `## Current Profile\n${state.currentGeneration.fullText}`;

        userPrompt += `\n\n## Modification Instructions\n${instructions}`;

        userPrompt += `\n\n## Language\n${langInfo.instruction}`;

        userPrompt += `\n\nApply the requested modifications and output the complete updated profile.`;

        log(`Modifying profile: ${instructions.substring(0, 50)}...`);

        const response = await callGenerationAPI(MODIFY_SYSTEM_PROMPT, userPrompt);

        if (!response || !response.trim()) {
            throw new Error('API에서 빈 응답을 받았습니다.');
        }

        // 수정된 내용으로 업데이트 (출력 후처리 적용)
        const cleanedModified = cleanGeneratedText(response);
        if (state.currentGeneration.isCustomSheet) {
            state.currentGeneration.sections = { _custom: { header: '', content: cleanedModified } };
        } else {
            const fields = Object.keys(state.currentGeneration.sections);
            state.currentGeneration.sections = parseResponse(cleanedModified, fields);
        }
        state.currentGeneration.fullText = cleanedModified;

        log('Profile modified successfully');
        return state.currentGeneration;

    } finally {
        setGenerating(false);
    }
}
