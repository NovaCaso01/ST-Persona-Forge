/**
 * 페르소나 대장간 (ST-Persona-Forge)
 * SillyTavern용 {{user}} 페르소나 프로필 생성 확장
 *
 * 챗봇의 캐릭터 디스크립션과 월드인포를 기반으로
 * 어울리는 {{user}} 페르소나를 AI로 생성합니다.
 */

import { extensionName } from './src/constants.js';
import { state, log } from './src/state.js';
import { loadSettings } from './src/storage.js';
import { loadPopupHtml, addExtensionMenuButton, bindUIEvents } from './src/ui.js';

// ===== 초기화 =====

jQuery(async () => {
    // 설정 로드
    loadSettings();

    // 팝업 HTML 로드
    const loaded = await loadPopupHtml();
    if (!loaded) {
        console.error(`[${extensionName}] Failed to load popup HTML`);
        return;
    }

    // UI 이벤트 바인딩
    bindUIEvents();

    // 확장 메뉴 버튼 추가 (약간의 딜레이)
    setTimeout(addExtensionMenuButton, 2000);

    log('페르소나 대장간 초기화 완료');
});
