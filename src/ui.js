/**
 * 페르소나 대장간 - UI 로직
 */

import { getContext, extension_settings } from "../../../../extensions.js";
import { saveSettingsDebounced } from "../../../../../script.js";
import {
    extensionName, extensionFolderPath,
    PROFILE_FIELDS, TEMPLATE_PRESETS, LANGUAGES,
    SYSTEM_PROMPT,
    defaultSettings,
} from './constants.js';
import { state, log, logError, getSettings } from './state.js';
import { updateSetting, saveToHistory, getHistory, deleteFromHistory, clearHistory } from './storage.js';
import { getConnectionProfiles } from './api.js';
import { loadCharacterWorldInfo, getAvailableWorldInfoBooks, loadWorldInfoBookEntries } from './worldinfo.js';
import { generatePersona, regenerateSection, regenerateAll, translateProfile, updateFromEditedText, modifyProfile } from './generator.js';

// ===== 편집 모드 상태 =====
let isEditMode = false;

// ===== 팝업 로드 및 초기화 =====

/**
 * 팝업 HTML 로드 및 body에 추가
 * @returns {Promise<boolean>}
 */
export async function loadPopupHtml() {
    try {
        const html = await $.get(`${extensionFolderPath}/popup.html`);
        $('body').append(html);
        log('Popup HTML loaded');
        return true;
    } catch (error) {
        logError('loadPopupHtml', error);
        return false;
    }
}

/**
 * 확장 메뉴 버튼 추가
 */
export function addExtensionMenuButton() {
    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        setTimeout(addExtensionMenuButton, 2000);
        return;
    }

    // 이미 추가되어 있으면 스킵
    if (document.getElementById('pf-menu-btn')) return;

    const menuItem = document.createElement('div');
    menuItem.id = 'pf-menu-btn';
    menuItem.className = 'list-group-item flex-container flexGap5 interactable';
    menuItem.innerHTML = `
        <div class="fa-solid fa-hammer extensionsMenuExtensionButton"></div>
        페르소나 대장간
    `;
    menuItem.addEventListener('click', () => {
        openPopup();
        $('#extensionsMenu').hide();
    });
    extensionsMenu.appendChild(menuItem);
    log('Extension menu button added');
}

/**
 * UI 이벤트 바인딩
 */
export function bindUIEvents() {
    // 닫기
    $(document).on('click', '#pf-close-btn', closePopup);

    // 배경 클릭으로 닫기
    $(document).on('click', '#persona-forge-popup', (e) => {
        if (e.target.id === 'persona-forge-popup') closePopup();
    });

    // ESC로 닫기
    $(document).on('keydown', (e) => {
        if (e.key === 'Escape' && $('#persona-forge-popup').hasClass('open')) {
            closePopup();
        }
    });

    // 탭 전환
    $(document).on('click', '.pf-tab', function () {
        const tab = $(this).data('tab');
        switchTab(tab);
    });

    // === 설정 탭 이벤트 ===

    // 캐릭터 선택
    $(document).on('change', '#pf-char-select', onCharacterSelect);

    // 월드인포 토글
    $(document).on('change', '#pf-wi-toggle', onWorldInfoToggle);

    // WI 모두 선택 / 해제
    $(document).on('click', '#pf-wi-select-all', () => toggleAllWIEntries(true));
    $(document).on('click', '#pf-wi-deselect-all', () => toggleAllWIEntries(false));

    // WI 검색
    $(document).on('input', '#pf-wi-search', onWISearch);

    // WI 엔트리 개별 체크
    $(document).on('change', '.pf-wi-entry-cb', onWIEntryToggle);

    // WI 북 선택
    $(document).on('change', '#pf-wi-book-select', onWIBookSelect);

    // 생성 모드 변경
    $(document).on('change', 'input[name="pf-gen-mode"]', onModeChange);

    // API 프로필 변경
    $(document).on('change', '#pf-api-profile', function () {
        updateSetting('connectionProfile', $(this).val());
    });

    // 템플릿 변경
    $(document).on('change', '#pf-template-select', onTemplateChange);

    // 언어 변경
    $(document).on('change', '#pf-language', function () {
        updateSetting('language', $(this).val());
    });

    // 커스텀 필드 체크박스
    $(document).on('change', '.pf-custom-field-cb', onCustomFieldToggle);

    // 생성 버튼
    $(document).on('click', '#pf-generate-btn', onGenerateClick);

    // === 생성 탭 이벤트 ===

    // 전체 재생성 토글
    $(document).on('click', '#pf-regen-all-btn', () => {
        $('#pf-regen-all-panel').toggle();
        $('#pf-translate-panel').hide();
    });

    // 전체 재생성 실행
    $(document).on('click', '#pf-regen-all-go', onRegenAllClick);
    $(document).on('click', '#pf-regen-all-cancel', () => $('#pf-regen-all-panel').hide());

    // 편집 모드 전환
    $(document).on('click', '#pf-edit-toggle-btn', toggleEditMode);

    // 편집 적용
    $(document).on('click', '#pf-edit-apply', applyEdit);

    // 번역 토글
    $(document).on('click', '#pf-translate-btn', () => {
        $('#pf-translate-panel').toggle();
        $('#pf-regen-all-panel').hide();
    });

    // 번역 실행
    $(document).on('click', '#pf-translate-go', onTranslateClick);
    $(document).on('click', '#pf-translate-cancel', () => $('#pf-translate-panel').hide());

    // 섹션 재생성 버튼
    $(document).on('click', '.pf-section-regen-btn', onSectionRegenToggle);
    $(document).on('click', '.pf-section-regen-go', onSectionRegenClick);
    $(document).on('click', '.pf-section-regen-cancel', function () {
        $(this).closest('.pf-section-regen-panel').hide();
    });

    // 섹션 개별 편집
    $(document).on('click', '.pf-section-edit-btn', onSectionEditToggle);
    $(document).on('click', '.pf-section-edit-save', onSectionEditSave);
    $(document).on('click', '.pf-section-edit-cancel', onSectionEditCancel);

    // 테마 토글
    $(document).on('change', '#pf-theme-toggle', onThemeToggle);

    // 클립보드 복사
    $(document).on('click', '#pf-copy-btn', onCopyClick);

    // 현재 페르소나에 적용
    $(document).on('click', '#pf-apply-persona-btn', onApplyPersonaClick);

    // 히스토리 저장
    $(document).on('click', '#pf-save-history-btn', onSaveHistoryClick);

    // === 히스토리 탭 이벤트 ===
    $(document).on('click', '.pf-history-load', onHistoryLoad);
    $(document).on('click', '.pf-history-copy', onHistoryCopy);
    $(document).on('click', '.pf-history-delete', onHistoryDelete);
    $(document).on('click', '#pf-history-clear', onHistoryClear);

    // === 수정 지시 이벤트 (커스텀 시트 모드) ===
    $(document).on('click', '#pf-modify-toggle-btn', () => {
        $('#pf-modify-panel').toggle();
    });
    $(document).on('click', '#pf-modify-go', onModifyClick);
    $(document).on('click', '#pf-modify-cancel', () => $('#pf-modify-panel').hide());

    // 시트 템플릿 저장
    $(document).on('input', '#pf-sheet-text', function () {
        updateSetting('sheetTemplate', $(this).val());
    });

    // === 프롬프트 탭 이벤트 ===
    $(document).on('click', '#pf-prompt-reset', onPromptReset);
    $(document).on('click', '#pf-prompt-apply', onPromptApply);
    $(document).on('click', '#pf-prompt-preset-save', onPromptPresetSave);
    $(document).on('click', '#pf-prompt-preset-load', onPromptPresetLoad);
    $(document).on('click', '#pf-prompt-preset-delete', onPromptPresetDelete);

    log('UI events bound');
}

