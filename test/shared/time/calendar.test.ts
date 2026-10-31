import {describe, expect, it} from "vitest";
import {
    BUSINESS_TIME_ZONE,
    addBusinessDays,
    addDays,
    calendarDateIn,
    daysBetween,
    formatDateOnly,
    isBusinessDay,
    parseDateOnly,
} from "../../../src/shared/time/calendar.js";

describe('BUSINESS_TIME_ZONE', () => {
    it('est le fuseau de Paris', () => {
        expect(BUSINESS_TIME_ZONE).toBe('Europe/Paris');
    });
});

describe('parseDateOnly', () => {
    it('renvoie minuit UTC', () => {
        expect(parseDateOnly('2026-03-02').toISOString()).toBe('2026-03-02T00:00:00.000Z');
    });

    it('accepte le 29 février d\'une année bissextile', () => {
        expect(parseDateOnly('2028-02-29').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    });

    it.each(['pas-une-date', '2026-13-01', '2026-03-32', ''])('renvoie une date invalide pour %j', (value) => {
        expect(Number.isNaN(parseDateOnly(value).getTime())).toBe(true);
    });
});

describe('formatDateOnly', () => {
    it('renvoie la date au format AAAA-MM-JJ', () => {
        expect(formatDateOnly(new Date('2026-03-02T00:00:00.000Z'))).toBe('2026-03-02');
    });

    it('ignore l\'heure et utilise le jour UTC', () => {
        expect(formatDateOnly(new Date('2026-03-02T23:59:59.999Z'))).toBe('2026-03-02');
    });

    it('est l\'inverse de parseDateOnly', () => {
        expect(formatDateOnly(parseDateOnly('2026-12-31'))).toBe('2026-12-31');
    });

    it('lève une erreur pour une date invalide', () => {
        expect(() => formatDateOnly(new Date('invalide'))).toThrow(RangeError);
    });
});

describe('calendarDateIn', () => {
    it('utilise le fuseau de Paris par défaut', () => {
        expect(calendarDateIn(new Date('2026-01-15T12:00:00.000Z'))).toEqual(parseDateOnly('2026-01-15'));
    });

    it('passe au lendemain à Paris dès 23h UTC en hiver (UTC+1)', () => {
        const instant = new Date('2026-01-15T23:30:00.000Z');

        expect(calendarDateIn(instant)).toEqual(parseDateOnly('2026-01-16'));
    });

    it('reste le même jour à Paris juste avant minuit en hiver', () => {
        const instant = new Date('2026-01-15T22:59:59.000Z');

        expect(calendarDateIn(instant)).toEqual(parseDateOnly('2026-01-15'));
    });

    it('passe au lendemain à Paris dès 22h UTC en été (UTC+2)', () => {
        const instant = new Date('2026-07-15T22:30:00.000Z');

        expect(calendarDateIn(instant)).toEqual(parseDateOnly('2026-07-16'));
    });

    it('change d\'année à Paris avant UTC', () => {
        const instant = new Date('2026-12-31T23:30:00.000Z');

        expect(calendarDateIn(instant)).toEqual(parseDateOnly('2027-01-01'));
    });

    it('respecte le fuseau demandé', () => {
        const instant = new Date('2026-01-15T03:00:00.000Z');

        expect(calendarDateIn(instant, 'America/New_York')).toEqual(parseDateOnly('2026-01-14'));
        expect(calendarDateIn(instant, 'Asia/Tokyo')).toEqual(parseDateOnly('2026-01-15'));
    });

    it('renvoie une date à minuit UTC', () => {
        const result = calendarDateIn(new Date('2026-01-15T17:45:12.000Z'));

        expect(result.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });

    it('lève une erreur pour un fuseau inconnu', () => {
        expect(() => calendarDateIn(new Date(), 'Mars/Olympus')).toThrow(RangeError);
    });
});

describe('isBusinessDay', () => {
    it.each([
        ['lundi', '2026-03-02'],
        ['mardi', '2026-03-03'],
        ['mercredi', '2026-03-04'],
        ['jeudi', '2026-03-05'],
        ['vendredi', '2026-03-06'],
    ])('considère le %s comme ouvré', (_day, date) => {
        expect(isBusinessDay(parseDateOnly(date))).toBe(true);
    });

    it.each([
        ['samedi', '2026-03-07'],
        ['dimanche', '2026-03-08'],
    ])('considère le %s comme non ouvré', (_day, date) => {
        expect(isBusinessDay(parseDateOnly(date))).toBe(false);
    });

    it('ne tient pas compte des jours fériés', () => {
        expect(isBusinessDay(parseDateOnly('2026-12-25'))).toBe(true);
    });
});

describe('addBusinessDays', () => {
    it.each([
        ['lundi + 1', '2026-03-02', 1, '2026-03-03'],
        ['lundi + 4', '2026-03-02', 4, '2026-03-06'],
        ['vendredi + 1 saute le week-end', '2026-03-06', 1, '2026-03-09'],
        ['jeudi + 2 saute le week-end', '2026-03-05', 2, '2026-03-09'],
        ['vendredi + 5', '2026-03-06', 5, '2026-03-13'],
        ['samedi + 1', '2026-03-07', 1, '2026-03-09'],
        ['dimanche + 1', '2026-03-08', 1, '2026-03-09'],
        ['lundi + 10 saute deux week-ends', '2026-03-02', 10, '2026-03-16'],
        ['fin de mois', '2026-03-31', 3, '2026-04-03'],
        ['changement d\'heure à Paris', '2026-03-27', 1, '2026-03-30'],
    ])('%s', (_label, start, days, expected) => {
        expect(addBusinessDays(parseDateOnly(start), days)).toEqual(parseDateOnly(expected));
    });

    it('renvoie la date de départ avec 0 jour', () => {
        const start = parseDateOnly('2026-03-02');

        expect(addBusinessDays(start, 0)).toEqual(start);
    });

    it('ne modifie pas la date de départ', () => {
        const start = parseDateOnly('2026-03-02');

        addBusinessDays(start, 3);

        expect(start).toEqual(parseDateOnly('2026-03-02'));
    });
});

describe('addDays', () => {
    it.each([
        ['ajoute des jours', '2026-03-02', 3, '2026-03-05'],
        ['compte les week-ends', '2026-03-06', 2, '2026-03-08'],
        ['ne change rien avec 0', '2026-03-02', 0, '2026-03-02'],
        ['retire des jours', '2026-03-02', -2, '2026-02-28'],
        ['change de mois', '2026-01-31', 1, '2026-02-01'],
        ['change d\'année', '2026-12-31', 1, '2027-01-01'],
        ['gère le 29 février', '2028-02-28', 1, '2028-02-29'],
        ['traverse le changement d\'heure à Paris', '2026-03-28', 2, '2026-03-30'],
    ])('%s', (_label, start, days, expected) => {
        expect(addDays(parseDateOnly(start), days)).toEqual(parseDateOnly(expected));
    });

    it('ne modifie pas la date de départ', () => {
        const start = parseDateOnly('2026-03-02');

        addDays(start, 3);

        expect(start).toEqual(parseDateOnly('2026-03-02'));
    });
});

describe('daysBetween', () => {
    it('compte les jours entre deux dates', () => {
        expect(daysBetween(parseDateOnly('2026-03-02'), parseDateOnly('2026-03-12'))).toBe(10);
    });

    it('renvoie 0 pour la même date', () => {
        const date = parseDateOnly('2026-03-02');

        expect(daysBetween(date, date)).toBe(0);
    });

    it('ne compte que les jours entiers', () => {
        const from = new Date('2026-03-02T00:00:00.000Z');

        expect(daysBetween(from, new Date('2026-03-02T23:59:59.999Z'))).toBe(0);
        expect(daysBetween(from, new Date('2026-03-03T00:00:00.000Z'))).toBe(1);
    });

    it('est négatif quand `to` précède `from`', () => {
        expect(daysBetween(parseDateOnly('2026-03-12'), parseDateOnly('2026-03-02'))).toBe(-10);
    });

    it('compte une journée incomplète en arrière comme -1', () => {
        const from = new Date('2026-03-02T12:00:00.000Z');

        expect(daysBetween(from, new Date('2026-03-02T11:00:00.000Z'))).toBe(-1);
    });

    it('traverse les changements d\'heure sans décalage', () => {
        expect(daysBetween(parseDateOnly('2026-03-01'), parseDateOnly('2026-04-01'))).toBe(31);
    });

    it('compte le 29 février', () => {
        expect(daysBetween(parseDateOnly('2028-02-01'), parseDateOnly('2028-03-01'))).toBe(29);
    });
});
