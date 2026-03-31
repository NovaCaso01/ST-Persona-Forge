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
import { state, log, logError, getSettings, setCancelled } from './state.js';
import { updateSetting, saveToHistory, getHistory, deleteFromHistory, clearHistory } from './storage.js';
import { getConnectionProfiles } from './api.js';
import { loadCharacterWorldInfo, getAvailableWorldInfoBooks, loadWorldInfoBookEntries } from './worldinfo.js';
import { generatePersona, regenerateSection, regenerateAll, translateProfile, updateFromEditedText, modifyProfile, guessIconForHeader } from './generator.js';

// ===== 편집 모드 상태 =====
let isEditMode = false;

// ===== 로딩 텍스트 로테이션 =====
const LOADING_TEXTS = [
    '페르소나를 대장간에서 벼려내는 중...',
    '성격을 틀에 붓고 단단히 굳히는 중...',
    '개성을 불꽃 속에서 단련하는 중...',
    '설정 충돌을 용광로에 던지는 중...',
];
let loadingTextInterval = null;
let loadingTextIndex = 0;

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

    // WI 북 멀티셀렉트 토글
    $(document).on('click', '#pf-wi-book-toggle', onWIBookDropdownToggle);

    // WI 북 체크박스 토글
    $(document).on('change', '.pf-wi-book-cb', onWIBookCheckToggle);

    // WI 북 드롭다운 외부 클릭 시 닫기
    $(document).on('click', (e) => {
        if (!$(e.target).closest('.pf-wi-book-multi').length) {
            closeWIBookDropdown();
        }
    });

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

    // 생성 취소
    $(document).on('click', '#pf-cancel-gen-btn', onCancelGeneration);

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

    // 자동 저장 토글
    $(document).on('change', '#pf-autosave-toggle', onAutoSaveToggle);

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

    // 히스토리 검색/필터
    $(document).on('input', '#pf-history-search', onHistoryFilterChange);
    $(document).on('change', '#pf-history-filter-lang', onHistoryFilterChange);
    $(document).on('change', '#pf-history-filter-template', onHistoryFilterChange);

    // 히스토리 내보내기/가져오기
    $(document).on('click', '#pf-history-export', onHistoryExport);
    $(document).on('click', '#pf-history-import', onHistoryImport);

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

    // === Choice 필드 커스터마이징 이벤트 ===
    $(document).on('click', '#pf-custom-field-add', onCustomFieldAdd);
    $(document).on('click', '#pf-custom-field-reset', onCustomFieldReset);
    $(document).on('click', '.pf-field-edit-btn', onFieldEditToggle);
    $(document).on('click', '.pf-field-delete-btn', onFieldDelete);
    $(document).on('click', '.pf-field-edit-save', onFieldEditSave);
    $(document).on('click', '.pf-field-edit-cancel', onFieldEditCancel);

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

    // 히스토리 자동 저장
    $('#pf-autosave-toggle').prop('checked', settings.autoSaveHistory || false);

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
        state.selectedWIBooks.clear();
        updateWIEntryList();
        updateWIBookLabel();
        return;
    }

    const char = context.characters[charIndex];
    state.selectedCharIndex = charIndex;
    state.selectedCharData = char;

    // WI 엔트리 로드
    if ($('#pf-wi-toggle').prop('checked')) {
        await populateWIBookDropdown();
        // 캐릭터 연결 WI 자동 선택
        state.selectedWIBooks.clear();
        state.selectedWIBooks.add('__char__');
        updateWIBookCheckboxes();
        updateWIBookLabel();
        await loadAndMergeSelectedBooks();
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
            // 캐릭터 연결 WI 자동 선택
            state.selectedWIBooks.clear();
            state.selectedWIBooks.add('__char__');
            updateWIBookCheckboxes();
            updateWIBookLabel();
            await loadAndMergeSelectedBooks();
        }
    }
}

/**
 * WI 북 멀티셀렉트 드롭다운 토글
 */
function onWIBookDropdownToggle() {
    const $dropdown = $('#pf-wi-book-dropdown');
    const $toggle = $('#pf-wi-book-toggle');
    const isOpen = $dropdown.is(':visible');

    if (isOpen) {
        closeWIBookDropdown();
    } else {
        $dropdown.show();
        $toggle.addClass('open');
    }
}