// ===== 팝업 열기/닫기 =====

export function openPopup() {
    populateCharacterDropdown();
    populateAPIProfiles();
    updateSettingsUI();
    updateHistoryUI();
    updatePromptUI();
    $('#persona-forge-popup').addClass('open');
}

export function closePopup() {
    $('#persona-forge-popup').removeClass('open');
}

function switchTab(tabName) {
    $('.pf-tab').removeClass('active');
    $(`.pf-tab[data-tab="${tabName}"]`).addClass('active');
    $('.pf-tab-content').removeClass('active');
    $(`#pf-${tabName}-tab`).addClass('active');

    if (tabName === 'history') updateHistoryUI();
}

// ===== 설정 UI 업데이트 =====

function updateSettingsUI() {
    const settings = getSettings();
    if (!settings) return;

    // 모드
    $(`input[name="pf-gen-mode"][value="${settings.generationMode}"]`).prop('checked', true);
    $('#pf-guided-input').toggle(settings.generationMode === 'guided');

    // 템플릿
    $('#pf-template-select').val(settings.templatePreset || 'standard');
    updateTemplateDisplay();

    // 언어
    $('#pf-language').val(settings.language || 'en');

    // API 프로필
    $('#pf-api-profile').val(settings.connectionProfile || '');

    // WI 토글
    $('#pf-wi-toggle').prop('checked', settings.includeWorldInfo);
    $('#pf-wi-container').toggle(settings.includeWorldInfo);

    // 시트 템플릿 복원
    $('#pf-sheet-text').val(settings.sheetTemplate || '');

    // 테마
    const theme = settings.theme || 'dark';
    $('#pf-theme-toggle').prop('checked', theme === 'light');
    applyTheme(theme);
}

// ===== 캐릭터 관련 =====

function populateCharacterDropdown() {
    const context = getContext();
    const chars = context.characters || [];
    const $select = $('#pf-char-select');

    $select.empty();
    $select.append('<option value="-1">캐릭터를 선택하세요...</option>');

    chars.forEach((char, idx) => {
        if (!char || !char.name) return;
        const name = char.name;
        $select.append(`<option value="${idx}">${name}</option>`);
    });

    // 현재 채팅 중인 캐릭터가 있으면 자동 선택
    if (context.characterId !== undefined && context.characterId >= 0) {
        $select.val(context.characterId);
        onCharacterSelect();
    }
}

async function onCharacterSelect() {
    const charIndex = parseInt($('#pf-char-select').val(), 10);
    const context = getContext();

    if (charIndex < 0 || !context.characters?.[charIndex]) {
        state.selectedCharIndex = -1;
        state.selectedCharData = null;
        state.loadedWIEntries = [];
        state.selectedWIEntries.clear();
        updateWIEntryList();
        return;
    }

    const char = context.characters[charIndex];
    state.selectedCharIndex = charIndex;
    state.selectedCharData = char;

    // WI 엔트리 로드
    if ($('#pf-wi-toggle').prop('checked')) {
        await populateWIBookDropdown();
        await loadAndDisplayWIEntries(charIndex);
    }
}

// ===== 월드인포 관련 =====

async function onWorldInfoToggle() {
    const enabled = $('#pf-wi-toggle').prop('checked');
    updateSetting('includeWorldInfo', enabled);
    $('#pf-wi-container').toggle(enabled);

    if (enabled) {
        await populateWIBookDropdown();
        if (state.selectedCharIndex >= 0) {
            await loadAndDisplayWIEntries(state.selectedCharIndex);
        }
    }
}

/**
 * WI 북 드롭다운에 사용 가능한 북 목록 채우기
 */
async function populateWIBookDropdown() {
    const $select = $('#pf-wi-book-select');
    const currentVal = $select.val();

    $select.empty();
    $select.append('<option value="__char__">캐릭터 연결 월드인포</option>');

    try {
        const books = await getAvailableWorldInfoBooks();
        log(`WI book list: ${books.length} books found`);
        for (const bookName of books) {
            const $opt = $('<option></option>').val(bookName).text(bookName);
            $select.append($opt);
        }
    } catch (e) {
        logError('populateWIBooks', e);
    }

    // 이전 선택 복원
    if (currentVal && $select.find('option').filter(function() { return $(this).val() === currentVal; }).length) {
        $select.val(currentVal);
    } else {
        $select.val('__char__');
    }
}

