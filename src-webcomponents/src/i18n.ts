/**
 * The words the element shows, in the languages of ioBroker.
 *
 * The words of the views are those of the native widgets (`src-shared/i18n`): the build picks them
 * (`VIEW_WORDS`) and hands them in as `__WATTCYCLE_WORDS__`, without the prefix `wattcycle_`. Only the hints of
 * the web component are here.
 */
import type { Translate, ViewWord } from '../../src-shared/batteryData';

/** Set by `vite.config.ts`: language -> word of the views -> text */
declare const __WATTCYCLE_WORDS__: Record<string, Partial<Record<ViewWord, string>>>;

const VIEW_WORDS = __WATTCYCLE_WORDS__;

const EN = {
    chooseBattery: 'Choose a battery in the settings',
    notBattery: 'Not a battery of the WattCycle adapter',
};

export type HintWord = keyof typeof EN;

const HINTS: Record<string, Record<HintWord, string>> = {
    en: EN,
    de: {
        chooseBattery: 'Batterie in den Einstellungen wählen',
        notBattery: 'Keine Batterie des WattCycle-Adapters',
    },
    ru: {
        chooseBattery: 'Выберите батарею в настройках',
        notBattery: 'Это не батарея адаптера WattCycle',
    },
    pt: {
        chooseBattery: 'Escolha uma bateria nas configurações',
        notBattery: 'Não é uma bateria do adaptador WattCycle',
    },
    nl: {
        chooseBattery: 'Kies een batterij in de instellingen',
        notBattery: 'Geen batterij van de WattCycle-adapter',
    },
    fr: {
        chooseBattery: 'Choisissez une batterie dans les paramètres',
        notBattery: "Ce n'est pas une batterie de l'adaptateur WattCycle",
    },
    it: {
        chooseBattery: 'Scegli una batteria nelle impostazioni',
        notBattery: "Non è una batteria dell'adattatore WattCycle",
    },
    es: {
        chooseBattery: 'Elija una batería en la configuración',
        notBattery: 'No es una batería del adaptador WattCycle',
    },
    pl: {
        chooseBattery: 'Wybierz akumulator w ustawieniach',
        notBattery: 'To nie jest akumulator adaptera WattCycle',
    },
    uk: {
        chooseBattery: 'Виберіть батарею в налаштуваннях',
        notBattery: 'Це не батарея адаптера WattCycle',
    },
    'zh-cn': {
        chooseBattery: '请在设置中选择电池',
        notBattery: '不是 WattCycle 适配器的电池',
    },
};

/**
 * The translation of the views in a language; a word that is missing there is taken in English
 *
 * @param lang the language of the system
 */
export function getTranslate(lang: ioBroker.Languages): Translate {
    const words = VIEW_WORDS[lang] || VIEW_WORDS.en || {};
    return word => words[word] || VIEW_WORDS.en?.[word] || word;
}

/**
 * A hint of the element in a language
 *
 * @param lang the language of the system
 * @param word which hint
 */
export function getHint(lang: ioBroker.Languages, word: HintWord): string {
    return (HINTS[lang] || EN)[word] || EN[word];
}