function closeWIBookDropdown() {
    $('#pf-wi-book-dropdown').hide();
    $('#pf-wi-book-toggle').removeClass('open');
}

/**
 * WI 북 드롭다운에 사용 가능한 북 목록 채우기 (멀티셀렉트 체크박스)
 */
async function populateWIBookDropdown() {
    const $list = $('#pf-wi-book-list');
    $list.empty();

    // 캐릭터 연결 WI (항상 첫 번째)
    $list.append(`
        <div class="pf-wi-book-item">
            <input type="checkbox" class="pf-wi-book-cb" data-book="__char__">
            <span class="pf-wi-book-item-icon"><i class="fa-solid fa-user"></i></span>
            <span class="pf-wi-book-item-label">캐릭터 연결 월드인포</span>
        </div>
    `);

    try {
        const books = await getAvailableWorldInfoBooks();
        log(`WI book list: ${books.length} books found`);
        for (const bookName of books) {
            $list.append(`
                <div class="pf-wi-book-item">
                    <input type="checkbox" class="pf-wi-book-cb" data-book="${escapeHtml(bookName)}">
                    <span class="pf-wi-book-item-icon"><i class="fa-solid fa-book"></i></span>
                    <span class="pf-wi-book-item-label">${escapeHtml(bookName)}</span>
                </div>
            `);
        }
    } catch (e) {
        logError('populateWIBooks', e);
    }

    // 현재 선택 상태 복원
    updateWIBookCheckboxes();
}

/**
 * 체크박스 상태를 state.selectedWIBooks에 맞게 동기화
 */
function updateWIBookCheckboxes() {
    $('.pf-wi-book-cb').each(function () {
        const bookName = $(this).data('book');
        $(this).prop('checked', state.selectedWIBooks.has(bookName));
    });
}

/**
 * 멀티셀렉트 라벨 업데이트
 */
function updateWIBookLabel() {
    const $label = $('#pf-wi-book-label');
    const count = state.selectedWIBooks.size;

    if (count === 0) {
        $label.text('월드인포 북 선택...');
        return;
    }

    // 선택된 북 이름들 수집
    const names = [];
    for (const book of state.selectedWIBooks) {
        if (book === '__char__') {
            names.push('캐릭터 연결');
        } else {
            names.push(book);
        }
    }

    if (names.length <= 2) {
        $label.text(names.join(', '));
    } else {
        $label.text(`${names[0]} 외 ${names.length - 1}개`);
    }
}

/**
 * WI 북 체크박스 토글 시 — 선택된 모든 북의 엔트리를 머지하여 표시
 */
async function onWIBookCheckToggle() {
    const bookName = $(this).data('book');
    const checked = $(this).prop('checked');

    if (checked) {
        state.selectedWIBooks.add(bookName);
    } else {
        state.selectedWIBooks.delete(bookName);
    }

    updateWIBookLabel();
    await loadAndMergeSelectedBooks();
}

/**
 * 선택된 모든 WI 북에서 엔트리를 로드 & 머지 (중복 제거)
 */
async function loadAndMergeSelectedBooks() {
    const $list = $('#pf-wi-entry-list');

    if (state.selectedWIBooks.size === 0) {
        state.loadedWIEntries = [];
        state.selectedWIEntries.clear();
        updateWIEntryList();
        return;
    }

    $list.html('<div class="pf-wi-empty">재료를 수집하는 중...</div>');

    try {
        const allEntries = [];
        const seenHashes = new Set();

        for (const bookName of state.selectedWIBooks) {
            let entries;
            if (bookName === '__char__') {
                if (state.selectedCharIndex >= 0) {
                    entries = await loadCharacterWorldInfo(state.selectedCharIndex);
                } else {
                    entries = [];
                }
            } else {
                entries = await loadWorldInfoBookEntries(bookName);
            }

            // 중복 제거하면서 머지
            for (const entry of entries) {
                const hash = simpleEntryHash(entry);
                if (!seenHashes.has(hash)) {
                    seenHashes.add(hash);
                    allEntries.push(entry);
                }
            }
        }

        state.loadedWIEntries = allEntries;

        // 기본적으로 모든 엔트리 선택
        state.selectedWIEntries.clear();
        allEntries.forEach((_, idx) => {
            state.selectedWIEntries.add(idx);
        });

        updateWIEntryList();
    } catch (error) {
        logError('loadAndMergeBooks', error);
        $list.html('<div class="pf-wi-empty">월드인포를 불러올 수 없습니다.</div>');
    }
}