/**
 * WI 북 선택 변경 시
 */
async function onWIBookSelect() {
    const selected = $('#pf-wi-book-select').val();
    const $list = $('#pf-wi-entry-list');
    $list.html('<div class="pf-wi-empty">로딩 중...</div>');

    try {
        let entries;
        if (selected === '__char__') {
            // 캐릭터 연결 WI
            if (state.selectedCharIndex >= 0) {
                entries = await loadCharacterWorldInfo(state.selectedCharIndex);
            } else {
                entries = [];
            }
        } else {
            // 직접 선택한 WI 북
            entries = await loadWorldInfoBookEntries(selected);
        }

        state.loadedWIEntries = entries;
        state.selectedWIEntries.clear();
        entries.forEach((_, idx) => {
            state.selectedWIEntries.add(idx);
        });
        updateWIEntryList();
    } catch (error) {
        logError('onWIBookSelect', error);
        $list.html('<div class="pf-wi-empty">월드인포를 불러올 수 없습니다.</div>');
    }
}

async function loadAndDisplayWIEntries(charIndex) {
    const $list = $('#pf-wi-entry-list');
    const selectedBook = $('#pf-wi-book-select').val();

    // 캐릭터 연결 모드일 때만 자동 로드
    if (selectedBook && selectedBook !== '__char__') return;

    $list.html('<div class="pf-wi-empty">로딩 중...</div>');

    try {
        const entries = await loadCharacterWorldInfo(charIndex);
        state.loadedWIEntries = entries;

        // 기본적으로 모든 엔트리 선택
        state.selectedWIEntries.clear();
        entries.forEach((_, idx) => {
            state.selectedWIEntries.add(idx);
        });

        updateWIEntryList();
    } catch (error) {
        logError('loadWI', error);
        $list.html('<div class="pf-wi-empty">월드인포를 불러올 수 없습니다.</div>');
    }
}

function updateWIEntryList() {
    const $list = $('#pf-wi-entry-list');
    const entries = state.loadedWIEntries;

    if (!entries.length) {
        $list.html('<div class="pf-wi-empty">사용 가능한 엔트리가 없습니다.</div>');
        return;
    }

    const searchTerm = ($('#pf-wi-search').val() || '').toLowerCase();

    let html = '';
    entries.forEach((entry, idx) => {
        const name = entry.comment || entry.keys?.join(', ') || `엔트리 ${idx + 1}`;
        const keys = Array.isArray(entry.keys) ? entry.keys.join(', ') : '';
        const preview = (entry.content || '').substring(0, 80);
        const checked = state.selectedWIEntries.has(idx) ? 'checked' : '';
        const source = entry.source || '';

        // 검색 필터
        if (searchTerm) {
            const searchTarget = `${name} ${keys} ${entry.content || ''}`.toLowerCase();
            if (!searchTarget.includes(searchTerm)) return;
        }

        html += `
        <div class="pf-wi-entry">
            <input type="checkbox" class="pf-wi-entry-cb" data-idx="${idx}" ${checked}>
            <div class="pf-wi-entry-info">
                <div class="pf-wi-entry-name">${escapeHtml(name)}</div>
                ${keys ? `<div class="pf-wi-entry-keys"><i class="fa-solid fa-key"></i> ${escapeHtml(keys)}</div>` : ''}
                <div class="pf-wi-entry-preview">${escapeHtml(preview)}${entry.content?.length > 80 ? '...' : ''}</div>
            </div>
            ${source ? `<span class="pf-wi-entry-source">${escapeHtml(source)}</span>` : ''}
        </div>`;
    });

    $list.html(html || '<div class="pf-wi-empty">검색 결과 없음</div>');
}

function toggleAllWIEntries(selectAll) {
    state.loadedWIEntries.forEach((_, idx) => {
        if (selectAll) {
            state.selectedWIEntries.add(idx);
        } else {
            state.selectedWIEntries.delete(idx);
        }
    });
    updateWIEntryList();
}

function onWISearch() {
    updateWIEntryList();
}

function onWIEntryToggle() {
    const idx = parseInt($(this).data('idx'), 10);
    if ($(this).prop('checked')) {
        state.selectedWIEntries.add(idx);
    } else {
        state.selectedWIEntries.delete(idx);
    }
}

// ===== 생성 모드 =====

function onModeChange() {
    const mode = $('input[name="pf-gen-mode"]:checked').val();
    updateSetting('generationMode', mode);
    $('#pf-guided-input').toggle(mode === 'guided');
}

// ===== 테마 =====

function onThemeToggle() {
    const isLight = $(this).prop('checked');
    const theme = isLight ? 'light' : 'dark';
    updateSetting('theme', theme);
    applyTheme(theme);
}

function applyTheme(theme) {
    const $popup = $('#persona-forge-popup');
    if (theme === 'light') {
        $popup.addClass('pf-light');
    } else {
        $popup.removeClass('pf-light');
    }
}

// ===== API 프로필 =====

function populateAPIProfiles() {
    const profiles = getConnectionProfiles();
    const $select = $('#pf-api-profile');
    const currentVal = getSettings()?.connectionProfile || '';

    $select.empty();
    $select.append('<option value="">현재 연결 사용</option>');

    for (const profile of profiles) {
        $select.append(`<option value="${profile.id}">${escapeHtml(profile.name)}</option>`);
    }

    $select.val(currentVal);
}

// ===== 템플릿 =====

function onTemplateChange() {
    const presetId = $('#pf-template-select').val();
    updateSetting('templatePreset', presetId);
    updateTemplateDisplay();
}

function updateTemplateDisplay() {
    const presetId = getSettings()?.templatePreset || 'standard';
    const isChoice = presetId === 'choice';
    const isCustomSheet = presetId === 'custom';

    // 프리셋 설명
    const preset = TEMPLATE_PRESETS[presetId];
    if (preset) {
        $('#pf-template-desc').text(preset.description);
    } else if (isChoice) {
        $('#pf-template-desc').text('원하는 필드를 직접 선택하세요.');
    } else if (isCustomSheet) {
        $('#pf-template-desc').text('나만의 프로필 시트 양식을 직접 입력하세요.');
    }

    // Choice 패널 (필드 선택)
    $('#pf-custom-panel').toggle(isChoice);

    // Custom 시트 패널
    $('#pf-sheet-panel').toggle(isCustomSheet);

    // 필드 태그 표시
    const $tags = $('#pf-template-fields');
    $tags.empty();

    if (!isCustomSheet) {
        const fields = isChoice
            ? (getSettings()?.customFields || [])
            : (preset?.fields || []);

        fields.forEach(fieldId => {
            const field = PROFILE_FIELDS[fieldId];
            if (!field) return;
            const nsfwClass = field.nsfw ? ' nsfw' : '';
            $tags.append(`<span class="pf-field-tag${nsfwClass}"><i class="${field.icon}"></i> ${field.label}</span>`);
        });
    }

    // Choice 필드 체크박스 렌더
    if (isChoice) {
        renderCustomFieldList();
    }
}

function renderCustomFieldList() {
    const customFields = getSettings()?.customFields || [];
    const $list = $('#pf-custom-field-list');
    $list.empty();

    for (const [fieldId, field] of Object.entries(PROFILE_FIELDS)) {
        const checked = customFields.includes(fieldId) ? 'checked' : '';
        const nsfwClass = field.nsfw ? ' nsfw-field' : '';

        $list.append(`
        <label class="pf-custom-field-item${nsfwClass}">
            <input type="checkbox" class="pf-custom-field-cb" data-field="${fieldId}" ${checked}>
            <span class="pf-field-icon"><i class="${field.icon}"></i></span>
            <span class="pf-field-name">${field.label}</span>
            <span class="pf-field-desc-text">${field.descriptionKo}</span>
        </label>`);
    }
}

function onCustomFieldToggle() {
    const customFields = [];
    $('.pf-custom-field-cb:checked').each(function () {
        customFields.push($(this).data('field'));
    });
    updateSetting('customFields', customFields);
    updateTemplateDisplay();
}

// ===== 생성 =====

async function onGenerateClick() {
    if (state.isGenerating) return;

    if (state.selectedCharIndex < 0) {
        showToast('warning', '캐릭터를 먼저 선택해주세요.');
        return;
    }

    const settings = getSettings();
    const conceptText = $('#pf-concept-text').val() || '';
    const sheetTemplate = $('#pf-sheet-text').val() || '';

    // 커스텀 시트 밸리데이션
    if (settings.templatePreset === 'custom' && !sheetTemplate.trim()) {
        showToast('warning', '커스텀 시트를 입력해주세요.');
        return;
    }

    // Choice 밸리데이션
    if (settings.templatePreset === 'choice' && (!settings.customFields || !settings.customFields.length)) {
        showToast('warning', '최소 하나의 필드를 선택해주세요.');
        return;
    }

    try {
        // UI 상태 전환
        switchTab('generate');
        showGenerateLoading(true);

        const result = await generatePersona({ conceptText, sheetTemplate });

        // 결과 렌더링
        renderGenerationResult(result);
        showToast('success', '페르소나가 생성되었습니다!');

    } catch (error) {
        logError('generate', error);
        showToast('error', `생성 실패: ${error.message}`);
        showGenerateLoading(false);
    }
}

function showGenerateLoading(show) {
    $('#pf-gen-loading').toggle(show);
    $('#pf-gen-empty').toggle(!show && !state.currentGeneration);
    $('#pf-gen-result').toggle(!show && !!state.currentGeneration);
    $('#pf-generate-btn').prop('disabled', show);

    if (show) {
        isEditMode = false;
        $('#pf-edit-area').hide();
        $('#pf-sections-container').show();
    }
}

function renderGenerationResult(data) {
    if (!data) return;

    showGenerateLoading(false);
    $('#pf-gen-empty').hide();
    $('#pf-gen-result').show();

    // 정보 바
    const langLabel = LANGUAGES[data.language]?.label || data.language;
    let templateLabel;
    if (data.templateId === 'custom') {
        templateLabel = 'Custom (커스텀 시트)';
    } else if (data.templateId === 'choice') {
        templateLabel = 'Choice (선택)';
    } else {
        templateLabel = TEMPLATE_PRESETS[data.templateId]?.label || data.templateId;
    }
    $('#pf-result-char-name').html(`<i class="fa-solid fa-user"></i> ${escapeHtml(data.charName)}`);
    $('#pf-result-template').text(templateLabel);
    $('#pf-result-lang').text(langLabel);

    // 섹션 카드 렌더 (or 커스텀 블록)
    if (data.isCustomSheet) {
        renderCustomResultBlock(data.fullText);
    } else {
        renderSectionCards(data.sections);
    }

    // 편집 모드 리셋
    isEditMode = false;
    $('#pf-edit-toggle-btn').html('<i class="fa-solid fa-pen"></i> 편집');
    $('#pf-edit-area').hide();
    $('#pf-sections-container').show();

    // 패널 숨김
    $('#pf-regen-all-panel').hide();
    $('#pf-translate-panel').hide();
}