/**
 * 간단한 엔트리 해시 (머지 시 중복 제거용)
 */
function simpleEntryHash(entry) {
    const raw = `${entry.comment || ''}|${(entry.keys || []).join(',')}|${(entry.content || '').substring(0, 200)}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
        const chr = raw.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash.toString(36);
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

// ===== 자동 저장 =====

function onAutoSaveToggle() {
    const enabled = $(this).prop('checked');
    updateSetting('autoSaveHistory', enabled);
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
            const field = getEffectiveFieldUI(fieldId);
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

/**
 * UI에서 필드 정의 조회 (커스텀 오버라이드 우선)
 * @param {string} fieldId
 * @returns {Object|null}
 */
function getEffectiveFieldUI(fieldId) {
    const settings = getSettings();
    const customDef = settings?.customFieldDefinitions?.[fieldId];
    if (customDef) {
        const base = PROFILE_FIELDS[fieldId] || {};
        return { ...base, ...customDef, id: fieldId };
    }
    return PROFILE_FIELDS[fieldId] || null;
}

/**
 * 모든 사용 가능한 필드 ID 목록 반환 (기본 + 커스텀)
 * @returns {Array<string>}
 */
function getAllFieldIds() {
    const settings = getSettings();
    const baseIds = Object.keys(PROFILE_FIELDS);
    const customIds = Object.keys(settings?.customFieldDefinitions || {})
        .filter(id => id.startsWith('custom_'));
    return [...baseIds, ...customIds];
}

function renderCustomFieldList() {
    const settings = getSettings();
    const customFields = settings?.customFields || [];
    const customDefs = settings?.customFieldDefinitions || {};
    const $list = $('#pf-custom-field-list');
    $list.empty();

    const allFieldIds = getAllFieldIds();

    for (const fieldId of allFieldIds) {
        const field = getEffectiveFieldUI(fieldId);
        if (!field) continue;

        const checked = customFields.includes(fieldId) ? 'checked' : '';
        const nsfwClass = field.nsfw ? ' nsfw-field' : '';
        const isCustom = fieldId.startsWith('custom_');
        const isModified = !!customDefs[fieldId] && !isCustom;
        const modifiedBadge = isModified ? '<span class="pf-field-modified-badge" title="수정됨">*</span>' : '';

        $list.append(`
        <div class="pf-custom-field-item${nsfwClass}" data-field-id="${fieldId}">
            <div class="pf-field-item-main">
                <input type="checkbox" class="pf-custom-field-cb" data-field="${fieldId}" ${checked}>
                <span class="pf-field-icon"><i class="${field.icon}"></i></span>
                <span class="pf-field-name">${escapeHtml(field.label)}${modifiedBadge}</span>
                <div class="pf-field-item-actions">
                    <button class="pf-field-edit-btn pf-icon-btn-sm" data-field-id="${fieldId}" title="필드 편집">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                    ${isCustom ? `<button class="pf-field-delete-btn pf-icon-btn-sm pf-icon-btn-danger" data-field-id="${fieldId}" title="필드 삭제">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>` : ''}
                </div>
            </div>
            <span class="pf-field-desc-text">${escapeHtml(field.descriptionKo || field.description || '')}</span>
        </div>`);
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

// ===== Choice 필드 커스터마이징 =====

function onFieldEditToggle() {
    const fieldId = $(this).data('field-id');
    const $item = $(`.pf-custom-field-item[data-field-id="${fieldId}"]`);
    const $existing = $item.find('.pf-field-edit-form');

    // 토글 — 이미 편집 중이면 닫기
    if ($existing.length) {
        $existing.remove();
        return;
    }

    // 다른 열린 편집 폼 닫기
    $('.pf-field-edit-form').remove();

    const field = getEffectiveFieldUI(fieldId);
    if (!field) return;

    const form = `
    <div class="pf-field-edit-form">
        <div class="pf-field-edit-row">
            <label>한국어 이름</label>
            <input type="text" class="pf-input pf-field-edit-label" value="${escapeHtml(field.label)}" placeholder="예: 기본 정보">
        </div>
        <div class="pf-field-edit-row">
            <label>영문 헤더 <span class="pf-hint-inline">프롬프트에 ## 헤더로 사용</span></label>
            <input type="text" class="pf-input pf-field-edit-labelEn" value="${escapeHtml(field.labelEn)}" placeholder="예: BASICS">
        </div>
        <div class="pf-field-edit-row">
            <label>세부 설명 (EN) <span class="pf-hint-inline">프롬프트에 세부 지시로 사용</span></label>
            <input type="text" class="pf-input pf-field-edit-desc" value="${escapeHtml(field.description)}" placeholder="예: Name, Age, Sex, Race">
        </div>
        <div class="pf-field-edit-row">
            <label>세부 설명 (KO) <span class="pf-hint-inline">UI 표시용</span></label>
            <input type="text" class="pf-input pf-field-edit-descKo" value="${escapeHtml(field.descriptionKo || '')}" placeholder="예: 이름, 나이, 성별, 종족">
        </div>
        <div class="pf-field-edit-form-actions">
            <button class="pf-field-edit-save pf-primary-btn pf-small-btn" data-field-id="${fieldId}"><i class="fa-solid fa-check"></i> 저장</button>
            <button class="pf-field-edit-cancel pf-btn pf-small-btn" data-field-id="${fieldId}">취소</button>
        </div>
    </div>`;

    $item.append(form);
}

function onFieldEditSave() {
    const fieldId = $(this).data('field-id');
    const $item = $(`.pf-custom-field-item[data-field-id="${fieldId}"]`);
    const $form = $item.find('.pf-field-edit-form');

    const label = $form.find('.pf-field-edit-label').val().trim();
    const labelEn = $form.find('.pf-field-edit-labelEn').val().trim();
    const description = $form.find('.pf-field-edit-desc').val().trim();
    const descriptionKo = $form.find('.pf-field-edit-descKo').val().trim();

    if (!label || !labelEn || !description) {
        showToast('warning', '한국어 이름, 영문 헤더, 세부 설명(EN)은 필수입니다.');
        return;
    }

    const settings = getSettings();
    if (!settings.customFieldDefinitions) settings.customFieldDefinitions = {};

    // 기존 아이콘 유지 (새 필드는 이미 추가 시 fa-solid fa-star로 설정됨)
    const existingIcon = getEffectiveFieldUI(fieldId)?.icon || 'fa-solid fa-star';

    settings.customFieldDefinitions[fieldId] = {
        label,
        labelEn,
        description,
        descriptionKo: descriptionKo || label,
        icon: existingIcon,
    };

    // 커스텀 필드의 경우 isCustom 플래그 유지
    if (fieldId.startsWith('custom_')) {
        settings.customFieldDefinitions[fieldId].isCustom = true;
    }

    updateSetting('customFieldDefinitions', settings.customFieldDefinitions);
    renderCustomFieldList();
    updateTemplateDisplay();
    showToast('success', `필드 "${label}" 이(가) 저장되었습니다.`);
}

function onFieldEditCancel() {
    const fieldId = $(this).data('field-id');
    $(`.pf-custom-field-item[data-field-id="${fieldId}"] .pf-field-edit-form`).remove();
}

function onCustomFieldAdd() {
    const settings = getSettings();
    if (!settings.customFieldDefinitions) settings.customFieldDefinitions = {};
    if (!settings.customFields) settings.customFields = [];

    const id = 'custom_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4);

    settings.customFieldDefinitions[id] = {
        label: '새 필드',
        labelEn: 'NEW FIELD',
        description: 'Describe what this field should contain',
        descriptionKo: '새 필드 설명',
        icon: 'fa-solid fa-star',
        isCustom: true,
    };

    // 자동으로 선택 상태로 추가
    settings.customFields.push(id);

    updateSetting('customFieldDefinitions', settings.customFieldDefinitions);
    updateSetting('customFields', settings.customFields);
    renderCustomFieldList();
    updateTemplateDisplay();

    // 새로 추가된 필드의 편집 폼 자동 오픈
    setTimeout(() => {
        const $newItem = $(`.pf-custom-field-item[data-field-id="${id}"]`);
        $newItem.find('.pf-field-edit-btn').trigger('click');
        // 스크롤하여 보이도록
        $newItem[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);

    showToast('info', '새 필드가 추가되었습니다. 내용을 편집해주세요.');
}

function onFieldDelete() {
    const fieldId = $(this).data('field-id');
    if (!fieldId.startsWith('custom_')) return;

    const field = getEffectiveFieldUI(fieldId);
    const name = field?.label || fieldId;

    if (!confirm(`"필드 "${name}"을(를) 삭제하시겠습니까?`)) return;

    const settings = getSettings();

    // 정의에서 제거
    if (settings.customFieldDefinitions) {
        delete settings.customFieldDefinitions[fieldId];
        updateSetting('customFieldDefinitions', settings.customFieldDefinitions);
    }

    // 선택 목록에서 제거
    if (settings.customFields) {
        settings.customFields = settings.customFields.filter(id => id !== fieldId);
        updateSetting('customFields', settings.customFields);
    }

    renderCustomFieldList();
    updateTemplateDisplay();
    showToast('success', `필드 "${name}"이(가) 삭제되었습니다.`);
}