function renderSectionCards(sections) {
    const $container = $('#pf-sections-container');
    $container.empty();

    // PROFILE_FIELDS 정의 순서대로 렌더 (일관된 순서 보장 + 보너스 섹션 표시)
    for (const fieldId of Object.keys(PROFILE_FIELDS)) {
        const section = sections[fieldId];
        if (!section) continue;

        const field = PROFILE_FIELDS[fieldId];

        const content = section.content || '';
        // 헤더 부분을 제거하고 본문만 표시 (선행 빈줄/공백 확실히 제거)
        const displayContent = content.replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
        const isEmpty = !displayContent;

        const bodyContent = isEmpty ? '(이 섹션은 비어있습니다. 재생성을 시도해주세요.)' : escapeHtml(displayContent);

        $container.append(`
        <div class="pf-section-card" data-field="${fieldId}">
            <div class="pf-section-card-header">
                <span class="pf-section-icon"><i class="${field.icon}"></i></span>
                <span class="pf-section-label">${field.labelEn}</span>
                <button class="pf-section-edit-btn" title="이 섹션 편집" data-field="${fieldId}"><i class="fa-solid fa-pen"></i></button>
                <button class="pf-section-regen-btn" title="이 섹션 재생성" data-field="${fieldId}"><i class="fa-solid fa-arrows-rotate"></i></button>
            </div>
            <div class="pf-section-card-body${isEmpty ? ' empty' : ''}">${bodyContent}</div>
            <div class="pf-section-regen-panel" style="display: none;">
                <textarea placeholder="추가 지시사항 (선택사항)...&#10;예: 좀 더 쿨한 성격으로, 키를 작게 변경해줘"></textarea>
                <div class="pf-section-regen-actions">
                    <button class="pf-section-regen-go pf-primary-btn pf-small-btn" data-field="${fieldId}">재생성</button>
                    <button class="pf-section-regen-cancel pf-small-btn">취소</button>
                </div>
            </div>
        </div>`);
    }
}

/**
 * 커스텀 시트 모드 결과 렌더링 (단일 블록 + 수정 지시 버튼)
 */
function renderCustomResultBlock(fullText) {
    const $container = $('#pf-sections-container');
    $container.empty();

    $container.append(`
    <div class="pf-custom-result-block">
        <div class="pf-section-card">
            <div class="pf-section-card-header">
                <span class="pf-section-icon"><i class="fa-solid fa-file-lines"></i></span>
                <span class="pf-section-label">CUSTOM PROFILE</span>
            </div>
            <div class="pf-section-card-body">${escapeHtml(fullText.trim())}</div>
        </div>
    </div>
    <div class="pf-modify-section" style="margin-top: 10px;">
        <button id="pf-modify-toggle-btn" class="pf-btn" style="width: 100%"><i class="fa-solid fa-pen-to-square"></i> 수정 지시</button>
        <div id="pf-modify-panel" class="pf-inline-panel" style="display: none; margin-top: 8px;">
            <textarea id="pf-modify-instructions" class="pf-textarea" rows="3"
                placeholder="수정할 내용을 자유롭게 입력하세요...&#10;예: 이름을 순하게 바꿔줘&#10;예: 성격을 좀 더 쿨하게 바꿔줘&#10;예: NSFW 부분을 더 자극적으로"></textarea>
            <div class="pf-inline-panel-actions">
                <button id="pf-modify-go" class="pf-primary-btn pf-small-btn">수정 실행</button>
                <button id="pf-modify-cancel" class="pf-small-btn">취소</button>
            </div>
        </div>
    </div>`);
}

// ===== 프로필 수정 (커스텀 시트 모드) =====

async function onModifyClick() {
    if (state.isGenerating) return;

    const instructions = $('#pf-modify-instructions').val() || '';
    if (!instructions.trim()) {
        showToast('warning', '수정 지시사항을 입력해주세요.');
        return;
    }

    try {
        showGenerateLoading(true);
        $('#pf-gen-loading-text').text('프로필 수정 중...');
        $('#pf-modify-panel').hide();

        const result = await modifyProfile(instructions);
        renderGenerationResult(result);
        showToast('success', '프로필이 수정되었습니다!');

    } catch (error) {
        logError('modify', error);
        showToast('error', `수정 실패: ${error.message}`);
        showGenerateLoading(false);
        $('#pf-gen-loading-text').text('페르소나를 대장간에서 벼려내는 중...');
    }
}

// ===== 섹션 재생성 =====

function onSectionRegenToggle() {
    const $card = $(this).closest('.pf-section-card');
    const $panel = $card.find('.pf-section-regen-panel');

    // 편집 패널이 열려있으면 닫기
    const $editPanel = $card.find('.pf-section-edit-panel');
    if ($editPanel.length) {
        $editPanel.remove();
        $card.find('.pf-section-card-body').show();
    }

    $panel.toggle();
}

async function onSectionRegenClick() {
    if (state.isGenerating) return;

    const fieldId = $(this).data('field');
    const $card = $(`.pf-section-card[data-field="${fieldId}"]`);
    const instructions = $card.find('.pf-section-regen-panel textarea').val() || '';

    try {
        $card.find('.pf-section-card-body').html('<div class="pf-loading" style="padding:10px"><div class="pf-spinner" style="width:24px;height:24px"></div></div>');
        $card.find('.pf-section-regen-panel').hide();

        const result = await regenerateSection(fieldId, instructions);

        // 해당 섹션만 업데이트
        const section = result.sections[fieldId];
        const displayContent = (section?.content || '').replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
        $card.find('.pf-section-card-body')
            .removeClass('empty')
            .html(displayContent ? escapeHtml(displayContent) : '<em>(비어있음)</em>');

        showToast('success', `${PROFILE_FIELDS[fieldId]?.label || fieldId} 섹션이 재생성되었습니다.`);

    } catch (error) {
        logError('regenSection', error);
        showToast('error', `재생성 실패: ${error.message}`);
        // 원래 내용 복원
        if (state.currentGeneration?.sections[fieldId]) {
            const content = state.currentGeneration.sections[fieldId].content.replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
            $card.find('.pf-section-card-body').html(escapeHtml(content));
        }
    }
}

// ===== 섹션 개별 편집 =====