function onCustomFieldReset() {
    const settings = getSettings();
    const hasCustom = settings.customFieldDefinitions && Object.keys(settings.customFieldDefinitions).length > 0;

    if (!hasCustom) {
        showToast('info', '초기화할 커스텀 수정 사항이 없습니다.');
        return;
    }

    if (!confirm('모든 필드 커스터마이징(편집/추가)을 초기화하시겠습니까?\n기본 필드는 원래대로 복원되고, 커스텀 필드는 삭제됩니다.')) return;

    // 커스텀 필드 ID들을 customFields에서도 제거
    if (settings.customFields) {
        settings.customFields = settings.customFields.filter(id => !id.startsWith('custom_'));
        updateSetting('customFields', settings.customFields);
    }

    updateSetting('customFieldDefinitions', {});
    renderCustomFieldList();
    updateTemplateDisplay();
    showToast('success', '필드 커스터마이징이 초기화되었습니다.');
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
        setCancelled(false);
        switchTab('generate');
        showGenerateLoading(true);

        const result = await generatePersona({ conceptText, sheetTemplate });

        if (state.isCancelled) return;

        // 결과 렌더링
        renderGenerationResult(result);
        showToast('success', '페르소나가 생성되었습니다!');

        // 히스토리 자동 저장
        if (settings.autoSaveHistory && result) {
            const autoName = `${result.charName || 'Unknown'} 페르소나`;
            saveToHistory({
                name: autoName,
                charName: result.charName,
                fullText: result.fullText,
                language: result.language,
                templateId: result.templateId,
            });
        }

    } catch (error) {
        if (state.isCancelled || error.message === 'CANCELLED') return;
        logError('generate', error);
        showToast('error', `생성 실패: ${error.message}`);
        showGenerateLoading(false);
    }
}