function onSectionEditToggle() {
    const fieldId = $(this).data('field');
    const $card = $(`.pf-section-card[data-field="${fieldId}"]`);
    const $body = $card.find('.pf-section-card-body');
    const $existingEdit = $card.find('.pf-section-edit-panel');

    // 재생성 패널 닫기
    $card.find('.pf-section-regen-panel').hide();

    // 토글 - 이미 편집 중이면 닫기
    if ($existingEdit.length) {
        $existingEdit.remove();
        $body.show();
        return;
    }

    const section = state.currentGeneration?.sections[fieldId];
    if (!section) return;
    const rawContent = (section.content || '').replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();

    $body.hide();

    const editPanel = `
    <div class="pf-section-edit-panel">
        <textarea class="pf-section-edit-textarea pf-textarea">${escapeHtml(rawContent)}</textarea>
        <div class="pf-section-edit-actions">
            <button class="pf-section-edit-save pf-primary-btn pf-small-btn" data-field="${fieldId}"><i class="fa-solid fa-check"></i> 저장</button>
            <button class="pf-section-edit-cancel pf-btn pf-small-btn" data-field="${fieldId}">취소</button>
        </div>
    </div>`;

    $body.after(editPanel);
}

function onSectionEditSave() {
    const fieldId = $(this).data('field');
    const $card = $(`.pf-section-card[data-field="${fieldId}"]`);
    const newText = $card.find('.pf-section-edit-textarea').val().trim();
    const field = PROFILE_FIELDS[fieldId];

    if (state.currentGeneration?.sections[fieldId]) {
        // 헤더 포함하여 섹션 내용 업데이트
        state.currentGeneration.sections[fieldId].content = `## ${field.labelEn}\n${newText}`;

        // fullText 재조합
        const parts = [];
        for (const fId of Object.keys(state.currentGeneration.sections)) {
            const sec = state.currentGeneration.sections[fId];
            if (sec?.content) parts.push(sec.content);
        }
        state.currentGeneration.fullText = parts.join('\n\n');

        // 디스플레이 업데이트
        $card.find('.pf-section-edit-panel').remove();
        const $body = $card.find('.pf-section-card-body');
        $body.html(newText ? escapeHtml(newText) : '<em>(비어있음)</em>')
            .toggleClass('empty', !newText)
            .show();

        showToast('success', `${field?.label || fieldId} 섹션이 수정되었습니다.`);
    }
}

function onSectionEditCancel() {
    const fieldId = $(this).data('field');
    const $card = $(`.pf-section-card[data-field="${fieldId}"]`);
    $card.find('.pf-section-edit-panel').remove();
    $card.find('.pf-section-card-body').show();
}

// ===== 전체 재생성 =====

async function onRegenAllClick() {
    if (state.isGenerating) return;

    const instructions = $('#pf-regen-all-instructions').val() || '';

    try {
        showGenerateLoading(true);
        $('#pf-regen-all-panel').hide();

        const result = await regenerateAll(instructions);
        renderGenerationResult(result);
        showToast('success', '페르소나가 재생성되었습니다!');

    } catch (error) {
        logError('regenAll', error);
        showToast('error', `재생성 실패: ${error.message}`);
        showGenerateLoading(false);
    }
}

// ===== 편집 모드 =====

function toggleEditMode() {
    isEditMode = !isEditMode;

    if (isEditMode) {
        // 열린 섹션 편집 패널 닫기
        $('.pf-section-edit-panel').remove();
        $('.pf-section-card-body').show();

        // 현재 전체 텍스트를 textarea에 로드
        const fullText = state.currentGeneration?.fullText || '';
        $('#pf-edit-textarea').val(fullText);
        $('#pf-sections-container').hide();
        $('#pf-edit-area').show();
        $('#pf-edit-toggle-btn').html('<i class="fa-solid fa-eye"></i> 미리보기');
    } else {
        $('#pf-edit-area').hide();
        $('#pf-sections-container').show();
        $('#pf-edit-toggle-btn').html('<i class="fa-solid fa-pen"></i> 편집');
    }
}

function applyEdit() {
    const newText = $('#pf-edit-textarea').val();
    updateFromEditedText(newText);

    // 미리보기로 전환
    if (state.currentGeneration?.isCustomSheet) {
        renderCustomResultBlock(state.currentGeneration.fullText);
    } else {
        renderSectionCards(state.currentGeneration.sections);
    }
    isEditMode = false;
    $('#pf-edit-area').hide();
    $('#pf-sections-container').show();
    $('#pf-edit-toggle-btn').html('<i class="fa-solid fa-pen"></i> 편집');

    showToast('success', '편집이 적용되었습니다.');
}

// ===== 번역 =====

async function onTranslateClick() {
    if (state.isGenerating) return;

    const targetLang = $('#pf-translate-lang').val();

    try {
        showGenerateLoading(true);
        $('#pf-gen-loading-text').text('번역 중...');
        $('#pf-translate-panel').hide();

        const result = await translateProfile(targetLang);
        renderGenerationResult(result);
        showToast('success', `${LANGUAGES[targetLang]?.label || targetLang}로 번역되었습니다!`);

    } catch (error) {
        logError('translate', error);
        showToast('error', `번역 실패: ${error.message}`);
        showGenerateLoading(false);
        $('#pf-gen-loading-text').text('페르소나를 대장간에서 벼려내는 중...');
    }
}

// ===== 저장/복사 =====

function onCopyClick() {
    const text = state.currentGeneration?.fullText;
    if (!text) {
        showToast('warning', '복사할 내용이 없습니다.');
        return;
    }

    copyToClipboard(text).then(success => {
        if (success) {
            showToast('success', '클립보드에 복사되었습니다.');
        } else {
            showToast('error', '복사에 실패했습니다.');
        }
    });
}

async function onApplyPersonaClick() {
    const text = state.currentGeneration?.fullText;
    if (!text) {
        showToast('warning', '적용할 내용이 없습니다.');
        return;
    }

    // 이름 입력 받기
    const charName = state.currentGeneration?.charName || '';
    const defaultName = `${charName} 페르소나`;
    const personaName = prompt('새 페르소나의 이름을 입력하세요:', defaultName);
    if (!personaName || !personaName.trim()) return;

    try {
        // 필요한 모듈 로드
        const powerUserModule = await import("../../../../power-user.js");
        const { power_user } = powerUserModule;
        const persona_description_positions = powerUserModule.persona_description_positions;
        const scriptModule = await import("../../../../../script.js");

        if (!power_user) {
            throw new Error('power_user를 찾을 수 없습니다.');
        }

        // 고유 avatarId 생성 (ST 내부 패턴: timestamp-asciiName.png)
        const safeName = personaName.trim().replace(/[^a-zA-Z0-9]/g, '') || 'Persona';
        const avatarId = `${Date.now()}-${safeName}.png`;

        // 1) power_user에 페르소나 등록
        power_user.personas = power_user.personas || {};
        power_user.persona_descriptions = power_user.persona_descriptions || {};

        power_user.personas[avatarId] = personaName.trim();
        power_user.persona_descriptions[avatarId] = {
            description: text,
            position: persona_description_positions?.IN_PROMPT ?? 0,
            depth: 2,
            role: 0,
            lorebook: '',
            connections: [],
            title: '',
        };

        // 2) 기본 아바타 이미지 업로드
        try {
            const defaultAvatar = scriptModule.default_user_avatar || '/img/ai4.png';
            const fetchResult = await fetch(defaultAvatar);
            const blob = await fetchResult.blob();
            const file = new File([blob], 'avatar.png', { type: 'image/png' });
            const formData = new FormData();
            formData.append('avatar', file);
            formData.append('overwrite_name', avatarId);

            const headers = typeof scriptModule.getRequestHeaders === 'function'
                ? scriptModule.getRequestHeaders({ omitContentType: true })
                : {};

            await fetch('/api/avatars/upload', {
                method: 'POST',
                headers,
                body: formData,
            });
        } catch (uploadError) {
            log('Avatar upload failed (persona created without avatar): ' + uploadError.message);
        }

        // 3) 설정 저장
        saveSettingsDebounced();

        // 4) 아바타 목록 갱신 시도
        try {
            const personasModule = await import("../../../../personas.js");
            if (typeof personasModule.getUserAvatars === 'function') {
                await personasModule.getUserAvatars(true, avatarId);
            }
        } catch (e) {
            log('Avatar list refresh failed: ' + e.message);
        }

        showToast('success', `새 페르소나 "${personaName.trim()}" 가 생성되었습니다! 페르소나 관리에서 확인하세요.`);

    } catch (error) {
        logError('createPersona', error);
        // 실패 시 클립보드 복사로 폴백
        const copied = await copyToClipboard(text);
        if (copied) {
            showToast('warning', '페르소나 생성에 실패했습니다. 대신 클립보드에 복사되었습니다.');
        } else {
            showToast('error', '페르소나 생성에 실패했습니다.');
        }
    }
}

function onSaveHistoryClick() {
    if (!state.currentGeneration) {
        showToast('warning', '저장할 내용이 없습니다.');
        return;
    }

    // 간단한 이름 입력
    const defaultName = `${state.currentGeneration.charName} 페르소나`;
    const name = prompt('히스토리 이름을 입력하세요:', defaultName);
    if (!name) return;

    saveToHistory({
        name,
        charName: state.currentGeneration.charName,
        fullText: state.currentGeneration.fullText,
        language: state.currentGeneration.language,
        templateId: state.currentGeneration.templateId,
    });

    showToast('success', '히스토리에 저장되었습니다.');
    updateHistoryUI();
}

// ===== 히스토리 =====