/**
 * 생성 취소 핸들러
 */
function onCancelGeneration() {
    setCancelled(true);
    showGenerateLoading(false);
    showToast('info', '생성이 취소되었습니다.');
}

function startLoadingTextRotation() {
    stopLoadingTextRotation();
    loadingTextIndex = 0;
    const $text = $('#pf-gen-loading-text');
    $text.text(LOADING_TEXTS[0]).removeClass('pf-loading-text-fade');
    loadingTextInterval = setInterval(() => {
        loadingTextIndex = (loadingTextIndex + 1) % LOADING_TEXTS.length;
        $text.removeClass('pf-loading-text-fade');
        void $text[0]?.offsetWidth;
        $text.text(LOADING_TEXTS[loadingTextIndex]).addClass('pf-loading-text-fade');
    }, 3500);
}

function stopLoadingTextRotation() {
    if (loadingTextInterval) {
        clearInterval(loadingTextInterval);
        loadingTextInterval = null;
    }
}

function showGenerateLoading(show, customText = null) {
    $('#pf-gen-loading').toggle(show);
    $('#pf-gen-empty').toggle(!show && !state.currentGeneration);
    $('#pf-gen-result').toggle(!show && !!state.currentGeneration);
    $('#pf-generate-btn').prop('disabled', show);

    if (show) {
        isEditMode = false;
        $('#pf-edit-area').hide();
        $('#pf-sections-container').show();
        if (customText) {
            stopLoadingTextRotation();
            $('#pf-gen-loading-text').text(customText);
        } else {
            startLoadingTextRotation();
        }
    } else {
        stopLoadingTextRotation();
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

    // 전체 수정 지시 블록 추가 (모든 모드 공통)
    $('#pf-sections-container').append(`
    <div class="pf-modify-section" style="margin-top: 10px;">
        <button id="pf-modify-toggle-btn" class="pf-btn" style="width: 100%"><i class="fa-solid fa-pen-to-square"></i> 현재 생성된 프로필 기반 전체 수정 지시</button>
        <div id="pf-modify-panel" class="pf-inline-panel" style="display: none; margin-top: 8px;">
            <textarea id="pf-modify-instructions" class="pf-textarea" rows="3"
                placeholder="수정할 내용을 자유롭게 입력하세요...&#10;예: 나머지는 그대로 두고 이름만 전부 A로 바꿔줘&#10;예: 성격을 좀 더 쿨하게 바꿔줘"></textarea>
            <div class="pf-inline-panel-actions">
                <button id="pf-modify-go" class="pf-primary-btn pf-small-btn">수정 실행</button>
                <button id="pf-modify-cancel" class="pf-btn pf-small-btn">취소</button>
            </div>
        </div>
    </div>`);

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

    // 섹션 키를 순서대로 렌더 (section_0, section_1, ...)
    const sortedKeys = Object.keys(sections).sort((a, b) => {
        const numA = parseInt(a.replace('section_', ''), 10);
        const numB = parseInt(b.replace('section_', ''), 10);
        return numA - numB;
    });

    for (const sectionKey of sortedKeys) {
        const section = sections[sectionKey];
        if (!section) continue;

        // 헤더에서 ## 제거하여 라벨 추출
        const headerLabel = section.header.replace(/^#{1,3}\s+/, '').trim();
        const icon = guessIconForHeader(headerLabel);

        const content = section.content || '';
        // 헤더 부분을 제거하고 본문만 표시
        const displayContent = content.replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
        const isEmpty = !displayContent;

        const bodyContent = isEmpty ? '(이 섹션은 비어있습니다. 재생성을 시도해주세요.)' : escapeHtml(displayContent);

        $container.append(`
        <div class="pf-section-card" data-section-key="${sectionKey}">
            <div class="pf-section-card-header">
                <span class="pf-section-icon"><i class="${icon}"></i></span>
                <span class="pf-section-label">${escapeHtml(headerLabel)}</span>
                <button class="pf-section-edit-btn" title="이 섹션 편집" data-section-key="${sectionKey}"><i class="fa-solid fa-pen"></i></button>
                <button class="pf-section-regen-btn" title="이 섹션 재생성" data-section-key="${sectionKey}"><i class="fa-solid fa-arrows-rotate"></i></button>
            </div>
            <div class="pf-section-card-body${isEmpty ? ' empty' : ''}">${bodyContent}</div>
            <div class="pf-section-regen-panel" style="display: none;">
                <textarea placeholder="추가 지시사항 (선택사항)...&#10;예: 나머진 그대로 두고 키를 작게 변경해줘"></textarea>
                <div class="pf-section-regen-actions">
                    <button class="pf-section-regen-go pf-primary-btn pf-small-btn" data-section-key="${sectionKey}">재생성</button>
                    <button class="pf-section-regen-cancel pf-small-btn">취소</button>
                </div>
            </div>
        </div>`);
    }
}

/**
 * 커스텀 시트 모드 결과 렌더링 (단일 블록)
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
        setCancelled(false);
        showGenerateLoading(true, '프로필을 모루 위에서 다듬는 중...');
        $('#pf-modify-panel').hide();

        const result = await modifyProfile(instructions);

        if (state.isCancelled) return;
        renderGenerationResult(result);
        showToast('success', '프로필이 수정되었습니다!');

    } catch (error) {
        if (state.isCancelled || error.message === 'CANCELLED') return;
        logError('modify', error);
        showToast('error', `수정 실패: ${error.message}`);
        showGenerateLoading(false);
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

    const sectionKey = $(this).data('section-key');
    const $card = $(`.pf-section-card[data-section-key="${sectionKey}"]`);
    const instructions = $card.find('.pf-section-regen-panel textarea').val() || '';

    try {
        setCancelled(false);
        $card.find('.pf-section-card-body').html('<div class="pf-loading" style="padding:10px"><div class="pf-spinner" style="width:24px;height:24px"></div></div>');
        $card.find('.pf-section-regen-panel').hide();

        const result = await regenerateSection(sectionKey, instructions);

        if (state.isCancelled) return;

        // 해당 섹션만 업데이트
        const section = result.sections[sectionKey];
        const displayContent = (section?.content || '').replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
        $card.find('.pf-section-card-body')
            .removeClass('empty')
            .html(displayContent ? escapeHtml(displayContent) : '<em>(비어있음)</em>');

        // 헤더 라벨도 업데이트 (재생성 시 헤더가 바뀌었을 수 있음)
        const headerLabel = (section?.header || '').replace(/^#{1,3}\s+/, '').trim();
        if (headerLabel) {
            $card.find('.pf-section-label').text(headerLabel);
            $card.find('.pf-section-icon i').attr('class', guessIconForHeader(headerLabel));
        }

        showToast('success', `"${headerLabel}" 섹션이 재생성되었습니다.`);

    } catch (error) {
        if (state.isCancelled || error.message === 'CANCELLED') return;
        logError('regenSection', error);
        showToast('error', `재생성 실패: ${error.message}`);
        // 원래 내용 복원
        if (state.currentGeneration?.sections[sectionKey]) {
            const content = state.currentGeneration.sections[sectionKey].content.replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();
            $card.find('.pf-section-card-body').html(escapeHtml(content));
        }
    }
}

// ===== 섹션 개별 편집 =====

function onSectionEditToggle() {
    const sectionKey = $(this).data('section-key');
    const $card = $(`.pf-section-card[data-section-key="${sectionKey}"]`);
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

    const section = state.currentGeneration?.sections[sectionKey];
    if (!section) return;
    const rawContent = (section.content || '').replace(/^#{1,3}\s+.+\n?/gm, '').trimStart().trim();

    $body.hide();

    const editPanel = `
    <div class="pf-section-edit-panel">
        <textarea class="pf-section-edit-textarea pf-textarea">${escapeHtml(rawContent)}</textarea>
        <div class="pf-section-edit-actions">
            <button class="pf-section-edit-save pf-primary-btn pf-small-btn" data-section-key="${sectionKey}"><i class="fa-solid fa-check"></i> 저장</button>
            <button class="pf-section-edit-cancel pf-btn pf-small-btn" data-section-key="${sectionKey}">취소</button>
        </div>
    </div>`;

    $body.after(editPanel);
}

function onSectionEditSave() {
    const sectionKey = $(this).data('section-key');
    const $card = $(`.pf-section-card[data-section-key="${sectionKey}"]`);
    const newText = $card.find('.pf-section-edit-textarea').val().trim();

    if (state.currentGeneration?.sections[sectionKey]) {
        const section = state.currentGeneration.sections[sectionKey];
        // 헤더 포함하여 섹션 내용 업데이트
        section.content = `${section.header}\n${newText}`;

        // fullText 재조합
        const parts = [];
        const keys = Object.keys(state.currentGeneration.sections).sort((a, b) => {
            const numA = parseInt(a.replace('section_', ''), 10);
            const numB = parseInt(b.replace('section_', ''), 10);
            return numA - numB;
        });
        for (const key of keys) {
            const sec = state.currentGeneration.sections[key];
            if (sec?.content) parts.push(sec.content);
        }
        state.currentGeneration.fullText = parts.join('\n\n');

        // 디스플레이 업데이트
        $card.find('.pf-section-edit-panel').remove();
        const $body = $card.find('.pf-section-card-body');
        $body.html(newText ? escapeHtml(newText) : '<em>(비어있음)</em>')
            .toggleClass('empty', !newText)
            .show();

        const headerLabel = section.header.replace(/^#{1,3}\s+/, '').trim();
        showToast('success', `"${headerLabel}" 섹션이 수정되었습니다.`);
    }
}

function onSectionEditCancel() {
    const sectionKey = $(this).data('section-key');
    const $card = $(`.pf-section-card[data-section-key="${sectionKey}"]`);
    $card.find('.pf-section-edit-panel').remove();
    $card.find('.pf-section-card-body').show();
}

// ===== 전체 재생성 =====

async function onRegenAllClick() {
    if (state.isGenerating) return;

    const instructions = $('#pf-regen-all-instructions').val() || '';

    try {
        setCancelled(false);
        showGenerateLoading(true);
        $('#pf-regen-all-panel').hide();

        const result = await regenerateAll(instructions);

        if (state.isCancelled) return;
        renderGenerationResult(result);
        showToast('success', '페르소나가 재생성되었습니다!');

    } catch (error) {
        if (state.isCancelled || error.message === 'CANCELLED') return;
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
        setCancelled(false);
        showGenerateLoading(true, '다른 언어의 주형에 부어넣는 중...');
        $('#pf-translate-panel').hide();

        const result = await translateProfile(targetLang);

        if (state.isCancelled) return;
        renderGenerationResult(result);
        showToast('success', `${LANGUAGES[targetLang]?.label || targetLang}로 번역되었습니다!`);

    } catch (error) {
        if (state.isCancelled || error.message === 'CANCELLED') return;
        logError('translate', error);
        showToast('error', `번역 실패: ${error.message}`);
        showGenerateLoading(false);
    }
}

// ===== 저장/복사 =====

/**
 * 출력용 텍스트 생성 (최상단 헤더 자동 부착)
 */
function withProfileHeader(text) {
    if (!text) return text;
    return `# Character Profile\n\n${text}`;
}

function onCopyClick() {
    const text = state.currentGeneration?.fullText;
    if (!text) {
        showToast('warning', '복사할 내용이 없습니다.');
        return;
    }

    copyToClipboard(withProfileHeader(text)).then(success => {
        if (success) {
            showToast('success', '클립보드에 복사되었습니다.');
        } else {
            showToast('error', '복사에 실패했습니다.');
        }
    });
}

async function onApplyPersonaClick() {
    const rawText = state.currentGeneration?.fullText;
    if (!rawText) {
        showToast('warning', '적용할 내용이 없습니다.');
        return;
    }
    const text = withProfileHeader(rawText);

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
        $empty.html(`
            <div class="pf-empty-icon"><i class="fa-solid fa-clock-rotate-left"></i></div>
            <p>저장된 히스토리가 없습니다.</p>
        `);
        return;
    }

    $controls.show();

    // 검색/필터 적용
    const searchTerm = ($('#pf-history-search').val() || '').toLowerCase().trim();
    const filterLang = $('#pf-history-filter-lang').val() || '';
    const filterTemplate = $('#pf-history-filter-template').val() || '';

    const filtered = history.filter(item => {
        if (searchTerm) {
            const target = `${item.name || ''} ${item.charName || ''}`.toLowerCase();
            if (!target.includes(searchTerm)) return false;
        }
        if (filterLang && item.language !== filterLang) return false;
        if (filterTemplate && item.templateId !== filterTemplate) return false;
        return true;
    });

    if (!filtered.length) {
        $list.hide();
        $empty.show();
        $empty.html(`
            <div class="pf-empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
            <p>검색 결과가 없습니다.</p>
        `);
        return;
    }

    $empty.hide();
    $list.show();
    $list.empty();

    for (const item of filtered) {
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

function onHistoryFilterChange() {
    updateHistoryUI();
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

    copyToClipboard(withProfileHeader(item.fullText)).then(success => {
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

// ===== 히스토리 내보내기 / 가져오기 =====

function onHistoryExport() {
    const history = getHistory();
    if (!history.length) {
        showToast('warning', '내보낼 히스토리가 없습니다.');
        return;
    }

    const json = JSON.stringify(history, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `persona-forge-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('success', `${history.length}개 항목을 내보냈습니다.`);
}

function onHistoryImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const imported = JSON.parse(text);
            if (!Array.isArray(imported)) throw new Error('Invalid format');

            const settings = getSettings();
            if (!settings.history) settings.history = [];
            const existingIds = new Set(settings.history.map(h => h.id));

            let added = 0;
            for (const item of imported) {
                if (item.fullText && !existingIds.has(item.id)) {
                    settings.history.push(item);
                    existingIds.add(item.id);
                    added++;
                }
            }

            // 시간순 정렬 (최신 → 오래된)
            settings.history.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            saveSettingsDebounced();
            updateHistoryUI();
            showToast('success', `${added}개의 새 항목을 가져왔습니다.`);
        } catch (err) {
            logError('historyImport', err);
            showToast('error', '가져오기 실패: 유효하지 않은 파일입니다.');
        }
    };
    input.click();
}

/**
 * 히스토리 텍스트를 간단히 섹션으로 파싱 (인덱스 기반)
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
        sections['section_0'] = { header: '## PROFILE', content: text };
        return sections;
    }

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
        const content = text.substring(start, end).trim();
        sections[`section_${i}`] = { header: matches[i].fullMatch, content };
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