function updateHistoryUI() {
    const history = getHistory();
    const $list = $('#pf-history-list');
    const $empty = $('#pf-history-empty');
    const $controls = $('#pf-history-controls');

    if (!history.length) {
        $list.hide();
        $controls.hide();
        $empty.show();
        return;
    }

    $empty.hide();
    $list.show();
    $controls.show();
    $list.empty();

    for (const item of history) {
        const date = new Date(item.timestamp).toLocaleDateString('ko-KR', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
        const langLabel = LANGUAGES[item.language]?.label || item.language;

        $list.append(`
        <div class="pf-history-item" data-id="${item.id}">
            <div class="pf-history-info">
                <div class="pf-history-name">${escapeHtml(item.name)}</div>
                <div class="pf-history-meta">
                    <i class="fa-solid fa-user"></i> ${escapeHtml(item.charName)} · ${langLabel} · ${date}
                </div>
            </div>
            <div class="pf-history-actions">
                <button class="pf-history-load pf-btn pf-small-btn" data-id="${item.id}" title="불러오기"><i class="fa-solid fa-folder-open"></i></button>
                <button class="pf-history-copy pf-btn pf-small-btn" data-id="${item.id}" title="복사"><i class="fa-regular fa-copy"></i></button>
                <button class="pf-history-delete pf-btn pf-small-btn pf-danger-btn" data-id="${item.id}" title="삭제"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>`);
    }
}

function onHistoryLoad() {
    const id = $(this).data('id');
    const history = getHistory();
    const item = history.find(h => h.id === id);
    if (!item) return;

    // 히스토리 항목을 현재 생성 결과로 로드
    const isCustom = item.templateId === 'custom';
    state.currentGeneration = {
        sections: isCustom ? { _custom: { header: '', content: item.fullText } } : parseHistoryText(item.fullText),
        fullText: item.fullText,
        charName: item.charName,
        charIndex: -1,
        templateId: item.templateId,
        language: item.language,
        timestamp: item.timestamp,
        isCustomSheet: isCustom,
    };

    renderGenerationResult(state.currentGeneration);
    switchTab('generate');
    showToast('success', `"${item.name}" 불러왔습니다.`);
}

function onHistoryCopy() {
    const id = $(this).data('id');
    const history = getHistory();
    const item = history.find(h => h.id === id);
    if (!item) return;

    copyToClipboard(item.fullText).then(success => {
        showToast(success ? 'success' : 'error', success ? '클립보드에 복사되었습니다.' : '복사 실패');
    });
}

function onHistoryDelete() {
    const id = $(this).data('id');
    if (!confirm('이 항목을 삭제하시겠습니까?')) return;
    deleteFromHistory(id);
    updateHistoryUI();
    showToast('success', '삭제되었습니다.');
}

function onHistoryClear() {
    if (!confirm('전체 히스토리를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
    clearHistory();
    updateHistoryUI();
    showToast('success', '히스토리가 전체 삭제되었습니다.');
}

/**
 * 히스토리 텍스트를 간단히 섹션으로 파싱
 */
function parseHistoryText(text) {
    const sections = {};
    const headerRegex = /^(#{1,3})\s+(.+)$/gm;
    const matches = [];
    let m;

    while ((m = headerRegex.exec(text)) !== null) {
        matches.push({ title: m[2].trim(), index: m.index, fullMatch: m[0] });
    }

    if (matches.length === 0) {
        sections['full'] = { header: '## PROFILE', content: text };
        return sections;
    }

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
        const content = text.substring(start, end).trim();
        const key = matches[i].title.toLowerCase().replace(/[^a-z]/g, '_').substring(0, 20);
        sections[key] = { header: matches[i].fullMatch, content };
    }

    return sections;
}

// ===== 유틸리티 =====

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(type, message) {
    if (typeof toastr !== 'undefined' && toastr[type]) {
        const opts = type === 'error' ? { timeOut: 7000 } : {};
        toastr[type](message, '페르소나 대장간', opts);
    } else {
        console.log(`[${extensionName}] ${type}: ${message}`);
    }
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // 폴백
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch (e2) {
            return false;
        }
    }
}

// ===== 프롬프트 탭 =====

/**
 * 프롬프트 탭 UI 초기화/업데이트
 */
function updatePromptUI() {
    const settings = getSettings();
    if (!settings) return;

    // 에디터에 현재 커스텀 프롬프트 표시 (비어있으면 기본 프롬프트)
    const currentPrompt = (settings.customSystemPrompt || '').trim();
    $('#pf-prompt-editor').val(currentPrompt || SYSTEM_PROMPT);

    // 프리셋 드롭다운 업데이트
    populatePromptPresets();
}

/**
 * 프리셋 드롭다운 갱신
 */
function populatePromptPresets() {
    const settings = getSettings();
    const presets = settings?.promptPresets || [];
    const $select = $('#pf-prompt-preset-select');

    $select.empty();
    $select.append('<option value="">프리셋을 선택하세요...</option>');

    presets.forEach((preset, idx) => {
        $select.append(`<option value="${idx}">${escapeHtml(preset.name)}</option>`);
    });
}

/**
 * 기본 프롬프트로 복원
 */
function onPromptReset() {
    $('#pf-prompt-editor').val(SYSTEM_PROMPT);
    updateSetting('customSystemPrompt', '');
    showToast('success', '기본 시스템 프롬프트로 복원되었습니다.');
}

/**
 * 현재 에디터의 프롬프트를 적용
 */
function onPromptApply() {
    const text = $('#pf-prompt-editor').val().trim();
    if (!text) {
        showToast('warning', '프롬프트가 비어있습니다.');
        return;
    }
    // 기본 프롬프트와 동일하면 커스텀 저장하지 않음
    if (text === SYSTEM_PROMPT.trim()) {
        updateSetting('customSystemPrompt', '');
        showToast('success', '기본 프롬프트가 적용되었습니다.');
    } else {
        updateSetting('customSystemPrompt', text);
        showToast('success', '커스텀 시스템 프롬프트가 적용되었습니다.');
    }
}

/**
 * 현재 에디터 프롬프트를 프리셋으로 저장
 */
function onPromptPresetSave() {
    const name = $('#pf-prompt-preset-name').val().trim();
    if (!name) {
        showToast('warning', '프리셋 이름을 입력하세요.');
        return;
    }
    const prompt = $('#pf-prompt-editor').val().trim();
    if (!prompt) {
        showToast('warning', '프롬프트가 비어있습니다.');
        return;
    }

    const settings = getSettings();
    if (!settings.promptPresets) settings.promptPresets = [];

    // 같은 이름이 있으면 덮어쓰기
    const existIdx = settings.promptPresets.findIndex(p => p.name === name);
    if (existIdx >= 0) {
        settings.promptPresets[existIdx].prompt = prompt;
        showToast('success', `프리셋 "${name}"이(가) 업데이트되었습니다.`);
    } else {
        settings.promptPresets.push({ name, prompt });
        showToast('success', `프리셋 "${name}"이(가) 저장되었습니다.`);
    }

    saveSettingsDebounced();
    populatePromptPresets();
    $('#pf-prompt-preset-name').val('');
}

/**
 * 선택된 프리셋 불러오기
 */
function onPromptPresetLoad() {
    const idx = parseInt($('#pf-prompt-preset-select').val(), 10);
    const settings = getSettings();

    if (isNaN(idx) || !settings?.promptPresets?.[idx]) {
        showToast('warning', '불러올 프리셋을 선택하세요.');
        return;
    }

    const preset = settings.promptPresets[idx];
    $('#pf-prompt-editor').val(preset.prompt);
    showToast('info', `프리셋 "${preset.name}"을(를) 불러왔습니다. "적용" 버튼을 눌러 반영하세요.`);
}

/**
 * 선택된 프리셋 삭제
 */
function onPromptPresetDelete() {
    const idx = parseInt($('#pf-prompt-preset-select').val(), 10);
    const settings = getSettings();

    if (isNaN(idx) || !settings?.promptPresets?.[idx]) {
        showToast('warning', '삭제할 프리셋을 선택하세요.');
        return;
    }

    const name = settings.promptPresets[idx].name;
    settings.promptPresets.splice(idx, 1);
    saveSettingsDebounced();
    populatePromptPresets();
    showToast('success', `프리셋 "${name}"이(가) 삭제되었습니다.`);
}
